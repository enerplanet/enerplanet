package resultservice

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// The fixture mirrors a REAL Coati run over a MEME-style PyPSA network
// (verified against submodules/Coati on main): buses "n1::electricity" etc.,
// a Line line_1 and a Transformer trafo_1, reactive power only where a
// generator supplies it, and s/s_nom loading — a RATIO, not percent.
func powerFlowDocFixture() *CoatiResultsDocument {
	pf := coatiPowerFlow{
		Converged:  []bool{true, true, true},
		Iterations: []int{2, 2, 2},
		SlackBuses: []string{"n1::electricity"},
		VoltageMagnitude: map[string][]float64{
			"n1::electricity": {1.0, 1.0, 1.0},
			"n2::electricity": {0.9996, 0.9995, 0.9993},
			"n3::electricity": {0.9943, 0.993, 0.9917},
		},
		VoltageAngle: map[string][]float64{
			"n1::electricity": {0.0, 0.0, 0.0},
			"n2::electricity": {-0.0015, -0.002, -0.0025},
			"n3::electricity": {-0.0267, -0.0322, -0.0378},
		},
		ReactivePower: map[string][]float64{
			"n1::grid_import": {0.0149, 0.0223, 0.0312},
			"n2::pv":          {0.0, 0.0, 0.0},
			"n3::pv":          {0.0, 0.0, 0.0},
		},
		BranchLoading: map[string][]float64{
			"line_1":  {0.3006, 0.401, 0.5013},
			"trafo_1": {0.2513, 0.302, 0.3527},
		},
	}
	return &CoatiResultsDocument{
		SchemaVersion:    "1.1",
		Framework:        "pypsa",
		FrameworkVersion: "1.2.4",
		Timestamps:       []string{"2025-01-01T00:00:00", "2025-01-01T01:00:00", "2025-01-01T02:00:00"},
		Capacities: map[string]float64{
			"n1::grid_import": 50.0,
			"n2::pv":          5.0,
			"n3::pv":          5.0,
			"n1::line_1":      5.0,
			"n2::line_1":      5.0,
			"n2::trafo_1":     2.0,
			"n3::trafo_1":     2.0,
		},
		TechMetadata: map[string]CoatiTechMetadata{
			"grid_import": {Parent: "supply", CarrierOut: "electricity"},
			"pv":          {Parent: "supply", CarrierOut: "electricity"},
			"line_1":      {Parent: "transmission", CarrierOut: "electricity"},
			"trafo_1":     {Parent: "transmission", CarrierOut: "electricity"},
		},
		Details: map[string]json.RawMessage{"power_flow": mustRawJSON(&pf)},
	}
}

func mustRawJSON(v interface{}) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return raw
}

func strPtr(s string) *string { return &s }

// fakePyPSACoatiRunner is an in-memory CoatiRunner returning a canned document.
type fakePyPSACoatiRunner struct {
	called      int
	resultFile  string
	frameworkID string
	doc         *CoatiResultsDocument
	err         error
}

func (f *fakePyPSACoatiRunner) Convert(_ context.Context, resultFile, frameworkID string) ([]byte, error) {
	f.called++
	f.resultFile = resultFile
	f.frameworkID = frameworkID
	if f.err != nil {
		return nil, f.err
	}
	return json.Marshal(f.doc)
}

// writePFFixtureZip writes a MEME-main layout bundle: network.nc next to a
// power_flow/ export. pfc is nil for a bundle without a power-flow export.
func writePFFixtureZip(t *testing.T, dir, name string, pfTables map[string]string) string {
	t.Helper()
	zipPath := filepath.Join(dir, name)
	file, err := os.Create(zipPath)
	require.NoError(t, err)
	defer file.Close()

	writer := zip.NewWriter(file)
	add := func(path, content string) {
		t.Helper()
		entry, err := writer.Create(path)
		require.NoError(t, err)
		_, err = entry.Write([]byte(content))
		require.NoError(t, err)
	}
	add("files/pypsa/run_0/output/network.nc", "dummy netCDF — the fake runner never reads it")
	for table, content := range pfTables {
		add("files/pypsa/run_0/output/power_flow/"+table, content)
	}
	require.NoError(t, writer.Close())
	require.NoError(t, file.Close())
	return zipPath
}

