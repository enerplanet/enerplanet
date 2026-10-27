package buem

import (
	"context"
	"encoding/json"
	"fmt"

	"spatialhub_backend/internal/contenthash"
	"spatialhub_backend/internal/tentacron"
)

// GroupSize is how many buildings one BuEM job carries when series are kept.
// With all five load series one building-year measures ~1.08 MB, so four stay
// under half of TentaCron's 10 MiB response cap.
const GroupSize = 4

// Group is one set of buildings submitted as one TentaCron job, with the
// request key of each building in the same order.
type Group struct {
	Buildings []Building
	Keys      []string
}

// GroupJob is a submitted group: its TentaCron job id, or why it was not
// accepted.
type GroupJob struct {
	Group Group
	ID    string
	Err   error
}

// batchPayload is the buem-gateway batch body sent for buildings, with the
// default comfort band applied to every building block.
func batchPayload(buildings []Building, weather json.RawMessage, startDate, endDate string, resolution int, modelID string, keepTimeseries bool) (map[string]any, error) {
	if resolution <= 0 {
		resolution = defaultResolution
	}
	sent := make([]Building, len(buildings))
	for i, b := range buildings {
		block, err := withDefaultComfortBand(b.Building)
		if err != nil {
			return nil, fmt.Errorf("building %s: %w", b.ID, err)
		}
		b.Building = block
		sent[i] = b
	}
	payload := map[string]any{
		"start_date": startDate,
		"end_date":   endDate,
		"resolution": resolution,
		"model_id":   modelID,
		"weather":    weather,
		"buildings":  sent,
	}
	if keepTimeseries {
		payload["keep_timeseries"] = true
	}
	if len(buildings) == 1 && len(buildings[0].Outputs) > 0 {
		payload["outputs"] = buildings[0].Outputs
	}
	return payload, nil
}

// batchBodyBudget caps the encoded payloads of one TentaCron batch request at
// half of TentaCron's server.max_body_bytes default (10 MiB). Every group
// carries the model's weather, so a large model's groups need several requests.
const batchBodyBudget = 5 << 20

// SubmitGroups submits every group, with series kept, in as many TentaCron
// batch requests as batchBodyBudget needs. Each group's idempotency key covers
// its buildings' request keys and the model id, so a restarted run gets the
// same jobs back.
func (c *Client) SubmitGroups(ctx context.Context, groups []Group, weather json.RawMessage, startDate, endDate string, resolution int, modelID string) ([]GroupJob, error) {
	return c.submitGroups(ctx, groups, weather, startDate, endDate, resolution, modelID, batchBodyBudget)
}

func (c *Client) submitGroups(ctx context.Context, groups []Group, weather json.RawMessage, startDate, endDate string, resolution int, modelID string, budget int) ([]GroupJob, error) {
	items := make([]tentacron.BatchItem, len(groups))
	sizes := make([]int, len(groups))
	for i, g := range groups {
		payload, err := batchPayload(g.Buildings, weather, startDate, endDate, resolution, modelID, true)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("group %d payload: %w", i, err)
		}
		key, err := contenthash.Of(map[string]any{"model_id": modelID, "keys": g.Keys})
		if err != nil {
			return nil, fmt.Errorf("group %d idempotency key: %w", i, err)
		}
		items[i] = tentacron.BatchItem{Target: targetBuildings, Payload: json.RawMessage(encoded), IdempotencyKey: key}
		sizes[i] = len(encoded)
	}
	jobs := make([]GroupJob, 0, len(groups))
	for _, span := range batchSpans(sizes, budget, tentacron.MaxBatchItems) {
		results, err := c.tc.SubmitBatch(ctx, items[span[0]:span[1]])
		if err != nil {
			return nil, err
		}
		for i, r := range results {
			jobs = append(jobs, GroupJob{Group: groups[span[0]+i], ID: r.ID, Err: r.Err})
		}
	}
	return jobs, nil
}

// batchSpans splits items of the given sizes, in order, into [start, end)
// spans of at most maxItems whose sizes sum to at most budget. An item larger
// than budget gets a span of its own.
func batchSpans(sizes []int, budget, maxItems int) [][2]int {
	var spans [][2]int
	start, total := 0, 0
	for i, size := range sizes {
		if i > start && (total+size > budget || i-start == maxItems) {
			spans = append(spans, [2]int{start, i})
			start, total = i, 0
		}
		total += size
	}
	if start < len(sizes) {
		spans = append(spans, [2]int{start, len(sizes)})
	}
	return spans
}

// AwaitGroup waits for a submitted group and returns one result per building.
func (c *Client) AwaitGroup(ctx context.Context, job GroupJob) ([]BuildingResult, error) {
	var results []BuildingResult
	if err := c.tc.AwaitJSON(ctx, targetBuildings, job.ID, runTimeout, &results); err != nil {
		return nil, asBuemError(err)
	}
	return results, nil
}

// Groups splits buildings and their keys into groups of at most size.
func Groups(buildings []Building, keys []string, size int) []Group {
	var groups []Group
	for start := 0; start < len(buildings); start += size {
		end := min(start+size, len(buildings))
		groups = append(groups, Group{Buildings: buildings[start:end], Keys: keys[start:end]})
	}
	return groups
}
