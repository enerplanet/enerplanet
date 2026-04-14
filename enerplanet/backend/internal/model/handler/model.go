package model

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "spatialhub_backend/internal/api/contracts" // swagger response types
	"spatialhub_backend/internal/cache"
	resultservice "spatialhub_backend/internal/result/service"
	modelstore "spatialhub_backend/internal/store/model"
	"spatialhub_backend/internal/webservice"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
	pkgauth "platform.local/platform/auth"
	ikc "platform.local/platform/keycloak"
	"platform.local/platform/logger"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	errAccessDenied          = "Access denied"
	errAccessDeniedWorkspace = "Access denied to workspace"
	errModelNotFound         = "Model not found"
	errFailedToFetchModel    = "Failed to fetch model"
	errModelLimitReached     = "Model creation limit reached"
	dateFormat               = "2006-01-02"
	sqlUserStatusNotDeleted  = "user_id = ? AND status = ? AND deleted_at IS NULL"
	sqlWhereID               = "id = ?"
	sqlWhereAccessLevel      = "access_level = ?"
	preloadWorkspaceMembers  = "Workspace.Members"
	preloadWorkspaceGroups   = "Workspace.Groups"
)

// extractModelID extracts the model ID from a map value with type conversion
func extractModelID(idVal interface{}) uint {
	switch v := idVal.(type) {
	case uint:
		return v
	case int:
		return uint(v)
	case int64:
		return uint(v)
	case float64:
		return uint(v)
	default:
		return 0
	}
}

// toJSONOrNull converts raw JSON to datatypes.JSON, using null for empty values
func toJSONOrNull(raw json.RawMessage) datatypes.JSON {
	if len(raw) > 0 {
		return datatypes.JSON(raw)
	}
	return datatypes.JSON([]byte("null"))
}

type ModelHandler struct {
	store         *modelstore.Store
	asynqClient   *asynq.Client
	kc            *ikc.Client
	wsClient      *webservice.Client
	keycloakCache *cache.KeycloakCacheService
	syncCache     *cache.SyncCacheService
}

