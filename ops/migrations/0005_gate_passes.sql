-- 0005_gate_passes.sql — gate-pass projection (issue #9, P0-8).
--
-- One row per successful gate pass, written ONLY by app/src/lib/gates.ts in
-- the same transaction as the single `gate_passed` event (the event log stays
-- the audit source of truth; this is the queryable integrity/idempotence
-- projection).
--
-- Integrity roles:
--   * dr_id UNIQUE      -> a Decision Record executes at most once (Appendix C
--                          mechanic 5, "no gate shopping" v0 form).
--   * gate_event_id     -> 1:1 with its gate_passed event (UNIQUE + FK).
--   * approval_event_id -> the approval evidence is a real event (FK).
--   * pipeline rows bind a venture; standing rows bind a subject (CHECK below)
--     without turning the DB into an opaque state machine.

CREATE TABLE IF NOT EXISTS gate_passes (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gate_id           TEXT NOT NULL,
    dr_id             TEXT NOT NULL UNIQUE CHECK (dr_id ~ '^DR-\d{4}-\d+$'),
    approval_event_id TEXT NOT NULL REFERENCES events (id),
    gate_event_id     TEXT NOT NULL UNIQUE REFERENCES events (id),
    venture_id        TEXT REFERENCES ventures (id),
    subject_type      TEXT,
    subject_id        TEXT,
    proposer_actor_id TEXT NOT NULL,
    approver_actor_id TEXT NOT NULL,
    passed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gate_passes_proposer_ne_approver
        CHECK (proposer_actor_id <> approver_actor_id),
    -- Backstop for the implemented gate set and its shape: pipeline passes
    -- (G-01..G-06) bind a venture and no subject; standing passes (G-17/G-18)
    -- bind a non-empty subject (venture optional). Everything else — G-00,
    -- G-07..G-16, unknown ids — is unrepresentable even by direct INSERT.
    CONSTRAINT gate_passes_gate_shape CHECK (
        (
            gate_id IN ('G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'G-06')
            AND venture_id IS NOT NULL
            AND subject_type IS NULL
            AND subject_id IS NULL
        )
        OR (
            gate_id IN ('G-17', 'G-18')
            AND subject_type IS NOT NULL AND length(trim(subject_type)) > 0
            AND subject_id IS NOT NULL AND length(trim(subject_id)) > 0
        )
    )
);

CREATE INDEX IF NOT EXISTS gate_passes_venture_idx ON gate_passes (venture_id);
CREATE INDEX IF NOT EXISTS gate_passes_gate_idx ON gate_passes (gate_id);
