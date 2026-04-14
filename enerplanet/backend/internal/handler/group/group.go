package group

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"platform.local/common/pkg/authclient"
	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	authplatform "platform.local/platform/auth"
	ikc "platform.local/platform/keycloak"
	applogger "platform.local/platform/logger"
	platformsession "platform.local/platform/session"

	"github.com/gin-gonic/gin"
)

const (
	errInvalidRequestData      = "Invalid request data"
	errFailedFetchGroupMembers = "Failed to fetch group members"
)

type GroupHandler struct {
	adminTokenProvider *authplatform.AdminTokenProvider
	authClient         *authclient.Client
	keycloakBaseURL    string
	realm              string
	kc                 *ikc.Client
}

func NewGroupHandler(adminTokenProvider *authplatform.AdminTokenProvider, keycloakBaseURL, realm string, _ platformsession.SessionStore) *GroupHandler {
	h := &GroupHandler{
		adminTokenProvider: adminTokenProvider,
		authClient:         authclient.NewClient(),
		keycloakBaseURL:    keycloakBaseURL,
		realm:              realm,
	}
	h.kc = ikc.NewClient(keycloakBaseURL, realm, adminTokenProvider)
	return h
}

// deleteUserSessions calls auth-service to delete all sessions for a user
func (h *GroupHandler) deleteUserSessions(ctx context.Context, userID string) error {
	return h.authClient.DeleteUserSessions(ctx, userID)
}

func (h *GroupHandler) enrichGroupsWithAttributes(ctx context.Context, groups []KeycloakGroup) []KeycloakGroup {
	enrichedGroups := make([]KeycloakGroup, 0, len(groups))
	for _, g := range groups {
		if detail, err := h.kc.GetGroup(ctx, g.ID); err == nil {
			enrichedGroups = append(enrichedGroups, KeycloakGroup{
				ID:         detail.ID,
				Name:       detail.Name,
				Path:       detail.Path,
				Attributes: detail.Attributes,
			})
		} else {
			enrichedGroups = append(enrichedGroups, g)
		}
	}
	return enrichedGroups
}

func (h *GroupHandler) validateManagerGroupAccess(c *gin.Context, userCtx *httputil.UserContext, groupID string) bool {
	// Experts have full access to all groups
	if userCtx.AccessLevel == constants.AccessLevelExpert {
		return true
	}
	// Managers only have access to their own groups
	if userCtx.AccessLevel == constants.AccessLevelManager {
		mgrSet, err := h.kc.GetManagerGroupSet(c.Request.Context(), userCtx.UserID)
		if err != nil || !mgrSet[groupID] {
			applogger.ForComponent("group").Warnf("Manager access denied: user_id=%s group_id=%s err=%v", userCtx.UserID, groupID, err)
			httputil.Forbidden(c, "You can only manage your own groups")
			return false
		}
	}
	return true
}

func (h *GroupHandler) EnsureDefaultGroup(ctx context.Context) error {
	_, err := h.kc.EnsureGroupByName(ctx, "Default")
	return err
}

type KeycloakGroup = ikc.Group

func requireExpertOrManager(c *gin.Context) (*httputil.UserContext, bool) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return nil, false
	}

	if userCtx.AccessLevel != constants.AccessLevelExpert && userCtx.AccessLevel != constants.AccessLevelManager {
		httputil.Forbidden(c, "Only experts and managers can view groups")
		return nil, false
	}

	return userCtx, true
}

func (h *GroupHandler) GetMyGroup(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	groups, err := h.kc.GetUserGroups(c.Request.Context(), userCtx.UserID)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch user groups")
		return
	}

	if len(groups) > 0 {
		httputil.SuccessResponse(c, groups[0])
	} else {
		httputil.SuccessResponse(c, gin.H{"name": "Default"})
	}
}

