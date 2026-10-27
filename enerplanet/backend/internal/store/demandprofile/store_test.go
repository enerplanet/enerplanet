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

// The summaries leave the hourly profile in the database and carry the
// storeys, floor area and room height Postgres reads from it.
func TestGetSummariesByModel(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	store := NewStore(db)

	rows := sqlmock.NewRows([]string{"osm_id", "status", "refurbishment_level", "n_storeys", "a_ref_m2", "h_room_m"}).
		AddRow("12345", "resolved", "existing", 6, 6648.84, 2.5).
		AddRow("12346", "pending", "existing", nil, nil, nil)
	mock.ExpectQuery(`SELECT osm_id, status, .*profile -> 'building' ->> 'n_storeys'.* FROM "building_demand_profiles" WHERE model_id = \$1 ORDER BY osm_id`).
		WithArgs(42).
		WillReturnRows(rows)

	got, err := store.GetSummariesByModel(42)
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "12345", got[0].OSMID)
	require.NotNil(t, got[0].NStoreys)
	assert.Equal(t, 6, *got[0].NStoreys)
	assert.InDelta(t, 6648.84, *got[0].ARefM2, 1e-9)
	assert.InDelta(t, 2.5, *got[0].HRoomM, 1e-9)
	assert.Equal(t, "pending", got[1].Status)
	assert.Nil(t, got[1].NStoreys)
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
