package models

import (
	"time"

	"gorm.io/datatypes"
)

type CachedRegion struct {
	ID          uint           `json:"id" gorm:"primaryKey"`
	RegionName  string         `json:"region_name" gorm:"not null"`
	Country     string         `json:"country"`
	CountryCode string         `json:"country_code"`
	StateCode   string         `json:"state_code" gorm:"not null;default:''"`
	AdminLevel  int            `json:"admin_level"`
	OsmID       int64          `json:"osm_id"`
	OsmType     string         `json:"osm_type"`
	GridCount   int            `json:"grid_count" gorm:"default:0"`
	Has3D       bool           `json:"has_3d" gorm:"default:false"`
	Enabled     bool           `json:"enabled" gorm:"default:true"`
	CentroidLat float64        `json:"centroid_lat"`
	CentroidLon float64        `json:"centroid_lon"`
	BboxWest    float64        `json:"bbox_west"`
	BboxSouth   float64        `json:"bbox_south"`
	BboxEast    float64        `json:"bbox_east"`
	BboxNorth   float64        `json:"bbox_north"`
	Boundary    datatypes.JSON `json:"boundary" gorm:"type:jsonb"`
	CreatedAt   time.Time      `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time      `json:"updated_at" gorm:"autoUpdateTime"`
}

func (CachedRegion) TableName() string {
	return "cached_regions"
}
