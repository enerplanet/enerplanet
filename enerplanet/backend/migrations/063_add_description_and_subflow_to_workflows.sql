-- Migration: a workflow's description and its subflow marking.
-- Created: 2026-11
-- Description: Both are declared by the document and mirrored into a column, the same rule `label`
-- and `version` already follow: the definition is what a session references, so what it says about
-- itself must travel with it, while the column is what a list can be rendered from.
--
-- These statements must be safe to run twice. `cmd/migrate` keeps no applied-migrations table: it
-- re-executes every .sql in this directory on every run, so a non-idempotent statement is re-run too
-- (see 032/035/054 for what that costs — a re-run that narrows a set or duplicates a constraint).
-- `ALTER TABLE IF EXISTS` plus `ADD COLUMN IF NOT EXISTS` makes a second application a no-op, and the
-- NOT NULL DEFAULTs keep every pre-existing row valid when the columns first appear.
ALTER TABLE IF EXISTS workflows ADD COLUMN IF NOT EXISTS description VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS workflows ADD COLUMN IF NOT EXISTS is_subflow BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN workflows.description IS 'The definition''s own human line, for a picker; derived from the document, never input';
COMMENT ON COLUMN workflows.is_subflow IS 'TRUE when the document is a fragment inserted into another flow, never offered as a flow of its own';
