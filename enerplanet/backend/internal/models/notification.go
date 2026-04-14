package models

import (
	"time"

	"gorm.io/gorm"
)

// Notification represents a system-wide notification (created by admins/experts)
type Notification struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	Service       string         `gorm:"type:varchar(100);not null" json:"service"`
	Message       string         `gorm:"type:text;not null" json:"message"`
	Type          string         `gorm:"type:varchar(50);not null;default:'info'" json:"type"` // info, warning, error, maintenance
	ScheduledAt   time.Time      `gorm:"not null" json:"scheduled_at"`
	Status        string         `gorm:"type:varchar(50);not null;default:'pending'" json:"status"`     // pending, sent, failed
	CreatedBy     string         `gorm:"type:varchar(255);not null" json:"created_by"`                  // Keycloak user ID
	RecipientType string         `gorm:"type:varchar(50);not null;default:'all'" json:"recipient_type"` // all, specific
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

// UserNotification represents a notification for a specific user
type UserNotification struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	UserID         string         `gorm:"type:varchar(255);not null;index" json:"user_id"` // Keycloak user ID
	NotificationID *uint          `gorm:"index" json:"notification_id"`                    // Reference to system notification (nullable for user-specific)
	Title          string         `gorm:"type:varchar(255);not null" json:"title"`
	Message        string         `gorm:"type:text;not null" json:"message"`
	Type           string         `gorm:"type:varchar(50);not null;default:'info'" json:"type"` // info, warning, error, success
	Read           bool           `gorm:"default:false" json:"read"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Notification) TableName() string {
	return "notifications"
}

func (UserNotification) TableName() string {
	return "user_notifications"
}
