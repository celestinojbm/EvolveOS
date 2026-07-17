/**
 * EvolveOS G-00 manual stop mechanism (issue #12, P0-11) — the single productive
 * owner of the emergency-stop state and its two guards.
 *
 * Constitutional semantics (Appendix C: G-00 + "stop asymmetry"):
 *   - STOP is the cheapest action in the system: any single authorized human can
 *     engage it in one call, with an OPTIONAL reason — no Decision Record, no
 *     prior approval, no quorum, no ratification, no dependency on `real_money`.
 *   - RESTART is deliberately more expensive: it requires the owning-gate
 *     approver role and a non-empty rationale, recorded. It is never automatic.
 *   - While stopped, every gate-pass path and the agent-invocation boundary
 *     REFUSE (fail closed).
 *
 * This is the v1 mechanism the Buildability Audit §6(g) specifies (no Watchdogs,
 * no auto-stop, no auto-restart). It works regardless of ratification — it holds
 * even while the Founding Ratification Pack is unratified and `real_money` is
 * false. `real_money` gates whether money may EVER move; G-00 halts activity NOW.
 *
 * Identity is Phase 0 session attribution — an opaque registered session, not a
 * cryptographic personal signature. "Authorized human" = a registered user with
 * an active session they own and at least one active role (operator / approver /
 * viewer). Restart additionally requires an active `approver` role.
 *
 * The append-only history lives in `events` (system.stop_engaged /
 * system.stop_released); `system_stop_state` is the singleton projection.
 * Every mutation runs in ONE transaction with the issue-#7 lock order
 * (event-chain advisory lock FIRST), so stops, restarts, gate passes, and agent
 * invocations are totally ordered.
 */
import { randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEventTx, acquireEventChainLock } from "./eventlog.js";
import { getRoles, hasActiveRole } from "./auth.js";

type Queryable = Client | PoolClient;

export const STOP_EVENT_TYPE = "system.stop_engaged";
export const RESTART_EVENT_TYPE = "system.stop_released";
export const STOP_OBJECT_TYPE = "system-stop";
/** The stable singleton object id (there is exactly one system stop state). */
export const STOP_OBJECT_ID = "system";

// --- distinguishable, fail-closed errors -------------------------------------

/** The system is stopped: a guarded path refuses. */
export class SystemStoppedError extends Error {
  constructor(message = "system is stopped (G-00): the requested action is refused until restart") {
    super(message);
    this.name = "SystemStoppedError";
  }
}
/** The stop projection is missing/corrupt — fail closed, never assume running. */
export class StopStateCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StopStateCorruptError";
  }
}
/** The actor is not an authorized human (unregistered / bad session / no role). */
export class UnauthorizedStopActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedStopActorError";
  }
}
/** Restart attempted without an active `approver` role. */
export class RestartRequiresApproverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestartRequiresApproverError";
  }
}
/** Restart attempted without a non-empty rationale. */
export class RestartRationaleRequiredError extends Error {
  constructor(message = "restart requires a non-empty rationale") {
    super(message);
    this.name = "RestartRationaleRequiredError";
  }
}

// --- state model -------------------------------------------------------------

export interface SystemStopState {
  isStopped: boolean;
  generation: number;
  currentEventId: string | null;
  actorId: string | null;
  reason: string | null;
  updatedAt: string;
}

interface StopRow {
  is_stopped: boolean;
  generation: string; // bigint arrives as string
  current_event_id: string | null;
  actor_id: string | null;
  reason: string | null;
  updated_at: Date;
}

function requireField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

