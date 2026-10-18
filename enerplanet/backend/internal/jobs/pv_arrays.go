package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	commonModels "platform.local/common/pkg/models"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/pv"
	"spatialhub_backend/internal/weather"
)

// roofSurfaceSource is implemented by *city2tabula.Client.
type roofSurfaceSource interface {
	GetBuildingsByOSMIDs(ctx context.Context, country string, osmIDs []string) (city2tabula.BuildingsResult, error)
}

// pvWeatherSource is implemented by *weather.Client.
type pvWeatherSource interface {
	GetPVWeather(ctx context.Context, lat, lon float64, period weather.Period, provider string) (json.RawMessage, error)
}

// pvSimulator is implemented by *pv.Client.
type pvSimulator interface {
	Simulate(ctx context.Context, loc pv.Location, weather json.RawMessage, arrays []pv.ArrayRequest) (map[string][]float64, error)
}

// PVResolver replaces each building's pv_supply by pv_arrays with production profiles.
type PVResolver struct {
	C2T             roofSurfaceSource
	Weather         pvWeatherSource
	WeatherProvider string
	PV              pvSimulator
}

// pvBuilding is a building of the payload that carries PV.
type pvBuilding struct {
	osmID    string
	techs    map[string]interface{}
	module   map[string]interface{}
	lon, lat float64
	located  bool
	area     float64
	arrays   []pv.Array
}

// moduleTypes is indexed by the PV template's module_type option.
var moduleTypes = []string{"standard", "premium", "thin_film"}

// pvCarriedKeys are copied to every array; cont_energy_eff is left out since the profile includes losses.
var pvCarriedKeys = []string{
	"cont_lifetime", "cont_energy_cap_max_systemwide", "cost_energy_cap", "cost_om_annual",
	"cost_om_annual_investment_fraction", "cost_om_prod", "cost_interest_rate", "cost_purchase",
}

// Attach uses stored pv_supply.arrays, else places arrays on qualifying roofs (footprint without 3D data).
func (r PVResolver) Attach(ctx context.Context, model *commonModels.Model, calc payload.CalculationPayload) error {
	buildings := pvBuildings(calc.Topology)
	if len(buildings) == 0 {
		return nil
	}
	if err := r.placeArrays(ctx, model, buildings); err != nil {
		return err
	}
	requests, loc := pvRequests(buildings)
	if len(requests) == 0 {
		for _, b := range buildings {
			setPVArrays(b, nil, seriesWindow{})
		}
		return nil
	}
	if loc == (pv.Location{}) {
		return fmt.Errorf("PV of model %d: no building with PV has coordinates", model.ID)
	}
	period := modelWeatherPeriod(model.Config)
	provider := modelWeatherProvider(model.Config, r.WeatherProvider)
	wx, err := r.Weather.GetPVWeather(ctx, loc.Lat, loc.Lon, period, provider)
	if err != nil {
		return fmt.Errorf("weather for the PV of model %d: %w", model.ID, err)
	}
	profiles, err := r.PV.Simulate(ctx, loc, wx, requests)
	if err != nil {
		return fmt.Errorf("PV simulation of model %d: %w", model.ID, err)
	}
	w := modelSeriesWindow(model.FromDate, model.ToDate, calc.Resolution)
	for _, b := range buildings {
		setPVArrays(b, profiles, w)
	}
	return nil
}

// pvBuildings returns the payload's buildings with pv_supply.
func pvBuildings(topology []interface{}) []*pvBuilding {
	var out []*pvBuilding
	for _, feature := range payloadBuildings(topology) {
		techs, _ := feature["techs"].(map[string]interface{})
		module, ok := techs["pv_supply"].(map[string]interface{})
		if !ok {
			continue
		}
		props, _ := feature["properties"].(map[string]interface{})
		b := &pvBuilding{osmID: fmt.Sprint(props["osm_id"]), techs: techs, module: module}
		b.area, _ = props["area"].(float64)
		if coords, ok := featureCoordinates(feature); ok {
			b.lon, b.lat, b.located = coords[0], coords[1], true
		}
		b.arrays = storedArrays(module)
		out = append(out, b)
	}
	return out
}

