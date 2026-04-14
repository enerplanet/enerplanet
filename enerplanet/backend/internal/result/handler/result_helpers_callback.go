package result

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	commonModels "platform.local/common/pkg/models"
	"spatialhub_backend/internal/jobs"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

func (h *ResultHandler) handleWebserviceFailure(c *gin.Context, model *commonModels.Model, errorMessage string, log *logrus.Entry) {
	if errorMessage == "" {
		errorMessage = "Calculation failed on webservice"
	}

	now := time.Now().UTC()
	updateData := map[string]interface{}{
		"status":                   commonModels.ModelStatusFailed,
		"calculation_completed_at": now,
		"updated_at":               now,
		"results": gin.H{
			"error": errorMessage,
		},
	}

	if err := h.store.UpdateModel(model, updateData); err != nil {
		log.Errorf("Failed to update model status to failed model_id=%d err=%v", model.ID, err)
	}

	// Release the webservice and cancel the session
	if model.WebserviceID != nil && h.wsClient != nil {
		if model.SessionID != nil {
			sessionID := fmt.Sprintf("%d", *model.SessionID)
			if err := h.wsClient.CancelSession(c.Request.Context(), *model.WebserviceID, sessionID); err != nil {
				log.Warnf("failed to cancel session model_id=%d webservice_id=%d err=%v", model.ID, *model.WebserviceID, err)
			}
		}

		h.releaseWebservice(c.Request.Context(), *model.WebserviceID, log.WithField("model_id", model.ID))
	}

	// Send failure notification
	if h.notificationService != nil {
		go func() {
			if err := h.notificationService.SendModelCompletionNotification(
				context.Background(),
				model.UserID,
				model.UserEmail,
				model.Title,
				model.ID,
				"failed",
			); err != nil {
				log.Errorf("failed to send failure notification model_id=%d err=%v", model.ID, err)
			}
		}()
	}

	log.Errorf("Model calculation failed model_id=%d error=%s", model.ID, errorMessage)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"message":  "Failure status received and model marked as failed",
		"model_id": model.ID,
	})
}
func (h *ResultHandler) findModelForCallback(c *gin.Context, log *logrus.Entry) (*commonModels.Model, bool) {
	idParam := c.Param("id")

	model, err := h.store.GetModelByIDStr(idParam)
	if err == gorm.ErrRecordNotFound {
		sessionIDStr := c.PostForm("session_id")
		if sessionIDStr != "" {
			model, err = h.store.GetModelBySessionID(sessionIDStr)
		}
	}

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errModelNotFound)
		} else {
			log.Errorf("Database error looking up model: %v", err)
			httputil.InternalError(c, errFailedToFetchModel)
		}
		return nil, false
	}

	return model, true
}

func respondIfAlreadyProcessed(c *gin.Context, model *commonModels.Model) bool {
	// Block if model is already completed or currently being processed
	// Allow reprocessing of failed models
	if model.Status == commonModels.ModelStatusCompleted || model.Status == commonModels.ModelStatusProcessing {
		c.JSON(http.StatusOK, gin.H{
			"success":  true,
			"message":  "Model already processed",
			"model_id": model.ID,
			"status":   model.Status,
		})
		return true
	}
	return false
}

func (h *ResultHandler) handleFailureStatusIfNeeded(c *gin.Context, model *commonModels.Model, log *logrus.Entry) bool {
	status := c.PostForm("status")
	if status != "failed" && status != "error" {
		return false
	}

	h.handleWebserviceFailure(c, model, c.PostForm("error_message"), log)
	return true
}

func (h *ResultHandler) saveResultFile(c *gin.Context, model *commonModels.Model, log *logrus.Entry) (string, bool) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		httputil.BadRequest(c, "Missing file in request (field 'file')")
		return "", false
	}
	if fileHeader.Size <= 0 {
		httputil.BadRequest(c, "Uploaded file is empty")
		return "", false
	}
	if fileHeader.Size > maxCallbackZipSizeBytes {
		httputil.BadRequest(c, fmt.Sprintf("Uploaded file exceeds limit (%d MB)", maxCallbackZipSizeBytes/(1024*1024)))
		return "", false
	}

	if err := os.MkdirAll(constants.StorageDataDir, 0o755); err != nil {
		log.Errorf("Failed to create base storage directory %s: %v", constants.StorageDataDir, err)
		httputil.InternalError(c, "Failed to create base storage directory")
		return "", false
	}

	targetDir := fmt.Sprintf("%s/model_%d_%d", constants.StorageDataDir, model.ID, time.Now().Unix())
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		log.Errorf("Failed to create storage directory %s: %v", targetDir, err)
		httputil.InternalError(c, "Failed to create storage directory")
		return "", false
	}

	baseName := filepath.Base(fileHeader.Filename)
	// Sanitize filename: strip null bytes and restrict to safe characters
	sanitized := strings.Map(func(r rune) rune {
		if r == 0 {
			return -1
		}
		return r
	}, baseName)
	if sanitized == "" || sanitized == "." || sanitized == ".." {
		sanitized = "result.zip"
	}
	if !strings.HasSuffix(strings.ToLower(sanitized), ".zip") {
		sanitized = sanitized + ".zip"
	}
	targetPath := filepath.Join(targetDir, sanitized)
	if err := c.SaveUploadedFile(fileHeader, targetPath); err != nil {
		httputil.InternalError(c, "Failed to save uploaded file")
		return "", false
	}

	log.Debugf("callback zip saved model_id=%d path=%s size=%d", model.ID, targetPath, fileHeader.Size)
	return targetPath, true
}

