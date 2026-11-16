-- Add 'buildings' (building demand profiles resolving before the model run) to the allowed model status values
ALTER TABLE models DROP CONSTRAINT IF EXISTS chk_model_status;
-- NOTE: the set below is the COMPLETE set, not the set this migration originally introduced.
-- `cmd/migrate` keeps no applied-migrations table: it re-executes every .sql in the directory on every
-- run. The DROP ... IF EXISTS makes each file re-appliable, but a set frozen at this migration's era
-- would NARROW the constraint on a re-run and then fail against rows already holding the newer values.
-- So every migration that names this constraint must state the current full set. Extend them together.
ALTER TABLE models ADD CONSTRAINT chk_model_status CHECK (status IN ('draft', 'queue', 'buildings', 'running', 'processing', 'completed', 'published', 'failed', 'cancelled', 'modified', 'incomplete'));
