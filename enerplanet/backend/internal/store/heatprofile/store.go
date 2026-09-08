// Package heatprofile persists each building's BuEM-resolved annual energy
// profile (internal/models.BuildingHeatProfile), one row per (model_id,
// osm_id), so the frontend reads it without re-running BuEM.
package heatprofile

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"spatialhub_backend/internal/models"
)

// Store handles database operations for building heat profiles.
type Store struct {
	db *gorm.DB
}

// NewStore creates a new heatprofile Store.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// ResetForRun marks every osm_id as pending for a new resolution run,
// clearing any previous result - an upsert on (model_id, osm_id), so
// re-running a model's resolution does not accumulate stale rows.
// refurbishmentLevel is the model-level default requested for this run; a
// per-building level, when the frontend sends one, overrides it per row
// before SaveResolved/SaveFailed runs.
func (s *Store) ResetForRun(modelID uint, osmIDs []string, refurbishmentLevel string) error {
	if len(osmIDs) == 0 {
		return nil
	}
	rows := make([]models.BuildingHeatProfile, len(osmIDs))
	for i, osmID := range osmIDs {
		rows[i] = models.BuildingHeatProfile{
			ModelID:            modelID,
			OSMID:              osmID,
			Status:             models.HeatProfileStatusPending,
			RefurbishmentLevel: refurbishmentLevel,
		}
	}
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "model_id"}, {Name: "osm_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"status", "refurbishment_level", "tabula_variant_code",
			"heating_kwh_a", "cooling_kwh_a", "electricity_kwh_a",
			"hot_water_kwh_a", "kitchen_kwh_a", "profile", "error_message",
			"resolved_at", "updated_at",
		}),
	}).CreateInBatches(rows, 100).Error
}

// ResolvedProfile is one building's resolved annual energy totals, plus the
// full buem-gateway summary block for anything beyond them. KitchenKwhA is
// kWh_gas, the other totals kWh - see models.BuildingHeatProfile.
type ResolvedProfile struct {
	TabulaVariantCode  string
	RefurbishmentLevel string
	HeatingKwhA        *float64
	CoolingKwhA        *float64
	ElectricityKwhA    *float64
	HotWaterKwhA       *float64
	KitchenKwhA        *float64
	Profile            []byte // raw JSON, stored as-is
}

// SaveResolved upserts a building's resolved profile.
func (s *Store) SaveResolved(modelID uint, osmID string, p ResolvedProfile) error {
	now := time.Now().UTC()
	row := models.BuildingHeatProfile{
		ModelID:            modelID,
		OSMID:              osmID,
		Status:             models.HeatProfileStatusResolved,
		TabulaVariantCode:  &p.TabulaVariantCode,
		RefurbishmentLevel: p.RefurbishmentLevel,
		HeatingKwhA:        p.HeatingKwhA,
		CoolingKwhA:        p.CoolingKwhA,
		ElectricityKwhA:    p.ElectricityKwhA,
		HotWaterKwhA:       p.HotWaterKwhA,
		KitchenKwhA:        p.KitchenKwhA,
		Profile:            p.Profile,
		ResolvedAt:         &now,
	}
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "model_id"}, {Name: "osm_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"status", "tabula_variant_code", "refurbishment_level",
			"heating_kwh_a", "cooling_kwh_a", "electricity_kwh_a",
			"hot_water_kwh_a", "kitchen_kwh_a",
			"profile", "error_message", "resolved_at", "updated_at",
		}),
	}).Create(&row).Error
}

// SaveFailed upserts a building as unresolvable for this run (no envelope
// match, no weather, or BuEM itself rejected it), with reason recorded for
// the frontend to display - not a job failure, see run_buem's mergeBuemResults.
func (s *Store) SaveFailed(modelID uint, osmID, reason string) error {
	row := models.BuildingHeatProfile{
		ModelID:      modelID,
		OSMID:        osmID,
		Status:       models.HeatProfileStatusFailed,
		ErrorMessage: &reason,
	}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "model_id"}, {Name: "osm_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"status", "error_message", "updated_at"}),
	}).Create(&row).Error
}

// GetByModel returns every building heat profile row for a model.
func (s *Store) GetByModel(modelID uint) ([]models.BuildingHeatProfile, error) {
	var rows []models.BuildingHeatProfile
	err := s.db.Where("model_id = ?", modelID).Find(&rows).Error
	return rows, err
}

// StatusCounts summarizes a model's resolution progress by status.
type StatusCounts struct {
	Pending  int64
	Resolved int64
	Failed   int64
}

// Total is the number of buildings tracked for this model's current run.
func (c StatusCounts) Total() int64 {
	return c.Pending + c.Resolved + c.Failed
}

// GetStatusCounts returns the row-status breakdown for a model, for the poll
// endpoint's progress fields.
func (s *Store) GetStatusCounts(modelID uint) (StatusCounts, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	if err := s.db.Model(&models.BuildingHeatProfile{}).
		Select("status, count(*) as count").
		Where("model_id = ?", modelID).
		Group("status").
		Find(&rows).Error; err != nil {
		return StatusCounts{}, err
	}
	var counts StatusCounts
	for _, r := range rows {
		switch r.Status {
		case models.HeatProfileStatusPending:
			counts.Pending = r.Count
		case models.HeatProfileStatusResolved:
			counts.Resolved = r.Count
		case models.HeatProfileStatusFailed:
			counts.Failed = r.Count
		}
	}
	return counts, nil
}
