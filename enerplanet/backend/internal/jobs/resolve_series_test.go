package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/store/series"
)

// memStore keeps profiles and links in memory, with the store's keep-first
// behaviour on Save.
type memStore struct {
	mu       sync.Mutex
	byKey    map[string]int64
	profiles map[int64]series.NewProfile
	links    []series.Link
	saves    int
}

func newMemStore() *memStore {
	return &memStore{byKey: map[string]int64{}, profiles: map[int64]series.NewProfile{}}
}

func (m *memStore) StoredKeys(keys []string) (map[string]int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]int64{}
	for _, k := range keys {
		if id, ok := m.byKey[k]; ok {
			out[k] = id
		}
	}
	return out, nil
}

func (m *memStore) Save(p series.NewProfile) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.saves++
	if id, ok := m.byKey[p.Key]; ok {
		return id, nil
	}
	id := int64(len(m.byKey) + 1)
	m.byKey[p.Key], m.profiles[id] = id, p
	return id, nil
}

func (m *memStore) Profiles(ids []int64) (map[int64]series.StoredProfile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[int64]series.StoredProfile{}
	for _, id := range ids {
		p := m.profiles[id]
		var names []string
		for name := range p.Series {
			names = append(names, name)
		}
		out[id] = series.StoredProfile{Summary: p.Summary, SeriesNames: names, StartTime: p.StartTime, ResolutionMinutes: p.ResolutionMinutes}
	}
	return out, nil
}

func (m *memStore) Values(id int64, name string) (models.SeriesValues, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.profiles[id].Series[name]
	if !ok {
		return models.SeriesValues{}, fmt.Errorf("profile %d has no series %s", id, name)
	}
	return models.SeriesValues{ProfileID: id, Series: name, Unit: d.Unit, Vals: d.Values}, nil
}

func (m *memStore) Link(_ series.Owner, _ string, links []series.Link) error {
	m.links = append(m.links, links...)
	return nil
}

// fakeRunner answers every group with one result per building; reject, fail
// and version decide which buildings or groups go wrong.
type fakeRunner struct {
	mu        sync.Mutex
	submitted []buem.Group
	submitErr error
	rejectAll bool
	errorFor  map[string]bool
	version   string
}

func (f *fakeRunner) SubmitGroups(_ context.Context, groups []buem.Group, _ json.RawMessage, _, _ string, _ int, _ string) ([]buem.GroupJob, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.submitErr != nil {
		return nil, f.submitErr
	}
	f.submitted = append(f.submitted, groups...)
	jobs := make([]buem.GroupJob, len(groups))
	for i, g := range groups {
		jobs[i] = buem.GroupJob{Group: g, ID: fmt.Sprintf("req-%d", i)}
		if f.rejectAll {
			jobs[i].Err = errors.New("queue_full")
		}
	}
	return jobs, nil
}

func (f *fakeRunner) AwaitGroup(_ context.Context, job buem.GroupJob) ([]buem.BuildingResult, error) {
	var out []buem.BuildingResult
	for _, b := range job.Group.Buildings {
		if f.errorFor[b.ID] {
			out = append(out, buem.BuildingResult{ID: b.ID, Error: "BuEM rejected the envelope"})
			continue
		}
		block := fmt.Sprintf(`{"thermal_load_profile": {"start_time": "1900-01-01T00:00:00Z", "resolution": 60,
			"summary": {}, "timeseries": {"unit": "kW", "heating": [1, 2], "electricity": [0.5, 0.5]}},
			"model_metadata": {"model_version": %q, "model_commit": "abc"}}`, f.version)
		out = append(out, buem.BuildingResult{ID: b.ID, BUEM: json.RawMessage(block)})
	}
	return out, nil
}

func testRun(n int) buemRun {
	run := buemRun{resolved: map[string]BuemResolutionMeta{}, weather: json.RawMessage(`{"T": [1]}`),
		start: "1900-01-01T00:00:00Z", end: "1900-12-31T23:00:00Z"}
	for i := range n {
		id := fmt.Sprintf("b%02d", i)
		run.buildings = append(run.buildings, buem.Building{ID: id, Geometry: json.RawMessage(`{}`), Building: json.RawMessage(`{}`)})
		run.resolved[id] = BuemResolutionMeta{}
	}
	return run
}

