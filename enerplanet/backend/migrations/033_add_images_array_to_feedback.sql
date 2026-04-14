-- Migration: Add multi-image support to feedbacks table
-- Stores multiple images as a JSON array in addition to the legacy single-image columns

ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS images TEXT;
