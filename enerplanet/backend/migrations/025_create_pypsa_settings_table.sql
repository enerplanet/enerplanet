-- Create PyPSA settings table for storing convergence status
CREATE TABLE IF NOT EXISTS results_pypsa_settings (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL UNIQUE REFERENCES models(id) ON DELETE CASCADE,
    volt_lv VARCHAR(50),
    volt_mv VARCHAR(50),
    trafo_type_mv_lv VARCHAR(100),
    line_type_lv VARCHAR(100),
    line_type_mv VARCHAR(100),
    converged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_pypsa_settings_model_id ON results_pypsa_settings(model_id);
