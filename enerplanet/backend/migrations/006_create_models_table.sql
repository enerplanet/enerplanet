-- Migration: Create fire Simulation models table
-- Created: 2025-10-16
-- Description: Clean schema for fire Simulation assessment models with workspace reference and polygon coordinates

BEGIN;

-- 1) models table
CREATE TABLE IF NOT EXISTS models (
    id SERIAL PRIMARY KEY,

    -- User and workspace references
    user_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,

    -- Model metadata
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',

    -- Polygon coordinates (stored as GeoJSON)
    coordinates JSONB,

    -- Location metadata
    region VARCHAR(255),
    country VARCHAR(255),
    buffer_distance INTEGER DEFAULT 500,

    -- Assessment period
    from_date TIMESTAMP NOT NULL,
    to_date TIMESTAMP NOT NULL,

    -- Model configuration and results
    config JSONB,
    results JSONB,

    -- External service references
    session_id BIGINT,
    callback_url TEXT,

    -- Group and versioning
    group_id INTEGER,
    parent_model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
    is_copy BOOLEAN DEFAULT FALSE,

    -- Activation status
    is_active BOOLEAN DEFAULT TRUE,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Add calculation timing columns if they don't exist (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'models' AND column_name = 'calculation_started_at') THEN
        ALTER TABLE models ADD COLUMN calculation_started_at TIMESTAMP;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'models' AND column_name = 'calculation_completed_at') THEN
        ALTER TABLE models ADD COLUMN calculation_completed_at TIMESTAMP;
    END IF;
END $$;

-- Status constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_model_status') THEN
        ALTER TABLE models
          ADD CONSTRAINT chk_model_status
          CHECK (status IN ('draft', 'queue', 'running', 'completed', 'published', 'failed', 'cancelled'));
    END IF;
END$$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id);
CREATE INDEX IF NOT EXISTS idx_models_user_email ON models(user_email);
CREATE INDEX IF NOT EXISTS idx_models_workspace_id ON models(workspace_id);
CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);
CREATE INDEX IF NOT EXISTS idx_models_created_at ON models(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_models_group_id ON models(group_id);
CREATE INDEX IF NOT EXISTS idx_models_parent_model_id ON models(parent_model_id);
CREATE INDEX IF NOT EXISTS idx_models_session_id ON models(session_id);

-- GIN index for JSONB fields for efficient querying
CREATE INDEX IF NOT EXISTS idx_models_coordinates_gin ON models USING GIN (coordinates);
CREATE INDEX IF NOT EXISTS idx_models_config_gin ON models USING GIN (config);
CREATE INDEX IF NOT EXISTS idx_models_results_gin ON models USING GIN (results);

-- Soft delete support
CREATE INDEX IF NOT EXISTS idx_models_deleted_at ON models(deleted_at);

-- Comments
COMMENT ON TABLE models IS 'Fire Simulation assessment models with polygon coordinates and workspace references';
COMMENT ON COLUMN models.coordinates IS 'GeoJSON format polygon coordinates';
COMMENT ON COLUMN models.workspace_id IS 'Reference to workspace for sharing models';
COMMENT ON COLUMN models.session_id IS 'External calculation service session ID';
COMMENT ON COLUMN models.callback_url IS 'URL for calculation service callbacks';
COMMENT ON COLUMN models.group_id IS 'Group ID for versioned models';
COMMENT ON COLUMN models.parent_model_id IS 'Parent model for versioning';
COMMENT ON COLUMN models.is_copy IS 'Indicates if this is a copied/versioned model';

COMMIT;
