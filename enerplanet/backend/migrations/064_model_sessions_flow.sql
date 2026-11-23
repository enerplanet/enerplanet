-- Migration: the Model Builder session carries the placed flow, not a cursor and a redo tail.
-- Created: 2026-11
-- Description: The session artefact changed shape. The client no longer sends `cursor` and
-- `discarded`; it sends the whole placed flow — the nodes the builder has laid out, the ones still to
-- run included — as a JSON array. That single field replaces the pair, so the redo tail and the
-- applied-log length stop being the session's business and the flow becomes the artefact's state.
-- `flow` is JSONB on purpose, the same rule the rest of the artefact follows: its shape belongs to
-- the client that writes it, so a new node field costs a client change and no migration.
--
-- These statements must be safe to run twice. `cmd/migrate` keeps no applied-migrations table: it
-- re-executes every .sql in this directory on every run, so a non-idempotent statement is re-run too.
-- Every statement here is guarded (`IF EXISTS` / `IF NOT EXISTS`) and the NOT NULL DEFAULT keeps every
-- pre-existing row valid when the column first appears — the client always writes `flow`, so the
-- default only ever covers a row the migration itself created.
ALTER TABLE IF EXISTS model_sessions DROP CONSTRAINT IF EXISTS chk_model_sessions_cursor;
ALTER TABLE IF EXISTS model_sessions DROP COLUMN IF EXISTS cursor;
ALTER TABLE IF EXISTS model_sessions DROP COLUMN IF EXISTS discarded;
ALTER TABLE IF EXISTS model_sessions ADD COLUMN IF NOT EXISTS flow JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON TABLE model_sessions IS 'The Model Builder session for a model: the T18 artefact (the placed flow, projection, log)';
COMMENT ON COLUMN model_sessions.initial IS 'The projection the session started from — the base replay needs';
COMMENT ON COLUMN model_sessions.projection IS 'The replay state of the session, adopted on load without replay';
COMMENT ON COLUMN model_sessions.log IS 'The applied prefix of transactions';
COMMENT ON COLUMN model_sessions.flow IS 'The placed flow: the nodes the builder has laid out, the ones still to run included';
COMMENT ON COLUMN model_sessions.fingerprint IS 'Fingerprint of projection; a mismatch makes the loader replay the log instead';
