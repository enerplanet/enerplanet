package jobs

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFilesystemResultZipStore_SavesUnderModelConvention(t *testing.T) {
	base := t.TempDir()
	store := NewFilesystemResultZipStore(base)

	const modelID = uint(42)
	data := []byte("PK\x03\x04fake-sim-zip\x00")

	path, err := store.SaveZIP(context.Background(), modelID, "sim_42.zip", data)
	require.NoError(t, err)

	// model_<id>_<unix>/sim_<id>.zip under the base dir.
	assert.Equal(t, base, filepath.Dir(filepath.Dir(path)), "zip lives two levels under base (model_<id>_<unix>/file)")
	assert.Equal(t, "sim_42.zip", filepath.Base(path))
	assert.True(t, strings.HasPrefix(filepath.Base(filepath.Dir(path)), "model_42_"), "per-run dir is model_<id>_<unix>")

	got, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, data, got, "zip bytes round-trip untouched")
}

func TestFilesystemResultZipStore_runsGetDistinctDirectories(t *testing.T) {
	base := t.TempDir()
	store := NewFilesystemResultZipStore(base)

	p1, err := store.SaveZIP(context.Background(), 7, "sim_7.zip", []byte("a"))
	require.NoError(t, err)
	// The dir name is model_<id>_<unix>; two runs land a second apart, so they
	// get distinct dirs and neither overwrites the other for download.
	time.Sleep(1100 * time.Millisecond)
	p2, err := store.SaveZIP(context.Background(), 7, "sim_7.zip", []byte("b"))
	require.NoError(t, err)

	assert.NotEqual(t, filepath.Dir(p1), filepath.Dir(p2), "a re-run lands in its own model_<id>_<unix> dir")

	entries, err := os.ReadDir(base)
	require.NoError(t, err)
	modelDirs := 0
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), "model_7_") {
			modelDirs++
		}
	}
	assert.Equal(t, 2, modelDirs, "two runs => two model dirs, both discoverable by the result download handler")
}