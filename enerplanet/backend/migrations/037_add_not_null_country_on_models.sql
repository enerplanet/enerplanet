-- 037_add_not_null_country_on_models.sql
--
-- Enforces NOT NULL on models.country now that the backend is
-- authoritative for country resolution. This migration is guarded:
-- if any model still has a NULL or empty country, the migration fails
-- loudly so the operator runs the `cmd/backfill_country` tool first.

DO $$
DECLARE
    unresolved INTEGER;
BEGIN
    SELECT COUNT(*) INTO unresolved
    FROM models
    WHERE country IS NULL OR country = '';

    IF unresolved > 0 THEN
        RAISE EXCEPTION 'cannot enforce NOT NULL on models.country: % row(s) still have NULL/empty country. Run cmd/backfill_country first.', unresolved;
    END IF;
END$$;

ALTER TABLE models ALTER COLUMN country SET NOT NULL;
