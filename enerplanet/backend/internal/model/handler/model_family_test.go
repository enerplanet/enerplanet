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
	countHeadsSQL   = `SELECT count\(\*\) FROM "models" WHERE \(COALESCE\(group_id, parent_model_id, id\) = \$1 AND id <> \$2\) AND "models"."deleted_at" IS NULL`
	countMembersSQL = `SELECT count\(\*\) FROM "models" WHERE \(COALESCE\(group_id, parent_model_id, id\) = \$1 AND id <> \$2 AND workspace_id IS NOT DISTINCT FROM \$3\) AND "models"."deleted_at" IS NULL`
)

func familyModel() *models.Model {
	ws := uint(4)
	m := &models.Model{WorkspaceID: &ws}
	m.ID = 30
	return m
}

func TestCheckFamilyTarget_joinsAFamilyOfItsWorkspace(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(countMembersSQL).WithArgs(21, 30, 4).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))

	status, err := checkFamilyTarget(db, familyModel(), 21)

	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, status)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyTarget_refusesAModelWithCopies(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	status, err := checkFamilyTarget(db, familyModel(), 21)

	require.Error(t, err)
	assert.Equal(t, http.StatusConflict, status)
	assert.Contains(t, err.Error(), "model 30 heads a family of 2 other models")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckFamilyTarget_refusesAFamilyOutsideTheWorkspace(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(countHeadsSQL).WithArgs(30, 30).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(countMembersSQL).WithArgs(21, 30, 4).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	status, err := checkFamilyTarget(db, familyModel(), 21)

	require.Error(t, err)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Contains(t, err.Error(), "family 21 has no other model in the workspace of model 30")
	require.NoError(t, mock.ExpectationsWereMet())
}
