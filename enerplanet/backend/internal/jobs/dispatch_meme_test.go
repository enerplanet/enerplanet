package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"spatialhub_backend/internal/models"

	tentacronclient "spatialhub_backend/internal/tentacron"
)

// newDispatchMockDB returns a gorm DB backed by sqlmock. QueryMatcherFunc
// matches any statement touching the models table regardless of gorm's exact
// SQL (soft-delete predicate, parameterized LIMIT) and arg shape, so the test
// only cares that the handler loaded the row it expects.
func newDispatchMockDB(t *testing.T, rows *sqlmock.Rows) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	dbConn, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, actualSQL string) error {
			if !strings.Contains(actualSQL, `FROM "models"`) && !strings.Contains(actualSQL, `"model_meme_runs"`) {
				return errors.New("expected a models or model_meme_runs query")
			}
			return nil
		})),
	)
	require.NoError(t, err)
	t.Cleanup(func() { dbConn.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: dbConn}), &gorm.Config{})
	require.NoError(t, err)
	mock.ExpectQuery("`").WillReturnRows(rows)
	return db, mock
}

// memeTopologyConfig is a model Config whose "topology" is the same
// electricity-only topology the T1K unit test translates cleanly — a
// transformer pair plus one residential building. This lets the dispatch test
// run the real BuildCalculationPayload -> TranslatePayload spine without a
// running MEME.
var memeTopologyConfig = `{"topology":[
  {"from":{
     "type":"Feature","geometry":{"type":"Point","coordinates":[6.02745,52.10148]},
     "id":"trafo_1","properties":{"id":"trafo_1","osm_id":"Trafo_1","feature_type":"TopologyNode","f_class":"transformer","demand_energy":0,"demand_heat":0,"rated_power":160},
     "techs":null,"custom_demand_timeseries":null},
   "to":{
     "type":"Feature","geometry":{"type":"Point","coordinates":[6.03102,52.10355]},
     "id":"trafo_2","properties":{"id":"trafo_2","osm_id":"Trafo_2","feature_type":"TopologyNode","f_class":"transformer","demand_energy":0,"demand_heat":0,"rated_power":250},
     "techs":null,"custom_demand_timeseries":null},
   "length":0.18,"pipe":"mv"},
  {"from":{
     "type":"Feature","geometry":{"type":"Point","coordinates":[6.02745,52.10148]},
     "id":"b1","properties":{"id":"b1","osm_id":"268428040","feature_type":"BasePOI","f_class":"house","demand_energy":3745,"demand_heat":5803,"area":72.53},
     "techs":null,"custom_demand_timeseries":null},
   "to":{
     "type":"Feature","geometry":{"type":"Point","coordinates":[6.02732,52.10132]},
     "id":"trafo_1","properties":{"id":"trafo_1","osm_id":"Trafo_1","feature_type":"TopologyNode","f_class":"transformer","demand_energy":0,"demand_heat":0,"rated_power":160},
     "techs":null,"custom_demand_timeseries":null},
   "length":0.0182,"pipe":"lv"}
]}`

// fakeMemeTentacron is a fake TentaCron whose meme target accepts one submit,
// long-polls a job to completed, and serves its stored result zip via
// GET /v1/requests/{id}/result. After submit it records whether a resubmit
// happens.
type fakeMemeTentacron struct {
	t              *testing.T
	srv            *httptest.Server
	submitted      atomic.Int32
	gotTarget      string
	gotPayload     map[string]interface{}
	gotIdempotency string
	jobID          string
	fakeZip        []byte
}

