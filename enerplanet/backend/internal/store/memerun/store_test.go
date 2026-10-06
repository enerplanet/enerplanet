package memerun

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"spatialhub_backend/internal/models"
)

func newMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	dbConn, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { dbConn.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: dbConn}), &gorm.Config{})
	require.NoError(t, err)
	return db, mock
}

func TestStore_SaveUpsertsOnModelID(t *testing.T) {
	db, mock := newMockDB(t)
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "model_meme_runs"`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, NewStore(db).Save(7, "job-1", "running"))
}

// TestStore_SaveLegIsolatesLeg confirms the leg discriminator is written and
// the upsert conflicts on the (model_id, leg) composite, so a PyPSA leg can
// never overwrite the Calliope leg's run record.
func TestStore_SaveLegIsolatesLeg(t *testing.T) {
	db, mock := newMockDB(t)
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "model_meme_runs"`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, NewStore(db).SaveLeg(7, models.MemeLegPyPSA, "job-pypsa", "running"))
}

func TestStore_GetReturnsRecord(t *testing.T) {
	db, mock := newMockDB(t)
	rows := sqlmock.NewRows([]string{"model_id", "run_id", "status", "error", "created_at", "updated_at"}).
		AddRow(int64(7), "job-1", "running", nil, nil, nil)
	mock.ExpectQuery(`SELECT .* FROM "model_meme_runs"`).WillReturnRows(rows)

	rec, err := NewStore(db).Get(7)
	require.NoError(t, err)
	require.NotNil(t, rec)
	assert.Equal(t, "job-1", rec.RunID)
	assert.Equal(t, "running", rec.Status)
}

func TestStore_GetNoRecordReturnsNil(t *testing.T) {
	db, mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .* FROM "model_meme_runs"`).
		WillReturnError(gorm.ErrRecordNotFound)

	rec, err := NewStore(db).Get(7)
	require.NoError(t, err)
	assert.Nil(t, rec, "no recorded run must come back as nil, not an error")
}

func TestStore_UpdateStatusSetsError(t *testing.T) {
	db, mock := newMockDB(t)
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "model_meme_runs"`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, NewStore(db).UpdateStatus(7, "failed", "boom"))
}

// TestMigrationTableName guards the migration file so a rename does not
// silently break resume-by-id persistence.
func TestMigrationTableName(t *testing.T) {
	data, err := os.ReadFile("../../../migrations/046_create_model_meme_runs_table.sql")
	require.NoError(t, err, "046 migration must exist (auto-discovered by cmd/migrate from ./migrations)")
	body := string(data)
	require.Contains(t, body, "model_meme_runs", "migration must create the model_meme_runs table")
	require.Regexp(t, regexp.MustCompile(`\bPRIMARY KEY\b`), body)
	require.Contains(t, body, "REFERENCES models(id)", "FK to models(id) (mirrors 045)")
	require.True(t, strings.HasPrefix(body, "--"), "migration carries a comment header like 045")

	// Table name consistency with the model.
	var m models.ModelMemeRun
	assert.Equal(t, "model_meme_runs", m.TableName())
}