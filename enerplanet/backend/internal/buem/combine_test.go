package buem

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// summaryOf decodes the statistics of one carrier from a result block.
func summaryOf(t *testing.T, block json.RawMessage, carrier string) map[string]float64 {
	t.Helper()
	var b struct {
		ThermalLoadProfile struct {
			Summary map[string]map[string]struct {
				Value float64 `json:"value"`
			} `json:"summary"`
		} `json:"thermal_load_profile"`
	}
	require.NoError(t, json.Unmarshal(block, &b))
	out := map[string]float64{}
	for stat, v := range b.ThermalLoadProfile.Summary[carrier] {
		out[stat] = v.Value
	}
	return out
}

// Two houses of a terraced row: the way's series are their sums and its
// statistics are recomputed from the sums, not added.
func TestCombineResults_sumsSeriesAndRecomputesStatistics(t *testing.T) {
	withStats := strings.Replace(resultBlock, `"summary": {"heating": {"total": {"value": 3.5, "unit": "kWh"}}}`,
		`"summary": {"heating": {"total": {"value": 3.5, "unit": "kWh"}, "max": {"value": 1.5, "unit": "kW"}, "std": {"value": 0, "unit": "kW"}}}`, 1)
	second := strings.Replace(withStats, `"heating": [1.0, 1.5, 1.0]`, `"heating": [2.0, 0.5, 1.0]`, 1)

	got, err := CombineResults("1001832407", []BuildingResult{
		{ID: "1001832407#DEBY_A", BUEM: json.RawMessage(withStats)},
		{ID: "1001832407#DEBY_B", BUEM: json.RawMessage(second)},
	})
	require.NoError(t, err)
	assert.Equal(t, "1001832407", got.ID)

	parsed, err := ParseResult(got)
	require.NoError(t, err)
	assert.Equal(t, []float32{3, 2, 2}, parsed.Series["heating"].Values)
	assert.Equal(t, []float32{0.5, 1, 0.5}, parsed.Series["electricity"].Values)

	stats := summaryOf(t, got.BUEM, "heating")
	assert.InDelta(t, 7.0, stats["total"], 1e-9, "3+2+2 kW over hourly steps")
	assert.InDelta(t, 3.0, stats["max"], 1e-9)
	assert.InDelta(t, 0.4714, stats["std"], 1e-4, "population deviation of 3, 2, 2")
	assert.Equal(t, "6.10.0", parsed.Version, "metadata comes from the first part")
}

// Parts on different steps cannot be added; the way fails rather than mixing them.
func TestCombineResults_rejectsDifferentResolutions(t *testing.T) {
	quarter := strings.Replace(resultBlock, `"resolution": "60"`, `"resolution": "15"`, 1)
	_, err := CombineResults("w", []BuildingResult{
		{ID: "w#a", BUEM: json.RawMessage(resultBlock)},
		{ID: "w#b", BUEM: json.RawMessage(quarter)},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "every 15 min")
}

// A part BuEM rejected fails the combination, so the way is not undercounted.
func TestCombineResults_failsOnAPartError(t *testing.T) {
	_, err := CombineResults("w", []BuildingResult{
		{ID: "w#a", BUEM: json.RawMessage(resultBlock)},
		{ID: "w#b", Error: "no envelope surfaces"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "w#b")
}

// A series one part lacks counts as zero there.
func TestSumSeries_missingSeriesCountsAsZero(t *testing.T) {
	got, err := SumSeries([]map[string][]float64{
		{"heating": {1, 2}},
		{"heating": {1, 1}, "cooling": {0.5, 0}},
	})
	require.NoError(t, err)
	assert.Equal(t, map[string][]float64{"heating": {2, 3}, "cooling": {0.5, 0}}, got)

	_, err = SumSeries([]map[string][]float64{{"heating": {1, 2}}, {"heating": {1}}})
	assert.Error(t, err)
}
