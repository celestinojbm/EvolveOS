/**
 * EvolveOS user/role model (issue #7, P0-6). Three roles — operator, approver,
 * viewer — plus the Part III separation rule: a proposer may not approve their
 * own action.
 *
 * Atomicity + concurrency: the event log is the audit source of truth, so a
 * projection change and its event must commit or roll back together. Every
 * audited mutation runs in ONE transaction with a CONSISTENT lock order:
 *
 *   BEGIN → appendEventTx (acquires the event-chain advisory lock FIRST)
 *         → validate + mutate the projection
 *         → COMMIT   (ROLLBACK on any error)
 *
 * Acquiring the single advisory lock first in every audited mutation makes them
 * totally ordered (no lock-order deadlock between grant/revoke on the same row)
 * and closes the approve-vs-revoke TOCTOU: the approver's role is re-checked
 * inside the serialized transaction, so an approval can never land after an
 * effective revocation.
 *
 * A no-op (revoke with no active grant, endSession with nothing to end) rolls
 * the whole transaction back via the internal NoOpRollback sentinel, so no false
 * event is ever persisted. Events go through `appendEventTx` only (never a direct
 * `events` write). `role_grants.event_id` / `approvals.event_id` FK to
 * `events(id)`.
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

/**
 * Require a request field to be a non-empty, non-whitespace string and return
 * it VERBATIM (identifiers are never silently rewritten — only emptiness is
 * rejected). Used to snapshot a mutable request synchronously before the first
 * await.
 */
function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

/** Internal sentinel: an intentional no-op that must roll the transaction back. */
class NoOpRollback extends Error {}

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

/**
 * Append one auth/role event within the current transaction. Called FIRST in
 * every audited mutation so the event-chain advisory lock is the consistent
 * first lock and serializes the whole mutation. Returns the new event id.
 */
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
    await logAuthEventTx(client, {
      actorId: input.createdBy ?? input.id,
      eventType: "user.created",
      objectType: "user",
      objectId: input.id,
      payload: { display_name: input.displayName },
    });
    await client.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [
      input.id,
      input.displayName,
    ]);
    return { id: input.id, displayName: input.displayName };
  });
}

/**
 * Grant a role. A duplicate active grant is rejected by the partial-unique index
 * inside the transaction, which rolls back the `role.granted` event too.
 */
