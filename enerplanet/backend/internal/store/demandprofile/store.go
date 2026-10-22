// Package demandprofile persists each building's BuEM-resolved annual energy
// profile (internal/models.BuildingDemandProfile), one row per (model_id,
// osm_id), so the frontend reads it without re-running BuEM.
package demandprofile

import (
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"spatialhub_backend/internal/models"
)

// Store handles database operations for building demand profiles.
type Store struct {
	db *gorm.DB
}

// NewStore creates a new demandprofile Store.
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
	rows := make([]models.BuildingDemandProfile, len(osmIDs))
	for i, osmID := range osmIDs {
		rows[i] = models.BuildingDemandProfile{
			ModelID:            modelID,
			OSMID:              osmID,
			Status:             models.DemandProfileStatusPending,
			RefurbishmentLevel: refurbishmentLevel,
		}
	}
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "model_id"}, {Name: "osm_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"status", "refurbishment_level", "tabula_variant_code",
			"heating_kwh_a", "cooling_kwh_a", "electricity_kwh_a",
			"hot_water_kwh_a", "kitchen_kwh_a", "building_type", "profile", "error_message",
			"resolved_at", "updated_at",
		}),
	}).CreateInBatches(rows, 100).Error
}

// ResolvedProfile is one building's resolved annual energy totals, plus the
// full buem-gateway summary block for anything beyond them. KitchenKwhA is
// kWh_gas, the other totals kWh - see models.BuildingDemandProfile.
type ResolvedProfile struct {
	TabulaVariantCode  string
	RefurbishmentLevel string
	BuildingType       string // "" when unknown, stored as NULL
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
	row := models.BuildingDemandProfile{
		ModelID:            modelID,
		OSMID:              osmID,
		Status:             models.DemandProfileStatusResolved,
		TabulaVariantCode:  &p.TabulaVariantCode,
		RefurbishmentLevel: p.RefurbishmentLevel,
		BuildingType:       nilIfEmpty(p.BuildingType),
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
			"status", "tabula_variant_code", "refurbishment_level", "building_type",
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
	row := models.BuildingDemandProfile{
		ModelID:      modelID,
		OSMID:        osmID,
		Status:       models.DemandProfileStatusFailed,
		ErrorMessage: &reason,
	}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "model_id"}, {Name: "osm_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"status", "error_message", "updated_at"}),
	}).Create(&row).Error
}

// SaveShared upserts a building whose 3D building is resolved under the OSM
// way standing, which carries the whole building's demand.
func (s *Store) SaveShared(modelID uint, osmID, standing string) error {
	note := fmt.Sprintf("shares its 3D building with OSM way %s, whose BuEM run covers the whole building", standing)
	row := models.BuildingDemandProfile{
		ModelID:      modelID,
		OSMID:        osmID,
		Status:       models.DemandProfileStatusShared,
		ErrorMessage: &note,
	}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "model_id"}, {Name: "osm_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"status", "error_message", "updated_at"}),
	}).Create(&row).Error
}

// Summary is one building's stored outcome without its hourly profile, plus
// the BuEM inputs the map shows, read from the stored profile's building block.
type Summary struct {
	OSMID              string   `gorm:"column:osm_id"`
	Status             string   `gorm:"column:status"`
	TabulaVariantCode  *string  `gorm:"column:tabula_variant_code"`
	BuildingType       *string  `gorm:"column:building_type"`
	RefurbishmentLevel string   `gorm:"column:refurbishment_level"`
	HeatingKwhA        *float64 `gorm:"column:heating_kwh_a"`
	CoolingKwhA        *float64 `gorm:"column:cooling_kwh_a"`
	ElectricityKwhA    *float64 `gorm:"column:electricity_kwh_a"`
	HotWaterKwhA       *float64 `gorm:"column:hot_water_kwh_a"`
	KitchenKwhA        *float64 `gorm:"column:kitchen_kwh_a"`
	ErrorMessage       *string  `gorm:"column:error_message"`
	NStoreys           *int     `gorm:"column:n_storeys"`
	ARefM2             *float64 `gorm:"column:a_ref_m2"`
	HRoomM             *float64 `gorm:"column:h_room_m"`
}

// GetSummariesByModel returns a model's per-building outcomes. The hourly
// profile (about 130 kB a building) stays in the database; Postgres extracts
// the three inputs from it.
func (s *Store) GetSummariesByModel(modelID uint) ([]Summary, error) {
	var rows []Summary
	err := s.db.Model(&models.BuildingDemandProfile{}).
		Select(`osm_id, status, tabula_variant_code, building_type, refurbishment_level,
			heating_kwh_a, cooling_kwh_a, electricity_kwh_a, hot_water_kwh_a, kitchen_kwh_a, error_message,
			round((profile -> 'building' ->> 'n_storeys')::numeric)::int AS n_storeys,
			(profile -> 'building' -> 'A_ref' ->> 'value')::float8 AS a_ref_m2,
			(profile -> 'building' -> 'h_room' ->> 'value')::float8 AS h_room_m`).
		Where("model_id = ?", modelID).
		Order("osm_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("demand profile summaries of model %d: %w", modelID, err)
	}
	return rows, nil
}

// StatusCounts summarizes a model's resolution progress by status.
type StatusCounts struct {
	Pending  int64
	Resolved int64
	Failed   int64
	Shared   int64
}

// Total is the number of buildings tracked for this model's current run.
func (c StatusCounts) Total() int64 {
	return c.Pending + c.Resolved + c.Failed + c.Shared
}

// GetStatusCounts returns the row-status breakdown for a model, for the poll
// endpoint's progress fields.
func (s *Store) GetStatusCounts(modelID uint) (StatusCounts, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	if err := s.db.Model(&models.BuildingDemandProfile{}).
		Select("status, count(*) as count").
		Where("model_id = ?", modelID).
		Group("status").
		Find(&rows).Error; err != nil {
		return StatusCounts{}, err
	}
	var counts StatusCounts
	for _, r := range rows {
		switch r.Status {
		case models.DemandProfileStatusPending:
			counts.Pending = r.Count
		case models.DemandProfileStatusResolved:
			counts.Resolved = r.Count
		case models.DemandProfileStatusFailed:
			counts.Failed = r.Count
		case models.DemandProfileStatusShared:
			counts.Shared = r.Count
		}
	}
	return counts, nil
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
