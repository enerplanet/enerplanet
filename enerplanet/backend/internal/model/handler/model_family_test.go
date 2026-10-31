package model

import (
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

	status, err := checkFamilyLink(db, unlinkedCopy(), 25)

	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, status)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyLink_refusesAFamilyOutsideItsOriginal(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(familyOptionsQuery).WithArgs(4, 21, 21, 30).WillReturnRows(lineageFamilies())

	status, err := checkFamilyLink(db, unlinkedCopy(), 40)

	require.Error(t, err)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Contains(t, err.Error(), "family 40 does not share the original of model 30")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyLink_refusesAModelWithCopies(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	status, err := checkFamilyLink(db, unlinkedCopy(), 21)

	require.Error(t, err)
	assert.Equal(t, http.StatusConflict, status)
	assert.Contains(t, err.Error(), "model 30 heads a family of 2 other models")
	require.NoError(t, mock.ExpectationsWereMet())
}
