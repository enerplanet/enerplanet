-- Add enabled column to cached_regions for region disable/enable functionality
ALTER TABLE cached_regions ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE;