func newFakeMemeTentacron(t *testing.T, jobID string, fakeZip []byte) *fakeMemeTentacron {
	f := &fakeMemeTentacron{t: t, jobID: jobID, fakeZip: fakeZip}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serveHTTP))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeMemeTentacron) serveHTTP(w http.ResponseWriter, r *http.Request) {
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

func (f *fakeMemeTentacron) URL() string { return f.srv.URL }

// fakeMemeRuns is a threadsafe in-memory memeRunStore so the handler's
// persist/resume behaviour can be asserted without sqlmock juggling.
type fakeMemeRuns struct {
	t     *testing.T
	rec   *models.ModelMemeRun
	saved []models.ModelMemeRun
}

func (f *fakeMemeRuns) Save(modelID uint, runID, status string) error {
	f.rec = &models.ModelMemeRun{ModelID: modelID, RunID: runID, Status: status}
	f.saved = append(f.saved, *f.rec)
	return nil
}
func (f *fakeMemeRuns) UpdateStatus(modelID uint, status, errMsg string) error {
	if f.rec == nil {
		f.t.Fatalf("UpdateStatus before Save")
	}
	f.rec.Status = status
	var e *string
	if errMsg != "" {
		e = &errMsg
	}
	f.rec.Error = e
	return nil
}
func (f *fakeMemeRuns) Get(modelID uint) (*models.ModelMemeRun, error) {
	if f.rec == nil {
		return nil, nil
	}
	return f.rec, nil
}

func dispatchPost(t *testing.T, modelID uint) *asynq.Task {
	pb, err := json.Marshal(DispatchMemePayload{ModelID: modelID, UserID: "u1"})
	require.NoError(t, err)
	return asynq.NewTask(TypeDispatchMeme, pb)
}

// fakeIngestMemeEnqueuer records the ingest it is asked to enqueue so the
// dispatch handler can be tested without Redis.
type fakeIngestMemeEnqueuer struct {
	enqueued []IngestMemeResultPayload
}

func (f *fakeIngestMemeEnqueuer) EnqueueIngestMeme(_ context.Context, p IngestMemeResultPayload) error {
	f.enqueued = append(f.enqueued, p)
	return nil
}

func TestHandleDispatchMeme_endToEndStoresZip(t *testing.T) {
	const modelID = uint(42)
	fakeZip := []byte("PK\x03\x04simulated-meme-result\x00tail\xff")
	fake := newFakeMemeTentacron(t, "job-42", fakeZip)
	runs := &fakeMemeRuns{t: t}

	country := "netherlands"
	rows := sqlmock.NewRows([]string{"id", "user_id", "user_email", "title", "country", "region", "from_date", "to_date", "resolution", "config"}).
		AddRow(int64(modelID), "u1", "a@b.c", "Test model", country, nil,
			time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2018, 1, 2, 0, 0, 0, 0, time.UTC), 60, []byte(memeTopologyConfig))
	db, _ := newDispatchMockDB(t, rows)

	base := t.TempDir()
	store := NewFilesystemResultZipStore(base)
	enq := &fakeIngestMemeEnqueuer{}

	err := HandleDispatchMeme(context.Background(), dispatchPost(t, modelID), db, tentacronclient.New(fake.URL(), "k"), runs, store, enq)
	require.NoError(t, err)

	// The T1K job (as a generic object) reached the Calliope-only target, with an
	// Idempotency-Key header and exactly one submit.
	require.Equal(t, "meme-calliope", fake.gotTarget)
	require.Contains(t, fake.gotPayload, "model")
	require.Contains(t, fake.gotPayload, "experiment")
	// No run recorded (first solve) and no CalculationStartedAt in the fixtures,
	// so the run-scoped key falls back to the bare per-model key.
	require.Equal(t, "model_42", fake.gotIdempotency, "Idempotency-Key is model-scoped on a first solve")
	require.EqualValues(t, 1, fake.submitted.Load(), "exactly one submit on a fresh dispatch")

	// The TentaCron job id was persisted per model. Dispatch leaves the run
	// 'running' — it does NOT pre-mark 'completed'; the terminal transition is
	// owned by the ingest handler (completed on parse success, failed on parse
	// failure), which runs after dispatch enqueues it.
	require.NotNil(t, runs.rec)
	require.Equal(t, "job-42", runs.rec.RunID)
	require.Equal(t, "running", runs.rec.Status, "dispatch leaves the run running; the ingest owns the terminal state")

	// The zip landed under storage/data/model_<id>_<unix>/sim_<id>.zip.
	entries, err := os.ReadDir(base)
	require.NoError(t, err)
	require.Len(t, entries, 1, "one model run dir")
	assert.Contains(t, entries[0].Name(), "model_42_")
	path := base + "/" + entries[0].Name() + "/sim_42.zip"
	got, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, fakeZip, got, "the fetched MEME zip is stored verbatim")

	// The ingest (Step 6) is enqueued for the stored zip path so the R2 tables
	// are populated from the zip via Coati.
	require.Len(t, enq.enqueued, 1, "one ingest enqueued per dispatch")
	assert.Equal(t, modelID, enq.enqueued[0].ModelID)
	assert.Equal(t, path, enq.enqueued[0].ZipPath)
}

