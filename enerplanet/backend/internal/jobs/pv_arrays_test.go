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
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/pv"
	"spatialhub_backend/internal/store/series"
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

// fakePVWeather records the cells it is asked for.
type fakePVWeather struct{ cells []pv.Location }

func (f *fakePVWeather) GetPVWeather(_ context.Context, lat, lon float64, _ weather.Period, _ string) (json.RawMessage, error) {
	f.cells = append(f.cells, pv.Location{Lat: lat, Lon: lon})
	return json.RawMessage(`{}`), nil
}

// fakePVStore keeps profiles by key and the links of the last replacement.
type fakePVStore struct {
	ids      map[string]int64
	values   map[int64][]float32
	units    map[int64]string
	starts   map[int64]time.Time
	revision string
	links    []series.Link
}

func newFakePVStore() *fakePVStore {
	return &fakePVStore{ids: map[string]int64{}, values: map[int64][]float32{}, units: map[int64]string{}, starts: map[int64]time.Time{}}
}

func (f *fakePVStore) StoredKeys(keys []string) (map[string]int64, error) {
	out := map[string]int64{}
	for _, k := range keys {
		if id, ok := f.ids[k]; ok {
			out[k] = id
		}
	}
	return out, nil
}

func (f *fakePVStore) Save(p series.NewProfile) (int64, error) {
	if id, ok := f.ids[p.Key]; ok {
		return id, nil
	}
	id := int64(len(f.ids) + 1)
	f.ids[p.Key] = id
	f.values[id] = p.Series[pvSeries].Values
	f.units[id] = p.Series[pvSeries].Unit
	f.starts[id] = p.StartTime
	return id, nil
}

func (f *fakePVStore) Values(id int64, _ string) (models.SeriesValues, error) {
	return models.SeriesValues{ProfileID: id, Series: pvSeries, Vals: f.values[id]}, nil
}

func (f *fakePVStore) ReplaceLinks(_ series.Owner, revision, _ string, links []series.Link) error {
	f.revision, f.links = revision, links
	return nil
}

// fakePV returns an hourly profile whose value at hour h is h/10000, so a
// window's offset shows in its values.
type fakePV struct{ requests []pv.ArrayRequest }

func (f *fakePV) Simulate(_ context.Context, _ pv.Location, _ json.RawMessage, arrays []pv.ArrayRequest) (map[string][]float64, error) {
	f.requests = append(f.requests, arrays...)
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
	// A centroid computed by the payload is a []float64.
	topology[1].(map[string]interface{})["from"].(map[string]interface{})["geometry"] = map[string]interface{}{"type": "Point", "coordinates": []float64{14.0, 50.0}}
	country := "germany"
	model := &commonModels.Model{ID: 7, Country: &country,
		FromDate: time.Date(2021, 1, 2, 0, 0, 0, 0, time.UTC), ToDate: time.Date(2021, 1, 2, 0, 0, 0, 0, time.UTC)}
	wx, sim, store := &fakePVWeather{}, &fakePV{}, newFakePVStore()

	err := PVResolver{C2T: roofs, Weather: wx, PV: sim, Series: store, Version: "test"}.Attach(context.Background(), model, payload.CalculationPayload{Topology: topology, Resolution: 30})
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
	assert.NotContains(t, b2, "cont_energy_cap_min", "a plan model sizes a laid-out array between 0 and its layout")

	b3 := techs(1, "from")["pv_arrays"].([]interface{})[0].(map[string]interface{})
	assert.Equal(t, "", b3["surface_id"], "no 3D data: one flat array on the footprint")
	assert.Equal(t, 15.0, b3["tilt"])
	assert.InDelta(t, 12.8, b3["cont_energy_cap_max"], 1e-9)

	assert.Len(t, sim.requests, 3)
	for _, r := range sim.requests {
		if r.ID == "1/0" {
			assert.Equal(t, "premium", r.ModuleType)
		}
	}
	assert.ElementsMatch(t, []pv.Location{
		pv.SnapLocation(pv.Location{Lat: 48, Lon: 12}), pv.SnapLocation(pv.Location{Lat: 49, Lon: 13}), pv.SnapLocation(pv.Location{Lat: 50, Lon: 14}),
	}, wx.cells, "each building's own weather cell, not the model's mean")

	var parts []string
	for _, l := range store.links {
		assert.Equal(t, "pv", l.Series)
		parts = append(parts, l.BuildingRef+":"+l.Part)
	}
	assert.ElementsMatch(t, []string{"1:south", "2:r1", "3:array-0"}, parts, "one link per roof face; an array without one by its index")
	for _, unit := range store.units {
		assert.Equal(t, "kW_per_kWp", unit)
	}
	for _, start := range store.starts {
		assert.Equal(t, time.Date(1900, 1, 1, 0, 15, 0, 0, time.UTC), start, "the scenario year, stamped at the middle of the first 30-minute step as BuEM stamps its values")
	}
}

