package jobs

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"platform.local/common/pkg/constants"
)

// ResultZipStore persists a MEME result bundle. It is an interface (not a
// concrete type) so the on-disk layout can later be swapped for a database,
// object store, or anything else without the dispatch handler changing. The
// filesystem implementation below is the only one today.
type ResultZipStore interface {
	// SaveZIP writes data (a MEME result zip) for the given model and returns
	// the resolved storage path of the saved file. filename should be the base
	// name only ("sim_<modelID>.zip"); the store owns the directory layout.
	SaveZIP(ctx context.Context, modelID uint, filename string, data []byte) (string, error)
}

// filesystemResultZipStore writes zips under a base directory using the
// backend's established convention: one per-run directory per model named
// model_<id>_<unix>, holding sim_<id>.zip (or sim_<id>_*.zip). The result
// download handler (internal/result/handler/result_helpers_download.go) scans
// exactly this layout, so a saved bundle is immediately downloadable.
type filesystemResultZipStore struct {
	baseDir string
}

// NewFilesystemResultZipStore returns a ResultZipStore writing to baseDir.
// Pass constants.StorageDataDir for the default backend location; a test can
// pass a temp dir.
func NewFilesystemResultZipStore(baseDir string) ResultZipStore {
	return &filesystemResultZipStore{baseDir: baseDir}
}

func (s *filesystemResultZipStore) SaveZIP(ctx context.Context, modelID uint, filename string, data []byte) (string, error) {
	base := s.baseDir
	if base == "" {
		base = constants.StorageDataDir
	}
	if err := os.MkdirAll(base, 0o755); err != nil {
		return "", fmt.Errorf("create storage root %s: %w", base, err)
	}

	// Per-run model directory; the timestamp makes re-runs unique and keeps
	// every run's bundle on disk, matching the callback upload behaviour.
	modelDir := filepath.Join(base, fmt.Sprintf("model_%d_%d", modelID, time.Now().Unix()))
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		return "", fmt.Errorf("create model storage dir %s: %w", modelDir, err)
	}

	path := filepath.Join(modelDir, filepath.Base(filename))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("write result zip %s: %w", path, err)
	}
	return path, nil
}