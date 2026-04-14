package modelservice

import (
	"context"

	"platform.local/common/pkg/models"
)

func (s *ModelService) GetUserGroupIDs(ctx context.Context, userID string) []string {
	if s.kc == nil {
		return nil
	}

	if s.keycloakCache != nil {
		if cached, err := s.keycloakCache.GetUserGroupIDs(ctx, userID); err == nil {
			return cached
		}
	}

	userGroups, err := s.kc.GetUserGroups(ctx, userID)
	if err != nil || len(userGroups) == 0 {
		return nil
	}

	groupIDs := make([]string, 0, len(userGroups))
	for _, g := range userGroups {
		groupIDs = append(groupIDs, g.ID)
	}

	if s.keycloakCache != nil {
		_ = s.keycloakCache.SetUserGroupIDs(ctx, userID, groupIDs)
	}

	return groupIDs
}

func (s *ModelService) GetGroupMemberUserIDs(ctx context.Context, groupIDs []string) []string {
	if s.kc == nil || len(groupIDs) == 0 {
		return nil
	}

	memberIDSet := make(map[string]bool)
	for _, groupID := range groupIDs {
		if s.keycloakCache != nil {
			if cached, err := s.keycloakCache.GetGroupMemberUserIDs(ctx, groupID); err == nil {
				for _, userID := range cached {
					memberIDSet[userID] = true
				}
				continue
			}
		}

		members, err := s.kc.GetGroupMembers(ctx, groupID)
		if err != nil {
			continue
		}

		groupMemberIDs := make([]string, 0)
		for _, member := range members {
			if userID, ok := member["id"].(string); ok && userID != "" {
				memberIDSet[userID] = true
				groupMemberIDs = append(groupMemberIDs, userID)
			}
		}

		if s.keycloakCache != nil && len(groupMemberIDs) > 0 {
			_ = s.keycloakCache.SetGroupMemberUserIDs(ctx, groupID, groupMemberIDs)
		}
	}

	memberIDs := make([]string, 0, len(memberIDSet))
	for userID := range memberIDSet {
		memberIDs = append(memberIDs, userID)
	}
	return memberIDs
}

func (s *ModelService) UserHasWorkspaceAccess(userID string, workspaceID uint) bool {
	if s.store.CountWorkspaceOwner(workspaceID, userID) > 0 {
		return true
	}

	if s.store.CountWorkspaceMember(workspaceID, userID) > 0 {
		return true
	}

	groupIDs := s.GetUserGroupIDs(context.Background(), userID)
	if len(groupIDs) > 0 {
		if s.store.CountWorkspaceGroupAccess(workspaceID, groupIDs) > 0 {
			return true
		}
	}

	return false
}

func (s *ModelService) UserHasWorkspaceAccessWithEmail(userID, email string, workspaceID uint) bool {
	if s.UserHasWorkspaceAccess(userID, workspaceID) {
		return true
	}

	ws, err := s.store.FindWorkspaceByIDSelect(workspaceID)
	if err == nil {
		if ws.UserEmail == email {
			if ws.UserID != userID {
				_ = s.store.UpdateWorkspaceUserID(ws, userID)
			}
			return true
		}
	}

	return false
}

func (s *ModelService) BatchUserHasWorkspaceAccess(ctx context.Context, userID string, workspaceIDs []uint) map[uint]bool {
	result := make(map[uint]bool)
	if len(workspaceIDs) == 0 {
		return result
	}

	for _, wsID := range workspaceIDs {
		result[wsID] = false
	}

	for _, wsID := range s.store.PluckOwnedWorkspaceIDs(workspaceIDs, userID) {
		result[wsID] = true
	}

	remainingIDs := filterNonAccessible(workspaceIDs, result)
	if len(remainingIDs) == 0 {
		return result
	}

	for _, wsID := range s.store.PluckMemberWorkspaceIDs(remainingIDs, userID) {
		result[wsID] = true
	}

	remainingIDs = filterNonAccessible(remainingIDs, result)
	if len(remainingIDs) == 0 {
		return result
	}

	groupIDs := s.GetUserGroupIDs(ctx, userID)
	if len(groupIDs) > 0 {
		for _, wsID := range s.store.PluckGroupWorkspaceIDs(remainingIDs, groupIDs) {
			result[wsID] = true
		}
	}

	return result
}

func filterNonAccessible(workspaceIDs []uint, accessMap map[uint]bool) []uint {
	remaining := make([]uint, 0)
	for _, wsID := range workspaceIDs {
		if !accessMap[wsID] {
			remaining = append(remaining, wsID)
		}
	}
	return remaining
}

func (s *ModelService) UserHasModelAccess(userID string, model *models.Model) bool {
	return s.UserHasModelAccessByEmail(userID, "", model)
}

func (s *ModelService) UserHasModelAccessByEmail(userID, email string, model *models.Model) bool {
	if model.IsOwner(userID) {
		return true
	}
	if model.WorkspaceID != nil {
		if s.UserHasWorkspaceAccess(userID, *model.WorkspaceID) {
			return true
		}
	}
	if email != "" {
		return s.store.CountModelSharesByModelAndUserOrEmail(model.ID, userID, email) > 0
	}
	return s.store.CountModelSharesByModelAndUser(model.ID, userID) > 0
}

func (s *ModelService) GetDefaultWorkspace(userID string) (*models.Workspace, error) {
	return s.store.GetDefaultWorkspace(userID)
}

func (s *ModelService) SyncWorkspaceMemberUserID(userID, email string) {
	s.store.SyncWorkspaceMemberUserID(userID, email)
}

func (s *ModelService) FindUserIDByEmail(email string) string {
	userID := s.store.FindUserIDByEmail(email)
	if userID != "" {
		return userID
	}
	// Fallback: look up in Keycloak if not found in local DB
	if s.kc != nil {
		if user, err := s.kc.FindUserByEmail(context.Background(), email); err == nil && user != nil {
			return user.ID
		}
	}
	return ""
}
