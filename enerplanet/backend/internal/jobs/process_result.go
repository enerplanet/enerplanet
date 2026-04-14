package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
	resultservice "spatialhub_backend/internal/result/service"
	"spatialhub_backend/internal/services"
	"spatialhub_backend/internal/webservice"
)

const (
	TypeProcessResult = "process_result"
)

type ProcessResultPayload struct {
	ModelID      uint   `json:"model_id"`
	UserID       string `json:"user_id"`
	UserEmail    string `json:"user_email"`
	Title        string `json:"title"`
	ZipPath      string `json:"zip_path"`
	PyPSAEnabled bool   `json:"pypsa_enabled"`
	WebserviceID *uint  `json:"webservice_id,omitempty"`
}

func HandleProcessResult(ctx context.Context, t *asynq.Task, db *gorm.DB, notificationService *services.NotificationService, wsClient *webservice.Client) (retErr error) {
	log := logger.ForComponent("job:process_result")

	// Recover from panics so we get a proper error log instead of silent crash
	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in HandleProcessResult: %v", r)
			retErr = fmt.Errorf("panic in result processing: %v", r)
		}
	}()

	var payload ProcessResultPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	log.Debugf("Starting background processing for model_id=%d", payload.ModelID)

	// Idempotency Check: Ensure we aren't already processing or finished
	var model commonModels.Model
	if err := db.First(&model, payload.ModelID).Error; err != nil {
		log.Errorf("Failed to fetch model %d: %v", payload.ModelID, err)
		return fmt.Errorf("failed to fetch model %d: %w", payload.ModelID, err)
	}

	if model.Status == commonModels.ModelStatusCompleted {
		log.Debugf("Model %d already completed, skipping", payload.ModelID)
		return nil
	}

	// 2. Mark as 'processing' to prevent concurrent worker interference
	if err := db.Model(&model).Update("status", commonModels.ModelStatusProcessing).Error; err != nil {
		log.Errorf("Failed to lock model %d for processing: %v", payload.ModelID, err)
		return fmt.Errorf("failed to lock model %d for processing: %w", payload.ModelID, err)
	}

	resultSvc := resultservice.NewResultService(db)
	res, err := resultSvc.ProcessModelResult(ctx, payload.ModelID, payload.UserID, payload.ZipPath, payload.PyPSAEnabled)

	if err != nil {
		log.Errorf("Failed to process result model_id=%d err=%v", payload.ModelID, err)

		now := time.Now().UTC()
		_ = db.Model(&commonModels.Model{}).Where("id = ?", payload.ModelID).Updates(map[string]interface{}{
			"status":                   commonModels.ModelStatusFailed,
			"calculation_completed_at": now,
			"updated_at":               now,
			"results": map[string]interface{}{
				"error": fmt.Sprintf("Failed to process result: %v", err),
			},
		}).Error

		releaseWebservice(ctx, wsClient, payload.WebserviceID, payload.ModelID, log)
		return fmt.Errorf("process result failed for model_id=%d: %w", payload.ModelID, err)
	}

	if res == nil {
		return fmt.Errorf("process result returned nil for model_id=%d", payload.ModelID)
	}

	// 3. Final Success Update (Model status + results metadata)
	now := time.Now().UTC()
	err = db.Transaction(func(tx *gorm.DB) error {
		return tx.Model(&commonModels.Model{}).Where("id = ?", payload.ModelID).Updates(map[string]interface{}{
			"status": commonModels.ModelStatusCompleted,
			"results": map[string]interface{}{
				"file_path":  res.ZipPath,
				"output_dir": res.ExtractedPath,
			},
			"webservice_id":            nil,
			"calculation_completed_at": now,
			"updated_at":               now,
		}).Error
	})

	if err != nil {
		log.Errorf("Failed to commit final model status model_id=%d err=%v", payload.ModelID, err)
		return err
	}

	releaseWebservice(ctx, wsClient, payload.WebserviceID, payload.ModelID, log)

	// Send completion notification
	if notificationService != nil {
		if err := notificationService.SendModelCompletionNotification(
			ctx,
			payload.UserID,
			payload.UserEmail,
			payload.Title,
			payload.ModelID,
			"completed",
		); err != nil {
			log.Errorf("failed to send completion notification model_id=%d err=%v", payload.ModelID, err)
		}
	}

	log.Debugf("Successfully processed result for model_id=%d result_id=%d", payload.ModelID, res.ID)
	return nil
}

func releaseWebservice(ctx context.Context, wsClient *webservice.Client, webserviceID *uint, modelID uint, log *logrus.Entry) {
	if wsClient == nil || webserviceID == nil {
		return
	}
	if err := wsClient.ReleaseInstance(ctx, *webserviceID); err != nil {
		log.Warnf("failed to release webservice model_id=%d webservice_id=%d err=%v", modelID, *webserviceID, err)
	} else {
		log.Debugf("released webservice model_id=%d webservice_id=%d", modelID, *webserviceID)
	}
}
