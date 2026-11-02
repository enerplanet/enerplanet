package model

import (
	"errors"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"platform.local/common/pkg/models"

	"spatialhub_backend/internal/testutil"
)

const (
	countHeadsSQL      = `SELECT count\(\*\) FROM "models" WHERE \(COALESCE\(group_id, parent_model_id, id\) = \$1 AND id <> \$2\) AND "models"."deleted_at" IS NULL`
	familyOptionsQuery = `SELECT DISTINCT ON \(family\) family AS id, title FROM .* WHERE deleted_at IS NULL AND workspace_id IS NOT DISTINCT FROM \$1 AND \(id = \$2 OR parent_model_id = \$3\)`
)

// unlinkedCopy is model 30, copied from model 21 and since unlinked from it.
func unlinkedCopy() *models.Model {
	ws := uint(4)
	parent := uint(21)
	m := &models.Model{WorkspaceID: &ws, ParentModelID: &parent}
	m.ID = 30
	m.GroupID = &m.ID
	return m
}

// The original's family and the family a sibling copy started after it was unlinked.
func lineageFamilies() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "title"}).AddRow(21, "test").AddRow(25, "test v4")
}

func TestFamilyOptions_listsTheFamiliesOfItsOriginal(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(familyOptionsQuery).WithArgs(4, 21, 21, 30).WillReturnRows(lineageFamilies())

	options, err := familyOptions(db, unlinkedCopy())

	require.NoError(t, err)
	assert.Equal(t, []FamilyOption{{ID: 21, Title: "test"}, {ID: 25, Title: "test v4"}}, options)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyLink_linksToAFamilyOfItsOriginal(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(familyOptionsQuery).WithArgs(4, 21, 21, 30).WillReturnRows(lineageFamilies())

	status, reason, err := checkFamilyLink(db, unlinkedCopy(), 25)

	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, status)
	assert.Empty(t, reason)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyLink_refusesAFamilyOutsideItsOriginal(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(familyOptionsQuery).WithArgs(4, 21, 21, 30).WillReturnRows(lineageFamilies())

	status, reason, err := checkFamilyLink(db, unlinkedCopy(), 40)

	require.NoError(t, err)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, "it can only be linked to models copied from the same original", reason)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyLink_refusesAModelWithCopies(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	status, reason, err := checkFamilyLink(db, unlinkedCopy(), 21)

	require.NoError(t, err)
	assert.Equal(t, http.StatusConflict, status)
	assert.Equal(t, "it already has 2 copies, so it can't be linked to another model", reason)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyLink_namesOneCopyInTheSingular(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	_, reason, err := checkFamilyLink(db, unlinkedCopy(), 21)

	require.NoError(t, err)
	assert.Equal(t, "it already has 1 copy, so it can't be linked to another model", reason)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyLink_hidesADatabaseFailureBehindAPlainReason(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnError(errors.New("connection reset"))

	status, reason, err := checkFamilyLink(db, unlinkedCopy(), 21)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "model 30")
	assert.Equal(t, http.StatusInternalServerError, status)
	assert.Equal(t, "its copies could not be checked", reason)
	require.NoError(t, mock.ExpectationsWereMet())
}
