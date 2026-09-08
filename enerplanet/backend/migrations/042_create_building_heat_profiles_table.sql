-- Create building_heat_profiles table: one row per (model_id, osm_id),
-- holding the BuEM-resolved annual energy profile so the frontend can read
-- it without re-running BuEM.
CREATE TABLE IF NOT EXISTS building_heat_profiles (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL,
    osm_id VARCHAR(255) NOT NULL,

    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    tabula_variant_code VARCHAR(255),
    refurbishment_level VARCHAR(16) NOT NULL DEFAULT 'existing',

    -- Annual totals in kWh. hot_water_kwh_a and kitchen_kwh_a stay NULL until
    -- buem-gateway's response contract exposes them (today it surfaces only
    -- heating/cooling/electricity; BuEM's own dhw_cooking.py already computes
    -- both, they are just not in the gateway's response yet).
    heating_kwh_a DOUBLE PRECISION,
    cooling_kwh_a DOUBLE PRECISION,
    electricity_kwh_a DOUBLE PRECISION,
    hot_water_kwh_a DOUBLE PRECISION,
    kitchen_kwh_a DOUBLE PRECISION,

    -- Full buem-gateway summary block, for anything beyond the annual totals
    -- above (peak loads, energy intensity, etc.) without a schema change.
    profile JSONB,
    error_message TEXT,

    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_building_heat_profiles_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    CONSTRAINT uq_building_heat_profiles_model_osm UNIQUE (model_id, osm_id)
);

CREATE INDEX IF NOT EXISTS idx_building_heat_profiles_model_id ON building_heat_profiles(model_id);
CREATE INDEX IF NOT EXISTS idx_building_heat_profiles_status ON building_heat_profiles(status);
