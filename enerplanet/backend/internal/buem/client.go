// Package buem is a thin HTTP client for buem-gateway's topology endpoint
// (enerplanet/buem-gateway), used by run_buem to run BuEM for every building
// in a model's topology that has both an envelope and weather block.
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

// RunTopology calls buem-gateway's POST /api/v1/buem/topology: it runs BuEM
// for every building in topology that carries a complete buem block
// (properties.buem.building.envelope and properties.buem.weather — see
// buem-gateway's internal/buem/{envelope_validate,weather_validate}.go),
// writes each one's load-profile CSVs, and returns the topology with those
// buildings' buem blocks enriched with the results. Buildings with no buem
// block, or an incomplete one, come back unchanged rather than causing an
// error — buem-gateway's own per-building tolerance, not something this
// client needs to work around.
func (c *Client) RunTopology(ctx context.Context, topology json.RawMessage, startDate, endDate string, resolution int, modelID string) (json.RawMessage, error) {
	payload := map[string]interface{}{
		"start_date": startDate,
		"end_date":   endDate,
		"resolution": resolution,
		"model_id":   modelID,
		"topology":   topology,
	}

	resp, err := c.http.DoJSON(ctx, http.MethodPost, "/api/v1/buem/topology", payload, c.headers())
	if err != nil {
		return nil, fmt.Errorf("buem-gateway topology request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("buem-gateway topology: unexpected status %d", resp.StatusCode)
	}

	var body struct {
		Topology json.RawMessage `json:"topology"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("failed to decode buem-gateway topology response: %w", err)
	}
	return body.Topology, nil
}
