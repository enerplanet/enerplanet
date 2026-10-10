package resultservice

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// makeMemeTimestamps builds n hourly RFC3339 timestamps (parseTimestamp accepts
// them), standing in for the Calliope leg's 73-step series.
func makeMemeTimestamps(n int) []string {
	base := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	out := make([]string, n)
	for i := range out {
		out[i] = base.Add(time.Duration(i) * time.Hour).Format(time.RFC3339)
	}
	return out
}

// energy_cap + loc_techs are normalised into the legacy vocabulary
// using the shared MEME rules — demand -> <loc>_demand, grid import ->
// transformer_supply, grid export omitted, and the two per-endpoint
// transmission capacities paired into ONE power_transmission row with a ToLoc.
func TestMapCoatiDocument_NormalisesEnergyCapAndLocTechs(t *testing.T) {
	doc := &CoatiResultsDocument{
		Capacities: map[string]float64{
			"n1::demand_1":             5.0,
			"n1::grid_n1_import":       300.0,
			"n1::grid_n1_export":       100.0,
			"n1::pv_supply_1":          10.0,
			"n1::lv_1_trafo_82":        200.0,
			"ntrafo_82::lv_1_trafo_82": 200.0,
		},
		TechMetadata: map[string]CoatiTechMetadata{
			"demand_1":       {Parent: "demand"},
			"grid_n1_import": {Parent: "supply"},
			"grid_n1_export": {Parent: "supply"},
			"pv_supply_1":    {Parent: "supply"},
			"lv_1_trafo_82":  {Parent: "transmission"},
		},
	}

	parsed, err := mapCoatiDocument(doc)
	require.NoError(t, err)

	// One row per emitted tech: demand, grid import, pv, and ONE wire (the two
	// per-endpoint transmission capacities are paired). Export is omitted.
	// VALUES are MW in the document and kW in the R2 contract -> scaled ×1000.
	require.Len(t, parsed.EnergyCap, 4)

	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n1", Tech: "n1_demand", Value: 5000.0})
	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n1", Tech: "transformer_supply", Value: 300000.0})
	assert.Contains(t, parsed.EnergyCap, EnergyCap{Location: "n1", Tech: "pv_supply_1", Value: 10000.0})
	assert.Contains(t, parsed.EnergyCap,
		EnergyCap{Location: "n1", Tech: "power_transmission", ToLoc: "ntrafo_82", Value: 200000.0})

	for _, ec := range parsed.EnergyCap {
		assert.NotContains(t, ec.Tech, "grid_", "grid import/export must be rewritten or omitted")
		assert.NotContains(t, ec.Tech, "lv_", "raw wire names must be normalised")
		assert.NotEqual(t, "demand_1", ec.Tech, "demand must carry the _demand suffix")
	}

	// The wire is registered at BOTH endpoints as power_transmission:<other>.
	assert.ElementsMatch(t,
		[]string{"n1_demand", "transformer_supply", "pv_supply_1", "power_transmission:ntrafo_82"},
		parsed.LocTechs["n1"])
	assert.ElementsMatch(t, []string{"power_transmission:n1"}, parsed.LocTechs["ntrafo_82"])
}

// A transmission tech with != 2 endpoints still emits power_transmission, but
// with no honest remote endpoint to name.
func TestMapCoatiDocument_TransmissionWithAmbiguousEndpoints(t *testing.T) {
	doc := &CoatiResultsDocument{
		Capacities: map[string]float64{
			"n1::odd_wire": 42.0,
		},
		TechMetadata: map[string]CoatiTechMetadata{
			"odd_wire": {Parent: "transmission"},
		},
	}

	parsed, err := mapCoatiDocument(doc)
	require.NoError(t, err)
	require.Len(t, parsed.EnergyCap, 1)
	assert.Equal(t, "power_transmission", parsed.EnergyCap[0].Tech)
	assert.Empty(t, parsed.EnergyCap[0].ToLoc)
	assert.Equal(t, "n1", parsed.EnergyCap[0].Location)
	assert.ElementsMatch(t, []string{"power_transmission"}, parsed.LocTechs["n1"])
}

// The selector rejects a degenerate 1-step / ['now'] document and
// picks the parseable, multi-step one — regardless of which framework it is.
func TestSelectWireDocumentPrefersTheParseableMultiStepLeg(t *testing.T) {
	degenerate := &CoatiResultsDocument{
		Timestamps: []string{"now"},
		TransmissionFlow: map[string]CoatiTransmission{
			"n1::n2": {From: "n1", To: "n2", Timeseries: []float64{100}},
		},
	}
	good := &CoatiResultsDocument{
		Timestamps: makeMemeTimestamps(73),
		TransmissionFlow: map[string]CoatiTransmission{
			"n1::n2": {From: "n1", To: "n2", Timeseries: make([]float64, 73)},
		},
	}

	assert.False(t, wireDocQualifies(degenerate), "1-step ['now'] doc must not qualify")
	assert.True(t, wireDocQualifies(good), "73-step parseable doc must qualify")

	doc, leg, reason := selectWireDocument(degenerate, good)
	assert.Equal(t, "calliope", leg)
	assert.Same(t, good, doc)
	assert.NotEmpty(t, reason, "the choice is explained, never silent")
}

// With only the degenerate leg, the selector falls back to it without error.
func TestSelectWireDocumentFallsBackToDegenerateLegWithoutError(t *testing.T) {
	degenerate := &CoatiResultsDocument{
		Timestamps: []string{"now"},
		TransmissionFlow: map[string]CoatiTransmission{
			"n1::n2": {From: "n1", To: "n2", Timeseries: []float64{100}},
		},
	}

	doc, leg, reason := selectWireDocument(nil, degenerate)
	require.NotNil(t, doc)
	assert.Same(t, degenerate, doc)
	assert.Equal(t, "calliope", leg)
	assert.NotEmpty(t, reason)
}

// Among QUALIFYING legs the PyPSA preference is preserved (it is the
// electricity transport model); only a degenerate PyPSA leg is skipped.
func TestSelectWireDocumentPrefersPyPSAWhenBothQualify(t *testing.T) {
	pypsa := &CoatiResultsDocument{
		Timestamps: makeMemeTimestamps(2),
		TransmissionFlow: map[string]CoatiTransmission{
			"n1::n2": {From: "n1", To: "n2", Timeseries: []float64{1, 2}},
		},
	}
	calliope := &CoatiResultsDocument{
		Timestamps: makeMemeTimestamps(73),
		TransmissionFlow: map[string]CoatiTransmission{
			"n1::n2": {From: "n1", To: "n2", Timeseries: make([]float64, 73)},
		},
	}

	doc, leg, _ := selectWireDocument(pypsa, calliope)
	assert.Equal(t, "pypsa", leg)
	assert.Same(t, pypsa, doc)
}
