package model

import (
	"context"
	"fmt"

	modelservice "spatialhub_backend/internal/model/service"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func parseGetModelsParams(c *gin.Context) (limit, offset int, search, workspaceIDStr, sortBy, sortOrder string) {
	limit = 100
	offset = 0
	sortBy = "created_at"
	sortOrder = "desc"

	if l := c.Query("limit"); l != "" {
		var parsed int
		if _, err := fmt.Sscanf(l, "%d", &parsed); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if o := c.Query("offset"); o != "" {
		var parsed int
		if _, err := fmt.Sscanf(o, "%d", &parsed); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	search = c.Query("search")
	workspaceIDStr = c.Query("workspace_id")

	if sb := c.Query("sort_by"); sb != "" {
		switch sb {
		case "title", "status", "created_at", "updated_at":
			sortBy = sb
		}
	}
	if so := c.Query("sort_order"); so != "" {
		switch so {
		case "asc", "desc":
			sortOrder = so
		}
	}

	return
}

func (h *ModelHandler) buildWorkspaceFilteredQuery(c *gin.Context, userCtx *httputil.UserContext, workspaceID uint) (*gorm.DB, bool) {
	if !h.ensureWorkspaceAccess(c, userCtx.UserID, workspaceID, errAccessDeniedWorkspace) {
		return nil, false
	}

	// Check if this is the user's default workspace
	modelSvc := h.newModelService()
	defaultWs, err := modelSvc.GetDefaultWorkspace(userCtx.UserID)
	isDefault := err == nil && defaultWs.ID == workspaceID

	if isDefault {
		// For the default workspace, also include directly shared models
		// but only if the user doesn't have access to the model's original workspace
		return h.store.DB().Where(
			`workspace_id = ? OR (
				id IN (SELECT model_id FROM model_shares WHERE user_id = ? OR LOWER(email) = LOWER(?))
				AND workspace_id NOT IN (
					SELECT id FROM workspaces WHERE user_id = ?
					UNION
					SELECT workspace_id FROM workspace_members WHERE user_id = ?
				)
			)`,
			workspaceID, userCtx.UserID, userCtx.Email, userCtx.UserID, userCtx.UserID,
		), true
	}

	// For non-default workspaces, only show models belonging to this workspace
	return h.store.DB().Where("workspace_id = ?", workspaceID), true
}

func (h *ModelHandler) buildUserAccessQuery(c *gin.Context, userCtx *httputil.UserContext) *gorm.DB {
	// Expert users see all models
	if userCtx.AccessLevel == constants.AccessLevelExpert {
		return h.store.DB()
	}

	modelSvc := h.newModelService()
	groupIDs := modelSvc.GetUserGroupIDs(c.Request.Context(), userCtx.UserID)

	conditions := h.buildBaseAccessConditions(userCtx)
	conditions = h.addGroupAccessConditions(c, userCtx, groupIDs, conditions, modelSvc)

	return h.combineConditions(conditions)
}

func (h *ModelHandler) buildBaseAccessConditions(userCtx *httputil.UserContext) []interface{} {
	db := h.store.DB()
	conditions := []interface{}{
		db.Where("user_id = ?", userCtx.UserID),
	}

	conditions = append(conditions, db.Where(
		"workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)",
		userCtx.UserID,
	))

	conditions = append(conditions, db.Where(
		"id IN (SELECT model_id FROM model_shares WHERE user_id = ? OR LOWER(email) = LOWER(?))",
		userCtx.UserID, userCtx.Email,
	))

	return conditions
}

func (h *ModelHandler) addGroupAccessConditions(c *gin.Context, userCtx *httputil.UserContext, groupIDs []string, conditions []interface{}, modelSvc *modelservice.ModelService) []interface{} {
	if len(groupIDs) == 0 {
		return conditions
	}

	db := h.store.DB()
	conditions = append(conditions, db.Where("workspace_id IN (SELECT workspace_id FROM workspace_groups WHERE group_id IN ?)", groupIDs))

	if userCtx.AccessLevel == constants.AccessLevelManager {
		groupMemberIDs := modelSvc.GetGroupMemberUserIDs(c.Request.Context(), groupIDs)
		if len(groupMemberIDs) > 0 {
			conditions = append(conditions, db.Where("user_id IN ?", groupMemberIDs))
		}
	}

	return conditions
}

func (h *ModelHandler) combineConditions(conditions []interface{}) *gorm.DB {
	db := h.store.DB()
	query := db.Where(conditions[0])
	for i := 1; i < len(conditions); i++ {
		query = query.Or(conditions[i])
	}
	return query
}

// postProcessModelWorkspacesBatch is the optimized batch version that checks workspace access in bulk
func (h *ModelHandler) postProcessModelWorkspacesBatch(ctx context.Context, userCtx *httputil.UserContext, modelsList []models.Model) []models.Model {
	modelSvc := h.newModelService()

	defaultWorkspace, err := modelSvc.GetDefaultWorkspace(userCtx.UserID)
	if err != nil {
		return modelsList
	}

	// 1. Collect all unique workspace IDs from models not owned by user
	workspaceIDSet := make(map[uint]bool)
	modelIDsToCheck := make(map[uint]bool) // models that are shared and need workspace access check
	for _, model := range modelsList {
		if model.UserID == userCtx.UserID || model.WorkspaceID == nil {
			continue
		}
		workspaceIDSet[*model.WorkspaceID] = true
	}

	if len(workspaceIDSet) == 0 {
		return modelsList
	}

	workspaceIDs := make([]uint, 0, len(workspaceIDSet))
	for wsID := range workspaceIDSet {
		workspaceIDs = append(workspaceIDs, wsID)
	}

	// 2. Get all shared model IDs in batch
	sharedModelIDs := h.store.PluckSharedModelIDsByUser(userCtx.UserID)

	for _, modelID := range sharedModelIDs {
		modelIDsToCheck[modelID] = true
	}

	// 3. Single batch check for workspace access
	accessMap := modelSvc.BatchUserHasWorkspaceAccess(ctx, userCtx.UserID, workspaceIDs)

	// 4. Apply results
	for i := range modelsList {
		model := &modelsList[i]

		// Skip if user owns the model or model has no workspace
		if model.UserID == userCtx.UserID || model.WorkspaceID == nil {
			continue
		}

		// Check if this is a shared model and user doesn't have workspace access
		if modelIDsToCheck[model.ID] && !accessMap[*model.WorkspaceID] {
			model.WorkspaceID = &defaultWorkspace.ID
			model.Workspace = defaultWorkspace
		}
	}

	return modelsList
}

func (h *ModelHandler) buildQueryWithWorkspaceFilter(c *gin.Context, userCtx *httputil.UserContext, workspaceIDStr string, limit, offset int) (*gorm.DB, bool) {
	// Expert users see all models, skip workspace filtering when no workspace specified
	if userCtx.AccessLevel == constants.AccessLevelExpert && workspaceIDStr == "" {
		return h.store.DB(), true
	}

	if workspaceIDStr != "" {
		workspaceID, err := parseWorkspaceID(workspaceIDStr)
		if err != nil {
			h.respondWithEmptyList(c, limit, offset)
			return nil, false
		}

		// Expert users can access any workspace - only show models from this workspace
		if userCtx.AccessLevel == constants.AccessLevelExpert {
			return h.store.DB().Where("workspace_id = ?", workspaceID), true
		}

		query, ok := h.buildWorkspaceFilteredQuery(c, userCtx, workspaceID)
		if !ok {
			return nil, false
		}
		return query, true
	}
	return h.buildUserAccessQuery(c, userCtx), true
}

func parseWorkspaceID(workspaceIDStr string) (uint, error) {
	var workspaceID int
	if _, err := fmt.Sscanf(workspaceIDStr, "%d", &workspaceID); err != nil || workspaceID < 0 {
		return 0, fmt.Errorf("invalid workspace ID")
	}
	return uint(workspaceID), nil
}

func (h *ModelHandler) respondWithEmptyList(c *gin.Context, limit, offset int) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    []models.Model{},
		"total":   0,
		"limit":   limit,
		"offset":  offset,
	})
}