func TestHandleDispatchMeme_retryResumesByIDNoResubmit(t *testing.T) {
	const modelID = uint(42)
	fakeZip := []byte("PK\x03\x04second-attempt-zip\x00ff")
	fake := newFakeMemeTentacron(t, "job-42", fakeZip)

	country := "netherlands"
	rows := sqlmock.NewRows([]string{"id", "user_id", "user_email", "title", "country", "region", "from_date", "to_date", "resolution", "config"}).
		AddRow(int64(modelID), "u1", "a@b.c", "Test model", country, nil,
			time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2018, 1, 2, 0, 0, 0, 0, time.UTC), 60, []byte(memeTopologyConfig))
	db, _ := newDispatchMockDB(t, rows)

	// Simulate a first attempt that persisted the job id but died before
	// storing the result (e.g. a transient failure after submit). status
	// "running" (non-terminal) -> the retry must RESUME by id, not resubmit.
	runs := &fakeMemeRuns{t: t}
	require.NoError(t, runs.Save(modelID, "job-42", "running"))

	err := HandleDispatchMeme(context.Background(), dispatchPost(t, modelID), db, tentacronclient.New(fake.URL(), "k"), runs, NewFilesystemResultZipStore(t.TempDir()), &fakeIngestMemeEnqueuer{})
	require.NoError(t, err)
	require.EqualValues(t, 0, fake.submitted.Load(), "retry resumes by id, never resubmits (no duplicate MEME job)")
	require.Equal(t, "running", runs.rec.Status, "a resumed run stays running; the ingest owns the terminal completed/failed transition")
}

func TestHandleDispatchMeme_terminalRunResubmitsFreshWithRunScopedKey(t *testing.T) {
	const modelID = uint(42)
	fakeZip := []byte("PK\x03\x04re-solve-zip\x00ff")
	fake := newFakeMemeTentacron(t, "job-42-v2", fakeZip)

	// The model already has a run in a TERMINAL state ('failed': dispatch or
	// ingest failed) plus a fresh CalculationStartedAt set by StartCalculation.
	// A recorded terminal run can only be a USER-INITIATED re-solve, which must
	// FRESH-submit a new MEME solve, never resume the old one.
	startedAt := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)

	country := "netherlands"
	rows := sqlmock.NewRows([]string{"id", "user_id", "user_email", "title", "country", "region", "from_date", "to_date", "resolution", "config", "calculation_started_at"}).
		AddRow(int64(modelID), "u1", "a@b.c", "Test model", country, nil,
			time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2018, 1, 2, 0, 0, 0, 0, time.UTC), 60, []byte(memeTopologyConfig), startedAt)
	db, _ := newDispatchMockDB(t, rows)

	runs := &fakeMemeRuns{t: t}
	require.NoError(t, runs.Save(modelID, "job-42-v1", "failed"))

	err := HandleDispatchMeme(context.Background(), dispatchPost(t, modelID), db, tentacronclient.New(fake.URL(), "k"), runs, NewFilesystemResultZipStore(t.TempDir()), &fakeIngestMemeEnqueuer{})
	require.NoError(t, err)

	// A fresh MEME solve was submitted, keyed run-scoped by CalculationStartedAt
	// (so TentaCron creates a NEW job despite the unchanged payload), and the
	// recorded run was overwritten with the new job id.
	require.EqualValues(t, 1, fake.submitted.Load(), "terminal run re-solves by fresh-submit, exactly once")
	expectedKey := fmt.Sprintf("model_%d_%d", modelID, startedAt.UnixMilli())
	require.Equal(t, expectedKey, fake.gotIdempotency, "re-solve uses a run-scoped Idempotency-Key (new TentaCron job)")
	require.Equal(t, "job-42-v2", runs.rec.RunID, "the recorded run is overwritten with the new job id")
	require.Equal(t, "running", runs.rec.Status, "the re-solved run is running; the ingest owns the terminal transition")
}

func TestHandleDispatchMeme_missingCountryIsAnError(t *testing.T) {
	const modelID = uint(9)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("no TentaCron call expected, got %s %s", r.Method, r.URL)
	}))
	defer srv.Close()

	// No country set -> payload.BuildCalculationPayload returns ErrMissingCountry.
	rows := sqlmock.NewRows([]string{"id", "user_id", "user_email", "title", "country", "from_date", "to_date", "config"}).
		AddRow(int64(modelID), "u1", "a@b.c", "No country", nil,
			time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2018, 1, 2, 0, 0, 0, 0, time.UTC), []byte(`{}`))
	db, _ := newDispatchMockDB(t, rows)

	err := HandleDispatchMeme(context.Background(), dispatchPost(t, modelID), db, tentacronclient.New(srv.URL, "k"), &fakeMemeRuns{t: t}, NewFilesystemResultZipStore(t.TempDir()), &fakeIngestMemeEnqueuer{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "country", "missing-country surfaces clearly")
}