// pfTableCSV renders one MEME power_flow table: snapshots down, components
// across, first column the snapshot label.
func pfTableCSV(header string, rows ...string) string {
	return header + "\n" + strings.Join(rows, "\n") + "\n"
}

func powerFlowFixtureTables() map[string]string {
	return map[string]string{
		"convergence.csv": pfTableCSV("snapshot,converged,iterations",
			"2025-01-01 00:00:00,True,2",
			"2025-01-01 01:00:00,True,2",
			"2025-01-01 02:00:00,True,2"),
		"buses-v_mag_pu.csv": pfTableCSV("snapshot,n1::electricity,n2::electricity,n3::electricity",
			"2025-01-01 00:00:00,1.0,0.9996,0.9943",
			"2025-01-01 01:00:00,1.0,0.9995,0.993",
			"2025-01-01 02:00:00,1.0,0.9993,0.9917"),
		"buses-p.csv": pfTableCSV("snapshot,n1::electricity,n2::electricity,n3::electricity",
			"2025-01-01 00:00:00,1.5031,-1.0,-0.5",
			"2025-01-01 01:00:00,2.0047,-1.4,-0.6",
			"2025-01-01 02:00:00,2.5066,-1.8,-0.7"),
		"lines-p0.csv": pfTableCSV("snapshot,line_1",
			"2025-01-01 00:00:00,1.5031",
			"2025-01-01 01:00:00,2.0047",
			"2025-01-01 02:00:00,2.5066"),
		"lines-p1.csv": pfTableCSV("snapshot,line_1",
			"2025-01-01 00:00:00,-1.495",
			"2025-01-01 01:00:00,-1.994",
			"2025-01-01 02:00:00,-2.493"),
		"lines-q0.csv": pfTableCSV("snapshot,line_1",
			"2025-01-01 00:00:00,0.004",
			"2025-01-01 01:00:00,0.005",
			"2025-01-01 02:00:00,0.006"),
		"lines-q1.csv": pfTableCSV("snapshot,line_1",
			"2025-01-01 00:00:00,0.001",
			"2025-01-01 01:00:00,0.001",
			"2025-01-01 02:00:00,0.001"),
		"transformers-p0.csv": pfTableCSV("snapshot,trafo_1",
			"2025-01-01 00:00:00,1.256",
			"2025-01-01 01:00:00,1.51",
			"2025-01-01 02:00:00,1.764"),
	}
}

func newCoatiPermissiveDB(t *testing.T, capture *sqlCaptureWriter) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	conn, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(_, _ string) error { return nil })),
	)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: conn}), &gorm.Config{
		SkipDefaultTransaction: true,
		Logger:                 gormlogger.New(capture, gormlogger.Config{LogLevel: gormlogger.Info, Colorful: false}),
	})
	require.NoError(t, err)
	return db, mock
}

// ---------------------------------------------------------------- mapping ---

func TestMapCoatiPowerFlowVoltage_UnitsArePermanent(t *testing.T) {
	rows := mapCoatiPowerFlowVoltage(7, powerFlowDocFixture(), decodeCoatiPowerFlow(powerFlowDocFixture()))

	require.Len(t, rows, 9, "3 AC buses x 3 snapshots")

	n2 := rows[3]
	assert.Equal(t, "n2::electricity", n2.Bus)
	assert.Equal(t, "n2", n2.Location)
	assert.Equal(t, 0.9996, n2.VMagPu, "v_mag_pu is pu, unscaled")
	require.NotNil(t, n2.VAng)
	assert.Equal(t, -0.0015, *n2.VAng, "v_ang is radians, unscaled")
	assert.Equal(t, "2025-01-01 00:00:00", n2.Timestep.Format("2006-01-02 15:04:05"))

	// The slack bus holds its 1.0 pu set-point; every row carries the angle.
	assert.Equal(t, 1.0, rows[0].VMagPu)
	require.NotNil(t, rows[0].VAng)
	assert.Equal(t, 0.0, *rows[0].VAng)
	for _, row := range rows {
		assert.NotEmpty(t, row.Bus)
		assert.NotEmpty(t, row.Location)
		assert.False(t, row.Timestep.IsZero())
	}
}

