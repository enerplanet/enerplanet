package jobs

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func operateBuilding(osmID string, techs map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{"properties": map[string]interface{}{"osm_id": osmID}, "techs": techs}
}

func TestUnsizedBuildings(t *testing.T) {
	topology := []interface{}{
		map[string]interface{}{"from": operateBuilding("b1", map[string]interface{}{
			"air_source_heat_pump": map[string]interface{}{"cont_energy_cap_max": "inf"},
			"battery_storage":      map[string]interface{}{"cont_energy_cap_max": 10.0, "cont_storage_cap_max": math.Inf(1)},
			"gas_supply":           map[string]interface{}{"cont_energy_cap_max": "inf"},
		})},
		map[string]interface{}{"from": operateBuilding("b2", map[string]interface{}{
			"gas_boiler":      map[string]interface{}{"cont_energy_cap_max": "15"},
			"air_conditioner": map[string]interface{}{"cont_energy_cap_max": 8},
			"pv_arrays":       []interface{}{map[string]interface{}{"cont_energy_cap_max": 6.4}},
		})},
	}

	got := unsizedBuildings(topology)
	require.Len(t, got, 1)
	assert.Equal(t, "b1", got[0].OSMID)
	assert.Equal(t, map[string][]string{"battery_storage": {"cont_storage_cap_max"}}, got[0].Techs,
		"an unsized heat pump is sized by sizeHeatTechs, not refused")

	err := checkOperateSizes(topology)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "battery_storage have none on 1 of the model's buildings (b1)")
	assert.NoError(t, checkOperateSizes(topology[1:]))
}

func heatBuilding(osmID string, heat []float64, techs map[string]interface{}) map[string]interface{} {
	props := map[string]interface{}{"osm_id": osmID, "demand_series": map[string]interface{}{"heat": heat}}
	return map[string]interface{}{"properties": props, "techs": techs}
}

// SC-16: an unsized boiler of efficiency 0.9 is sized to deliver the 24.4 kW peak, a
// heat pump to the peak itself, and a user-sized 18 kW boiler refuses the run.
func TestSizeHeatTechs(t *testing.T) {
	boiler := map[string]interface{}{"cont_energy_cap_max": "Infinity", "cont_energy_eff": 0.9}
	pump := map[string]interface{}{"cont_energy_cap_max": math.Inf(1), "cont_energy_eff": 3.3}
	sized := []interface{}{map[string]interface{}{"from": heatBuilding("b1", []float64{10, 24.3652, 5},
		map[string]interface{}{"gas_boiler": boiler, "air_source_heat_pump": pump})}}

	require.NoError(t, sizeHeatTechs(sized))
	assert.Equal(t, 27.1, boiler["cont_energy_cap_max"])
	assert.Equal(t, 24.4, pump["cont_energy_cap_max"])
	assert.NoError(t, checkOperateSizes(sized))

	userSized := map[string]interface{}{"cont_energy_cap_max": "18", "cont_energy_eff": 0.9}
	short := []interface{}{map[string]interface{}{"from": heatBuilding("b2", []float64{24.3652},
		map[string]interface{}{"gas_boiler": userSized})}}
	err := sizeHeatTechs(short)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "b2 (peak 24.4 kW, delivers 16.2 kW)")
	assert.Equal(t, "18", userSized["cont_energy_cap_max"], "a user's size is kept")
}
