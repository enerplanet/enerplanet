-- Add 'modified' to the model status check constraint
-- When a user edits a failed/completed model, status changes to 'modified'
ALTER TABLE models DROP CONSTRAINT IF EXISTS chk_model_status;
ALTER TABLE models ADD CONSTRAINT chk_model_status CHECK (status IN ('draft', 'queue', 'running', 'completed', 'published', 'failed', 'cancelled', 'modified'));
