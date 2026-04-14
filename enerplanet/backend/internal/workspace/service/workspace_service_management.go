package workspaceservice

import (
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"platform.local/common/pkg/models"
)

func (s *WorkspaceService) CreateWorkspace(name, description, ownerID, ownerEmail string) (*models.Workspace, error) {
	workspace := models.Workspace{
		Name:        name,
		Description: description,
		UserID:      ownerID,
		UserEmail:   ownerEmail,
		IsDefault:   false,
	}

	if err := s.db.Create(&workspace).Error; err != nil {
		return nil, err
	}

	if err := s.createOwnerMember(workspace.ID, ownerID, ownerEmail); err != nil {
		return nil, err
	}

	return &workspace, nil
}

func (s *WorkspaceService) UpdateWorkspace(workspace *models.Workspace, name *string, description *string) error {
	updates := make(map[string]interface{})
	if name != nil {
		updates["name"] = *name
	}
	if description != nil {
		updates["description"] = *description
	}

	if len(updates) > 0 {
		return s.db.Model(workspace).Updates(updates).Error
	}
	return nil
}

func (s *WorkspaceService) CopyWorkspace(sourceWorkspace *models.Workspace, userID, userEmail, name, description string) (*models.Workspace, error) {
	tx := s.db.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	newWorkspace := models.Workspace{
		Name:        name,
		Description: description,
		UserID:      userID,
		UserEmail:   userEmail,
		IsDefault:   false,
	}

	if err := tx.Create(&newWorkspace).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	if err := s.createOwnerMemberTx(tx, newWorkspace.ID, userID, userEmail); err != nil {
		tx.Rollback()
		return nil, err
	}

	if !s.copyWorkspaceModels(tx, sourceWorkspace.ID, newWorkspace.ID, userID, userEmail) {
		tx.Rollback()
		return nil, gorm.ErrInvalidTransaction
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	var createdWorkspace models.Workspace
	if err := s.db.Preload("Members").Preload("Groups").Where(queryIDEquals, newWorkspace.ID).First(&createdWorkspace).Error; err != nil {
		return nil, err
	}

	return &createdWorkspace, nil
}

func (s *WorkspaceService) DeleteWorkspace(workspace *models.Workspace) error {
	return s.db.Delete(workspace).Error
}

func (s *WorkspaceService) AddMember(workspaceID uint, email, userID string) (*models.WorkspaceMember, error) {
	member := models.WorkspaceMember{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Email:       email,
		JoinedAt:    time.Now().UTC(),
	}

	if err := s.db.Create(&member).Error; err != nil {
		return nil, err
	}
	return &member, nil
}

func (s *WorkspaceService) FindMember(workspaceID uint, email string) (*models.WorkspaceMember, error) {
	var member models.WorkspaceMember
	err := s.db.Where("workspace_id = ? AND email = ?", workspaceID, email).First(&member).Error
	if err != nil {
		return nil, err
	}
	return &member, nil
}

func (s *WorkspaceService) FetchMemberByID(workspaceID uint, memberID string) (*models.WorkspaceMember, error) {
	var member models.WorkspaceMember
	if err := s.db.Where("id = ? AND workspace_id = ?", memberID, workspaceID).First(&member).Error; err != nil {
		return nil, err
	}
	return &member, nil
}

func (s *WorkspaceService) RemoveMember(member *models.WorkspaceMember) error {
	return s.db.Delete(member).Error
}

func (s *WorkspaceService) AddGroup(workspaceID uint, groupID, groupName string) (*models.WorkspaceGroup, error) {
	workspaceGroup := models.WorkspaceGroup{
		WorkspaceID: workspaceID,
		GroupID:     groupID,
		GroupName:   groupName,
	}

	if err := s.db.Create(&workspaceGroup).Error; err != nil {
		return nil, err
	}
	return &workspaceGroup, nil
}

func (s *WorkspaceService) FindGroup(workspaceID uint, groupID string) (*models.WorkspaceGroup, error) {
	var workspaceGroup models.WorkspaceGroup
	err := s.db.Where(queryWorkspaceAndGroupIDs, workspaceID, groupID).First(&workspaceGroup).Error
	if err != nil {
		return nil, err
	}
	return &workspaceGroup, nil
}

func (s *WorkspaceService) RemoveGroup(workspaceGroup *models.WorkspaceGroup) error {
	return s.db.Delete(workspaceGroup).Error
}

func (s *WorkspaceService) copyWorkspaceModels(tx *gorm.DB, sourceWorkspaceID, newWorkspaceID uint, userID, email string) bool {
	var sourceModels []models.Model
	if err := s.db.Where("workspace_id = ?", sourceWorkspaceID).Find(&sourceModels).Error; err != nil {
		return false
	}

	for _, model := range sourceModels {
		modelMap := map[string]interface{}{
			"user_id":      userID,
			"user_email":   email,
			"workspace_id": newWorkspaceID,
			"title":        model.Title,
			"description":  model.Description,
			"status":       models.ModelStatusDraft,
			"region":       model.Region,
			"country":      model.Country,
			"resolution":   model.Resolution,
			"from_date":    model.FromDate,
			"to_date":      model.ToDate,
			"coordinates":  model.Coordinates,
			"config":       model.Config,
			"results":      datatypes.JSON([]byte("null")),
			"is_copy":      true,
			"is_active":    true,
			"created_at":   time.Now().UTC(),
			"updated_at":   time.Now().UTC(),
		}

		if err := tx.Model(&models.Model{}).Create(&modelMap).Error; err != nil {
			return false
		}
	}

	return true
}

func (s *WorkspaceService) createOwnerMember(workspaceID uint, userID, email string) error {
	member := models.WorkspaceMember{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Email:       email,
		JoinedAt:    time.Now().UTC(),
	}
	return s.db.Create(&member).Error
}

func (s *WorkspaceService) createOwnerMemberTx(tx *gorm.DB, workspaceID uint, userID, email string) error {
	member := models.WorkspaceMember{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Email:       email,
		JoinedAt:    time.Now().UTC(),
	}
	return tx.Create(&member).Error
}
