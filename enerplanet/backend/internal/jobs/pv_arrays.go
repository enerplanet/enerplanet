package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	commonModels "platform.local/common/pkg/models"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/contenthash"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/pv"
	"spatialhub_backend/internal/store/series"
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

// pvSeriesStore is implemented by *series.Store.
type pvSeriesStore interface {
	StoredKeys(keys []string) (map[string]int64, error)
	Save(p series.NewProfile) (int64, error)
	Values(profileID int64, seriesName string) (models.SeriesValues, error)
	ReplaceLinks(owner series.Owner, revision, seriesName string, links []series.Link) error
}

const (
	// pvSeries is the series name PV profiles are stored and linked under.
	pvSeries = "pv"
	// pvUnit is the capacity factor, kW per kW installed: a model applies its
	// own capacity, so identical roofs share one stored profile.
	pvUnit = "kW_per_kWp"
)

// PVResolver gives each PV array a capacity-factor profile, stored by request
// key (see pv.RequestKey) so only arrays not stored yet go to the PV service,
// and links the model's profiles per building and roof face.
type PVResolver struct {
	C2T             roofSurfaceSource
	Weather         pvWeatherSource
	WeatherProvider string
	PV              pvSimulator
	Series          pvSeriesStore
	// Version is the PV service version, part of every stored profile's key.
	Version string
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

// Attach replaces each building's pv_supply by pv_arrays with production
// profiles, using stored pv_supply.arrays, else arrays placed on qualifying
// roofs (the footprint without 3D data).
func (r PVResolver) Attach(ctx context.Context, model *commonModels.Model, calc payload.CalculationPayload) error {
	buildings, profiles, err := r.resolve(ctx, model, calc)
	if err != nil {
		return err
	}
	w := modelSeriesWindow(model.FromDate, model.ToDate, pvResolution(calc.Resolution))
	for _, b := range buildings {
		setPVArrays(b, profiles, w, calc.Mode == "operate")
	}
	return nil
}

// Store gives every PV array of the model a stored profile and links them,
// without changing the payload.
func (r PVResolver) Store(ctx context.Context, model *commonModels.Model, calc payload.CalculationPayload) error {
	_, _, err := r.resolve(ctx, model, calc)
	return err
}

// resolve places the arrays, finds or simulates their profiles and replaces
// the model's PV links with them; a model without PV is left with none.
func (r PVResolver) resolve(ctx context.Context, model *commonModels.Model, calc payload.CalculationPayload) ([]*pvBuilding, map[string][]float32, error) {
	buildings := pvBuildings(calc.Topology)
	if err := r.placeArrays(ctx, model, buildings); err != nil {
		return nil, nil, err
	}
	profiles, links, err := r.storedProfiles(ctx, model, pvArrayRefs(buildings), pvResolution(calc.Resolution))
	if err != nil {
		return nil, nil, err
	}
	revision, err := contenthash.Of(model.Config)
	if err != nil {
		return nil, nil, fmt.Errorf("hash config of model %d: %w", model.ID, err)
	}
	if err := r.Series.ReplaceLinks(series.Owner{ModelID: model.ID}, revision, pvSeries, links); err != nil {
		return nil, nil, fmt.Errorf("link the PV profiles of model %d: %w", model.ID, err)
	}
	return buildings, profiles, nil
}

// pvResolution is the step PV profiles are stored at: the model's, as for its
// BuEM series, so a building's series share one time axis.
func pvResolution(resolution int) int {
	if resolution <= 0 {
		return 60
	}
	return resolution
}

// pvArrayRef is one array of a PV building: its request to the PV service
// (id "<osm_id>/<index>") and the part it is linked under.
type pvArrayRef struct {
	building  *pvBuilding
	surfaceID string
	part      string
	request   pv.ArrayRequest
}

// pvArrayRefs returns a reference per array. The part is the roof face; an
// array without one, or sharing it, is named by its index.
func pvArrayRefs(buildings []*pvBuilding) []*pvArrayRef {
	var refs []*pvArrayRef
	for _, b := range buildings {
		seen := map[string]bool{}
		for j, a := range b.arrays {
			part := a.SurfaceID
			if part == "" || seen[part] {
				part = fmt.Sprintf("array-%d", j)
			}
			seen[part] = true
			refs = append(refs, &pvArrayRef{building: b, surfaceID: a.SurfaceID, part: part, request: pv.ArrayRequest{
				ID: fmt.Sprintf("%s/%d", b.osmID, j), Tilt: a.Tilt, Azimuth: a.Azimuth,
				Losses:             numberOr(b.module["losses"], 0.14),
				DCACRatio:          numberOr(b.module["dc_ac_ratio"], 1.1),
				InverterEfficiency: numberOr(b.module["inv_eff"], 0.96),
				ModuleType:         moduleType(b.module["module_type"]),
			}})
		}
	}
	return refs
}

// pvCells groups the arrays by the weather cell of their building; a building
// without coordinates joins the cell of the located buildings' mean.
func pvCells(modelID uint, refs []*pvArrayRef) (map[pv.Location][]*pvArrayRef, error) {
	var mean pv.Location
	n := 0
	for _, ref := range refs {
		if ref.building.located {
			mean.Lat += ref.building.lat
			mean.Lon += ref.building.lon
			n++
		}
	}
	if n == 0 {
		return nil, fmt.Errorf("PV of model %d: no building with PV has coordinates", modelID)
	}
	mean = pv.Location{Lat: mean.Lat / float64(n), Lon: mean.Lon / float64(n)}
	cells := map[pv.Location][]*pvArrayRef{}
	for _, ref := range refs {
		loc := mean
		if ref.building.located {
			loc = pv.Location{Lat: ref.building.lat, Lon: ref.building.lon}
		}
		cell := pv.SnapLocation(loc)
		cells[cell] = append(cells[cell], ref)
	}
	return cells, nil
}

// storedProfiles returns each array's profile by request id, and the links
// for them, one weather cell at a time (see cellProfiles).
func (r PVResolver) storedProfiles(ctx context.Context, model *commonModels.Model, refs []*pvArrayRef, resolution int) (map[string][]float32, []series.Link, error) {
	if len(refs) == 0 {
		return nil, nil, nil
	}
	cells, err := pvCells(model.ID, refs)
	if err != nil {
		return nil, nil, err
	}
	period := modelWeatherPeriod(model.Config)
	provider := modelWeatherProvider(model.Config, r.WeatherProvider)
	profiles := map[string][]float32{}
	var links []series.Link
	for cell, cellRefs := range cells {
		ids, vals, err := r.cellProfiles(ctx, cell, period, provider, cellRefs, resolution)
		if err != nil {
			return nil, nil, fmt.Errorf("PV of model %d: %w", model.ID, err)
		}
		for _, ref := range cellRefs {
			profiles[ref.request.ID] = vals[ref.request.ID]
			links = append(links, series.Link{BuildingRef: ref.building.osmID, Part: ref.part, Series: pvSeries, ProfileID: ids[ref.request.ID], Source: models.SeriesSourceDefault})
		}
	}
	return profiles, links, nil
}

// cellProfiles returns the profiles of refs, all in one weather cell, and
// their stored ids, both by request id. It reads the weather once, reuses the
// profiles stored by key and simulates and stores only the missing ones.
func (r PVResolver) cellProfiles(ctx context.Context, cell pv.Location, period weather.Period, provider string, refs []*pvArrayRef, resolution int) (map[string]int64, map[string][]float32, error) {
	start, end := period.Range()
	periodStart, err := time.Parse(time.RFC3339, start)
	if err != nil {
		return nil, nil, fmt.Errorf("weather period start %q: %w", start, err)
	}
	// A value stands for its step and is stamped at the step's middle, as BuEM's
	// are, so a building's PV and demand series share one time axis.
	startTime := periodStart.Add(time.Duration(resolution) * time.Minute / 2)
	wx, err := r.Weather.GetPVWeather(ctx, cell.Lat, cell.Lon, period, provider)
	if err != nil {
		return nil, nil, fmt.Errorf("weather at %v: %w", cell, err)
	}
	shared, err := pv.NewSharedInputs(wx, cell, start, end, resolution, r.Version)
	if err != nil {
		return nil, nil, err
	}
	keys := make([]string, len(refs))
	for i, ref := range refs {
		if keys[i], err = pv.RequestKey(ref.surfaceID, ref.request, shared); err != nil {
			return nil, nil, fmt.Errorf("key the PV array %s: %w", ref.request.ID, err)
		}
	}
	stored, err := r.Series.StoredKeys(keys)
	if err != nil {
		return nil, nil, fmt.Errorf("look up the stored PV profiles: %w", err)
	}
	var missing []pv.ArrayRequest
	for i, ref := range refs {
		if _, ok := stored[keys[i]]; !ok {
			missing = append(missing, ref.request)
		}
	}
	simulated := map[string][]float64{}
	if len(missing) > 0 {
		if simulated, err = r.PV.Simulate(ctx, cell, wx, missing); err != nil {
			return nil, nil, fmt.Errorf("PV simulation: %w", err)
		}
	}
	ids := make(map[string]int64, len(refs))
	vals := make(map[string][]float32, len(refs))
	for i, ref := range refs {
		id, v, err := r.profile(keys[i], stored, simulated[ref.request.ID], startTime, resolution)
		if err != nil {
			return nil, nil, fmt.Errorf("PV array %s: %w", ref.request.ID, err)
		}
		stored[keys[i]] = id
		ids[ref.request.ID], vals[ref.request.ID] = id, v
	}
	return ids, vals, nil
}

// BuildingYield is one building's PV arrays and weather, for AnnualYield.
type BuildingYield struct {
	OSMID    string
	Location pv.Location
	Period   weather.Period
	// Provider is the weather archive; empty uses the resolver's default.
	Provider string
	// Module holds the building's pv_supply settings; a missing one takes the analysis default.
	Module map[string]interface{}
	Arrays []pv.Array
}

// AnnualYield returns the building's PV generation over the weather period's
// calendar year, in kWh. Its profiles come from and go to the analysis's store,
// so an array whose inputs did not change is read back, not simulated.
func (r PVResolver) AnnualYield(ctx context.Context, b BuildingYield) (float64, error) {
	building := &pvBuilding{osmID: b.OSMID, module: b.Module, arrays: b.Arrays, lat: b.Location.Lat, lon: b.Location.Lon, located: true}
	refs := pvArrayRefs([]*pvBuilding{building})
	if len(refs) == 0 {
		return 0, nil
	}
	provider := b.Provider
	if provider == "" {
		provider = r.WeatherProvider
	}
	_, profiles, err := r.cellProfiles(ctx, pv.SnapLocation(b.Location), b.Period, provider, refs, pvYieldResolution)
	if err != nil {
		return 0, fmt.Errorf("PV yield of building %s: %w", b.OSMID, err)
	}
	total := 0.0
	for j, a := range b.Arrays {
		capacity := a.MaxCapacityKW()
		if a.CapacityKW != nil {
			capacity = *a.CapacityKW
		}
		sum := 0.0
		for _, v := range profiles[refs[j].request.ID] {
			sum += float64(v)
		}
		total += capacity * sum * pvYieldResolution / 60
	}
	return total, nil
}

// pvYieldResolution is the step AnnualYield reads profiles at: hourly, the step
// of a model at its default resolution, so the analysis reuses them.
const pvYieldResolution = 60

// profile returns the stored profile under key, or stores the simulated one.
func (r PVResolver) profile(key string, stored map[string]int64, hourly []float64, start time.Time, resolution int) (int64, []float32, error) {
	if id, ok := stored[key]; ok {
		v, err := r.Series.Values(id, pvSeries)
		if err != nil {
			return 0, nil, fmt.Errorf("read stored profile %d: %w", id, err)
		}
		return id, v.Vals, nil
	}
	vals := pv.Resample(hourly, resolution)
	id, err := r.Series.Save(series.NewProfile{
		Key: key, Origin: models.SeriesOriginPV, ProducerVersion: r.Version,
		StartTime: start, ResolutionMinutes: resolution,
		Series: map[string]series.SeriesData{pvSeries: {Unit: pvUnit, Values: vals}},
	})
	if err != nil {
		return 0, nil, fmt.Errorf("store profile: %w", err)
	}
	return id, vals, nil
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
		// A way covering several 3D buildings offers the roofs of all of them.
		byWay, _ := result.ByRequestedWay(ids)
		for way, buildings := range byWay {
			for _, building := range buildings {
				surfaces[way] = append(surfaces[way], building.Surfaces...)
			}
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

// setPVArrays replaces the building's pv_supply by its pv_arrays entries. An
// array's laid-out capacity is the most its surface holds: fixed holds it at
// that (operate), otherwise the solver sizes it between 0 and that (plan).
func setPVArrays(b *pvBuilding, profiles map[string][]float32, w seriesWindow, fixed bool) {
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
			"profile":             pvWindow(profiles[fmt.Sprintf("%s/%d", b.osmID, j)], w),
		}
		if a.CapacityKW != nil {
			entry["cont_energy_cap_max"] = *a.CapacityKW
			if fixed {
				entry["cont_energy_cap_min"] = *a.CapacityKW
			}
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

// pvWindow is a stored profile's window; zeros when the array has none.
func pvWindow(vals []float32, w seriesWindow) []float64 {
	if len(vals) == 0 {
		return make([]float64, w.steps)
	}
	return window(vals, w)
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
