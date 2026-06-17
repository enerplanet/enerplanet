// Package apitoken persists personal access tokens (the apitoken domain).
package apitoken

import (
	"time"

	"gorm.io/gorm"

	backendModels "spatialhub_backend/internal/models"
)

type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

func (s *Store) Create(token *backendModels.APIToken) error {
	return s.db.Create(token).Error
}

// FindByHash returns the token row matching the hash.
func (s *Store) FindByHash(hash string) (*backendModels.APIToken, error) {
	var t backendModels.APIToken
	if err := s.db.Where("token_hash = ?", hash).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) ListByUser(userID string) ([]backendModels.APIToken, error) {
	var tokens []backendModels.APIToken
	err := s.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&tokens).Error
	return tokens, err
}

// Revoke marks one of the user's tokens as revoked.
func (s *Store) Revoke(tokenID uint, userID string) (bool, error) {
	res := s.db.Model(&backendModels.APIToken{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", tokenID, userID).
		Update("revoked_at", time.Now().UTC())
	return res.RowsAffected > 0, res.Error
}

// ActiveUserIDs returns which of the given users hold at least one active token.
func (s *Store) ActiveUserIDs(userIDs []string) (map[string]bool, error) {
	if len(userIDs) == 0 {
		return map[string]bool{}, nil
	}
	var ids []string
	err := s.db.Model(&backendModels.APIToken{}).
		Distinct("user_id").
		Where("user_id IN ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", userIDs, time.Now().UTC()).
		Pluck("user_id", &ids).Error
	if err != nil {
		return nil, err
	}
	active := make(map[string]bool, len(ids))
	for _, id := range ids {
		active[id] = true
	}
	return active, nil
}

// TouchLastUsed records token usage, at most once per minute.
func (s *Store) TouchLastUsed(tokenID uint) error {
	return s.db.Model(&backendModels.APIToken{}).
		Where("id = ? AND (last_used_at IS NULL OR last_used_at < ?)", tokenID, time.Now().UTC().Add(-time.Minute)).
		Update("last_used_at", time.Now().UTC()).Error
}
