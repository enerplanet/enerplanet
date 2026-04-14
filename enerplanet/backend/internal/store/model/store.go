package model

import (
	backendModels "spatialhub_backend/internal/models"

	commonModels "platform.local/common/pkg/models"

	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// Store encapsulates all database operations for the model domain.
type Store struct {
	db *gorm.DB
}

// NewStore creates a new model Store.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// DB exposes the underlying *gorm.DB for complex query building
// that hasn't been abstracted into dedicated store methods yet.
func (s *Store) DB() *gorm.DB {
	return s.db
}

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

// FindByID finds a model by its ID.
func (s *Store) FindByID(id string) (*commonModels.Model, error) {
	var model commonModels.Model
	err := s.db.Where("id = ?", id).First(&model).Error
	return &model, err
}

// FindByIDPreloaded finds a model by ID with Workspace.Members and Workspace.Groups preloaded.
func (s *Store) FindByIDPreloaded(id string) (*commonModels.Model, error) {
	var model commonModels.Model
	err := s.db.
		Preload("Workspace.Members").
		Preload("Workspace.Groups").
		Where("id = ?", id).
		First(&model).Error
	return &model, err
}

// Create creates a model from a field map (avoids inserting removed columns).
func (s *Store) Create(modelMap map[string]interface{}) error {
	return s.db.Model(&commonModels.Model{}).Create(&modelMap).Error
}

// Update applies a map of updates to the given model.
func (s *Store) Update(model *commonModels.Model, updates map[string]interface{}) error {
	return s.db.Model(model).Updates(updates).Error
}

// HardDelete permanently removes a model (unscoped).
func (s *Store) HardDelete(model *commonModels.Model) error {
	return s.db.Unscoped().Delete(model).Error
}

// UpdateParentModelID sets parent_model_id = NULL for every child of modelID.
func (s *Store) UpdateParentModelID(modelID uint) error {
	return s.db.Model(&commonModels.Model{}).
		Where("parent_model_id = ?", modelID).
		Update("parent_model_id", nil).Error
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// CountByUserID returns the number of non-deleted models owned by userID.
func (s *Store) CountByUserID(userID string) (int64, error) {
	var count int64
	err := s.db.Model(&commonModels.Model{}).
		Where("user_id = ? AND deleted_at IS NULL", userID).
		Count(&count).Error
	return count, err
}

// CountByUserIDAndStatus returns the count of models with the given status.
func (s *Store) CountByUserIDAndStatus(userID, status string) (int64, error) {
	var count int64
	err := s.db.Model(&commonModels.Model{}).
		Where("user_id = ? AND status = ? AND deleted_at IS NULL", userID, status).
		Count(&count).Error
	return count, err
}

// CountByUserIDGrouped returns counts per status in a single query.
func (s *Store) CountByUserIDGrouped(userID string) (total int64, byStatus map[string]int64, err error) {
	byStatus = make(map[string]int64)
	type statusCount struct {
		Status string
		Count  int64
	}
	var rows []statusCount
	err = s.db.Model(&commonModels.Model{}).
		Select("status, COUNT(*) as count").
		Where("user_id = ? AND deleted_at IS NULL", userID).
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return 0, nil, err
	}
	for _, r := range rows {
		byStatus[r.Status] = r.Count
		total += r.Count
	}
	return total, byStatus, nil
}

// FindByIDs returns models matching the supplied IDs.
func (s *Store) FindByIDs(ids []uint) ([]commonModels.Model, error) {
	var models []commonModels.Model
	err := s.db.Where("id IN ?", ids).Find(&models).Error
	return models, err
}

// ---------------------------------------------------------------------------
// Workspace access
// ---------------------------------------------------------------------------

// IsDefaultWorkspace checks whether workspaceID is the user's default workspace.
func (s *Store) IsDefaultWorkspace(userID string, workspaceID uint) (bool, error) {
	var workspace commonModels.Workspace
	err := s.db.Session(&gorm.Session{Logger: s.db.Logger.LogMode(gormlogger.Silent)}).
		Where("user_id = ? AND is_default = ? AND id = ?", userID, true, workspaceID).
		First(&workspace).Error
	if err == nil {
		return true, nil
	}
	if err == gorm.ErrRecordNotFound {
		return false, nil
	}
	return false, err
}

// GetDefaultWorkspace returns the user's default workspace.
func (s *Store) GetDefaultWorkspace(userID string) (*commonModels.Workspace, error) {
	var workspace commonModels.Workspace
	err := s.db.Where("user_id = ? AND is_default = ?", userID, true).First(&workspace).Error
	if err != nil {
		return nil, err
	}
	return &workspace, nil
}

// ---------------------------------------------------------------------------
// Model sharing
// ---------------------------------------------------------------------------

// CreateModelShare persists a new ModelShare record.
func (s *Store) CreateModelShare(share *commonModels.ModelShare) error {
	return s.db.Create(share).Error
}

// FindModelShareByModelAndEmail looks up an existing share.
func (s *Store) FindModelShareByModelAndEmail(modelID uint, email string) (*commonModels.ModelShare, error) {
	var share commonModels.ModelShare
	err := s.db.Where("model_id = ? AND email = ?", modelID, email).First(&share).Error
	return &share, err
}

// CountModelSharesByModelAndUser returns how many shares exist for a model+user pair.
// Checks both user_id and email to handle cases where user_id hasn't been backfilled yet.
func (s *Store) CountModelSharesByModelAndUser(modelID uint, userID string) int64 {
	var count int64
	s.db.Model(&commonModels.ModelShare{}).
		Where("model_id = ? AND user_id = ?", modelID, userID).
		Count(&count)
	return count
}

// CountModelSharesByModelAndUserOrEmail checks shares by user_id or email
func (s *Store) CountModelSharesByModelAndUserOrEmail(modelID uint, userID, email string) int64 {
	var count int64
	q := s.db.Model(&commonModels.ModelShare{}).Where("model_id = ?", modelID)
	if email != "" {
		q = q.Where("user_id = ? OR LOWER(email) = LOWER(?)", userID, email)
	} else {
		q = q.Where("user_id = ?", userID)
	}
	q.Count(&count)
	return count
}

// PluckSharedModelIDsByUser returns model IDs shared with the given user.
func (s *Store) PluckSharedModelIDsByUser(userID string) []uint {
	var ids []uint
	s.db.Model(&commonModels.ModelShare{}).
		Where("user_id = ?", userID).
		Pluck("model_id", &ids)
	return ids
}

// IsWorkspaceSharedWithUser checks direct workspace membership by email.
func (s *Store) IsWorkspaceSharedWithUser(workspaceID uint, email string) bool {
	var count int64
	s.db.Model(&commonModels.WorkspaceMember{}).
		Where("workspace_id = ? AND LOWER(email) = LOWER(?)", workspaceID, email).
		Count(&count)
	return count > 0
}

// IsWorkspaceSharedWithUserGroups checks if the workspace is shared via any of the supplied groups.
func (s *Store) IsWorkspaceSharedWithUserGroups(workspaceID uint, groupIDs []string) bool {
	var count int64
	s.db.Model(&commonModels.WorkspaceGroup{}).
		Where("workspace_id = ? AND group_id IN ?", workspaceID, groupIDs).
		Count(&count)
	return count > 0
}

// ---------------------------------------------------------------------------
// Workspace helpers (used by service)
// ---------------------------------------------------------------------------

// CountWorkspaceOwner checks if userID owns the workspace.
func (s *Store) CountWorkspaceOwner(workspaceID uint, userID string) int64 {
	var count int64
	s.db.Model(&commonModels.Workspace{}).
		Where("id = ? AND user_id = ?", workspaceID, userID).
		Count(&count)
	return count
}

// CountWorkspaceMember checks if userID is a member of the workspace.
func (s *Store) CountWorkspaceMember(workspaceID uint, userID string) int64 {
	var count int64
	s.db.Model(&commonModels.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Count(&count)
	return count
}

// CountWorkspaceGroupAccess checks if any of groupIDs grant access to the workspace.
func (s *Store) CountWorkspaceGroupAccess(workspaceID uint, groupIDs []string) int64 {
	var count int64
	s.db.Model(&commonModels.WorkspaceGroup{}).
		Where("workspace_id = ? AND group_id IN ?", workspaceID, groupIDs).
		Count(&count)
	return count
}

// FindWorkspaceByIDSelect fetches a workspace with only the selected columns.
func (s *Store) FindWorkspaceByIDSelect(workspaceID uint) (*commonModels.Workspace, error) {
	var ws commonModels.Workspace
	err := s.db.Select("id, user_id, user_email, is_default").
		Where("id = ?", workspaceID).First(&ws).Error
	return &ws, err
}

// UpdateWorkspaceUserID updates the user_id on the workspace.
func (s *Store) UpdateWorkspaceUserID(ws *commonModels.Workspace, userID string) error {
	return s.db.Model(ws).Update("user_id", userID).Error
}

// PluckOwnedWorkspaceIDs returns workspace IDs owned by the user from the given set.
func (s *Store) PluckOwnedWorkspaceIDs(workspaceIDs []uint, userID string) []uint {
	var ids []uint
	s.db.Model(&commonModels.Workspace{}).
		Where("id IN ? AND user_id = ?", workspaceIDs, userID).
		Pluck("id", &ids)
	return ids
}

// PluckMemberWorkspaceIDs returns workspace IDs where the user is a member.
func (s *Store) PluckMemberWorkspaceIDs(workspaceIDs []uint, userID string) []uint {
	var ids []uint
	s.db.Model(&commonModels.WorkspaceMember{}).
		Where("workspace_id IN ? AND user_id = ?", workspaceIDs, userID).
		Pluck("workspace_id", &ids)
	return ids
}

// PluckGroupWorkspaceIDs returns workspace IDs accessible via group membership.
func (s *Store) PluckGroupWorkspaceIDs(workspaceIDs []uint, groupIDs []string) []uint {
	var ids []uint
	s.db.Model(&commonModels.WorkspaceGroup{}).
		Where("workspace_id IN ? AND group_id IN ?", workspaceIDs, groupIDs).
		Pluck("workspace_id", &ids)
	return ids
}

// ---------------------------------------------------------------------------
// Sync helpers (used by service)
// ---------------------------------------------------------------------------

// SyncWorkspaceMemberUserID backfills user_id on workspace_members and model_shares by email.
func (s *Store) SyncWorkspaceMemberUserID(userID, email string) {
	s.db.Model(&commonModels.WorkspaceMember{}).
		Where("email = ? AND (user_id = ? OR user_id IS NULL)", email, "").
		Update("user_id", userID)

	s.db.Model(&commonModels.ModelShare{}).
		Where("email = ? AND (user_id = ? OR user_id IS NULL)", email, "").
		Update("user_id", userID)
}

// FindUserIDByEmail looks up a user_id by email across workspace_members and model_shares.
func (s *Store) FindUserIDByEmail(email string) string {
	var userID string
	s.db.Model(&commonModels.WorkspaceMember{}).
		Select("user_id").
		Where("email = ? AND user_id <> ''", email).
		Limit(1).
		Scan(&userID)
	if userID == "" {
		s.db.Model(&commonModels.ModelShare{}).
			Select("user_id").
			Where("email = ? AND user_id <> ''", email).
			Limit(1).
			Scan(&userID)
	}
	return userID
}

// ---------------------------------------------------------------------------
// Model limits
// ---------------------------------------------------------------------------

// GetModelLimit fetches the ModelLimit record for the given access level.
func (s *Store) GetModelLimit(accessLevel string) (*backendModels.ModelLimit, error) {
	var limit backendModels.ModelLimit
	err := s.db.Where("access_level = ?", accessLevel).First(&limit).Error
	if err != nil {
		return nil, err
	}
	return &limit, nil
}

// ---------------------------------------------------------------------------
// Calculation helpers (used by service)
// ---------------------------------------------------------------------------

// FindModelWithWorkspace loads a model by ID param with Workspace preloaded.
func (s *Store) FindModelWithWorkspace(modelIDParam string) (*commonModels.Model, error) {
	var model commonModels.Model
	err := s.db.Preload("Workspace").First(&model, modelIDParam).Error
	return &model, err
}
