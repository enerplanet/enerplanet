package buem

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"
)

// ParsedResult is one building's BuEM result split into its hourly series and
// the rest of the result block.
type ParsedResult struct {
	StartTime         time.Time
	ResolutionMinutes int
	// Series maps a series name (heating, cooling, electricity, hot_water,
	// kitchen) to its values and unit, as BuEM reported them.
	Series map[string]ParsedSeries
	// Summary is the result block without the series.
	Summary json.RawMessage
	// Version and Commit are model_metadata.model_version and model_commit.
	Version string
	Commit  string
}

// ParsedSeries is one series' values per step and their unit.
type ParsedSeries struct {
	Unit   string
	Values []float32
}

// seriesMeta are the keys of thermal_load_profile.timeseries that describe
// the series rather than being one.
var seriesMeta = map[string]bool{"unit": true, "kitchen_unit": true, "timestamps": true}

// ParseResult splits r's result block into series and summary. It fails when
// r carries an error or no series, since a result without series cannot be
// stored as one.
func ParseResult(r BuildingResult) (ParsedResult, error) {
	if r.Error != "" {
		return ParsedResult{}, fmt.Errorf("building %s: %s", r.ID, r.Error)
	}
	var block map[string]json.RawMessage
	if err := json.Unmarshal(r.BUEM, &block); err != nil {
		return ParsedResult{}, fmt.Errorf("building %s: decode result block: %w", r.ID, err)
	}
	var profile map[string]json.RawMessage
	if err := json.Unmarshal(block["thermal_load_profile"], &profile); err != nil {
		return ParsedResult{}, fmt.Errorf("building %s: decode thermal_load_profile: %w", r.ID, err)
	}
	parsed, err := parseProfile(block["thermal_load_profile"], profile["timeseries"])
	if err != nil {
		return ParsedResult{}, fmt.Errorf("building %s: %w", r.ID, err)
	}
	var meta struct {
		Version string `json:"model_version"`
		Commit  string `json:"model_commit"`
	}
	if raw, ok := block["model_metadata"]; ok {
		if err := json.Unmarshal(raw, &meta); err != nil {
			return ParsedResult{}, fmt.Errorf("building %s: decode model_metadata: %w", r.ID, err)
		}
	}
	parsed.Version, parsed.Commit = meta.Version, meta.Commit

	delete(profile, "timeseries")
	if block["thermal_load_profile"], err = json.Marshal(profile); err != nil {
		return ParsedResult{}, fmt.Errorf("building %s: encode summary: %w", r.ID, err)
	}
	if parsed.Summary, err = json.Marshal(block); err != nil {
		return ParsedResult{}, fmt.Errorf("building %s: encode summary: %w", r.ID, err)
	}
	return parsed, nil
}

// parseProfile reads the start time and resolution of a thermal_load_profile
// block and the series of its timeseries block.
func parseProfile(profileRaw, timeseriesRaw json.RawMessage) (ParsedResult, error) {
	var head struct {
		StartTime string `json:"start_time"`
		// The contract types resolution as a string ("60"); a number is accepted too.
		Resolution     json.RawMessage `json:"resolution"`
		ResolutionUnit string          `json:"resolution_unit"`
	}
	if err := json.Unmarshal(profileRaw, &head); err != nil {
		return ParsedResult{}, fmt.Errorf("decode profile header: %w", err)
	}
	start, err := parseStartTime(head.StartTime)
	if err != nil {
		return ParsedResult{}, err
	}
	minutes, err := resolutionMinutes(head.Resolution, head.ResolutionUnit)
	if err != nil {
		return ParsedResult{}, err
	}
	series, err := parseSeries(timeseriesRaw)
	if err != nil {
		return ParsedResult{}, err
	}
	return ParsedResult{StartTime: start.UTC(), ResolutionMinutes: minutes, Series: series}, nil
}

// parseStartTime reads an ISO 8601 time with or without a zone; BuEM writes
// it without one for a timezone-naive index, and its periods are UTC.
func parseStartTime(text string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, text); err == nil {
		return t, nil
	}
	t, err := time.Parse("2006-01-02T15:04:05", text)
	if err != nil {
		return time.Time{}, fmt.Errorf("start_time %q is not an ISO 8601 time", text)
	}
	return t.UTC(), nil
}

func resolutionMinutes(raw json.RawMessage, unit string) (int, error) {
	text := strings.Trim(string(raw), `"`)
	value, err := strconv.Atoi(text)
	if err != nil {
		return 0, fmt.Errorf("resolution %s is not a whole number", raw)
	}
	if value <= 0 {
		return 0, fmt.Errorf("resolution %d %s is not positive", value, unit)
	}
	switch strings.ToLower(unit) {
	case "min", "minute", "minutes", "":
		return value, nil
	case "h", "hour", "hours":
		return value * 60, nil
	}
	return 0, fmt.Errorf("resolution unit %q not recognised", unit)
}

// parseSeries reads every non-empty series array of a timeseries block.
// kitchen takes kitchen_unit (a gas fuel channel), the others unit.
func parseSeries(raw json.RawMessage) (map[string]ParsedSeries, error) {
	if len(raw) == 0 {
		return nil, errors.New("result has no timeseries; was keep_timeseries set?")
	}
	var block map[string]json.RawMessage
	if err := json.Unmarshal(raw, &block); err != nil {
		return nil, fmt.Errorf("decode timeseries: %w", err)
	}
	var units struct {
		Unit        string `json:"unit"`
		KitchenUnit string `json:"kitchen_unit"`
	}
	if err := json.Unmarshal(raw, &units); err != nil {
		return nil, fmt.Errorf("decode timeseries units: %w", err)
	}
	series := make(map[string]ParsedSeries)
	for name, values := range block {
		if seriesMeta[name] {
			continue
		}
		var v []float32
		if err := json.Unmarshal(values, &v); err != nil {
			return nil, fmt.Errorf("series %s: %w", name, err)
		}
		// An empty or null series was not computed for this building (no hot
		// water for a bakery, no gas cooking with electric cooking).
		if len(v) == 0 {
			continue
		}
		u := units.Unit
		if name == "kitchen" {
			u = units.KitchenUnit
		}
		if u == "" {
			return nil, fmt.Errorf("series %s has %d values but no unit (timeseries keys: %s)", name, len(v), strings.Join(slices.Sorted(maps.Keys(block)), ", "))
		}
		series[name] = ParsedSeries{Unit: u, Values: v}
	}
	if len(series) == 0 {
		return nil, errors.New("timeseries carries no series")
	}
	return series, nil
}
