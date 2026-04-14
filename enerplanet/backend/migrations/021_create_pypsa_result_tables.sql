-- Migration: Create PyPSA results tables
-- Created: 2026-01-05
-- Description: Tables for PyPSA voltage and power flow results

BEGIN;

-- PyPSA bus voltage time series
CREATE TABLE IF NOT EXISTS results_pypsa_voltage (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    bus VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    v_mag_pu DOUBLE PRECISION NOT NULL,
    v_ang DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_pypsa_voltage_model ON results_pypsa_voltage(model_id);
CREATE INDEX IF NOT EXISTS idx_results_pypsa_voltage_location ON results_pypsa_voltage(location);
CREATE INDEX IF NOT EXISTS idx_results_pypsa_voltage_timestep ON results_pypsa_voltage(timestep);

-- PyPSA bus power flow time series
CREATE TABLE IF NOT EXISTS results_pypsa_power (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    bus VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    p DOUBLE PRECISION NOT NULL,
    q DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_pypsa_power_model ON results_pypsa_power(model_id);
CREATE INDEX IF NOT EXISTS idx_results_pypsa_power_location ON results_pypsa_power(location);
CREATE INDEX IF NOT EXISTS idx_results_pypsa_power_timestep ON results_pypsa_power(timestep);

-- PyPSA line loading time series
CREATE TABLE IF NOT EXISTS results_pypsa_line_loading (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    line VARCHAR(255) NOT NULL,
    bus0 VARCHAR(255) NOT NULL,
    bus1 VARCHAR(255) NOT NULL,
    timestep TIMESTAMP NOT NULL,
    p0 DOUBLE PRECISION NOT NULL,
    p1 DOUBLE PRECISION,
    q0 DOUBLE PRECISION,
    q1 DOUBLE PRECISION,
    loading_percent DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_pypsa_line_loading_model ON results_pypsa_line_loading(model_id);
CREATE INDEX IF NOT EXISTS idx_results_pypsa_line_loading_timestep ON results_pypsa_line_loading(timestep);

COMMIT;
