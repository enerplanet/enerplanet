-- Migration: isolate the PyPSA power-flow leg's run record.
-- Created: 2026-10-06
-- Description: model_meme_runs moves from one row per model to one row per
-- (model, leg) so a PyPSA leg's TentaCron job id never overwrites (and thus
-- never "resumes by id") the Calliope leg. The composite PK (model_id, leg)
-- replaces the model_id-only PK added in migration 046.
--
-- Both legs run over MEME/TentaCron, so a single table with a `leg`
-- discriminator is the reuse-maximising shape. Existing rows are the Calliope
-- leg ('calliope'); the dispatch + ingest handlers keep writing that leg under
-- the same name, and the new PyPSA endpoint writes 'pypsa'.
--
-- Idempotent: the migration runner re-executes every file on each run.

BEGIN;

ALTER TABLE model_meme_runs ADD COLUMN IF NOT EXISTS leg VARCHAR(32) NOT NULL DEFAULT 'calliope';

UPDATE model_meme_runs SET leg = 'calliope' WHERE leg IS NULL OR leg = '';

-- Rebuild the PK as (model_id, leg). The 046 PK was the implicit
-- PRIMARY KEY on model_id (Postgres names it <table>_pkey). PostgreSQL
-- cannot alter a column's inline PK in place, so drop and re-add.
ALTER TABLE model_meme_runs DROP CONSTRAINT IF EXISTS model_meme_runs_pkey;
ALTER TABLE model_meme_runs ADD CONSTRAINT model_meme_runs_pkey PRIMARY KEY (model_id, leg);

COMMIT;