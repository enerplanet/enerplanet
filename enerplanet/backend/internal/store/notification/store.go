package notification

import (
	"time"

	"gorm.io/gorm"

	backendModels "spatialhub_backend/internal/models"
)

// UserSettings is a read-only view of the user_settings table.
type UserSettings struct {
	UserID               string `gorm:"primaryKey"`
	EmailNotifications   bool   `gorm:"default:true"`
	BrowserNotifications bool   `gorm:"default:true"`
}

func (UserSettings) TableName() string { return "user_settings" }

type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

func (s *Store) CreateNotification(notif *backendModels.Notification) error {
	return s.db.Create(notif).Error
}

func (s *Store) GetNotificationByID(id uint) (*backendModels.Notification, error) {
	var notif backendModels.Notification
	if err := s.db.First(&notif, id).Error; err != nil {
		return nil, err
	}
	return &notif, nil
}

func (s *Store) CreateUserNotification(notif *backendModels.UserNotification) error {
	return s.db.Create(notif).Error
}

// GetUserNotifications returns user notifications ordered by created_at DESC with an optional
// time filter. Pass a zero-value cutoff to skip the time filter.
func (s *Store) GetUserNotifications(userID string, limit int, cutoff time.Time) ([]backendModels.UserNotification, error) {
	query := s.db.Where("user_id = ?", userID)
	if !cutoff.IsZero() {
		query = query.Where("created_at >= ?", cutoff)
	}
	var results []backendModels.UserNotification
	err := query.Order("created_at DESC").Limit(limit).Find(&results).Error
	return results, err
}

func (s *Store) MarkAsRead(id uint, userID string) (int64, error) {
	result := s.db.Model(&backendModels.UserNotification{}).
		Where("id = ? AND user_id = ?", id, userID).
		Update("read", true)
	return result.RowsAffected, result.Error
}

func (s *Store) MarkAllAsRead(userID string) (int64, error) {
	result := s.db.Model(&backendModels.UserNotification{}).
		Where("user_id = ? AND read = ?", userID, false).
		Update("read", true)
	return result.RowsAffected, result.Error
}

func (s *Store) ClearAllUserNotifications(userID string) (int64, error) {
	result := s.db.Where("user_id = ?", userID).Delete(&backendModels.UserNotification{})
	return result.RowsAffected, result.Error
}

func (s *Store) GetAllUserIDs() ([]string, error) {
	var users []struct{ UserID string }
	if err := s.db.Table("user_settings").Select("user_id").Find(&users).Error; err != nil {
		return nil, err
	}
	ids := make([]string, len(users))
	for i, u := range users {
		ids[i] = u.UserID
	}
	return ids, nil
}

func (s *Store) GetUserSettings(userID string) (*UserSettings, error) {
	var settings UserSettings
	if err := s.db.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		return nil, err
	}
	return &settings, nil
}
