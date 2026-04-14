package workspace

import (
	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
	authplatform "platform.local/platform/auth"
	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/cache"
	workspaceservice "spatialhub_backend/internal/workspace/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	errInvalidRequestData   = "Invalid request data"
	errWorkspaceNotFound    = "Workspace not found"
	errFailedFetchWorkspace = "Failed to fetch workspace"
)

type WorkspaceHandler struct {
	service *workspaceservice.WorkspaceService
}

func NewWorkspaceHandler(db *gorm.DB, adminTokenProvider *authplatform.AdminTokenProvider, keycloakBaseURL, realm string, kcCache *cache.KeycloakCacheService) *WorkspaceHandler {
	return &WorkspaceHandler{
		service: workspaceservice.NewWorkspaceService(db, adminTokenProvider, keycloakBaseURL, realm, kcCache),
	}
}

func (h *WorkspaceHandler) getWorkspaceForManager(c *gin.Context) (*models.Workspace, bool) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return nil, false
	}
	id := c.Param("id")
	ws, err := h.fetchWorkspaceWithManagerCheck(c, userCtx.UserID, userCtx.AccessLevel, userCtx.GroupID, id)
	if err != nil {
		return nil, false
	}
	return ws, true
}

func (h *WorkspaceHandler) fetchWorkspace(c *gin.Context, id string) (*models.Workspace, bool) {
	ws, err := h.service.GetWorkspace(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errWorkspaceNotFound)
		} else {
			httputil.InternalError(c, errFailedFetchWorkspace)
		}
		return nil, false
	}
	return ws, true
}

func (h *WorkspaceHandler) GetUserWorkspaces(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	h.service.SyncMemberUserID(userCtx.UserID, userCtx.Email)

	groupIDs := h.service.FetchUserGroupIDs(userCtx.UserID)
	workspaces, err := h.service.LoadAccessibleWorkspaces(userCtx.UserID, userCtx.Email, userCtx.GroupID, userCtx.AccessLevel, groupIDs)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch workspaces")
		return
	}

	h.service.FilterWorkspacesForPrivacy(workspaces, userCtx.UserID, userCtx.Email)
	httputil.SuccessResponse(c, workspaces)
}

func (h *WorkspaceHandler) GetWorkspace(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	h.service.SyncMemberUserID(userCtx.UserID, userCtx.Email)

	id := c.Param("id")
	workspace, err := h.service.GetWorkspace(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errWorkspaceNotFound)
		} else {
			httputil.InternalError(c, errFailedFetchWorkspace)
		}
		return
	}

	if !h.service.UserHasAccessWithGroup(userCtx.UserID, userCtx.GroupID, workspace.ID) {
		httputil.Forbidden(c, "Access denied")
		return
	}

	// Privacy filter: Only workspace owner sees all members and groups
	if workspace.UserID != userCtx.UserID {
		workspace.Members = h.service.FilterMembersForUser(workspace.Members, userCtx.UserID, userCtx.Email)
		workspace.Groups = []models.WorkspaceGroup{}
	}

	httputil.SuccessResponse(c, *workspace)
}

func (h *WorkspaceHandler) CreateWorkspace(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req contracts.CreateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	workspace, err := h.service.CreateWorkspace(req.Name, req.Description, userCtx.UserID, userCtx.Email)
	if err != nil {
		httputil.InternalError(c, "Failed to create workspace")
		return
	}

	httputil.Created(c, workspace)
}

func (h *WorkspaceHandler) UpdateWorkspace(c *gin.Context) {
	workspace, ok := h.getWorkspaceForManager(c)
	if !ok {
		return
	}

	var req contracts.UpdateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if err := h.service.UpdateWorkspace(workspace, req.Name, req.Description); err != nil {
		httputil.InternalError(c, "Failed to update workspace")
		return
	}

	httputil.SuccessMessage(c, "Workspace updated")
}

func (h *WorkspaceHandler) CopyWorkspace(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id := c.Param("id")
	sourceWorkspace, ok := h.fetchWorkspace(c, id)
	if !ok {
		return
	}

	if !h.service.UserHasAccessWithGroup(userCtx.UserID, userCtx.GroupID, sourceWorkspace.ID) {
		httputil.Forbidden(c, "Access denied to workspace")
		return
	}

	var req contracts.CopyWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	createdWorkspace, err := h.service.CopyWorkspace(sourceWorkspace, userCtx.UserID, userCtx.Email, req.Name, req.Description)
	if err != nil {
		httputil.InternalError(c, "Failed to create workspace copy")
		return
	}

	httputil.Created(c, *createdWorkspace)
}

func (h *WorkspaceHandler) DeleteWorkspace(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id := c.Param("id")
	workspace, ok := h.fetchWorkspace(c, id)
	if !ok {
		return
	}

	// Only owner or expert with access can delete workspace
	isOwner := workspace.UserID == userCtx.UserID
	isExpertWithAccess := userCtx.AccessLevel == "expert" && h.service.UserHasAccessWithGroup(userCtx.UserID, userCtx.GroupID, workspace.ID)

	if !isOwner && !isExpertWithAccess {
		httputil.Forbidden(c, "Only owner or expert with access can delete workspace")
		return
	}

	if workspace.IsDefault {
		httputil.BadRequest(c, "Cannot delete default workspace")
		return
	}

	if err := h.service.DeleteWorkspace(workspace); err != nil {
		httputil.InternalError(c, "Failed to delete workspace")
		return
	}

	httputil.SuccessMessage(c, "Workspace deleted")
}

