package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/models"

	tentacronclient "spatialhub_backend/internal/tentacron"
)

// fakePypsaTentacron is a fake TentaCron whose meme target accepts one submit,
// long-polls a job to completed, and serves its stored result zip.
type fakePypsaTentacron struct {
	t              *testing.T
	srv            *httptest.Server
	submitted      atomic.Int32
	gotTarget      string
	gotPayload     map[string]interface{}
	gotIdempotency string
	jobID          string
	fakeZip        []byte
}

func newFakePypsaTentacron(t *testing.T, jobID string, fakeZip []byte) *fakePypsaTentacron {
	f := &fakePypsaTentacron{t: t, jobID: jobID, fakeZip: fakeZip}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serveHTTP))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakePypsaTentacron) serveHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
		f.submitted.Add(1)
		f.gotIdempotency = r.Header.Get("Idempotency-Key")
		var req struct {
			Target  string                 `json:"target"`
			Payload map[string]interface{} `json:"payload"`
		}
		require.NoError(f.t, json.NewDecoder(r.Body).Decode(&req))
		f.gotTarget = req.Target
		f.gotPayload = req.Payload
		w.WriteHeader(http.StatusAccepted)
		_, _ = fmt.Fprintf(w, `{"id":%q}`, f.jobID)
	case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/"+f.jobID:
		_, _ = w.Write([]byte(`{"state":"completed","result":{"target_status":200,"href":"` + "/v1/requests/" + f.jobID + `/result"}}`))
	case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/"+f.jobID+"/result":
		_, _ = w.Write(f.fakeZip)
	default:
		f.t.Fatalf("unexpected %s %s", r.Method, r.URL)
	}
}

func (f *fakePypsaTentacron) URL() string { return f.srv.URL }

// fakePypsaRuns is an in-memory memeLegRunStore recording the PyPSA-leg saves.
type fakePypsaRuns struct {
	calliope *models.ModelMemeRun
	rec      *models.ModelMemeRun
}

func (f *fakePypsaRuns) SaveLeg(modelID uint, leg, runID, status string) error {
	f.rec = &models.ModelMemeRun{ModelID: modelID, Leg: leg, RunID: runID, Status: status}
	return nil
}
func (f *fakePypsaRuns) UpdateStatusLeg(modelID uint, leg, status, errMsg string) error {
	if f.rec == nil || f.rec.Leg != leg {
		return nil
	}
	f.rec.Status = status
	var e *string
	if errMsg != "" {
		e = &errMsg
	}
	f.rec.Error = e
	return nil
}
func (f *fakePypsaRuns) GetLeg(modelID uint, leg string) (*models.ModelMemeRun, error) {
	switch leg {
	case models.MemeLegCalliope:
		return f.calliope, nil
	}
	return f.rec, nil
}

// fakeCalliopeLocator returns a caller-provided csv dir (a temp dir with the
// flow CSVs written by writeFlowCSVs).
type fakeCalliopeLocator struct {
	csvDir string
}

func (f *fakeCalliopeLocator) CalliopeCSVDir(_ context.Context, modelID uint) (string, error) {
	return f.csvDir, nil
}

// fakePypsaEnqueuer records the ingest it is asked to enqueue.
type fakePypsaEnqueuer struct {
	enqueued []IngestMemePyPSAResultPayload
}

func (f *fakePypsaEnqueuer) EnqueueIngestMemePyPSA(_ context.Context, p IngestMemePyPSAResultPayload) error {
	f.enqueued = append(f.enqueued, p)
	return nil
}

func pypsaDispatchTask(t *testing.T, modelID uint) *asynq.Task {
	pb, err := json.Marshal(DispatchMemePyPSAPayload{ModelID: modelID, UserID: "u1"})
	require.NoError(t, err)
	return asynq.NewTask(TypeDispatchMemePyPSA, pb)
}

