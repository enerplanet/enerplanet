package location

import (
	"fmt"

	"spatialhub_backend/internal/models"

	"gorm.io/gorm"
)

// ShareStore handles database operations for location sharing
type ShareStore struct {
	db *gorm.DB
}

// NewShareStore creates a new ShareStore instance
func NewShareStore(db *gorm.DB) *ShareStore {
	return &ShareStore{db: db}
}

// ShareWithUser shares a location with a specific user by email
func (ls *ShareStore) ShareWithUser(locationID uint, email, userID, permission, sharedBy string) (*models.LocationShare, error) {
	if permission == "" {
		permission = "view"
	}

	share := &models.LocationShare{
		LocationID: locationID,
		Email:      email,
		UserID:     userID,
		Permission: permission,
		SharedBy:   sharedBy,
	}

	result := ls.db.Where("location_id = ? AND email = ?", locationID, email).
		Assign(models.LocationShare{
			UserID:     userID,
			Permission: permission,
		}).
		FirstOrCreate(share)

	if result.Error != nil {
		return nil, fmt.Errorf("share location with user: %w", result.Error)
	}

	return share, nil
}

// ShareWithWorkspace shares a location with a workspace
func (ls *ShareStore) ShareWithWorkspace(locationID, workspaceID uint, permission, sharedBy string) (*models.LocationWorkspaceShare, error) {
	if permission == "" {
		permission = "view"
	}

	share := &models.LocationWorkspaceShare{
		LocationID:  locationID,
		WorkspaceID: workspaceID,
		Permission:  permission,
		SharedBy:    sharedBy,
	}

	result := ls.db.Where("location_id = ? AND workspace_id = ?", locationID, workspaceID).
		Assign(models.LocationWorkspaceShare{
			Permission: permission,
		}).
		FirstOrCreate(share)

	if result.Error != nil {
		return nil, fmt.Errorf("share location with workspace: %w", result.Error)
	}

	return share, nil
}

// ShareWithGroup shares a location with a user group
func (ls *ShareStore) ShareWithGroup(locationID uint, groupID, permission, sharedBy string) (*models.LocationGroupShare, error) {
	if permission == "" {
		permission = "view"
	}

	share := &models.LocationGroupShare{
		LocationID: locationID,
		GroupID:    groupID,
		Permission: permission,
		SharedBy:   sharedBy,
	}

	result := ls.db.Where("location_id = ? AND group_id = ?", locationID, groupID).
		Assign(models.LocationGroupShare{
			Permission: permission,
		}).
		FirstOrCreate(share)

	if result.Error != nil {
		return nil, fmt.Errorf("share location with group: %w", result.Error)
	}

	return share, nil
}

// RemoveUserShare removes a user share from a location
func (ls *ShareStore) RemoveUserShare(locationID, shareID uint) error {
	result := ls.db.Where("id = ? AND location_id = ?", shareID, locationID).Delete(&models.LocationShare{})
	if result.Error != nil {
		return fmt.Errorf("remove user share: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("share not found")
	}
	return nil
}

// RemoveWorkspaceShare removes a workspace share from a location
func (ls *ShareStore) RemoveWorkspaceShare(locationID, shareID uint) error {
	result := ls.db.Where("id = ? AND location_id = ?", shareID, locationID).Delete(&models.LocationWorkspaceShare{})
	if result.Error != nil {
		return fmt.Errorf("remove workspace share: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("share not found")
	}
	return nil
}

// RemoveGroupShare removes a group share from a location
func (ls *ShareStore) RemoveGroupShare(locationID, shareID uint) error {
	result := ls.db.Where("id = ? AND location_id = ?", shareID, locationID).Delete(&models.LocationGroupShare{})
	if result.Error != nil {
		return fmt.Errorf("remove group share: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("share not found")
	}
	return nil
}

// GetLocationShares returns all shares for a location
func (ls *ShareStore) GetLocationShares(locationID uint) (*models.LocationSharesListResponse, error) {
	response := &models.LocationSharesListResponse{
		UserShares:      []models.LocationShareResponse{},
		WorkspaceShares: []models.LocationShareResponse{},
		GroupShares:     []models.LocationShareResponse{},
	}

	var userShares []models.LocationShare
	if err := ls.db.Where("location_id = ?", locationID).Find(&userShares).Error; err != nil {
		return nil, fmt.Errorf("get user shares: %w", err)
	}
	for _, share := range userShares {
		response.UserShares = append(response.UserShares, models.LocationShareResponse{
			ID:         share.ID,
			Type:       "user",
			Email:      share.Email,
			UserID:     share.UserID,
			Permission: share.Permission,
			SharedBy:   share.SharedBy,
			CreatedAt:  share.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	var workspaceShares []models.LocationWorkspaceShare
	if err := ls.db.Where("location_id = ?", locationID).Find(&workspaceShares).Error; err != nil {
		return nil, fmt.Errorf("get workspace shares: %w", err)
	}
	for _, share := range workspaceShares {
		response.WorkspaceShares = append(response.WorkspaceShares, models.LocationShareResponse{
			ID:          share.ID,
			Type:        "workspace",
			WorkspaceID: share.WorkspaceID,
			Permission:  share.Permission,
			SharedBy:    share.SharedBy,
			CreatedAt:   share.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	var groupShares []models.LocationGroupShare
	if err := ls.db.Where("location_id = ?", locationID).Find(&groupShares).Error; err != nil {
		return nil, fmt.Errorf("get group shares: %w", err)
	}
	for _, share := range groupShares {
		response.GroupShares = append(response.GroupShares, models.LocationShareResponse{
			ID:         share.ID,
			Type:       "group",
			GroupID:    share.GroupID,
			Permission: share.Permission,
			SharedBy:   share.SharedBy,
			CreatedAt:  share.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	return response, nil
}
