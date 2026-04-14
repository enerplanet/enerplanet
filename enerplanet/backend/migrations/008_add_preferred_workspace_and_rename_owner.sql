-- Add preferred_workspace_id to user_settings

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS preferred_workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL;

-- index
CREATE INDEX IF NOT EXISTS idx_user_settings_preferred_workspace ON user_settings(preferred_workspace_id);

-- comment
COMMENT ON COLUMN user_settings.preferred_workspace_id IS 'Users last selected/preferred workspace for area select operations';

-- Ensure workspace columns have proper comments
COMMENT ON COLUMN workspaces.user_id IS 'Keycloak user ID who owns/created this workspace';
COMMENT ON COLUMN workspaces.user_email IS 'Email of the user who owns this workspace';
