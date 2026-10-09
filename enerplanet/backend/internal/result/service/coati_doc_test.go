package resultservice

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// coatiFixtureJSON mirrors the shape of a real Coati results document (schema
// 1.0), trimmed to the fields the Coati ingest maps, modelled on real Calliope
// output.
const coatiFixtureJSON = `{
  "schema_version": "1.0",
  "framework": "calliope",
  "framework_version": "0.7.0.dev7",
  "model_name": null,
  "solver": "cbc",
  "success": true,
  "termination_condition": "optimal",
  "objective": 58179.03278660153,
  "objective_function_value": 58179.03278660153,
  "timestamps": ["2025-01-01T00:00:00", "2025-01-01T03:00:00", "2025-01-01T06:00:00"],
  "coordinates": {"n1": [48.8, 12.9], "n2": [49.0, 13.2]},
  "capacities": {"n1::battery": 12.026172, "n1::chp": 100.0, "n2::line1": 200.0},
  "storage_capacities": {"n1::battery": 52.462265},
  "generation": {"n1::battery::electricity": 59.31, "n1::chp::electricity": 960.0},
  "dispatch": {"battery": [1.0, 2.0], "chp": [3.0, 4.0]},
  "demand_timeseries": [5.0, 6.0],
  "costs_by_location": {"n1": {"battery": 786.0, "chp": 27869.4}},
  "costs_by_tech": {"battery": 786.0},
  "total_unmet_demand": null,
  "warnings": [],
  "metadata": {}
}`

func TestMapCoatiDocument_MapsSmallTables(t *testing.T) {
	var doc CoatiResultsDocument
	require.NoError(t, json.Unmarshal([]byte(coatiFixtureJSON), &doc))

	parsed, err := mapCoatiDocument(&doc)
	require.NoError(t, err)

	// Coordinates -> loc -> [x, y]
	assert.Equal(t, Coordinate{X: 48.8, Y: 12.9}, parsed.Coordinates["n1"])
	assert.Equal(t, Coordinate{X: 49.0, Y: 13.2}, parsed.Coordinates["n2"])

	// capacities + storage capacities -> results_energy_cap, and every key
	// registers the loc-tech pair. POWER capacities (flow_cap, MW) are scaled
	// MW -> kW (the unit of the result tables); storage ENERGY capacity (MWh) is not power
	// and stays unscaled.
	assert.Len(t, parsed.EnergyCap, 4, "3 capacities + 1 storage capacity")
	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n1", Tech: "battery", Value: 12026.172})
	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n1", Tech: "battery", Value: 52.462265}) // storage (kWh, not scaled)
	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n2", Tech: "line1", Value: 200000.0})
	assert.ElementsMatch(t, []string{"battery", "chp"}, parsed.LocTechs["n1"])
	assert.Equal(t, []string{"line1"}, parsed.LocTechs["n2"])

	// costs_by_location -> results_cost with the monetary cost class.
	assert.Len(t, parsed.Cost, 2)
	assert.Contains(t, parsed.Cost, CostRecord{FromLocation: "n1", Costs: "monetary", Techs: "battery", Value: 786.0})
	assert.Contains(t, parsed.Cost, CostRecord{FromLocation: "n1", Costs: "monetary", Techs: "chp", Value: 27869.4})
	// Large series are not mapped.
	assert.Empty(t, parsed.CapacityFactor)
	assert.Empty(t, parsed.CarrierProd)
	assert.Empty(t, parsed.CarrierCon)
}

func TestMapCoatiDocument_UnmappedSuccessfulGrade(t *testing.T) {
	var doc CoatiResultsDocument
	require.NoError(t, json.Unmarshal([]byte(coatiFixtureJSON), &doc))

	assert.True(t, doc.doesCoatiSucceed(), "success=true should grade as succeeded")
	assert.Equal(t, "optimal", *doc.TerminationCondition)

	sum := buildCoatiSummary(&doc)
	require.NotNil(t, sum)
	assert.Equal(t, "calliope", sum.Framework)
	assert.Equal(t, "0.7.0.dev7", sum.FrameworkVersion)
	assert.True(t, sum.Success)
	assert.Equal(t, "optimal", sum.TerminationCondition)
	assert.True(t, sum.Objective != nil)
	assert.Equal(t, 3, sum.EnergyCapCount)     // capacities only
	assert.Equal(t, 1, sum.StorageCapCount)
	assert.Equal(t, 2, sum.LocationCount)
	// Non-finite (null) values survive as pointers without error.
	assert.Nil(t, sum.TotalUnmetDemand)
}

func TestMapCoatiDocument_CostsFallbackToSystemwide(t *testing.T) {
	var doc CoatiResultsDocument
	require.NoError(t, json.Unmarshal([]byte(coatiFixtureJSON), &doc))
	doc.CostsByLocation = nil // no per-location breakdown

	parsed, err := mapCoatiDocument(&doc)
	require.NoError(t, err)
	require.Len(t, parsed.Cost, 1)
	assert.Equal(t, CostRecord{Costs: "monetary", Techs: "battery", Value: 786.0}, parsed.Cost[0])
}

// The mapping boundary writes POWER in kW (document MW ×1000) while
// leaving storage ENERGY (kWh) and currencies unscaled. The spec's worked
// example: a 0.0025 MW demand is written as 2.5 kW.
func TestMapCoatiDocument_ScalesPowerNotStorageOrCost(t *testing.T) {
	doc := &CoatiResultsDocument{
		Capacities: map[string]float64{
			"n1::demand_1":    0.0025, // MW -> 2.5 kW
			"n1::pv_supply_1": 0.5,    // MW -> 500 kW
		},
		StorageCapacities: map[string]float64{
			"n1::battery": 8.0, // kWh of energy -> UNCHANGED
		},
		TechMetadata: map[string]CoatiTechMetadata{
			"demand_1":    {Parent: "demand"},
			"pv_supply_1": {Parent: "supply"},
			"battery":     {Parent: "storage"},
		},
		CostsByLocation: map[string]map[string]float64{"n1": {"pv_supply_1": 42.0}},
	}

	parsed, err := mapCoatiDocument(doc)
	require.NoError(t, err)

	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n1", Tech: "n1_demand", Value: 2.5})
	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n1", Tech: "pv_supply_1", Value: 500})
	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n1", Tech: "battery", Value: 8.0},
		"storage energy capacity is MWh/kWh, not power: must not be scaled")
	assert.Contains(t, parsed.Cost, CostRecord{FromLocation: "n1", Costs: "monetary", Techs: "pv_supply_1", Value: 42.0},
		"currency must not be scaled")
}