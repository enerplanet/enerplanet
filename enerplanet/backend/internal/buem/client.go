// Package buem runs BuEM for a model's buildings through buem-gateway
// (enerplanet/buem-gateway), reached through the TentaCron orchestrator - the
// backend makes no direct buem-gateway call. Used by run_buem, which resolves a
// model's topology down to a flat list of buildings itself before calling this
// client and merges each building's result back into the topology afterward.
package buem

import (
	"context"
	"encoding/json"
	"time"

	"spatialhub_backend/internal/tentacron"
)

// targetBuildings is the TentaCron proxy target for buem-gateway's batch
// endpoint (POST /api/v1/buem/buildings). response.mode direct; the whole
// RunBuildings body is forwarded verbatim.
const targetBuildings = "buem-buildings"

// runTimeout bounds the whole submit-and-await for a batch. A full-year
// 200-building batch runs 10-15+ min; the buem-buildings target caps its own
// upstream job at ~9.5 min and TentaCron's job_timeout is 12 min, so 14 min
// sits above both - the backend waits out any job TentaCron will still finish
// and only gives up once TentaCron itself has.
const runTimeout = 14 * time.Minute

// defaultResolution is BuEM's timestep in minutes when the model does not set
// one, matching internal/payload.getResolution. A zero would be sent to BuEM
// as "0".
const defaultResolution = 60

// Client runs BuEM batches through TentaCron.
type Client struct {
	tc *tentacron.Client
}

// NewClient returns a Client that reaches buem-gateway through the given
// TentaCron client.
func NewClient(tc *tentacron.Client) *Client {
	return &Client{tc: tc}
}

// BadRequestError is a 4xx from buem-gateway (a malformed batch body, an
// unknown route) carried through with buem-gateway's own message. A 5xx or a
// Caddy error (gateway down) is returned as the raw *tentacron.TargetError
// instead - run_buem fails the job either way, this only shapes the message.
type BadRequestError struct {
	Message string
}

func (e *BadRequestError) Error() string {
	return "buem-gateway rejected the batch: " + e.Message
}

// buemRejectionCodes are the TentaCron job error codes that mean the call
// reached buem-gateway (or Caddy) and it declined or failed it, as opposed to
// a backend-side fault (unknown_target, invalid_payload).
var buemRejectionCodes = map[string]bool{
	"target_error":      true,
	"target_job_failed": true,
	"target_timeout":    true,
}

// asBuemError maps a TentaCron rejection to a *BadRequestError for a
// buem-gateway 4xx (permanent, our fault) and leaves everything else - a 5xx,
// a Caddy 403/502/503/504, a target_timeout - as the raw *tentacron.TargetError
// so the failRunBuem message says "gateway unavailable", not "bad request".
func asBuemError(err error) error {
	te, ok := tentacron.AsTargetError(err)
	if !ok || !buemRejectionCodes[te.Code] {
		return err
	}
	if status, hasStatus := te.UpstreamStatus(); hasStatus && status >= 400 && status < 500 {
		return &BadRequestError{Message: te.UpstreamMessage()}
	}
	return err
}

// Building is one building's request data for RunBuildings - geometry and its
// own building block (envelope etc.), no weather (see RunBuildings).
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

// RunBuildings calls buem-gateway's POST /api/v1/buem/buildings via TentaCron:
// it runs BuEM for every building in buildings concurrently, sharing one
// weather block across all of them (buem-gateway's weather_validate.go requires
// it complete for every building), writes each one's load-profile CSVs, and
// returns one result per building in the same order as buildings. A building's
// own missing/incomplete envelope, or BuEM rejecting it, is reported in that
// building's own Error - buem-gateway still answers 200 and it never affects
// any other building's result.
//
// A batch that outruns the buem-buildings target timeout (~9.5 min) comes back
// as a target_timeout and fails the run_buem job with no retry.
func (c *Client) RunBuildings(ctx context.Context, buildings []Building, weather json.RawMessage, startDate, endDate string, resolution int, modelID string) ([]BuildingResult, error) {
	if resolution <= 0 {
		resolution = defaultResolution
	}
	payload := map[string]any{
		"start_date": startDate,
		"end_date":   endDate,
		"resolution": resolution,
		"model_id":   modelID,
		"weather":    weather,
		"buildings":  buildings,
	}

	var results []BuildingResult
	if err := c.tc.DoTimeout(ctx, targetBuildings, payload, &results, runTimeout); err != nil {
		return nil, asBuemError(err)
	}
	return results, nil
}
