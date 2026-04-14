-- User Settings table for storing user preferences (Keycloak-backed user_id)
-- One row per user with specific columns for each setting type
CREATE TABLE IF NOT EXISTS user_settings (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255), -- For easy identification, not used as primary key
    
    -- Privacy and Tour Settings
    privacy_accepted BOOLEAN DEFAULT FALSE,
    product_tour_completed BOOLEAN DEFAULT FALSE,
    area_select_tour_completed BOOLEAN DEFAULT FALSE,
    onboarding_completed BOOLEAN DEFAULT FALSE,
    
    -- Map Settings (stored as JSON)
    map_location JSONB,
    
    -- Weather Settings (stored as JSON)
    weather_location JSONB,
    
    -- Theme and UI Preferences
    theme VARCHAR(20) DEFAULT 'system', -- 'light', 'dark', 'system'
    language VARCHAR(10) DEFAULT 'en', -- 'en', 'es', 'de', etc.
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for user_settings
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_email ON user_settings(email);

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
BEFORE UPDATE ON user_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
