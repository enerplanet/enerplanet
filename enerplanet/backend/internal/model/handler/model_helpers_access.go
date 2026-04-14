package model

import (
	"context"
	"fmt"

	backendModels "spatialhub_backend/internal/models"
	modelservice "spatialhub_backend/internal/model/service"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
	"platform.local/platform/logger"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// newModelService creates a ModelService with caching if available
func (h *ModelHandler) newModelService() *modelservice.ModelService {
	if h.keycloakCache != nil {
		return modelservice.NewModelServiceWithCache(h.store.DB(), h.kc, h.keycloakCache)
	}
	return modelservice.NewModelService(h.store.DB(), h.kc)
}

// checkModelLimit checks if the user has reached their model creation limit
// Returns (effectiveLimit, currentUsage, limitReached)
// effectiveLimit of 0 means unlimited
func (h *ModelHandler) checkModelLimit(ctx context.Context, userID, accessLevel string) (int, int64, bool) {
	// Get the effective limit - check user-specific limit from Keycloak first
	effectiveLimit := h.getEffectiveModelLimitForUser(ctx, userID, accessLevel)

	// Unlimited (0 means no limit)
	if effectiveLimit == 0 {
		return 0, 0, false
	}

	// Count current usage
	currentUsage, _ := h.store.CountByUserID(userID)

	return effectiveLimit, currentUsage, currentUsage >= int64(effectiveLimit)
}

// getEffectiveModelLimitForUser returns the effective model limit for a user
// It checks for a user-specific limit in Keycloak attributes first, then falls back to access level default
func (h *ModelHandler) getEffectiveModelLimitForUser(ctx context.Context, userID, accessLevel string) int {
	// Try to get user-specific limit from Keycloak
	if h.kc != nil {
		userAttrs, err := h.kc.GetUserAttributes(ctx, userID)
		if err == nil {
			if modelLimitVals, ok := userAttrs["model_limit"]; ok && len(modelLimitVals) > 0 {
				var userLimit int
				if _, err := fmt.Sscanf(modelLimitVals[0], "%d", &userLimit); err == nil {
					return userLimit
				}
			}
		}
	}

	// Fall back to access level default
	return h.getEffectiveModelLimit(accessLevel)
}

// getEffectiveModelLimit returns the effective model limit for an access level
func (h *ModelHandler) getEffectiveModelLimit(accessLevel string) int {
	// Handle empty or unknown access level - default to basic user
	if accessLevel == "" {
		logger.WithFields(map[string]interface{}{
			"component": "model_handler",
		}).Warn("getEffectiveModelLimit: Empty access level, defaulting to very_low (10)")
		return backendModels.DefaultModelLimits[backendModels.AccessLevelVeryLow]
	}

	limit, err := h.store.GetModelLimit(accessLevel)
	if err != nil {
		// Return default if not found in database
		defaultLimit, exists := backendModels.DefaultModelLimits[accessLevel]
		if !exists {
			// Unknown access level defaults to basic user limit (10)
			logger.WithFields(map[string]interface{}{
				"component":    "model_handler",
				"access_level": accessLevel,
			}).Warn("getEffectiveModelLimit: Unknown access level, defaulting to very_low (10)")
			return backendModels.DefaultModelLimits[backendModels.AccessLevelVeryLow]
		}
		return defaultLimit
	}
	return limit.ModelLimit
}

func (h *ModelHandler) ensureWorkspaceAccess(c *gin.Context, userID string, workspaceID uint, message string) bool {
	userEmail := c.GetString("user_email")
	if h.newModelService().UserHasWorkspaceAccessWithEmail(userID, userEmail, workspaceID) {
		return true
	}
	if message == "" {
		message = errAccessDeniedWorkspace
	}
	httputil.Forbidden(c, message)
	return false
}

func bindJSONOrBadRequest(c *gin.Context, req any) bool {
	if err := c.ShouldBindJSON(req); err != nil {
		httputil.BadRequest(c, "Invalid request data")
		return false
	}
	return true
}

func (h *ModelHandler) getEditableModelWithContext(c *gin.Context) (*httputil.UserContext, *models.Model, string, bool) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return nil, nil, "", false
	}

	model, id, ok := h.getEditableModelFromParam(c, userCtx.UserID)
	if !ok {
		return nil, nil, "", false
	}

	return userCtx, model, id, true
}

func (h *ModelHandler) getEditableModelFromParam(c *gin.Context, userID string) (*models.Model, string, bool) {
	id := c.Param("id")
	model, ok := h.fetchModelWithEditPermission(c, userID, id)
	if !ok {
		return nil, "", false
	}
	return model, id, true
}

func (h *ModelHandler) getOwnedModelFromParam(c *gin.Context, userID string) (*models.Model, string, bool) {
	id := c.Param("id")
	model, ok := h.fetchModelWithOwnerPermission(c, userID, id)
	if !ok {
		return nil, "", false
	}
	return model, id, true
}

func (h *ModelHandler) respondWithPreloadedModel(c *gin.Context, id string, model *models.Model) {
	if loaded, err := h.store.FindByIDPreloaded(id); err == nil {
		*model = *loaded
	}
	httputil.SuccessResponse(c, model)
}

func (h *ModelHandler) fetchModel(c *gin.Context, id string) (*models.Model, bool) {
	model, err := h.store.FindByID(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errModelNotFound)
		} else {
			httputil.InternalError(c, errFailedToFetchModel)
		}
		return nil, false
	}
	return model, true
}

func (h *ModelHandler) fetchModelWithEditPermission(c *gin.Context, userID, modelID string) (*models.Model, bool) {
	model, ok := h.fetchModel(c, modelID)
	if !ok {
		return nil, false
	}

	// Experts can edit any model
	accessLevel := c.GetString("access_level")
	if accessLevel == constants.AccessLevelExpert {
		return model, true
	}

	if !model.CanBeEditedByUser(userID) {
		httputil.Forbidden(c, "You don't have permission to edit this model")
		return nil, false
	}

	return model, true
}

func (h *ModelHandler) fetchModelWithOwnerPermission(c *gin.Context, userID, modelID string) (*models.Model, bool) {
	model, ok := h.fetchModel(c, modelID)
	if !ok {
		return nil, false
	}

	if model.IsOwner(userID) {
		return model, true
	}

	// Experts can perform owner-level actions on any model
	accessLevel := c.GetString("access_level")
	if accessLevel == constants.AccessLevelExpert {
		return model, true
	}

	httputil.Forbidden(c, "Only model owner can perform this action")
	return nil, false
}

func (h *ModelHandler) fetchModelWithDeletePermission(c *gin.Context, userCtx *httputil.UserContext, modelID string) (*models.Model, bool) {
	model, ok := h.fetchModel(c, modelID)
	if !ok {
		return nil, false
	}

	if model.IsOwner(userCtx.UserID) {
		return model, true
	}

	if userCtx.AccessLevel == constants.AccessLevelExpert {
		return model, true
	}

	httputil.Forbidden(c, "Only the model owner or an expert can delete this model")
	return nil, false
}