func (h *GroupHandler) GetGroups(c *gin.Context) {
	userCtx, ok := requireExpertOrManager(c)
	if !ok {
		return
	}

	groups, err := h.fetchGroupsByAccessLevel(c.Request.Context(), userCtx)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch groups")
		return
	}

	httputil.SuccessResponse(c, groups)
}

// fetchGroupsByAccessLevel fetches groups based on user access level
func (h *GroupHandler) fetchGroupsByAccessLevel(ctx context.Context, userCtx *httputil.UserContext) ([]KeycloakGroup, error) {
	if userCtx.AccessLevel == constants.AccessLevelManager {
		return h.fetchManagerGroups(ctx, userCtx.UserID)
	}
	return h.fetchExpertGroups(ctx)
}

// fetchManagerGroups fetches and filters groups for managers
func (h *GroupHandler) fetchManagerGroups(ctx context.Context, userID string) ([]KeycloakGroup, error) {
	groups, err := h.kc.GetUserGroups(ctx, userID)
	if err != nil {
		return nil, err
	}

	groups = h.filterOutSharedDefault(ctx, groups)
	return h.enrichGroupsWithAttributes(ctx, groups), nil
}

// fetchExpertGroups fetches all groups for experts
func (h *GroupHandler) fetchExpertGroups(ctx context.Context) ([]KeycloakGroup, error) {
	groups, err := h.kc.GetAllGroups(ctx)
	if err != nil {
		return nil, err
	}
	return h.enrichGroupsWithAttributes(ctx, groups), nil
}

// filterOutSharedDefault removes the shared "Default" group from the list
func (h *GroupHandler) filterOutSharedDefault(ctx context.Context, groups []KeycloakGroup) []KeycloakGroup {
	sharedDefaultID, err := h.kc.EnsureGroupByName(ctx, "Default")
	if err != nil || sharedDefaultID == "" {
		return groups
	}

	filtered := make([]KeycloakGroup, 0, len(groups))
	for _, g := range groups {
		if g.ID != sharedDefaultID {
			filtered = append(filtered, g)
		}
	}
	return filtered
}

func (h *GroupHandler) GetGroup(c *gin.Context) {
	userCtx, ok := requireExpertOrManager(c)
	if !ok {
		return
	}

	id := c.Param("id")
	if id == "" {
		httputil.BadRequest(c, "group id required")
		return
	}
	if userCtx.AccessLevel == constants.AccessLevelManager {
		mgrSet, err := h.kc.GetManagerGroupSet(c.Request.Context(), userCtx.UserID)
		if err != nil || !mgrSet[id] {
			httputil.Forbidden(c, "You can only view your own groups")
			return
		}
	}
	g, err := h.kc.GetGroup(c.Request.Context(), id)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch group")
		return
	}
	disabled := false
	if vals, ok := g.Attributes["disabled"]; ok && len(vals) > 0 && (vals[0] == "true" || vals[0] == "1") {
		disabled = true
	}
	httputil.SuccessResponse(c, gin.H{
		"id":         g.ID,
		"name":       g.Name,
		"path":       g.Path,
		"attributes": g.Attributes,
		"disabled":   disabled,
	})
}

