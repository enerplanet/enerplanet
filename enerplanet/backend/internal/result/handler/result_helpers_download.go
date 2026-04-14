package result

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"platform.local/common/pkg/constants"
	commonModels "platform.local/common/pkg/models"

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

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