/** A stop reason is optional: empty/whitespace/non-string normalizes to null. */
function normalizeReason(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function inStopTx<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await acquireEventChainLock(client); // advisory lock FIRST (issue #7 order)
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

/**
 * Read the singleton stop row. Throws `StopStateCorruptError` if it is missing
 * or if a second row somehow exists — we NEVER treat an unexpected shape as
 * "running". Reads on the caller's connection so it composes inside a guarded
 * transaction (e.g. the gate transaction that already holds the lock).
 */
async function readStopRow(client: Queryable): Promise<StopRow> {
  const { rows } = await client.query<StopRow>(
    "SELECT is_stopped, generation, current_event_id, actor_id, reason, updated_at FROM system_stop_state",
  );
  if (rows.length === 0) {
    throw new StopStateCorruptError("system_stop_state row is missing — refusing to assume the system is running");
  }
  if (rows.length > 1) {
    throw new StopStateCorruptError(`system_stop_state has ${rows.length} rows — the singleton is corrupt`);
  }
  return rows[0];
}

function toState(row: StopRow): SystemStopState {
  return {
    isStopped: row.is_stopped,
    generation: Number(row.generation),
    currentEventId: row.current_event_id,
    actorId: row.actor_id,
    reason: row.reason,
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Current stop state (read-only). Throws `StopStateCorruptError` if the singleton is gone. */
export async function getSystemStopState(client: Queryable): Promise<SystemStopState> {
  return toState(await readStopRow(client));
}

// --- guards (fail closed) ----------------------------------------------------

/**
 * Assert the system is running, for use INSIDE an already-open, lock-holding
 * transaction (e.g. a gate pass). Throws `SystemStoppedError` when stopped and
 * `StopStateCorruptError` when the projection is missing — an SQL/connection
 * error propagates as itself and is never converted into permission.
 */
export async function assertSystemRunning(client: Queryable): Promise<void> {
  const row = await readStopRow(client);
  if (row.is_stopped) {
    throw new SystemStoppedError();
  }
}

/**
 * The canonical agent-invocation boundary. Phase 0 has NO productive agent
 * runtime; this is the single gate every future invocation MUST pass before
 * resolving credentials, calling a model, or executing a tool. It runs in its
 * own lock-holding transaction so it is serialized against stop/restart. Throws
 * `SystemStoppedError` when stopped; fails closed on a corrupt projection.
 */
export async function assertAgentInvocationAllowed(client: Queryable): Promise<void> {
  await inStopTx(client, async () => {
    await assertSystemRunning(client);
  });
}

/**
 * Run a guarded (fake, local) agent invocation: check the boundary FIRST, and
 * only if the system is running invoke `fn`. There are NO real agents,
 * credentials, or model calls in Phase 0 — `fn` is a local callback used to
 * prove the boundary. If the system is stopped (or the state is corrupt) `fn` is
 * NEVER called.
 */
export async function runGuardedAgentInvocation<T>(client: Queryable, fn: () => Promise<T> | T): Promise<T> {
  await assertAgentInvocationAllowed(client);
  return fn();
}

// --- authorization -----------------------------------------------------------

/**
 * An "authorized human" (Phase 0): a registered user with an active session they
 * own and at least one active role. Throws `UnauthorizedStopActorError` on any
 * failure. Runs inside the caller's locked transaction.
 */
async function assertAuthorizedHuman(client: Queryable, actorId: string, sessionId: string): Promise<void> {
  const u = await client.query("SELECT 1 FROM users WHERE id = $1", [actorId]);
  if (u.rows.length === 0) throw new UnauthorizedStopActorError(`'${actorId}' is not a registered user`);

  const s = await client.query<{ user_id: string; ended_at: Date | null }>(
    "SELECT user_id, ended_at FROM sessions WHERE id = $1",
    [sessionId],
  );
  if (s.rows.length === 0) throw new UnauthorizedStopActorError(`session '${sessionId}' does not exist`);
  if (s.rows[0].user_id !== actorId) throw new UnauthorizedStopActorError(`session '${sessionId}' belongs to a different user`);
  if (s.rows[0].ended_at !== null) throw new UnauthorizedStopActorError(`session '${sessionId}' is already ended`);

  const roles = await getRoles(client, actorId);
  if (roles.length === 0) {
    throw new UnauthorizedStopActorError(`'${actorId}' has no active role (operator/approver/viewer) — not an authorized human`);
  }
}

// --- engage / release --------------------------------------------------------

export interface EngageStopInput {
  actorId: string;
  sessionId: string;
  reason?: string;
}

export interface ReleaseStopInput {
  actorId: string;
  sessionId: string;
  rationale: string;
}

export interface StopMutationResult {
  state: SystemStopState;
  eventId: string | null;
  /** True when this call made no change (already in the target state). */
  idempotent: boolean;
}

/**
 * Engage the manual stop — the cheapest action in the system. Any authorized
 * human, one call, OPTIONAL reason; no DR, approval, quorum, or ratification.
 * Idempotent: if already stopped it emits NO new event, does NOT bump the
 * generation, and returns the current stop unchanged. Emits exactly one
 * append-only `system.stop_engaged` event with the new generation, the reason,
 * and the session id, atomically with the projection update.
 */
export async function engageSystemStop(client: Queryable, input: EngageStopInput): Promise<StopMutationResult> {
  const req = Object.freeze({
    actorId: requireField(input.actorId, "actorId"),
    sessionId: requireField(input.sessionId, "sessionId"),
    reason: normalizeReason(input.reason),
  });

  return inStopTx(client, async () => {
    await assertAuthorizedHuman(client, req.actorId, req.sessionId);
    const current = await readStopRow(client);
    if (current.is_stopped) {
      return { state: toState(current), eventId: current.current_event_id, idempotent: true };
    }
    const generation = Number(current.generation) + 1;
    const ev = await appendEventTx(client, {
      id: `EV-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: req.actorId,
      event_type: STOP_EVENT_TYPE,
      object_type: STOP_OBJECT_TYPE,
      object_id: STOP_OBJECT_ID,
      payload: { generation, reason: req.reason, session_id: req.sessionId },
    });
    const updated = await client.query<StopRow>(
      `UPDATE system_stop_state
          SET is_stopped = TRUE, generation = $1, current_event_id = $2,
              actor_id = $3, reason = $4, updated_at = now()
        WHERE singleton = TRUE
        RETURNING is_stopped, generation, current_event_id, actor_id, reason, updated_at`,
      [generation, ev.id, req.actorId, req.reason],
    );
    return { state: toState(updated.rows[0]), eventId: ev.id, idempotent: false };
  });
}

/**
 * Release the stop (restart). Requires an authorized human who additionally
 * holds an active `approver` role, and a non-empty rationale (recorded). Never
 * automatic; the restarter need not be the human who stopped. Rejected — with NO
 * event and NO generation change — if the system is already running. Emits
 * exactly one append-only `system.stop_released` event referencing the released
 * stop event, atomically with the projection update.
 */
export async function releaseSystemStop(client: Queryable, input: ReleaseStopInput): Promise<StopMutationResult> {
  const req = Object.freeze({
    actorId: requireField(input.actorId, "actorId"),
    sessionId: requireField(input.sessionId, "sessionId"),
    rationale: (() => {
      if (typeof input.rationale !== "string" || !input.rationale.trim()) throw new RestartRationaleRequiredError();
      return input.rationale;
    })(),
  });

  return inStopTx(client, async () => {
    await assertAuthorizedHuman(client, req.actorId, req.sessionId);
    if (!(await hasActiveRole(client, req.actorId, "approver"))) {
      throw new RestartRequiresApproverError(`restart requires the 'approver' role: '${req.actorId}' does not hold it`);
    }
    const current = await readStopRow(client);
    if (!current.is_stopped) {
      throw new Error("system is not stopped: there is nothing to restart");
    }
    const generation = Number(current.generation) + 1;
    const ev = await appendEventTx(client, {
      id: `EV-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: req.actorId,
      event_type: RESTART_EVENT_TYPE,
      object_type: STOP_OBJECT_TYPE,
      object_id: STOP_OBJECT_ID,
      payload: {
        generation,
        rationale: req.rationale,
        session_id: req.sessionId,
        released_stop_event_id: current.current_event_id,
      },
    });
    const updated = await client.query<StopRow>(
      `UPDATE system_stop_state
          SET is_stopped = FALSE, generation = $1, current_event_id = $2,
              actor_id = $3, reason = $4, updated_at = now()
        WHERE singleton = TRUE
        RETURNING is_stopped, generation, current_event_id, actor_id, reason, updated_at`,
      [generation, ev.id, req.actorId, req.rationale],
    );
    return { state: toState(updated.rows[0]), eventId: ev.id, idempotent: false };
  });
}
