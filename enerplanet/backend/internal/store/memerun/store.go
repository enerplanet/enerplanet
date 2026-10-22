// Package memerun persists the TentaCron MEME job recorded for each model's
// leg (internal/models.ModelMemeRun). The stored RunID lets a later dispatch
// resume by id instead of resubmitting, since TentaCron is the durable queue.
// One row per (model, leg): the Calliope and PyPSA legs never share a run
// record, so a PyPSA dispatch can't resume (or overwrite) the Calliope leg's
// job by id.
package memerun

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"spatialhub_backend/internal/models"
)

// Store handles database operations for recorded MEME runs.
type Store struct {
	db *gorm.DB
}

// NewStore creates a new memerun Store.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// Save records runID as the model's Calliope-leg MEME TentaCron job, replacing
// an earlier one. Kept for the callers that don't think in legs (the Calliope
// dispatch path); SaveLeg is the general form.
func (s *Store) Save(modelID uint, runID, status string) error {
	return s.SaveLeg(modelID, models.MemeLegCalliope, runID, status)
}

// SaveLeg records runID as the model's leg MEME TentaCron job, replacing an
// earlier one for that leg.
func (s *Store) SaveLeg(modelID uint, leg, runID, status string) error {
	row := models.ModelMemeRun{ModelID: modelID, Leg: leg, RunID: runID, Status: status}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "model_id"}, {Name: "leg"}},
		DoUpdates: clause.AssignmentColumns([]string{"run_id", "status", "error", "updated_at"}),
	}).Create(&row).Error
}

// UpdateStatus records a status change for the model's Calliope-leg MEME run.
func (s *Store) UpdateStatus(modelID uint, status, errMsg string) error {
	return s.UpdateStatusLeg(modelID, models.MemeLegCalliope, status, errMsg)
}

// UpdateStatusLeg records a status change for the model's leg MEME run. A
// non-empty errMsg sets the error column; an empty errMsg (a success
// transition) clears any prior error so a self-healed run does not carry a
// stale failure.
func (s *Store) UpdateStatusLeg(modelID uint, leg, status, errMsg string) error {
	updates := map[string]interface{}{"status": status}
	if errMsg != "" {
		updates["error"] = errMsg
	} else {
		updates["error"] = nil
	}
	return s.db.Model(&models.ModelMemeRun{}).
		Where("model_id = ? AND leg = ?", modelID, leg).
		Updates(updates).Error
}

// Get returns the model's Calliope-leg MEME run, or nil when none was recorded.
func (s *Store) Get(modelID uint) (*models.ModelMemeRun, error) {
	return s.GetLeg(modelID, models.MemeLegCalliope)
}

// GetLeg returns the model's leg MEME run, or nil when none was recorded.
func (s *Store) GetLeg(modelID uint, leg string) (*models.ModelMemeRun, error) {
	var row models.ModelMemeRun
	err := s.db.Where("model_id = ? AND leg = ?", modelID, leg).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}