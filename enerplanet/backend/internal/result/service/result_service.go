package resultservice

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

type ResultService struct {
	db *gorm.DB
}

func NewResultService(db *gorm.DB) *ResultService {
	return &ResultService{db: db}
}
func (s *ResultService) ProcessModelResult(ctx context.Context, modelID uint, userID, zipPath string, pypsaEnabled bool) (result *commonModels.ModelResult, retErr error) {
	log := logger.ForComponent("result")

	// Catch panics and convert to errors with context
	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in ProcessModelResult model_id=%d: %v", modelID, r)
			retErr = fmt.Errorf("panic in ProcessModelResult: %v", r)
		}
	}()

	zipStat, err := os.Stat(zipPath)
	if err != nil {
		log.Errorf("Zip file not found model_id=%d zip_path=%s err=%v", modelID, zipPath, err)
		return nil, fmt.Errorf("zip file not found: %w", err)
	}

	extractDir := filepath.Dir(zipPath)

	if err := s.extractZip(zipPath, extractDir); err != nil {
		log.Errorf("Failed to extract zip model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to extract zip: %w", err)
	}

	hasPypsa := pypsaEnabled && hasPypsaDir(extractDir)
	log.Debugf("PyPSA processing: enabled=%v, dir_exists=%v, will_process=%v", pypsaEnabled, hasPypsaDir(extractDir), hasPypsa)

	parser := NewResultParser(extractDir, hasPypsa)
	if err := parser.ValidateAndLocateFiles(); err != nil {
		log.Errorf("Validation failed model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	summary, err := parser.ParseSummary()
	if err != nil {
		log.Errorf("Summary parsing failed model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("summary parsing failed: %w", err)
	}

	scale := parser.DetectPowerScaleFromEnergyCap(summary.EnergyCap)

	if scale != 1 {
		powerTechs := parser.CollectPowerTechs()
		for i := range summary.EnergyCap {
			tech := techBase(summary.EnergyCap[i].Tech)
			_, isPowerTech := powerTechs[tech]
			if isPowerTech || isDemandTech(tech) {
				summary.EnergyCap[i].Value *= scale
			}
		}
	}

	resultsJSON, err := summary.ToJSON()
	if err != nil {
		log.Errorf("Failed to serialize results model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to serialize results: %w", err)
	}

	// Remove older extracted directories for this model to avoid storage growth.
	var existing []commonModels.ModelResult
	if err := s.db.Where("model_id = ?", modelID).Find(&existing).Error; err == nil {
		for _, prev := range existing {
			if prev.ExtractedPath != "" && prev.ExtractedPath != extractDir {
				if rmErr := os.RemoveAll(prev.ExtractedPath); rmErr != nil {
					log.Warnf("failed to delete stale extracted directory model_id=%d path=%s err=%v", modelID, prev.ExtractedPath, rmErr)
				}
			}
		}
	}

	// Delete existing ModelResult for re-runs
	if err := s.db.Where("model_id = ?", modelID).Delete(&commonModels.ModelResult{}).Error; err != nil {
		log.Warnf("Failed to delete existing model result model_id=%d err=%v", modelID, err)
	}

	// Delete existing results in a transaction
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		return s.deleteExistingResults(tx, modelID)
	}); err != nil {
		log.Errorf("Failed to delete existing results model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to delete existing results: %w", err)
	}

	tifPath, tifName := findTifFile(extractDir)

	// Store small data in DB (transaction)
	if err := s.storeSmallResults(ctx, modelID, summary); err != nil {
		log.Errorf("Failed to store small results model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to store small results: %w", err)
	}

	result = &commonModels.ModelResult{
		ModelID:          modelID,
		UserID:           userID,
		ZipPath:          zipPath,
		ExtractedPath:    extractDir,
		TifFilePath:      tifPath,
		TifFileName:      tifName,
		FileSizeBytes:    zipStat.Size(),
		ExtractionStatus: commonModels.ResultExtractionCompleted,
		Metadata:         datatypes.JSON(resultsJSON),
	}

	if err := s.db.Create(result).Error; err != nil {
		log.Errorf("Failed to save result to database model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to save result: %w", err)
	}

	// Stream large data to DB (no wrapping transaction — streamed in batches)
	inserter := NewStreamingInserter(ctx, s.db, modelID, scale)
	if err := inserter.StreamAll(parser.ResultsDir(), parser.PyPSADir(), parser.HasPyPSA()); err != nil {
		log.Errorf("Failed to stream results model_id=%d err=%v", modelID, err)
		_ = s.db.Model(result).Updates(map[string]interface{}{
			"extraction_status": commonModels.ResultExtractionFailed,
			"error_message":     err.Error(),
		}).Error
		return nil, fmt.Errorf("failed to stream results to DB: %w", err)
	}

	// Update model with sums and results JSON
	summary.SumProduction = inserter.SumProduction
	summary.SumConsumption = inserter.SumConsumption
	resultsJSON, _ = summary.ToJSON()

	modelUpdate := map[string]interface{}{
		"results": datatypes.JSON(resultsJSON),
	}
	if err := s.db.Model(&commonModels.Model{}).Where("id = ?", modelID).Updates(modelUpdate).Error; err != nil {
		log.Warnf("Failed to update model results model_id=%d err=%v", modelID, err)
	}

	return result, nil
}
