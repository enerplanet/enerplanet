-- Postcodes of a region that have grids, as PyLovo lists them, for searching regions by postcode
ALTER TABLE cached_regions ADD COLUMN IF NOT EXISTS postcodes JSONB;
