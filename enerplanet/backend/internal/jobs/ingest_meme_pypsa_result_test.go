package jobs

import (
	"context"
	"encoding/json"
	"fmt"
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

// fakePypsaIngester is an in-memory PyPSAIngester recording the zip it was
// asked to ingest; set `err` to force a failure.
type fakePypsaIngester struct {
	called  int
	modelID uint
	zipPath string
	summary *resultservice.PyPSASummary
	err     error
}

func (f *fakePypsaIngester) IngestPyPSAResult(_ context.Context, modelID uint, userID, zipPath string) (*resultservice.PyPSASummary, error) {
	f.called++
	f.modelID = modelID
	f.zipPath = zipPath
	if f.err != nil {
		return nil, f.err
	}
	if f.summary != nil {
		return f.summary, nil
	}
	return &resultservice.PyPSASummary{}, nil
}

// fakePypsaIngestRuns is an in-memory memeLegRunStore recording the PYPSA-leg
// terminal transitions.
type fakePypsaIngestRuns struct {
	leg    string
	status string
	errMsg string
}

func (f *fakePypsaIngestRuns) SaveLeg(modelID uint, leg, runID, status string) error {
	return nil
}
func (f *fakePypsaIngestRuns) UpdateStatusLeg(modelID uint, leg, status, errMsg string) error {
	f.leg = leg
	f.status = status
	f.errMsg = errMsg
	return nil
}
func (f *fakePypsaIngestRuns) GetLeg(modelID uint, leg string) (*models.ModelMemeRun, error) {
	return nil, nil
}

// newPypsaIngestMockDB returns a permissive gorm DB. The model-status UPDATE
// (markModelCompleted/Failed) is logged-not-fatal when unanticipated, so the
// handler's own transitions (via the injected fake ingester + fake runs) are
// what the tests assert.
func newPypsaIngestMockDB(t *testing.T) *gorm.DB {
	t.Helper()
	dbConn, _, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, _ string) error { return nil })),
	)
	require.NoError(t, err)
	t.Cleanup(func() { dbConn.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: dbConn}), &gorm.Config{SkipDefaultTransaction: true})
	require.NoError(t, err)
	return db
}

func pypsaIngestTask(t *testing.T, zipPath string) *asynq.Task {
	t.Helper()
	b, err := json.Marshal(IngestMemePyPSAResultPayload{ModelID: 7, UserID: "u1", ZipPath: zipPath})
	require.NoError(t, err)
	return asynq.NewTask(TypeIngestMemePyPSAResult, b)
}

func TestHandleIngestMemePyPSAResult_successCompletesPypsaLeg(t *testing.T) {
	db := newPypsaIngestMockDB(t)

	runs := &fakePypsaIngestRuns{}
	ingester := &fakePypsaIngester{}
	err := HandleIngestMemePyPSAResult(context.Background(), pypsaIngestTask(t, "/tmp/sim_7_pypsa.zip"), db, runs, ingester)
	require.NoError(t, err)

	require.Equal(t, 1, ingester.called, "the stored pypsa zip is ingested once")
	assert.Equal(t, "/tmp/sim_7_pypsa.zip", ingester.zipPath)
	assert.Equal(t, uint(7), ingester.modelID)

	// The PyPSA leg reaches terminal 'completed' with no error; the model is
	// marked completed via markModelCompleted.
	require.Equal(t, models.MemeLegPyPSA, runs.leg)
	require.Equal(t, models.MemeRunStatusCompleted, runs.status)
	require.Equal(t, "", runs.errMsg)
}

func TestHandleIngestMemePyPSAResult_nonConvergenceStillCompletes(t *testing.T) {
	db := newPypsaIngestMockDB(t)

	// A bundle whose PF did not converge (or was cleared) is a NORMAL outcome:
	// the ingester returns success (it never treats non-convergence as a parse
	// error), so the model still completes.
	runs := &fakePypsaIngestRuns{}
	ingester := &fakePypsaIngester{summary: &resultservice.PyPSASummary{Converged: false}}
	err := HandleIngestMemePyPSAResult(context.Background(), pypsaIngestTask(t, "/tmp/sim_7_pypsa.zip"), db, runs, ingester)
	require.NoError(t, err)
	require.Equal(t, models.MemeRunStatusCompleted, runs.status)
}

func TestHandleIngestMemePyPSAResult_ingestFailureIsError(t *testing.T) {
	db := newPypsaIngestMockDB(t)

	runs := &fakePypsaIngestRuns{}
	ingester := &fakePypsaIngester{err: fmt.Errorf("could not parse pypsa bundle")}
	err := HandleIngestMemePyPSAResult(context.Background(), pypsaIngestTask(t, "/tmp/sim_7_pypsa.zip"), db, runs, ingester)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ingest MEME pypsa result")

	// Zero masking: a failed ingest marks the PYPSA leg terminal 'failed' with
	// the captured error and returns it so it surfaces once.
	require.Equal(t, models.MemeLegPyPSA, runs.leg)
	require.Equal(t, models.MemeRunStatusFailed, runs.status)
	require.NotEmpty(t, runs.errMsg)
}
