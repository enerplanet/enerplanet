-- Migration: Remove buffer_distance column from models table
-- Created: 2025-12-08
-- Description: Remove buffer_distance as it's no longer used in the energy simulation platform

BEGIN;

-- Drop buffer_distance column if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'models' AND column_name = 'buffer_distance') THEN
        ALTER TABLE models DROP COLUMN buffer_distance;
    END IF;
END $$;

-- Update table comment to reflect new purpose
COMMENT ON TABLE models IS 'Energy simulation models with polygon coordinates and workspace references';

COMMIT;
