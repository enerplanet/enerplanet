package jobs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
)

func floatPtr(f float64) *float64 { return &f }
func boolPtr(b bool) *bool        { return &b }

// The surface-to-envelope mapping moved to internal/city2tabula
// (city2tabula.EnvelopeElements); its tests live in
// internal/city2tabula/envelope_test.go.

func TestBuildingsForBuem_CollectsByOSMIDWithGeometryAndEnvelope(t *testing.T) {
	building := func(osmID string) map[string]interface{} {
		return map[string]interface{}{
			"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{12.5, 48.5}},
			"properties": map[string]interface{}{
				"feature_type": "BasePOI",
				"osm_id":       osmID,
			},
		}
	}
	transformer := map[string]interface{}{
		"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{12.6, 48.6}},
		"properties": map[string]interface{}{
			"feature_type": "TopologyNode",
			"osm_id":       "Trafo_1",
		},
	}

	topology := []interface{}{
		map[string]interface{}{"from": building("111"), "to": transformer},
		map[string]interface{}{"from": building("222")}, // no envelope match
	}

	envelopeByOSMID := map[string]city2tabula.Building{
		"111": {
			OSMID: "111",
			Surfaces: []city2tabula.Surface{
				{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)},
			},
		},
	}

	buildings := buildingsForBuem(topology, envelopeByOSMID)

	require.Len(t, buildings, 1, "only building 111 has a resolved envelope; the transformer and building 222 must be excluded")
	assert.Equal(t, "111", buildings[0].ID)
	assert.JSONEq(t, `{"type":"Point","coordinates":[12.5,48.5]}`, string(buildings[0].Geometry))

	var block map[string]interface{}
	require.NoError(t, json.Unmarshal(buildings[0].Building, &block))
	assert.Contains(t, block, "envelope")
	assert.NotContains(t, block, "weather", "weather must not be attached per building — RunBuildings sends it once, shared")
}

func TestMergeBuemResults_WritesByOSMIDAndSkipsFailures(t *testing.T) {
	building := func(osmID string) map[string]interface{} {
		return map[string]interface{}{
			"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": osmID},
		}
	}
	topology := []interface{}{
		map[string]interface{}{"from": building("111")},
		map[string]interface{}{"from": building("222")}, // BuEM rejected this one
	}

	results := []buem.BuildingResult{
		{ID: "111", BUEM: json.RawMessage(`{"thermal_load_profile":{}}`)},
		{ID: "222", Error: "building.envelope is required"},
	}

	mergeBuemResults(logrus.NewEntry(logrus.New()), topology, results)

	matched := topology[0].(map[string]interface{})["from"].(map[string]interface{})["properties"].(map[string]interface{})
	require.Contains(t, matched, "buem", "building 111 succeeded, should be enriched")

	failed := topology[1].(map[string]interface{})["from"].(map[string]interface{})["properties"].(map[string]interface{})
	assert.NotContains(t, failed, "buem", "building 222's result carried an error, must be left alone")
}

func topologyBuildings(osmIDs ...string) []interface{} {
	topology := make([]interface{}, len(osmIDs))
	for i, id := range osmIDs {
		topology[i] = map[string]interface{}{
			"from": map[string]interface{}{
				"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": id},
			},
		}
	}
	return topology
}

// TestResolveEnvelope_PartialCoverageTriggersRunForMissingBuildings covers
// the scenario where one user's polygon already linked building "111", and a
// second, overlapping-but-different polygon needs "111" and "222" — "222" was
// never processed. A bbox-level coverage count (count > 0) would have seen
// "111" and wrongly concluded the whole area was covered.
func TestResolveEnvelope_PartialCoverageTriggersRunForMissingBuildings(t *testing.T) {
	var buildingsCalls int32
	var runTriggered bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/buildings":
			if atomic.AddInt32(&buildingsCalls, 1) == 1 {
				_, _ = w.Write([]byte(`[{"object_id":"DE1","osm_id":"111","match_type":1}]`))
			} else {
				_, _ = w.Write([]byte(`[{"object_id":"DE1","osm_id":"111","match_type":1},{"object_id":"DE2","osm_id":"222","match_type":1}]`))
			}
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/runs":
			runTriggered = true
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"run_id":"run1","country":"germany","status":"pending"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/runs/run1":
			_, _ = w.Write([]byte(`{"run_id":"run1","country":"germany","status":"completed"}`))
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	client := city2tabula.NewClient(server.URL)
	log := logrus.NewEntry(logrus.New())
	bbox := city2tabula.Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4}

	result := resolveEnvelope(context.Background(), log, client, "germany", bbox, topologyBuildings("111", "222"))

	assert.True(t, runTriggered, "a run must be triggered when the topology needs a building city2tabula hasn't linked yet")
	assert.Len(t, result, 2, "after the run, both buildings should resolve, not just the one already linked from an earlier overlapping polygon")
	assert.Contains(t, result, "111")
	assert.Contains(t, result, "222")
}

// TestResolveEnvelope_FullCoverageSkipsRun asserts the fix doesn't lose the
// original optimization: when every building the topology needs is already
// linked, no run is triggered.
func TestResolveEnvelope_FullCoverageSkipsRun(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/api/v1/buildings" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"object_id":"DE1","osm_id":"111","match_type":1}]`))
			return
		}
		t.Fatalf("unexpected request: %s %s — no run should be triggered when all needed buildings are already linked", r.Method, r.URL.Path)
	}))
	defer server.Close()

	client := city2tabula.NewClient(server.URL)
	log := logrus.NewEntry(logrus.New())
	bbox := city2tabula.Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4}

	result := resolveEnvelope(context.Background(), log, client, "germany", bbox, topologyBuildings("111"))

	assert.Len(t, result, 1)
	assert.Contains(t, result, "111")
}

func TestBuildingOSMIDs_CollectsOnlyBasePOI(t *testing.T) {
	topology := []interface{}{
		map[string]interface{}{
			"from": map[string]interface{}{"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "111"}},
			"to":   map[string]interface{}{"properties": map[string]interface{}{"feature_type": "TopologyNode", "osm_id": "Trafo_1"}},
		},
		map[string]interface{}{
			"from": map[string]interface{}{"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "111"}}, // duplicate
		},
		map[string]interface{}{
			"from": map[string]interface{}{"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "222"}},
		},
	}

	ids := buildingOSMIDs(topology)
	assert.ElementsMatch(t, []string{"111", "222"}, ids)
}
