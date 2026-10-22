package jobs

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/ignis"
)

// rowHouse is one LoD2 house of a terraced row; floor area nil leaves it
// without the A_ref BuEM requires.
func rowHouse(objectID string, floorArea *float64) city2tabula.Building {
	code := "DE.N.TH.09.Gen.ReEx.001.001"
	return city2tabula.Building{
		ObjectID: objectID, OSMID: "1001832407", TabulaVariantCode: &code, FloorAreaSqm: floorArea,
		Surfaces: []city2tabula.Surface{{ID: objectID + "-w", Type: "WallSurface", AreaSqm: floatPtr(40), Azimuth: floatPtr(180), Tilt: floatPtr(0)}},
	}
}

func rowNode(osmID string, props map[string]interface{}) map[string]interface{} {
	p := map[string]interface{}{"feature_type": "BasePOI", "osm_id": osmID, "f_class": "terrace"}
	for k, v := range props {
		p[k] = v
	}
	return map[string]interface{}{"from": map[string]interface{}{
		"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{12.96, 48.83}},
		"properties": p,
	}}
}

var rowUValues = fakeEnvelopeUValueResolver{uValues: ignis.EnvelopeUValues{UWall: 1, URoof: 1, UFloor: 1}}

func ids(buildings []buem.Building) []string {
	out := make([]string, len(buildings))
	for i, b := range buildings {
		out[i] = b.ID
	}
	return out
}

// Each 3D building of a way runs under its own id, largest first; a way with
// one 3D building keeps the way's id, so its stored results stay valid.
func TestBuildingsForBuem_runsEveryBuildingOfAWay(t *testing.T) {
	envelopes := map[string][]city2tabula.Building{
		"1001832407": {rowHouse("DEBY_large", floatPtr(140)), rowHouse("DEBY_small", floatPtr(90))},
		"555":        {rowHouse("DEBY_single", floatPtr(120))},
	}
	topology := []interface{}{rowNode("1001832407", nil), rowNode("555", nil)}

	buildings, resolved, unresolved := buildingsForBuem(context.Background(), rowUValues, "germany", topology, envelopes, nil, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingElectric})

	assert.ElementsMatch(t, []string{"1001832407#DEBY_large", "1001832407#DEBY_small", "555"}, ids(buildings))
	assert.Len(t, resolved, 3)
	assert.Empty(t, unresolved)
}

// The configurator edits the building it shows, the largest; its customised
// block replaces that building's run only, the others come from City2TABULA.
func TestBuildingsForBuem_customisedBlockReplacesTheLargestOnly(t *testing.T) {
	envelopes := map[string][]city2tabula.Building{
		"1001832407": {rowHouse("DEBY_large", floatPtr(140)), rowHouse("DEBY_small", floatPtr(90))},
	}
	stored := map[string]interface{}{"building": map[string]interface{}{"building_type": "TH", "A_ref": map[string]interface{}{"value": 150, "unit": "m2"}}}
	topology := []interface{}{rowNode("1001832407", map[string]interface{}{"buem": stored})}

	buildings, resolved, _ := buildingsForBuem(context.Background(), rowUValues, "germany", topology, envelopes, nil, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingElectric})

	require.Len(t, buildings, 2)
	assert.True(t, resolved["1001832407#DEBY_large"].Customised)
	assert.False(t, resolved["1001832407#DEBY_small"].Customised)
	var small map[string]interface{}
	require.NoError(t, json.Unmarshal(buildings[1].Building, &small))
	assert.Equal(t, 90.0, small["A_ref"].(map[string]interface{})["value"], "the small house keeps its own floor area")
}

// One building of a way that cannot be prepared fails the whole way, with its
// reason, and its sibling is not sent: a partial sum would undercount the way.
func TestFoldPartFailures_failsTheWholeWay(t *testing.T) {
	envelopes := map[string][]city2tabula.Building{
		"1001832407": {rowHouse("DEBY_large", floatPtr(140)), rowHouse("DEBY_small", nil)},
	}
	parts := partIDs(envelopes)
	topology := []interface{}{rowNode("1001832407", nil)}
	buildings, resolved, unresolved := buildingsForBuem(context.Background(), rowUValues, "germany", topology, envelopes, nil, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingElectric})

	buildings = foldPartFailures(parts, buildings, resolved, unresolved)

	assert.Empty(t, buildings)
	assert.Empty(t, resolved)
	assert.Contains(t, unresolved["1001832407"], "1 of the 2 3D buildings")
	assert.Contains(t, unresolved["1001832407"], "3D building DEBY_small: City2TABULA has no floor area")
	assert.NotContains(t, parts, "1001832407")
}

