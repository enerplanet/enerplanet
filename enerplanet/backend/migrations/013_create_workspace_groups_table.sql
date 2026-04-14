-- Migration: Create workspace_groups table for group-based workspace sharing
CREATE TABLE IF NOT EXISTS workspace_groups (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL,
    group_id VARCHAR(255) NOT NULL,
    group_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_workspace_groups_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    -- Prevent duplicate group assignments to same workspace
    CONSTRAINT unique_workspace_group UNIQUE (workspace_id, group_id)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_workspace_group_workspace ON workspace_groups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_group_group ON workspace_groups(group_id);
