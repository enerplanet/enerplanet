-- 036_create_coordinate_country_cache.sql
-- Cache table for backend-authoritative country resolution.
-- Keys are rounded coordinates (ROUND(lat*100), ROUND(lon*100)) giving ~1.1 km buckets.

CREATE TABLE IF NOT EXISTS coordinate_country_cache (
    lat_key    INTEGER      NOT NULL,
    lon_key    INTEGER      NOT NULL,
    country    VARCHAR(64)  NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (lat_key, lon_key)
);

CREATE INDEX IF NOT EXISTS idx_coord_cache_country ON coordinate_country_cache(country);
