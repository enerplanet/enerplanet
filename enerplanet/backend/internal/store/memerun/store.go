// Package memerun persists the TentaCron MEME job recorded for each model
// (internal/models.ModelMemeRun). The stored RunID lets a later dispatch
// resume by id instead of resubmitting, since TentaCron is the durable queue.
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

// Save records runID as the model's current MEME TentaCron job, replacing an
// earlier one.
func (s *Store) Save(modelID uint, runID, status string) error {
	row := models.ModelMemeRun{ModelID: modelID, RunID: runID, Status: status}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "model_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"run_id", "status", "error", "updated_at"}),
	}).Create(&row).Error
}

// UpdateStatus records a status change for the model's MEME run. A non-empty
// errMsg sets the error column; an empty errMsg (a success transition, e.g.
// back to MemeRunStatusCompleted) clears any prior error so a self-healed run
// does not carry a stale failure.
func (s *Store) UpdateStatus(modelID uint, status, errMsg string) error {
	updates := map[string]interface{}{"status": status}
	if errMsg != "" {
		updates["error"] = errMsg
	} else {
		updates["error"] = nil
	}
	return s.db.Model(&models.ModelMemeRun{}).Where("model_id = ?", modelID).Updates(updates).Error
}

// Get returns the model's recorded MEME run, or nil when none was recorded.
func (s *Store) Get(modelID uint) (*models.ModelMemeRun, error) {
	var row models.ModelMemeRun
	err := s.db.Where("model_id = ?", modelID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}