package model

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"platform.local/common/pkg/contracts"
	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"
	modelstore "spatialhub_backend/internal/store/model"
)

const maxLifecycleFailureReasonLength = 8192

type lifecycleStore interface {
	ClaimRunning(context.Context, uint, uint, time.Time) (modelstore.LifecycleTransition, error)
	MarkFailed(context.Context, uint, string, time.Time) (modelstore.LifecycleTransition, error)
	UpdateRunSession(context.Context, uint, *int64, *string, time.Time) (string, error)
	ListActiveModels(context.Context) ([]contracts.ActiveModel, error)
}

// Model lifecycle handler.
type LifecycleHandler struct {
	store lifecycleStore
	now   func() time.Time
}

func NewLifecycleHandler(db *gorm.DB) *LifecycleHandler {
	return &LifecycleHandler{
		store: modelstore.NewStore(db),
		now:   func() time.Time { return time.Now().UTC() },
	}
}

func (h *LifecycleHandler) MarkRunning(c *gin.Context) {
	modelID, ok := lifecycleModelID(c)
	if !ok {
		return
	}

	var req contracts.MarkRunningRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.WebserviceID == 0 {
		httputil.BadRequest(c, "A valid webservice_id is required")
		return
	}

	transition, err := h.store.ClaimRunning(c.Request.Context(), modelID, req.WebserviceID, h.now())
	if !h.handleStoreError(c, modelID, "mark running", err) {
		return
	}

	response := contracts.TransitionResponse{
		ModelID: modelID,
		Status:  transition.Status,
		Claimed: transition.Applied,
	}
	if !transition.Applied {
		c.JSON(http.StatusConflict, response)
		return
	}
	c.JSON(http.StatusOK, response)
}

func (h *LifecycleHandler) MarkFailed(c *gin.Context) {
	modelID, ok := lifecycleModelID(c)
	if !ok {
		return
	}

	var req contracts.MarkFailedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "Invalid failure request")
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Reason == "" {
		req.Reason = "Calculation failed"
	}
	if len(req.Reason) > maxLifecycleFailureReasonLength {
		httputil.BadRequest(c, "Failure reason is too long")
		return
	}

	transition, err := h.store.MarkFailed(c.Request.Context(), modelID, req.Reason, h.now())
	if !h.handleStoreError(c, modelID, "mark failed", err) {
		return
	}

	response := contracts.TransitionResponse{
		ModelID: modelID,
		Status:  transition.Status,
		Claimed: transition.Applied,
	}
	c.JSON(http.StatusOK, response)
}

func (h *LifecycleHandler) SetRunSession(c *gin.Context) {
	modelID, ok := lifecycleModelID(c)
	if !ok {
		return
	}

	var req contracts.RunSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "Invalid run-session request")
		return
	}
	if req.SessionID == nil && req.CallbackURL == nil {
		httputil.BadRequest(c, "At least one session field is required")
		return
	}

	status, err := h.store.UpdateRunSession(
		c.Request.Context(),
		modelID,
		req.SessionID,
		req.CallbackURL,
		h.now(),
	)
	if !h.handleStoreError(c, modelID, "update run session", err) {
		return
	}

	c.JSON(http.StatusOK, contracts.TransitionResponse{
		ModelID: modelID,
		Status:  status,
		Claimed: true,
	})
}

func (h *LifecycleHandler) ActiveModels(c *gin.Context) {
	models, err := h.store.ListActiveModels(c.Request.Context())
	if err != nil {
		logger.ForComponent("model_lifecycle").Errorf("failed to list active models: %v", err)
		httputil.InternalError(c, "Failed to list active models")
		return
	}
	c.JSON(http.StatusOK, contracts.ActiveModelsResponse{Models: models})
}

func (h *LifecycleHandler) handleStoreError(c *gin.Context, modelID uint, operation string, err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		httputil.NotFound(c, "Model not found")
		return false
	}
	logger.ForComponent("model_lifecycle").Errorf("failed to %s model_id=%d err=%v", operation, modelID, err)
	httputil.InternalError(c, "Model lifecycle update failed")
	return false
}

func lifecycleModelID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, strconv.IntSize)
	if err != nil || id == 0 {
		httputil.BadRequest(c, "Invalid model ID")
		return 0, false
	}
	return uint(id), true
}