// modelRows is the standard sqlmock rows for a netherlands model.
func modelRows(modelID uint) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "user_id", "user_email", "title", "country", "region", "from_date", "to_date", "resolution", "config"}).
		AddRow(int64(modelID), "u1", "a@b.c", "Test model", "netherlands", nil,
			time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2018, 1, 2, 0, 0, 0, 0, time.UTC), 60, []byte(memeTopologyConfig))
}

// writeFlowCSVs writes a Calliope flow CSV pair into root and returns the dir.
func writeFlowCSVs(t *testing.T, root string) string {
	t.Helper()
	dir := root + "/csv"
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(dir+"/results_flow_out.csv", []byte(`nodes,techs,carriers,timesteps,flow_out
nb1,pv_supply_1,electricity,2020-01-01T00:00:00,1000
nb1,pv_supply_1,electricity,2020-01-01T01:00:00,2000
`), 0o644))
	require.NoError(t, os.WriteFile(dir+"/results_flow_in.csv", []byte(`nodes,techs,carriers,timesteps,flow_in
nb1,demand_1,electricity,2020-01-01T00:00:00,500
nb1,demand_1,electricity,2020-01-01T01:00:00,300
`), 0o644))
	return dir
}

func TestReadFlowCSV_buildsIndexAlignedCarrierSeries(t *testing.T) {
	dir := writeFlowCSVs(t, t.TempDir())

	prod, n, err := readFlowCSV(dir, "results_flow_out.csv", "flow_out")
	require.NoError(t, err)
	require.Equal(t, 2, n, "two distinct timesteps")
	require.Len(t, prod, 1)
	s := prod[0]
	require.Equal(t, "nb1", s.FromLocation)
	require.Equal(t, "pv_supply_1", s.Tech)
	require.Len(t, s.Timeseries, 2)
	require.InDelta(t, 1000, s.Timeseries[0], 1e-9)
	require.InDelta(t, 2000, s.Timeseries[1], 1e-9)

	con, cn, err := readFlowCSV(dir, "results_flow_in.csv", "flow_in")
	require.NoError(t, err)
	require.Equal(t, 2, cn)
	require.Len(t, con, 1)
	require.InDelta(t, 500, con[0].Timeseries[0], 1e-9)
}

func TestReadFlowCSV_groupsMultiTechAndSkipsMalformedRows(t *testing.T) {
	root := t.TempDir()
	dir := root + "/csv"
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(dir+"/results_flow_out.csv", []byte(`nodes,techs,carriers,timesteps,flow_out
n1,pv_supply_1,electricity,2020-01-01T00:00:00,10
not-a-number-row
n1,wind_onshore_1,electricity,2020-01-01T00:00:00,20
n1,pv_supply_1,electricity,2020-01-01T01:00:00,5
`), 0o644))

	prod, n, err := readFlowCSV(dir, "results_flow_out.csv", "flow_out")
	require.NoError(t, err)
	require.Equal(t, 2, n)
	require.Len(t, prod, 2, "the malformed row is skipped, the two techs survive")
	// Deterministic key order: "nb" prefix -> "n1pv..." vs "n1wind..." sorts by
	// full "node\x00tech" key: "n1\x00pv_supply_1" < "n1\x00wind_onshore_1".
	require.Equal(t, "pv_supply_1", prod[0].Tech)
	require.InDelta(t, 10, prod[0].Timeseries[0], 1e-9)
	require.InDelta(t, 5, prod[0].Timeseries[1], 1e-9)
}

