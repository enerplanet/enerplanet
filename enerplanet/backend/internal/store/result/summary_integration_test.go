//go:build integration

// Needs PostgreSQL at TEST_DATABASE_URL (e.g. 'host=localhost port=5433 user=postgres password=postgres dbname=spatialai').
// Run with: go test -tags integration ./internal/store/result/
// Each test works in a scratch schema inside one transaction that is rolled back.
package result

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// scratchResultsDB opens TEST_DATABASE_URL, starts a transaction and creates
// empty copies of the carrier tables in a scratch schema ahead of public.
func scratchResultsDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	tx := db.Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { tx.Rollback() })

	require.NoError(t, tx.Exec("CREATE SCHEMA results_it").Error)
	require.NoError(t, tx.Exec("SET LOCAL search_path TO results_it, public").Error)
	for _, table := range []string{"results_carrier_con", "results_carrier_prod"} {
		require.NoError(t, tx.Exec("CREATE TABLE "+table+" (LIKE public."+table+" INCLUDING DEFAULTS)").Error)
	}
	return tx
}

// TestGetCarrierSummary_CountsEveryEndUse uses the technologies of a full-year
// operate run: household demand, heat pumps, an electric boiler and an air
// conditioner draw power on site; battery charging, the grid export link and
// transmission do not.
func TestGetCarrierSummary_CountsEveryEndUse(t *testing.T) {
	db := scratchResultsDB(t)
	h1 := time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)
	h2 := h1.Add(time.Hour)

	con := []struct {
		techs, loc string
		at         time.Time
		value      float64
	}{
		{"n1_demand", "n1", h1, -2}, {"n1_demand", "n1", h2, -3},
		{"air_source_heat_pump_2", "n2", h1, -4},
		{"ground_source_heat_pump_7", "n7", h2, -1},
		{"electric_boilers_3", "n3", h1, -5},
		{"air_conditioner_2", "n2", h2, -0.5},
		{"battery_storage_1", "n1", h1, -6},
		{"grid_trafo_101720_export", "n1", h2, -7},
		{"power_transmission:lv_0", "n1", h1, -20},
	}
	for _, c := range con {
		require.NoError(t, db.Exec(
			"INSERT INTO results_carrier_con (model_id, from_location, carrier, techs, timestep, value) VALUES (?, ?, 'power', ?, ?, ?)",
			1, c.loc, c.techs, c.at, c.value).Error)
	}
	require.NoError(t, db.Exec(
		"INSERT INTO results_carrier_prod (model_id, from_location, carrier, techs, timestep, value) VALUES (1, 'n1', 'power', 'transformer_supply', ?, 9)",
		h1).Error)

	summary := NewStore(db).GetCarrierSummary(1, "power")

	// h1: 2 + 4 + 5 = 11; h2: 3 + 1 + 0.5 = 4.5
	assert.InDelta(t, 15.5, summary.SumConsumption, 1e-9)
	assert.InDelta(t, 11, summary.PeakDemand, 1e-9)
	assert.InDelta(t, 9, summary.GridImport, 1e-9)
}
