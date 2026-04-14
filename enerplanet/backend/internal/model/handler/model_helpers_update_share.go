package model

import (
	"encoding/json"
	"time"

	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
)

type updateModelRequest struct {
	Title       *string         `json:"title"`
	Description *string         `json:"description"`
	Status      *string         `json:"status"`
	WorkspaceID *uint           `json:"workspace_id"`
	Coordinates json.RawMessage `json:"coordinates"`
	Region      *string         `json:"region"`
	Country     *string         `json:"country"`
	Resolution  *int            `json:"resolution"`
	FromDate    *string         `json:"from_date"`
	ToDate      *string         `json:"to_date"`
	Config      json.RawMessage `json:"config"`
	Results     json.RawMessage `json:"results"`
	SessionID   *int64          `json:"session_id"`
	CallbackURL *string         `json:"callback_url"`
}

// applySimpleStringUpdates applies simple string field updates
func applySimpleStringUpdates(req *updateModelRequest, updates map[string]any) {
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.Region != nil {
		updates["region"] = *req.Region
	}
	if req.Country != nil {
		updates["country"] = *req.Country
	}
	if req.CallbackURL != nil {
		updates["callback_url"] = *req.CallbackURL
	}
}

// applyNumericUpdates applies numeric field updates
func applyNumericUpdates(req *updateModelRequest, updates map[string]any) {
	if req.Resolution != nil {
		updates["resolution"] = *req.Resolution
	}
	if req.SessionID != nil {
		updates["session_id"] = *req.SessionID
	}
}

// applyDateUpdates parses and applies date field updates
func applyDateUpdates(c *gin.Context, req *updateModelRequest, updates map[string]any) bool {
	if req.FromDate != nil {
		fromDate, err := time.Parse(dateFormat, *req.FromDate)
		if err != nil {
			httputil.BadRequest(c, "Invalid from_date format")
			return false
		}
		updates["from_date"] = fromDate
	}

	if req.ToDate != nil {
		toDate, err := time.Parse(dateFormat, *req.ToDate)
		if err != nil {
			httputil.BadRequest(c, "Invalid to_date format")
			return false
		}
		updates["to_date"] = toDate
	}

	return true
}

// applyJSONUpdates applies JSON field updates
func applyJSONUpdates(req *updateModelRequest, updates map[string]any) {
	if len(req.Coordinates) > 0 {
		updates["coordinates"] = datatypes.JSON(req.Coordinates)
	}
	if len(req.Config) > 0 {
		updates["config"] = datatypes.JSON(req.Config)
	}
	if len(req.Results) > 0 {
		updates["results"] = datatypes.JSON(req.Results)
	}
}

type shareModelRequest struct {
	Email      string `json:"email" binding:"required,email"`
	Permission string `json:"permission"`
}

// validateSharePermission validates and normalizes the permission value
func validateSharePermission(c *gin.Context, permission string) (string, bool) {
	if permission == "" {
		return models.ModelSharePermissionView, true
	}

	if permission != models.ModelSharePermissionView && permission != models.ModelSharePermissionEdit {
		httputil.BadRequest(c, "Invalid permission. Use 'view' or 'edit'")
		return "", false
	}

	return permission, true
}

// isWorkspaceSharedWithUser checks if workspace is directly shared with the user
func (h *ModelHandler) isWorkspaceSharedWithUser(workspaceID uint, email string) bool {
	return h.store.IsWorkspaceSharedWithUser(workspaceID, email)
}

// isWorkspaceSharedWithUserGroups checks if workspace is shared with any of the user's groups
func (h *ModelHandler) isWorkspaceSharedWithUserGroups(c *gin.Context, workspaceID uint, email string) bool {
	modelSvc := h.newModelService()
	targetUserID := modelSvc.FindUserIDByEmail(email)
	if targetUserID == "" {
		return false
	}

	groupIDs := modelSvc.GetUserGroupIDs(c.Request.Context(), targetUserID)
	if len(groupIDs) == 0 {
		return false
	}

	return h.store.IsWorkspaceSharedWithUserGroups(workspaceID, groupIDs)
}

// validateModelNotAlreadyAccessible checks if user already has access to the model
func (h *ModelHandler) validateModelNotAlreadyAccessible(c *gin.Context, model *models.Model, email string) bool {
	if model.WorkspaceID != nil {
		if h.isWorkspaceSharedWithUser(*model.WorkspaceID, email) {
			httputil.BadRequest(c, "Workspace already shared with this user; they already have access to this model")
			return false
		}

		if h.isWorkspaceSharedWithUserGroups(c, *model.WorkspaceID, email) {
			httputil.BadRequest(c, "Workspace already shared with this user's group; they already have access to this model")
			return false
		}
	}

	_, err := h.store.FindModelShareByModelAndEmail(model.ID, email)
	if err == nil {
		httputil.BadRequest(c, "Model already shared with this user")
		return false
	}

	return true
}
