package models

import "time"

const (
	AccessLevelVeryLow      = "very_low"
	AccessLevelIntermediate = "intermediate"
	AccessLevelManager      = "manager"
	AccessLevelExpert       = "expert"
)

var DefaultPolygonLimits = map[string]int{
	AccessLevelVeryLow:      50,
	AccessLevelIntermediate: 100,
	AccessLevelManager:      200,
	AccessLevelExpert:       0,
}

type PolygonLimit struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	AccessLevel   string    `gorm:"uniqueIndex;not null" json:"access_level"`
	BuildingLimit int       `gorm:"not null;default:50" json:"building_limit"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (PolygonLimit) TableName() string {
	return "polygon_limits"
}
