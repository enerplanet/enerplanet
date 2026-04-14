-- Add 'processing' to the allowed model status values
ALTER TABLE models DROP CONSTRAINT IF EXISTS chk_model_status;
ALTER TABLE models ADD CONSTRAINT chk_model_status CHECK (status IN ('draft', 'queue', 'running', 'processing', 'completed', 'published', 'failed', 'cancelled', 'modified'));
