package resultservice

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"platform.local/common/pkg/utils"
)

var errTifFound = errors.New("tif found")

func hasPypsaDir(extractDir string) bool {
	hasPypsa := false
	_ = filepath.Walk(extractDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() && strings.HasPrefix(info.Name(), "pypsa") {
			hasPypsa = true
		}
		return nil
	})
	return hasPypsa
}

func findTifFile(extractDir string) (string, string) {
	var tifPath string
	_ = filepath.Walk(extractDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		name := strings.ToLower(info.Name())
		if strings.HasSuffix(name, ".tif") || strings.HasSuffix(name, ".tiff") {
			tifPath = path
			return errTifFound
		}
		return nil
	})

	if tifPath == "" {
		return "", ""
	}
	return tifPath, filepath.Base(tifPath)
}
func (s *ResultService) extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer func() { _ = r.Close() }()

	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}

		fpath, err := validateAndBuildPath(f, destDir)
		if err != nil {
			return err
		}

		if err := extractFile(f, fpath); err != nil {
			return err
		}
	}

	return nil
}

func validateAndBuildPath(f *zip.File, destDir string) (string, error) {
	// Remove leading slash
	name := strings.TrimPrefix(f.Name, "/")
	name = strings.TrimPrefix(name, "\\")
	return utils.SafeFilePath(name, destDir)
}

func extractFile(f *zip.File, fpath string) error {
	dirPath := filepath.Dir(fpath)

	if err := os.MkdirAll(dirPath, 0755); err != nil {
		return err
	}

	if err := os.Chmod(dirPath, 0755); err != nil {
		return fmt.Errorf("failed to set directory permissions: %w", err)
	}

	outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer outFile.Close()

	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	const maxDecompressedSize int64 = 100 * 1024 * 1024 // 100MB
	if f.UncompressedSize64 > uint64(maxDecompressedSize) {
		return fmt.Errorf("zip entry %q exceeds maximum allowed size (%d bytes)", f.Name, maxDecompressedSize)
	}

	// Read one byte past the limit to detect overflow instead of silently truncating.
	limitedReader := io.LimitReader(rc, maxDecompressedSize+1)
	written, err := io.Copy(outFile, limitedReader)
	if err != nil {
		_ = os.Remove(fpath)
		return err
	}
	if written > maxDecompressedSize {
		_ = os.Remove(fpath)
		return fmt.Errorf("zip entry %q exceeds maximum allowed size (%d bytes)", f.Name, maxDecompressedSize)
	}

	if err := os.Chmod(fpath, 0644); err != nil {
		_ = os.Remove(fpath)
		return err
	}
	return nil
}
