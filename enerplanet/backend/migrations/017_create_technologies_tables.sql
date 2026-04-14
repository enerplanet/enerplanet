-- Migration: Create technologies and technology_constraints tables
-- Created: 2025-12-08
-- Description: Energy technology definitions and their configurable parameters

BEGIN;

-- 1) technologies table - stores energy technology definitions
CREATE TABLE IF NOT EXISTS technologies (
    id SERIAL PRIMARY KEY,

    -- Technology identification
    key VARCHAR(255) NOT NULL,
    alias VARCHAR(255) NOT NULL,
    icon VARCHAR(100),
    description TEXT,

    -- User reference (NULL for default/system technologies)
    user_id VARCHAR(255),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for technologies
CREATE INDEX IF NOT EXISTS idx_technologies_key ON technologies(key);
CREATE INDEX IF NOT EXISTS idx_technologies_user_id ON technologies(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_technologies_unique_key_user ON technologies(key, COALESCE(user_id, ''));

-- Comments
COMMENT ON TABLE technologies IS 'Energy technology definitions (solar, wind, battery, etc.)';
COMMENT ON COLUMN technologies.key IS 'Unique identifier for the technology (e.g., pv_supply, battery_storage)';
COMMENT ON COLUMN technologies.alias IS 'Human-readable name for display';
COMMENT ON COLUMN technologies.icon IS 'Icon name for UI display (lucide-react icon name)';
COMMENT ON COLUMN technologies.user_id IS 'NULL for system defaults, user_id for custom user technologies';

-- 2) technology_constraints table - stores configurable parameters for each technology
CREATE TABLE IF NOT EXISTS technology_constraints (
    id SERIAL PRIMARY KEY,

    -- Constraint identification
    key VARCHAR(255) NOT NULL,
    alias VARCHAR(255) NOT NULL,
    description TEXT,

    -- Value configuration
    unit VARCHAR(100),
    default_value DOUBLE PRECISION,
    value DOUBLE PRECISION,
    min_value DOUBLE PRECISION,
    max_value DOUBLE PRECISION,
    required BOOLEAN DEFAULT TRUE,

    -- Special fields
    osm_based_value VARCHAR(255),
    relation_data JSONB,
    options JSONB,

    -- Foreign key to technology
    technology_id INTEGER NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for technology_constraints
CREATE INDEX IF NOT EXISTS idx_technology_constraints_technology_id ON technology_constraints(technology_id);
CREATE INDEX IF NOT EXISTS idx_technology_constraints_key ON technology_constraints(key);

-- Comments
COMMENT ON TABLE technology_constraints IS 'Configurable parameters/constraints for each technology';
COMMENT ON COLUMN technology_constraints.key IS 'Parameter key (e.g., cont_energy_cap_max)';
COMMENT ON COLUMN technology_constraints.alias IS 'Human-readable parameter name';
COMMENT ON COLUMN technology_constraints.unit IS 'Unit of measurement (kW, %, EUR/kWh, etc.)';
COMMENT ON COLUMN technology_constraints.default_value IS 'Default value for the parameter';
COMMENT ON COLUMN technology_constraints.min_value IS 'Minimum allowed value';
COMMENT ON COLUMN technology_constraints.max_value IS 'Maximum allowed value (NULL for infinity)';
COMMENT ON COLUMN technology_constraints.osm_based_value IS 'Field name for OSM-derived values';
COMMENT ON COLUMN technology_constraints.relation_data IS 'JSON data for related entities (e.g., wind turbine types)';
COMMENT ON COLUMN technology_constraints.options IS 'JSON array of options for select-type constraints';

COMMIT;