func (h *GroupHandler) CreateGroup(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if userCtx.AccessLevel != constants.AccessLevelExpert && userCtx.AccessLevel != constants.AccessLevelManager {
		httputil.Forbidden(c, "Only experts and managers can create groups")
		return
	}

	var req struct {
		Name string `json:"name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	groupID, err := h.kc.CreateGroup(c.Request.Context(), req.Name)
	if err != nil {
		httputil.InternalError(c, "Failed to create group")
		return
	}
	if userCtx.AccessLevel == constants.AccessLevelManager && groupID != "" {
		_ = h.kc.AddUserToGroup(c.Request.Context(), userCtx.UserID, groupID)
	}

	httputil.SuccessResponse(c, gin.H{"message": "Group created successfully"})
}

func (h *GroupHandler) UpdateGroup(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if !h.requireExpertOrManagerAccess(c, userCtx, "update groups") {
		return
	}

	id := c.Param("id")
	if userCtx.AccessLevel == constants.AccessLevelManager && !h.validateManagerGroupAccess(c, userCtx, id) {
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if err := h.updateGroupName(c.Request.Context(), id, req.Name); err != nil {
		httputil.InternalError(c, err.Error())
		return
	}

	httputil.SuccessResponse(c, gin.H{"message": "Group updated successfully"})
}

// updateGroupName updates group name or display name based on group type
func (h *GroupHandler) updateGroupName(ctx context.Context, id, newName string) error {
	group, err := h.kc.GetGroup(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get group details")
	}

	if h.isManagerDefaultGroup(group) {
		return h.updateGroupDisplayName(ctx, id, group.Attributes, newName)
	}
	return h.kc.UpdateGroupName(ctx, id, newName)
}

// isManagerDefaultGroup checks if group is a manager's default group
func (h *GroupHandler) isManagerDefaultGroup(group *ikc.GroupDetail) bool {
	if h.kc.IsDefaultGroup(group.Name) {
		return true
	}
	if group.Attributes != nil {
		return group.Attributes["owner_email"] != nil || group.Attributes["owner_name"] != nil
	}
	return false
}

// updateGroupDisplayName updates the display name attribute of a group
func (h *GroupHandler) updateGroupDisplayName(ctx context.Context, id string, attrs map[string][]string, newName string) error {
	if attrs == nil {
		attrs = make(map[string][]string)
	}
	attrs["display_name"] = []string{newName}

	if err := h.kc.UpdateGroupAttributes(ctx, id, attrs); err != nil {
		return fmt.Errorf("failed to update group display name")
	}
	return nil
}

func (h *GroupHandler) DeleteGroup(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if !h.requireExpertOrManagerAccess(c, userCtx, "delete groups") {
		return
	}

	id := c.Param("id")
	ctx := c.Request.Context()

	if !h.validateGroupDeletionAccess(c, ctx, userCtx, id) {
		return
	}

	members, err := h.kc.GetGroupMembers(ctx, id)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch group members before delete")
		return
	}

	stats := h.processMembersBeforeDelete(ctx, members, id, userCtx)

	if err := h.kc.DeleteGroup(ctx, id); err != nil {
		httputil.InternalError(c, "Failed to delete group")
		return
	}

	httputil.SuccessResponse(c, gin.H{
		"message":       "Group deleted successfully",
		"deleted_users": stats.deleted,
		"removed_users": stats.removed,
		"skipped_users": stats.skipped,
		"failed_users":  stats.failed,
	})
}

type memberDeletionStats struct {
	deleted int
	removed int
	skipped int
	failed  int
}

// validateGroupDeletionAccess validates if user can delete the group
func (h *GroupHandler) validateGroupDeletionAccess(c *gin.Context, ctx context.Context, userCtx *httputil.UserContext, groupID string) bool {
	groupToDelete, err := h.kc.GetGroup(ctx, groupID)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch group details")
		return false
	}

	if userCtx.AccessLevel == constants.AccessLevelManager {
		mgrSet, err := h.kc.GetManagerGroupSet(ctx, userCtx.UserID)
		if err != nil || !mgrSet[groupID] {
			httputil.Forbidden(c, "You can only delete your own groups")
			return false
		}
	}

	if h.kc.IsDefaultGroup(groupToDelete.Name) {
		httputil.Forbidden(c, "Default group cannot be deleted")
		return false
	}

	return true
}

// processMembersBeforeDelete handles member removal/deletion before group deletion
func (h *GroupHandler) processMembersBeforeDelete(ctx context.Context, members []map[string]interface{}, groupID string, userCtx *httputil.UserContext) memberDeletionStats {
	defaultGroupID, _ := h.kc.EnsureGroupByName(ctx, "Default")
	stats := memberDeletionStats{}

	for _, m := range members {
		uid := h.extractUserIDFromMember(m)
		if uid == "" {
			continue
		}

		h.handleMemberDuringGroupDelete(ctx, uid, groupID, userCtx, defaultGroupID, &stats)
	}

	return stats
}

// handleMemberDuringGroupDelete processes a single member during group deletion
func (h *GroupHandler) handleMemberDuringGroupDelete(ctx context.Context, uid, groupID string, userCtx *httputil.UserContext, defaultGroupID string, stats *memberDeletionStats) {
	// Skip current user and reassign to default if manager
	if uid == userCtx.UserID {
		stats.skipped++
		_ = h.kc.RemoveUserFromGroup(ctx, uid, groupID)
		if userCtx.AccessLevel == constants.AccessLevelManager && defaultGroupID != "" {
			_ = h.kc.AddUserToGroup(ctx, uid, defaultGroupID)
		}
		return
	}

	userGroups, err := h.kc.GetUserGroups(ctx, uid)
	if err != nil {
		stats.failed++
		return
	}

	if len(userGroups) <= 1 {
		// Delete user if this is their only group
		if err := h.kc.DeleteUser(ctx, uid); err != nil {
			stats.failed++
		} else {
			stats.deleted++
		}
	} else {
		// Just remove from group if user has other groups
		if err := h.kc.RemoveUserFromGroup(ctx, uid, groupID); err != nil {
			stats.failed++
		} else {
			stats.removed++
		}
	}
}

func (h *GroupHandler) DisableGroup(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if !h.requireExpertOrManagerAccess(c, userCtx, "disable groups") {
		return
	}

	id := c.Param("id")
	if !h.validateManagerGroupAccess(c, userCtx, id) {
		return
	}

	if !h.validateDefaultGroupProtection(c, id, userCtx) {
		return
	}

	ctx := c.Request.Context()
	if err := h.kc.SetGroupDisabled(ctx, id, true); err != nil {
		httputil.InternalError(c, "Failed to set group disabled attribute")
		return
	}

	members, err := h.kc.GetGroupMembers(ctx, id)
	if err != nil {
		httputil.InternalError(c, errFailedFetchGroupMembers)
		return
	}

	stats, memberIDs := h.disableGroupMembers(ctx, members, userCtx)
	h.logoutGroupMembers(ctx, memberIDs)

	httputil.SuccessResponse(c, gin.H{
		"message":        "Group disabled",
		"users_disabled": stats.disabled,
		"users_skipped":  stats.skipped,
		"users_failed":   stats.failed,
	})
}

type disableStats struct {
	disabled int
	skipped  int
	failed   int
}

// validateDefaultGroupProtection checks if the group can be disabled
func (h *GroupHandler) validateDefaultGroupProtection(c *gin.Context, groupID string, userCtx *httputil.UserContext) bool {
	g, err := h.kc.GetGroup(c.Request.Context(), groupID)
	if err != nil {
		return true // Allow if we can't fetch group
	}

	// Protect the shared "Default" group from being disabled by anyone
	if strings.EqualFold(g.Name, "Default") {
		httputil.Forbidden(c, "The shared Default group cannot be disabled")
		return false
	}

	// Managers cannot disable Default groups (including their own)
	if userCtx.AccessLevel == constants.AccessLevelManager && h.kc.IsDefaultGroup(g.Name) {
		httputil.Forbidden(c, "Managers cannot disable Default groups")
		return false
	}

	return true
}

// disableGroupMembers disables members and returns stats and member IDs
func (h *GroupHandler) disableGroupMembers(ctx context.Context, members []map[string]interface{}, userCtx *httputil.UserContext) (disableStats, []string) {
	stats := disableStats{}
	memberIDs := make([]string, 0, len(members))

	for _, m := range members {
		uid := h.extractUserIDFromMember(m)
		if uid == "" {
			continue
		}

		memberIDs = append(memberIDs, uid)
		h.disableSingleMember(ctx, uid, userCtx, &stats)
	}

	return stats, memberIDs
}

// disableSingleMember decides whether to disable a member and performs the action
func (h *GroupHandler) disableSingleMember(ctx context.Context, uid string, userCtx *httputil.UserContext, stats *disableStats) {
	shouldDisable := h.shouldDisableMember(ctx, uid, userCtx, stats)
	if !shouldDisable {
		stats.skipped++
		return
	}

	if err := h.kc.SetUserEnabled(ctx, uid, false); err != nil {
		stats.failed++
	} else {
		stats.disabled++
	}
}

// shouldDisableMember determines if a member should be disabled based on access level
func (h *GroupHandler) shouldDisableMember(ctx context.Context, uid string, userCtx *httputil.UserContext, stats *disableStats) bool {
	// Experts disable all members
	if userCtx.AccessLevel == constants.AccessLevelExpert {
		return true
	}

	// Managers only disable users with ≤1 groups
	userGroups, err := h.kc.GetUserGroups(ctx, uid)
	if err != nil {
		stats.failed++
		return false
	}

	return len(userGroups) <= 1
}

// logoutGroupMembers logs out all members and invalidates their sessions
func (h *GroupHandler) logoutGroupMembers(ctx context.Context, memberIDs []string) {
	for _, uid := range memberIDs {
		if err := h.kc.LogoutUser(ctx, uid); err != nil {
			applogger.ForComponent("group").Warnf("Failed to logout user %s: %v", uid, err)
		}
		if err := h.deleteUserSessions(ctx, uid); err != nil {
			applogger.ForComponent("group").Warnf("Failed to delete sessions for user %s: %v", uid, err)
		}
	}
}

func (h *GroupHandler) EnableGroup(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	if !h.requireExpertOrManagerAccess(c, userCtx, "enable groups") {
		return
	}

	id := c.Param("id")
	if !h.validateManagerGroupAccess(c, userCtx, id) {
		return
	}

	if err := h.kc.SetGroupDisabled(c.Request.Context(), id, false); err != nil {
		httputil.InternalError(c, "Failed to clear group disabled attribute")
		return
	}

	enabled, failed := h.enableGroupMembers(c.Request.Context(), id)
	httputil.SuccessResponse(c, gin.H{"message": "Group enabled and users enabled", "users_enabled": enabled, "users_failed": failed})
}

// enableGroupMembers enables all members of a group
func (h *GroupHandler) enableGroupMembers(ctx context.Context, groupID string) (enabled, failed int) {
	members, err := h.kc.GetGroupMembers(ctx, groupID)
	if err != nil {
		return 0, 0
	}

	for _, m := range members {
		if uid := h.extractUserIDFromMember(m); uid != "" {
			if err := h.kc.SetUserEnabled(ctx, uid, true); err != nil {
				failed++
			} else {
				enabled++
			}
		}
	}
	return enabled, failed
}

func (h *GroupHandler) GetGroupMembers(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if userCtx.AccessLevel != constants.AccessLevelExpert {
		httputil.Forbidden(c, "Only experts can view group members")
		return
	}

	id := c.Param("id")

	members, err := h.kc.GetGroupMembers(c.Request.Context(), id)
	if err != nil {
		httputil.InternalError(c, errFailedFetchGroupMembers)
		return
	}

	httputil.SuccessResponse(c, members)
}

func (h *GroupHandler) AddMember(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if !h.requireExpertOrManagerAccess(c, userCtx, "add group members") {
		return
	}

	groupID, req, ok := h.parseAddMemberRequest(c)
	if !ok {
		return
	}

	ctx := c.Request.Context()
	userGroups, err := h.kc.GetUserGroups(ctx, req.UserID)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch user's groups")
		return
	}

	targetUserIsManager := h.checkTargetUserIsManager(ctx, req.UserID)

	if userCtx.AccessLevel == constants.AccessLevelManager {
		if !h.validateManagerCanAddMember(c, ctx, userCtx, groupID, userGroups) {
			return
		}
	}

	removed, _ := h.removeUserFromOtherGroups(ctx, req.UserID, groupID, userGroups, targetUserIsManager)

	if err := h.kc.AddUserToGroup(ctx, req.UserID, groupID); err != nil {
		applogger.ForComponent("group").Errorf("Failed to add user %s to group %s: %v", req.UserID, groupID, err)
		httputil.InternalError(c, "Failed to add member")
		return
	}

	h.handleUserSessionAfterGroupChange(c, ctx, userCtx.UserID, req.UserID, groupID)

	httputil.SuccessResponse(c, gin.H{
		"message":         "User moved successfully.",
		"removed_from":    removed,
		"logged_out":      req.UserID != userCtx.UserID,
		"user_id":         req.UserID,
		"requires_reload": req.UserID != userCtx.UserID,
	})
}

func (h *GroupHandler) parseAddMemberRequest(c *gin.Context) (string, struct {
	UserID string `json:"user_id" binding:"required"`
}, bool) {
	groupID := c.Param("id")
	var req struct {
		UserID string `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return "", req, false
	}
	return groupID, req, true
}

