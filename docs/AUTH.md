# User / role model — operator, approver, viewer

**Status:** Phase 0 · Implements issue **[#7](https://github.com/celestinojbm/EvolveOS/issues/7)** (P0-6). A minimal user/role model with the Part III separation rule: **a proposer may not approve their own action.** Every role grant, approval, and session transition is recorded in the append-only [event log](EVENT_LOG.md) (issue #6); the tables here are queryable projections, the event log is the audit source of truth.

## Roles

`operator` · `approver` · `viewer`. Roles are granted per user and recorded in `role_grants` (a partial unique index keeps at most one *active* grant per user+role; revoked grants stay as history).

## Tables (`ops/migrations/0003_users_roles.sql`)

| Table | Purpose |
|---|---|
| `users` | id, display_name, created_at |
| `role_grants` | user_id, role (CHECK in the three roles), granted_by, event_id, granted_at, revoked_at |
| `approvals` | object_type, object_id, proposer_actor_id, approver_actor_id, event_id — with `CHECK (proposer_actor_id <> approver_actor_id)` |
| `sessions` | opaque session id, user_id, started_at, ended_at |

## The separation rule (enforced in two layers)

An approval whose approver equals the proposer is rejected:

1. **Application layer** — `recordApproval` in `app/src/lib/auth.ts` throws *before* any event is logged, so a self-approval never reaches the log.
2. **Data layer** — `approvals` carries `CHECK (proposer_actor_id <> approver_actor_id)`, so the database rejects the row regardless of the code path that attempts it. This is the "enforced at the data layer" guarantee from the issue.

`recordApproval` additionally requires the approver to currently hold the `approver` role.

## The module (`app/src/lib/auth.ts`)

`createUser`, `grantRole`, `revokeRole`, `getRoles`, `hasActiveRole`, `recordApproval`, `startSession`, `endSession`. Each mutation calls `appendEvent` (the single event-log write path) — this module never writes the `events` table directly, so `pnpm check:eventlog` stays green.

Events emitted: `user.created`, `role.granted`, `role.revoked`, `approval.recorded`, `auth.session_started`, `auth.session_ended` — all valid `event.schema.json` records (`actor_type: human`), so **all auth/role activity is in the log**.

## What it does / does NOT guarantee

**Does:** distinct roles; a durable, event-logged trail of every grant/approval/session; a database-level guarantee that no approval is a self-approval.

**Does NOT (out of scope for Phase 0, deliberate):**
- **No real credentials.** There is no password/secret store, no cookies, no HTTP login, no IdP. "Session auth" here is an opaque session id plus login/logout events. Actor identity is *recorded*, not cryptographically verified — a later phase (e.g. WebAuthn/second-factor per XV-2) adds real authentication.
- No authorization middleware / route guards (there is no HTTP surface yet).
- No dashboard or admin UI.

## Running it

```bash
pnpm migrate          # applies ops/migrations/0003_users_roles.sql
pnpm test             # vitest: role separation (app + DB CHECK), grants, events logged, sessions
pnpm check:eventlog   # confirms auth writes go through the event-log module
```

`DATABASE_URL` defaults to the local dev Postgres (`pnpm db:up`) — a throwaway local value, not a secret.

## Known limitations (deliberate)

- Actor ids are trusted as given (no authentication yet); the model records *who claimed* to act, enforced separation is on identity equality, not on verified identity.
- Single Postgres, no distributed session store.
- `venture_id` / `reversibility_class` event-column decision is unrelated to this issue and intentionally untouched here.
