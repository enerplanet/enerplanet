-- Migration: the workflows the Model Builder can run.
-- Created: 2026-11
-- Description: One row per workflow. The document is stored whole in JSONB, the same way a session
-- is: its shape belongs to the client that writes it, so a new node field costs a client change and
-- no migration.
--
-- `workflow_id` is the document's own name and the only reference anything else holds — a session
-- records the workflow it was built against by that string (`model_sessions.workflow_id`), which is
-- why it is UNIQUE and why it, not the serial, is what the API addresses.
CREATE TABLE IF NOT EXISTS workflows (
    id          SERIAL PRIMARY KEY,
    workflow_id VARCHAR(255) NOT NULL UNIQUE,
    version     INTEGER NOT NULL,
    label       VARCHAR(255) NOT NULL,
    definition  JSONB NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_workflows_version CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_one_default ON workflows (is_default) WHERE is_default;

COMMENT ON TABLE workflows IS 'Model Builder workflows: a linear flow definition per row';
COMMENT ON COLUMN workflows.workflow_id IS 'The definition''s own id — the name sessions reference';
COMMENT ON COLUMN workflows.definition IS 'The whole workflow document, as the client writes it';
COMMENT ON COLUMN workflows.is_default IS 'The seeded default; at most one row, enforced by a partial unique index';
