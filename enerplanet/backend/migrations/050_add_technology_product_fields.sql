-- Migration: technology products
-- Created: 2026-10-18
-- Description: several products per technology type. type is the technology
-- a product provides (the key a building's techs and the payload use); key
-- stays the product's own unique key. Existing rows keep type = key.

BEGIN;

ALTER TABLE technologies ADD COLUMN IF NOT EXISTS type VARCHAR(255);
UPDATE technologies SET type = key WHERE type IS NULL;
ALTER TABLE technologies ALTER COLUMN type SET NOT NULL;

ALTER TABLE technologies
    ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(255),
    ADD COLUMN IF NOT EXISTS model VARCHAR(255),
    ADD COLUMN IF NOT EXISTS datasheet_url TEXT,
    ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS idx_technologies_type ON technologies(type);

COMMIT;