func TestMapCoatiPowerFlowPower_ScalesPAndQ(t *testing.T) {
	doc := powerFlowDocFixture()
	pf := decodeCoatiPowerFlow(doc)
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "buses-p.csv"),
		[]byte(pfTableCSV("snapshot,n1::electricity,n2::electricity,n3::electricity,n1::heat",
			"2025-01-01 00:00:00,1.5031,-1.0,-0.5,9.9")), 0o600))

	rows := mapCoatiPowerFlowPower(7, doc, pf, dir)

	// Only the AC buses (the voltage set) get rows; the fixed-injection
	// "n1::heat" bus is not an electrical bus and must not appear.
	require.Len(t, rows, 3, "3 AC buses x 1 snapshot in the file")
	require.Equal(t, "n1::electricity", rows[0].Bus)
	assert.InDelta(t, 1503.1, rows[0].P, 1e-9, "p: MEME MW -> kW (x1000)")
	require.NotNil(t, rows[0].Q)
	assert.InDelta(t, 14.9, *rows[0].Q, 1e-9, "q: per-location reactive MVAr -> kVAr (x1000)")

	assert.InDelta(t, -1000.0, rows[1].P, 1e-9, "negative p keeps its sign through the scale")
	require.NotNil(t, rows[1].Q)
	assert.Equal(t, 0.0, *rows[1].Q, "a location whose techs supply no reactive carries 0, not NULL")

	// n3::pv supplies 0 reactive: q is present (0). A bus with NO reactive
	// entry at all must carry NULL, never a fabricated 0.
	docNoReactive := powerFlowDocFixture()
	pfNoReactive := decodeCoatiPowerFlow(docNoReactive)
	delete(pfNoReactive.ReactivePower, "n3::pv")
	rowsNoReactive := mapCoatiPowerFlowPower(7, docNoReactive, pfNoReactive, dir)
	require.Len(t, rowsNoReactive, 3)
	assert.Nil(t, rowsNoReactive[2].Q)
}

// TestMapCoatiPowerFlowPower_QPrefersPerBusNetTable pins the basis fix: when the
// bundle carries buses-q.csv, q is the per-bus NET reactive (the same basis as
// p), not the generator-only per-location sum.
func TestMapCoatiPowerFlowPower_QPrefersPerBusNetTable(t *testing.T) {
	doc := powerFlowDocFixture()
	pf := decodeCoatiPowerFlow(doc)
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "buses-p.csv"),
		[]byte(pfTableCSV("snapshot,n1::electricity,n2::electricity,n3::electricity",
			"2025-01-01 00:00:00,1.5031,-1.0,-0.5")), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "buses-q.csv"),
		[]byte(pfTableCSV("snapshot,n1::electricity,n2::electricity,n3::electricity",
			"2025-01-01 00:00:00,-0.42,-0.11,0.0")), 0o600))

	rows := mapCoatiPowerFlowPower(7, doc, pf, dir)
	require.Len(t, rows, 3)
	require.NotNil(t, rows[0].Q)
	assert.InDelta(t, -420.0, *rows[0].Q, 1e-9, "q is the per-bus net reactive (MVAr -> kVAr)")
	require.NotNil(t, rows[1].Q)
	assert.InDelta(t, -110.0, *rows[1].Q, 1e-9)
	require.NotNil(t, rows[2].Q)
	assert.Equal(t, 0.0, *rows[2].Q)
}

func TestMapCoatiPowerFlowPower_SkipsBusesMissingFromPTable(t *testing.T) {
	doc := powerFlowDocFixture()
	pf := decodeCoatiPowerFlow(doc)
	dir := t.TempDir()
	// Table carries only n1 + n3: n2 has no active series -> no row for it
	// (p is NOT NULL and nothing honest is available).
	require.NoError(t, os.WriteFile(filepath.Join(dir, "buses-p.csv"),
		[]byte(pfTableCSV("snapshot,n1::electricity,n3::electricity",
			"2025-01-01 00:00:00,1.5031,-0.5")), 0o600))

	rows := mapCoatiPowerFlowPower(7, doc, pf, dir)
	require.Len(t, rows, 2)
	assert.Equal(t, "n1::electricity", rows[0].Bus)
	assert.Equal(t, "n3::electricity", rows[1].Bus)
}