func (h *ModelHandler) applySearchFilter(query *gorm.DB, search string) *gorm.DB {
	query = query.Where("deleted_at IS NULL")
	if search != "" {
		query = query.Where("title ILIKE ?", "%"+search+"%")
	}
	return query
}

func (h *ModelHandler) fetchModelsWithQuery(query *gorm.DB, limit, offset int, sortBy, sortOrder string) ([]models.Model, int64, error) {
	var total int64
	query.Model(&models.Model{}).Count(&total)

	var modelsList []models.Model
	err := query.
		Preload(preloadWorkspaceMembers).
		Preload(preloadWorkspaceGroups).
		Preload("Shares").
		Order(sortBy + " " + sortOrder).
		Limit(limit).
		Offset(offset).
		Find(&modelsList).Error

	return modelsList, total, err
}

func (h *ModelHandler) includeParentModels(modelsList []models.Model) []models.Model {
	parentIDs := h.extractParentIDs(modelsList)
	if len(parentIDs) == 0 {
		return modelsList
	}

	existingIDs := h.buildExistingIDsMap(modelsList)
	missingParents := h.fetchMissingParents(parentIDs)

	return h.prependMissingParents(modelsList, missingParents, existingIDs)
}

func (h *ModelHandler) extractParentIDs(modelsList []models.Model) []uint {
	parentIDs := []uint{}
	for _, model := range modelsList {
		if model.ParentModelID != nil && *model.ParentModelID > 0 {
			parentIDs = append(parentIDs, *model.ParentModelID)
		}
	}
	return parentIDs
}

