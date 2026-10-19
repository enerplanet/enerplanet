package buem

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
)

// SumSeries adds series element-wise, name by name. A series missing from one
// part counts as zero there; series of one name must have the same length.
func SumSeries(parts []map[string][]float64) (map[string][]float64, error) {
	sum := map[string][]float64{}
	for i, part := range parts {
		for name, values := range part {
			acc, ok := sum[name]
			if !ok {
				sum[name] = slices.Clone(values)
				continue
			}
			if len(acc) != len(values) {
				return nil, fmt.Errorf("series %s of part %d has %d values, the others %d", name, i, len(values), len(acc))
			}
			for j, v := range values {
				acc[j] += v
			}
		}
	}
	return sum, nil
}

// SetSummaryStats rewrites the statistics of block's
// thermal_load_profile.summary.<name> from series[name], computed as BuEM
// computes them: total is the sum of the values times the step in hours, std
// the population standard deviation. A summary entry without a series, and
// every other field of block, stay as they are.
func SetSummaryStats(block json.RawMessage, series map[string][]float64, resolutionMinutes int) (json.RawMessage, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(block, &top); err != nil {
		return nil, fmt.Errorf("decode result block: %w", err)
	}
	var profile map[string]json.RawMessage
	if err := json.Unmarshal(top["thermal_load_profile"], &profile); err != nil {
		return nil, fmt.Errorf("decode thermal_load_profile: %w", err)
	}
	var summary map[string]map[string]map[string]any
	if err := json.Unmarshal(profile["summary"], &summary); err != nil {
		return nil, fmt.Errorf("decode summary: %w", err)
	}
	for name, stats := range summary {
		values, ok := series[name]
		if !ok || len(values) == 0 {
			continue
		}
		for stat, value := range seriesStats(values, resolutionMinutes) {
			if entry, ok := stats[stat]; ok {
				entry["value"] = value
			}
		}
	}
	var err error
	if profile["summary"], err = json.Marshal(summary); err != nil {
		return nil, fmt.Errorf("encode summary: %w", err)
	}
	if top["thermal_load_profile"], err = json.Marshal(profile); err != nil {
		return nil, fmt.Errorf("encode thermal_load_profile: %w", err)
	}
	return json.Marshal(top)
}

// seriesStats returns BuEM's summary statistics of one series.
func seriesStats(values []float64, resolutionMinutes int) map[string]float64 {
	sorted := slices.Sorted(slices.Values(values))
	var sum float64
	for _, v := range values {
		sum += v
	}
	mean := sum / float64(len(values))
	var squares float64
	for _, v := range values {
		squares += (v - mean) * (v - mean)
	}
	median := sorted[len(sorted)/2]
	if len(sorted)%2 == 0 {
		median = (sorted[len(sorted)/2-1] + sorted[len(sorted)/2]) / 2
	}
	return map[string]float64{
		"total":  sum * float64(resolutionMinutes) / 60,
		"mean":   mean,
		"median": median,
		"min":    sorted[0],
		"max":    sorted[len(sorted)-1],
		"std":    math.Sqrt(squares / float64(len(values))),
	}
}

// CombineResults sums the BuEM results of the 3D buildings one OSM way
// covers into one result under id: series added step by step, summary
// statistics recomputed from the sums, and every other field taken from the
// first part, the largest building. Every part must have the same start and
// resolution; a part with an error fails the whole way.
func CombineResults(id string, parts []BuildingResult) (BuildingResult, error) {
	if len(parts) == 0 {
		return BuildingResult{}, errors.New("no parts to combine")
	}
	var head ParsedResult
	partSeries := make([]map[string][]float64, len(parts))
	for i, p := range parts {
		parsed, err := ParseResult(p)
		if err != nil {
			return BuildingResult{}, err
		}
		if i == 0 {
			head = parsed
		} else if !parsed.StartTime.Equal(head.StartTime) || parsed.ResolutionMinutes != head.ResolutionMinutes {
			return BuildingResult{}, fmt.Errorf("part %s starts %s every %d min, the first part %s every %d min", p.ID, parsed.StartTime, parsed.ResolutionMinutes, head.StartTime, head.ResolutionMinutes)
		}
		partSeries[i] = make(map[string][]float64, len(parsed.Series))
		for name, s := range parsed.Series {
			partSeries[i][name] = toFloat64(s.Values)
		}
	}
	sum, err := SumSeries(partSeries)
	if err != nil {
		return BuildingResult{}, err
	}
	block, err := withTimeseries(parts[0].BUEM, sum)
	if err != nil {
		return BuildingResult{}, err
	}
	if block, err = SetSummaryStats(block, sum, head.ResolutionMinutes); err != nil {
		return BuildingResult{}, err
	}
	return BuildingResult{ID: id, BUEM: block}, nil
}

// withTimeseries returns block with the series of
// thermal_load_profile.timeseries replaced by series, keeping its units and
// timestamps.
func withTimeseries(block json.RawMessage, series map[string][]float64) (json.RawMessage, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(block, &top); err != nil {
		return nil, fmt.Errorf("decode result block: %w", err)
	}
	var profile map[string]json.RawMessage
	if err := json.Unmarshal(top["thermal_load_profile"], &profile); err != nil {
		return nil, fmt.Errorf("decode thermal_load_profile: %w", err)
	}
	var timeseries map[string]json.RawMessage
	if err := json.Unmarshal(profile["timeseries"], &timeseries); err != nil {
		return nil, fmt.Errorf("decode timeseries: %w", err)
	}
	for name, values := range series {
		encoded, err := json.Marshal(values)
		if err != nil {
			return nil, fmt.Errorf("encode series %s: %w", name, err)
		}
		timeseries[name] = encoded
	}
	var err error
	if profile["timeseries"], err = json.Marshal(timeseries); err != nil {
		return nil, fmt.Errorf("encode timeseries: %w", err)
	}
	if top["thermal_load_profile"], err = json.Marshal(profile); err != nil {
		return nil, fmt.Errorf("encode thermal_load_profile: %w", err)
	}
	return json.Marshal(top)
}

func toFloat64(values []float32) []float64 {
	out := make([]float64, len(values))
	for i, v := range values {
		out[i] = float64(v)
	}
	return out
}
