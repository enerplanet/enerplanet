package events

import (
	"time"

	"gorm.io/gorm"
)

// OutboxStore reads and updates outbox rows.
type OutboxStore struct {
	db *gorm.DB
}

// NewOutboxStore builds an outbox store.
func NewOutboxStore(db *gorm.DB) *OutboxStore {
	return &OutboxStore{db: db}
}

// EnqueueTx saves an event inside the caller's transaction.
func EnqueueTx(tx *gorm.DB, ev *OutboxEvent) error {
	if ev == nil {
		return nil
	}
	return tx.Create(ev).Error
}

// FetchPending returns unpublished events in insertion order.
func (s *OutboxStore) FetchPending(limit int) ([]OutboxEvent, error) {
	var rows []OutboxEvent
	err := s.db.
		Where("status = ?", StatusPending).
		Order("id ASC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

// MarkPublished marks the given events as published.
func (s *OutboxStore) MarkPublished(ids []uint) error {
	if len(ids) == 0 {
		return nil
	}
	now := time.Now().UTC()
	return s.db.Model(&OutboxEvent{}).
		Where("id IN ?", ids).
		Updates(map[string]interface{}{"status": StatusPublished, "published_at": now}).Error
}
