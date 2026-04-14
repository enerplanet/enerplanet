-- Add has3_d column to cached_regions for 3D building data availability indicator
-- GORM maps Go field Has3D to snake_case has3_d (not has_3d)
ALTER TABLE cached_regions ADD COLUMN IF NOT EXISTS has3_d BOOLEAN DEFAULT FALSE;
