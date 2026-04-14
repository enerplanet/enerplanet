package models

import (
	"time"

	"github.com/lib/pq"
	"gorm.io/datatypes"
)

type CustomLocation struct {
	ID           uint           `json:"id" gorm:"primaryKey"`
	UserID       string         `json:"user_id" gorm:"not null;index"`
	OsmID        string         `json:"osm_id" gorm:"uniqueIndex"`
	Title        string         `json:"title" gorm:"not null"`
	FClass       string         `json:"f_class"`
	Area         float64        `json:"area"`
	DemandEnergy float64        `json:"demand_energy"`
	Geometry     datatypes.JSON `json:"geometry" gorm:"type:json"`
	GeometryArea datatypes.JSON `json:"geometry_area" gorm:"type:json"`
	Tags         pq.StringArray `json:"tags" gorm:"type:text[]"`
	IsPublic     bool           `json:"is_public" gorm:"default:false"`
	Status       string         `json:"status" gorm:"default:'active'"`
	CreatedAt    time.Time      `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt    time.Time      `json:"updated_at" gorm:"autoUpdateTime"`
}

func (CustomLocation) TableName() string {
	return "custom_locations"
}

type CustomLocationCreateRequest struct {
	Title        string                 `json:"title" binding:"required"`
	FClass       string                 `json:"f_class" binding:"required"`
	Area         float64                `json:"area" binding:"required,gt=0"`
	DemandEnergy float64                `json:"demand_energy" binding:"required,gte=0"`
	Geometry     map[string]interface{} `json:"geometry" binding:"required"`
	GeometryArea map[string]interface{} `json:"geometry_area" binding:"required"`
	Tags         []string               `json:"tags"`
	IsPublic     bool                   `json:"is_public"`
}

type CustomLocationUpdateRequest struct {
	Title        *string                 `json:"title,omitempty"`
	FClass       *string                 `json:"f_class,omitempty"`
	Area         *float64                `json:"area,omitempty" binding:"omitempty,gt=0"`
	DemandEnergy *float64                `json:"demand_energy,omitempty" binding:"omitempty,gte=0"`
	Geometry     *map[string]interface{} `json:"geometry,omitempty"`
	GeometryArea *map[string]interface{} `json:"geometry_area,omitempty"`
	Tags         *[]string               `json:"tags,omitempty"`
	IsPublic     *bool                   `json:"is_public,omitempty"`
}

type CustomLocationListResponse struct {
	Data       []CustomLocation `json:"data"`
	Total      int64            `json:"total"`
	Page       int              `json:"page"`
	PerPage    int              `json:"per_page"`
	TotalPages int              `json:"total_pages"`
}
