-- Migration: store a Model Builder session beside its model (the T18 artefact).
-- Created: 2026-11
-- Description: One row per model, the same shape as model_meme_runs. The row *is* the artefact the
-- core already produces: the workflow reference, the projection and the base it was replayed from,
-- the applied log, the redo tail, the cursor and a fingerprint of the projection.
--
-- Loading adopts the stored projection as-is — no replay — and checks it against `fingerprint`;
-- replay stays the recovery path, not the load path. The transaction log lives in JSONB on purpose:
-- its shape belongs to the client that writes it, so a new transaction field costs a client change
-- and no migration.
CREATE TABLE IF NOT EXISTS model_sessions (
    model_id INTEGER PRIMARY KEY,
    workflow_id VARCHAR(255) NOT NULL,
    workflow_version INTEGER NOT NULL,
    initial JSONB NOT NULL,
    projection JSONB NOT NULL,
    log JSONB NOT NULL,
    discarded JSONB NOT NULL,
    cursor INTEGER NOT NULL,
    fingerprint VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_model_sessions_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    CONSTRAINT chk_model_sessions_cursor CHECK (cursor >= 0)
);

CREATE INDEX IF NOT EXISTS idx_model_sessions_workflow ON model_sessions(workflow_id);

COMMENT ON TABLE model_sessions IS 'The Model Builder session for a model: the T18 artefact (projection, log, cursor, redo tail)';
COMMENT ON COLUMN model_sessions.initial IS 'The projection the session started from — the base replay needs';
COMMENT ON COLUMN model_sessions.projection IS 'The projection at cursor — adopted on load without replay';
COMMENT ON COLUMN model_sessions.log IS 'The applied prefix of transactions (revisions 1..cursor)';
COMMENT ON COLUMN model_sessions.discarded IS 'The redo tail (revisions cursor+1..), so redo survives a reload';
COMMENT ON COLUMN model_sessions.cursor IS 'How many transactions of the log are applied';
COMMENT ON COLUMN model_sessions.fingerprint IS 'Fingerprint of projection; a mismatch makes the loader replay the log instead';
