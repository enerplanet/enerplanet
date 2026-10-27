package jobs

import (
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// fakeLiveTasks is a task queue holding tasks for the given models.
type fakeLiveTasks map[uint]bool

func (f fakeLiveTasks) LiveModelIDs() (map[uint]bool, error) { return f, nil }

func orphanMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	conn, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: conn}), &gorm.Config{})
	require.NoError(t, err)
	return db, mock
}

// A backend that stops mid-run leaves its model in a run status with no task;
// only such a model is failed, not one whose task is still queued or running.
func TestFailOrphanedRuns_failsOnlyModelsWithoutALiveTask(t *testing.T) {
	db, mock := orphanMockDB(t)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "id" FROM "models" WHERE status IN ($1,$2,$3) AND webservice_id IS NULL AND updated_at < $4`)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7).AddRow(9))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "models" SET`)).WithArgs(
		sqlmock.AnyArg(), sqlmock.AnyArg(), "", "failed", sqlmock.AnyArg(), uint(9), "queue", "running", "processing",
	).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	failed, err := FailOrphanedRuns(db, fakeLiveTasks{7: true}, time.Now())

	require.NoError(t, err)
	assert.Equal(t, []uint{9}, failed, "model 7 still has a task; model 9 has none")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestFailOrphanedRuns_nothingInARunStatus(t *testing.T) {
	db, mock := orphanMockDB(t)
	mock.ExpectQuery(`SELECT "id" FROM "models"`).WillReturnRows(sqlmock.NewRows([]string{"id"}))

	failed, err := FailOrphanedRuns(db, failingLiveTasks{}, time.Now())

	require.NoError(t, err, "the task queue is not read when no model is in a run status")
	assert.Empty(t, failed)
}

// failingLiveTasks is a task queue that cannot be read.
type failingLiveTasks struct{}

func (failingLiveTasks) LiveModelIDs() (map[uint]bool, error) {
	return nil, errors.New("redis unreachable")
}

func TestFailOrphanedRuns_unreadableQueueFailsNothing(t *testing.T) {
	db, mock := orphanMockDB(t)
	mock.ExpectQuery(`SELECT "id" FROM "models"`).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(9))

	failed, err := FailOrphanedRuns(db, failingLiveTasks{}, time.Now())

	require.Error(t, err)
	assert.Empty(t, failed, "without knowing the live tasks, no model is failed")
	assert.NoError(t, mock.ExpectationsWereMet())
}
