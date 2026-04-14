-- Create minimal workspace tables

BEGIN;
CREATE TABLE IF NOT EXISTS workspaces (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    user_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_user_email ON workspaces(user_email);
CREATE INDEX IF NOT EXISTS idx_workspaces_is_default ON workspaces(is_default);

-- at most one default workspace per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_default_workspace_per_user
  ON workspaces(user_id)
  WHERE is_default IS TRUE;

-- workspace_members
CREATE TABLE IF NOT EXISTS workspace_members (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- a user can only be in a workspace once
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_member_user
  ON workspace_members(workspace_id, user_id);

-- indexes
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_email ON workspace_members(email);

-- comments
COMMENT ON TABLE workspaces IS 'Workspaces for organizing and sharing fire Simulation models';
COMMENT ON TABLE workspace_members IS 'Members of a workspace who have access to its models';

COMMIT;
