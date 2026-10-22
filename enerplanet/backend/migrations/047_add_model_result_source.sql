-- Migration: Add models.result_source (parsed-result provenance)
-- Created: 2026-09-30
-- Description: Records which pipeline produced a model's parsed results, so the
-- API can declare what the result contains (internal/result/capabilities). Values: 'legacy' | 'meme' | 'full-grid-pf'.
--
-- Already-parsed results predate the column, so they are backfilled as 'legacy'
-- — that keeps them readable/correct even after the legacy parser is removed.
-- Models with no parsed results are left NULL on purpose: no results, no
-- provenance claim (the capability lookup then claims nothing, which is the
-- honest answer, and nothing renders for them anyway).
--
-- Idempotent: the migration runner re-executes every file on each run.

BEGIN;

ALTER TABLE models
    ADD COLUMN IF NOT EXISTS result_source VARCHAR(32);

UPDATE models
SET result_source = 'legacy'
WHERE result_source IS NULL
  AND EXISTS (
      SELECT 1 FROM model_results mr WHERE mr.model_id = models.id
  );

COMMIT;