func (h *ModelHandler) buildExistingIDsMap(modelsList []models.Model) map[uint]bool {
	existingIDs := make(map[uint]bool)
	for _, model := range modelsList {
		existingIDs[model.ID] = true
	}
	return existingIDs
}

func (h *ModelHandler) fetchMissingParents(parentIDs []uint) []models.Model {
	var missingParents []models.Model
	return missingParents
}

func (h *ModelHandler) prependMissingParents(modelsList, missingParents []models.Model, existingIDs map[uint]bool) []models.Model {
	for _, parent := range missingParents {
		if !existingIDs[parent.ID] {
			modelsList = append([]models.Model{parent}, modelsList...)
		}
	}
	return modelsList
}

func (h *ModelHandler) filterModelShares(model *models.Model, userID, email string) {
	if model.UserID == userID {
		return
	}
	filteredShares := []models.ModelShare{}
	for _, share := range model.Shares {
		if share.UserID == userID || share.Email == email {
			filteredShares = append(filteredShares, share)
		}
	}
	model.Shares = filteredShares
}

func (h *ModelHandler) filterWorkspaceData(model *models.Model, userID, email string) {
	if model.Workspace == nil || model.Workspace.UserID == userID {
		return
	}
	filteredMembers := []models.WorkspaceMember{}
	for _, member := range model.Workspace.Members {
		if member.UserID == userID || member.Email == email {
			filteredMembers = append(filteredMembers, member)
		}
	}
	model.Workspace.Members = filteredMembers
	model.Workspace.Groups = []models.WorkspaceGroup{}
}

func (h *ModelHandler) applyPrivacyFilters(userCtx httputil.UserContext, modelsList []models.Model) []models.Model {
	for i := range modelsList {
		h.filterModelShares(&modelsList[i], userCtx.UserID, userCtx.Email)
		h.filterWorkspaceData(&modelsList[i], userCtx.UserID, userCtx.Email)
	}
	return modelsList
}
func (h *ModelHandler) handleSharedModelWorkspace(userID string, model *models.Model) {
	if model.UserID == userID || model.WorkspaceID == nil {
		return
	}

	modelSvc := h.newModelService()
	if h.store.CountModelSharesByModelAndUser(model.ID, userID) > 0 && !modelSvc.UserHasWorkspaceAccess(userID, *model.WorkspaceID) {
		if defaultWorkspace, err := modelSvc.GetDefaultWorkspace(userID); err == nil {
			model.WorkspaceID = &defaultWorkspace.ID
			model.Workspace = defaultWorkspace
		}
	}
}
