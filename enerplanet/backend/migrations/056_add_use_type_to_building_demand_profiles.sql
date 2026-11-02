-- A building's use and its source (user, 3d or osm), set by each analysis run.
ALTER TABLE building_demand_profiles
    ADD COLUMN IF NOT EXISTS use_type VARCHAR(64),
    ADD COLUMN IF NOT EXISTS use_source VARCHAR(8);