func (h *WorkspaceHandler) AddMember(c *gin.Context) {
	workspace, ok := h.getWorkspaceForManager(c)
	if !ok {
		return
	}

	var req contracts.AddMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if _, err := h.service.FindMember(workspace.ID, req.Email); err == nil {
		httputil.BadRequest(c, "Member already exists in workspace")
		return
	}

	member, err := h.service.AddMember(workspace.ID, req.Email, h.findUserIDByEmail(req.Email))
	if err != nil {
		httputil.InternalError(c, "Failed to add member")
		return
	}

	httputil.Created(c, member)
}

func (h *WorkspaceHandler) RemoveMember(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id := c.Param("id")
	memberID := c.Param("memberID")

	workspace, ok := h.fetchWorkspace(c, id)
	if !ok {
		return
	}

	if !h.service.UserCanManageWorkspace(userCtx.UserID, userCtx.AccessLevel, userCtx.GroupID, workspace.ID) {
		httputil.Forbidden(c, "Only workspace managers can remove members")
		return
	}

	member, err := h.service.FetchMemberByID(workspace.ID, memberID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, "Member not found")
		} else {
			httputil.InternalError(c, "Failed to fetch member")
		}
		return
	}

	if member.UserID == workspace.UserID {
		httputil.BadRequest(c, "Cannot remove workspace owner")
		return
	}

	if err := h.service.RemoveMember(member); err != nil {
		httputil.InternalError(c, "Failed to remove member")
		return
	}

	httputil.SuccessMessage(c, "Member removed")
}

func (h *WorkspaceHandler) CreateOrGetDefaultWorkspace(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	workspace, err := h.service.CreateOrGetDefault(userCtx.UserID, userCtx.Email)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch default workspace")
		return
	}

	httputil.SuccessResponse(c, workspace)
}

func (h *WorkspaceHandler) fetchWorkspaceWithManagerCheck(c *gin.Context, userID, accessLevel, groupID, workspaceID string) (*models.Workspace, error) {
	workspace, err := h.service.GetWorkspace(workspaceID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errWorkspaceNotFound)
		} else {
			httputil.InternalError(c, errFailedFetchWorkspace)
		}
		return nil, err
	}

	if !h.service.UserCanManageWorkspace(userID, accessLevel, groupID, workspace.ID) {
		httputil.Forbidden(c, "Only workspace managers can perform this action")
		return nil, gorm.ErrInvalidData
	}

	return workspace, nil
}

func (h *WorkspaceHandler) findUserIDByEmail(email string) string {
	return h.service.FindUserIDByEmail(email)
}

func (h *WorkspaceHandler) GetPreferredWorkspace(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	settings, err := h.service.GetPreferredWorkspace(userCtx.UserID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.SuccessResponse(c, gin.H{"preferred_workspace_id": nil})
			return
		}
		httputil.InternalError(c, "Failed to fetch user settings")
		return
	}

	httputil.SuccessResponse(c, gin.H{"preferred_workspace_id": settings.PreferredWorkspaceID})
}

func (h *WorkspaceHandler) SetPreferredWorkspace(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req contracts.PreferredWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	// Verify user has access to workspace if provided
	if req.WorkspaceID != nil {
		if !h.service.UserHasAccessWithGroup(userCtx.UserID, userCtx.GroupID, *req.WorkspaceID) {
			httputil.Forbidden(c, "Access denied to workspace")
			return
		}
	}

	settings, err := h.service.SetPreferredWorkspace(userCtx.UserID, userCtx.Email, req.WorkspaceID)
	if err != nil {
		httputil.InternalError(c, "Failed to update preferred workspace")
		return
	}

	httputil.SuccessResponse(c, gin.H{"preferred_workspace_id": settings.PreferredWorkspaceID})
}

func (h *WorkspaceHandler) AddGroup(c *gin.Context) {
	workspace, ok := h.getWorkspaceForManager(c)
	if !ok {
		return
	}

	var req contracts.AddGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if _, err := h.service.FindGroup(workspace.ID, req.GroupID); err == nil {
		httputil.BadRequest(c, "Group already has access to this workspace")
		return
	}

	group, err := h.service.AddGroup(workspace.ID, req.GroupID, req.GroupName)
	if err != nil {
		httputil.InternalError(c, "Failed to add group to workspace")
		return
	}

	httputil.Created(c, group)
}

func (h *WorkspaceHandler) RemoveGroup(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id := c.Param("id")
	groupID := c.Param("groupID")

	workspace, ok := h.fetchWorkspace(c, id)
	if !ok {
		return
	}

	if !h.service.UserCanManageWorkspace(userCtx.UserID, userCtx.AccessLevel, userCtx.GroupID, workspace.ID) {
		httputil.Forbidden(c, "Only workspace managers can remove groups")
		return
	}

	workspaceGroup, err := h.service.FindGroup(workspace.ID, groupID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, "Group not found in workspace")
		} else {
			httputil.InternalError(c, "Failed to fetch workspace group")
		}
		return
	}

	if err := h.service.RemoveGroup(workspaceGroup); err != nil {
		httputil.InternalError(c, "Failed to remove group from workspace")
		return
	}

	httputil.SuccessMessage(c, "Group removed from workspace")
}
