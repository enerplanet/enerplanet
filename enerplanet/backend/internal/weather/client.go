// Package weather is a thin HTTP client for weather-serve (UU-BUEM/weather),
// used by run_buem to resolve the per-building weather timeseries buem-gateway
// requires. Calling weather-serve directly here is a deliberate, temporary
// exception — see the on-request-3d-pipeline plan and its linked decision
// note for why: the intended design has Orchestrator resolve this, and this
// is expected to move there once it exists.
package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	httpclient "platform.local/common/pkg/httpclient"
)

// Client talks to weather-serve's HTTP API.
type Client struct {
	http   *httpclient.Client
	apiKey string
}

// NewClient creates a Client bound to weather-serve at baseURL. apiKey is
// sent as X-API-Key on every request — weather-serve's Flask app checks it
// itself (unlike buem-gateway's, this isn't a reverse-proxy-only concern), so
// it is required regardless of network path. See WEATHER_API_KEYS in
// weather-serve's own docker-compose.serve.yml.
func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		http:   httpclient.New(baseURL, httpclient.WithTimeout(30*time.Second)),
		apiKey: apiKey,
	}
}

func (c *Client) headers() http.Header {
	h := make(http.Header)
	if c.apiKey != "" {
		h.Set("X-API-Key", c.apiKey)
	}
	return h
}

// GetPointWeather returns the hourly weather timeseries for one location/year,
// as raw JSON already shaped {"index": [...], "variables": {name: [...]}} —
// exactly the shape buem-gateway's buem.weather block expects (see
// internal/buem/weather_validate.go in buem-gateway), so callers can embed it
// directly without re-parsing it into a typed struct first. provider selects
// which weather archive to query (e.g. "era5-land"); year selects which
// archive file weather-serve reads. use_case=solar is fixed, not a parameter:
// weather-serve requires one of variables/use_case, and solar (T, GHI, DHI,
// DNI) is exactly buem-gateway's own requirement — this client has no other
// caller that would want a different set.
func (c *Client) GetPointWeather(ctx context.Context, lat, lon float64, year int, provider string) (json.RawMessage, error) {
	path := fmt.Sprintf("/v1/weather/point?lat=%g&lon=%g&year=%d&provider=%s&use_case=solar&format=json",
		lat, lon, year, url.QueryEscape(provider))

	resp, err := c.http.Do(ctx, http.MethodGet, path, nil, c.headers())
	if err != nil {
		return nil, fmt.Errorf("weather-serve point request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("weather-serve point: unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read weather-serve response: %w", err)
	}
	return json.RawMessage(body), nil
}
