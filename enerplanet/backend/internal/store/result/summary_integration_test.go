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

// TestCarrierTimeSeries_GroupsTechsAcrossBuildings uses the per-building
// technology ids of a MEME run: each series comes back once per technology,
// summed over the buildings, lines and transformers that carry it.
func TestCarrierTimeSeries_GroupsTechsAcrossBuildings(t *testing.T) {
	db := scratchResultsDB(t)
	h1 := time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)
	h2 := h1.Add(time.Hour)

	insert := func(table, techs string, at time.Time, value float64) {
		require.NoError(t, db.Exec(
			"INSERT INTO "+table+" (model_id, from_location, carrier, techs, timestep, value) VALUES (1, 'n1', 'power', ?, ?, ?)",
			techs, at, value).Error)
	}
	for _, at := range []time.Time{h1, h2} {
		insert("results_carrier_prod", "pv_supply_1_1", at, 1)
		insert("results_carrier_prod", "pv_supply_2_1", at, 2)
		insert("results_carrier_prod", "battery_storage_1", at, 3)
		insert("results_carrier_prod", "battery_storage_2", at, 4)
		insert("results_carrier_prod", "power_transmission:lv_0", at, 5)
		insert("results_carrier_prod", "power_transmission:lv_1", at, 6)
		insert("results_carrier_prod", "transformer_supply", at, 7)
		insert("results_carrier_con", "n1_demand", at, -1)
		insert("results_carrier_con", "n12_demand", at, -2)
		insert("results_carrier_con", "grid_trafo_101720_export", at, -3)
		insert("results_carrier_con", "grid_trafo_200499_export", at, -4)
	}

	byTech := func(rows []CarrierAggRow) map[string]float64 {
		out := map[string]float64{}
		for _, r := range rows {
			out[r.Techs] += r.Value
		}
		return out
	}
	store := NewStore(db)
	prod := store.GetCarrierProdTimeSeries(1, "power")
	con := store.GetCarrierConTimeSeries(1, "power")

	assert.Len(t, prod, 8)
	assert.Equal(t, map[string]float64{
		"pv_supply": 6, "battery_storage": 14, "power_transmission": 22, "transformer_supply": 14,
	}, byTech(prod))
	assert.Len(t, con, 4)
	assert.Equal(t, map[string]float64{"power_demand": 6, "grid_trafo_export": 14}, byTech(con))

	assert.Len(t, store.GetDailyCarrierProdTimeSeries(1, "power"), 4)
	assert.Equal(t, byTech(con), byTech(store.GetDailyCarrierConTimeSeries(1, "power")))
}
