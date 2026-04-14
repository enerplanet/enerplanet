-- Create polygon_limits table to store building limits per access level
CREATE TABLE IF NOT EXISTS polygon_limits (
    id SERIAL PRIMARY KEY,
    access_level VARCHAR(50) NOT NULL UNIQUE,
    building_limit INTEGER NOT NULL DEFAULT 50,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default limits for each access level (0 = unlimited)
INSERT INTO polygon_limits (access_level, building_limit) VALUES
    ('very_low', 50),
    ('intermediate', 100),
    ('manager', 200),
    ('expert', 0)
ON CONFLICT (access_level) DO NOTHING;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_polygon_limits_access_level ON polygon_limits(access_level);
