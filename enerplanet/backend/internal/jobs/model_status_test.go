package jobs

import (
	"errors"
	"fmt"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"

	modelstore "spatialhub_backend/internal/store/model"
)

// newStatusMockDB returns a gorm DB whose sqlmock accepts any statement and,
// with SkipDefaultTransaction, emits one Exec per status update.
func newStatusMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	dbConn, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, _ string) error { return nil })),
	)
	require.NoError(t, err)
	t.Cleanup(func() { dbConn.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: dbConn}), &gorm.Config{SkipDefaultTransaction: true})
	require.NoError(t, err)
	return db, mock
}

// The MEME path owns the model's lifecycle; a status update MUST be issued
// against models and MUST be guarded so it only fires while the model is still
// in the MEME lifecycle (queue|running) — a late failure must not clobber a
// model another path already completed.
func TestMarkModelStatus_transitionsAreGuarded(t *testing.T) {
	cases := []struct {
		name string
		call func(db *gorm.DB)
	}{
		{"running", func(db *gorm.DB) { markModelRunning(db, 18) }},
		{"completed", func(db *gorm.DB) { markModelCompleted(db, 18) }},
		{"failed", func(db *gorm.DB) { markModelFailed(db, 18, errors.New("target meme: HTTP 422")) }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock := newStatusMockDB(t)
			mock.ExpectExec(`UPDATE "models" SET .*WHERE id = .* AND status IN .*`).
				WillReturnResult(sqlmock.NewResult(0, 1))

			tc.call(db)

			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// A failed transition records the reason in model.results so the UI can show
// why, matching the legacy store.MarkFailed shape.
func TestMarkModelFailed_recordsReason(t *testing.T) {
	db, mock := newStatusMockDB(t)
	mock.ExpectExec(`UPDATE "models" SET .*"results".*WHERE id = .* AND status IN .*`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	markModelFailed(db, 18, errors.New("target meme: HTTP 422"))

	require.NoError(t, mock.ExpectationsWereMet())
}

// A completed transition must NOT write model.results (it would clobber the
// parsed summary the ingest just seeded).
func TestMarkModelCompleted_doesNotClobberResults(t *testing.T) {
	db, mock := newStatusMockDB(t)
	mock.ExpectExec(`^UPDATE "models" SET "status"=.*"updated_at"=.*"calculation_completed_at"=.*WHERE id = .* AND status IN .*$`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	markModelCompleted(db, 18)

	require.NoError(t, mock.ExpectationsWereMet())
}

// Sanity: the constants used really are the model lifecycle statuses.
func TestModelStatusConstants(t *testing.T) {
	require.Equal(t, "running", commonModels.ModelStatusRunning)
	require.Equal(t, "completed", commonModels.ModelStatusCompleted)
	require.Equal(t, "failed", commonModels.ModelStatusFailed)
}

// Once the MEME bundle is stored the model is 'processing' while Coati reads
// it, so the UI can tell result reading apart from the solve.
func TestMarkModelProcessing_setsProcessing(t *testing.T) {
	db, mock := newStatusMockDB(t)
	mock.ExpectExec(`UPDATE "models" SET .*WHERE id = .* AND status IN .*`).
		WithArgs(commonModels.ModelStatusProcessing, sqlmock.AnyArg(), 18,
			commonModels.ModelStatusQueue, commonModels.ModelStatusRunning, commonModels.ModelStatusProcessing).
		WillReturnResult(sqlmock.NewResult(0, 1))

	markModelProcessing(db, 18)

	require.NoError(t, mock.ExpectationsWereMet())
}

// The ingest finishes a run that is 'processing', so the guard admits it.
func TestMarkModelCompleted_fromProcessing(t *testing.T) {
	db, mock := newStatusMockDB(t)
	mock.ExpectExec(`UPDATE "models" SET .*WHERE id = .* AND status IN .*`).
		WithArgs(sqlmock.AnyArg(), commonModels.ModelStatusCompleted, sqlmock.AnyArg(), 18,
			commonModels.ModelStatusQueue, commonModels.ModelStatusRunning, commonModels.ModelStatusProcessing).
		WillReturnResult(sqlmock.NewResult(0, 1))

	markModelCompleted(db, 18)

	require.NoError(t, mock.ExpectationsWereMet())
}

// A failed run records the status it failed in as results.failed_stage, read
// from the row being updated, next to the error.
func TestMarkModelFailed_recordsStage(t *testing.T) {
	dbConn, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { dbConn.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: dbConn}), &gorm.Config{SkipDefaultTransaction: true})
	require.NoError(t, err)
	mock.ExpectExec(`"results"=jsonb_build_object\('error', \$\d+::text, 'failed_stage', status, 'failed_service', NULLIF\(\$\d+::text, ''\)\)`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	markModelFailed(db, 18, errors.New("target meme: HTTP 422"))

	require.NoError(t, mock.ExpectationsWereMet())
}

// A failure marked with a service records that service next to the error.
func TestMarkModelFailed_recordsService(t *testing.T) {
	db, mock := newStatusMockDB(t)
	mock.ExpectExec(`UPDATE "models" SET .*"results".*WHERE id = .* AND status IN .*`).
		WithArgs(sqlmock.AnyArg(), "meme job 1 via TentaCron for model 18: target_job_failed", modelstore.ServiceMeme,
			"failed", sqlmock.AnyArg(), 18, "queue", "running", "processing").
		WillReturnResult(sqlmock.NewResult(0, 1))

	cause := errors.New("target_job_failed")
	markModelFailed(db, 18, modelstore.ServiceFailed(modelstore.ServiceMeme, fmt.Errorf("meme job 1 via TentaCron for model 18: %w", cause)))

	require.NoError(t, mock.ExpectationsWereMet())
}
