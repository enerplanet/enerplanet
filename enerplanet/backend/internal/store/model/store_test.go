package model

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

func TestFindByID(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "user_id", "title", "status"}).
		AddRow(1, "user-123", "Test Model", "draft")

	mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).
		WithArgs("1", 1). // $1 = "1", $2 = 1 (limit)
		WillReturnRows(rows)

	model, err := store.FindByID("1")
	require.NoError(t, err)
	assert.Equal(t, uint(1), model.ID)
	assert.Equal(t, "user-123", model.UserID)
	assert.Equal(t, "Test Model", model.Title)
}

func TestFindByID_NotFound(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).
		WithArgs("999", 1).
		WillReturnRows(sqlmock.NewRows(nil))

	_, err := store.FindByID("999")
	assert.Error(t, err)
}

func TestCountByUserID(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"count"}).AddRow(5)
	mock.ExpectQuery(`SELECT count\(\*\) FROM "models" WHERE \(user_id = \$1 AND deleted_at IS NULL\) AND "models"\."deleted_at" IS NULL`).
		WithArgs("user-123").
		WillReturnRows(rows)

	count, err := store.CountByUserID("user-123")
	require.NoError(t, err)
	assert.Equal(t, int64(5), count)
}

func TestCountByUserIDAndStatus(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"count"}).AddRow(3)
	mock.ExpectQuery(`SELECT count\(\*\) FROM "models" WHERE \(user_id = \$1 AND status = \$2 AND deleted_at IS NULL\) AND "models"\."deleted_at" IS NULL`).
		WithArgs("user-123", "completed").
		WillReturnRows(rows)

	count, err := store.CountByUserIDAndStatus("user-123", "completed")
	require.NoError(t, err)
	assert.Equal(t, int64(3), count)
}

func TestIsDefaultWorkspace(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	t.Run("is default", func(t *testing.T) {
		rows := sqlmock.NewRows([]string{"id", "user_id", "is_default"}).
			AddRow(10, "user-1", true)
		mock.ExpectQuery(`SELECT \* FROM "workspaces" WHERE user_id = \$1 AND is_default = \$2 AND id = \$3`).
			WithArgs("user-1", true, 10, 1).
			WillReturnRows(rows)

		result, err := store.IsDefaultWorkspace("user-1", 10)
		require.NoError(t, err)
		assert.True(t, result)
	})

	t.Run("not default", func(t *testing.T) {
		mock.ExpectQuery(`SELECT \* FROM "workspaces" WHERE user_id = \$1 AND is_default = \$2 AND id = \$3`).
			WithArgs("user-1", true, 20, 1).
			WillReturnRows(sqlmock.NewRows(nil))

		result, err := store.IsDefaultWorkspace("user-1", 20)
		require.NoError(t, err)
		assert.False(t, result)
	})
}

func TestIsWorkspaceSharedWithUser(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"count"}).AddRow(1)
	mock.ExpectQuery(`SELECT count\(\*\) FROM "workspace_members" WHERE workspace_id = \$1 AND LOWER\(email\) = LOWER\(\$2\)`).
		WithArgs(10, "user@example.com").
		WillReturnRows(rows)

	assert.True(t, store.IsWorkspaceSharedWithUser(10, "user@example.com"))
}

func TestIsWorkspaceSharedWithUserGroups(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	t.Run("shared via group", func(t *testing.T) {
		rows := sqlmock.NewRows([]string{"count"}).AddRow(1)
		mock.ExpectQuery(`SELECT count\(\*\) FROM "workspace_groups" WHERE workspace_id = \$1 AND group_id IN \(\$2,\$3\)`).
			WithArgs(10, "g1", "g2").
			WillReturnRows(rows)

		assert.True(t, store.IsWorkspaceSharedWithUserGroups(10, []string{"g1", "g2"}))
	})
}

func TestUpdate(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "models" SET`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	model := &commonModels.Model{}
	model.ID = 1
	err := store.Update(model, map[string]interface{}{"title": "Updated"})
	require.NoError(t, err)
}

func TestHardDelete(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "models" WHERE`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	model := &commonModels.Model{}
	model.ID = 1
	err := store.HardDelete(model)
	require.NoError(t, err)
}

func TestGetDefaultWorkspace(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "user_id", "is_default", "name"}).
		AddRow(10, "user-1", true, "My Default")
	mock.ExpectQuery(`SELECT \* FROM "workspaces" WHERE user_id = \$1 AND is_default = \$2`).
		WithArgs("user-1", true, 1).
		WillReturnRows(rows)

	ws, err := store.GetDefaultWorkspace("user-1")
	require.NoError(t, err)
	assert.Equal(t, "My Default", ws.Name)
	assert.True(t, ws.IsDefault)
}

func TestCountWorkspaceOwner(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"count"}).AddRow(1)
	mock.ExpectQuery(`SELECT count\(\*\) FROM "workspaces" WHERE id = \$1 AND user_id = \$2`).
		WithArgs(10, "user-1").
		WillReturnRows(rows)

	assert.Equal(t, int64(1), store.CountWorkspaceOwner(10, "user-1"))
}

func TestCountWorkspaceMember(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"count"}).AddRow(1)
	mock.ExpectQuery(`SELECT count\(\*\) FROM "workspace_members" WHERE workspace_id = \$1 AND user_id = \$2`).
		WithArgs(10, "user-1").
		WillReturnRows(rows)

	assert.Equal(t, int64(1), store.CountWorkspaceMember(10, "user-1"))
}
