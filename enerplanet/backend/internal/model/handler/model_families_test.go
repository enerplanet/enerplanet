package model

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/testutil"
)

// A family page counts originals, takes limit of them in sort order, and
// returns every matching model whose family is on the page, copies included.
func TestFetchModelFamilies(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	h := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)

	mock.ExpectQuery(`SELECT count\(\*\) FROM \(SELECT DISTINCT COALESCE\(parent_model_id, id\) FROM "models" WHERE workspace_id = \$1`).
		WithArgs(2).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectQuery(`SELECT "id" FROM "models" WHERE id IN \(SELECT DISTINCT COALESCE\(parent_model_id, id\) FROM "models" WHERE workspace_id = \$1.*\) ORDER BY created_at desc,id desc LIMIT \$2`).
		WithArgs(2, 2).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(31).AddRow(21))
	mock.ExpectQuery(`SELECT \* FROM "models" WHERE workspace_id = \$1 AND COALESCE\(parent_model_id, id\) IN \(\$2,\$3\)`).
		WithArgs(2, 31, 21).
		WillReturnRows(sqlmock.NewRows([]string{"id", "parent_model_id", "title"}).
			AddRow(31, nil, "test").
			AddRow(28, 21, "THD 2014 I-L v4").
			AddRow(21, nil, "THD 2014 I-L"))
	mock.ExpectQuery(`SELECT \* FROM "model_shares"`).WillReturnRows(sqlmock.NewRows([]string{"id"}))

	list, total, err := h.fetchModelFamilies(db.Where("workspace_id = ?", 2), 2, 0, "created_at", "desc")

	require.NoError(t, err)
	assert.Equal(t, int64(3), total, "total counts families, not models")
	assert.Len(t, list, 3, "the page holds the copies of its families")
	require.NoError(t, mock.ExpectationsWereMet())
}
