package buem

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// resultBlock is a BuEM result block in the shape buem 6.10.0 returns with
// keep_timeseries set (geojson_processor.py builds thermal_load_profile).
const resultBlock = `{
  "building": {"building_type": "SFH"},
  "thermal_load_profile": {
    "start_time": "1900-01-01T00:00:00+00:00",
    "end_time": "1900-01-01T02:00:00+00:00",
    "resolution": "60",
    "resolution_unit": "minutes",
    "summary": {"heating": {"total": {"value": 3.5, "unit": "kWh"}}},
    "timeseries": {
      "unit": "kW",
      "kitchen_unit": "kW_gas",
      "timestamps": ["1900-01-01T00:00:00", "1900-01-01T01:00:00", "1900-01-01T02:00:00"],
      "heating": [1.0, 1.5, 1.0],
      "electricity": [0.25, 0.5, 0.25],
      "kitchen": [0, 0.75, 0],
      "hot_water": [],
      "cooling": null
    }
  },
  "model_metadata": {"model_version": "6.10.0", "model_commit": "21f79d7"}
}`

func TestParseResult_SplitsSeriesAndSummary(t *testing.T) {
	got, err := ParseResult(BuildingResult{ID: "268426401", BUEM: json.RawMessage(resultBlock)})
	require.NoError(t, err)

	assert.Equal(t, time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC), got.StartTime)
	assert.Equal(t, 60, got.ResolutionMinutes)
	assert.Equal(t, "6.10.0", got.Version)
	assert.Equal(t, "21f79d7", got.Commit)
	assert.Equal(t, ParsedSeries{Unit: "kW", Values: []float32{1.0, 1.5, 1.0}}, got.Series["heating"])
	assert.Equal(t, ParsedSeries{Unit: "kW_gas", Values: []float32{0, 0.75, 0}}, got.Series["kitchen"])
	assert.Len(t, got.Series, 3, "unit, kitchen_unit, timestamps and the empty or null series are not stored")

	var summary map[string]map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(got.Summary, &summary))
	assert.NotContains(t, summary["thermal_load_profile"], "timeseries")
	assert.Contains(t, summary["thermal_load_profile"], "summary")
}

func TestParseResult_HourResolution(t *testing.T) {
	block := `{"thermal_load_profile": {"start_time": "2018-01-01T00:00:00", "resolution": 1, "resolution_unit": "h",
		"timeseries": {"unit": "kW", "heating": [1]}}}`
	got, err := ParseResult(BuildingResult{ID: "b", BUEM: json.RawMessage(block)})
	require.NoError(t, err)
	assert.Equal(t, 60, got.ResolutionMinutes)
	assert.Equal(t, time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC), got.StartTime, "a zone-less start time is UTC")
}

func TestParseResult_Rejects(t *testing.T) {
	cases := map[string]BuildingResult{
		"error result":     {ID: "b", Error: "envelope missing"},
		"no timeseries":    {ID: "b", BUEM: json.RawMessage(`{"thermal_load_profile": {"start_time": "1900-01-01T00:00:00Z", "resolution": 60}}`)},
		"bad start time":   {ID: "b", BUEM: json.RawMessage(`{"thermal_load_profile": {"start_time": "soon", "resolution": 60, "timeseries": {"unit": "kW", "heating": [1]}}}`)},
		"bad resolution":   {ID: "b", BUEM: json.RawMessage(`{"thermal_load_profile": {"start_time": "1900-01-01T00:00:00Z", "resolution": "hourly", "timeseries": {"unit": "kW", "heating": [1]}}}`)},
		"unknown unit":     {ID: "b", BUEM: json.RawMessage(`{"thermal_load_profile": {"start_time": "1900-01-01T00:00:00Z", "resolution": 1, "resolution_unit": "day", "timeseries": {"unit": "kW", "heating": [1]}}}`)},
		"series w/o unit":  {ID: "b", BUEM: json.RawMessage(`{"thermal_load_profile": {"start_time": "1900-01-01T00:00:00Z", "resolution": 60, "timeseries": {"heating": [1]}}}`)},
		"empty timeseries": {ID: "b", BUEM: json.RawMessage(`{"thermal_load_profile": {"start_time": "1900-01-01T00:00:00Z", "resolution": 60, "timeseries": {"unit": "kW"}}}`)},
	}
	for name, r := range cases {
		_, err := ParseResult(r)
		assert.Error(t, err, name)
	}
}