func TestPypsaPowerFlow_dropsLineTechsAndSlacksGridImport(t *testing.T) {
	// Regression for the model-34 symptom: results_flow_out.csv carries the
	// connecting-line techs (lv_X_trafo_82) in BOTH files. Those must NOT become
	// per-node generators that cancel the node's own demand (flat 1.0, zero
	// flow). Only the real supply (grid_trafo_82_import, flow_out-only) survives
	// as the network slack on the transformer's MV bus; the lv_* techs and the
	// grid export are dropped; the demands stay loads.
	root := t.TempDir()
	dir := root + "/csv"
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(dir+"/results_flow_out.csv", []byte(`nodes,techs,carriers,timesteps,flow_out
ntrafo_82,grid_trafo_82_import,electricity,2020-01-01T00:00:00,10
n1,lv_1_trafo_82,electricity,2020-01-01T00:00:00,5
ntrafo_82,lv_1_trafo_82,electricity,2020-01-01T00:00:00,5
`), 0o644))
	require.NoError(t, os.WriteFile(dir+"/results_flow_in.csv", []byte(`nodes,techs,carriers,timesteps,flow_in
n1,demand_1,electricity,2020-01-01T00:00:00,5
n1,lv_1_trafo_82,electricity,2020-01-01T00:00:00,5
ntrafo_82,lv_1_trafo_82,electricity,2020-01-01T00:00:00,5
ntrafo_82,grid_trafo_82_export,electricity,2020-01-01T00:00:00,0
`), 0o644))

	// Topology: one building (1) connected to a transformer (trafo_82) — the
	// transformer's bus name lands on the MV side as "ntrafo_82_mv".
	calc := map[string]interface{}{
		"topology": []interface{}{
			map[string]interface{}{
				"from": map[string]interface{}{"id": "1"},
				"to": map[string]interface{}{
					"id": "trafo_82",
					"properties": map[string]interface{}{
						"feature_type": "TopologyNode",
						"f_class":      "transformer",
						"rated_power":  400000.0,
					},
				},
				"length": 0.05,
				"pipe":   "lv",
			},
		},
		"pypsa": map[string]interface{}{},
	}
	calcBytes, err := json.Marshal(calc)
	require.NoError(t, err)

	pf, err := pypsaPowerFlowFromBytes(calcBytes, dir)
	require.NoError(t, err)

	// Only the grid import survives as a generator; the lv_1_trafo_82 line tech
	// must be dropped (it is a Line, not a gen).
	require.Len(t, pf.Generators, 1, "line techs must not become generators")
	gen := pf.Generators[0]
	require.Equal(t, "ntrafo_82_mv", gen.Bus, "grid import lands on the trafo MV bus")
	require.Equal(t, "Slack", gen.Control, "grid import is the reference/slack")
	require.InDelta(t, 10, gen.PSet[0], 1e-9)

	// Only the demand stays a load (grid export is a separate zero-valued flow_in
	// sink on the trafo node — kept, harmless; the line inflow was dropped).
	require.Len(t, pf.Loads, 2, "demand_1 + the zero grid export sink")
	require.Equal(t, "n1", pf.Loads[0].Bus)
	require.InDelta(t, 5, pf.Loads[0].PSet[0], 1e-9)

	// The line itself still exists in the topology (buses n1 <-> ntrafo_82).
	require.Len(t, pf.Lines, 1)
	require.Len(t, pf.Buses, 3, "n1, ntrafo_82 (LV), ntrafo_82_mv (MV)")
}

