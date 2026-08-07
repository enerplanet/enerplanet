package jobs

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"

	"platform.local/platform/logger"
	"spatialhub_backend/internal/events"
)

// TypeDomainEvent is the asynq task carrying a relayed domain event.
const TypeDomainEvent = "domain_event"

// DomainEventTask is the queue payload for a relayed outbox event.
type DomainEventTask struct {
	EventID     uint            `json:"event_id"`
	EventType   string          `json:"event_type"`
	AggregateID uint            `json:"aggregate_id"`
	UserID      string          `json:"user_id,omitempty"`
	Payload     json.RawMessage `json:"payload,omitempty"`
}

// AsynqEventPublisher publishes outbox events to the asynq queue.
type AsynqEventPublisher struct {
	client *asynq.Client
}

// NewAsynqEventPublisher builds the publisher.
func NewAsynqEventPublisher(client *asynq.Client) *AsynqEventPublisher {
	return &AsynqEventPublisher{client: client}
}

// Publish puts the event on the queue.
func (p *AsynqEventPublisher) Publish(ctx context.Context, ev events.OutboxEvent) error {
	body, err := json.Marshal(DomainEventTask{
		EventID:     ev.ID,
		EventType:   ev.EventType,
		AggregateID: ev.AggregateID,
		UserID:      ev.UserID,
		Payload:     ev.Payload,
	})
	if err != nil {
		return fmt.Errorf("marshal domain event: %w", err)
	}
	_, err = p.client.EnqueueContext(ctx, asynq.NewTask(TypeDomainEvent, body), asynq.Queue("notifications"))
	return err
}

// HandleDomainEvent logs a queued domain event (idempotent).
func HandleDomainEvent(ctx context.Context, t *asynq.Task) error {
	var ev DomainEventTask
	if err := json.Unmarshal(t.Payload(), &ev); err != nil {
		return fmt.Errorf("unmarshal domain event: %w", err)
	}
	log := logger.ForComponent("domain_event")
	switch ev.EventType {
	case events.ModelQueued, events.ModelRunning, events.ModelCompleted, events.ModelFailed:
		log.WithFields(map[string]interface{}{
			"event_id":     ev.EventID,
			"event_type":   ev.EventType,
			"aggregate_id": ev.AggregateID,
			"user_id":      ev.UserID,
		}).Info("domain event")
	default:
		log.Warnf("unhandled domain event type=%s event_id=%d", ev.EventType, ev.EventID)
	}
	return nil
}
