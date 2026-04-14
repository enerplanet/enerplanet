-- Migration: Update model auto-run default
-- Created: 2025-10-16
-- Description: Ensure models default to manual execution unless explicitly enabled

BEGIN;

ALTER TABLE models
    ALTER COLUMN is_active SET DEFAULT FALSE;

-- Ensure null values are normalised to FALSE
UPDATE models
SET is_active = FALSE
WHERE is_active IS NULL;

COMMIT;
