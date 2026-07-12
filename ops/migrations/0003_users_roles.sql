-- 0003_users_roles.sql — user/role model with proposer≠approver separation
-- (issue #7, P0-6). Part III cross-cutting rule: the proposer of an action may
-- not be its approver.
--
-- These tables are queryable projections; the append-only event log (issue #6)
-- is the audit source of truth. app/src/lib/auth.ts is the writer: every role
-- grant, approval, and session transition is also recorded as an event.
--
-- No real credentials: there is no password/secret store here. "Session auth"
-- at Phase 0 is an opaque session id + login/logout events, not an IdP.

CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_grants (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id),
    role       TEXT NOT NULL CHECK (role IN ('operator', 'approver', 'viewer')),
    granted_by TEXT NOT NULL,
    event_id   TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

-- At most one ACTIVE grant per (user, role); revoked grants stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS role_grants_active_uq
    ON role_grants (user_id, role) WHERE revoked_at IS NULL;

-- Approvals. The CHECK is the data-layer guarantee that a proposer can never be
-- the approver — the database rejects the row regardless of application code.
CREATE TABLE IF NOT EXISTS approvals (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    object_type       TEXT NOT NULL,
    object_id         TEXT NOT NULL,
    proposer_actor_id TEXT NOT NULL,
    approver_actor_id TEXT NOT NULL,
    event_id          TEXT NOT NULL,
    approved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT approvals_proposer_ne_approver CHECK (proposer_actor_id <> approver_actor_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,   -- opaque session id (not a secret credential store)
    user_id    TEXT NOT NULL REFERENCES users (id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ
);