// A second run of the same model finds every profile stored and simulates nothing.
func TestPVResolverReusesStoredProfiles(t *testing.T) {
	module := map[string]interface{}{"losses": 0.14}
	topology := func() []interface{} {
		return []interface{}{map[string]interface{}{"from": pvFeature("3", 14.0, 50.0, 80, module)}}
	}
	country := "germany"
	model := &commonModels.Model{ID: 7, Country: &country,
		FromDate: time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC), ToDate: time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC)}
	store := newFakePVStore()
	first := &fakePV{}
	require.NoError(t, PVResolver{C2T: fakeRoofs{}, Weather: &fakePVWeather{}, PV: first, Series: store, Version: "test"}.Store(context.Background(), model, payload.CalculationPayload{Topology: topology(), Resolution: 60}))
	require.Len(t, first.requests, 1)

	again := &fakePV{}
	second := topology()
	err := PVResolver{C2T: fakeRoofs{}, Weather: &fakePVWeather{}, PV: again, Series: store, Version: "test"}.Attach(context.Background(), model, payload.CalculationPayload{Topology: second, Resolution: 60})

	require.NoError(t, err)
	assert.Nil(t, again.requests, "nothing left to simulate")
	arrays := second[0].(map[string]interface{})["from"].(map[string]interface{})["techs"].(map[string]interface{})["pv_arrays"].([]interface{})
	assert.Equal(t, []float64{0, 0.0001, 0.0002}, arrays[0].(map[string]interface{})["profile"].([]float64)[:3])
}

func TestPVResolverDropsPVWhenNoRoofQualifies(t *testing.T) {
	roofs := fakeRoofs{"1": {{ID: "north", Type: "RoofSurface", AreaSqm: f64(40), Tilt: f64(55), Azimuth: f64(0)}}}
	topology := []interface{}{map[string]interface{}{"from": pvFeature("1", 12, 48, 100, map[string]interface{}{})}}
	country := "germany"
	sim, store := &fakePV{}, newFakePVStore()
	store.links = []series.Link{{BuildingRef: "1", Part: "south", Series: pvSeries, ProfileID: 9}}

	err := PVResolver{C2T: roofs, Weather: &fakePVWeather{}, PV: sim, Series: store, Version: "test"}.Attach(context.Background(), &commonModels.Model{ID: 3, Country: &country}, payload.CalculationPayload{Topology: topology, Resolution: 60})

	require.NoError(t, err)
	techs := topology[0].(map[string]interface{})["from"].(map[string]interface{})["techs"].(map[string]interface{})
	assert.Empty(t, techs)
	assert.Nil(t, sim.requests, "nothing to simulate")
	assert.Empty(t, store.links, "the model's earlier PV links are removed")
}

func TestAnnualYieldSumsArraysAndSimulatesOnlyChangedOnes(t *testing.T) {
	store := newFakePVStore()
	b := BuildingYield{OSMID: "7", Location: pv.Location{Lat: 48.8, Lon: 12.9}, Period: weather.DefaultPeriod, Arrays: []pv.Array{
		{SurfaceID: "south", Tilt: 35, Azimuth: 180, AreaSqm: 25, UsableShare: 0.5},
		{SurfaceID: "east", Tilt: 35, Azimuth: 90, AreaSqm: 40, UsableShare: 0.8, CapacityKW: f64(3)},
	}}
	// fakePV's hourly profile sums to this over the year.
	yearSum := 8759.0 * 8760 / 2 / 10000
	yield := func(sim *fakePV) float64 {
		kwh, err := PVResolver{Weather: &fakePVWeather{}, PV: sim, Series: store, Version: "test"}.AnnualYield(context.Background(), b)
		require.NoError(t, err)
		return kwh
	}

	first := &fakePV{}
	assert.InDelta(t, (25*0.5*0.2+3)*yearSum, yield(first), 0.5, "2.5 kW on the usable area plus a fixed 3 kW")
	assert.Len(t, first.requests, 2)

	b.Arrays[0].UsableShare = 0.6
	shareOnly := &fakePV{}
	assert.InDelta(t, (25*0.6*0.2+3)*yearSum, yield(shareOnly), 0.5)
	assert.Empty(t, shareOnly.requests, "a profile is per kWp, so a new share reuses it")

	b.Arrays[1].Tilt = 20
	tilted := &fakePV{}
	yield(tilted)
	require.Len(t, tilted.requests, 1)
	assert.Equal(t, 20.0, tilted.requests[0].Tilt)
}

func TestSetPVArraysFixesALaidOutArrayOnlyInOperate(t *testing.T) {
	laidOut := func() *pvBuilding {
		capacity := 3.0
		return &pvBuilding{osmID: "2", techs: map[string]interface{}{"pv_supply": map[string]interface{}{}}, module: map[string]interface{}{},
			arrays: []pv.Array{{SurfaceID: "r1", AreaSqm: 25, UsableShare: 0.5, CapacityKW: &capacity}}}
	}
	entry := func(b *pvBuilding) map[string]interface{} {
		return b.techs["pv_arrays"].([]interface{})[0].(map[string]interface{})
	}

	plan := laidOut()
	setPVArrays(plan, nil, seriesWindow{}, false)
	assert.Equal(t, 3.0, entry(plan)["cont_energy_cap_max"])
	assert.NotContains(t, entry(plan), "cont_energy_cap_min")

	operate := laidOut()
	setPVArrays(operate, nil, seriesWindow{}, true)
	assert.Equal(t, 3.0, entry(operate)["cont_energy_cap_max"])
	assert.Equal(t, 3.0, entry(operate)["cont_energy_cap_min"])
}
