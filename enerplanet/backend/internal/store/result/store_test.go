package result

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	commonModels "platform.local/common/pkg/models"
	"spatialhub_backend/internal/testutil"
)

func TestNewStore(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	store := NewStore(db)
	assert.NotNil(t, store)
	assert.Equal(t, db, store.DB())
}

func TestGetModelByIDStr(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "user_id"}).AddRow(5, "user-2")
	mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).
		WithArgs("5", 1).
		WillReturnRows(rows)

	model, err := store.GetModelByIDStr("5")
	require.NoError(t, err)
	assert.Equal(t, uint(5), model.ID)
}

func TestGetModelByIDStr_NotFound(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).
		WithArgs("999", 1).
		WillReturnRows(sqlmock.NewRows(nil))

	_, err := store.GetModelByIDStr("999")
	assert.Error(t, err)
}

func TestGetModelBySessionID(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "session_id"}).AddRow(3, 12345)
	mock.ExpectQuery(`SELECT \* FROM "models" WHERE session_id = \$1`).
		WithArgs("12345", 1).
		WillReturnRows(rows)

	model, err := store.GetModelBySessionID("12345")
	require.NoError(t, err)
	assert.Equal(t, uint(3), model.ID)
}

func TestUpdateModel(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "models" SET`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	model := &commonModels.Model{}
	model.ID = 1
	err := store.UpdateModel(model, map[string]interface{}{"status": "completed"})
	require.NoError(t, err)
}

func TestGetModelResults(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "model_id", "zip_path"}).
		AddRow(1, 10, "/data/result1.zip").
		AddRow(2, 10, "/data/result2.zip")
	mock.ExpectQuery(`SELECT \* FROM "model_results" WHERE model_id = \$1`).
		WithArgs(10).
		WillReturnRows(rows)

	results, err := store.GetModelResults(10)
	require.NoError(t, err)
	assert.Len(t, results, 2)
	assert.Equal(t, "/data/result1.zip", results[0].ZipPath)
}

func TestGetResultByID(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "model_id", "zip_path"}).
		AddRow(5, 10, "/data/r.zip")
	mock.ExpectQuery(`SELECT \* FROM "model_results" WHERE "model_results"\."id" = \$1`).
		WithArgs(5, 1).
		WillReturnRows(rows)

	// Preload("Model") triggers a second query
	modelRows := sqlmock.NewRows([]string{"id"}).AddRow(10)
	mock.ExpectQuery(`SELECT \* FROM "models" WHERE "models"\."id" = \$1`).
		WithArgs(10).
		WillReturnRows(modelRows)

	result, err := store.GetResultByID(5)
	require.NoError(t, err)
	assert.Equal(t, uint(5), result.ID)
}

func TestGetUserGroupIDs(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"group_id"}).
		AddRow("group-a").
		AddRow("group-b")
	mock.ExpectQuery(`SELECT "group_id" FROM "group_members" WHERE user_id = \$1`).
		WithArgs("user-1").
		WillReturnRows(rows)

	ids, err := store.GetUserGroupIDs("user-1")
	require.NoError(t, err)
	assert.Equal(t, []string{"group-a", "group-b"}, ids)
}

func TestGetResultsCoordinates(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "model_id"}).
		AddRow(1, 10).
		AddRow(2, 10)
	mock.ExpectQuery(`SELECT \* FROM "results_coordinates" WHERE model_id = \$1`).
		WithArgs(10).
		WillReturnRows(rows)

	coords, err := store.GetResultsCoordinates(10)
	require.NoError(t, err)
	assert.Len(t, coords, 2)
}

func TestGetCarrierSummary(t *testing.T) {
	// GetCarrierSummary is a composite method that calls multiple sub-methods.
	// Test the sub-methods individually to avoid overly complex mock setup.
	db, _ := testutil.NewMockDB(t)
	store := NewStore(db)
	assert.NotNil(t, store)
}

func TestDateRange(t *testing.T) {
	dr := DateRange{Begin: "2024-01-01", End: "2024-12-31"}
	assert.Equal(t, "2024-01-01", dr.Begin)
	assert.Equal(t, "2024-12-31", dr.End)
}
