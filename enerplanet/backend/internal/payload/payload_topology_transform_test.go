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

// A building edited in the configurator carries its BuEM building block under
// properties.buem, and run_buem reads it from the topology node, so it has to
// survive the copy like the per-building overrides above.
func TestCreateBuildingFeature_carriesStoredBuemBlock(t *testing.T) {
	stored := map[string]interface{}{"building": map[string]interface{}{"building_type": "MFH"}}
	building := map[string]interface{}{
		"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": map[string]interface{}{"osm_id": "1", "f_class": "apartments", "area": 100.0, "buem": stored},
	}

	props, _ := createBuildingFeature(building, 1, 99)["properties"].(map[string]interface{})

	assert.Equal(t, stored, props["buem"])
}

// The frontend saves its display estimate of heat demand with
// heat_demand_estimated set. That value is not user input, so the payload
// falls back to its own estimate instead of passing it on as given.
func TestCreateBuildingFeature_estimatedHeatDemandIsNotExplicit(t *testing.T) {
	newBuilding := func(props map[string]interface{}) map[string]interface{} {
		base := map[string]interface{}{"osm_id": "1", "f_class": "office", "area": 100.0}
		for k, v := range props {
			base[k] = v
		}
		return map[string]interface{}{
			"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
			"properties": base,
		}
	}
	heatOf := func(building map[string]interface{}) interface{} {
		props, _ := createBuildingFeature(building, 1, 99)["properties"].(map[string]interface{})
		return props["demand_heat"]
	}

	fallback := heatOf(newBuilding(nil))
	assert.Equal(t, int64(8000), fallback, "office at 80 kWh/m2 over 100 m2")

	estimated := newBuilding(map[string]interface{}{
		"demand_heat": 12345.0, "yearly_heat_demand_kwh": 12345.0, "heat_demand_estimated": true,
	})
	assert.Equal(t, fallback, heatOf(estimated), "an estimate saved by the frontend must not count as given")

	given := newBuilding(map[string]interface{}{
		"demand_heat": 12345.0, "yearly_heat_demand_kwh": 12345.0, "heat_demand_estimated": false,
	})
	assert.Equal(t, int64(12345), heatOf(given), "a user-entered heat demand is passed on")
}

// A building the user disabled in the configurator (activated: false) stays in
// the saved grid but must not reach the topology, which feeds BuEM and the
// simulation. Absent or true means the building takes part.
func TestIndexBuildingsByGrid_skipsDisabledBuildings(t *testing.T) {
	building := func(osmID string, props map[string]interface{}) interface{} {
		p := map[string]interface{}{"osm_id": osmID, "grid_result_id": 7.0, "area": 100.0}
		for k, v := range props {
			p[k] = v
		}
		return map[string]interface{}{
			"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
			"properties": p,
		}
	}

	byGrid := indexBuildingsByGrid([]interface{}{
		building("1", nil),
		building("2", map[string]interface{}{"activated": false}),
		building("3", map[string]interface{}{"activated": true}),
	})

	var osmIDs []interface{}
	for _, b := range byGrid[7] {
		osmIDs = append(osmIDs, b["properties"].(map[string]interface{})["osm_id"])
	}
	assert.Equal(t, []interface{}{"1", "3"}, osmIDs)
}
