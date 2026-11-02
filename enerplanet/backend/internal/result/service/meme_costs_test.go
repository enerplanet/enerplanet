package resultservice

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An operate export: Calliope repeats each 2-step horizon's total cost (30) on
// both kept steps, while the variable-cost table holds each step's own cost.
func newOperateCostDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	writeMemeCSV(t, dir, "results_cost.csv",
		"timesteps,nodes,techs,costs,cost\n"+
			"2023-03-06 00:00:00,ntrafo_1,grid_trafo_1_import,monetary,30\n"+
			"2023-03-06 01:00:00,ntrafo_1,grid_trafo_1_import,monetary,30\n")
	writeMemeCSV(t, dir, "results_cost_operation_variable.csv",
		"nodes,techs,costs,timesteps,cost_operation_variable\n"+
			"ntrafo_1,grid_trafo_1_import,monetary,2023-03-06 00:00:00,10\n"+
			"ntrafo_1,grid_trafo_1_import,monetary,2023-03-06 01:00:00,5\n"+
			"n1,gas_1_import,monetary,2023-03-06 00:00:00,2\n")
	return dir
}

func TestCalliopeCosts_sumsTheStepCostsOfAnOperateRun(t *testing.T) {
	costs, investment, ok, err := calliopeCosts(newOperateCostDir(t))

	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, []CostRecord{
		{FromLocation: "n1", Costs: "monetary", Techs: "gas_1_import", Value: 2},
		{FromLocation: "ntrafo_1", Costs: "monetary", Techs: "grid_trafo_1_import", Value: 15},
	}, costs)
	assert.Empty(t, investment)
}

func TestCalliopeCosts_addsInvestmentAndFixedCostOfAPlanRun(t *testing.T) {
	dir := t.TempDir()
	writeMemeCSV(t, dir, "results_cost_operation_variable.csv",
		"nodes,techs,costs,timesteps,cost_operation_variable\n"+
			"n1,gas_boiler_1,monetary,2023-03-06 00:00:00,4\n")
	writeMemeCSV(t, dir, "results_cost_operation_fixed.csv",
		"nodes,techs,costs,cost_operation_fixed\n"+
			"n1,gas_boiler_1,monetary,1\n")
	writeMemeCSV(t, dir, "results_cost_investment_annualised.csv",
		"nodes,techs,costs,cost_investment_annualised\n"+
			"n1,gas_boiler_1,monetary,60\n")

	costs, investment, ok, err := calliopeCosts(dir)

	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, []CostRecord{{FromLocation: "n1", Costs: "monetary", Techs: "gas_boiler_1", Value: 65}}, costs)
	assert.Equal(t, []CostInvestmentRecord{{Location: "n1", Costs: "monetary", Tech: "gas_boiler_1", Value: 60}}, investment)
}

func TestCalliopeCosts_leavesAnExportWithoutStepCostsToCoati(t *testing.T) {
	_, _, ok, err := calliopeCosts(t.TempDir())

	require.NoError(t, err)
	assert.False(t, ok)
}