func TestHandleDispatchMemePyPSA_endToEndInjectsPowerFlowAndDispatches(t *testing.T) {
	const modelID = uint(42)
	fakeZip := []byte("PK\x03\x04simulated-meme-pypsa-result\x00tail\xff")
	fake := newFakePypsaTentacron(t, "job-pypsa-42", fakeZip)
	runs := &fakePypsaRuns{}
	runs.calliope = &models.ModelMemeRun{ModelID: modelID, Leg: models.MemeLegCalliope, RunID: "job-calliope", Status: models.MemeRunStatusCompleted}

	db, _ := newDispatchMockDB(t, modelRows(modelID))

	root := t.TempDir()
	csvDir := writeFlowCSVs(t, root)
	locator := &fakeCalliopeLocator{csvDir: csvDir}
	store := NewFilesystemResultZipStore(root)
	enq := &fakePypsaEnqueuer{}

	err := HandleDispatchMemePyPSA(context.Background(), pypsaDispatchTask(t, modelID), db, tentacronclient.New(fake.URL(), "k"), runs, store, locator, enq)
	require.NoError(t, err)

	// The T1K job reached the isolated PyPSA-only target, with a leg-scoped
	// Idempotency-Key and exactly one submit.
	require.Equal(t, memeTargetPyPSAOnly, fake.gotTarget)
	require.Contains(t, fake.gotPayload, "power_flow", "the pass output is embedded in the job body")
	require.Equal(t, "model_42_pypsa", fake.gotIdempotency, "Idempotency-Key is pypsa-leg + model scoped")
	require.EqualValues(t, 1, fake.submitted.Load())

	// The power_flow block carries the pass's generators/loads (p_set from the
	// flow CSVs, scaled by the pass at build time).
	pf, _ := fake.gotPayload["power_flow"].(map[string]interface{})
	require.NotNil(t, pf, "power_flow block present")
	if pf != nil {
		gens, _ := pf["generators"].([]interface{})
		loads, _ := pf["loads"].([]interface{})
		require.Greater(t, len(gens), 0, "generators p_set injected")
		require.Greater(t, len(loads), 0, "loads p_set injected")
	}

	// The PyPSA-leg run was saved (never the Calliope record).
	require.NotNil(t, runs.rec)
	require.Equal(t, models.MemeLegPyPSA, runs.rec.Leg)
	require.Equal(t, "job-pypsa-42", runs.rec.RunID)
	require.Equal(t, "running", runs.rec.Status, "dispatch leaves the pypsa run running; the ingest owns terminal")

	// The zip landed as the leg-keyed sim_<id>_pypsa.zip (the exact path the
	// ingest was enqueued for).
	require.Len(t, enq.enqueued, 1)
	zipPath := enq.enqueued[0].ZipPath
	assert.Contains(t, filepath.Base(zipPath), "sim_42_pypsa.zip", "the stored zip is leg-keyed")
	got, err := os.ReadFile(zipPath)
	require.NoError(t, err)
	assert.Equal(t, fakeZip, got, "the fetched MEME pypsa zip is stored verbatim")

	require.Equal(t, modelID, enq.enqueued[0].ModelID)
}

func TestHandleDispatchMemePyPSA_gateRefusesWithoutCompletedCalliope(t *testing.T) {
	const modelID = uint(42)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("no TentaCron call expected, got %s %s", r.Method, r.URL)
	}))
	defer srv.Close()

	db, _ := newDispatchMockDB(t, modelRows(modelID))
	root := t.TempDir()
	locator := &fakeCalliopeLocator{csvDir: writeFlowCSVs(t, root)}

	// The Calliope leg ran but never completed -> the gate refuses.
	runs := &fakePypsaRuns{}
	runs.calliope = &models.ModelMemeRun{ModelID: modelID, Leg: models.MemeLegCalliope, RunID: "job-calliope", Status: models.MemeRunStatusRunning}

	err := HandleDispatchMemePyPSA(context.Background(), pypsaDispatchTask(t, modelID), db, tentacronclient.New(srv.URL, "k"), runs, NewFilesystemResultZipStore(t.TempDir()), locator, &fakePypsaEnqueuer{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "calliope leg must be completed")
}

func TestHandleDispatchMemePyPSA_missingBundleIsError(t *testing.T) {
	const modelID = uint(42)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("no TentaCron call expected, got %s %s", r.Method, r.URL)
	}))
	defer srv.Close()

	db, _ := newDispatchMockDB(t, modelRows(modelID))

	// Calliope completed but the locator cannot find the bundle -> dispatch fails.
	runs := &fakePypsaRuns{}
	runs.calliope = &models.ModelMemeRun{ModelID: modelID, Leg: models.MemeLegCalliope, RunID: "job-calliope", Status: models.MemeRunStatusCompleted}
	locator := &fakeCalliopeLocator{csvDir: "does-not-exist"}

	err := HandleDispatchMemePyPSA(context.Background(), pypsaDispatchTask(t, modelID), db, tentacronclient.New(srv.URL, "k"), runs, NewFilesystemResultZipStore(t.TempDir()), locator, &fakePypsaEnqueuer{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "calliope")
}
