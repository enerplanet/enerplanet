package models

import (
	"time"

	"gorm.io/datatypes"
)

// Building heat profile status values. A row starts pending when a
// resolution run begins, then moves to exactly one terminal state.
const (
	HeatProfileStatusPending  = "pending"
	HeatProfileStatusResolved = "resolved"
	HeatProfileStatusFailed   = "failed"
)

// BuildingHeatProfile is one building's BuEM-resolved annual energy profile,
// persisted so the frontend reads it without re-running BuEM. hot_water and
// kitchen stay nil until buem-gateway's response contract exposes them.
type BuildingHeatProfile struct {
	ID      uint   `gorm:"primaryKey" json:"id"`
	ModelID uint   `gorm:"not null;index;uniqueIndex:idx_building_heat_profiles_model_osm" json:"model_id"`
	OSMID   string `gorm:"size:255;not null;uniqueIndex:idx_building_heat_profiles_model_osm" json:"osm_id"`

	Status             string  `gorm:"size:32;not null;default:pending;index" json:"status"`
	TabulaVariantCode  *string `gorm:"size:255" json:"tabula_variant_code,omitempty"`
	RefurbishmentLevel string  `gorm:"size:16;not null;default:existing" json:"refurbishment_level"`

	HeatingKwhA     *float64 `json:"heating_kwh_a,omitempty"`
	CoolingKwhA     *float64 `json:"cooling_kwh_a,omitempty"`
	ElectricityKwhA *float64 `json:"electricity_kwh_a,omitempty"`
	HotWaterKwhA    *float64 `json:"hot_water_kwh_a,omitempty"`
	KitchenKwhA     *float64 `json:"kitchen_kwh_a,omitempty"`

	Profile      datatypes.JSON `gorm:"type:jsonb" json:"profile,omitempty"`
	ErrorMessage *string        `json:"error_message,omitempty"`

	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (BuildingHeatProfile) TableName() string {
	return "building_heat_profiles"
}
