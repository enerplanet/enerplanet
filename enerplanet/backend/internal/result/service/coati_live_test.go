//go:build manualignis

package resultservice

import (
	"archive/zip"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// findFixtureZip walks up from the current working directory to locate the real
// MEME Calliope bundle captured in Step 2 (enerplanet/.local/dependencies/meme/
// results/calliope.zip).
func findFixtureZip(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	require.NoError(t, err)
	for dir := cwd; dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, ".local", "dependencies", "meme", "results", "calliope.zip")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

// resolveCoatiBin finds a working coati binary: COATI_BIN, the local Coati
// checkout's venv, or `coati` on PATH.
func resolveCoatiBin(t *testing.T) string {
	t.Helper()
	if env := os.Getenv(CoatiBinEnv); env != "" {
		if _, err := os.Stat(env); err == nil {
			return env
		}
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, "Projects", "github", "Coati", ".venv", "bin", "coati"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	if p, err := exec.LookPath("coati"); err == nil {
		return p
	}
	return ""
}

func extractCalliopeNC(t *testing.T, zipPath, destDir string) string {
	t.Helper()
	z, err := zip.OpenReader(zipPath)
	require.NoError(t, err)
	defer z.Close()
	for _, f := range z.File {
		if f.Name == "files/run_0/output/results.nc" {
			rc, err := f.Open()
			require.NoError(t, err)
			defer rc.Close()
			out := filepath.Join(destDir, "results.nc")
			fh, err := os.Create(out)
			require.NoError(t, err)
			_, err = fh.ReadFrom(rc)
			fh.Close()
			require.NoError(t, err)
			return out
		}
	}
	t.Fatalf("results.nc not found in %s", zipPath)
	return ""
}

// TestLiveCoatiConvertRealCalliope runs the real coati binary over a real MEME
// Calliope results.nc and asserts the unified document grades and carries data.
// Run with: GOFLAGS="-tags=manualignis" go test ./internal/result/service/ -run TestLiveCoatiConvertRealCalliope -v
func TestLiveCoatiConvertRealCalliope(t *testing.T) {
	zipPath := findFixtureZip(t)
	if zipPath == "" {
		t.Skip("real calliope.zip fixture not present; nothing to verify against")
	}
	bin := resolveCoatiBin(t)
	if bin == "" {
		t.Skip("no coati binary found (set COATI_BIN); skipping live convert")
	}

	nc := extractCalliopeNC(t, zipPath, t.TempDir())

	runner := SubprocessCoatiRunner{Bin: bin}
	out, err := runner.Convert(context.Background(), nc, CoatiFrameworkCalliope07)
	require.NoError(t, err)

	var doc CoatiResultsDocument
	require.NoError(t, json.Unmarshal(out, &doc))
	require.NotNil(t, doc.Success, "document must grade success")
	assert.True(t, *doc.Success, "real Calliope solve should grade success")
	assert.Equal(t, "calliope", doc.Framework)
	assert.NotEmpty(t, doc.Capacities, "real model has installed capacities")
	assert.NotEmpty(t, doc.Objective, "real model has an objective value")
	assert.NotEmpty(t, doc.Coordinates, "real model locates its nodes")
}