// storedArrays decodes pv_supply.arrays; nil when the user set none.
func storedArrays(module map[string]interface{}) []pv.Array {
	raw, ok := module["arrays"]
	if !ok || raw == nil {
		return nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	arrays := []pv.Array{}
	if json.Unmarshal(data, &arrays) != nil {
		return nil
	}
	return arrays
}

// featureCoordinates returns a Point feature's [lon, lat]; a centroid the
// payload computed is a []float64, one copied from the config a []interface{}.
func featureCoordinates(feature map[string]interface{}) ([2]float64, bool) {
	geom, _ := feature["geometry"].(map[string]interface{})
	switch coords := geom["coordinates"].(type) {
	case []float64:
		if len(coords) >= 2 {
			return [2]float64{coords[0], coords[1]}, true
		}
	case []interface{}:
		if len(coords) >= 2 {
			lon, okLon := coords[0].(float64)
			lat, okLat := coords[1].(float64)
			return [2]float64{lon, lat}, okLon && okLat
		}
	}
	return [2]float64{}, false
}

// placeArrays fills arrays for buildings without stored ones.
func (r PVResolver) placeArrays(ctx context.Context, model *commonModels.Model, buildings []*pvBuilding) error {
	var ids []string
	for _, b := range buildings {
		if b.arrays == nil {
			ids = append(ids, b.osmID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	surfaces := map[string][]city2tabula.Surface{}
	if model.Country != nil {
		result, err := r.C2T.GetBuildingsByOSMIDs(ctx, *model.Country, ids)
		if err != nil {
			return fmt.Errorf("roof surfaces for the PV of model %d: %w", model.ID, err)
		}
		for _, building := range result.Buildings {
			surfaces[building.OSMID] = building.Surfaces
		}
	}
	for _, b := range buildings {
		if b.arrays != nil {
			continue
		}
		roofs, has3D := surfaces[b.osmID]
		switch {
		case has3D:
			b.arrays = pv.RoofArrays(roofs)
		case b.area > 0:
			b.arrays = []pv.Array{pv.FlatRoofArray("", b.area)}
		}
	}
	return nil
}

// pvRequests returns one request per array (id "<osm_id>/<index>") and the buildings' mean location.
func pvRequests(buildings []*pvBuilding) ([]pv.ArrayRequest, pv.Location) {
	var requests []pv.ArrayRequest
	var loc pv.Location
	n := 0
	for _, b := range buildings {
		for j, a := range b.arrays {
			requests = append(requests, pv.ArrayRequest{
				ID: fmt.Sprintf("%s/%d", b.osmID, j), Tilt: a.Tilt, Azimuth: a.Azimuth,
				Losses:             numberOr(b.module["losses"], 0.14),
				DCACRatio:          numberOr(b.module["dc_ac_ratio"], 1.1),
				InverterEfficiency: numberOr(b.module["inv_eff"], 0.96),
				ModuleType:         moduleType(b.module["module_type"]),
			})
		}
		if len(b.arrays) > 0 && b.located {
			loc.Lat += b.lat
			loc.Lon += b.lon
			n++
		}
	}
	if n > 0 {
		loc.Lat /= float64(n)
		loc.Lon /= float64(n)
	}
	return requests, loc
}

// setPVArrays replaces the building's pv_supply by its pv_arrays entries.
func setPVArrays(b *pvBuilding, profiles map[string][]float64, w seriesWindow) {
	delete(b.techs, "pv_supply")
	if len(b.arrays) == 0 {
		return
	}
	entries := make([]interface{}, len(b.arrays))
	for j, a := range b.arrays {
		entry := map[string]interface{}{
			"surface_id": a.SurfaceID, "tilt": a.Tilt, "azimuth": a.Azimuth,
			"losses":              numberOr(b.module["losses"], 0.14),
			"cont_energy_cap_max": math.Round(a.MaxCapacityKW()*1000) / 1000,
			"profile":             hourlyWindow(profiles[fmt.Sprintf("%s/%d", b.osmID, j)], w),
		}
		if a.CapacityKW != nil {
			entry["cont_energy_cap_max"] = *a.CapacityKW
			entry["cont_energy_cap_min"] = *a.CapacityKW
		}
		for _, k := range pvCarriedKeys {
			if v, ok := b.module[k]; ok {
				entry[k] = v
			}
		}
		entries[j] = entry
	}
	b.techs["pv_arrays"] = entries
}

// hourlyWindow maps an hourly profile from 1 January onto the model's steps, wrapping like window.
func hourlyWindow(hourly []float64, w seriesWindow) []float64 {
	out := make([]float64, w.steps)
	if len(hourly) == 0 {
		return out
	}
	for i := range out {
		out[i] = hourly[((w.offset+i)*w.resolution/60)%len(hourly)]
	}
	return out
}

// numberOr returns v as a float64, or fallback when v is not a number.
func numberOr(v interface{}, fallback float64) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return fallback
}

// moduleType returns the PV service name for a module_type index, standard when unknown.
func moduleType(v interface{}) string {
	i := int(numberOr(v, 0))
	if i < 0 || i >= len(moduleTypes) {
		return moduleTypes[0]
	}
	return moduleTypes[i]
}
