// Package buem is a thin HTTP client for buem-gateway's buildings endpoint
// (enerplanet/buem-gateway), used by run_buem to run BuEM for every building
// in a model's topology that has both an envelope and weather resolved.
// buem-gateway has no concept of a grid or topology — the caller (run_buem)
// resolves the topology down to a flat list of buildings itself before
// calling this client, and merges each building's result back into the
// topology afterward.
package buem

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	httpclient "platform.local/common/pkg/httpclient"
)

// Client talks to buem-gateway's HTTP API.
type Client struct {
	http   *httpclient.Client
	apiKey string
}

// NewClient creates a Client bound to buem-gateway at baseURL. apiKey is
// sent as X-Api-Key on every request. Whether this is actually needed depends
// on deployment topology: buem-gateway's own app container has no auth of its
// own and is reachable directly by other containers on the same Docker
// network by service name — the X-Api-Key check happens only in front of it,
// in buem-gateway's Caddy reverse proxy, which gates its public-facing port
// (see buem-gateway's Caddyfile). Pass "" if BuemServiceURL points at the app
// container directly rather than through that proxy.
func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		http:   httpclient.New(baseURL, httpclient.WithTimeout(30*time.Second)),
		apiKey: apiKey,
	}
}

func (c *Client) headers() http.Header {
	h := make(http.Header)
	if c.apiKey != "" {
		h.Set("X-Api-Key", c.apiKey)
	}
	return h
}

// Building is one building's request data for RunBuildings — geometry and
// its own building block (envelope etc.), no weather (see RunBuildings).
type Building struct {
	ID       string          `json:"id"`
	Geometry json.RawMessage `json:"geometry"`
	Building json.RawMessage `json:"building"`
}

// BuildingResult is one building's outcome from RunBuildings. Exactly one of
// BUEM/Error is set, never both.
type BuildingResult struct {
	ID    string          `json:"id"`
	BUEM  json.RawMessage `json:"buem,omitempty"`
	Error string          `json:"error,omitempty"`
}

// RunBuildings calls buem-gateway's POST /api/v1/buem/buildings: it runs
// BuEM for every building in buildings concurrently, sharing one weather
// block across all of them (buem-gateway's internal/buem/weather_validate.go
// requires it complete for every building), writes each one's load-profile
// CSVs, and returns one result per building in the same order as buildings.
// A building's own missing/incomplete envelope, or BuEM rejecting it, is
// reported in that building's own Error — it never fails the whole call or
// affects any other building's result.
func (c *Client) RunBuildings(ctx context.Context, buildings []Building, weather json.RawMessage, startDate, endDate string, resolution int, modelID string) ([]BuildingResult, error) {
	payload := map[string]interface{}{
		"start_date": startDate,
		"end_date":   endDate,
		"resolution": resolution,
		"model_id":   modelID,
		"weather":    weather,
		"buildings":  buildings,
	}

	resp, err := c.http.DoJSON(ctx, http.MethodPost, "/api/v1/buem/buildings", payload, c.headers())
	if err != nil {
		return nil, fmt.Errorf("buem-gateway buildings request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("buem-gateway buildings: unexpected status %d", resp.StatusCode)
	}

	var results []BuildingResult
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		return nil, fmt.Errorf("failed to decode buem-gateway buildings response: %w", err)
	}
	return results, nil
}