func NewModelHandlerWithCache(db *gorm.DB, asynqClient *asynq.Client, adminTokenProvider *pkgauth.AdminTokenProvider, keycloakBaseURL, realm string, wsClient *webservice.Client, keycloakCache *cache.KeycloakCacheService, syncCache *cache.SyncCacheService) *ModelHandler {
	return &ModelHandler{
		store:         modelstore.NewStore(db),
		asynqClient:   asynqClient,
		kc:            ikc.NewClient(keycloakBaseURL, realm, adminTokenProvider),
		wsClient:      wsClient,
		keycloakCache: keycloakCache,
		syncCache:     syncCache,
	}
}
func (h *ModelHandler) CreateModel(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	// Check model creation limit
	effectiveLimit, currentUsage, limitReached := h.checkModelLimit(c.Request.Context(), userCtx.UserID, userCtx.AccessLevel)
	if limitReached {
		httputil.Forbidden(c, fmt.Sprintf("%s. You have %d/%d models.", errModelLimitReached, currentUsage, effectiveLimit))
		return
	}

	var req struct {
		Title         string          `json:"title" binding:"required"`
		Description   *string         `json:"description"`
		WorkspaceID   *uint           `json:"workspace_id"`
		Coordinates   json.RawMessage `json:"coordinates"`
		Region        *string         `json:"region"`
		Country       *string         `json:"country"`
		Resolution    *int            `json:"resolution"`
		FromDate      string          `json:"from_date" binding:"required"`
		ToDate        string          `json:"to_date" binding:"required"`
		Config        json.RawMessage `json:"config"`
		GroupID       *uint           `json:"group_id"`
		ParentModelID *uint           `json:"parent_model_id"`
		IsCopy        *bool           `json:"is_copy"`
		IsActive      *bool           `json:"is_active"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "Invalid request data: "+err.Error())
		return
	}

	fromDate, err := time.Parse(dateFormat, req.FromDate)
	if err != nil {
		httputil.BadRequest(c, "Invalid from_date format. Use YYYY-MM-DD")
		return
	}

	toDate, err := time.Parse(dateFormat, req.ToDate)
	if err != nil {
		httputil.BadRequest(c, "Invalid to_date format. Use YYYY-MM-DD")
		return
	}

	if req.WorkspaceID != nil {
		if !h.ensureWorkspaceAccess(c, userCtx.UserID, *req.WorkspaceID, errAccessDeniedWorkspace) {
			return
		}
	}

	isActive := false
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	model := models.Model{
		UserID:        userCtx.UserID,
		UserEmail:     userCtx.Email,
		WorkspaceID:   req.WorkspaceID,
		Title:         req.Title,
		Description:   req.Description,
		Status:        models.ModelStatusDraft,
		Region:        req.Region,
		Country:       req.Country,
		Resolution:    req.Resolution,
		FromDate:      fromDate,
		ToDate:        toDate,
		GroupID:       req.GroupID,
		ParentModelID: req.ParentModelID,
		IsCopy:        req.IsCopy != nil && *req.IsCopy,
		IsActive:      isActive,
	}

	model.Coordinates = toJSONOrNull(req.Coordinates)
	model.Config = toJSONOrNull(req.Config)
	model.Results = datatypes.JSON([]byte("null"))

	// Use map to avoid inserting BufferDistance which was removed from DB
	// but still exists in the shared struct (which we cannot modify due to permissions)
	modelMap := map[string]interface{}{
		"user_id":         model.UserID,
		"user_email":      model.UserEmail,
		"workspace_id":    model.WorkspaceID,
		"title":           model.Title,
		"description":     model.Description,
		"status":          model.Status,
		"region":          model.Region,
		"country":         model.Country,
		"resolution":      model.Resolution,
		"from_date":       model.FromDate,
		"to_date":         model.ToDate,
		"group_id":        model.GroupID,
		"parent_model_id": model.ParentModelID,
		"is_copy":         model.IsCopy,
		"is_active":       model.IsActive,
		"coordinates":     model.Coordinates,
		"config":          model.Config,
		"results":         model.Results,
		"created_at":      time.Now().UTC(),
		"updated_at":      time.Now().UTC(),
	}

	if err := h.store.Create(modelMap); err != nil {
		logger.ForComponent("model").Errorf("Failed to create model: %v", err)
		httputil.InternalError(c, "Failed to create model")
		return
	}

	// Update model ID from map
	if idVal, ok := modelMap["id"]; ok {
		model.ID = extractModelID(idVal)
	}
	model.CreatedAt = modelMap["created_at"].(time.Time)
	model.UpdatedAt = modelMap["updated_at"].(time.Time)

	httputil.Created(c, model)
}

// GetModels godoc
// @Summary      List models for the authenticated user
// @Description  Returns a paginated list of energy planning models the user has access to,
// @Description  filtered by workspace and search query. Includes shared and workspace-scoped models.
// @Tags         EnerPlanET
// @Accept       json
// @Produce      json
// @Param        limit        query  int     false  "Max results per page"  default(100)
// @Param        offset       query  int     false  "Pagination offset"    default(0)
// @Param        search       query  string  false  "Search models by title (case-insensitive)"
// @Param        workspace_id query  int     false  "Filter by workspace ID"
// @Success      200  {object}  contracts.GetModelsResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      500  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /models [get]
func (h *ModelHandler) GetModels(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	ctx := c.Request.Context()
	modelSvc := h.newModelService()

	// Only sync once per session (cached)
	if h.syncCache == nil || !h.syncCache.HasSynced(ctx, userCtx.UserID) {
		modelSvc.SyncWorkspaceMemberUserID(userCtx.UserID, userCtx.Email)
		if h.syncCache != nil {
			_ = h.syncCache.MarkSynced(ctx, userCtx.UserID)
		}
	}

	limit, offset, search, workspaceIDStr, sortBy, sortOrder := parseGetModelsParams(c)

	query, ok := h.buildQueryWithWorkspaceFilter(c, userCtx, workspaceIDStr, limit, offset)
	if !ok {
		return
	}

	query = h.applySearchFilter(query, search)

	modelsList, total, err := h.fetchModelsWithQuery(query, limit, offset, sortBy, sortOrder)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch models")
		return
	}

	modelsList = h.includeParentModels(modelsList)
	modelsList = h.postProcessModelWorkspacesBatch(ctx, userCtx, modelsList)
	modelsList = h.applyPrivacyFilters(*userCtx, modelsList)

	c.JSON(200, gin.H{
		"success":     true,
		"data":        modelsList,
		"total":       total,
		"limit":       limit,
		"offset":      offset,
		"server_time": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *ModelHandler) GetModel(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id := c.Param("id")
	var model models.Model

	err := h.store.DB().
		Preload(preloadWorkspaceMembers).
		Preload(preloadWorkspaceGroups).
		Preload("ParentModel").
		Preload("Shares").
		Where(sqlWhereID, id).
		First(&model).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errModelNotFound)
		} else {
			httputil.InternalError(c, errFailedToFetchModel)
		}
		return
	}

	if userCtx.AccessLevel != constants.AccessLevelExpert && !h.newModelService().UserHasModelAccessByEmail(userCtx.UserID, userCtx.Email, &model) {
		httputil.Forbidden(c, errAccessDenied)
		return
	}

	h.handleSharedModelWorkspace(userCtx.UserID, &model)
	h.filterModelShares(&model, userCtx.UserID, userCtx.Email)
	h.filterWorkspaceData(&model, userCtx.UserID, userCtx.Email)

	httputil.SuccessResponse(c, model)
}
func (h *ModelHandler) UpdateModel(c *gin.Context) {
	userCtx, model, id, ok := h.getEditableModelWithContext(c)
	if !ok {
		return
	}

	var req updateModelRequest
	if !bindJSONOrBadRequest(c, &req) {
		return
	}

	updates := make(map[string]any)

	applySimpleStringUpdates(&req, updates)
	applyNumericUpdates(&req, updates)
	applyJSONUpdates(&req, updates)

	if !applyDateUpdates(c, &req, updates) {
		return
	}

	if req.WorkspaceID != nil {
		if !h.ensureWorkspaceAccess(c, userCtx.UserID, *req.WorkspaceID, errAccessDeniedWorkspace) {
			return
		}
		updates["workspace_id"] = *req.WorkspaceID
	}

	if len(updates) > 0 {
		updates["updated_at"] = time.Now().UTC()
		if err := h.store.Update(model, updates); err != nil {
			logger.ForComponent("model").Errorf("failed to update model id=%s err=%v", id, err)
			httputil.InternalError(c, "Failed to update model")
			return
		}
	}

	h.respondWithPreloadedModel(c, id, model)
}

func (h *ModelHandler) DeleteModel(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id := c.Param("id")
	model, ok := h.fetchModelWithDeletePermission(c, userCtx, id)
	if !ok {
		return
	}

	log := logger.ForComponent("model")

	h.releaseWebserviceIfNeeded(c, model, log)
	h.updateChildModels(model, log)
	h.deleteModelResults(c, model, log)

	if err := h.store.HardDelete(model); err != nil {
		httputil.InternalError(c, "Failed to delete model")
		return
	}

	httputil.SuccessMessage(c, "Model deleted")
}

func (h *ModelHandler) releaseWebserviceIfNeeded(c *gin.Context, model *models.Model, log *logrus.Entry) {
	if model.WebserviceID == nil || h.wsClient == nil {
		return
	}

	if model.Status == models.ModelStatusRunning || model.Status == models.ModelStatusQueue {
		if err := h.wsClient.ReleaseInstance(c.Request.Context(), *model.WebserviceID); err != nil {
			log.Warnf("failed to release webservice model_id=%d webservice_id=%d err=%v",
				model.ID, *model.WebserviceID, err)
		} else {
			log.Infof("released webservice on model delete model_id=%d webservice_id=%d", model.ID, *model.WebserviceID)
		}
	}
}

func (h *ModelHandler) updateChildModels(model *models.Model, log *logrus.Entry) {
	if err := h.store.UpdateParentModelID(model.ID); err != nil {
		log.Warnf("failed to update child models parent_model_id for model_id=%d err=%v", model.ID, err)
	}
}

func (h *ModelHandler) deleteModelResults(c *gin.Context, model *models.Model, log *logrus.Entry) {
	resultService := resultservice.NewResultService(h.store.DB())
	results, err := resultService.GetModelResults(c.Request.Context(), model.ID)
	if err == nil {
		for _, result := range results {
			if err := resultService.DeleteResult(c.Request.Context(), result.ID); err != nil {
				log.Warnf("failed to delete result model_id=%d result_id=%d err=%v", model.ID, result.ID, err)
			}
		}
	}
}

func (h *ModelHandler) GetModelStats(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	stats := struct {
		Total       int64 `json:"total"`
		Draft       int64 `json:"draft"`
		Queue       int64 `json:"queue"`
		Running     int64 `json:"running"`
		Completed   int64 `json:"completed"`
		Published   int64 `json:"published"`
		Failed      int64 `json:"failed"`
		Cancelled   int64 `json:"cancelled"`
		ModelLimit  int   `json:"model_limit"`
		Remaining   int   `json:"remaining"`
		IsUnlimited bool  `json:"is_unlimited"`
	}{}

	total, byStatus, err := h.store.CountByUserIDGrouped(userCtx.UserID)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch model stats")
		return
	}
	stats.Total = total
	stats.Draft = byStatus[models.ModelStatusDraft]
	stats.Queue = byStatus[models.ModelStatusQueue]
	stats.Running = byStatus[models.ModelStatusRunning]
	stats.Completed = byStatus[models.ModelStatusCompleted]
	stats.Published = byStatus[models.ModelStatusPublished]
	stats.Failed = byStatus[models.ModelStatusFailed]
	stats.Cancelled = byStatus[models.ModelStatusCancelled]

	// Add model limit info
	logger.WithFields(map[string]interface{}{
		"component":    "model_handler",
		"user_id":      userCtx.UserID,
		"access_level": userCtx.AccessLevel,
	}).Debug("GetModelStats: Getting model limits for user")

	// Use getEffectiveModelLimitForUser to check Keycloak user attributes first
	effectiveLimit := h.getEffectiveModelLimitForUser(c.Request.Context(), userCtx.UserID, userCtx.AccessLevel)

	logger.WithFields(map[string]interface{}{
		"component":       "model_handler",
		"user_id":         userCtx.UserID,
		"access_level":    userCtx.AccessLevel,
		"effective_limit": effectiveLimit,
		"is_unlimited":    effectiveLimit == 0,
	}).Debug("GetModelStats: Calculated effective limit")

	stats.ModelLimit = effectiveLimit
	stats.IsUnlimited = effectiveLimit == 0

	if effectiveLimit == 0 {
		stats.Remaining = -1 // -1 indicates unlimited
	} else {
		stats.Remaining = effectiveLimit - int(stats.Total)
		if stats.Remaining < 0 {
			stats.Remaining = 0
		}
	}

	httputil.SuccessResponse(c, stats)
}

func (h *ModelHandler) UpdateModelActivation(c *gin.Context) {
	_, model, id, ok := h.getEditableModelWithContext(c)
	if !ok {
		return
	}

	var req struct {
		IsActive bool `json:"is_active"`
	}

	if !bindJSONOrBadRequest(c, &req) {
		return
	}

	if err := h.store.Update(model, map[string]interface{}{"is_active": req.IsActive}); err != nil {
		httputil.InternalError(c, "Failed to update activation status")
		return
	}

	h.respondWithPreloadedModel(c, id, model)
}

func (h *ModelHandler) MoveModel(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	model, id, ok := h.getOwnedModelFromParam(c, userCtx.UserID)
	if !ok {
		return
	}

	var req struct {
		WorkspaceID *uint `json:"workspace_id"`
	}

	if !bindJSONOrBadRequest(c, &req) {
		return
	}

	if req.WorkspaceID != nil {
		if !h.ensureWorkspaceAccess(c, userCtx.UserID, *req.WorkspaceID, "Access denied to target workspace") {
			return
		}
	}

	if err := h.store.Update(model, map[string]interface{}{"workspace_id": req.WorkspaceID}); err != nil {
		httputil.InternalError(c, "Failed to move model")
		return
	}

	model.WorkspaceID = req.WorkspaceID

	h.respondWithPreloadedModel(c, id, model)
}

func (h *ModelHandler) BulkMoveModels(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req struct {
		ModelIDs    []uint `json:"model_ids" binding:"required"`
		WorkspaceID *uint  `json:"workspace_id"`
	}

	if !bindJSONOrBadRequest(c, &req) {
		return
	}

	if len(req.ModelIDs) == 0 {
		httputil.BadRequest(c, "No models specified")
		return
	}

	if req.WorkspaceID != nil {
		if !h.ensureWorkspaceAccess(c, userCtx.UserID, *req.WorkspaceID, "Access denied to target workspace") {
			return
		}
	}

	modelsList, err := h.store.FindByIDs(req.ModelIDs)
	if err != nil {
		httputil.InternalError(c, "Failed to load models")
		return
	}

	if len(modelsList) == 0 {
		httputil.NotFound(c, "No models found")
		return
	}

	successCount := 0
	failedCount := 0

	isExpert := userCtx.AccessLevel == constants.AccessLevelExpert

	for i := range modelsList {
		if !modelsList[i].IsOwner(userCtx.UserID) && !isExpert {
			failedCount++
			continue
		}

		if err := h.store.Update(&modelsList[i], map[string]interface{}{"workspace_id": req.WorkspaceID}); err != nil {
			failedCount++
			continue
		}

		successCount++
	}

	httputil.SuccessResponse(c, gin.H{
		"success_count": successCount,
		"failed_count":  failedCount,
		"total":         len(modelsList),
	})
}

func (h *ModelHandler) ShareModel(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	model, _, ok := h.getOwnedModelFromParam(c, userCtx.UserID)
	if !ok {
		return
	}

	var req shareModelRequest
	if !bindJSONOrBadRequest(c, &req) {
		return
	}

	permission, ok := validateSharePermission(c, req.Permission)
	if !ok {
		return
	}

	if !h.validateModelNotAlreadyAccessible(c, model, req.Email) {
		return
	}

	share := models.ModelShare{
		ModelID:    model.ID,
		UserID:     h.newModelService().FindUserIDByEmail(req.Email),
		Email:      req.Email,
		Permission: permission,
		SharedBy:   userCtx.UserID,
		SharedAt:   time.Now().UTC(),
	}

	if err := h.store.CreateModelShare(&share); err != nil {
		logger.WithFields(map[string]interface{}{
			"component": "share_model",
			"model_id":  model.ID,
			"email":     req.Email,
			"error":     err.Error(),
		}).Error("Failed to create model share")
		httputil.InternalError(c, "Failed to share model")
		return
	}

	logger.WithFields(map[string]interface{}{
		"component":        "share_model",
		"model_id":         model.ID,
		"shared_with":      req.Email,
		"resolved_user_id": share.UserID,
		"permission":       permission,
	}).Info("Model shared successfully")

	httputil.Created(c, share)
}

func (h *ModelHandler) StartCalculation(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	modelSvc := h.newModelService()
	updated, err := modelSvc.StartCalculation(c.Request.Context(), userCtx.UserID, userCtx.AccessLevel, c.Param("id"), h.asynqClient)
	if err != nil {
		msg := err.Error()
		switch {
		case strings.Contains(msg, "not found"):
			httputil.NotFound(c, errModelNotFound)
		case strings.Contains(msg, "access denied"):
			httputil.Forbidden(c, "Access denied")
		case strings.Contains(msg, "already in progress"):
			httputil.Conflict(c, "Model calculation already in progress")
		case strings.Contains(msg, "webservice"):
			httputil.BadGateway(c, "Calculation webservice error")
		default:
			httputil.InternalError(c, "Failed to start calculation")
		}
		return
	}

	httputil.SuccessResponse(c, updated)
}
