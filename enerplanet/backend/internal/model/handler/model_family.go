package model

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

// FamilyOption is a family a model may link to, named by its head.
type FamilyOption struct {
	ID    uint   `json:"id"`
	Title string `json:"title"`
}

// ListFamilyOptions lists the families a model may link to: those of models
// copied from the same original, in its workspace. Families hold models of one
// location, so families of other originals are never offered.
func (h *ModelHandler) ListFamilyOptions(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	model, _, ok := h.getOwnedModelFromParam(c, userCtx.UserID)
	if !ok {
		return
	}
	options, err := familyOptions(h.store.DB(), model)
	if err != nil {
		logger.ForComponent("model").Errorf("%v", err)
		httputil.InternalError(c, reasonOptionsFailed)
		return
	}
	c.JSON(http.StatusOK, gin.H{"families": options})
}

// LinkModelFamily puts a model into one of the families ListFamilyOptions offers.
func (h *ModelHandler) LinkModelFamily(c *gin.Context) {
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
	status, reason, err := checkFamilyLink(h.store.DB(), model, req.FamilyID)
	if err != nil {
		logger.ForComponent("model").Errorf("%v", err)
	}
	if reason != "" {
		httputil.ErrorResponse(c, status, reason)
		return
	}
	h.setModelFamily(c, id, model, req.FamilyID)
}

// UnlinkModelFamily makes a model its own family. Copies made from it carry
// its id as their family and follow it.
func (h *ModelHandler) UnlinkModelFamily(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	model, id, ok := h.getOwnedModelFromParam(c, userCtx.UserID)
	if !ok {
		return
	}
	h.setModelFamily(c, id, model, model.ID)
}

func (h *ModelHandler) setModelFamily(c *gin.Context, id string, model *models.Model, familyID uint) {
	if err := h.store.Update(model, map[string]any{"group_id": familyID}); err != nil {
		logger.ForComponent("model").Errorf("set the family of model %d to %d: %v", model.ID, familyID, err)
		httputil.InternalError(c, "the change could not be saved")
		return
	}
	model.GroupID = &familyID
	h.respondWithPreloadedModel(c, id, model)
}

// Copies record the root original in parent_model_id, copies of copies too,
// so one original's line is the original and every model naming it as parent.
// A family is named by its original if present, else by its oldest member.
const familyOptionsSQL = `SELECT DISTINCT ON (family) family AS id, title FROM (
	SELECT COALESCE(group_id, parent_model_id, id) AS family, id, title, created_at FROM models
	WHERE deleted_at IS NULL AND workspace_id IS NOT DISTINCT FROM ? AND (id = ? OR parent_model_id = ?)
) line WHERE family <> ? ORDER BY family, id = family DESC, created_at`

// familyOptions lists the families of the model's original line other than its own.
func familyOptions(db *gorm.DB, model *models.Model) ([]FamilyOption, error) {
	root, current := model.ID, model.ID
	if model.ParentModelID != nil {
		root, current = *model.ParentModelID, *model.ParentModelID
	}
	if model.GroupID != nil {
		current = *model.GroupID
	}
	options := []FamilyOption{}
	if err := db.Raw(familyOptionsSQL, model.WorkspaceID, root, root, current).Scan(&options).Error; err != nil {
		return nil, fmt.Errorf("list the families model %d may link to: %w", model.ID, err)
	}
	return options, nil
}

// The frontend shows these after the model's name, so they never repeat it.
const reasonOptionsFailed = "the models it can be linked to could not be looked up"

// checkFamilyLink refuses a model that heads other models, since they would
// stay behind as a family without it, and a family outside its original's line.
// reason is what the user sees when refused; err carries a database failure for the log.
func checkFamilyLink(db *gorm.DB, model *models.Model, familyID uint) (status int, reason string, err error) {
	var heads int64
	if err := db.Model(&models.Model{}).
		Where(familyIDExpr+" = ? AND id <> ?", model.ID, model.ID).
		Count(&heads).Error; err != nil {
		return http.StatusInternalServerError, "its copies could not be checked", fmt.Errorf("count the copies of model %d: %w", model.ID, err)
	}
	if heads > 0 {
		copies := "copies"
		if heads == 1 {
			copies = "copy"
		}
		return http.StatusConflict, fmt.Sprintf("it already has %d %s, so it can't be linked to another model", heads, copies), nil
	}

	options, err := familyOptions(db, model)
	if err != nil {
		return http.StatusInternalServerError, reasonOptionsFailed, err
	}
	for _, option := range options {
		if option.ID == familyID {
			return http.StatusOK, "", nil
		}
	}
	return http.StatusNotFound, "it can only be linked to models copied from the same original", nil
}
