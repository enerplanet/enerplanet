package jobs

import (
	"encoding/json"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

// The MEME pipeline owns the model's terminal status. StartMemeCalculation puts
// the model in 'queue'; from there the dispatch and ingest handlers are the ONLY
// writers that move it on:
//
//	queue -> running  (dispatch submitted a TentaCron job)
//	running -> completed (ingest parsed the result and seeded the R2 tables)
//	queue|running -> failed (dispatch or ingest failed; zero masking)
//
// Without this the MEME path only ever wrote model_meme_runs, so a finished or
// failed run left models.status 'queue' forever: the UI showed a run that never
// ends, and the "already in progress" guard blocked every re-run.
//
// The column set mirrors the legacy store.MarkFailed so both paths leave a model
// in the same shape.

func markModelRunning(db *gorm.DB, modelID uint) {
	markModelStatus(db, modelID, commonModels.ModelStatusRunning, nil, nil)
}

func markModelCompleted(db *gorm.DB, modelID uint) {
	now := time.Now().UTC()
	markModelStatus(db, modelID, commonModels.ModelStatusCompleted, &now, nil)
}

func markModelFailed(db *gorm.DB, modelID uint, reason string) {
	now := time.Now().UTC()
	markModelStatus(db, modelID, commonModels.ModelStatusFailed, &now, &reason)
}

// markModelStatus applies a status transition to a model that is still in the
// MEME lifecycle (queue|running), so a late failure can never clobber a model
// another path already finished.
func markModelStatus(db *gorm.DB, modelID uint, status string, completedAt *time.Time, reason *string) {
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now().UTC(),
	}
	if completedAt != nil {
		updates["calculation_completed_at"] = *completedAt
	}
	if reason != nil {
		res, err := json.Marshal(map[string]string{"error": *reason})
		if err == nil {
			updates["results"] = datatypes.JSON(res)
		}
	}

	err := db.Model(&commonModels.Model{}).
		Where("id = ? AND status IN ?", modelID, []string{
			commonModels.ModelStatusQueue,
			commonModels.ModelStatusRunning,
		}).
		Updates(updates).Error
	if err != nil {
		logger.ForComponent("job:meme_status").Errorf("model %d: failed to set status %s: %v", modelID, status, err)
	}
}
