package models

import "time"

// DefaultModelLimits defines the default model creation limits per access level.
// A value of 0 means unlimited.
var DefaultModelLimits = map[string]int{
	AccessLevelVeryLow:      10,
	AccessLevelIntermediate: 25,
	AccessLevelManager:      50,
	AccessLevelExpert:       0, // Unlimited
}

// ModelLimit represents a model creation limit for a specific access level
type ModelLimit struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	AccessLevel string    `gorm:"uniqueIndex;not null" json:"access_level"`
	ModelLimit  int       `gorm:"not null;default:10" json:"model_limit"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (ModelLimit) TableName() string {
	return "model_limits"
}
