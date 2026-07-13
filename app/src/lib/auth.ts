/**
 * EvolveOS user/role model (issue #7, P0-6). Three roles — operator, approver,
 * viewer — plus the Part III separation rule: a proposer may not approve their
 * own action.
 *
 * Atomicity (issue #7 follow-up): the event log is the audit source of truth,
 * so a projection change and the event that represents it must commit or roll
 * back together. Every mutation runs inside a single Postgres transaction:
 * BEGIN → projection change + `appendEventTx` → COMMIT (ROLLBACK on any error).
 * No event is ever recorded for a mutation that did not take effect, and no
 * projection change is ever visible without its event.
 *
 * Events go through `appendEventTx` (the composable event-log write path) — this
 * module never writes the `events` table directly, so `pnpm check:eventlog`
 * stays green. `role_grants.event_id` / `approvals.event_id` carry FKs to
 * `events(id)`, so an event id is always real.
 *
 * No real credentials: sessions are opaque ids + login/logout events, not a
 * password/IdP store. Actor identity is recorded, not cryptographically
 * verified — that is a later phase.
 */
import { randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEventTx } from "./eventlog.js";

type Queryable = Client | PoolClient;

export type Role = "operator" | "approver" | "viewer";
export const ROLES: readonly Role[] = ["operator", "approver", "viewer"];

function isRole(x: string): x is Role {
  return (ROLES as readonly string[]).includes(x);
}

