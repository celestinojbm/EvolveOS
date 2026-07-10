-- 0001_init.sql — Phase 0 scaffolding migration (issue #5).
--
-- Deliberately minimal: it proves the migration path applies to a clean DB.
-- It creates only bookkeeping, NOT any domain table. The append-only event log
-- (hash-chained) is issue #6 (P0-5); auth/roles are issue #7 (P0-6). No product
-- schema is introduced here.

CREATE TABLE IF NOT EXISTS app_meta (
    key        text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_meta (key, value)
VALUES ('schema_bootstrap', 'phase-0')
ON CONFLICT (key) DO NOTHING;
