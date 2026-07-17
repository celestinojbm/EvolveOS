-- 0007_system_stop.sql — G-00 manual stop state (issue #12, P0-11).
--
-- The manual emergency-stop mechanism per Appendix C (G-00 + "stop asymmetry":
-- one human stops, the owning-gate approver restarts; stopping must be the
-- cheapest action). This is the v1 mechanism the Buildability Audit §6(g) calls
-- for: a manual stop flag that halts all gate-pass and agent-invocation paths;
-- one human, immediate, logged. No Watchdogs, no auto-stop, no auto-restart.
--
-- The full history lives in `events` (system.stop_engaged / system.stop_released);
-- THIS table is the queryable singleton projection, written ONLY by
-- app/src/lib/stop.ts in the same transaction as its event
-- (ops/check-stop-writer.mjs enforces the single writer).
--
-- A fresh database starts RUNNING at generation 0 WITHOUT fabricating a false
-- historical stop/restart event: the genesis row carries no event and no actor.
-- Only real stop/restart transitions (generation >= 1) reference an event and a
-- human actor.

CREATE TABLE IF NOT EXISTS system_stop_state (
    -- Singleton: the PK is a constant TRUE, so at most one row can ever exist.
    singleton        BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
    is_stopped       BOOLEAN NOT NULL,
    -- Monotonic version bumped on every effective stop/restart (set by stop.ts).
    generation       BIGINT  NOT NULL CHECK (generation >= 0),
    -- The event that produced the current state (NULL only for genesis running).
    current_event_id TEXT REFERENCES events (id),
    -- The human actor of that event (NULL only for genesis running).
    actor_id         TEXT,
    -- Optional stop reason, or the (mandatory, non-empty) restart rationale.
    reason           TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Coherence: exactly one of three shapes.
    --   genesis running  : gen 0, no event, no actor, no reason.
    --   stopped          : gen >= 1, event + actor present, reason OPTIONAL.
    --   restarted running : gen >= 1, event + actor present, reason (rationale)
    --                       present and non-empty.
    -- Nothing can fabricate a running-with-event-but-no-rationale, nor a
    -- stopped/restarted state without an event and actor.
    CONSTRAINT system_stop_state_coherent CHECK (
        (
            generation = 0
            AND is_stopped = FALSE
            AND current_event_id IS NULL
            AND actor_id IS NULL
            AND reason IS NULL
        )
        OR (
            generation >= 1
            AND current_event_id IS NOT NULL
            AND actor_id IS NOT NULL
            AND (
                is_stopped = TRUE
                OR (is_stopped = FALSE AND reason IS NOT NULL AND length(trim(reason)) > 0)
            )
        )
    )
);

-- Seed the genesis RUNNING row idempotently: a second migration run is a no-op,
-- and it never invents a stop/restart event.
INSERT INTO system_stop_state (singleton, is_stopped, generation)
VALUES (TRUE, FALSE, 0)
ON CONFLICT (singleton) DO NOTHING;
