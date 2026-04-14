package resultservice

import (
	"context"
	"fmt"
	"os"

	"github.com/sirupsen/logrus"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

// fetchResult retrieves a result by ID with error handling
func (s *ResultService) fetchResult(resultID uint) (*commonModels.ModelResult, error) {
	var result commonModels.ModelResult
	if err := s.db.First(&result, resultID).Error; err != nil {
		return nil, fmt.Errorf("result not found: %w", err)
	}
	return &result, nil
}

func (s *ResultService) DeleteResult(ctx context.Context, resultID uint) error {
	log := logger.ForComponent("result")

	result, err := s.fetchResult(resultID)
	if err != nil {
		return err
	}

	cleanupFiles(result, resultID, log)

	if err := s.db.Delete(result).Error; err != nil {
		return fmt.Errorf("failed to delete result: %w", err)
	}

	return nil
}

func cleanupFiles(result *commonModels.ModelResult, resultID uint, log *logrus.Entry) {
	if result.ExtractedPath != "" {
		deleteExtractedDir(result, resultID, log)
	}

	if result.ZipPath != "" {
		deleteZipFile(result, resultID, log)
	}
}

func deleteExtractedDir(result *commonModels.ModelResult, resultID uint, log *logrus.Entry) {
	if err := os.RemoveAll(result.ExtractedPath); err != nil {
		log.Warnf("failed to delete extracted directory result_id=%d path=%s err=%v", resultID, result.ExtractedPath, err)
	}
}

func deleteZipFile(result *commonModels.ModelResult, resultID uint, log *logrus.Entry) {
	if err := os.Remove(result.ZipPath); err != nil && !os.IsNotExist(err) {
		log.Warnf("failed to delete zip file result_id=%d path=%s err=%v", resultID, result.ZipPath, err)
	}
}

func (s *ResultService) GetModelResults(ctx context.Context, modelID uint) ([]commonModels.ModelResult, error) {
	var results []commonModels.ModelResult
	if err := s.db.Where("model_id = ?", modelID).Order("created_at DESC").Find(&results).Error; err != nil {
		return nil, err
	}
	return results, nil
}

