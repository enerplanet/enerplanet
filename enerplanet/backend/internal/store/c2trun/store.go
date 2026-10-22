// Package c2trun persists the City2TABULA pipeline run recorded for each
// model (internal/models.ModelCity2TabulaRun).
package c2trun

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"spatialhub_backend/internal/models"
)

// Store handles database operations for recorded City2TABULA runs.
type Store struct {
	db *gorm.DB
}

// NewStore creates a new c2trun Store.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// Save records run as the model's current run, replacing an earlier one.
func (s *Store) Save(modelID uint, runID, country, status string) error {
	row := models.ModelCity2TabulaRun{ModelID: modelID, RunID: runID, Country: country, Status: status}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "model_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"run_id", "country", "status", "error", "updated_at"}),
	}).Create(&row).Error
}

// UpdateStatus records a status poll result for the model's run.
func (s *Store) UpdateStatus(modelID uint, status, errMsg string) error {
	updates := map[string]interface{}{"status": status}
	if errMsg != "" {
		updates["error"] = errMsg
	}
	return s.db.Model(&models.ModelCity2TabulaRun{}).Where("model_id = ?", modelID).Updates(updates).Error
}

// Get returns the model's recorded run, or nil when none was recorded.
func (s *Store) Get(modelID uint) (*models.ModelCity2TabulaRun, error) {
	var row models.ModelCity2TabulaRun
	err := s.db.Where("model_id = ?", modelID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}