var quiet = logrus.NewEntry(logrus.New())

func TestResolveSeries_RunsMissesInGroupsAndReusesStoredOnes(t *testing.T) {
	store, runner := newMemStore(), &fakeRunner{version: "6.10.0"}
	first, err := resolveSeries(context.Background(), quiet, testRun(25), 60, "7", "6.10.0", store, runner)
	require.NoError(t, err)
	assert.Len(t, first.profiles, 25)
	assert.Empty(t, first.failed)
	assert.Len(t, runner.submitted, 7, "25 buildings in groups of 4")
	assert.ElementsMatch(t, []string{"electricity", "heating"}, first.stored[first.profiles["b00"]].SeriesNames)

	runner.submitted = nil
	second, err := resolveSeries(context.Background(), quiet, testRun(25), 60, "8", "6.10.0", store, runner)
	require.NoError(t, err)
	assert.Empty(t, runner.submitted, "every key is stored, so nothing runs")
	assert.Equal(t, first.profiles, second.profiles)
}

func TestResolveSeries_FailsOnlyTheAffectedBuildings(t *testing.T) {
	store, runner := newMemStore(), &fakeRunner{version: "6.10.0", errorFor: map[string]bool{"b03": true}}
	out, err := resolveSeries(context.Background(), quiet, testRun(5), 60, "7", "6.10.0", store, runner)
	require.NoError(t, err)
	assert.Len(t, out.profiles, 4)
	assert.Contains(t, out.failed["b03"], "BuEM rejected the envelope")
}

func TestResolveSeries_VersionMismatchIsNotStored(t *testing.T) {
	store, runner := newMemStore(), &fakeRunner{version: "6.9.0"}
	out, err := resolveSeries(context.Background(), quiet, testRun(2), 60, "7", "6.10.0", store, runner)
	require.NoError(t, err)
	assert.Empty(t, out.profiles)
	assert.Contains(t, out.failed["b00"], `BuEM reports version "6.9.0"`)
	assert.Empty(t, store.byKey, "a result keyed for another version must not be stored")
}

func TestResolveSeries_RejectedOrUnsubmittedGroupsFailTheirBuildings(t *testing.T) {
	out, err := resolveSeries(context.Background(), quiet, testRun(3), 60, "7", "6.10.0", newMemStore(), &fakeRunner{rejectAll: true})
	require.NoError(t, err)
	assert.Len(t, out.failed, 3)
	assert.Contains(t, out.failed["b00"], "not accepted")

	out, err = resolveSeries(context.Background(), quiet, testRun(3), 60, "7", "6.10.0", newMemStore(), &fakeRunner{submitErr: errors.New("tentacron down")})
	require.NoError(t, err)
	assert.Len(t, out.failed, 3)
	assert.Contains(t, out.failed["b02"], "tentacron down")
}

func TestResolveSeries_RequiresVersion(t *testing.T) {
	_, err := resolveSeries(context.Background(), quiet, testRun(1), 60, "7", "", newMemStore(), &fakeRunner{})
	assert.Error(t, err)
}

func TestLinkSeries_CustomisedBuildingsLinkAsUser(t *testing.T) {
	store, runner := newMemStore(), &fakeRunner{version: "6.10.0"}
	run := testRun(2)
	run.resolved["b01"] = BuemResolutionMeta{Customised: true}
	out, err := resolveSeries(context.Background(), quiet, run, 60, "7", "6.10.0", store, runner)
	require.NoError(t, err)

	require.NoError(t, linkSeries(store, 7, "rev", run.resolved, out))
	sources := map[string]string{}
	for _, l := range store.links {
		sources[l.BuildingRef] = l.Source
	}
	assert.Equal(t, map[string]string{"b00": "default", "b01": "user"}, sources)
	assert.Len(t, store.links, 4, "two series per building")
}
