-- Cache table for storing available regions from PyLovo service
-- Regions are fetched from the external API and cached locally for fast access
CREATE TABLE IF NOT EXISTS cached_regions (
    id SERIAL PRIMARY KEY,
    region_name VARCHAR(255) NOT NULL,
    country VARCHAR(255),
    country_code VARCHAR(10),
    admin_level INTEGER,
    osm_id BIGINT,
    osm_type VARCHAR(50),
    grid_count INTEGER DEFAULT 0,
    centroid_lat DOUBLE PRECISION,
    centroid_lon DOUBLE PRECISION,
    bbox_west DOUBLE PRECISION,
    bbox_south DOUBLE PRECISION,
    bbox_east DOUBLE PRECISION,
    bbox_north DOUBLE PRECISION,
    boundary JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cached_regions_name_country ON cached_regions(region_name, country_code);
CREATE INDEX IF NOT EXISTS idx_cached_regions_country_code ON cached_regions(country_code);