export async function grantRole(
  client: Queryable,
  input: { userId: string; role: Role; grantedBy: string },
): Promise<{ userId: string; role: Role; eventId: string }> {
  if (!isRole(input.role)) throw new Error(`invalid role: ${input.role}`);
  return inTransaction(client, async () => {
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
 * Revoke a role. If there is no active grant, the transaction is rolled back and
 * NO `role.revoked` event is recorded — returns `{ revoked: false }` (revoke is
 * idempotent; a no-op is not an error).
 */
export async function revokeRole(
  client: Queryable,
  input: { userId: string; role: Role; revokedBy: string },
): Promise<{ revoked: boolean; eventId?: string }> {
  try {
    return await inTransaction(client, async () => {
      const eventId = await logAuthEventTx(client, {
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
      if ((res.rowCount ?? 0) === 0) throw new NoOpRollback();
      return { revoked: true, eventId };
    });
  } catch (err) {
    if (err instanceof NoOpRollback) return { revoked: false };
    throw err;
  }
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
 * Record an approval. Separation is enforced in layers:
 *   1. `approver == proposer` is rejected before the transaction (pure check);
 *   2. inside the transaction — after the advisory lock serializes this against
 *      any concurrent revoke — the approver's `approver` role is re-checked, so
 *      an approval can never be recorded after an effective revocation (TOCTOU
 *      closed). A missing role rolls back the provisional event;
 *   3. the DB CHECK on `approvals` backstops `proposer <> approver`.
 *
 * Content binding (issue #9): an approval of a `decision-record` MUST carry
 * `objectDigest` — the SHA-256 of the DR's canonical JSON (see
 * gates.digestDecisionRecordContent). The append-only `approval.recorded`
 * event records it as `payload.object_digest`, immutably binding the approval
 * to the DR's id, its FULL content, the proposer, and the approver (the event
 * actor). The gate system rejects any pass whose submitted DR content does not
 * hash to the approved digest.
 */
export async function recordApproval(
  client: Queryable,
  input: {
    objectType: string;
    objectId: string;
    proposerActorId: string;
    approverActorId: string;
    /** SHA-256 of the approved document's canonical JSON. Mandatory for decision-records. */
    objectDigest?: string | null;
  },
): Promise<{ eventId: string }> {
  // FULL request snapshot BEFORE the first await: read each field once, into a
  // frozen object, then never touch the mutable `input` again — a later
  // mutation of the caller's object cannot change the recorded approval.
  const req = Object.freeze({
    objectType: requireNonEmpty(input.objectType, "objectType"),
    objectId: requireNonEmpty(input.objectId, "objectId"),
    proposerActorId: requireNonEmpty(input.proposerActorId, "proposerActorId"),
    approverActorId: requireNonEmpty(input.approverActorId, "approverActorId"),
    objectDigest: input.objectDigest ?? null,
  });
  if (req.approverActorId === req.proposerActorId) {
    throw new Error("role separation: the approver must differ from the proposer");
  }
  // A decision-record approval MUST bind to the exact content: the digest is a
  // canonical SHA-256 hex string (64 chars, [0-9a-f]). Reject any other shape
  // — missing, wrong length, non-hex — with a specific error, so a malformed
  // digest can never be recorded as if it bound the content.
  let objectDigest: string | null = null;
  if (req.objectType === "decision-record") {
    const raw = req.objectDigest?.trim();
    if (!raw) {
      throw new Error(
        "approvals for a decision-record require objectDigest (SHA-256 of the canonical DR content)",
      );
    }
    if (!/^[0-9a-f]{64}$/.test(raw)) {
      throw new Error(
        "approvals for a decision-record require objectDigest to be a 64-char SHA-256 hex string ([0-9a-f])",
      );
    }
    objectDigest = raw;
  } else {
    const raw = req.objectDigest?.trim();
    objectDigest = raw ? raw : null;
  }
  return inTransaction(client, async () => {
    const eventId = await logAuthEventTx(client, {
      actorId: req.approverActorId,
      eventType: "approval.recorded",
      objectType: req.objectType,
      objectId: req.objectId,
      payload: {
        proposer_actor_id: req.proposerActorId,
        object_digest: objectDigest,
      },
    });
    // Re-check the role INSIDE the serialized transaction (not before it).
    if (!(await hasActiveRole(client, req.approverActorId, "approver"))) {
      throw new Error(`not authorized: '${req.approverActorId}' lacks the 'approver' role`);
    }
    await client.query(
      `INSERT INTO approvals
         (object_type, object_id, proposer_actor_id, approver_actor_id, event_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.objectType, req.objectId, req.proposerActorId, req.approverActorId, eventId],
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
 * belong to `userId`, the transaction is rolled back and NO `auth.session_ended`
 * event is recorded — returns `{ ended: false }`.
 */
export async function endSession(
  client: Queryable,
  input: { sessionId: string; userId: string },
): Promise<{ ended: boolean; eventId?: string }> {
  try {
    return await inTransaction(client, async () => {
      const eventId = await logAuthEventTx(client, {
        actorId: input.userId,
        eventType: "auth.session_ended",
        objectType: "session",
        objectId: input.sessionId,
        payload: null,
      });
      const res = await client.query(
        "UPDATE sessions SET ended_at = now() WHERE id = $1 AND user_id = $2 AND ended_at IS NULL",
        [input.sessionId, input.userId],
      );
      if ((res.rowCount ?? 0) === 0) throw new NoOpRollback();
      return { ended: true, eventId };
    });
  } catch (err) {
    if (err instanceof NoOpRollback) return { ended: false };
    throw err;
  }
}