/** Run `fn` in one transaction: BEGIN → fn → COMMIT, ROLLBACK on any error. */
async function inTransaction<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Append one auth/role event within the current transaction; returns its id. */
async function logAuthEventTx(
  client: Queryable,
  args: {
    actorId: string;
    eventType: string;
    objectType: string;
    objectId: string;
    payload?: Record<string, unknown> | null;
  },
): Promise<string> {
  const ev = await appendEventTx(client, {
    id: `EV-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    actor_type: "human",
    actor_id: args.actorId,
    event_type: args.eventType,
    object_type: args.objectType,
    object_id: args.objectId,
    payload: args.payload ?? null,
  });
  return ev.id;
}

export async function createUser(
  client: Queryable,
  input: { id: string; displayName: string; createdBy?: string },
): Promise<{ id: string; displayName: string }> {
  return inTransaction(client, async () => {
    await client.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [
      input.id,
      input.displayName,
    ]);
    await logAuthEventTx(client, {
      actorId: input.createdBy ?? input.id,
      eventType: "user.created",
      objectType: "user",
      objectId: input.id,
      payload: { display_name: input.displayName },
    });
    return { id: input.id, displayName: input.displayName };
  });
}

/**
 * Grant a role. A duplicate active grant is rejected by the partial-unique index
 * inside the transaction, which rolls back the `role.granted` event too (no
 * orphan event).
 */
export async function grantRole(
  client: Queryable,
  input: { userId: string; role: Role; grantedBy: string },
): Promise<{ userId: string; role: Role; eventId: string }> {
  if (!isRole(input.role)) throw new Error(`invalid role: ${input.role}`);
  return inTransaction(client, async () => {
    // Event first so role_grants.event_id (FK -> events.id) is satisfiable.
    const eventId = await logAuthEventTx(client, {
      actorId: input.grantedBy,
      eventType: "role.granted",
      objectType: "user",
      objectId: input.userId,
      payload: { role: input.role },
    });
    await client.query(
      "INSERT INTO role_grants (user_id, role, granted_by, event_id) VALUES ($1, $2, $3, $4)",
      [input.userId, input.role, input.grantedBy, eventId],
    );
    return { userId: input.userId, role: input.role, eventId };
  });
}

/**
 * Revoke a role. If there is no active grant, nothing changes and NO
 * `role.revoked` event is recorded — returns `{ revoked: false }` (chosen over
 * throwing: revoke is idempotent and a no-op revoke is not an error).
 */
export async function revokeRole(
  client: Queryable,
  input: { userId: string; role: Role; revokedBy: string },
): Promise<{ revoked: boolean; eventId?: string }> {
  return inTransaction(client, async () => {
    const res = await client.query(
      "UPDATE role_grants SET revoked_at = now() WHERE user_id = $1 AND role = $2 AND revoked_at IS NULL",
      [input.userId, input.role],
    );
    if ((res.rowCount ?? 0) === 0) return { revoked: false };
    const eventId = await logAuthEventTx(client, {
      actorId: input.revokedBy,
      eventType: "role.revoked",
      objectType: "user",
      objectId: input.userId,
      payload: { role: input.role },
    });
    return { revoked: true, eventId };
  });
}

export async function getRoles(client: Queryable, userId: string): Promise<Role[]> {
  const { rows } = await client.query<{ role: Role }>(
    "SELECT role FROM role_grants WHERE user_id = $1 AND revoked_at IS NULL ORDER BY role",
    [userId],
  );
  return rows.map((r) => r.role);
}

export async function hasActiveRole(
  client: Queryable,
  userId: string,
  role: Role,
): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT 1 FROM role_grants WHERE user_id = $1 AND role = $2 AND revoked_at IS NULL LIMIT 1",
    [userId, role],
  );
  return rows.length > 0;
}

/**
 * Record an approval. Separation is enforced in two layers:
 *   1. here — an approval whose approver equals the proposer is rejected before
 *      the transaction begins, so no event is logged;
 *   2. the DB CHECK on `approvals` — the row is rejected regardless of caller,
 *      and because the INSERT shares the transaction with the event append, a
 *      rejected approval rolls back its `approval.recorded` event (no orphan).
 * The approver must also currently hold the 'approver' role.
 */
export async function recordApproval(
  client: Queryable,
  input: {
    objectType: string;
    objectId: string;
    proposerActorId: string;
    approverActorId: string;
  },
): Promise<{ eventId: string }> {
  if (input.approverActorId === input.proposerActorId) {
    throw new Error("role separation: the approver must differ from the proposer");
  }
  if (!(await hasActiveRole(client, input.approverActorId, "approver"))) {
    throw new Error(`not authorized: '${input.approverActorId}' lacks the 'approver' role`);
  }
  return inTransaction(client, async () => {
    // Event first so approvals.event_id (FK -> events.id) is satisfiable.
    const eventId = await logAuthEventTx(client, {
      actorId: input.approverActorId,
      eventType: "approval.recorded",
      objectType: input.objectType,
      objectId: input.objectId,
      payload: { proposer_actor_id: input.proposerActorId },
    });
    await client.query(
      `INSERT INTO approvals
         (object_type, object_id, proposer_actor_id, approver_actor_id, event_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.objectType, input.objectId, input.proposerActorId, input.approverActorId, eventId],
    );
    return { eventId };
  });
}

export async function startSession(
  client: Queryable,
  input: { userId: string },
): Promise<{ id: string; eventId: string }> {
  return inTransaction(client, async () => {
    const id = randomUUID();
    const eventId = await logAuthEventTx(client, {
      actorId: input.userId,
      eventType: "auth.session_started",
      objectType: "session",
      objectId: id,
      payload: null,
    });
    await client.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [id, input.userId]);
    return { id, eventId };
  });
}

/**
 * End a session. If the session does not exist, is already ended, or does not
 * belong to `userId`, nothing changes and NO `auth.session_ended` event is
 * recorded — returns `{ ended: false }`.
 */
export async function endSession(
  client: Queryable,
  input: { sessionId: string; userId: string },
): Promise<{ ended: boolean; eventId?: string }> {
  return inTransaction(client, async () => {
    const res = await client.query(
      "UPDATE sessions SET ended_at = now() WHERE id = $1 AND user_id = $2 AND ended_at IS NULL",
      [input.sessionId, input.userId],
    );
    if ((res.rowCount ?? 0) === 0) return { ended: false };
    const eventId = await logAuthEventTx(client, {
      actorId: input.userId,
      eventType: "auth.session_ended",
      objectType: "session",
      objectId: input.sessionId,
      payload: null,
    });
    return { ended: true, eventId };
  });
}
