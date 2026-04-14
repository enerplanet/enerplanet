package location

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/testutil"
)

func TestNewStore(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	store := NewStore(db)
	assert.NotNil(t, store)
}

func TestGetLocationByID(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "user_id", "title"}).
		AddRow(1, "user-1", "Berlin Office")
	mock.ExpectQuery(`SELECT \* FROM "custom_locations" WHERE "custom_locations"\."id" = \$1`).
		WithArgs(1, 1).
		WillReturnRows(rows)

	loc, err := store.GetLocationByID(1)
	require.NoError(t, err)
	assert.Equal(t, uint(1), loc.ID)
	assert.Equal(t, "Berlin Office", loc.Title)
}

func TestGetLocationByID_NotFound(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectQuery(`SELECT \* FROM "custom_locations" WHERE "custom_locations"\."id" = \$1`).
		WithArgs(999, 1).
		WillReturnRows(sqlmock.NewRows(nil))

	_, err := store.GetLocationByID(999)
	assert.Error(t, err)
}

func TestNewShareStore(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	store := NewShareStore(db)
	assert.NotNil(t, store)
}

func TestDeleteLocation(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	// First GetLocationByID
	rows := sqlmock.NewRows([]string{"id", "user_id", "title"}).
		AddRow(1, "user-1", "Test Location")
	mock.ExpectQuery(`SELECT \* FROM "custom_locations" WHERE "custom_locations"\."id" = \$1`).
		WithArgs(1, 1).
		WillReturnRows(rows)

	// Then soft-delete via Update status
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "custom_locations" SET`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := store.DeleteLocation(1, "user-1")
	require.NoError(t, err)
}
