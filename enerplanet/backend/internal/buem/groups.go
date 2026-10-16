package buem

import (
	"context"
	"encoding/json"
	"fmt"

	"spatialhub_backend/internal/contenthash"
	"spatialhub_backend/internal/tentacron"
)

// GroupSize is how many buildings one BuEM job carries when series are kept.
// One building-year of series measures ~666 KB against TentaCron's 10 MiB
// response cap, so ten leave headroom.
const GroupSize = 10

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

// SubmitGroups submits every group, with series kept, in one TentaCron batch.
// Each group's idempotency key covers its buildings' request keys and the
// model id, so a restarted run gets the same jobs back.
func (c *Client) SubmitGroups(ctx context.Context, groups []Group, weather json.RawMessage, startDate, endDate string, resolution int, modelID string) ([]GroupJob, error) {
	items := make([]tentacron.BatchItem, len(groups))
	for i, g := range groups {
		payload, err := batchPayload(g.Buildings, weather, startDate, endDate, resolution, modelID, true)
		if err != nil {
			return nil, err
		}
		key, err := contenthash.Of(map[string]any{"model_id": modelID, "keys": g.Keys})
		if err != nil {
			return nil, fmt.Errorf("group %d idempotency key: %w", i, err)
		}
		items[i] = tentacron.BatchItem{Target: targetBuildings, Payload: payload, IdempotencyKey: key}
	}
	results, err := c.tc.SubmitBatch(ctx, items)
	if err != nil {
		return nil, err
	}
	jobs := make([]GroupJob, len(groups))
	for i, r := range results {
		jobs[i] = GroupJob{Group: groups[i], ID: r.ID, Err: r.Err}
	}
	return jobs, nil
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
