-- Add resolution field to models table
ALTER TABLE models ADD COLUMN IF NOT EXISTS resolution INTEGER;

-- Add comment to explain the field
COMMENT ON COLUMN models.resolution IS 'Resolution value for model calculations (default: 60)';