func (h *GroupHandler) handleUserSessionAfterGroupChange(c *gin.Context, ctx context.Context, currentUserID, targetUserID, groupID string) {
	shouldLogout := targetUserID != currentUserID
	if shouldLogout {
		h.logoutUserAfterGroupChange(ctx, targetUserID)
	} else {
		sessionID := httputil.GetSessionCookieOrEmpty(c)
		if sessionID != "" {
			if err := h.authClient.UpdateSessionGroup(ctx, sessionID, groupID); err != nil {
				applogger.ForComponent("group").Warnf("Failed to update session group: %v", err)
			}
		}
	}
}

// checkTargetUserIsManager checks if the target user has manager access level
func (h *GroupHandler) checkTargetUserIsManager(ctx context.Context, userID string) bool {
	adminToken, err := h.adminTokenProvider.GetToken()
	if err != nil {
		return false
	}

	userURL := fmt.Sprintf("%s/admin/realms/%s/users/%s", h.keycloakBaseURL, h.realm, userID)
	req, err := http.NewRequestWithContext(ctx, "GET", userURL, nil)
	if err != nil {
		return false
	}

	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: constants.HTTPTimeoutAuth}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	var userData struct {
		Attributes map[string][]string `json:"attributes"`
	}
	if json.NewDecoder(resp.Body).Decode(&userData) != nil {
		return false
	}

	if accessLevel, ok := userData.Attributes["access_level"]; ok && len(accessLevel) > 0 {
		return strings.EqualFold(accessLevel[0], constants.AccessLevelManager)
	}

	return false
}

