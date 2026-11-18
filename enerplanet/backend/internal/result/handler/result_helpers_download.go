package result

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"platform.local/common/pkg/constants"
	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
	backendModels "spatialhub_backend/internal/models"

	"github.com/gin-gonic/gin"
)

func (h *ResultHandler) tryDownloadFromTifPath(c *gin.Context, modelID, tifFilePath string) bool {
	if tifFilePath == "" {
		return false
	}

	modelDir := filepath.Dir(tifFilePath)
	zipFileName := fmt.Sprintf("sim_%s.zip", modelID)

	// Try in model directory
	if zipPath := filepath.Join(modelDir, zipFileName); fileExists(zipPath) {
		c.FileAttachment(zipPath, zipFileName)
		return true
	}

	// Try in parent directory
	if zipPath := filepath.Join(filepath.Dir(modelDir), zipFileName); fileExists(zipPath) {
		c.FileAttachment(zipPath, zipFileName)
		return true
	}

	return false
}

func (h *ResultHandler) tryDownloadFromStorageDir(c *gin.Context, modelID string) bool {
	entries, err := os.ReadDir(constants.StorageDataDir)
	if err != nil {
		return false
	}

	modelPrefix := fmt.Sprintf("model_%s_", modelID)
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), modelPrefix) {
			continue
		}

		modelDir := filepath.Join(constants.StorageDataDir, entry.Name())
		if h.tryDownloadZipFromDir(c, modelID, modelDir) {
			return true
		}
	}
	return false
}

func (h *ResultHandler) tryDownloadZipFromDir(c *gin.Context, modelID, modelDir string) bool {
	// Try exact match first
	zipFileName := fmt.Sprintf("sim_%s.zip", modelID)
	if zipPath := filepath.Join(modelDir, zipFileName); fileExists(zipPath) {
		c.FileAttachment(zipPath, zipFileName)
		return true
	}

	// Search for sim_{modelID}_*.zip files
	dirEntries, err := os.ReadDir(modelDir)
	if err != nil {
		return false
	}

	simPrefix := fmt.Sprintf("sim_%s_", modelID)
	for _, f := range dirEntries {
		if !f.IsDir() && strings.HasPrefix(f.Name(), simPrefix) && strings.HasSuffix(f.Name(), ".zip") {
			c.FileAttachment(filepath.Join(modelDir, f.Name()), f.Name())
			return true
		}
	}
	return false
}

func (h *ResultHandler) tryDownloadTifFile(c *gin.Context, result commonModels.ModelResult) bool {
	if result.TifFilePath != "" && fileExists(result.TifFilePath) {
		c.FileAttachment(result.TifFilePath, result.TifFileName)
		return true
	}
	return false
}

// tryDownloadWithPyPSA serves the Calliope bundle and the PyPSA power-flow
// bundle as one zip, under calliope/ and pypsa/. A Calliope re-run deletes the
// PyPSA leg row, so a bundle found through it belongs to the current run.
func (h *ResultHandler) tryDownloadWithPyPSA(c *gin.Context, modelID uint, result commonModels.ModelResult) bool {
	dir, err := h.store.GetLegExtractedPath(modelID, backendModels.MemeLegPyPSA)
	if err != nil || dir == "" {
		return false
	}
	pypsaZip := filepath.Join(dir, fmt.Sprintf("sim_%d_pypsa.zip", modelID))
	if !fileExists(result.ZipPath) || !fileExists(pypsaZip) {
		return false
	}

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="sim_%d.zip"`, modelID))
	parts := []zipPart{{prefix: "calliope", path: result.ZipPath}, {prefix: "pypsa", path: pypsaZip}}
	if err := mergeZips(c.Writer, parts); err != nil {
		// The response is already streaming, so the client sees a truncated zip.
		logger.ForComponent("result").Errorf("model_id=%d: merge result zips: %v", modelID, err)
	}
	return true
}

// zipPart is one zip file whose entries go under prefix in a merged zip.
type zipPart struct {
	prefix string
	path   string
}

// mergeZips writes the entries of each part into one zip on w, under the
// part's prefix. Entries are copied as stored, without recompressing.
func mergeZips(w io.Writer, parts []zipPart) error {
	out := zip.NewWriter(w)
	for _, p := range parts {
		if err := copyZipEntries(out, p); err != nil {
			return err
		}
	}
	return out.Close()
}

func copyZipEntries(out *zip.Writer, p zipPart) error {
	r, err := zip.OpenReader(p.path)
	if err != nil {
		return fmt.Errorf("open %s: %w", p.path, err)
	}
	defer r.Close()
	for _, f := range r.File {
		hdr := f.FileHeader
		hdr.Name = p.prefix + "/" + f.Name
		src, err := f.OpenRaw()
		if err != nil {
			return fmt.Errorf("read %s in %s: %w", f.Name, p.path, err)
		}
		dst, err := out.CreateRaw(&hdr)
		if err != nil {
			return fmt.Errorf("write %s: %w", hdr.Name, err)
		}
		if _, err := io.Copy(dst, src); err != nil {
			return fmt.Errorf("copy %s from %s: %w", f.Name, p.path, err)
		}
	}
	return nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
