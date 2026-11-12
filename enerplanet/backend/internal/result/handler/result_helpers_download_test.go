package result

import (
	"archive/zip"
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	commonModels "platform.local/common/pkg/models"
	"spatialhub_backend/internal/testutil"
)

// writeZip writes a zip at path holding the given name -> content entries.
func writeZip(t *testing.T, path string, files map[string]string) {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := w.Create(name)
		require.NoError(t, err)
		_, err = f.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
	require.NoError(t, os.WriteFile(path, buf.Bytes(), 0o644))
}

// readZip returns the name -> content entries of a zip held in data.
func readZip(t *testing.T, data []byte) map[string]string {
	t.Helper()
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)
	out := map[string]string{}
	for _, f := range r.File {
		rc, err := f.Open()
		require.NoError(t, err)
		b, err := io.ReadAll(rc)
		require.NoError(t, err)
		require.NoError(t, rc.Close())
		out[f.Name] = string(b)
	}
	return out
}

func TestTryDownloadWithPyPSA_MergesBothBundles(t *testing.T) {
	calliopeDir, pypsaDir := t.TempDir(), t.TempDir()
	calliopeZip := filepath.Join(calliopeDir, "sim_9.zip")
	writeZip(t, calliopeZip, map[string]string{"csv/results_flow_out.csv": "calliope flows"})
	writeZip(t, filepath.Join(pypsaDir, "sim_9_pypsa.zip"), map[string]string{"power_flow/summary.json": "{}"})

	db, mock := testutil.NewMockDB(t)
	handler := NewResultHandler(db, nil, nil, "secret", nil)
	mock.ExpectQuery(`SELECT "extracted_path" FROM "model_meme_runs"`).
		WithArgs(9, "pypsa", 1).
		WillReturnRows(sqlmock.NewRows([]string{"extracted_path"}).AddRow(pypsaDir))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/models/9/download", nil)

	served := handler.tryDownloadWithPyPSA(c, 9, commonModels.ModelResult{ZipPath: calliopeZip})

	require.True(t, served)
	assert.Equal(t, `attachment; filename="sim_9.zip"`, w.Header().Get("Content-Disposition"))
	assert.Equal(t, map[string]string{
		"calliope/csv/results_flow_out.csv": "calliope flows",
		"pypsa/power_flow/summary.json":     "{}",
	}, readZip(t, w.Body.Bytes()))
}

func TestTryDownloadWithPyPSA_NoPyPSALegFallsThrough(t *testing.T) {
	calliopeZip := filepath.Join(t.TempDir(), "sim_9.zip")
	writeZip(t, calliopeZip, map[string]string{"a.csv": "x"})

	db, mock := testutil.NewMockDB(t)
	handler := NewResultHandler(db, nil, nil, "secret", nil)
	mock.ExpectQuery(`SELECT "extracted_path" FROM "model_meme_runs"`).
		WithArgs(9, "pypsa", 1).
		WillReturnRows(sqlmock.NewRows([]string{"extracted_path"}))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/models/9/download", nil)

	assert.False(t, handler.tryDownloadWithPyPSA(c, 9, commonModels.ModelResult{ZipPath: calliopeZip}))
	assert.Zero(t, w.Body.Len())
}
