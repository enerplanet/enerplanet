package result

import (
	"fmt"
	"strings"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	commonModels "platform.local/common/pkg/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// getResultFromRequest fetches the result for the :id param with access validation for current user
func (h *ResultHandler) getResultFromRequest(c *gin.Context) (*commonModels.ModelResult, bool) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return nil, false
	}
	resultID := c.Param("id")
	result, ok := h.fetchResultWithAccess(c, userCtx.UserID, userCtx.Email, parseUint(resultID))
	if !ok {
		return nil, false
	}
	return result, true
}

// fetchResultWithAccess fetches a result by ID and validates user access
func (h *ResultHandler) fetchResultWithAccess(c *gin.Context, userID string, userEmail string, resultID uint) (*commonModels.ModelResult, bool) {
	result, err := h.store.GetResultByID(resultID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, "Result not found")
		} else {
			httputil.InternalError(c, "Failed to fetch result")
		}
		return nil, false
	}

	if result.UserID != userID {
		hasAccess := h.hasWorkspaceAccess(userID, userEmail, result.ModelID)
		if !hasAccess {
			httputil.Forbidden(c, errAccessDenied)
			return nil, false
		}
	}

	return result, true
}

// hasWorkspaceAccess checks if a user has access to a model through workspace sharing
func (h *ResultHandler) hasWorkspaceAccess(userID string, userEmail string, modelID uint) bool {
	model, err := h.store.GetModelByIDWithWorkspace(modelID)
	if err != nil {
		return false
	}

	if model.WorkspaceID == nil {
		return false
	}

	if h.isWorkspaceMember(model, userID, userEmail) {
		return true
	}

	return h.isInWorkspaceGroup(model, userID)
}

func (h *ResultHandler) isWorkspaceMember(model *commonModels.Model, userID, userEmail string) bool {
	for _, member := range model.Workspace.Members {
		if member.UserID == userID {
			return true
		}
		if userEmail != "" && member.Email != "" && strings.EqualFold(member.Email, userEmail) {
			return true
		}
	}
	return false
}

func (h *ResultHandler) isInWorkspaceGroup(model *commonModels.Model, userID string) bool {
	userGroupIDs, err := h.store.GetUserGroupIDs(userID)
	if err != nil || len(userGroupIDs) == 0 {
		return false
	}

	for _, wsGroup := range model.Workspace.Groups {
		for _, userGroupID := range userGroupIDs {
			if wsGroup.GroupID == userGroupID {
				return true
			}
		}
	}
	return false
}
func (h *ResultHandler) fetchModelByID(c *gin.Context, modelID string) (*commonModels.Model, bool) {
	model, err := h.store.GetModelByIDStr(modelID)
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

func (h *ResultHandler) userHasModelAccess(c *gin.Context, model *commonModels.Model, userCtx *httputil.UserContext) bool {
	// Expert users can access all models
	if userCtx.AccessLevel == constants.AccessLevelExpert {
		return true
	}

	isOwner := model.UserID == userCtx.UserID
	hasWorkspaceAccess := h.hasWorkspaceAccess(userCtx.UserID, userCtx.Email, model.ID)
	hasModelShare := h.store.CountModelSharesByModelAndUserOrEmail(model.ID, userCtx.UserID, userCtx.Email) > 0

	if !isOwner && !hasWorkspaceAccess && !hasModelShare {
		httputil.Forbidden(c, errAccessDenied)
		return false
	}
	return true
}

func (h *ResultHandler) fetchResults(c *gin.Context, modelID string) ([]commonModels.ModelResult, error) {
	results, err := h.store.GetModelResults(parseUint(modelID))
	if err != nil {
		httputil.InternalError(c, "Failed to fetch results")
		return nil, err
	}
	return results, nil
}
func parseUint(s string) uint {
	var val uint
	n := 0
	if _, err := fmt.Sscanf(s, "%d", &n); err == nil && n > 0 {
		val = uint(n)
	}
	return val
}
