package resultservice

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// sqlCaptureWriter records gorm's SQL trace lines (with interpolated values),
// so the test can assert the actual column values written.
type sqlCaptureWriter struct {
	mu   sync.Mutex
	logs strings.Builder
}

func (w *sqlCaptureWriter) Printf(format string, args ...interface{}) {
	w.mu.Lock()
	defer w.mu.Unlock()
	fmt.Fprintf(&w.logs, format, args...)
	w.logs.WriteString("\n")
}

func (w *sqlCaptureWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.logs.String()
}

func writeMemeCSV(t *testing.T, dir, name, content string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600))
}

// sqlLineFor returns the captured SQL line for an INSERT into table.
func sqlLineFor(t *testing.T, logs, table string) string {
	t.Helper()
	for _, line := range strings.Split(logs, "\n") {
		if strings.Contains(line, `INSERT INTO "`+table+`"`) {
			return line
		}
	}
	t.Fatalf("no INSERT captured for table %s; captured logs:\n%s", table, logs)
	return ""
}

func newMemeTimeseriesCSVDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	writeMemeCSV(t, dir, "results_flow_out.csv",
		"nodes,techs,carriers,timesteps,flow_out\n"+
			"n1,pv_supply_1,electricity,2020-01-01T00:00:00,5.5\n"+
			"n1,line1,electricity,2020-01-01T00:00:00,3.0\n"+
			"n1,grid_n1_import,electricity,2020-01-01T00:00:00,2.0\n"+
			"n1,grid_n1_export,electricity,2020-01-01T00:00:00,9.9\n"+
			"n1,pv_supply_1,electricity,2020-01-01T00:00:00,not-a-number\n")
	writeMemeCSV(t, dir, "results_flow_in.csv",
		"nodes,techs,carriers,timesteps,flow_in\n"+
			"n1,demand_1,electricity,2020-01-01T00:00:00,7.5\n"+
			"n1,battery,electricity,2020-01-01T00:00:00,1.5\n")
	writeMemeCSV(t, dir, "results_capacity_factor.csv",
		"nodes,techs,carriers,timesteps,capacity_factor\n"+
			"n1,pv_supply_1,electricity,2020-01-01T00:00:00,0.25\n")
	writeMemeCSV(t, dir, "results_systemwide_capacity_factor.csv",
		"techs,carriers,systemwide_capacity_factor\n"+
			"wind_onshore_1,electricity,0.4\n")
	writeMemeCSV(t, dir, "results_systemwide_levelised_cost.csv",
		"techs,costs,carriers,systemwide_levelised_cost\n"+
			"pv_supply_1,monetary,electricity,55.5\n")
	writeMemeCSV(t, dir, "results_total_levelised_cost.csv",
		"costs,carriers,total_levelised_cost\n"+
			"monetary,electricity,123.4\n")
	writeMemeCSV(t, dir, "results_cost_operation_variable.csv",
		"nodes,techs,costs,timesteps,cost_operation_variable\n"+
			"n1,pv_supply_1,monetary,2020-01-01T00:00:00,9.1\n")
	return dir
}

// TestStreamMemeTimeSeries_MapsAndNormalises pins the CSV -> R2 mapping and the
// normalisation rules (electricity->power, transmission->power_transmission:*,
// demand-><node>_demand, grid import->transformer_supply, grid export omitted,
// others verbatim) by asserting the real INSERT values.
func TestStreamMemeTimeSeries_MapsAndNormalises(t *testing.T) {
	csvDir := newMemeTimeseriesCSVDir(t)

	conn, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, _ string) error { return nil })),
	)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	capture := &sqlCaptureWriter{}
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: conn}), &gorm.Config{
		SkipDefaultTransaction: true,
		Logger:                 gormlogger.New(capture, gormlogger.Config{LogLevel: gormlogger.Info, Colorful: false}),
	})
	require.NoError(t, err)

	// One INSERT ... RETURNING per table (7 tables, all populated).
	for i := 0; i < 7; i++ {
		mock.ExpectQuery("").WillReturnRows(sqlmock.NewRows(nil))
	}

	parents := map[string]string{
		"pv_supply_1":    "supply",
		"line1":          "transmission",
		"demand_1":       "demand",
		"battery":        "storage",
		"wind_onshore_1": "supply",
		"grid_n1_import": "supply",
		"grid_n1_export": "supply",
	}

	require.NoError(t, streamMemeTimeSeries(db, 7, csvDir, parents))
	require.NoError(t, mock.ExpectationsWereMet())

	logs := capture.String()

	prod := sqlLineFor(t, logs, "results_carrier_prod")
	require.Contains(t, prod, "'power'", "carrier electricity->power")
	require.Contains(t, prod, "pv_supply_1", "other techs stay verbatim")
	require.Contains(t, prod, "power_transmission:line1", "transmission tech renamed")
	require.Contains(t, prod, "transformer_supply", "grid import renamed")
	require.NotContains(t, prod, "grid_n1_export", "grid export omitted from carrier_prod")
	// POWER: 5.5 MW in the CSV -> 5500 kW in results_carrier_prod (Round 4a).
	require.Contains(t, prod, "5500")
	require.Contains(t, prod, "2020-01-01 00:00:00")

	consume := sqlLineFor(t, logs, "results_carrier_con")
	require.Contains(t, consume, "n1_demand", "demand tech renamed to <node>_demand")
	require.Contains(t, consume, "battery")
	// POWER: 7.5 MW -> 7500 kW, 1.5 MW -> 1500 kW.
	require.Contains(t, consume, "7500")
	require.Contains(t, consume, "1500")

	// RATIOS and COSTS are NOT power: they must be stored verbatim (Round 4a).
	cf := sqlLineFor(t, logs, "results_capacity_factor")
	require.Contains(t, cf, "pv_supply_1")
	require.Contains(t, cf, "0.25")
	require.Contains(t, cf, "'power'")

	mcf := sqlLineFor(t, logs, "results_model_capacity_factor")
	require.Contains(t, mcf, "wind_onshore_1")
	require.Contains(t, mcf, "0.4")
	require.Contains(t, mcf, "'power'")

	mlc := sqlLineFor(t, logs, "results_model_levelised_cost")
	require.Contains(t, mlc, "pv_supply_1")
	require.Contains(t, mlc, "monetary")
	require.Contains(t, mlc, "55.5")

	mtlc := sqlLineFor(t, logs, "results_model_total_levelised_cost")
	require.Contains(t, mtlc, "monetary")
	require.Contains(t, mtlc, "123.4")

	costVar := sqlLineFor(t, logs, "results_cost_var")
	require.Contains(t, costVar, "n1")
	require.Contains(t, costVar, "monetary")
	require.Contains(t, costVar, "pv_supply_1")
	require.Contains(t, costVar, "9.1")
}

// TestStreamMemeTimeSeries_MissingDirSkips guards a PyPSA-only bundle (no CSV
// dir): the streaming is a no-op and issues no statements.
func TestStreamMemeTimeSeries_MissingDirSkips(t *testing.T) {
	conn, _, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, _ string) error { return nil })),
	)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: conn}), &gorm.Config{SkipDefaultTransaction: true})
	require.NoError(t, err)

	missing := filepath.Join(t.TempDir(), "does-not-exist", "csv")
	require.NoError(t, streamMemeTimeSeries(db, 7, missing, map[string]string{}))
}
