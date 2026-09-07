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

// Client resolves weather data through TentaCron.
type Client struct {
	tc *tentacron.Client
}

// NewClient returns a Client that reaches weather-serve through the given
// TentaCron client.
func NewClient(tc *tentacron.Client) *Client {
	return &Client{tc: tc}
}

// GetPointWeather returns the hourly weather timeseries for one location/year,
// as raw JSON already shaped {"index": [...], "variables": {name: [...]}} -
// exactly the shape buem-gateway's buem.weather block expects (see
// internal/buem/weather_validate.go in buem-gateway), so callers embed it
// directly without re-parsing. provider selects the weather archive; year
// selects the archive file. use_case and format are sent explicitly on every
// call: weather-serve requires one of variables/use_case, solar (T, GHI, DHI,
// DNI) is buem-gateway's own set, and without format=json weather-serve
// answers with parquet.
func (c *Client) GetPointWeather(ctx context.Context, lat, lon float64, year int, provider string) (json.RawMessage, error) {
	payload := map[string]any{
		"lat":      lat,
		"lon":      lon,
		"year":     year,
		"provider": provider,
		"use_case": "solar",
		"format":   "json",
	}
	var raw json.RawMessage
	if err := c.tc.Do(ctx, targetPoint, payload, &raw); err != nil {
		return nil, asWeatherError(err)
	}
	return raw, nil
}

// weatherRejectionCodes are the TentaCron error codes that mean weather-serve
// itself declined the call: bad coordinates or an unknown provider (400), a
// missing API key (401), no archive for the year (404), the archive backend
// down (503), or a weather-serve timeout. run_buem logs and proceeds without
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
