package events

import (
	"context"
	"time"

	"platform.local/platform/logger"
)

// Publisher delivers an outbox event to the async queue.
type Publisher interface {
	Publish(ctx context.Context, ev OutboxEvent) error
}

// Relay publishes pending outbox events
type Relay struct {
	store     *OutboxStore
	publisher Publisher
	batchSize int
	ticker    *time.Ticker
	done      chan struct{}
}

// NewRelay builds a relay.
func NewRelay(store *OutboxStore, publisher Publisher) *Relay {
	return &Relay{store: store, publisher: publisher, batchSize: 100, done: make(chan struct{})}
}

// Start runs the relay loop until Stop is called.
func (r *Relay) Start(interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	r.ticker = time.NewTicker(interval)
	go func() {
		log := logger.ForComponent("outbox_relay")
		log.Infof("outbox relay started interval=%v", interval)
		for {
			select {
			case <-r.done:
				return
			case <-r.ticker.C:
				if err := r.drain(); err != nil {
					log.Errorf("outbox drain failed: %v", err)
				}
			}
		}
	}()
}

// Stop halts the relay loop.
func (r *Relay) Stop() {
	if r.ticker != nil {
		r.ticker.Stop()
	}
	close(r.done)
}

func (r *Relay) drain() error {
	log := logger.ForComponent("outbox_relay")
	pending, err := r.store.FetchPending(r.batchSize)
	if err != nil {
		return err
	}
	if len(pending) == 0 {
		return nil
	}
	ctx := context.Background()
	published := make([]uint, 0, len(pending))
	for i := range pending {
		ev := pending[i]
		if err := r.publisher.Publish(ctx, ev); err != nil {
			// Stop on first failure; rest retry next tick.
			log.Warnf("publish failed event_id=%d type=%s err=%v", ev.ID, ev.EventType, err)
			break
		}
		published = append(published, ev.ID)
	}
	if err := r.store.MarkPublished(published); err != nil {
		return err
	}
	if len(published) > 0 {
		log.Debugf("relayed %d outbox event(s)", len(published))
	}
	return nil
}
