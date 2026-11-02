package models

import (
	"fmt"
	"time"
)

// GridPriceFallbackCountry is the row that applies to a country without its own.
const GridPriceFallbackCountry = "other"

// GridElectricityPrice is an administrator-managed default price for buying
// electricity from the grid and the feed-in tariff for selling it back.
type GridElectricityPrice struct {
	Country        string    `gorm:"primaryKey;size:64" json:"country"`
	ImportCtPerKWh float64   `gorm:"column:import_ct_per_kwh;not null" json:"import_ct_per_kwh"`
	ExportCtPerKWh float64   `gorm:"column:export_ct_per_kwh;not null" json:"export_ct_per_kwh"`
	Source         string    `gorm:"not null;default:''" json:"source"`
	UpdatedBy      *string   `json:"updated_by,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// TableName returns the table backing GridElectricityPrice.
func (GridElectricityPrice) TableName() string {
	return "grid_electricity_prices"
}

// ValidateGridPrices rejects prices the optimiser cannot use sensibly: a free
// or negative purchase price, a negative feed-in tariff, or a feed-in tariff
// above the purchase price, which would make buying to sell back profitable.
func ValidateGridPrices(importCt, exportCt float64) error {
	if importCt <= 0 {
		return fmt.Errorf("purchase price must be above 0 ct/kWh, got %g", importCt)
	}
	if exportCt < 0 {
		return fmt.Errorf("feed-in tariff must not be negative, got %g ct/kWh", exportCt)
	}
	if exportCt > importCt {
		return fmt.Errorf("feed-in tariff %g ct/kWh is above the purchase price %g ct/kWh", exportCt, importCt)
	}
	return nil
}
