-- Migration: Enable cascade delete for child models
-- Created: 2025-10-16
-- Description: Change parent_model_id foreign key to cascade delete child models when parent is deleted

BEGIN;

-- Drop the existing foreign key constraint
ALTER TABLE models
    DROP CONSTRAINT IF EXISTS models_parent_model_id_fkey;

-- Add the new foreign key constraint with CASCADE delete
ALTER TABLE models
    ADD CONSTRAINT models_parent_model_id_fkey
    FOREIGN KEY (parent_model_id)
    REFERENCES models(id)
    ON DELETE CASCADE;

COMMIT;