// validateManagerCanAddMember validates if a manager can add a member to a group
func (h *GroupHandler) validateManagerCanAddMember(c *gin.Context, ctx context.Context, userCtx *httputil.UserContext, groupID string, userGroups []ikc.Group) bool {
	mgrGroupSet, err := h.kc.GetManagerGroupSet(ctx, userCtx.UserID)
	if err != nil {
		httputil.Forbidden(c, "Failed to validate manager groups")
		return false
	}

	if !mgrGroupSet[groupID] {
		httputil.Forbidden(c, "You can only assign users to your own groups")
		return false
	}

	manageable := false
	for _, ug := range userGroups {
		if mgrGroupSet[ug.ID] {
			manageable = true
			break
		}
	}

	if !manageable {
		httputil.Forbidden(c, "You can only manage users in your groups")
		return false
	}

	return true
}

// removeUserFromOtherGroups removes user from all groups except the target group
func (h *GroupHandler) removeUserFromOtherGroups(ctx context.Context, userID, targetGroupID string, userGroups []ikc.Group, targetUserIsManager bool) (removed, failed int) {
	for _, ug := range userGroups {
		if ug.ID == targetGroupID {
			continue
		}

		// Preserve manager's default groups
		if targetUserIsManager && h.kc.IsDefaultGroup(ug.Name) {
			continue
		}

		if err := h.kc.RemoveUserFromGroup(ctx, userID, ug.ID); err != nil {
			applogger.ForComponent("group").Warnf("Failed to remove user %s from group %s (%s): %v", userID, ug.ID, ug.Name, err)
			failed++
		} else {
			removed++
		}
	}

	return removed, failed
}

