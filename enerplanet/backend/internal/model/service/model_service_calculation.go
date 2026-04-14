package modelservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/models"
	platformlogger "platform.local/platform/logger"
	"spatialhub_backend/internal/payload"
)

func (s *ModelService) BuildCalculationPayload(model *models.Model) interface{} {
	return payload.BuildCalculationPayload(model)
}

func (s *ModelService) LogCalculationPayload(model *models.Model, calcPayload interface{}) {
	log := platformlogger.ForComponent("model")
	logsDir := "logs"
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		log.Warnf("failed to create logs directory: %v", err)
		return
	}

	jsonBytes, err := json.MarshalIndent(calcPayload, "", "  ")
	if err != nil {
		return
	}

	filename := fmt.Sprintf("%s/calculation_payload_model_%d_%s.json", logsDir, model.ID, time.Now().UTC().Format("2006-01-02_15-04-05"))
	if err := os.WriteFile(filename, jsonBytes, 0644); err != nil {
		log.Warnf("failed to write calculation payload to %s: %v", filename, err)
	}
}

func (s *ModelService) StartCalculation(ctx context.Context, userID string, accessLevel string, modelIDParam string, asynqClient *asynq.Client) (*models.Model, error) {
	log := platformlogger.ForComponent("model")

	model, err := s.store.FindModelWithWorkspace(modelIDParam)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("model not found: %w", err)
		}
		return nil, fmt.Errorf("failed to fetch model: %w", err)
	}

	if accessLevel != constants.AccessLevelExpert && !s.UserHasModelAccess(userID, model) {
		return nil, fmt.Errorf("access denied")
	}

	if model.Status == models.ModelStatusRunning || model.Status == models.ModelStatusQueue {
		return nil, fmt.Errorf("model calculation already in progress")
	}

	now := time.Now().UTC()
	if err := s.store.Update(model, map[string]interface{}{
		"status":                   models.ModelStatusQueue,
		"calculation_started_at":   now,
		"calculation_completed_at": nil,
		"updated_at":               now,
	}); err != nil {
		return nil, fmt.Errorf("failed to update model status: %w", err)
	}
	model.Status = models.ModelStatusQueue

	type taskPayload struct {
		ModelID uint        `json:"model_id"`
		UserID  string      `json:"user_id"`
		Payload interface{} `json:"payload"`
	}

	calcPayload := s.BuildCalculationPayload(model)
	// s.LogCalculationPayload(model, calcPayload)

	payloadBytes, err := json.Marshal(taskPayload{
		ModelID: model.ID,
		UserID:  userID,
		Payload: calcPayload,
	})
	if err != nil {
		log.Errorf("failed to marshal task payload model_id=%d err=%v", model.ID, err)
		return nil, fmt.Errorf("failed to marshal task payload: %w", err)
	}

	task := asynq.NewTask("dispatch_model_calculation", payloadBytes)
	_, err = asynqClient.Enqueue(task,
		asynq.Queue("spatialAI_public"),
		asynq.MaxRetry(100),
		asynq.Timeout(24*time.Hour), // long timeout; stuck-model scheduler is the real safety net
		asynq.Retention(24*time.Hour),
	)
	if err != nil {
		log.Errorf("failed to enqueue task model_id=%d err=%v", model.ID, err)
		return nil, fmt.Errorf("failed to enqueue calculation: %w", err)
	}

	return model, nil
}
