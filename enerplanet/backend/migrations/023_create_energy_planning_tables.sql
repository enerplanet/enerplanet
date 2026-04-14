-- Migration: Create energy planning result tables
-- Created: 2026-01-15
-- Description: Tables for system balance, unmet demand, resource consumption, and power flow results

BEGIN;

-- 1) results_system_balance - Supply/demand balance time series
CREATE TABLE IF NOT EXISTS results_system_balance (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    carrier VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_system_balance_model ON results_system_balance(model_id);
CREATE INDEX IF NOT EXISTS idx_results_system_balance_location ON results_system_balance(location);
CREATE INDEX IF NOT EXISTS idx_results_system_balance_timestep ON results_system_balance(timestep);

-- 2) results_unmet_demand - Unmet demand time series
CREATE TABLE IF NOT EXISTS results_unmet_demand (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    carrier VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_unmet_demand_model ON results_unmet_demand(model_id);
CREATE INDEX IF NOT EXISTS idx_results_unmet_demand_location ON results_unmet_demand(location);
CREATE INDEX IF NOT EXISTS idx_results_unmet_demand_timestep ON results_unmet_demand(timestep);

-- 3) results_resource_con - Resource consumption time series
CREATE TABLE IF NOT EXISTS results_resource_con (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    location VARCHAR(255) NOT NULL,
    tech VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_resource_con_model ON results_resource_con(model_id);
CREATE INDEX IF NOT EXISTS idx_results_resource_con_location ON results_resource_con(location);
CREATE INDEX IF NOT EXISTS idx_results_resource_con_timestep ON results_resource_con(timestep);

-- 4) results_line_flow - Power flow through transmission lines
CREATE TABLE IF NOT EXISTS results_line_flow (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    line VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    p0 DOUBLE PRECISION NOT NULL,
    p1 DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_line_flow_model ON results_line_flow(model_id);
CREATE INDEX IF NOT EXISTS idx_results_line_flow_line ON results_line_flow(line);
CREATE INDEX IF NOT EXISTS idx_results_line_flow_timestep ON results_line_flow(timestep);

-- 5) results_transformer_flow - Power flow through transformers
CREATE TABLE IF NOT EXISTS results_transformer_flow (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    transformer VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    p0 DOUBLE PRECISION NOT NULL,
    p1 DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_transformer_flow_model ON results_transformer_flow(model_id);
CREATE INDEX IF NOT EXISTS idx_results_transformer_flow_transformer ON results_transformer_flow(transformer);
CREATE INDEX IF NOT EXISTS idx_results_transformer_flow_timestep ON results_transformer_flow(timestep);

-- Comments
COMMENT ON TABLE results_system_balance IS 'System-wide supply/demand balance time series per carrier/location';
COMMENT ON TABLE results_unmet_demand IS 'Unmet demand time series per carrier/location';
COMMENT ON TABLE results_resource_con IS 'Resource consumption time series per technology/location';
COMMENT ON TABLE results_line_flow IS 'Power flow through transmission lines (p0/p1 at each end)';
COMMENT ON TABLE results_transformer_flow IS 'Power flow through transformers (p0/p1 at each end)';

COMMIT;
