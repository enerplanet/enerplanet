package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/sirupsen/logrus"

	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/demand"
	"spatialhub_backend/internal/store/series"
)

// groupAwaitLimit caps how many BuEM groups one model waits on at once; the
// groups themselves run in TentaCron within its per-client limit.
const groupAwaitLimit = 4

// seriesStore is the series persistence resolveSeries needs. Satisfied by
// *series.Store; faked in tests.
type seriesStore interface {
	StoredKeys(keys []string) (map[string]int64, error)
	Save(p series.NewProfile) (int64, error)
	Profiles(ids []int64) (map[int64]series.StoredProfile, error)
	Link(owner series.Owner, revision string, links []series.Link) error
}

// groupRunner submits and awaits BuEM building groups. Satisfied by
// *buem.Client; faked in tests.
type groupRunner interface {
	SubmitGroups(ctx context.Context, groups []buem.Group, weather json.RawMessage, startDate, endDate string, resolution int, modelID string) ([]buem.GroupJob, error)
	AwaitGroup(ctx context.Context, job buem.GroupJob) ([]buem.BuildingResult, error)
}

// seriesOutcome is one model's resolution: the stored profile, its summary
// and series names for each resolved building, and the reason for each
// building that failed.
type seriesOutcome struct {
	profiles map[string]int64
	stored   map[int64]series.StoredProfile
	failed   map[string]string
}

// resolveSeries gives every building in run a stored profile: a lookup when
// its request key is stored, otherwise a BuEM run in groups. A result
// reporting a version other than buemVersion is not stored.
func resolveSeries(ctx context.Context, log *logrus.Entry, run buemRun, resolution int, modelID, buemVersion string, store seriesStore, runner groupRunner) (seriesOutcome, error) {
	shared, err := buem.NewSharedInputs(run.weather, run.start, run.end, resolution, buemVersion)
	if err != nil {
		return seriesOutcome{}, err
	}
	out := seriesOutcome{profiles: map[string]int64{}, failed: map[string]string{}}
	keyed, keys := requestKeys(run.buildings, shared, out.failed)
	stored, err := store.StoredKeys(keys)
	if err != nil {
		return seriesOutcome{}, err
	}
	var toRun []buem.Building
	var toRunKeys []string
	for i, b := range keyed {
		if id, ok := stored[keys[i]]; ok {
			out.profiles[b.ID] = id
			continue
		}
		toRun, toRunKeys = append(toRun, b), append(toRunKeys, keys[i])
	}
	log.Infof("model %s: %d buildings stored already, %d to run through BuEM", modelID, len(out.profiles), len(toRun))
	if len(toRun) > 0 {
		groups := buem.Groups(toRun, toRunKeys, buem.GroupSize)
		runGroups(ctx, log, groups, run, resolution, modelID, buemVersion, store, runner, &out)
	}
	return out, loadStoredProfiles(store, &out)
}

// requestKeys keys every building, returning the keyed buildings and their
// keys in the same order; one that cannot be keyed is recorded in failed.
func requestKeys(buildings []buem.Building, shared buem.SharedInputs, failed map[string]string) ([]buem.Building, []string) {
	var keyed []buem.Building
	var keys []string
	for _, b := range buildings {
		k, err := buem.RequestKey(b, shared)
		if err != nil {
			failed[b.ID] = fmt.Sprintf("could not key the BuEM request: %v", err)
			continue
		}
		keyed, keys = append(keyed, b), append(keys, k)
	}
	return keyed, keys
}

// runGroups submits groups in one batch and waits on at most groupAwaitLimit
// at a time, storing each result as its group finishes.
func runGroups(ctx context.Context, log *logrus.Entry, groups []buem.Group, run buemRun, resolution int, modelID, buemVersion string, store seriesStore, runner groupRunner, out *seriesOutcome) {
	jobs, err := runner.SubmitGroups(ctx, groups, run.weather, run.start, run.end, resolution, modelID)
	if err != nil {
		for _, g := range groups {
			failGroup(out, nil, g, fmt.Sprintf("BuEM submission failed: %v", err))
		}
		return
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, groupAwaitLimit)
	for _, job := range jobs {
		wg.Add(1)
		slots <- struct{}{}
		go func(job buem.GroupJob) {
			defer wg.Done()
			defer func() { <-slots }()
			awaitGroup(ctx, log, job, run, buemVersion, store, runner, out, &mu)
		}(job)
	}
	wg.Wait()
}

// awaitGroup waits for one group and stores each of its results.
func awaitGroup(ctx context.Context, log *logrus.Entry, job buem.GroupJob, run buemRun, buemVersion string, store seriesStore, runner groupRunner, out *seriesOutcome, mu *sync.Mutex) {
	if job.Err != nil {
		failGroup(out, mu, job.Group, fmt.Sprintf("BuEM group not accepted: %v", job.Err))
		return
	}
	results, err := runner.AwaitGroup(ctx, job)
	if err != nil {
		failGroup(out, mu, job.Group, fmt.Sprintf("BuEM group failed: %v", err))
		return
	}
	byID := make(map[string]buem.BuildingResult, len(results))
	for _, r := range results {
		byID[r.ID] = r
	}
	for i, b := range job.Group.Buildings {
		id, reason := demand.StoreResult(byID[b.ID], job.Group.Keys[i], buemVersion, store)
		mu.Lock()
		if reason != "" {
			out.failed[b.ID] = reason
			log.Warnf("building %s: %s", b.ID, reason)
		} else {
			out.profiles[b.ID] = id
		}
		mu.Unlock()
	}
}

func failGroup(out *seriesOutcome, mu *sync.Mutex, g buem.Group, reason string) {
	if mu != nil {
		mu.Lock()
		defer mu.Unlock()
	}
	for _, b := range g.Buildings {
		out.failed[b.ID] = reason
	}
}

// loadStoredProfiles reads the summary and series names of every resolved
// building's profile, needed to link it and to fill its demand profile row.
func loadStoredProfiles(store seriesStore, out *seriesOutcome) error {
	ids := make([]int64, 0, len(out.profiles))
	for _, id := range out.profiles {
		ids = append(ids, id)
	}
	stored, err := store.Profiles(ids)
	if err != nil {
		return err
	}
	out.stored = stored
	return nil
}