func (h *ResultHandler) processResultUpload(c *gin.Context, model *commonModels.Model, targetPath string, log *logrus.Entry) {
	configPypsaEnabled := isPyPSAEnabledInConfig(model.Config)
	callbackPypsaRaw, callbackPypsaProvided := c.GetPostForm("pypsa")
	pypsaEnabled, callbackPypsaValue, callbackPypsaProvided, callbackParseErr := resolvePyPSAEnabledFromCallback(
		configPypsaEnabled,
		callbackPypsaRaw,
		callbackPypsaProvided,
	)
	if callbackParseErr != nil {
		log.Warnf(
			"Invalid callback pypsa value model_id=%d value=%q err=%v (falling back to config)",
			model.ID,
			callbackPypsaValue,
			callbackParseErr,
		)
	}
	log.Debugf(
		"Enqueuing result processing for model_id=%d, pypsa_from_config=%v, pypsa_callback_provided=%v, pypsa_callback_value=%q, pypsa_enabled=%v",
		model.ID,
		configPypsaEnabled,
		callbackPypsaProvided,
		callbackPypsaValue,
		pypsaEnabled,
	)

	// Set model status to processing
	_ = h.store.UpdateModel(model, map[string]interface{}{
		"status":     commonModels.ModelStatusProcessing,
		"updated_at": time.Now().UTC(),
	})

	// Build and enqueue Asynq task
	payload := jobs.ProcessResultPayload{
		ModelID:      model.ID,
		UserID:       model.UserID,
		UserEmail:    model.UserEmail,
		Title:        model.Title,
		ZipPath:      targetPath,
		PyPSAEnabled: pypsaEnabled,
		WebserviceID: model.WebserviceID,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		log.Errorf("Failed to marshal process_result payload model_id=%d err=%v", model.ID, err)
		h.handleResultProcessingError(c, model, err, log)
		return
	}

	task := asynq.NewTask(jobs.TypeProcessResult, payloadBytes, asynq.Queue("results"), asynq.MaxRetry(1))
	if _, err := h.asynqClient.Enqueue(task); err != nil {
		log.Errorf("Failed to enqueue process_result task model_id=%d err=%v", model.ID, err)
		h.handleResultProcessingError(c, model, err, log)
		return
	}

	log.Debugf("Result processing enqueued for model_id=%d", model.ID)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"message":  "Result received, processing queued",
		"model_id": model.ID,
	})
}
func isPyPSAEnabledInConfig(config []byte) bool {
	if len(config) == 0 {
		return true // Default to enabled if no config
	}

	var configMap map[string]interface{}
	if err := json.Unmarshal(config, &configMap); err != nil {
		return true // Default to enabled if config is invalid
	}

	pypsa, exists := configMap["pypsa"]
	if !exists {
		return true // Default to enabled if pypsa key doesn't exist
	}

	// Check if pypsa is explicitly set to false (boolean)
	if pypsaBool, ok := pypsa.(bool); ok {
		return pypsaBool
	}

	// If pypsa is an object (config), it's enabled
	if _, ok := pypsa.(map[string]interface{}); ok {
		return true
	}

	return true // Default to enabled
}

func resolvePyPSAEnabledFromCallback(configEnabled bool, callbackValue string, callbackProvided bool) (bool, string, bool, error) {
	if !callbackProvided {
		return configEnabled, callbackValue, false, nil
	}

	trimmed := strings.TrimSpace(callbackValue)
	parsed, err := strconv.ParseBool(trimmed)
	if err != nil {
		return configEnabled, trimmed, true, err
	}

	// Callback can only narrow behavior (disable PyPSA), never force-enable when config disables it.
	return configEnabled && parsed, trimmed, true, nil
}

func (h *ResultHandler) handleResultProcessingError(c *gin.Context, model *commonModels.Model, err error, log *logrus.Entry) {
	log.Errorf("Failed to process result model_id=%d err=%v", model.ID, err)

	errorMessage := "Failed to process result"
	now := time.Now().UTC()
	_ = h.store.UpdateModel(model, map[string]interface{}{
		"status":                   commonModels.ModelStatusFailed,
		"calculation_completed_at": now,
		"updated_at":               now,
		"results": gin.H{
			"error": fmt.Sprintf("Failed to process result: %v", err),
		},
	})

	h.releaseAssignedWebservice(c.Request.Context(), model, log)
	httputil.InternalError(c, errorMessage)
}

func (h *ResultHandler) releaseAssignedWebservice(ctx context.Context, model *commonModels.Model, log *logrus.Entry) {
	if model.WebserviceID == nil {
		return
	}

	h.releaseWebservice(ctx, *model.WebserviceID, log.WithField("model_id", model.ID))
}

func (h *ResultHandler) releaseWebservice(ctx context.Context, webserviceID uint, log *logrus.Entry) {
	if h.wsClient == nil {
		return
	}
	if err := h.wsClient.ReleaseInstance(ctx, webserviceID); err != nil {
		log.Warnf("failed to release webservice webservice_id=%d err=%v", webserviceID, err)
	} else {
		log.Debugf("released webservice webservice_id=%d", webserviceID)
	}
}