func TestMapCoatiPowerFlowLineLoading_ScaleAndClassification(t *testing.T) {
	doc := powerFlowDocFixture()
	pf := decodeCoatiPowerFlow(doc)
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "lines-p0.csv"),
		[]byte(pfTableCSV("snapshot,line_1",
			"2025-01-01 00:00:00,1.5031",
			"2025-01-01 01:00:00,2.0047",
			"2025-01-01 02:00:00,2.5066")), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "lines-p1.csv"),
		[]byte(pfTableCSV("snapshot,line_1",
			"2025-01-01 00:00:00,-1.495",
			"2025-01-01 01:00:00,-1.994",
			"2025-01-01 02:00:00,-2.493")), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "lines-q0.csv"),
		[]byte(pfTableCSV("snapshot,line_1",
			"2025-01-01 00:00:00,0.004",
			"2025-01-01 01:00:00,0.005",
			"2025-01-01 02:00:00,0.006")), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "lines-q1.csv"),
		[]byte(pfTableCSV("snapshot,line_1",
			"2025-01-01 00:00:00,0.001",
			"2025-01-01 01:00:00,0.001",
			"2025-01-01 02:00:00,0.001")), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "transformers-p0.csv"),
		[]byte(pfTableCSV("snapshot,trafo_1",
			"2025-01-01 00:00:00,1.256",
			"2025-01-01 01:00:00,1.51",
			"2025-01-01 02:00:00,1.764")), 0o600))

	rows := mapCoatiPowerFlowLineLoading(7, doc, pf, dir)

	require.Len(t, rows, 3, "the LINE row per snapshot; trafo_1 is classified out by transformers-p0.csv")
	row := rows[0]
	assert.Equal(t, "line_1", row.Line)
	assert.Equal(t, "n1::electricity", row.Bus0, "endpoints from the per-endpoint capacities -> AC bus names")
	assert.Equal(t, "n2::electricity", row.Bus1)
	assert.InDelta(t, 1503.1, row.P0, 1e-9, "p0: MW -> kW")
	require.NotNil(t, row.P1)
	assert.InDelta(t, -1495.0, *row.P1, 1e-9)
	require.NotNil(t, row.Q0)
	assert.InDelta(t, 4.0, *row.Q0, 1e-9, "q0: MVAr -> kVAr")
	require.NotNil(t, row.Q1)
	assert.InDelta(t, 1.0, *row.Q1, 1e-9)
	require.NotNil(t, row.LoadingPercent)
	assert.InDelta(t, 30.06, *row.LoadingPercent, 1e-9, "loading_percent: s/s_nom ratio x100")
	for _, r := range rows {
		require.NotNil(t, r.LoadingPercent, "every snapshot carries the loading")
	}
}

func TestMapCoatiPowerFlowLineLoading_WithoutFlowTables(t *testing.T) {
	doc := powerFlowDocFixture()
	pf := decodeCoatiPowerFlow(doc)
	dir := t.TempDir()
	// No lines-*.csv: flows stay NULL, but the loading (the acceptance
	// column) is still written. No transformers-*.csv either -> every
	// branch is treated as a line.
	rows := mapCoatiPowerFlowLineLoading(7, doc, pf, dir)
	require.Len(t, rows, 6, "line_1 + trafo_1 x 3 snapshots (no kind record -> all lines)")
	require.NotNil(t, rows[0].LoadingPercent)
	assert.Equal(t, 0.0, rows[0].P0, "p0 NOT NULL defaults to 0 when the table is absent")
	assert.Nil(t, rows[1].P1)
	assert.Nil(t, rows[0].Q0)
}

func TestMapCoatiPowerFlowLineLoading_UnresolvableEndpointsSkipped(t *testing.T) {
	doc := powerFlowDocFixture()
	pf := decodeCoatiPowerFlow(doc)
	// Strip the capacities that name line_1's ends: no honest bus0/bus1, so
	// the row must be dropped rather than fabricated.
	delete(doc.Capacities, "n1::line_1")
	delete(doc.Capacities, "n2::line_1")
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "transformers-p0.csv"),
		[]byte(pfTableCSV("snapshot,trafo_1", "2025-01-01 00:00:00,1.256")), 0o600))

	rows := mapCoatiPowerFlowLineLoading(7, doc, pf, dir)
	require.Len(t, rows, 0)
}

