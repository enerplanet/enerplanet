package demandprofile

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

func TestGetByModel(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"id", "model_id", "osm_id", "status"}).
		AddRow(1, 42, "12345", "resolved").
		AddRow(2, 42, "12346", "pending")
	mock.ExpectQuery(`SELECT \* FROM "building_demand_profiles" WHERE model_id = \$1`).
		WithArgs(42).
		WillReturnRows(rows)

	got, err := store.GetByModel(42)
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "12345", got[0].OSMID)
	assert.Equal(t, "resolved", got[0].Status)
	assert.Equal(t, "pending", got[1].Status)
}

func TestGetStatusCounts(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"status", "count"}).
		AddRow("resolved", 30).
		AddRow("pending", 8).
		AddRow("failed", 2)
	mock.ExpectQuery(`SELECT status, count\(\*\) as count FROM "building_demand_profiles" WHERE model_id = \$1 GROUP BY "status"`).
		WithArgs(42).
		WillReturnRows(rows)

	counts, err := store.GetStatusCounts(42)
	require.NoError(t, err)
	assert.Equal(t, int64(30), counts.Resolved)
	assert.Equal(t, int64(8), counts.Pending)
	assert.Equal(t, int64(2), counts.Failed)
	assert.Equal(t, int64(40), counts.Total())
}

func TestGetStatusCounts_noRows(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	mock.ExpectQuery(`SELECT status, count\(\*\) as count FROM "building_demand_profiles" WHERE model_id = \$1 GROUP BY "status"`).
		WithArgs(99).
		WillReturnRows(sqlmock.NewRows(nil))

	counts, err := store.GetStatusCounts(99)
	require.NoError(t, err)
	assert.Equal(t, int64(0), counts.Total())
}
