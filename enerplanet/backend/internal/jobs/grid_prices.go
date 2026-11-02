package jobs

import (
	"encoding/json"
	"errors"
	"fmt"

	"spatialhub_backend/internal/geo"
	"spatialhub_backend/internal/models"

	"gorm.io/gorm"
)

// gridPrices are the electricity prices a run buys and sells at, ct/kWh.
type gridPrices struct {
	ImportCt float64
	ExportCt float64
}

// modelPriceOverride is config.electricity_prices: the model's own prices,
// each nil where the country default applies.
type modelPriceOverride struct {
	ImportCt *float64 `json:"import_ct_per_kwh"`
	ExportCt *float64 `json:"export_ct_per_kwh"`
}

// gridPriceStore reads the country defaults and records the prices a run
// used. Satisfied by *GridPriceStore; faked in tests.
type gridPriceStore interface {
	Default(country string) (models.GridElectricityPrice, error)
	RecordUsed(modelID uint, prices gridPrices) error
}

// GridPriceStore is the database-backed gridPriceStore.
type GridPriceStore struct {
	db *gorm.DB
}

// NewGridPriceStore returns a GridPriceStore on db.
func NewGridPriceStore(db *gorm.DB) *GridPriceStore {
	return &GridPriceStore{db: db}
}

// Default returns the country's default prices, or the fallback row when the
// country has none.
func (s *GridPriceStore) Default(country string) (models.GridElectricityPrice, error) {
	var row models.GridElectricityPrice
	for _, key := range []string{geo.NormalizeCountry(country), models.GridPriceFallbackCountry} {
		err := s.db.Where("country = ?", key).First(&row).Error
		if err == nil {
			return row, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return row, fmt.Errorf("load grid prices for %q: %w", key, err)
		}
	}
	return row, fmt.Errorf("no grid prices for %q and no %q row", country, models.GridPriceFallbackCountry)
}

// RecordUsed stores the prices on the model's Calliope-leg MEME run, which
// the results view reads.
func (s *GridPriceStore) RecordUsed(modelID uint, prices gridPrices) error {
	return s.db.Model(&models.ModelMemeRun{}).
		Where("model_id = ? AND leg = ?", modelID, models.MemeLegCalliope).
		Updates(map[string]interface{}{"grid_import_ct_per_kwh": prices.ImportCt, "grid_export_ct_per_kwh": prices.ExportCt}).Error
}

// mergeGridPrices applies the model's own prices from its config over the
// country default and validates the result.
func mergeGridPrices(def models.GridElectricityPrice, config json.RawMessage) (gridPrices, error) {
	prices := gridPrices{ImportCt: def.ImportCtPerKWh, ExportCt: def.ExportCtPerKWh}
	var cfg struct {
		Prices *modelPriceOverride `json:"electricity_prices"`
	}
	if len(config) > 0 {
		if err := json.Unmarshal(config, &cfg); err != nil {
			return prices, fmt.Errorf("read electricity_prices from model config: %w", err)
		}
	}
	if cfg.Prices != nil && cfg.Prices.ImportCt != nil {
		prices.ImportCt = *cfg.Prices.ImportCt
	}
	if cfg.Prices != nil && cfg.Prices.ExportCt != nil {
		prices.ExportCt = *cfg.Prices.ExportCt
	}
	return prices, models.ValidateGridPrices(prices.ImportCt, prices.ExportCt)
}

// applyGridPrices sets the prices on every transformer node of the topology,
// in EUR/kWh, where the T1K mapping reads them for the grid trade.
func applyGridPrices(topology []interface{}, prices gridPrices) {
	for _, item := range topology {
		conn, _ := item.(map[string]interface{})
		for _, end := range []string{"from", "to"} {
			feature, _ := conn[end].(map[string]interface{})
			props, _ := feature["properties"].(map[string]interface{})
			if props["feature_type"] == "TopologyNode" {
				props["grid_import_price"] = prices.ImportCt / 100
				props["grid_export_price"] = prices.ExportCt / 100
			}
		}
	}
}