// logoutUserAfterGroupChange logs out user from Keycloak and backend sessions
func (h *GroupHandler) logoutUserAfterGroupChange(ctx context.Context, userID string) {
	if err := h.kc.LogoutUser(ctx, userID); err != nil {
		applogger.ForComponent("group").Errorf("Failed to logout user from Keycloak %s: %v", userID, err)
	}

	if err := h.deleteUserSessions(ctx, userID); err != nil {
		applogger.ForComponent("group").Warnf("Failed to delete backend sessions for user %s: %v", userID, err)
	}
}

func (h *GroupHandler) RemoveMember(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if !h.requireExpertOrManagerAccess(c, userCtx, "remove group members") {
		return
	}

	groupID := c.Param("id")
	userID := c.Param("memberID")
	ctx := c.Request.Context()

	if userCtx.AccessLevel == constants.AccessLevelManager {
		if !h.validateManagerCanRemoveMember(c, ctx, userCtx, groupID, userID) {
			return
		}
	}

	if !h.validateCanRemoveFromGroup(c, ctx, groupID) {
		return
	}

	if err := h.kc.RemoveUserFromGroup(ctx, userID, groupID); err != nil {
		httputil.InternalError(c, "Failed to remove member")
		return
	}

	httputil.SuccessResponse(c, gin.H{"message": "Member removed successfully"})
}

