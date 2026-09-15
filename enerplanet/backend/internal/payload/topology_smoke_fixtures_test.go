package payload

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The smoke fixtures are the only committed data exercising the two branches
// of buildTopologyFromPylovoData, so they are read here directly rather than
// duplicated. A site whose buildings carry a grid_result_id with no matching
// transformer silently falls back to standalone nodes: the run still passes,
// but nothing builds a transformer node or assigns a building to one. That is
// invisible in every other test and in the smoke output itself.
const smokeFixtureDir = "../../scripts/smoke/"

// readFixture returns the parsed fixture, or skips when the file is a Git LFS
// pointer rather than its contents.
func readFixture(t *testing.T, name string) map[string]interface{} {
	t.Helper()
	b, err := os.ReadFile(smokeFixtureDir + name)
	require.NoError(t, err, "fixture %s missing", name)
	var m map[string]interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Skipf("%s is not readable as JSON (%v); run 'git lfs pull' to fetch the fixtures", name, err)
	}
	return m
}

// topologyShape counts the two kinds of entry buildTopologyFromPylovoData
// produces and collects the transformer nodes buildings were attached to.
func topologyShape(topology []interface{}) (connected, standalone int, nodes map[string]bool) {
	nodes = map[string]bool{}
	for _, entry := range topology {
		e, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		to, hasTo := e["to"].(map[string]interface{})
		if !hasTo {
			standalone++
			continue
		}
		connected++
		if props, ok := to["properties"].(map[string]interface{}); ok {
			if id, ok := props["osm_id"].(string); ok {
				nodes[id] = true
			}
		}
	}
	return connected, standalone, nodes
}

func gridIDs(t *testing.T, buildings map[string]interface{}) map[string]bool {
	t.Helper()
	ids := map[string]bool{}
	features, _ := buildings["features"].([]interface{})
	for _, f := range features {
		props := f.(map[string]interface{})["properties"].(map[string]interface{})
		gid, ok := getIntValue(props["grid_result_id"])
		require.True(t, ok, "every fixture building needs a grid_result_id")
		ids[fmt.Sprintf("Trafo_%d", gid)] = true
	}
	return ids
}

// TestTopologyFromSmokeFixtures asserts each site's buildings reach the
// transformer its fixture names. It fails if a fixture's grid_result_id and
// its transformer file drift apart, which downgrades the whole site to
// standalone nodes without any other signal.
func TestTopologyFromSmokeFixtures(t *testing.T) {
	for _, site := range []string{"loenen", "bremen"} {
		t.Run(site, func(t *testing.T) {
			buildings := readFixture(t, site+"_buildings.geojson")
			transformers := readFixture(t, site+"_transformers.geojson")
			nBuildings := len(buildings["features"].([]interface{}))

			connected, standalone, nodes := topologyShape(buildTopologyFromPylovoData(
				map[string]interface{}{"buildings": buildings, "transformers": transformers}, 1))

			assert.Equal(t, nBuildings, connected, "every building should hang off a transformer")
			assert.Zero(t, standalone, "no building should fall back to a standalone node")
			assert.Equal(t, gridIDs(t, buildings), nodes,
				"the transformer nodes built must be exactly those the buildings' grid_result_id names")
		})
	}
}

// TestTopologyWithoutTransformers asserts the other branch: without a
// transformer fixture every building is standalone, which is what the site
// silently degrades to when the two files disagree.
func TestTopologyWithoutTransformers(t *testing.T) {
	buildings := readFixture(t, "loenen_buildings.geojson")
	nBuildings := len(buildings["features"].([]interface{}))

	connected, standalone, nodes := topologyShape(buildTopologyFromPylovoData(
		map[string]interface{}{"buildings": buildings}, 1))

	assert.Zero(t, connected)
	assert.Equal(t, nBuildings, standalone)
	assert.Empty(t, nodes)
}
