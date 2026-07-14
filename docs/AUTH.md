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

`recordApproval` additionally requires the approver to currently hold the `approver` role. Since issue #9, approving a **decision-record** also requires `objectDigest` — the SHA-256 of the DR's canonical JSON — recorded as `payload.object_digest` in the append-only `approval.recorded` event, so the approval is immutably bound to the exact approved content (the gate system rejects any pass whose submitted DR does not hash to the approved digest; see [GATE_SYSTEM](GATE_SYSTEM.md)).

## The module (`app/src/lib/auth.ts`)

`createUser`, `grantRole`, `revokeRole`, `getRoles`, `hasActiveRole`, `recordApproval`, `startSession`, `endSession`. Each mutation calls `appendEvent` (the single event-log write path) — this module never writes the `events` table directly, so `pnpm check:eventlog` stays green.

Events emitted: `user.created`, `role.granted`, `role.revoked`, `approval.recorded`, `auth.session_started`, `auth.session_ended` — all valid `event.schema.json` records (`actor_type: human`), so **all auth/role activity is in the log**.

## Atomicity (mutation + event commit together)

The event log is the audit source of truth, so a projection change and the event that represents it must never diverge. Every mutation runs inside **one Postgres transaction**:

```
BEGIN → projection change + appendEventTx(event) → COMMIT   (ROLLBACK on any error)
```

`appendEventTx` (issue #6) appends within the caller's open transaction — no separate BEGIN/COMMIT — so the event and the projection commit or roll back as a unit. Consequences, all covered by tests:

- **No projection change without its event, and no event for a change that failed.** If either statement throws, the transaction rolls back; the inserted event row is undone (no orphan event) and the advisory lock is released.
- **No false events.** `revokeRole` on a user with no active grant changes nothing and records **no** `role.revoked` (returns `{ revoked: false }` — revoke is idempotent, a no-op is not an error). `endSession` on a session that does not exist, is already ended, or belongs to another user records **no** `auth.session_ended` (returns `{ ended: false }`).
- **Referential integrity.** `role_grants.event_id` and `approvals.event_id` are `REFERENCES events(id)`, so a grant/approval can only cite a real event. In `grantRole` / `recordApproval` the event is appended first within the transaction so the FK is satisfiable; a later failure (e.g. a duplicate active grant, or the `approvals` CHECK) rolls the event back with it.

The event log design is unchanged — `appendEventTx` is just the transaction-composable form of the existing append; the hash chain, advisory lock, and append-only triggers behave exactly as before, and a rolled-back append leaves no row (chain stays linear; `verify:events` stays green).

### Concurrency: one lock order, one serialization point

Every audited mutation acquires the event-chain **advisory lock first** (it is the first thing `appendEventTx` does), then touches projection rows:

```
BEGIN → appendEventTx (advisory lock) → validate + mutate projection → COMMIT
```

Because all audited mutations take the *same* single advisory lock before any projection row, they are **totally ordered** — which gives two guarantees:

- **No lock-order deadlock.** `grantRole` and `revokeRole` on the same `(user, role)` can no longer acquire an advisory lock and a row lock in opposite orders; both take the advisory lock first, so one completes before the other starts its projection work.
- **No approve-vs-revoke TOCTOU.** `recordApproval` re-checks the approver's `approver` role **inside** the serialized transaction (not before it). So a concurrent revoke is either serialized before the approval — in which case the in-transaction role check fails and the approval is rejected (its provisional event rolled back) — or after it, in which case the approval was validly recorded first. An approval can never land after an effective revocation. Event `seq` (assigned under the same lock) reflects this total order, and the concurrency tests assert it.

A no-op (`revokeRole` with no active grant, `endSession` with nothing to end) rolls the whole transaction back via an internal sentinel, so it never leaves a false `role.revoked` / `auth.session_ended` event.

## What it does / does NOT guarantee

**Does:** distinct roles; a durable, event-logged trail of every grant/approval/session; a database-level guarantee that no approval is a self-approval.

**Does NOT (out of scope for Phase 0, deliberate):**
- **No real credentials.** There is no password/secret store, no cookies, no HTTP login, no IdP. "Session auth" here is an opaque session id plus login/logout events. Actor identity is *recorded*, not cryptographically verified — a later phase (e.g. WebAuthn/second-factor per XV-2) adds real authentication.
- No authorization middleware / route guards (there is no HTTP surface yet).
- No dashboard or admin UI.

## Running it

```bash
pnpm migrate          # applies ops/migrations/0003_users_roles.sql
pnpm test             # vitest: role separation (app + DB CHECK), grants, events logged, sessions, atomic rollback / failure paths
pnpm check:eventlog   # confirms auth writes go through the event-log module
```

`DATABASE_URL` defaults to the local dev Postgres (`pnpm db:up`) — a throwaway local value, not a secret.

## Known limitations (deliberate)

- Actor ids are trusted as given (no authentication yet); the model records *who claimed* to act, enforced separation is on identity equality, not on verified identity.
- Single Postgres, no distributed session store.
- `venture_id` / `reversibility_class` event-column decision is unrelated to this issue and intentionally untouched here.
