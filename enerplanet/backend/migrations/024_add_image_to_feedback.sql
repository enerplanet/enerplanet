-- Migration: Add image support to feedbacks table
-- Allows users to attach screenshots to their feedback submissions

ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS image_path VARCHAR(500);
ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS image_mime_type VARCHAR(100);
ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS image_size BIGINT;

-- Create index on image_path for faster lookups when checking if feedback has image
CREATE INDEX IF NOT EXISTS idx_feedbacks_image_path ON feedbacks(image_path) WHERE image_path IS NOT NULL;
