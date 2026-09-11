-- Migration: Create time-series dataset tables
-- Created: 2026-09-11
-- Description: User-owned time-series datasets with a public flag, a share
-- table granting specific users access, and the data hypertable. Runs against
-- the separate TimescaleDB instance (timeseries DB), not the main spatialai DB.

CREATE EXTENSION IF NOT EXISTS timescaledb;

BEGIN;

-- Datasets: owner reference + public flag + metadata
CREATE TABLE IF NOT EXISTS timeseries_datasets (
    id          SERIAL PRIMARY KEY,
    user_id     VARCHAR(255) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    description VARCHAR(1024),
    public      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_timeseries_datasets_user ON timeseries_datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_timeseries_datasets_public ON timeseries_datasets(public);

-- Shares: which users may access a non-public dataset
CREATE TABLE IF NOT EXISTS timeseries_dataset_shares (
    id          SERIAL PRIMARY KEY,
    dataset_id  INTEGER NOT NULL REFERENCES timeseries_datasets(id) ON DELETE CASCADE,
    user_id     VARCHAR(255) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    permission  VARCHAR(32) NOT NULL DEFAULT 'view',
    shared_by   VARCHAR(255) NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permission constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_timeseries_dataset_share_permission') THEN
        ALTER TABLE timeseries_dataset_shares
          ADD CONSTRAINT chk_timeseries_dataset_share_permission
          CHECK (permission IN ('view','edit'));
    END IF;
END$$;

-- A user can only have one share record per dataset
CREATE UNIQUE INDEX IF NOT EXISTS uq_timeseries_dataset_share
  ON timeseries_dataset_shares(dataset_id, user_id);

CREATE INDEX IF NOT EXISTS idx_timeseries_dataset_shares_user ON timeseries_dataset_shares(user_id);

-- Data points, stored in a TimescaleDB hypertable partitioned on timestamp
CREATE TABLE IF NOT EXISTS timeseries_data (
    dataset_id INTEGER NOT NULL REFERENCES timeseries_datasets(id) ON DELETE CASCADE,
    timestamp  TIMESTAMPTZ NOT NULL,
    value      DOUBLE PRECISION NOT NULL
);

-- Convert to a hypertable partitioned on timestamp. if_not_exists makes this
-- idempotent so re-running the migration is safe.
SELECT create_hypertable('timeseries_data', 'timestamp', if_not_exists => TRUE);

-- Query pattern: all points for a dataset within a time range
CREATE INDEX IF NOT EXISTS idx_timeseries_data_dataset_time
  ON timeseries_data(dataset_id, timestamp DESC);

COMMENT ON TABLE timeseries_datasets IS 'User-owned time-series datasets';
COMMENT ON COLUMN timeseries_datasets.public IS 'When true, any authenticated user can read the dataset';
COMMENT ON TABLE timeseries_dataset_shares IS 'Per-user access grants to non-public datasets';
COMMENT ON TABLE timeseries_data IS 'Time-series samples per dataset (TimescaleDB hypertable)';

COMMIT;
