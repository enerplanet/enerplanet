package result

import (
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Fixtures: testdata/powerflow mirrors MEME main's canonical power_flow/
// export (per-quantity tables with the snapshot label in the first column,
// *_loading.csv as s/s_nom ratios, summary.json with "snapshots"/"
// converged_snapshots"). testdata/legacy mirrors the pypsa_output/csv_sim_*
// tree the readers have served since before the migration.

func TestReadPyPSAConvergenceSummary_PowerFlowLayout(t *testing.T) {
	summary, err := readPyPSAConvergenceSummary("testdata/powerflow")
	require.NoError(t, err)
	require.NotNil(t, summary)
	assert.Equal(t, 3, summary.ConvergedSnapshots)
	assert.Equal(t, 3, summary.TotalSnapshots)
	// The new layout has no equivalent of the legacy columns; they stay empty.
	assert.Empty(t, summary.ValidationIssues)
	assert.Equal(t, "", summary.PFAttempt)
}

func TestReadPyPSAConvergenceSummary_PowerFlowConvergenceCSVFallback(t *testing.T) {
	// A power_flow/ dir without summary.json: the reader must fall back to
	// counting the per-snapshot convergence.csv rows.
	dir := t.TempDir()
	pfDir := filepath.Join(dir, "power_flow")
	require.NoError(t, os.MkdirAll(pfDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(pfDir, "convergence.csv"), []byte(
		"snapshot,converged,iterations\n"+
			"2025-01-01 00:00:00,True,2\n"+
			"2025-01-01 01:00:00,False,5\n"+
			"2025-01-01 02:00:00,True,2\n"), 0o644))

	summary, err := readPyPSAConvergenceSummary(dir)
	require.NoError(t, err)
	require.NotNil(t, summary)
	assert.Equal(t, 2, summary.ConvergedSnapshots)
	assert.Equal(t, 3, summary.TotalSnapshots)
}

func TestReadPyPSATransformerLoading_PowerFlowLayout(t *testing.T) {
	points, err := readPyPSATransformerLoading("testdata/powerflow")
	require.NoError(t, err)
	require.Len(t, points, 6) // 2 transformers x 3 snapshots

	first := points[0]
	assert.Equal(t, "trafo_a", first.Transformer)
	assert.Equal(t, time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), first.Timestep)
	// MW -> kW x1000, MVAr -> kVAr x1000; sign preserved on the far end.
	assert.InDelta(t, 1200, first.P0, 0.001)
	assert.InDelta(t, -1200, first.P1, 0.001)
	assert.InDelta(t, 900, first.Q0, 0.001)
	assert.InDelta(t, -900, first.Q1, 0.001)

	// s_nom = max(|s0|,|s1|) / loading, derived per snapshot: trafo_a 2 MVA,
	// trafo_b 5 MVA -> kVA; every snapshot of trafo_a and two of trafo_b (the
	// third carries no flow) must converge on the same rating.
	sNom := map[string]float64{}
	for _, p := range points {
		if previous, seen := sNom[p.Transformer]; seen {
			assert.InDelta(t, previous, p.SNomKVA, 1e-6)
		}
		sNom[p.Transformer] = p.SNomKVA
	}
	assert.InDelta(t, 2000, sNom["trafo_a"], 1e-6)
	assert.InDelta(t, 5000, sNom["trafo_b"], 1e-6)
}

func TestReadPyPSALineRatings_PowerFlowLayout(t *testing.T) {
	ratings, err := readPyPSALineRatings("testdata/powerflow")
	require.NoError(t, err)
	assert.InDelta(t, 500, ratings["line_lv_1"], 1e-6)  // 0.5 MVA
	assert.InDelta(t, 8000, ratings["line_mv_1"], 1e-6) // 8 MVA
}

func TestReadPyPSAConvergenceSummary_LegacyLayout(t *testing.T) {
	summary, err := readPyPSAConvergenceSummary("testdata/legacy")
	require.NoError(t, err)
	require.NotNil(t, summary)
	assert.Equal(t, 96, summary.ConvergedSnapshots)
	assert.Equal(t, 96, summary.TotalSnapshots)
	assert.Equal(t, "newton_raphson", summary.PFAttempt)
	assert.InDelta(t, 0.0001, summary.LPFMaxMismatch, 1e-9)
}

func TestReadPyPSACurtailment_LegacyLayout(t *testing.T) {
	points, err := readPyPSACurtailment("testdata/legacy")
	require.NoError(t, err)
	require.Len(t, points, 2)

	assert.InDelta(t, 1.3, points[0].AvailableKW, 1e-9) // 0.8 + 0.5
	assert.InDelta(t, 0.8, points[0].ActualKW, 1e-9)    // 0.5 + 0.3
	assert.InDelta(t, 0.5, points[0].CurtailedKW, 1e-9)
	assert.InDelta(t, 1.1, points[1].AvailableKW, 1e-9) // 0.7 + 0.4
	assert.InDelta(t, 1.0, points[1].ActualKW, 1e-9)    // 0.6 + 0.4
	assert.InDelta(t, 0.1, points[1].CurtailedKW, 1e-9)
}

func TestReadPyPSATransformerLoading_LegacyLayout(t *testing.T) {
	points, err := readPyPSATransformerLoading("testdata/legacy")
	require.NoError(t, err)
	require.Len(t, points, 4) // 2 transformers x 2 snapshots

	first := points[0]
	assert.Equal(t, "trafo_a", first.Transformer)
	assert.Equal(t, time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), first.Timestep)
	assert.InDelta(t, 1200, first.P0, 0.001)
	assert.InDelta(t, -1200, first.P1, 0.001)
	assert.InDelta(t, 900, first.Q0, 0.001)
	assert.InDelta(t, -900, first.Q1, 0.001)
	assert.InDelta(t, 2000, first.SNomKVA, 0.001) // transformers.csv s_nom 2.0 MVA
}

func TestReadPyPSALineRatings_LegacyLayout(t *testing.T) {
	ratings, err := readPyPSALineRatings("testdata/legacy")
	require.NoError(t, err)

	// The legacy reader multiplies the cable-type i_nom (kA) x v_nom (kV).
	assert.InDelta(t, math.Sqrt(3)*0.4*0.270*1000, ratings["lv_1"], 0.01) // NAYY 4x150 SE, 0.4 kV
	assert.InDelta(t, math.Sqrt(3)*20*0.319*1000, ratings["mv_1"], 0.01)  // NA2XS2Y 1x150 12/20 kV, 20 kV
}

func TestReadPyPSAReaders_NoExport(t *testing.T) {
	dir := t.TempDir() // a bundle with neither layout
	_, err := readPyPSAConvergenceSummary(dir)
	assert.Error(t, err)
	_, err = readPyPSATransformerLoading(dir)
	assert.Error(t, err)
	_, err = readPyPSALineRatings(dir)
	assert.Error(t, err)
}
