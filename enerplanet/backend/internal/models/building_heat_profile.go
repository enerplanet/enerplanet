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
// persisted so the frontend reads it without re-running BuEM.
//
// The *KwhA totals are annual kWh, except KitchenKwhA which is kWh_gas: BuEM
// models cooking as a separate gas fuel channel, so it must not be summed
// with the electric/thermal vectors as if it were the same energy carrier.
// HotWaterKwhA/KitchenKwhA are nil for results produced by a buem-gateway
// older than 6.1.0, which did not report them.
//
// TODO: KitchenKwhA reads 0 with the v5 request contract. BuEM only reports
// gas cooking energy when the request sets cooking_carrier to "gas"; v5 has
// no such field, so every request gets the "electric" default (cooking then
// sits inside ElectricityKwhA). Send cooking_carrier once buem-gateway's
// request schema exposes it.
type BuildingHeatProfile struct {
	ID      uint   `gorm:"primaryKey" json:"id"`
	ModelID uint   `gorm:"not null;index;uniqueIndex:idx_building_heat_profiles_model_osm" json:"model_id"`
	OSMID   string `gorm:"size:255;not null;uniqueIndex:idx_building_heat_profiles_model_osm" json:"osm_id"`

	Status            string  `gorm:"size:32;not null;default:pending;index" json:"status"`
	TabulaVariantCode *string `gorm:"size:255" json:"tabula_variant_code,omitempty"`
	// BuildingType is what run_buem sent BuEM: a TABULA residential type
	// (SFH/TH/MFH/AB) or a service id (bakery, office, ...). For a service
	// building BuEM does not model hot water or cooking: HotWaterKwhA and
	// KitchenKwhA are then 0 by construction, not measured.
	BuildingType       *string `gorm:"size:32" json:"building_type,omitempty"`
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
