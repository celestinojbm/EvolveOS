-- 0002_events.sql — L0 append-only event log with a hash chain (issue #6, P0-5).
--
-- Part VI §1 (L0 event log) at ADR-002 scale: one Postgres table, INSERT-only,
-- each row hash-linked to the previous one. No event bus, no queue, no worker.
--
-- Columns mirror schemas/event.schema.json (the canonical record shape from
-- issue #4) plus `seq`, a monotonic insertion-order key that defines the chain
-- order. A venture is referenced via (object_type='venture', object_id); a
-- reversibility class, when relevant, travels inside `payload` — this keeps the
-- table 1:1 with the constitutional event schema without amending it.
--
-- Append-only is enforced by the database, not by convention: BEFORE UPDATE /
-- DELETE / TRUNCATE triggers raise. The only permitted mutation is INSERT, and
-- application code must route every INSERT through app/src/lib/eventlog.ts
-- (enforced separately by ops/check-single-writer.mjs in CI).

CREATE TABLE IF NOT EXISTS events (
    seq           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id            TEXT        NOT NULL UNIQUE,
    timestamp     TEXT        NOT NULL,
    actor_type    TEXT        NOT NULL CHECK (actor_type IN ('human', 'agent', 'kernel', 'watchdog', 'system')),
    actor_id      TEXT        NOT NULL,
    event_type    TEXT        NOT NULL,
    object_type   TEXT,
    object_id     TEXT,
    payload       JSONB,
    previous_hash TEXT,
    hash          TEXT        NOT NULL UNIQUE,
    trace_id      TEXT
);

CREATE INDEX IF NOT EXISTS events_object_idx ON events (object_type, object_id);
CREATE INDEX IF NOT EXISTS events_actor_idx ON events (actor_type, actor_id);

-- Append-only guard: reject every mutation except INSERT. One function serves
-- the row-level (UPDATE/DELETE) and statement-level (TRUNCATE) triggers; it
-- never references OLD, so it is valid for all three.
CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'events is append-only; % is not permitted', TG_OP
        USING ERRCODE = 'restrict_violation';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_no_update ON events;
DROP TRIGGER IF EXISTS events_no_delete ON events;
DROP TRIGGER IF EXISTS events_no_truncate ON events;

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION events_append_only();
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION events_append_only();
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON events
    FOR EACH STATEMENT EXECUTE FUNCTION events_append_only();
