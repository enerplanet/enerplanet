package workspaceservice

import (
	"context"
	"strings"

	"gorm.io/gorm"
	"platform.local/common/pkg/models"
)

func (s *WorkspaceService) SyncMemberUserID(userID, email string) {
	s.db.Model(&models.WorkspaceMember{}).
		Where("LOWER(email) = LOWER(?) AND (user_id = ? OR user_id IS NULL OR user_id = ?)", email, "", "").
		Update("user_id", userID)
}

func (s *WorkspaceService) FindUserIDByEmail(email string) string {
	var userID string
	s.db.Model(&models.WorkspaceMember{}).
		Select("user_id").
		Where("email = ? AND user_id <> ''", email).
		Limit(1).
		Scan(&userID)
	if userID != "" {
		return userID
	}
	// Keycloak fallback: resolve user_id for users not yet in any workspace
	// (e.g. admin accounts being added to a workspace for the first time).
	if s.kc != nil {
		if user, err := s.kc.FindUserByEmail(context.Background(), email); err == nil && user != nil {
			return user.ID
		}
	}
	return userID
}

func (s *WorkspaceService) FetchUserGroupIDs(userID string) []string {
	if s.kc == nil || userID == "" {
		return nil
	}

	ctx := context.Background()

	// Try cache first
	if s.cache != nil {
		if cached, err := s.cache.GetUserGroupIDs(ctx, userID); err == nil && len(cached) > 0 {
			return cached
		}
	}

	userGroups, err := s.kc.GetUserGroups(ctx, userID)
	if err != nil || len(userGroups) == 0 {
		return nil
	}

	groupIDs := make([]string, 0, len(userGroups))
	for _, group := range userGroups {
		groupIDs = append(groupIDs, group.ID)
	}

	// Cache for next time
	if s.cache != nil {
		_ = s.cache.SetUserGroupIDs(ctx, userID, groupIDs)
	}

	return groupIDs
}

func (s *WorkspaceService) LoadAccessibleWorkspaces(userCtxUserID, userCtxEmail, userCtxGroupID string, accessLevel string, groupIDs []string) ([]models.Workspace, error) {
	var workspaces []models.Workspace

	query := s.db.
		Joins("LEFT JOIN workspace_members ON workspace_members.workspace_id = workspaces.id").
		Joins("LEFT JOIN workspace_groups ON workspace_groups.workspace_id = workspaces.id")

	query = s.applyAccessFilters(query, userCtxUserID, userCtxEmail, groupIDs)

	err := query.
		Group("workspaces.id").
		Preload("Members").
		Preload("Groups").
		Order("workspaces.is_default DESC, workspaces.created_at DESC").
		Find(&workspaces).Error

	return workspaces, err
}

func (s *WorkspaceService) applyAccessFilters(query *gorm.DB, userID, email string, groupIDs []string) *gorm.DB {
	conditions := "workspaces.user_id = ? OR workspace_members.user_id = ? OR LOWER(workspace_members.email) = LOWER(?)"
	args := []interface{}{userID, userID, email}

	if len(groupIDs) > 0 {
		conditions += " OR workspace_groups.group_id IN ?"
		args = append(args, groupIDs)
	}

	return query.Where(conditions, args...)
}

func (s *WorkspaceService) FilterWorkspacesForPrivacy(workspaces []models.Workspace, userID, email string) {
	for i := range workspaces {
		if workspaces[i].UserID == userID {
			continue
		}

		workspaces[i].Members = filterMembersForUser(workspaces[i].Members, userID, email)
		workspaces[i].Groups = []models.WorkspaceGroup{}
	}
}

func (s *WorkspaceService) FilterMembersForUser(members []models.WorkspaceMember, userID, email string) []models.WorkspaceMember {
	return filterMembersForUser(members, userID, email)
}

func filterMembersForUser(members []models.WorkspaceMember, userID, email string) []models.WorkspaceMember {
	filtered := make([]models.WorkspaceMember, 0, len(members))
	for _, member := range members {
		if member.UserID == userID || strings.EqualFold(member.Email, email) {
			filtered = append(filtered, member)
		}
	}
	return filtered
}

func (s *WorkspaceService) GetWorkspace(id string) (*models.Workspace, error) {
	var workspace models.Workspace
	err := s.db.Preload("Members").Preload("Groups").Where(queryIDEquals, id).First(&workspace).Error
	if err != nil {
		return nil, err
	}
	return &workspace, nil
}

func (s *WorkspaceService) UserHasAccessWithGroup(userID, groupID string, workspaceID uint) bool {
	var count int64
	s.db.Model(&models.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Count(&count)

	if count > 0 {
		return true
	}

	var ownerCount int64
	s.db.Model(&models.Workspace{}).Where("id = ? AND user_id = ?", workspaceID, userID).Count(&ownerCount)
	if ownerCount > 0 {
		return true
	}

	if groupID != "" {
		s.db.Model(&models.WorkspaceGroup{}).
			Where(queryWorkspaceAndGroupIDs, workspaceID, groupID).
			Count(&count)
		return count > 0
	}

	return false
}

func (s *WorkspaceService) UserCanManageWorkspace(userID string, accessLevel string, groupID string, workspaceID uint) bool {
	var workspace models.Workspace
	if err := s.db.Where("id = ? AND user_id = ?", workspaceID, userID).First(&workspace).Error; err == nil {
		return true
	}
	if accessLevel == "expert" {
		return s.UserHasAccessWithGroup(userID, groupID, workspaceID)
	}
	return false
}

func (s *WorkspaceService) GetPreferredWorkspace(userID string) (*models.UserSetting, error) {
	var settings models.UserSetting
	err := s.db.Where("user_id = ?", userID).First(&settings).Error
	if err != nil {
		return nil, err
	}
	return &settings, nil
}

func (s *WorkspaceService) SetPreferredWorkspace(userID, email string, workspaceID *uint) (*models.UserSetting, error) {
	var settings models.UserSetting
	err := s.db.Where("user_id = ?", userID).First(&settings).Error

	switch {
	case err == gorm.ErrRecordNotFound:
		settings = models.UserSetting{
			UserID:               userID,
			Email:                email,
			PreferredWorkspaceID: workspaceID,
		}
		if err := s.db.Create(&settings).Error; err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	default:
		if err := s.db.Model(&settings).Update("preferred_workspace_id", workspaceID).Error; err != nil {
			return nil, err
		}
		settings.PreferredWorkspaceID = workspaceID
	}
	return &settings, nil
}

func (s *WorkspaceService) CreateOrGetDefault(userID, email string) (*models.Workspace, error) {
	const defaultWorkspaceName = "Default Workspace"

	var workspace models.Workspace
	err := s.db.Where("user_id = ? AND is_default = ?", userID, true).First(&workspace).Error

	switch {
	case err == gorm.ErrRecordNotFound:
		workspace = models.Workspace{
			Name:        defaultWorkspaceName,
			Description: "Default workspace",
			UserID:      userID,
			UserEmail:   email,
			IsDefault:   true,
		}

		if err := s.db.Create(&workspace).Error; err != nil {
			return nil, err
		}

		_ = s.createOwnerMember(workspace.ID, userID, email)
	case err != nil:
		return nil, err
	case workspace.Name != defaultWorkspaceName:
		_ = s.db.Model(&workspace).Update("name", defaultWorkspaceName).Error
	}

	return &workspace, nil
}
