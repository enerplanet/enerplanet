// Package events: domain events stored in an outbox table.
package events

import (
	"encoding/json"
	"time"
)

// Domain event types for the model lifecycle.
const (
	ModelQueued    = "model.queued"
	ModelRunning   = "model.running"
	ModelCompleted = "model.completed"
	ModelFailed    = "model.failed"
)

// Outbox row statuses.
const (
	StatusPending   = "pending"
	StatusPublished = "published"
)

// OutboxEvent is one stored domain event waiting to be published.
type OutboxEvent struct {
	ID          uint            `gorm:"primaryKey" json:"id"`
	EventType   string          `gorm:"size:64;not null;index" json:"event_type"`
	AggregateID uint            `gorm:"not null;index" json:"aggregate_id"`
	UserID      string          `gorm:"size:255" json:"user_id,omitempty"`
	Payload     json.RawMessage `gorm:"type:jsonb" json:"payload,omitempty"`
	Status      string          `gorm:"size:16;not null;default:'pending';index" json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
	PublishedAt *time.Time      `json:"published_at,omitempty"`
}

func (OutboxEvent) TableName() string { return "outbox_events" }

// NewModelEvent builds a pending model event.
func NewModelEvent(eventType string, modelID uint, userID string, payload any) (*OutboxEvent, error) {
	ev := &OutboxEvent{
		EventType:   eventType,
		AggregateID: modelID,
		UserID:      userID,
		Status:      StatusPending,
		CreatedAt:   time.Now().UTC(),
	}
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		ev.Payload = raw
	}
	return ev, nil
}