// TestPowerFlowBusTable_KeepsIndexAlignmentOnUnparseableCell pins the fix: a
// diverged snapshot's NaN/blank cell becomes a 0 placeholder, so every column
// still gets one entry per snapshot and a LATER snapshot is never shifted up by
// one.
func TestPowerFlowBusTable_KeepsIndexAlignmentOnUnparseableCell(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "buses-p.csv")
	require.NoError(t, os.WriteFile(path, []byte(pfTableCSV("snapshot,bus_a,bus_b",
		"2025-01-01 00:00:00,1.0,2.0",
		"2025-01-01 01:00:00,NaN,4.0", // diverged snapshot: NaN cell
		"2025-01-01 02:00:00,3.0",     // ragged row: last column missing
		"2025-01-01 03:00:00,5.0,8.0")), 0o600))

	values, err := powerFlowBusTable(path)
	require.NoError(t, err)
	require.Len(t, values["bus_a"], 4, "one entry per snapshot, the diverged cell included")
	require.Len(t, values["bus_b"], 4, "the ragged row still appends for every column")
	assert.Equal(t, []float64{1, 0, 3, 5}, values["bus_a"])
	assert.Equal(t, []float64{2, 4, 0, 8}, values["bus_b"])
}

func TestSummarizePyPSACoati(t *testing.T) {
	doc := powerFlowDocFixture()

	allOK := decodeCoatiPowerFlow(doc)
	s := summarizePyPSACoati(allOK, doc)
	assert.True(t, s.Converged)
	assert.Equal(t, 3, s.TotalSnapshots)
	assert.Equal(t, 3, s.ConvergedSnapshots)

	partial := decodeCoatiPowerFlow(doc)
	partial.Converged = []bool{true, false, true}
	s = summarizePyPSACoati(partial, doc)
	assert.False(t, s.Converged, "any diverged snapshot -> not converged")
	assert.Equal(t, 3, s.TotalSnapshots)
	assert.Equal(t, 2, s.ConvergedSnapshots)

	// No record next to the network: Coati's verdict stands (it only says
	// "converged" for a fully converged flow).
	noRecord := decodeCoatiPowerFlow(doc)
	noRecord.Converged = nil
	terminated := "converged"
	doc.TerminationCondition = &terminated
	s = summarizePyPSACoati(noRecord, doc)
	assert.True(t, s.Converged)
	assert.Equal(t, 3, s.TotalSnapshots)
	assert.Equal(t, 3, s.ConvergedSnapshots)
}

// A divergent snapshot's non-finite values are written as null by Coati and
// must decode to zero without failing the whole series.
func TestDecodeCoatiPowerFlow_NullsFromDivergedSnapshots(t *testing.T) {
	doc := powerFlowDocFixture()
	pf := decodeCoatiPowerFlow(doc)
	pf.VoltageMagnitude["n2::electricity"] = []float64{0.9996, 0, 0.9993}
	pf.VoltageAngle["n2::electricity"] = []float64{-0.0015, 0, -0.0025}
	raw := mustRawJSON(pf)
	// Re-marshal with a literal null in the middle of each n2 series.
	text := string(raw)
	text = strings.Replace(text, `[0.9996,0,0.9993]`, `[0.9996,null,0.9993]`, 1)
	text = strings.Replace(text, `[-0.0015,0,-0.0025]`, `[-0.0015,null,-0.0025]`, 1)
	doc.Details["power_flow"] = json.RawMessage(text)

	decoded := decodeCoatiPowerFlow(doc)
	require.NotNil(t, decoded)
	assert.Equal(t, []float64{0.9996, 0, 0.9993}, decoded.VoltageMagnitude["n2::electricity"])
}

func TestDecodeCoatiPowerFlow_AbsentIsNil(t *testing.T) {
	assert.Nil(t, decodeCoatiPowerFlow(&CoatiResultsDocument{}), "no details at all")
	assert.Nil(t, decodeCoatiPowerFlow(&CoatiResultsDocument{
		Details: map[string]json.RawMessage{"objective_constant": json.RawMessage(`1`)},
	}), "an optimize run carries no power_flow")
	assert.Nil(t, decodeCoatiPowerFlow(nil))
	assert.Nil(t, decodeCoatiPowerFlow(&CoatiResultsDocument{
		Details: map[string]json.RawMessage{"power_flow": json.RawMessage(`{`)},
	}), "a corrupt record is not a power flow")
}

