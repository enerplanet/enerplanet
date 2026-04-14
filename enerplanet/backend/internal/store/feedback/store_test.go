package feedback

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"platform.local/common/pkg/models"
	"spatialhub_backend/internal/testutil"
)

func TestNewStore(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	store := NewStore(db)
	assert.NotNil(t, store)
}

func TestGetFeedbackByID(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "user_id", "subject", "status"}).
		AddRow(1, "user-1", "Bug Report", "open")
	mock.ExpectQuery(`SELECT \* FROM "feedbacks" WHERE "feedbacks"\."id" = \$1 AND "feedbacks"\."deleted_at" IS NULL`).
		WithArgs(1, 1).
		WillReturnRows(rows)

	fb, err := store.GetFeedbackByID(1)
	require.NoError(t, err)
	assert.Equal(t, uint(1), fb.ID)
	assert.Equal(t, "Bug Report", fb.Subject)
}

func TestGetFeedbackByID_NotFound(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectQuery(`SELECT \* FROM "feedbacks" WHERE "feedbacks"\."id" = \$1 AND "feedbacks"\."deleted_at" IS NULL`).
		WithArgs(999, 1).
		WillReturnRows(sqlmock.NewRows(nil))

	_, err := store.GetFeedbackByID(999)
	assert.Error(t, err)
}

func TestCreateFeedback(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO "feedbacks"`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	mock.ExpectCommit()

	fb := &models.Feedback{
		UserID:  "user-1",
		Subject: "Test Feedback",
	}
	err := store.CreateFeedback(fb)
	require.NoError(t, err)
}

func TestDeleteFeedback(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	// Soft-delete: UPDATE SET deleted_at
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "feedbacks" SET "deleted_at"=`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := store.DeleteFeedback(1)
	require.NoError(t, err)
}

func TestUpdateFeedback(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "feedbacks" SET`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := store.UpdateFeedback(1, map[string]interface{}{"status": "resolved"})
	require.NoError(t, err)
}

func TestFiltersAndPagination(t *testing.T) {
	f := Filters{Status: "open", Category: "bug", Priority: "high"}
	assert.Equal(t, "open", f.Status)
	assert.Equal(t, "bug", f.Category)

	p := PaginationParams{Page: 1, PerPage: 20}
	assert.Equal(t, 1, p.Page)
	assert.Equal(t, 20, p.PerPage)
}

func TestBuildListResponse(t *testing.T) {
	feedbacks := []models.Feedback{{}, {}, {}}
	resp := buildListResponse(feedbacks, 10, PaginationParams{Page: 1, PerPage: 3})
	assert.Equal(t, int64(10), resp.Total)
	assert.Equal(t, 1, resp.Page)
	assert.Equal(t, 3, resp.PerPage)
	assert.Equal(t, 4, resp.TotalPages)
	assert.Len(t, resp.Data, 3)
}
