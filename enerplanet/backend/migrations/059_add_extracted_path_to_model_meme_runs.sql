-- Migration: record the extracted bundle directory of a MEME leg's result.
-- Created: 2026-11-09
-- Description: the isolated PyPSA power-flow leg unpacks its result zip into
-- its own model_<id>_<ts>/ folder and never writes a model_results row, so the
-- GET /results/pypsa disk readers (convergence, transformer loading, line
-- ratings) had no way to find it — they fell back to the Calliope bundle. This
-- column stores the folder each leg's ingest extracted to, so the PyPSA leg's
-- readers can read the PyPSA bundle.
--
-- Idempotent: the migration runner re-executes every file on each run.

BEGIN;

ALTER TABLE model_meme_runs ADD COLUMN IF NOT EXISTS extracted_path TEXT;

COMMIT;
