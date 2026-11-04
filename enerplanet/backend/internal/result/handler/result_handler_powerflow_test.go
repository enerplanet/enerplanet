package result

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/testutil"
)

// TestGetPyPSAResults_PowerFlowLayout drives the full GET handler against a
// MEME main power_flow/ bundle: the section readers must serve convergence
// (from summary.json), transformer_loading (flows x1000 + s_nom derived from
// the s/s_nom loading ratio) and line_ratings (name -> kVA) even though the
// bundle has no pypsa_output/csv_sim_* tree.
func TestGetPyPSAResults_PowerFlowLayout(t *testing.T) {
	extractDir, err := filepath.Abs("testdata/powerflow")
	require.NoError(t, err)

	db, mock := testutil.NewMockDB(t)
	handler := NewResultHandler(db, nil, nil, "secret", nil)

	mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).
		WithArgs("4", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "results"}).
			AddRow(4, "owner", []byte(`{}`)))
	// latestExtractedPath: the stored result's extracted bundle is the
	// power_flow fixture.
	mock.ExpectQuery(`SELECT \* FROM "model_results" WHERE model_id = \$1`).
		WithArgs(4).
		WillReturnRows(sqlmock.NewRows([]string{"id", "model_id", "extracted_path", "created_at"}).
			AddRow(1, 4, extractDir, time.Now()))
	// The remaining store reads (result_source, voltage, power, line_loading,
	// transformer_flows, settings, locations) have no expectation: they log
	// and skip their sections, exactly as the pre-existing handler test.

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/models/4/results/pypsa", nil)
	c.Params = gin.Params{{Key: "id", Value: "4"}}
	c.Set("user_id", "owner")
	c.Set("access_level", "expert")

	handler.GetPyPSAResults(c)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	body := w.Body.String()

	// Convergence comes from power_flow/summary.json, not the legacy
	// convergence_stats.csv (which does not exist in this bundle).
	assert.Contains(t, body, `"convergence"`)
	assert.Contains(t, body, `"converged_snapshots":3`)
	assert.Contains(t, body, `"total_snapshots":3`)

	// Transformer loading: flows in kW/kVAr, s_nom derived in kVA.
	assert.Contains(t, body, `"transformer_loading"`)
	assert.Contains(t, body, `"transformer":"trafo_a"`)
	assert.Contains(t, body, `"s_nom_kva":2000`)
	assert.Contains(t, body, `"p0":1200`)

	// Line ratings: name -> kVA.
	assert.Contains(t, body, `"line_ratings"`)
	assert.Contains(t, body, `"line_lv_1":500`)
	assert.Contains(t, body, `"line_mv_1":8000`)
}
