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
	assert.Equal(t, map[string][]string{
		"air_source_heat_pump": {"cont_energy_cap_max"},
		"battery_storage":      {"cont_storage_cap_max"},
	}, got[0].Techs)

	err := checkOperateSizes(topology)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "1 buildings have air_source_heat_pump, battery_storage without one (buildings b1)")
	assert.NoError(t, checkOperateSizes(topology[1:]))
}
