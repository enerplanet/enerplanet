-- Migration: Create separate result tables like old enerplanet
-- Created: 2026-01-05
-- Description: Separate tables for each result type (capacity factor, costs, energy cap, etc.)

BEGIN;

-- 1) results_capacity_factor - Capacity factor time series per location/connection
CREATE TABLE IF NOT EXISTS results_capacity_factor (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    from_location VARCHAR(255) NOT NULL,
    to_location VARCHAR(255),
    carrier VARCHAR(255) NOT NULL,
    techs VARCHAR(255) NOT NULL,
    timestep TIMESTAMP,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_capacity_factor_model ON results_capacity_factor(model_id);
CREATE INDEX IF NOT EXISTS idx_results_capacity_factor_timestep ON results_capacity_factor(timestep);
CREATE INDEX IF NOT EXISTS idx_results_capacity_factor_carrier ON results_capacity_factor(carrier);

-- 2) results_carrier_prod - Carrier production time series
CREATE TABLE IF NOT EXISTS results_carrier_prod (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    from_location VARCHAR(255) NOT NULL,
    to_location VARCHAR(255),
    carrier VARCHAR(255) NOT NULL,
    techs VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_carrier_prod_model ON results_carrier_prod(model_id);
CREATE INDEX IF NOT EXISTS idx_results_carrier_prod_timestep ON results_carrier_prod(timestep);
CREATE INDEX IF NOT EXISTS idx_results_carrier_prod_carrier ON results_carrier_prod(carrier);

-- 3) results_carrier_con - Carrier consumption time series
CREATE TABLE IF NOT EXISTS results_carrier_con (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    from_location VARCHAR(255) NOT NULL,
    to_location VARCHAR(255),
    carrier VARCHAR(255) NOT NULL,
    techs VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_carrier_con_model ON results_carrier_con(model_id);
CREATE INDEX IF NOT EXISTS idx_results_carrier_con_timestep ON results_carrier_con(timestep);
CREATE INDEX IF NOT EXISTS idx_results_carrier_con_carrier ON results_carrier_con(carrier);

-- 4) results_cost_investment - Investment costs per location/tech
CREATE TABLE IF NOT EXISTS results_cost_investment (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    location VARCHAR(255) NOT NULL,
    costs VARCHAR(255) NOT NULL,
    techs VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_cost_investment_model ON results_cost_investment(model_id);
CREATE INDEX IF NOT EXISTS idx_results_cost_investment_techs ON results_cost_investment(techs);

-- 5) results_cost_var - Variable costs time series
CREATE TABLE IF NOT EXISTS results_cost_var (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    location VARCHAR(255) NOT NULL,
    costs VARCHAR(255) NOT NULL,
    techs VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_cost_var_model ON results_cost_var(model_id);
CREATE INDEX IF NOT EXISTS idx_results_cost_var_timestep ON results_cost_var(timestep);

-- 6) results_cost - Total costs per location pair/tech
CREATE TABLE IF NOT EXISTS results_cost (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    from_location VARCHAR(255) NOT NULL,
    to_location VARCHAR(255),
    costs VARCHAR(255) NOT NULL,
    techs VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_cost_model ON results_cost(model_id);
CREATE INDEX IF NOT EXISTS idx_results_cost_techs ON results_cost(techs);

-- 7) results_energy_cap - Energy capacity per location/tech
CREATE TABLE IF NOT EXISTS results_energy_cap (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    from_location VARCHAR(255) NOT NULL,
    to_location VARCHAR(255),
    tech VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_energy_cap_model ON results_energy_cap(model_id);
CREATE INDEX IF NOT EXISTS idx_results_energy_cap_tech ON results_energy_cap(tech);

-- 8) results_model_capacity_factor - Model-level capacity factors
CREATE TABLE IF NOT EXISTS results_model_capacity_factor (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    carrier VARCHAR(255) NOT NULL,
    techs VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_model_capacity_factor_model ON results_model_capacity_factor(model_id);

-- 9) results_model_levelised_cost - Model-level levelised costs
CREATE TABLE IF NOT EXISTS results_model_levelised_cost (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    carrier VARCHAR(255) NOT NULL,
    costs VARCHAR(255) NOT NULL,
    techs VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_model_levelised_cost_model ON results_model_levelised_cost(model_id);

-- 10) results_model_total_levelised_cost - Model-level total levelised costs
CREATE TABLE IF NOT EXISTS results_model_total_levelised_cost (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    carrier VARCHAR(255) NOT NULL,
    costs VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_model_total_levelised_cost_model ON results_model_total_levelised_cost(model_id);

-- 11) results_coordinates - Location coordinates from results
CREATE TABLE IF NOT EXISTS results_coordinates (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    location VARCHAR(255) NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_coordinates_model ON results_coordinates(model_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_coordinates_model_location ON results_coordinates(model_id, location);

-- 12) results_loc_techs - Location to technologies mapping
CREATE TABLE IF NOT EXISTS results_loc_techs (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    location VARCHAR(255) NOT NULL,
    tech VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_loc_techs_model ON results_loc_techs(model_id);
CREATE INDEX IF NOT EXISTS idx_results_loc_techs_location ON results_loc_techs(location);

-- Comments
COMMENT ON TABLE results_capacity_factor IS 'Capacity factor time series per location/connection';
COMMENT ON TABLE results_carrier_prod IS 'Carrier production time series per location';
COMMENT ON TABLE results_carrier_con IS 'Carrier consumption time series per location';
COMMENT ON TABLE results_cost_investment IS 'Investment costs per location/technology';
COMMENT ON TABLE results_cost_var IS 'Variable costs time series per location/technology';
COMMENT ON TABLE results_cost IS 'Total costs per location pair/technology';
COMMENT ON TABLE results_energy_cap IS 'Energy capacity per location/technology';
COMMENT ON TABLE results_model_capacity_factor IS 'Model-wide (systemwide) capacity factors';
COMMENT ON TABLE results_model_levelised_cost IS 'Model-wide (systemwide) levelised costs';
COMMENT ON TABLE results_model_total_levelised_cost IS 'Model-wide total levelised costs per carrier';
COMMENT ON TABLE results_coordinates IS 'Location coordinates from calculation results';
COMMENT ON TABLE results_loc_techs IS 'Mapping of locations to technologies';

COMMIT;
