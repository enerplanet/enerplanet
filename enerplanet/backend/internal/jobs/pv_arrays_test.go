package jobs

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	commonModels "platform.local/common/pkg/models"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/pv"
	"spatialhub_backend/internal/weather"
)

type fakeRoofs map[string][]city2tabula.Surface

func (f fakeRoofs) GetBuildingsByOSMIDs(_ context.Context, _ string, ids []string) (city2tabula.BuildingsResult, error) {
	var out city2tabula.BuildingsResult
	for _, id := range ids {
		if s, ok := f[id]; ok {
			out.Buildings = append(out.Buildings, city2tabula.Building{OSMID: id, Surfaces: s})
		}
	}
	return out, nil
}

type fakePVWeather struct{ lat, lon float64 }

func (f *fakePVWeather) GetPVWeather(_ context.Context, lat, lon float64, _ weather.Period, _ string) (json.RawMessage, error) {
	f.lat, f.lon = lat, lon
	return json.RawMessage(`{}`), nil
}

// fakePV returns an hourly profile whose value at hour h is h/10000, so a
// window's offset shows in its values.
type fakePV struct{ requests []pv.ArrayRequest }

func (f *fakePV) Simulate(_ context.Context, _ pv.Location, _ json.RawMessage, arrays []pv.ArrayRequest) (map[string][]float64, error) {
	f.requests = arrays
	out := map[string][]float64{}
	for _, a := range arrays {
		hourly := make([]float64, 8760)
		for h := range hourly {
			hourly[h] = float64(h) / 10000
		}
		out[a.ID] = hourly
	}
	return out, nil
}

func pvFeature(osmID string, lon, lat, area float64, pvSupply map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{lon, lat}},
		"properties": map[string]interface{}{"osm_id": osmID, "feature_type": "BasePOI", "area": area},
		"techs":      map[string]interface{}{"pv_supply": pvSupply},
	}
}

func f64(v float64) *float64 { return &v }

func TestPVResolverPlacesSimulatesAndWindowsArrays(t *testing.T) {
	module := map[string]interface{}{"losses": 0.14, "module_type": float64(1), "cost_energy_cap": 575.0, "cont_energy_eff": 0.9, "tilt": 35.0}
	roofs := fakeRoofs{"1": {
		{ID: "south", Type: "RoofSurface", AreaSqm: f64(40), Tilt: f64(55), Azimuth: f64(180)},
		{ID: "north", Type: "RoofSurface", AreaSqm: f64(40), Tilt: f64(55), Azimuth: f64(0)},
	}}
	stored := map[string]interface{}{"arrays": []interface{}{
		map[string]interface{}{"surface_id": "r1", "tilt": 20.0, "azimuth": 90.0, "area": 25.0, "usable_share": 0.5, "capacity_kw": 3.0},
	}}
	topology := []interface{}{
		map[string]interface{}{"from": pvFeature("1", 12.0, 48.0, 100, module), "to": pvFeature("2", 13.0, 49.0, 50, stored)},
		map[string]interface{}{"from": pvFeature("3", 14.0, 50.0, 80, module)},
	}
	country := "germany"
	model := &commonModels.Model{ID: 7, Country: &country,
		FromDate: time.Date(2021, 1, 2, 0, 0, 0, 0, time.UTC), ToDate: time.Date(2021, 1, 2, 0, 0, 0, 0, time.UTC)}
	wx, sim := &fakePVWeather{}, &fakePV{}

	err := PVResolver{C2T: roofs, Weather: wx, PV: sim}.Attach(context.Background(), model, payload.CalculationPayload{Topology: topology, Resolution: 30})
	require.NoError(t, err)

	techs := func(i int, side string) map[string]interface{} {
		return topology[i].(map[string]interface{})[side].(map[string]interface{})["techs"].(map[string]interface{})
	}
	b1 := techs(0, "from")["pv_arrays"].([]interface{})
	require.Len(t, b1, 1, "only the south roof qualifies")
	south := b1[0].(map[string]interface{})
	assert.Equal(t, "south", south["surface_id"])
	assert.InDelta(t, 6.4, south["cont_energy_cap_max"], 1e-9)
	assert.Equal(t, 575.0, south["cost_energy_cap"])
	assert.NotContains(t, south, "cont_energy_eff")
	// 2 January at 30 minutes: 48 steps from hour 24, two per hour.
	profile := south["profile"].([]float64)
	require.Len(t, profile, 48)
	assert.Equal(t, []float64{0.0024, 0.0024, 0.0025}, profile[:3])
	assert.NotContains(t, techs(0, "from"), "pv_supply")

	b2 := techs(0, "to")["pv_arrays"].([]interface{})[0].(map[string]interface{})
	assert.Equal(t, "r1", b2["surface_id"])
	assert.Equal(t, 3.0, b2["cont_energy_cap_max"])
	assert.Equal(t, 3.0, b2["cont_energy_cap_min"])

	b3 := techs(1, "from")["pv_arrays"].([]interface{})[0].(map[string]interface{})
	assert.Equal(t, "", b3["surface_id"], "no 3D data: one flat array on the footprint")
	assert.Equal(t, 15.0, b3["tilt"])
	assert.InDelta(t, 12.8, b3["cont_energy_cap_max"], 1e-9)

	assert.Len(t, sim.requests, 3)
	assert.Equal(t, "premium", sim.requests[0].ModuleType)
	assert.InDelta(t, 49.0, wx.lat, 1e-9)
	assert.InDelta(t, 13.0, wx.lon, 1e-9)
}

func TestPVResolverDropsPVWhenNoRoofQualifies(t *testing.T) {
	roofs := fakeRoofs{"1": {{ID: "north", Type: "RoofSurface", AreaSqm: f64(40), Tilt: f64(55), Azimuth: f64(0)}}}
	topology := []interface{}{map[string]interface{}{"from": pvFeature("1", 12, 48, 100, map[string]interface{}{})}}
	country := "germany"
	sim := &fakePV{}

	err := PVResolver{C2T: roofs, Weather: &fakePVWeather{}, PV: sim}.Attach(context.Background(), &commonModels.Model{Country: &country}, payload.CalculationPayload{Topology: topology, Resolution: 60})

	require.NoError(t, err)
	techs := topology[0].(map[string]interface{})["from"].(map[string]interface{})["techs"].(map[string]interface{})
	assert.Empty(t, techs)
	assert.Nil(t, sim.requests, "nothing to simulate")
}
