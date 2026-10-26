package meme

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sizeJob builds a job with the given numbers of plain and conversion
// technologies, lines, trades with an import, trades with an export, and a
// series of steps values.
func sizeJob(t *testing.T, plain, conversion, lines, imports, exports, steps int) []byte {
	t.Helper()
	techs := map[string]any{}
	for i := range plain {
		techs[fmt.Sprintf("demand_%d", i)] = map[string]any{"role": "demand"}
	}
	for i := range conversion {
		techs[fmt.Sprintf("gas_boiler_%d", i)] = map[string]any{"role": "conversion", "carrier_in": "natural_gas", "carrier_out": "heat"}
	}
	lineMap := map[string]any{}
	for i := range lines {
		lineMap[fmt.Sprintf("lv_%d", i)] = map[string]any{"from": "n1", "to": "n2"}
	}
	trade := map[string]any{}
	for i := range max(imports, exports) {
		tr := map[string]any{"carrier": "electricity"}
		if i < imports {
			tr["import"] = map[string]any{"price": 300}
		}
		if i < exports {
			tr["export"] = map[string]any{}
		}
		trade[fmt.Sprintf("trade_%d", i)] = tr
	}
	job, err := json.Marshal(map[string]any{"model": map[string]any{
		"technologies": techs,
		"transmission": lineMap,
		"trade":        trade,
		"timeseries":   map[string]any{"demand_0": map[string]any{"values": make([]float64, steps)}},
	}})
	require.NoError(t, err)
	return job
}

// The two shapes Calliope logged: 29 combinations for a five-building model
// with PV and batteries, 115 for a fifteen-building model with gas boilers.
func TestEstimateSize_MatchesCalliopesCombinationCount(t *testing.T) {
	small, err := EstimateSize(sizeJob(t, 17, 0, 5, 1, 1, 8784))
	require.NoError(t, err)
	assert.Equal(t, 29, small.Combinations)
	assert.Equal(t, 8784, small.Timesteps)
	assert.InDelta(t, 2500, small.MemoryMB, 100, "first measured run: 2.5 GB")

	large, err := EstimateSize(sizeJob(t, 30, 15, 17, 18, 3, 8760))
	require.NoError(t, err)
	assert.Equal(t, 115, large.Combinations)
	assert.InDelta(t, 7960, large.MemoryMB, 100, "second measured run: 7.96 GB")
}

func TestEstimateSize_ScalesWithTimesteps(t *testing.T) {
	week, err := EstimateSize(sizeJob(t, 30, 15, 17, 18, 3, 168))
	require.NoError(t, err)
	assert.Less(t, week.MemoryMB, 1000, "a week of the large model stays near the base")
}

func TestEstimateSize_RejectsAnUnreadableJob(t *testing.T) {
	_, err := EstimateSize([]byte("not json"))
	require.Error(t, err)
}