// ----------------------------------------------------------------- ingest ---

// expectPyPSAElectricalReplace queues the SQL of one Coati-route electrical
// ingest: BEGIN, one DELETE per electrical table (voltage, power, line
// loading), `inserts` batched INSERTs, COMMIT.
func expectPyPSAElectricalReplace(mock sqlmock.Sqlmock, inserts int) {
	mock.ExpectBegin()
	for i := 0; i < 3; i++ {
		mock.ExpectExec("").WillReturnResult(sqlmock.NewResult(0, 0))
	}
	for i := 0; i < inserts; i++ {
		mock.ExpectQuery("").WillReturnRows(sqlmock.NewRows(nil))
	}
	mock.ExpectCommit()
}

// TestIngestPyPSAResult_CoatiRoute runs the FULL isolated PyPSA ingest over a
// MEME-main bundle: Coati is driven on the network.nc and the electrical
// tables are filled with the scaled columns (v_ang, q, loading_percent).
func TestIngestPyPSAResult_CoatiRoute(t *testing.T) {
	capture := &sqlCaptureWriter{}
	db, mock := newCoatiPermissiveDB(t, capture)

	doc := powerFlowDocFixture()
	// Clean loading values so the interpolated SQL carries an exact percent.
	pf := decodeCoatiPowerFlow(doc)
	pf.BranchLoading = map[string][]float64{"line_1": {0.5, 0.6, 0.7}, "trafo_1": {0.25, 0.3, 0.35}}
	doc.Details["power_flow"] = mustRawJSON(pf)
	runner := &fakePyPSACoatiRunner{doc: doc}
	svc := NewResultService(db).WithCoatiRunner(runner)

	// The extract-path record, then one transaction: 3 deletes (replace, don't
	// append) + 3 INSERT ... RETURNING (one per electrical table); then the
	// result_source UPDATE.
	mock.ExpectExec("").WillReturnResult(sqlmock.NewResult(0, 1))
	expectPyPSAElectricalReplace(mock, 3)
	mock.ExpectExec("").WillReturnResult(sqlmock.NewResult(0, 1))

	modelDir := t.TempDir()
	zipPath := writePFFixtureZip(t, modelDir, "sim_7_pypsa.zip", powerFlowFixtureTables())

	summary, err := svc.IngestPyPSAResult(context.Background(), 7, "u1", zipPath)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())

	// Coati was driven on the bundle's network.nc with the PyPSA framework id.
	require.Equal(t, 1, runner.called)
	assert.Equal(t, CoatiFrameworkPyPSA124, runner.frameworkID)
	assert.True(t, strings.HasSuffix(runner.resultFile, "output/network.nc"))

	// Verdict + wire count from the power-flow record.
	require.NotNil(t, summary)
	assert.True(t, summary.Converged)
	assert.Equal(t, 3, summary.TotalSnapshots)
	assert.Equal(t, 3, summary.ConvergedSnapshots)
	assert.Equal(t, 1, summary.LineCount, "line_1 only; trafo_1 has no home table")

	logs := capture.String()

	// The three previously-empty electrical columns, correctly scaled.
	voltage := sqlLineFor(t, logs, "results_pypsa_voltage")
	require.Contains(t, voltage, "-0.0015", "v_ang in radians, unscaled")
	require.Contains(t, voltage, "0.9996", "v_mag_pu in pu, unscaled")
	require.Contains(t, voltage, "'n2::electricity'")

	power := sqlLineFor(t, logs, "results_pypsa_power")
	require.Contains(t, power, "-1000", "p: MEME MW -> kW (x1000)")
	require.Contains(t, power, "14.9", "q: MVAr -> kVAr (x1000)")
	require.NotContains(t, power, "1.5031")

	loading := sqlLineFor(t, logs, "results_pypsa_line_loading")
	require.Contains(t, loading, "50", "loading_percent: s/s_nom ratio x100 (0.5 -> 50)")
	require.Contains(t, loading, "1503.1", "p0: MW -> kW")
	require.Contains(t, loading, "'n1::electricity'")
	require.NotContains(t, loading, "trafo_1", "transformers are not line rows")

	// Capability source: full-grid-pf, like the legacy leg.
	require.Contains(t, logs, "full-grid-pf")
}

