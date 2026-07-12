/**
 * EvolveOS user/role model (issue #7, P0-6). Three roles — operator, approver,
 * viewer — plus the Part III separation rule: a proposer may not approve their
 * own action.
 *
 * Every mutation is recorded in the append-only event log (issue #6) via
 * `appendEvent` — this module never writes the `events` table directly. The
 * `users`, `role_grants`, `approvals`, and `sessions` tables are queryable
 * projections; the event log is the audit source of truth.
 *
 * No real credentials: sessions are opaque ids + login/logout events, not a
 * password/IdP store. Actor identity is recorded, not cryptographically
 * verified — that is a later phase.
 */
import { randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEvent } from "./eventlog.js";

type Queryable = Client | PoolClient;

export type Role = "operator" | "approver" | "viewer";
export const ROLES: readonly Role[] = ["operator", "approver", "viewer"];

function isRole(x: string): x is Role {
  return (ROLES as readonly string[]).includes(x);
}

/** Append one auth/role event through the single event-log write path. */
async function logAuthEvent(
  client: Queryable,
  args: {
    actorId: string;
    eventType: string;
    objectType: string;
    objectId: string;
    payload?: Record<string, unknown> | null;
  },
): Promise<string> {
  const ev = await appendEvent(client, {
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
  await client.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [
    input.id,
    input.displayName,
  ]);
  await logAuthEvent(client, {
    actorId: input.createdBy ?? input.id,
    eventType: "user.created",
    objectType: "user",
    objectId: input.id,
    payload: { display_name: input.displayName },
  });
  return { id: input.id, displayName: input.displayName };
}

export async function grantRole(
  client: Queryable,
  input: { userId: string; role: Role; grantedBy: string },
): Promise<{ userId: string; role: Role; eventId: string }> {
  if (!isRole(input.role)) throw new Error(`invalid role: ${input.role}`);
  const existing = await client.query(
    "SELECT 1 FROM role_grants WHERE user_id = $1 AND role = $2 AND revoked_at IS NULL LIMIT 1",
    [input.userId, input.role],
  );
  if (existing.rows.length) {
    throw new Error(`role already granted: ${input.userId} already has '${input.role}'`);
  }
  const eventId = await logAuthEvent(client, {
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
}

export async function revokeRole(
  client: Queryable,
  input: { userId: string; role: Role; revokedBy: string },
): Promise<{ revoked: boolean; eventId: string }> {
  const eventId = await logAuthEvent(client, {
    actorId: input.revokedBy,
    eventType: "role.revoked",
    objectType: "user",
    objectId: input.userId,
    payload: { role: input.role },
  });
  const res = await client.query(
    "UPDATE role_grants SET revoked_at = now() WHERE user_id = $1 AND role = $2 AND revoked_at IS NULL",
    [input.userId, input.role],
  );
  return { revoked: (res.rowCount ?? 0) > 0, eventId };
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
 * Record an approval. Enforces the separation rule in two layers:
 *   1. here — an approval whose approver equals the proposer is rejected before
 *      any event is logged;
 *   2. the DB CHECK on `approvals` — the row is rejected regardless of caller.
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
  const eventId = await logAuthEvent(client, {
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
}

export async function startSession(
  client: Queryable,
  input: { userId: string },
): Promise<{ id: string; eventId: string }> {
  const id = randomUUID();
  const eventId = await logAuthEvent(client, {
    actorId: input.userId,
    eventType: "auth.session_started",
    objectType: "session",
    objectId: id,
    payload: null,
  });
  await client.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [id, input.userId]);
  return { id, eventId };
}

export async function endSession(
  client: Queryable,
  input: { sessionId: string; userId: string },
): Promise<{ ended: boolean; eventId: string }> {
  const eventId = await logAuthEvent(client, {
    actorId: input.userId,
    eventType: "auth.session_ended",
    objectType: "session",
    objectId: input.sessionId,
    payload: null,
  });
  const res = await client.query(
    "UPDATE sessions SET ended_at = now() WHERE id = $1 AND ended_at IS NULL",
    [input.sessionId],
  );
  return { ended: (res.rowCount ?? 0) > 0, eventId };
}