// validateManagerCanRemoveMember validates if manager can remove a member
func (h *GroupHandler) validateManagerCanRemoveMember(c *gin.Context, ctx context.Context, userCtx *httputil.UserContext, groupID, userID string) bool {
	mgrGroupSet, err := h.kc.GetManagerGroupSet(ctx, userCtx.UserID)
	if err != nil {
		httputil.Forbidden(c, "Failed to validate manager groups")
		return false
	}

	if !mgrGroupSet[groupID] {
		httputil.Forbidden(c, "You can only remove members from your own groups")
		return false
	}

	userGroups, err := h.kc.GetUserGroups(ctx, userID)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch user's groups")
		return false
	}

	for _, ug := range userGroups {
		if mgrGroupSet[ug.ID] {
			return true
		}
	}

	httputil.Forbidden(c, "You can only manage users in your groups")
	return false
}

// validateCanRemoveFromGroup checks if user can be removed from this group
func (h *GroupHandler) validateCanRemoveFromGroup(c *gin.Context, ctx context.Context, groupID string) bool {
	g, err := h.kc.GetGroup(ctx, groupID)
	if err != nil {
		return true // Allow if can't fetch group
	}

	if h.kc.IsDefaultGroup(g.Name) {
		httputil.Forbidden(c, "Cannot remove users from Default group")
		return false
	}

	return true
}

// Helper methods for reducing cognitive complexity

// requireExpertOrManagerAccess checks if user has expert or manager access
func (h *GroupHandler) requireExpertOrManagerAccess(c *gin.Context, userCtx *httputil.UserContext, action string) bool {
	if userCtx.AccessLevel != constants.AccessLevelExpert && userCtx.AccessLevel != constants.AccessLevelManager {
		httputil.Forbidden(c, fmt.Sprintf("Only experts and managers can %s", action))
		return false
	}
	return true
}

// extractUserIDFromMember safely extracts user ID from member map
func (h *GroupHandler) extractUserIDFromMember(m map[string]interface{}) string {
	if uidRaw, ok := m["id"]; ok {
		if uid, ok2 := uidRaw.(string); ok2 && uid != "" {
			return uid
		}
	}
	return ""
}
