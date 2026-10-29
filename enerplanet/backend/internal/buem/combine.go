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

// CombineSummary returns the first of blocks with its
// thermal_load_profile.summary made to describe the sum of all blocks, whose
// series are series. A series entry (summary.<name>.<stat>) is recomputed from
// series[name] as BuEM computes it: total is the sum of the values times the
// step in hours, std the population standard deviation. A single-value entry
// ({unit, value}) is combined by its meaning: the peaks are the maxima of the
// summed series, total_energy_demand is the sum over blocks and
// energy_intensity is that sum over the blocks' summed floor area. A
// single-value entry with no known combination is removed rather than left
// holding the first block's value. Every other field stays as in the first block.
func CombineSummary(blocks []json.RawMessage, series map[string][]float64, resolutionMinutes int) (json.RawMessage, error) {
	if len(blocks) == 0 {
		return nil, errors.New("no blocks to combine")
	}
	summaries := make([]map[string]json.RawMessage, len(blocks))
	for i, b := range blocks {
		s, err := decodeSummary(b)
		if err != nil {
			return nil, fmt.Errorf("block %d: %w", i, err)
		}
		summaries[i] = s
	}
	combined := map[string]json.RawMessage{}
	for name, raw := range summaries[0] {
		var entry map[string]json.RawMessage
		if err := json.Unmarshal(raw, &entry); err != nil {
			return nil, fmt.Errorf("decode summary entry %s: %w", name, err)
		}
		var (
			out json.RawMessage
			err error
		)
		if _, single := entry["value"]; single {
			out, err = combineSingleValue(name, entry, summaries, series)
		} else {
			out, err = withSeriesStats(entry, series[name], resolutionMinutes)
		}
		if err != nil {
			return nil, fmt.Errorf("summary entry %s: %w", name, err)
		}
		if out != nil {
			combined[name] = out
		}
	}
	return withSummary(blocks[0], combined)
}

// withSeriesStats returns a series entry with each statistic's value set from
// values; with no values the entry is returned as it is.
func withSeriesStats(entry map[string]json.RawMessage, values []float64, resolutionMinutes int) (json.RawMessage, error) {
	if len(values) == 0 {
		return json.Marshal(entry)
	}
	for stat, value := range seriesStats(values, resolutionMinutes) {
		raw, ok := entry[stat]
		if !ok {
			continue
		}
		updated, err := withValue(raw, value)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", stat, err)
		}
		entry[stat] = updated
	}
	return json.Marshal(entry)
}

// peakSeries names the series whose maximum a peak entry is.
var peakSeries = map[string]string{"peak_heating_load": "heating", "peak_cooling_load": "cooling"}

// combineSingleValue returns the {unit, value} entry name for the sum of the
// blocks whose summaries are summaries, or nil when it cannot be derived.
func combineSingleValue(name string, entry map[string]json.RawMessage, summaries []map[string]json.RawMessage, series map[string][]float64) (json.RawMessage, error) {
	var value float64
	switch name {
	case "peak_heating_load", "peak_cooling_load":
		values := series[peakSeries[name]]
		if len(values) == 0 {
			return nil, nil
		}
		value = slices.Max(values)
	case "total_energy_demand":
		totals, err := singleValues(summaries, name)
		if err != nil {
			return nil, err
		}
		for _, t := range totals {
			value += t
		}
	case "energy_intensity":
		totals, err := singleValues(summaries, "total_energy_demand")
		if err != nil {
			return nil, err
		}
		intensities, err := singleValues(summaries, name)
		if err != nil {
			return nil, err
		}
		var demand, area float64
		for i := range totals {
			if intensities[i] <= 0 {
				return nil, nil
			}
			demand += totals[i]
			area += totals[i] / intensities[i]
		}
		if area <= 0 {
			return nil, nil
		}
		value = demand / area
	default:
		return nil, nil
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return nil, err
	}
	return withValue(raw, value)
}

// singleValues returns the value of the {unit, value} entry name in each summary.
func singleValues(summaries []map[string]json.RawMessage, name string) ([]float64, error) {
	out := make([]float64, len(summaries))
	for i, s := range summaries {
		var entry struct {
			Value *float64 `json:"value"`
		}
		if err := json.Unmarshal(s[name], &entry); err != nil || entry.Value == nil {
			return nil, fmt.Errorf("block %d has no numeric %s", i, name)
		}
		out[i] = *entry.Value
	}
	return out, nil
}

// withValue returns the JSON object raw with its "value" set to value.
func withValue(raw json.RawMessage, value float64) (json.RawMessage, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	obj["value"] = encoded
	return json.Marshal(obj)
}

// decodeSummary returns the entries of block's thermal_load_profile.summary.
func decodeSummary(block json.RawMessage) (map[string]json.RawMessage, error) {
	var top struct {
		Profile struct {
			Summary map[string]json.RawMessage `json:"summary"`
		} `json:"thermal_load_profile"`
	}
	if err := json.Unmarshal(block, &top); err != nil {
		return nil, fmt.Errorf("decode summary: %w", err)
	}
	return top.Profile.Summary, nil
}

// withSummary returns block with thermal_load_profile.summary replaced by summary.
func withSummary(block json.RawMessage, summary map[string]json.RawMessage) (json.RawMessage, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(block, &top); err != nil {
		return nil, fmt.Errorf("decode result block: %w", err)
	}
	var profile map[string]json.RawMessage
	if err := json.Unmarshal(top["thermal_load_profile"], &profile); err != nil {
		return nil, fmt.Errorf("decode thermal_load_profile: %w", err)
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
// summary combined (see CombineSummary), and every other field taken from the
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
	blocks := []json.RawMessage{block}
	for _, p := range parts[1:] {
		blocks = append(blocks, p.BUEM)
	}
	if block, err = CombineSummary(blocks, sum, head.ResolutionMinutes); err != nil {
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
