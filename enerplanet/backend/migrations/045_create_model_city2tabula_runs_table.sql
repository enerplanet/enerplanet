-- One City2TABULA pipeline run per model: triggered when the model's polygon
-- is created or changed, so the 3D data is being prepared before the first
-- calculation or per-building request needs it. run_buem polls a recorded
-- run instead of triggering another one for the same area.
CREATE TABLE IF NOT EXISTS model_city2tabula_runs (
    model_id INTEGER PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL,
    country VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_model_city2tabula_runs_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);
