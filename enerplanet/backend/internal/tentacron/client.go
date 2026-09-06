// Package tentacron is the backend's client for the TentaCron orchestrator
// (enerplanet/TentaCron). A request names a configured target; TentaCron calls
// that upstream and returns its response verbatim. The server-side ignis calls
// (the resolve endpoint, run_buem) use it.
//
// Requests are async. Do submits (POST /v1/requests -> 202 + id) then
// long-polls GET /v1/requests/{id}?wait=... until the job reaches a terminal
// state. TentaCron owns transient retry (upstream 5xx, network); the caller
// must not add its own.
package tentacron

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	httpclient "platform.local/common/pkg/httpclient"
)

const (
	// waitParam is the long-poll hold on each status GET. TentaCron wakes it
	// within milliseconds of the job finishing and blocks the full duration
	// only while the job is genuinely still running. Kept under TentaCron's own
	// clamp (server.write_timeout - 5s, 60s when unset).
	waitParam = "25s"
	// perCallTimeout must exceed waitParam so the HTTP call does not abort
	// before a held status response comes back.
	perCallTimeout = 30 * time.Second
	// opTimeout bounds a whole submit-and-await. A TentaCron-side retry storm
	// (max_attempts with backoff to 60s) can outlast this; Do then returns a
	// deadline error and the caller degrades (heat demand falls to the
	// estimate). Acceptable: the interactive resolve path would not hold a
	// user's spinner longer than this regardless.
	opTimeout = 60 * time.Second
)

// pollBackstop is a floor on the gap between status GETs. The ?wait hold
// normally paces the loop; this only bites if TentaCron returns a non-terminal
// state early, stopping a hot spin. Var, not const, so tests can shrink it.
var pollBackstop = time.Second

// Client talks to TentaCron at one base URL with one API key.
type Client struct {
	http   *httpclient.Client
	apiKey string
}

// New binds a Client to TentaCron at baseURL, authenticating with apiKey
// (sent as X-API-Key; every /v1 endpoint rejects a missing key with 401).
func New(baseURL, apiKey string) *Client {
	return &Client{
		http:   httpclient.New(baseURL, httpclient.WithTimeout(perCallTimeout)),
		apiKey: apiKey,
	}
}

// TargetError is a TentaCron job that ended in a non-success terminal state.
// Code is the job-level error.code (e.g. "target_error" for an upstream 4xx,
// "target_timeout", "max_attempts_exceeded" once transient retries are spent,
// "unknown_target" / "invalid_payload" for a caller mistake). Message is
// error.message; for an upstream HTTP failure TentaCron formats it as
// "target <name>: HTTP <status>: <body excerpt>" (credentials redacted,
// truncated to 512 bytes).
type TargetError struct {
	Code    string
	Message string
}

func (e *TargetError) Error() string {
	return fmt.Sprintf("tentacron request failed (%s): %s", e.Code, e.Message)
}

type submitRequest struct {
	Target  string `json:"target"`
	Payload any    `json:"payload"`
}

type submitResponse struct {
	ID string `json:"id"`
}

type statusResponse struct {
	State  string `json:"state"`
	Result *struct {
		TargetStatus   int             `json:"target_status"`
		TargetResponse json.RawMessage `json:"target_response"`
	} `json:"result"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Do submits a request for the named target with payload, waits for the job to
// reach a terminal state, and unmarshals the verbatim upstream response into
// out (nil to discard it). A "failed" or "cancelled" outcome is returned as
// *TargetError.
func (c *Client) Do(ctx context.Context, target string, payload, out any) error {
	ctx, cancel := context.WithTimeout(ctx, opTimeout)
	defer cancel()

	id, err := c.submit(ctx, target, payload)
	if err != nil {
		return err
	}
	return c.await(ctx, target, id, out)
}

func (c *Client) submit(ctx context.Context, target string, payload any) (string, error) {
	resp, err := c.http.DoJSON(ctx, http.MethodPost, "/v1/requests",
		submitRequest{Target: target, Payload: payload}, c.authHeader())
	if err != nil {
		return "", fmt.Errorf("tentacron submit %q: %w", target, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return "", fmt.Errorf("tentacron submit %q: unexpected status %d", target, resp.StatusCode)
	}
	var sr submitResponse
	if err := json.NewDecoder(resp.Body).Decode(&sr); err != nil {
		return "", fmt.Errorf("tentacron submit %q: decode response: %w", target, err)
	}
	if sr.ID == "" {
		return "", fmt.Errorf("tentacron submit %q: empty request id", target)
	}
	return sr.ID, nil
}

func (c *Client) await(ctx context.Context, target, id string, out any) error {
	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("tentacron await %s (%s): %w", id, target, err)
		}
		st, err := c.status(ctx, id)
		if err != nil {
			return err
		}
		switch st.State {
		case "completed":
			return decodeTargetResponse(target, st, out)
		case "failed", "cancelled":
			return targetErrorFrom(id, st)
		}
		// received / resolving / forwarding / awaiting_target: the ?wait GET
		// normally already blocked for its full duration; the backstop only
		// matters if it returned early.
		select {
		case <-ctx.Done():
			return fmt.Errorf("tentacron await %s (%s): %w", id, target, ctx.Err())
		case <-time.After(pollBackstop):
		}
	}
}

func (c *Client) status(ctx context.Context, id string) (statusResponse, error) {
	resp, err := c.http.Do(ctx, http.MethodGet, "/v1/requests/"+url.PathEscape(id)+"?wait="+waitParam, nil, c.authHeader())
	if err != nil {
		return statusResponse{}, fmt.Errorf("tentacron poll %s: %w", id, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return statusResponse{}, fmt.Errorf("tentacron poll %s: unexpected status %d", id, resp.StatusCode)
	}
	var st statusResponse
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		return statusResponse{}, fmt.Errorf("tentacron poll %s: decode response: %w", id, err)
	}
	return st, nil
}

func (c *Client) authHeader() http.Header {
	return http.Header{"X-Api-Key": {c.apiKey}}
}

func decodeTargetResponse(target string, st statusResponse, out any) error {
	if out == nil {
		return nil
	}
	if st.Result == nil || len(st.Result.TargetResponse) == 0 {
		return fmt.Errorf("tentacron target %q: completed with no target_response", target)
	}
	if err := json.Unmarshal(st.Result.TargetResponse, out); err != nil {
		return fmt.Errorf("tentacron target %q: decode target_response: %w", target, err)
	}
	return nil
}

func targetErrorFrom(id string, st statusResponse) error {
	if st.Error == nil {
		return fmt.Errorf("tentacron request %s ended %q with no error detail", id, st.State)
	}
	return &TargetError{Code: st.Error.Code, Message: st.Error.Message}
}

// AsTargetError reports whether err is or wraps a *TargetError, returning it.
func AsTargetError(err error) (*TargetError, bool) {
	var te *TargetError
	if errors.As(err, &te) {
		return te, true
	}
	return nil, false
}
