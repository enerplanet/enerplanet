-- Migration: Create model_shares table
-- Created: 2025-10-17
-- Description: Allow direct sharing of models with specific users, independent of workspace membership

BEGIN;

-- Create model_shares table
CREATE TABLE IF NOT EXISTS model_shares (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    permission VARCHAR(32) NOT NULL DEFAULT 'view',
    shared_by VARCHAR(255) NOT NULL,
    shared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permission constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_model_share_permission') THEN
        ALTER TABLE model_shares
          ADD CONSTRAINT chk_model_share_permission
          CHECK (permission IN ('view','edit'));
    END IF;
END$$;

-- Unique constraint: a user can only have one share record per model
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_share_email
  ON model_shares(model_id, email);

-- Partial unique index for registered users
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_share_registered_user
  ON model_shares(model_id, user_id)
  WHERE user_id != '';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_model_shares_model ON model_shares(model_id);
CREATE INDEX IF NOT EXISTS idx_model_shares_user ON model_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_model_shares_email ON model_shares(email);

-- Comments
COMMENT ON TABLE model_shares IS 'Direct sharing of models with specific users';
COMMENT ON COLUMN model_shares.permission IS 'Access level: view (read-only) or edit (can modify)';
COMMENT ON COLUMN model_shares.shared_by IS 'User ID of the person who shared the model';

COMMIT;
