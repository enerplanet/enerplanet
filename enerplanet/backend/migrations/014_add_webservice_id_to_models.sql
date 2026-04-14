-- Add webservice_id to models table to track which webservice is processing the model
ALTER TABLE models ADD COLUMN IF NOT EXISTS webservice_id INTEGER REFERENCES webservice_instances(id);
CREATE INDEX IF NOT EXISTS idx_models_webservice_id ON models(webservice_id);
