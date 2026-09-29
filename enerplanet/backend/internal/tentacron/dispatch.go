package tentacron

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// memePollBudget bounds a whole MEME submit-and-await. It matches TentaCron's
// own meme target poll timeout (30m in dependencies/TentaCron/environment/
// config.yaml), NOT the generic opTimeout (60s): MEME solves take minutes, and
// a 60s backend deadline would fire mid-solve, the handler would error, asynq
// would retry, and a NEW submit would be queued -> duplicate MEME jobs.
const memePollBudget = 30 * time.Minute

// SubmitMeme idempotently submits a request for the named target with payload,
// returning the TentaCron job id. idempotencyKey makes a retry resubmit return
// the STORED job (same id, no duplicate enqueue) instead of requeueing MEME.
// The caller persists the returned id so a later run can resume by id rather
// than resubmit.
func (c *Client) SubmitMeme(ctx context.Context, target string, payload any, idempotencyKey string) (string, error) {
	id, err := c.submitWithKey(ctx, target, payload, idempotencyKey)
	if err != nil {
		return "", fmt.Errorf("meme submit via TentaCron: %w", err)
	}
	return id, nil
}

// AwaitResultByID resumes an already-submitted TentaCron job by id (never
// resubmitting it), long-polling on a caller-supplied budget until the job
// reaches a terminal state. A failed/cancelled outcome is returned as
// *TargetError. Pass memePollBudget for MEME's multi-minute solve.
func (c *Client) AwaitResultByID(ctx context.Context, id string, budget time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	_, err := c.awaitTerminal(ctx, "resume", id)
	if err != nil {
		return err
	}
	return nil
}

// FetchResultByID returns the completed job's raw result body via the canonical
// GET /v1/requests/{id}/result endpoint, which streams the stored file/body —
// the correct read for MEME's binary result zip (never the JSON path).
func (c *Client) FetchResultByID(ctx context.Context, id string) ([]byte, error) {
	resp, err := c.http.Do(ctx, http.MethodGet, "/v1/requests/"+url.PathEscape(id)+"/result", nil, c.authHeader())
	if err != nil {
		return nil, fmt.Errorf("meme fetch result %s: %w", id, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("meme fetch result %s: unexpected status %d", id, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// CancelMeme cancels an abandoned TentaCron request. A 409 (not_cancellable)
// is surfaced as an error: it only happens while a worker still holds the
// request mid-processing.
func (c *Client) CancelMeme(ctx context.Context, id string) error {
	resp, err := c.http.Do(ctx, http.MethodDelete, "/v1/requests/"+url.PathEscape(id), nil, c.authHeader())
	if err != nil {
		return fmt.Errorf("meme cancel %s: %w", id, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("meme cancel %s: unexpected status %d", id, resp.StatusCode)
	}
	return nil
}