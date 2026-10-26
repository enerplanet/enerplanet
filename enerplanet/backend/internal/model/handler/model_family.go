package model

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
)

// SetModelFamily puts a model into another family of its workspace, so a copy
// moved away from its family, or left alone by a deleted original, can rejoin.
func (h *ModelHandler) SetModelFamily(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	model, id, ok := h.getOwnedModelFromParam(c, userCtx.UserID)
	if !ok {
		return
	}
	var req struct {
		FamilyID uint `json:"family_id" binding:"required"`
	}
	if !bindJSONOrBadRequest(c, &req) {
		return
	}
	status, err := checkFamilyTarget(h.store.DB(), model, req.FamilyID)
	if err != nil {
		httputil.ErrorResponse(c, status, err.Error())
		return
	}
	if err := h.store.Update(model, map[string]any{"group_id": req.FamilyID}); err != nil {
		httputil.InternalError(c, "Failed to set the model's family")
		return
	}
	model.GroupID = &req.FamilyID
	h.respondWithPreloadedModel(c, id, model)
}

// checkFamilyTarget refuses a model that heads other models, since they would
// stay behind as a family without it, and a family with no other model in the
// model's workspace.
func checkFamilyTarget(db *gorm.DB, model *models.Model, familyID uint) (int, error) {
	var heads int64
	if err := db.Model(&models.Model{}).
		Where(familyIDExpr+" = ? AND id <> ?", model.ID, model.ID).
		Count(&heads).Error; err != nil {
		return http.StatusInternalServerError, fmt.Errorf("count the family of model %d: %w", model.ID, err)
	}
	if heads > 0 {
		return http.StatusConflict, fmt.Errorf("model %d heads a family of %d other models and cannot join family %d", model.ID, heads, familyID)
	}

	var members int64
	err := db.Model(&models.Model{}).
		Where(familyIDExpr+" = ? AND id <> ? AND workspace_id IS NOT DISTINCT FROM ?", familyID, model.ID, model.WorkspaceID).
		Count(&members).Error
	if err != nil {
		return http.StatusInternalServerError, fmt.Errorf("count the members of family %d: %w", familyID, err)
	}
	if members == 0 {
		return http.StatusNotFound, fmt.Errorf("family %d has no other model in the workspace of model %d", familyID, model.ID)
	}
	return http.StatusOK, nil
}
