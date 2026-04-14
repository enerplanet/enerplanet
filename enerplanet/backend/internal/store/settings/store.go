package settings

import (
	"platform.local/common/pkg/models"
	backendModels "spatialhub_backend/internal/models"

	"gorm.io/gorm"
)

const sqlWhereAccessLevel = "access_level = ?"

// Store encapsulates all database operations for settings.
type Store struct {
	db *gorm.DB
}

// NewStore creates a new settings Store.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// --- User settings ---

// GetOrCreateUserSettings fetches or creates default user settings.
func (s *Store) GetOrCreateUserSettings(userID, email string) (*models.UserSetting, error) {
	var settings models.UserSetting

	result := s.db.Where("user_id = ?", userID).First(&settings)

	if result.Error == gorm.ErrRecordNotFound {
		settings = models.UserSetting{
			UserID:                  userID,
			Email:                   email,
			PrivacyAccepted:         false,
			ProductTourCompleted:    false,
			AreaSelectTourCompleted: false,
			OnboardingCompleted:     false,
			Theme:                   models.ThemeSystem,
			Language:                models.LanguageEN,
		}

		if err := s.db.Create(&settings).Error; err != nil {
			return nil, err
		}
		return &settings, nil
	}

	if result.Error != nil {
		return nil, result.Error
	}

	if settings.Email != email {
		settings.Email = email
		if err := s.db.Save(&settings).Error; err != nil {
			return nil, err
		}
	}

	return &settings, nil
}

// SaveUserSettings persists the full user settings record.
func (s *Store) SaveUserSettings(settings *models.UserSetting) error {
	return s.db.Save(settings).Error
}

// UpdateUserSettingsPartial applies a partial update to user settings.
func (s *Store) UpdateUserSettingsPartial(settings *models.UserSetting, updates map[string]interface{}) error {
	return s.db.Model(settings).Updates(updates).Error
}

// DeleteUserSettings removes user settings by user ID.
func (s *Store) DeleteUserSettings(userID string) error {
	return s.db.Where("user_id = ?", userID).Delete(&models.UserSetting{}).Error
}

// --- Polygon limits ---

// GetAllPolygonLimits returns all polygon limits from the database.
func (s *Store) GetAllPolygonLimits() ([]backendModels.PolygonLimit, error) {
	var limits []backendModels.PolygonLimit
	err := s.db.Find(&limits).Error
	return limits, err
}

// GetPolygonLimitByAccessLevel returns a single polygon limit by access level.
func (s *Store) GetPolygonLimitByAccessLevel(level string) (*backendModels.PolygonLimit, error) {
	var limit backendModels.PolygonLimit
	err := s.db.Where(sqlWhereAccessLevel, level).First(&limit).Error
	if err != nil {
		return nil, err
	}
	return &limit, nil
}

// UpsertPolygonLimit creates or updates a polygon limit within the given transaction.
func (s *Store) UpsertPolygonLimit(tx *gorm.DB, accessLevel string, limit int) error {
	var polyLimit backendModels.PolygonLimit
	err := tx.Where(sqlWhereAccessLevel, accessLevel).First(&polyLimit).Error
	if err == gorm.ErrRecordNotFound {
		return tx.Model(&backendModels.PolygonLimit{}).Create(map[string]interface{}{
			"access_level":   accessLevel,
			"building_limit": limit,
		}).Error
	}
	if err != nil {
		return err
	}
	polyLimit.BuildingLimit = limit
	return tx.Save(&polyLimit).Error
}

// BeginTx starts a new database transaction.
func (s *Store) BeginTx() *gorm.DB {
	return s.db.Begin()
}

// --- Model limits ---

// GetAllModelLimits returns all model limits from the database.
func (s *Store) GetAllModelLimits() ([]backendModels.ModelLimit, error) {
	var limits []backendModels.ModelLimit
	err := s.db.Find(&limits).Error
	return limits, err
}

// GetModelLimitByAccessLevel returns a single model limit by access level.
func (s *Store) GetModelLimitByAccessLevel(level string) (*backendModels.ModelLimit, error) {
	var limit backendModels.ModelLimit
	err := s.db.Where(sqlWhereAccessLevel, level).First(&limit).Error
	if err != nil {
		return nil, err
	}
	return &limit, nil
}

// UpsertModelLimit creates or updates a model limit within the given transaction.
func (s *Store) UpsertModelLimit(tx *gorm.DB, accessLevel string, limit int) error {
	var modelLimit backendModels.ModelLimit
	err := tx.Where(sqlWhereAccessLevel, accessLevel).First(&modelLimit).Error
	if err == gorm.ErrRecordNotFound {
		newLimit := map[string]interface{}{
			"access_level": accessLevel,
			"model_limit":  limit,
		}
		return tx.Model(&backendModels.ModelLimit{}).Create(newLimit).Error
	}
	if err != nil {
		return err
	}
	modelLimit.ModelLimit = limit
	return tx.Save(&modelLimit).Error
}

// CountUserModels counts non-deleted models owned by a user.
func (s *Store) CountUserModels(userID string) (int64, error) {
	var count int64
	err := s.db.Model(&models.Model{}).Where("user_id = ? AND deleted_at IS NULL", userID).Count(&count).Error
	return count, err
}
