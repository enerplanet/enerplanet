// Package pv places PV arrays on roofs and simulates them with the PV service over TentaCron.
package pv

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"spatialhub_backend/internal/tentacron"
)

// targetSimulate is the TentaCron proxy target for POST /v1/pv/simulate.
const targetSimulate = "pv-simulate"

// MaxArraysPerRequest is the PV service's limit on arrays in one request.
const MaxArraysPerRequest = 50

const simulateTimeout = 2 * time.Minute

// Location is the point the weather was fetched for.
type Location struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// ArrayRequest is one array of a simulate request, at the service's default 1 kW.
type ArrayRequest struct {
	ID                 string  `json:"id"`
	Tilt               float64 `json:"tilt"`
	Azimuth            float64 `json:"azimuth"`
	Losses             float64 `json:"losses"`
	DCACRatio          float64 `json:"dc_ac_ratio"`
	InverterEfficiency float64 `json:"inverter_efficiency"`
	ModuleType         string  `json:"module_type"`
}

type simulateRequest struct {
	Location Location        `json:"location"`
	Weather  json.RawMessage `json:"weather"`
	Arrays   []ArrayRequest  `json:"arrays"`
}

type simulateResponse struct {
	Arrays []struct {
		ID             string    `json:"id"`
		CapacityFactor []float64 `json:"capacity_factor"`
	} `json:"arrays"`
}

// Client calls the PV service through TentaCron.
type Client struct {
	tc *tentacron.Client
}

// NewClient returns a Client using the given TentaCron client.
func NewClient(tc *tentacron.Client) *Client {
	return &Client{tc: tc}
}

// Simulate returns each array's hourly capacity factor by id, in requests of MaxArraysPerRequest.
func (c *Client) Simulate(ctx context.Context, loc Location, weather json.RawMessage, arrays []ArrayRequest) (map[string][]float64, error) {
	out := make(map[string][]float64, len(arrays))
	for start := 0; start < len(arrays); start += MaxArraysPerRequest {
		end := min(start+MaxArraysPerRequest, len(arrays))
		var resp simulateResponse
		req := simulateRequest{Location: loc, Weather: weather, Arrays: arrays[start:end]}
		if err := c.tc.DoTimeout(ctx, targetSimulate, req, &resp, simulateTimeout); err != nil {
			return nil, fmt.Errorf("pv-simulate for arrays %d to %d: %w", start, end-1, err)
		}
		for _, a := range resp.Arrays {
			out[a.ID] = a.CapacityFactor
		}
	}
	for _, a := range arrays {
		if _, ok := out[a.ID]; !ok {
			return nil, fmt.Errorf("pv-simulate returned no profile for array %s", a.ID)
		}
	}
	return out, nil
}
