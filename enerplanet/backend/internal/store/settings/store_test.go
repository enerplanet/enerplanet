package settings

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

func TestGetOrCreateUserSettings_Existing(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "user_id", "email", "privacy_accepted", "theme", "language"}).
		AddRow(1, "user-1", "user@example.com", true, "system", "en")
	mock.ExpectQuery(`SELECT \* FROM "user_settings" WHERE user_id = \$1`).
		WithArgs("user-1", 1).
		WillReturnRows(rows)

	settings, err := store.GetOrCreateUserSettings("user-1", "user@example.com")
	require.NoError(t, err)
	assert.Equal(t, "user-1", settings.UserID)
	assert.Equal(t, "user@example.com", settings.Email)
}

func TestGetOrCreateUserSettings_EmailMismatch(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "user_id", "email", "privacy_accepted", "theme", "language"}).
		AddRow(1, "user-1", "old@example.com", true, "system", "en")
	mock.ExpectQuery(`SELECT \* FROM "user_settings" WHERE user_id = \$1`).
		WithArgs("user-1", 1).
		WillReturnRows(rows)

	// Should update the email
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "user_settings" SET`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	settings, err := store.GetOrCreateUserSettings("user-1", "new@example.com")
	require.NoError(t, err)
	assert.Equal(t, "new@example.com", settings.Email)
}

func TestSaveUserSettings(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "user_settings" SET`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	settings := &models.UserSetting{}
	settings.ID = 1
	settings.UserID = "user-1"
	settings.Email = "user@example.com"

	err := store.SaveUserSettings(settings)
	require.NoError(t, err)
}
