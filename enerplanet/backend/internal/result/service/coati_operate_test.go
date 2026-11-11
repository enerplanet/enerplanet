package resultservice

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const operateJob = `{"experiment":{"mode":"operate"},"model":{"technologies":{
	"pv_supply_1_0":{"node":"n1","capacity":{"max":0.0024}},
	"gas_boiler_1":{"node":"n1","capacity":{"max":0.0271}},
	"battery_storage_1":{"node":"n1","capacity":{"max":0.01},"storage":{"energy_capacity":{"max":0.02}}},
	"gas_1_import":{"node":"n1"}}}}`

// An operate result reports no capacities; the dashboard's capacity chart then
// showed no PV. The sizes come from the job the run was given.
func TestFillOperateCapacities(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "config.json"), []byte(operateJob), 0o600))

	doc := CoatiResultsDocument{}
	require.NoError(t, fillOperateCapacities(&doc, dir))
	assert.Equal(t, map[string]float64{"n1::pv_supply_1_0": 0.0024, "n1::gas_boiler_1": 0.0271, "n1::battery_storage_1": 0.01}, doc.Capacities)
	assert.Equal(t, map[string]float64{"n1::battery_storage_1": 0.02}, doc.StorageCapacities)

	parsed, err := mapCoatiDocument(&doc)
	require.NoError(t, err)
	assert.NotEmpty(t, parsed.EnergyCap, "the capacities reach the result tables")

	planned := CoatiResultsDocument{Capacities: map[string]float64{"n1::pv_supply_1_0": 0.008}}
	require.NoError(t, fillOperateCapacities(&planned, dir))
	assert.Equal(t, map[string]float64{"n1::pv_supply_1_0": 0.008}, planned.Capacities, "a solved capacity is kept")
}
