package jobs

import (
	"archive/zip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"spatialhub_backend/internal/models"
	resultservice "spatialhub_backend/internal/result/service"
)

// fakeCoatiRunner returns a fixed Coati document and records the file+framework
// it was asked to convert.
type fakeCoatiRunner struct {
	frameworkID string
	resultFile  string
	calls       int
	docJSON     string
}

func (f *fakeCoatiRunner) Convert(_ context.Context, resultFile, frameworkID string) ([]byte, error) {
	f.calls++
	f.resultFile = resultFile
	f.frameworkID = frameworkID
	if f.docJSON != "" {
		return []byte(f.docJSON), nil
	}
	// Minimal single-location, single-tech document by default.
	return []byte(`{
	  "schema_version":"1.0","framework":"calliope","framework_version":"0.7.0.dev7",
	  "success":true,"termination_condition":"optimal","objective":1234.5,
	  "coordinates":{"n1":[48.8,12.9]},
	  "capacities":{"n1::battery":12.0},
	  "storage_capacities":{"n1::battery":52.0},
	  "costs_by_location":{"n1":{"battery":786.0}}
	}`), nil
}

// fakeIngestRuns is an in-memory memeRunStore recording the handler's status
// transitions, so the ingest tests assert self-healing without sqlmock juggling.
type fakeIngestRuns struct {
	status  string
	errMsg  string
	current *models.ModelMemeRun
}

func (f *fakeIngestRuns) Save(modelID uint, runID, status string) error {
	f.current = &models.ModelMemeRun{ModelID: modelID, RunID: runID, Status: status}
	return nil
}
func (f *fakeIngestRuns) UpdateStatus(modelID uint, status, errMsg string) error {
	f.status = status
	f.errMsg = errMsg
	return nil
}
func (f *fakeIngestRuns) Get(modelID uint) (*models.ModelMemeRun, error) {
	return f.current, nil
}

// newIngestMockDB returns a gorm DB whose sqlmock accepts any statement (the
// ingest writes many fixed tables), with expectations pre-seeded for Step 6's
// exact write surface: one transaction containing 21 R2-table DELETEs + the
// small-table INSERTs, then one model.results UPDATE. deleteCounts are the
// number of DELETEs (default the full R2 table set).
func newIngestMockDB(t *testing.T, insertCount int) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	dbConn, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, _ string) error { return nil })),
	)
	require.NoError(t, err)
	t.Cleanup(func() { dbConn.Close() })
	// SkipDefaultTransaction keeps the final model.results UPDATE a single
	// Exec instead of gorm's implicit Begin/Commit wrapper, so the mock's
	// statement sequence (21 DELETEs + N returning-INSERTs + 1 UPDATE) is exact.
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: dbConn}), &gorm.Config{SkipDefaultTransaction: true})
	require.NoError(t, err)

	const deleteTables = 21 // deleteExistingResults table count
	mock.ExpectBegin()
	// 21 DELETEs (deleteExistingResults) are Execs carrying WHERE model_id.
	for i := 0; i < deleteTables; i++ {
		mock.ExpectExec("").WillReturnResult(sqlmock.NewResult(0, 1))
	}
	// The small-table INSERTs go through gorm's CreateInBatches, which on
	// postgres emits INSERT ... RETURNING "id" to populate the row's primary
	// key — so each is a Query, not an Exec.
	for i := 0; i < insertCount; i++ {
		mock.ExpectQuery("").WillReturnRows(sqlmock.NewRows(nil))
	}
	mock.ExpectCommit()
	mock.ExpectExec("").WillReturnResult(sqlmock.NewResult(0, 1)) // model.results UPDATE (outside the transaction)
	return db, mock
}

// writeMemeZip writes a single-target MEME zip carrying files/run_0/output/results.nc.
func writeMemeZip(t *testing.T, root string) string {
	t.Helper()
	zipPath := filepath.Join(root, "sim_7.zip")
	fh, err := os.Create(zipPath)
	require.NoError(t, err)
	defer fh.Close()
	w := zip.NewWriter(fh)

	entry, err := w.Create("files/run_0/output/results.nc")
	require.NoError(t, err)
	_, err = entry.Write([]byte("netcdf-placeholder-not-read-by-go"))
	require.NoError(t, err)

	meta, err := w.Create("metadata.json")
	require.NoError(t, err)
	_, err = meta.Write([]byte(`{"target":"calliope","state":"succeeded"}`))
	require.NoError(t, err)

	require.NoError(t, w.Close())
	return zipPath
}

func ingestTask(t *testing.T, zipPath string) *asynq.Task {
	t.Helper()
	b, err := json.Marshal(IngestMemeResultPayload{ModelID: 7, UserID: "u1", ZipPath: zipPath})
	require.NoError(t, err)
	return asynq.NewTask(TypeIngestMemeResult, b)
}

func TestHandleIngestMemeResult_RunsCoatiAndSeedsR2(t *testing.T) {
	root := t.TempDir()
	zipPath := writeMemeZip(t, root) // self-contained zip, no real .nc required

	// The fixture maps to: 1 coordinate, 1 loc_tech, 1 energy_cap batch (capacity
	// + storage), 1 cost -> 4 INSERTs inside the store transaction.
	db, mock := newIngestMockDB(t, 4)

	runner := &fakeCoatiRunner{}
	runs := &fakeIngestRuns{}
	err := HandleIngestMemeResult(context.Background(), ingestTask(t, zipPath), db, runs, runner)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())

	// A successful parse-once ingest leaves the run 'completed' with no error
	// (any prior error from a failed parse is cleared).
	require.Equal(t, models.MemeRunStatusCompleted, runs.status)
	require.Equal(t, "", runs.errMsg)

	// Coati was driven over the located results.nc with the Calliope id.
	require.Equal(t, 1, runner.calls)
	assert.Equal(t, resultservice.CoatiFrameworkCalliope07, runner.frameworkID)
	assert.True(t, strings.HasSuffix(runner.resultFile, "output/results.nc"),
		"runner receives the extracted per-target calliope results.nc, got %s", runner.resultFile)
	// The zip was actually extracted (the .nc file now exists on disk).
	assert.FileExists(t, filepath.Join(root, "files", "run_0", "output", "results.nc"))
}

func TestHandleIngestMemeResult_CoatiFailureIsError(t *testing.T) {
	root := t.TempDir()
	zipPath := writeMemeZip(t, root)

	// A runner that always errors must surface as an ingest failure (no DB writes).
	failRunner := &fakeCoatiRunner{}
	failRunner.docJSON = "{not-json"

	dbConn, _, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { dbConn.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: dbConn}), &gorm.Config{})
	require.NoError(t, err)

	runs := &fakeIngestRuns{}
	err = HandleIngestMemeResult(context.Background(), ingestTask(t, zipPath), db, runs, failRunner)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ingest MEME result")

	// Zero masking: a failed ingest marks the run terminal 'failed' with the
	// captured (Coati-descriptive) error, and returns it so it surfaces once.
	// asynq is configured MaxRetry(0) for this task, so no retry-with-backoff
	// masks the real parse / CLI-missing cause.
	require.Equal(t, models.MemeRunStatusFailed, runs.status)
	require.NotEmpty(t, runs.errMsg, "the captured Coati error is persisted on the failed run")
}