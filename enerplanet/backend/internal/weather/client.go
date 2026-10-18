// Package weather resolves the per-model weather timeseries buem-gateway
// requires, from weather-serve (UU-BUEM/weather), reached through the TentaCron
// orchestrator - the backend makes no direct weather-serve call. Used by
// run_buem.
package weather

import (
	"context"
	"encoding/json"
	"fmt"

	"spatialhub_backend/internal/tentacron"
)

// targetPoint is the TentaCron proxy target for weather-serve's point query
// (GET /v1/weather/point). response.mode direct; TentaCron maps the payload
// onto the query string per its target config.
const targetPoint = "weather-point"

// providers are the archives weather-serve answers for, by its canonical names.
var providers = map[string]bool{"cosmo-rea6": true, "era5-land": true, "merra-2": true}

// IsProvider reports whether name is a weather-serve archive.
func IsProvider(name string) bool {
	return providers[name]
}

// scenarios are the representative years weather-serve builds per provider:
// low, typical and high solar.
var scenarios = map[string]bool{"p10": true, "p50": true, "p90": true}

// IsScenario reports whether name is a weather-serve scenario.
func IsScenario(name string) bool {
	return scenarios[name]
}

// ScenarioYear is the year weather-serve stamps scenario rows with: a stitched
// year of months from different archive years, not a real calendar year.
const ScenarioYear = 1900

// Period is the weather a run uses: a scenario or a real archive year, never
// both. The run always covers that full calendar year, hourly.
type Period struct {
	Scenario string
	Year     int
}

// DefaultPeriod is the typical scenario, for a model that chose none.
var DefaultPeriod = Period{Scenario: "p50"}

// Range returns the run's first and last hour as RFC 3339 timestamps.
func (p Period) Range() (start, end string) {
	year := p.Year
	if p.Scenario != "" {
		year = ScenarioYear
	}
	return fmt.Sprintf("%04d-01-01T00:00:00Z", year), fmt.Sprintf("%04d-12-31T23:00:00Z", year)
}

// Client resolves weather data through TentaCron.
type Client struct {
	tc *tentacron.Client
}

// NewClient returns a Client that reaches weather-serve through the given
// TentaCron client.
func NewClient(tc *tentacron.Client) *Client {
	return &Client{tc: tc}
}

// GetPointWeather returns the hourly weather timeseries for one location and period,
// as raw JSON already shaped {"index": [...], "variables": {name: [...]}} -
// exactly the shape buem-gateway's buem.weather block expects (see
// internal/buem/weather_validate.go in buem-gateway), so callers embed it
// directly without re-parsing. provider selects the weather archive; period
// selects a scenario or an archive year, sent as exactly one of scenario or year. use_case and format are sent explicitly on every
// call: weather-serve requires one of variables/use_case, solar (T, GHI, DHI,
// DNI) is buem-gateway's own set, and without format=json weather-serve
// answers with parquet.
func (c *Client) GetPointWeather(ctx context.Context, lat, lon float64, period Period, provider string) (json.RawMessage, error) {
	return c.point(ctx, lat, lon, period, provider, "use_case", "solar")
}

// pvVariables are the PV service's inputs; wind sets the cell temperature.
const pvVariables = "T,DHI,DNI,WS_10M"

// GetPVWeather is GetPointWeather with pvVariables.
func (c *Client) GetPVWeather(ctx context.Context, lat, lon float64, period Period, provider string) (json.RawMessage, error) {
	return c.point(ctx, lat, lon, period, provider, "variables", pvVariables)
}

// point queries weather-serve with selector "use_case" or "variables".
func (c *Client) point(ctx context.Context, lat, lon float64, period Period, provider, selector, value string) (json.RawMessage, error) {
	payload := map[string]any{
		"lat":      lat,
		"lon":      lon,
		"provider": provider,
		selector:   value,
		"format":   "json",
	}
	if period.Scenario != "" {
		payload["scenario"] = period.Scenario
	} else {
		payload["year"] = period.Year
	}
	var raw json.RawMessage
	if err := c.tc.Do(ctx, targetPoint, payload, &raw); err != nil {
		return nil, asWeatherError(err)
	}
	return raw, nil
}

// weatherRejectionCodes are the TentaCron error codes that mean weather-serve
// itself declined the call: bad coordinates or an unknown provider (400), a
// missing API key (401), an unknown location (404), no servable archive for
// the year (422 archive_not_servable), weather-serve not configured (503), or
// a weather-serve timeout. All permanent. run_buem logs and proceeds without
// weather whatever the cause; this only trims the log line to weather-serve's
// own message.
var weatherRejectionCodes = map[string]bool{
	"target_error":   true,
	"target_timeout": true,
}

// asWeatherError flattens a weather-serve rejection to a plain error carrying
// weather-serve's own message. Anything else (unknown_target, invalid_payload,
// max_attempts_exceeded, internal - all backend or infrastructure faults) is
// returned unchanged.
func asWeatherError(err error) error {
	te, ok := tentacron.AsTargetError(err)
	if !ok || !weatherRejectionCodes[te.Code] {
		return err
	}
	return fmt.Errorf("weather-serve rejected the request: %s", te.UpstreamMessage())
}
