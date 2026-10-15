package tentacron

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// maxBatchItems is TentaCron's limit on POST /v1/requests/batch.
const maxBatchItems = 100

// BatchItem is one request of a batch submission.
type BatchItem struct {
	Target         string `json:"target"`
	Payload        any    `json:"payload"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// BatchResult is TentaCron's answer for one item: the job id, or the reason
// the item was not accepted.
type BatchResult struct {
	ID  string
	Err error
}

type batchResponse struct {
	// Error is set when TentaCron rejects the whole batch.
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	Items []struct {
		ID    string `json:"id"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	} `json:"items"`
}

// SubmitBatch submits items in one POST /v1/requests/batch and returns one
// result per item, in order. Each item is stored independently; an item whose
// idempotency key is already stored returns that job instead of a new one.
func (c *Client) SubmitBatch(ctx context.Context, items []BatchItem) ([]BatchResult, error) {
	if len(items) == 0 || len(items) > maxBatchItems {
		return nil, fmt.Errorf("tentacron batch: %d items, want 1 to %d", len(items), maxBatchItems)
	}
	resp, err := c.http.DoJSON(ctx, http.MethodPost, "/v1/requests/batch",
		map[string]any{"requests": items}, c.authHeader())
	if err != nil {
		return nil, fmt.Errorf("tentacron batch of %d: %w", len(items), err)
	}
	defer resp.Body.Close()
	var br batchResponse
	if err := json.NewDecoder(resp.Body).Decode(&br); err != nil {
		return nil, fmt.Errorf("tentacron batch of %d: status %d, decode response: %w", len(items), resp.StatusCode, err)
	}
	if br.Error != nil {
		return nil, fmt.Errorf("tentacron batch of %d: status %d: %s: %s", len(items), resp.StatusCode, br.Error.Code, br.Error.Message)
	}
	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusBadRequest {
		return nil, fmt.Errorf("tentacron batch of %d: unexpected status %d", len(items), resp.StatusCode)
	}
	if len(br.Items) != len(items) {
		return nil, fmt.Errorf("tentacron batch: %d items sent, %d answered (status %d)", len(items), len(br.Items), resp.StatusCode)
	}
	results := make([]BatchResult, len(items))
	for i, it := range br.Items {
		switch {
		case it.Error != nil:
			results[i].Err = fmt.Errorf("tentacron batch item %d (%s): %s: %s", i, items[i].Target, it.Error.Code, it.Error.Message)
		case it.ID == "":
			results[i].Err = fmt.Errorf("tentacron batch item %d (%s): no id and no error", i, items[i].Target)
		default:
			results[i].ID = it.ID
		}
	}
	return results, nil
}

// AwaitJSON waits for an already-submitted job, within budget, and decodes its
// verbatim upstream response into out. A failed or cancelled job is returned
// as *TargetError.
func (c *Client) AwaitJSON(ctx context.Context, target, id string, budget time.Duration, out any) error {
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	return c.await(ctx, target, id, out)
}
