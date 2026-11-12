// Package modelsession persists the modular builder's session for a model
// (internal/models.ModelSession — the artefact the builder writes).
//
// It is deliberately isolated from the legacy model store: the builder owns this table and the
// shape inside it, so a change here can never collide with a legacy model change, and a legacy
// request never pays for these columns.
package modelsession

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"spatialhub_backend/internal/models"
)

// Store reads and writes modular builder sessions.
type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// Get returns the model's session, or (nil, nil) when it has none — "no session" is a normal
// answer, not an error, because every legacy model is in that state.
func (s *Store) Get(modelID uint) (*models.ModelSession, error) {
	var row models.ModelSession
	err := s.db.Where("model_id = ?", modelID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Save upserts the model's session.
//
// Every column is OVERWRITTEN on conflict, deliberately: the artefact is a whole document, not a
// partial patch, so a save that omitted a field would leave the row describing a session that no
// longer exists. created_at is preserved (`updated_at` is left to GORM) so the row keeps the moment
// the session began.
func (s *Store) Save(row *models.ModelSession) error {
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "model_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"workflow_id",
			"workflow_version",
			"initial",
			"projection",
			"log",
			"discarded",
			"cursor",
			"fingerprint",
			"updated_at",
		}),
	}).Create(row).Error
}

// HasSession reports which of the given models carry a session — the light marker a list response
// can ask for without dragging the artefact into it.
func (s *Store) HasSession(modelIDs []uint) (map[uint]bool, error) {
	found := make(map[uint]bool)
	if len(modelIDs) == 0 {
		return found, nil
	}

	var ids []uint
	if err := s.db.Model(&models.ModelSession{}).
		Where("model_id IN ?", modelIDs).
		Pluck("model_id", &ids).Error; err != nil {
		return nil, err
	}

	for _, id := range ids {
		found[id] = true
	}
	return found, nil
}