// A partial convergence is a NORMAL outcome: the model completes with the
// electrical tables still written — only the verdict says so.
func TestIngestPyPSAResult_NonConvergedKeepsCompleting(t *testing.T) {
	capture := &sqlCaptureWriter{}
	db, mock := newCoatiPermissiveDB(t, capture)
	doc := powerFlowDocFixture()
	doc.TerminationCondition = strPtr("not_converged")
	pf := decodeCoatiPowerFlow(doc)
	pf.Converged = []bool{true, false, true}
	doc.Details["power_flow"] = mustRawJSON(pf)
	runner := &fakePyPSACoatiRunner{doc: doc}
	svc := NewResultService(db).WithCoatiRunner(runner)

	// extract-path record + 3 deletes + 3 electrical inserts in one tx + the
	// result_source UPDATE.
	mock.ExpectExec("").WillReturnResult(sqlmock.NewResult(0, 1))
	expectPyPSAElectricalReplace(mock, 3)
	mock.ExpectExec("").WillReturnResult(sqlmock.NewResult(0, 1))

	modelDir := t.TempDir()
	zipPath := writePFFixtureZip(t, modelDir, "sim_7_pypsa.zip", powerFlowFixtureTables())

	summary, err := svc.IngestPyPSAResult(context.Background(), 7, "u1", zipPath)
	require.NoError(t, err, "non-convergence must not fail the model")
	require.NoError(t, mock.ExpectationsWereMet())
	require.NotNil(t, summary)
	assert.False(t, summary.Converged)
	assert.Equal(t, 2, summary.ConvergedSnapshots)
	assert.Equal(t, 3, summary.TotalSnapshots)

	logs := capture.String()
	require.Contains(t, logs, "results_pypsa_voltage", "electrical sections are still written")
	require.Contains(t, logs, "full-grid-pf")
}

// A legacy bundle (no network.nc / no power_flow export) must fall through to
// the direct-CSV path and complete without ever invoking Coati.
func TestIngestPyPSAResult_FallsBackWhenNoPowerFlow(t *testing.T) {
	capture := &sqlCaptureWriter{}
	db, mock := newCoatiPermissiveDB(t, capture)
	runner := &fakePyPSACoatiRunner{doc: powerFlowDocFixture()}
	svc := NewResultService(db).WithCoatiRunner(runner)

	// No electrical tables stream; only the result_source UPDATE.
	mock.ExpectExec("").WillReturnResult(sqlmock.NewResult(0, 1))

	modelDir := t.TempDir()
	zipPath := writePFFixtureZip(t, modelDir, "sim_7_pypsa.zip", nil) // just network.nc, no power_flow/

	summary, err := svc.IngestPyPSAResult(context.Background(), 7, "u1", zipPath)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
	require.Equal(t, 0, runner.called, "no power_flow export -> Coati is never driven")
	require.NotNil(t, summary)
	assert.False(t, summary.Converged)
	assert.Equal(t, 0, summary.LineCount)
	require.Contains(t, capture.String(), "full-grid-pf", "the legacy leg still flips the source")
}

// A Coati conversion failure over a power_flow/ bundle MUST fail the leg: the
// legacy csv_sim_* path cannot read that layout, so falling through would
// complete the leg with empty electrical tables. Fixes PR #377 review B5.
func TestIngestPyPSAResult_CoatiFailureFailsTheLeg(t *testing.T) {
	capture := &sqlCaptureWriter{}
	db, mock := newCoatiPermissiveDB(t, capture)
	runner := &fakePyPSACoatiRunner{err: fmt.Errorf("coati: no such framework")}
	svc := NewResultService(db).WithCoatiRunner(runner)

	// No DB write happens: the ingest fails before it touches the tables.
	modelDir := t.TempDir()
	zipPath := writePFFixtureZip(t, modelDir, "sim_7_pypsa.zip", powerFlowFixtureTables())

	summary, err := svc.IngestPyPSAResult(context.Background(), 7, "u1", zipPath)
	require.Error(t, err, "a Coati failure over a power_flow/ bundle must fail the leg")
	require.Nil(t, summary)
	require.ErrorContains(t, err, "power_flow bundle")
	require.NoError(t, mock.ExpectationsWereMet())
	require.Equal(t, 1, runner.called)
	require.NotContains(t, capture.String(), "full-grid-pf", "a failed leg must not flip the source")
}
