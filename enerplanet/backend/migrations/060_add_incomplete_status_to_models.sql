-- Migration: add 'incomplete' to the allowed model status values.
-- Created: 2026-11
-- Description: A Model Builder model exists before its flow has finished, and there is nothing
-- runnable yet: its config may be an empty placeholder. 'incomplete' marks exactly that, so the run
-- paths can refuse it (prepareModelRun) and the UI hides Run.
--
-- Same shape as 032/035/054: the constraint is a repo-owned migration, so extending it needs no
-- change to the shared Model struct in the `infrastructure` submodule — which is why this is a
-- status VALUE rather than a new column a submodule field would have to expose.
--
-- Allowed set after this: draft, queue, buildings, running, processing, completed, published,
-- failed, cancelled, modified, incomplete.
ALTER TABLE models DROP CONSTRAINT IF EXISTS chk_model_status;
ALTER TABLE models ADD CONSTRAINT chk_model_status CHECK (status IN ('draft', 'queue', 'buildings', 'running', 'processing', 'completed', 'published', 'failed', 'cancelled', 'modified', 'incomplete'));
