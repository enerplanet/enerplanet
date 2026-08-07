-- Transactional outbox for domain events. Lifecycle transitions write an
-- event row in the same transaction as the state change; a relay publishes
-- pending rows to the async queue and marks them published. This decouples
-- producers (the model lifecycle) from reactors (notifications, metrics, audit).
CREATE TABLE IF NOT EXISTS outbox_events (
    id            BIGSERIAL PRIMARY KEY,
    event_type    VARCHAR(64)  NOT NULL,
    aggregate_id  BIGINT       NOT NULL,
    user_id       VARCHAR(255),
    payload       JSONB,
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);

-- Relay polls pending rows in id order; keep that lookup cheap.
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
    ON outbox_events (status, id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
    ON outbox_events (aggregate_id);
