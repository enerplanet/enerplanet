-- Add stable state_code key for region cache identity
ALTER TABLE cached_regions ADD COLUMN IF NOT EXISTS state_code VARCHAR(255);

-- Backfill from boundary properties first, fallback to region_name
UPDATE cached_regions
SET state_code = COALESCE(
    NULLIF(TRIM(boundary -> 'properties' ->> 'state_code'), ''),
    NULLIF(TRIM(region_name), '')
)
WHERE state_code IS NULL OR TRIM(state_code) = '';

-- Normalize for deterministic lookups and uniqueness
UPDATE cached_regions
SET state_code = LOWER(TRIM(state_code))
WHERE state_code IS NOT NULL;

UPDATE cached_regions
SET state_code = LOWER(TRIM(region_name))
WHERE state_code IS NULL OR TRIM(state_code) = '';

ALTER TABLE cached_regions ALTER COLUMN state_code SET DEFAULT '';
UPDATE cached_regions SET state_code = '' WHERE state_code IS NULL;
ALTER TABLE cached_regions ALTER COLUMN state_code SET NOT NULL;

-- Keep latest row per (country_code, state_code)
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY country_code, state_code
               ORDER BY updated_at DESC, id DESC
           ) AS rn
    FROM cached_regions
)
DELETE FROM cached_regions
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DROP INDEX IF EXISTS idx_cached_regions_name_country;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cached_regions_country_state ON cached_regions(country_code, state_code);
CREATE INDEX IF NOT EXISTS idx_cached_regions_state_code ON cached_regions(state_code);
