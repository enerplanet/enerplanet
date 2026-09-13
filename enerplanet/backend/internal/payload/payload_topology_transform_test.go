package payload

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Every per-building property run_buem reads has to survive the topology
// transform. A key left out of createBuildingFeature's property list is
// dropped without an error and the archetype value stands in its place, so
// the failure looks like a plausible result rather than a fault.
func TestCreateBuildingFeature_carriesPerBuildingOverrides(t *testing.T) {
	building := map[string]interface{}{
		"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": map[string]interface{}{
			"osm_id": "268426401", "f_class": "detached", "area": 120.0,
			"construction_year": 1975.0, "refurbishment_level": "advanced",
			"cooking_carrier": "gas", "include_dhw": false, "capacity": 4.0,
			"window_to_wall_ratio": 0.25, "window_U": 0.9, "window_g_gl": 0.6, "door_U": 1.4,
		},
	}

	feature := createBuildingFeature(building, 1, 99)
	props, ok := feature["properties"].(map[string]interface{})
	if !ok {
		t.Fatal("feature has no properties map")
	}

	for key, want := range map[string]interface{}{
		"construction_year": 1975.0, "refurbishment_level": "advanced",
		"cooking_carrier": "gas", "include_dhw": false, "capacity": 4.0,
		"window_to_wall_ratio": 0.25, "window_U": 0.9, "window_g_gl": 0.6, "door_U": 1.4,
	} {
		assert.Equal(t, want, props[key], "%s must reach the topology node", key)
	}
}

// A building with none of the optional overrides set carries them as nil
// rather than as a zero value, which is what lets run_buem tell "not set"
// from "set to zero".
func TestCreateBuildingFeature_absentOverridesStayNil(t *testing.T) {
	building := map[string]interface{}{
		"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": map[string]interface{}{"osm_id": "1", "f_class": "detached", "area": 100.0},
	}

	props, _ := createBuildingFeature(building, 1, 99)["properties"].(map[string]interface{})
	for _, key := range []string{"window_to_wall_ratio", "window_U", "window_g_gl", "door_U", "capacity"} {
		assert.Nil(t, props[key], "%s must be nil when the user set nothing", key)
	}
}
