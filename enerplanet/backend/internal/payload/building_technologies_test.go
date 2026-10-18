package payload

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// A heat technology from OpenTech-DB arrives with capacity bounds and a
// lifetime only. The missing efficiency and costs come from the defaults;
// a value the user set wins.
func TestExtractAndTransformTechs_fillsMissingTechnologyParameters(t *testing.T) {
	props := map[string]interface{}{"techs": map[string]interface{}{
		"air_source_heat_pump": map[string]interface{}{"constraints": []interface{}{
			map[string]interface{}{"key": "cont_energy_cap_max", "value": "INF"},
			map[string]interface{}{"key": "cont_lifetime", "value": 20.0},
		}},
		"pv_supply": map[string]interface{}{"cont_energy_cap_max": 8.0},
	}}

	techs, ok := extractAndTransformTechs(props).(map[string]interface{})
	if !ok {
		t.Fatalf("techs = %#v", extractAndTransformTechs(props))
	}
	hp := techs["air_source_heat_pump"].(map[string]interface{})
	assert.Equal(t, 3.33, hp["cont_energy_eff"], "COP from the defaults")
	assert.Equal(t, 900.0, hp["cost_energy_cap"])
	assert.Equal(t, 0.1, hp["cost_interest_rate"])
	assert.Equal(t, 20.0, hp["cont_lifetime"], "the user's lifetime wins over the default 18")
	assert.Equal(t, map[string]interface{}{"cont_energy_cap_max": 8.0}, techs["pv_supply"], "a technology without defaults is unchanged")
}

func TestDefaultTechnology_isACopy(t *testing.T) {
	gas := DefaultTechnology("gas_supply")
	assert.Equal(t, 0.04, gas["cost_om_con"])
	gas["cost_om_con"] = 1.0
	assert.Equal(t, 0.04, DefaultTechnology("gas_supply")["cost_om_con"], "callers must not change the defaults")
	assert.Nil(t, DefaultTechnology("pv_supply"))
}

func TestDefaultTechnology_leavesOutTheSourceNote(t *testing.T) {
	assert.NotContains(t, DefaultTechnology("air_conditioner"), "_source")
	techs := map[string]interface{}{"gas_boiler": map[string]interface{}{}}
	fillTechnologyDefaults(techs)
	assert.NotContains(t, techs["gas_boiler"], "_source")
	assert.Equal(t, 0.9, techs["gas_boiler"].(map[string]interface{})["cont_energy_eff"])
}

func TestExtractAndTransformTechs_dropsUnsupportedTechnologies(t *testing.T) {
	props := map[string]interface{}{"techs": map[string]interface{}{
		"wind_onshore":      map[string]interface{}{"cont_energy_cap_max": 50.0},
		"households_supply": map[string]interface{}{"cost_om_con": 0.39},
		"battery_storage":   map[string]interface{}{"cont_energy_cap_max": 5.0},
	}}

	techs := extractAndTransformTechs(props).(map[string]interface{})
	assert.Equal(t, []string{"battery_storage"}, keys(techs))
}

func keys(m map[string]interface{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestExtractAndTransformTechs_keepsPVArrays(t *testing.T) {
	arrays := []interface{}{map[string]interface{}{"surface_id": "r1", "usable_share": 0.8}}
	props := map[string]interface{}{"techs": map[string]interface{}{
		"pv_supply": map[string]interface{}{
			"constraints": []interface{}{map[string]interface{}{"key": "cost_energy_cap", "value": 575.0}},
			"arrays":      arrays,
		},
	}}

	pv := extractAndTransformTechs(props).(map[string]interface{})["pv_supply"].(map[string]interface{})
	assert.Equal(t, 575.0, pv["cost_energy_cap"])
	assert.Equal(t, arrays, pv["arrays"])
}