// partRun is a prepared run of one way with two 3D buildings whose blocks
// differ, so each gets its own BuEM request.
func partRun() buemRun {
	run := testRun(0)
	run.parts = map[string][]string{"w": {"w#a", "w#b"}}
	for _, id := range run.parts["w"] {
		run.buildings = append(run.buildings, buem.Building{ID: id, Geometry: json.RawMessage(`{}`), Building: json.RawMessage(`{"id":"` + id + `"}`)})
		run.resolved[id] = BuemResolutionMeta{VariantCode: "variant-" + id}
	}
	return run
}

// The way's profile is the step-by-step sum of its buildings', stored once and
// reused by a second run; it carries the largest building's metadata.
func TestCombineParts_sumsTheBuildingsOfAWay(t *testing.T) {
	store := newMemStore()
	run := partRun()
	runner := &fakeRunner{version: "6.10.0"}

	out, err := resolveSeries(context.Background(), logrus.NewEntry(logrus.New()), run, 60, "1", "6.10.0", store, runner)
	require.NoError(t, err)
	require.NoError(t, combineParts(store, run.parts, run.resolved, &out))

	require.Contains(t, out.profiles, "w")
	assert.NotContains(t, out.profiles, "w#a")
	assert.Equal(t, []float32{2, 4}, store.profiles[out.profiles["w"]].Series["heating"].Values)
	assert.Equal(t, []float32{1, 1}, store.profiles[out.profiles["w"]].Series["electricity"].Values)
	assert.Equal(t, "variant-w#a", run.resolved["w"].VariantCode)
	assert.NotContains(t, run.resolved, "w#b")

	saves := store.saves
	again := partRun()
	out2, err := resolveSeries(context.Background(), logrus.NewEntry(logrus.New()), again, 60, "1", "6.10.0", store, runner)
	require.NoError(t, err)
	require.NoError(t, combineParts(store, again.parts, again.resolved, &out2))
	assert.Equal(t, out.profiles["w"], out2.profiles["w"])
	assert.Equal(t, saves, store.saves, "the second run stores nothing new")
}

// A building BuEM rejected fails its way, which then gets no profile.
func TestCombineParts_aFailedBuildingFailsTheWay(t *testing.T) {
	store := newMemStore()
	run := partRun()
	runner := &fakeRunner{version: "6.10.0", errorFor: map[string]bool{"w#b": true}}

	out, err := resolveSeries(context.Background(), logrus.NewEntry(logrus.New()), run, 60, "1", "6.10.0", store, runner)
	require.NoError(t, err)
	require.NoError(t, combineParts(store, run.parts, run.resolved, &out))

	assert.NotContains(t, out.profiles, "w")
	assert.NotContains(t, out.failed, "w#b")
	assert.Contains(t, out.failed["w"], "3D building b: BuEM rejected the envelope")
}

// The run_buem path merges raw results into the topology by way, so the
// buildings of a way are combined into one result under the way's id.
func TestCombinePartResults(t *testing.T) {
	block := func(heating string) json.RawMessage {
		return json.RawMessage(`{"thermal_load_profile": {"start_time": "1900-01-01T00:00:00Z", "resolution": 60,
			"summary": {"heating": {"total": {"value": 0, "unit": "kWh"}}}, "timeseries": {"unit": "kW", "heating": ` + heating + `}},
			"model_metadata": {"model_version": "6.10.0"}}`)
	}
	parts := map[string][]string{"w": {"w#a", "w#b"}, "v": {"v#a", "v#b"}}
	got := combinePartResults([]buem.BuildingResult{
		{ID: "w#a", BUEM: block("[1, 2]")}, {ID: "w#b", BUEM: block("[3, 4]")},
		{ID: "v#a", BUEM: block("[1, 1]")}, {ID: "v#b", Error: "no envelope"},
		{ID: "single", BUEM: block("[5, 5]")},
	}, parts)

	byID := map[string]buem.BuildingResult{}
	for _, r := range got {
		byID[r.ID] = r
	}
	require.Len(t, byID, 3)
	parsed, err := buem.ParseResult(byID["w"])
	require.NoError(t, err)
	assert.Equal(t, []float32{4, 6}, parsed.Series["heating"].Values)
	assert.Contains(t, byID["v"].Error, "3D building b: no envelope")
	assert.NotEmpty(t, byID["single"].BUEM)
}

// Failing a whole run records each way once, never one of its buildings.
func TestAllFailed_recordsWays(t *testing.T) {
	got := allFailed([]buem.Building{{ID: "w#a"}, {ID: "w#b"}, {ID: "single"}}, "BuEM is down")
	assert.Equal(t, map[string]string{"w": "BuEM is down", "single": "BuEM is down"}, got)
}
