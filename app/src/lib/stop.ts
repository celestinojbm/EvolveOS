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
 * `events` is the AUTHORITATIVE history (system.stop_engaged / system.stop_released);
 * `system_stop_state` is a VERIFIABLE projection. Every read revalidates the
 * projection against the latest transition in the event log
 * (`readValidatedStopState`) — the projection may never point at an old
 * transition, silently drop to genesis after transitions exist, or disagree with
 * its event. Any mismatch is `StopStateCorruptError` (fail closed; never
 * auto-repaired).
 *
 * Identity is Phase 0 session attribution — an opaque registered session, not a
 * cryptographic signature. "Authorized human" = a registered user with an active
 * session they own and at least one active role (operator / approver / viewer).
 * Restart additionally requires an active `approver` role.
 *
 * Every mutation AND the agent-invocation boundary run in ONE transaction with
 * the issue-#7 lock order (event-chain advisory lock FIRST). The agent callback
 * runs INSIDE that transaction, so a stop cannot commit between the guard and the
 * callback.
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
/** The stop projection is missing/corrupt or disagrees with the event log. */
export class StopStateCorruptError extends Error {
  constructor(message: string) {
    super(`stop state corrupt: ${message}`);
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

interface TransitionRow {
  id: string;
  seq: string;
  event_type: string;
  actor_type: string;
  object_type: string | null;
  object_id: string | null;
  actor_id: string;
  timestamp: string;
  payload: Record<string, unknown> | null;
}

function requireField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

/** A stop reason is optional: empty/whitespace/non-string normalizes to null. */
function normalizeReason(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** True only for a strict ISO instant with real calendar fields. */
function isValidTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const m = ISO_DATETIME_RE.exec(value);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3], hh = +m[4], mi = +m[5], ss = +m[6];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return false;
  const cal = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return false;
  return Number.isFinite(new Date(value).getTime());
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
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

/** The raw singleton row; throws `StopStateCorruptError` if missing/duplicated. */
async function readStopRow(client: Queryable): Promise<StopRow> {
  const { rows } = await client.query<StopRow>(
    "SELECT is_stopped, generation, current_event_id, actor_id, reason, updated_at FROM system_stop_state",
  );
  if (rows.length === 0) throw new StopStateCorruptError("the system_stop_state row is missing — refusing to assume running");
  if (rows.length > 1) throw new StopStateCorruptError(`the singleton has ${rows.length} rows`);
  return rows[0];
}

/** The most recent stop/restart transition for the singleton (by seq), or null. */
async function latestTransition(client: Queryable): Promise<TransitionRow | null> {
  const { rows } = await client.query<TransitionRow>(
    `SELECT id, seq, event_type, actor_type, object_type, object_id, actor_id, timestamp, payload
       FROM events
      WHERE event_type IN ($1, $2) AND object_type = $3 AND object_id = $4
      ORDER BY seq DESC
      LIMIT 1`,
    [STOP_EVENT_TYPE, RESTART_EVENT_TYPE, STOP_OBJECT_TYPE, STOP_OBJECT_ID],
  );
  return rows[0] ?? null;
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

function corrupt(message: string): never {
  throw new StopStateCorruptError(message);
}

/**
 * The single validated read: reconcile the projection with the append-only event
 * history and throw `StopStateCorruptError` on ANY disagreement. Used by every
 * public API so no caller trusts the projection (or a bare FK) alone.
 */
async function readValidatedStopState(client: Queryable): Promise<{ row: StopRow; state: SystemStopState }> {
  const row = await readStopRow(client);
  const gen = Number(row.generation);
  const latest = await latestTransition(client);

  if (gen === 0) {
    // Genesis: running, no event/actor/reason, and NO transition may exist.
    if (row.is_stopped || row.current_event_id !== null || row.actor_id !== null || row.reason !== null) {
      corrupt("genesis (generation 0) must be running with null event/actor/reason");
    }
    if (latest !== null) corrupt("projection is genesis but stop/restart transitions exist in the history");
    return { row, state: toState(row) };
  }

  // generation >= 1: must reference the LATEST transition, fully bound.
  if (row.current_event_id === null || row.actor_id === null) corrupt("a non-genesis state must carry an event and an actor");
  if (latest === null) corrupt("non-genesis projection but no stop/restart transition exists");
  if (row.current_event_id !== latest.id) corrupt("current_event_id does not point to the latest stop/restart transition");
  if (latest.actor_type !== "human") corrupt("the current transition actor_type is not human");
  if (latest.object_type !== STOP_OBJECT_TYPE || latest.object_id !== STOP_OBJECT_ID) corrupt("the current transition object binding is wrong");
  if (latest.actor_id !== row.actor_id) corrupt("the current transition actor_id does not match the projection");
  if (!isValidTimestamp(latest.timestamp)) corrupt("the current transition has an invalid timestamp");
  const p = latest.payload;
  if (!isObject(p)) corrupt("the current transition payload is not an object");
  if (Number(p.generation) !== gen) corrupt("payload.generation does not match the projection generation");

  if (row.is_stopped) {
    if (latest.event_type !== STOP_EVENT_TYPE) corrupt("stopped projection but the latest transition is not a stop");
    if ((p.reason ?? null) !== (row.reason ?? null)) corrupt("stop payload.reason does not match the projection reason");
    if (typeof p.session_id !== "string" || !p.session_id) corrupt("stop payload session_id is missing or not a string");
  } else {
    // Restarted running (generation >= 1).
    if (latest.event_type !== RESTART_EVENT_TYPE) corrupt("running (generation >= 1) but the latest transition is not a restart");
    if (typeof p.rationale !== "string" || !p.rationale.trim()) corrupt("restart rationale is missing/empty");
    if (p.rationale !== row.reason) corrupt("restart payload.rationale does not match the projection reason");
    if (typeof p.session_id !== "string" || !p.session_id) corrupt("restart payload session_id is missing or not a string");
    const releasedId = p.released_stop_event_id;
    if (typeof releasedId !== "string" || !releasedId) corrupt("restart released_stop_event_id is missing or not a string");
    const rel = await client.query<{ seq: string; event_type: string; object_type: string | null; object_id: string | null; payload: Record<string, unknown> | null }>(
      "SELECT seq, event_type, object_type, object_id, payload FROM events WHERE id = $1",
      [releasedId],
    );
    if (rel.rows.length === 0) corrupt("the released stop event does not exist");
    const r0 = rel.rows[0];
    if (r0.event_type !== STOP_EVENT_TYPE) corrupt("released_stop_event_id does not reference a stop event");
    if (r0.object_type !== STOP_OBJECT_TYPE || r0.object_id !== STOP_OBJECT_ID) corrupt("the released stop event object binding is wrong");
    if (Number(r0.seq) >= Number(latest.seq)) corrupt("the released stop does not precede the restart");
    if (!isObject(r0.payload) || Number(r0.payload.generation) !== gen - 1) corrupt("the released stop generation is not immediately prior to the restart");
  }
  return { row, state: toState(row) };
}

/** Current stop state (read-only, revalidated against the event log). */
export async function getSystemStopState(client: Queryable): Promise<SystemStopState> {
  return (await readValidatedStopState(client)).state;
}

// --- guards (fail closed) ----------------------------------------------------

/**
 * Assert the system is running, for use INSIDE an already-open, lock-holding
 * transaction (e.g. a gate pass, or `runGuardedAgentInvocation`). Revalidates the
 * projection against the event log first. Throws `SystemStoppedError` when
 * stopped and `StopStateCorruptError` when the state is inconsistent — an
 * SQL/connection error propagates as itself and is never converted to permission.
 */
export async function assertSystemRunning(client: Queryable): Promise<void> {
  const { state } = await readValidatedStopState(client);
  if (state.isStopped) throw new SystemStoppedError();
}

/**
 * CHECK-ONLY point read of the agent-invocation boundary (its own lock-holding
 * transaction). This is NOT a sufficient boundary to invoke afterwards: the lock
 * is released on return, so `await assertAgentInvocationAllowed(c); await invoke()`
 * has a TOCTOU window. The ONLY productive boundary for a real invocation is
 * `runGuardedAgentInvocation`, which holds the lock across the whole call.
 */
export async function assertAgentInvocationAllowed(client: Queryable): Promise<void> {
  await inStopTx(client, async () => {
    await assertSystemRunning(client);
  });
}

/**
 * Run a guarded (fake, local) agent invocation. The boundary check AND the
 * callback run in ONE transaction holding the event-chain advisory lock, so a
 * stop cannot commit between them: if the system is stopped (or the state is
 * corrupt) `fn` is NEVER called; if `fn` throws, the transaction rolls back, the
 * lock is released, and the original error propagates. There are NO real agents,
 * credentials, or model calls in Phase 0 — `fn` is a local callback; any future
 * credential resolution / model call / tool / side effect MUST happen inside it.
 */
export async function runGuardedAgentInvocation<T>(client: Queryable, fn: () => Promise<T> | T): Promise<T> {
  return inStopTx(client, async () => {
    await assertSystemRunning(client);
    return await fn();
  });
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
 * human, one call, OPTIONAL reason. Revalidates the current state first (fails
 * closed on corruption). Idempotent: if already stopped it emits NO new event,
 * does NOT bump the generation, and returns the current stop. Otherwise emits
 * exactly one append-only `system.stop_engaged` event (generation = current + 1,
 * with reason + session id) atomically with the projection update.
 */
export async function engageSystemStop(client: Queryable, input: EngageStopInput): Promise<StopMutationResult> {
  const req = Object.freeze({
    actorId: requireField(input.actorId, "actorId"),
    sessionId: requireField(input.sessionId, "sessionId"),
    reason: normalizeReason(input.reason),
  });

  return inStopTx(client, async () => {
    await assertAuthorizedHuman(client, req.actorId, req.sessionId);
    const { row } = await readValidatedStopState(client);
    if (row.is_stopped) {
      return { state: toState(row), eventId: row.current_event_id, idempotent: true };
    }
    const generation = Number(row.generation) + 1;
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
 * Release the stop (restart). Requires an authorized human who additionally holds
 * an active `approver` role, and a non-empty rationale (recorded). Never
 * automatic; the restarter need not be the human who stopped. Revalidates first;
 * rejected — with NO event, NO generation change — if already running. Emits
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
    const { row } = await readValidatedStopState(client);
    if (!row.is_stopped) {
      throw new Error("system is not stopped: there is nothing to restart");
    }
    const generation = Number(row.generation) + 1;
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
        released_stop_event_id: row.current_event_id,
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
