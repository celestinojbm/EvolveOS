/**
 * EvolveOS gate system v0 (issue #9, P0-8) — the ONLY public entry point for
 * gate passes.
 *
 * Registry: schemas/data/gates.json (the canonical machine-readable registry
 * from issue #4; the issue text's `gates.yaml` was superseded by ADR/issue #4's
 * JSON decision — documented in docs/GATE_SYSTEM.md). Gate metadata (name,
 * section, kill-criteria requirement) is read from the registry, never
 * duplicated here.
 *
 * Scope (the pre-entity set): pipeline gates G-01..G-06 (venture transitions),
 * standing authorization gates G-17/G-18 (authorize a subject, never move a
 * venture), and G-00 — recognized but NOT passable: it is an emergency-stop
 * invocation, and `passGate` rejects it with a pointer to the issue-#12 stop
 * mechanism. All other gates are rejected as not implemented in v0.
 *
 * Protocol per pass (Appendix C mechanics 1-2; audit §5.4 downgrade):
 *   (a) the FULL Decision Record document, validated in memory against
 *       schemas/decision-record.schema.json (ajv, draft 2020-12) plus semantic
 *       checks (gate_id match, status approved, proposer/approver present and
 *       distinct);
 *   (b) pre-registered kill criteria (>=1 non-blank) where the registry says
 *       they are mandatory (all pipeline gates);
 *   (c) approval evidence: an `approval.recorded` event + its `approvals` row
 *       (issue #7) whose object is EXACTLY this DR and whose actors match the
 *       DR's proposer/approver, with the approver's role re-checked INSIDE the
 *       serialized transaction (no approve-vs-revoke TOCTOU);
 *   (d) proposer != approver (DR level, approvals row level, and DB CHECKs).
 *   A3 auto-approval downgrade: Appendix C grants G-01/G-02 agent
 *   auto-approval; per BUILDABILITY_AUDIT §5.4 the MVP downgrades them to A1 —
 *   they require exactly the same human approval evidence as every other
 *   gate. Appendix C and gates.json are NOT modified.
 *
 * Every successful pass runs ONE transaction with the issue-#7 lock order
 * (event-chain advisory lock first, then row locks) and produces EXACTLY ONE
 * `gate_passed` event plus one `gate_passes` projection row. The event IS the
 * authorization and (for pipeline gates) the venture effect — no additional
 * `venture.created` / `venture.stage_advanced` is emitted. Idempotence: a DR
 * executes at most once (gate_passes.dr_id UNIQUE).
 *
 * Boundary with issue #10 (DR tooling): the DR is supplied and validated IN
 * MEMORY here; #10 adds persistence, immutability, and lookup by reference —
 * the future integration replaces the direct input with a load, not the
 * protocol. Boundary with issue #12: the G-00 stop mechanism. Appendix C
 * mechanic 3 (queueing): no real queue — any requested spend is rejected as
 * "requires manual queue (A1)" because envelopes are unratified (ADR-006).
 * Mechanic 5 (no gate shopping): DR reuse is blocked; full resubmission-diff
 * validation needs the #10 DR store and is documented as deferred.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEventTx, acquireEventChainLock } from "./eventlog.js";
import { hasActiveRole } from "./auth.js";
import { getDecisionRecord, type DecisionRecordDoc } from "./dr.js";
import {
  TRANSITIONS,
  ENTRY_GATE,
  ENTRY_STATE,
  mintVentureAtG01Tx,
  advanceVentureForGateTx,
  type VentureState,
} from "./venture.js";

type Queryable = Client | PoolClient;

// --- Canonical registry ------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface GateMeta {
  readonly id: string;
  readonly name: string;
  readonly section: "standing" | "pipeline";
  readonly reversibility_class: string;
  readonly human_approval_required: boolean;
  readonly mandatory_kill_criteria_required: boolean;
}

// The registry is IMMUTABLE at runtime: every GateMeta is frozen at load, the
// backing Map is a module-private const, and it is never exposed by reference.
// A caller cannot add, remove, or replace a gate, nor mutate a gate's fields
// (a write to `gateMeta(id).reversibility_class` throws under ESM strict mode).
// This is the classification's single source of truth — Appendix C via
// schemas/data/gates.json — so a live process cannot re-classify a gate.
const GATES_REGISTRY: ReadonlyMap<string, GateMeta> = new Map(
  (
    JSON.parse(
      readFileSync(join(REPO_ROOT, "schemas", "data", "gates.json"), "utf8"),
    ) as { gates: GateMeta[] }
  ).gates.map((g) => [g.id, Object.freeze({ ...g }) as GateMeta]),
);

/** Pipeline gates in scope: each corresponds to exactly one venture effect. */
export const PIPELINE_GATES: readonly string[] = Object.freeze([
  "G-01",
  "G-02",
  "G-03",
  "G-04",
  "G-05",
  "G-06",
]);
/** Standing authorization gates in scope: authorize a subject, no transition. */
export const STANDING_GATES: readonly string[] = Object.freeze(["G-17", "G-18"]);
/** Recognized pre-entity gate that is NOT passable: emergency stop (issue #12). */
export const STOP_GATE = "G-00";

/**
 * Look up a gate's metadata. The returned object is the frozen registry entry —
 * mutating it throws (ESM strict mode) and can never alter the internal
 * registry — so callers get a read-only view of the canonical classification.
 */
export function gateMeta(gateId: string): GateMeta {
  const meta = GATES_REGISTRY.get(gateId);
  if (!meta) {
    throw new Error(`unknown gate: '${gateId}' is not in schemas/data/gates.json`);
  }
  return meta;
}

/**
 * Require an auditable request field to be a non-empty, non-whitespace string
 * and return it VERBATIM (identifiers are never silently rewritten — an id with
 * internal spaces is preserved, only its emptiness is rejected). Used to
 * snapshot request fields synchronously, before the first await, so a later
 * mutation of the caller's object cannot change the pass.
 */
function requireField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function implementedMeta(gateId: string): GateMeta {
  const meta = gateMeta(gateId);
  if (gateId === STOP_GATE) {
    throw new Error(
      "G-00 (Emergency Stop) is a stop invocation, not a gate pass — use the G-00 stop mechanism (issue #12)",
    );
  }
  if (!PIPELINE_GATES.includes(gateId) && !STANDING_GATES.includes(gateId)) {
    throw new Error(
      `gate ${gateId} (${meta.name}) is not implemented in gate system v0 — scope is G-01..G-06, G-17, G-18 (and G-00 via the issue-#12 stop mechanism)`,
    );
  }
  return meta;
}

// --- Decision Record: loaded from the store, validated for THIS gate ---------
//
// The DR content primitives — canonicalization, schema + semantic validation,
// and the SHA-256 digest — live in dr.ts (issue #10), the single
// canonicalization owner. A gate NEVER takes a caller-supplied document: it
// loads the FILED DR by id (dr.getDecisionRecord verifies canonical bytes vs
// stored digest), then applies only the GATE-SPECIFIC semantics below. The gate
// therefore binds to exactly the bytes dr.ts filed and the approval bound.

/** Gate-specific semantic checks on a loaded DR document (throws on failure). */
function assertGateSemantics(meta: GateMeta, dr: DecisionRecordDoc): void {
  if (dr.gate_id !== meta.id) {
    throw new Error(
      `decision record gate mismatch: DR ${dr.id} cites gate '${dr.gate_id ?? "none"}', expected '${meta.id}'`,
    );
  }
  if (dr.status !== "approved") {
    throw new Error(`decision record ${dr.id} is not approved (status: '${dr.status}')`);
  }
  if (!dr.proposer?.trim()) {
    throw new Error(`decision record ${dr.id} has an empty proposer`);
  }
  if (!dr.approver || !dr.approver.trim()) {
    throw new Error(`decision record ${dr.id} has no approver`);
  }
  if (dr.proposer === dr.approver) {
    throw new Error(
      `role separation: decision record ${dr.id} names the same actor as proposer and approver`,
    );
  }
  if (dr.reversibility_class !== meta.reversibility_class) {
    throw new Error(
      `decision record reversibility mismatch: gate ${meta.id} requires ${meta.reversibility_class}, DR declares ${dr.reversibility_class}`,
    );
  }
  if (meta.mandatory_kill_criteria_required) {
    const criteria = (dr.kill_criteria ?? []).filter((k) => k?.trim());
    if (!criteria.length) {
      throw new Error(
        `pre-registration required (Appendix C mechanic 1): gate ${meta.id} requires at least one non-blank kill criterion in the decision record`,
      );
    }
  }
}

/**
 * Load the FILED DR for a pass (inside the serialized gate transaction), verify
 * its integrity (dr.getDecisionRecord recomputes the digest from the stored
 * canonical bytes), and apply the gate-specific semantics. Returns the exact
 * filed document and its stored digest — the content the approval must bind to.
 */
async function loadGateDrTx(
  client: Queryable,
  meta: GateMeta,
  decisionRecordId: string,
): Promise<{ document: DecisionRecordDoc; digest: string }> {
  const record = await getDecisionRecord(client, decisionRecordId);
  if (!record) {
    throw new Error(
      `decision record not filed: ${decisionRecordId} — file it with dr.fileDecisionRecord before passing a gate`,
    );
  }
  assertGateSemantics(meta, record.document);
  return { document: record.document, digest: record.digest };
}

// --- Approval evidence validation (issue #7 approvals; inside the txn) --------

async function validateApprovalTx(
  client: Queryable,
  snap: { document: DecisionRecordDoc; digest: string },
  approvalEventId: string,
): Promise<{ proposer: string; approver: string }> {
  const dr = snap.document;
  // The append-only event is the primary immutable evidence: verify its type,
  // actor, object, and content digest — not just its existence.
  const ev = await client.query<{
    event_type: string;
    actor_id: string;
    object_type: string | null;
    object_id: string | null;
    // object_digest is untyped JSONB: a forged event could carry a number,
    // object, or malformed string — so it is `unknown` and guarded below.
    payload: { proposer_actor_id?: string; object_digest?: unknown } | null;
  }>(
    "SELECT event_type, actor_id, object_type, object_id, payload FROM events WHERE id = $1",
    [approvalEventId],
  );
  if (!ev.rows.length) {
    throw new Error(`approval event not found: ${approvalEventId}`);
  }
  const e = ev.rows[0];
  if (e.event_type !== "approval.recorded") {
    throw new Error(
      `event ${approvalEventId} is '${e.event_type}', not an approval.recorded event`,
    );
  }
  if (e.actor_id !== dr.approver) {
    throw new Error(
      `approval event actor mismatch: event ${approvalEventId} was recorded by '${e.actor_id}', DR approver is '${dr.approver}'`,
    );
  }
  if (e.object_type !== "decision-record") {
    throw new Error(
      `approval event ${approvalEventId} is for object_type '${e.object_type}', not a decision-record`,
    );
  }
  if (e.object_id !== dr.id) {
    throw new Error(
      `approval event ${approvalEventId} approves DR '${e.object_id}', not the submitted DR '${dr.id}'`,
    );
  }
  if (e.payload?.proposer_actor_id !== dr.proposer) {
    throw new Error(
      `approval event proposer mismatch: event records proposer '${e.payload?.proposer_actor_id ?? "none"}', DR proposer is '${dr.proposer}'`,
    );
  }
  // Guard the type BEFORE any string method: a number/object/whitespace digest
  // rejects cleanly here, it never throws a TypeError.
  const digest = e.payload?.object_digest;
  if (typeof digest !== "string" || !digest.trim()) {
    throw new Error(
      `approval event ${approvalEventId} carries no document digest (object_digest) — the approval is not bound to the DR content`,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(
      `approval event ${approvalEventId} has a malformed document digest (object_digest must be a 64-char SHA-256 hex string)`,
    );
  }
  if (digest !== snap.digest) {
    throw new Error(
      `approval digest mismatch: the approved decision record content differs from the submitted document (approved ${digest.slice(0, 12)}…, submitted ${snap.digest.slice(0, 12)}…)`,
    );
  }
  const ap = await client.query<{
    object_type: string;
    object_id: string;
    proposer_actor_id: string;
    approver_actor_id: string;
  }>(
    `SELECT object_type, object_id, proposer_actor_id, approver_actor_id
       FROM approvals WHERE event_id = $1`,
    [approvalEventId],
  );
  if (!ap.rows.length) {
    throw new Error(`no approvals row is linked to event ${approvalEventId}`);
  }
  const a = ap.rows[0];
  if (a.object_type !== "decision-record") {
    throw new Error(
      `approval ${approvalEventId} is for object_type '${a.object_type}', not a decision-record`,
    );
  }
  if (a.object_id !== dr.id) {
    throw new Error(
      `approval ${approvalEventId} approves DR '${a.object_id}', not the submitted DR '${dr.id}'`,
    );
  }
  if (a.proposer_actor_id !== dr.proposer || a.approver_actor_id !== dr.approver) {
    throw new Error(
      `approval actors do not match the decision record: approval has proposer '${a.proposer_actor_id}' / approver '${a.approver_actor_id}', DR has '${dr.proposer}' / '${dr.approver}'`,
    );
  }
  if (a.proposer_actor_id === a.approver_actor_id) {
    throw new Error("role separation: the approval's proposer and approver are the same actor");
  }
  // Re-checked INSIDE the serialized transaction (advisory lock already held):
  // a concurrent revoke either committed before us (this fails) or is queued
  // behind us (our pass precedes it in events.seq). Never a pass after an
  // effective revocation.
  if (!(await hasActiveRole(client, a.approver_actor_id, "approver"))) {
    throw new Error(
      `not authorized: approver '${a.approver_actor_id}' no longer holds an active 'approver' role`,
    );
  }
  return { proposer: a.proposer_actor_id, approver: a.approver_actor_id };
}

// --- Shared plumbing -----------------------------------------------------------

/** Appendix C mechanic 3, v0 form: no spend can be authorized (ADR-006). */
function rejectSpend(requestedSpend?: number | null): void {
  if (requestedSpend != null && requestedSpend !== 0) {
    throw new Error(
      "requires manual queue (A1): spend envelopes are unratified (ADR-006) — gate system v0 cannot authorize spend; queue the action for human execution",
    );
  }
}

async function runGateTx<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await acquireEventChainLock(client); // lock order: advisory FIRST, then rows
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function insertGatePassTx(
  client: Queryable,
  row: {
    gateId: string;
    drId: string;
    approvalEventId: string;
    gateEventId: string;
    ventureId?: string | null;
    subjectType?: string | null;
    subjectId?: string | null;
    proposer: string;
    approver: string;
  },
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO gate_passes
         (gate_id, dr_id, approval_event_id, gate_event_id, venture_id,
          subject_type, subject_id, proposer_actor_id, approver_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.gateId, row.drId, row.approvalEventId, row.gateEventId,
        row.ventureId ?? null, row.subjectType ?? null, row.subjectId ?? null,
        row.proposer, row.approver,
      ],
    );
  } catch (err) {
    if (err instanceof Error && /gate_passes_dr_id|dr_id/.test(err.message)) {
      throw new Error(
        `no gate shopping (Appendix C mechanic 5): DR ${row.drId} has already been executed — a new pass needs a new decision record (resubmission-diff validation remains deferred beyond issue #10)`,
      );
    }
    throw err;
  }
}

export interface GatePassResult {
  gateId: string;
  eventId: string;
  drId: string;
  ventureId: string | null;
  fromState: VentureState | null;
  toState: VentureState | null;
}

// --- G-01: the single atomic mint-venture pass ----------------------------------

/**
 * Pass G-01 (Opportunity Intake) — THE single atomic operation that validates
 * the gate and creates the venture (Part V §1.2: ids are minted at G-01 pass).
 * Emits exactly one `gate_passed` event whose effect is the venture creation;
 * NO `venture.created` event exists since issue #9.
 */
export async function passG01CreateVenture(
  client: Queryable,
  input: {
    name: string;
    opportunityRef: string;
    decisionRecordId: string;
    approvalEventId: string;
    actor: string;
    year?: number;
    requestedSpend?: number | null;
  },
): Promise<GatePassResult> {
  const meta = implementedMeta(ENTRY_GATE);
  // FULL request snapshot BEFORE the first await. Each field is read exactly
  // once here (into a frozen object); after this the mutable `input` is never
  // touched again. The DR is a FILED reference (decisionRecordId) — the exact
  // document is loaded from the immutable store inside the transaction.
  const req = Object.freeze({
    name: requireField(input.name, "name"),
    opportunityRef: requireField(
      input.opportunityRef,
      "opportunityRef (the pre-G-01 opportunity brief / KI)",
    ),
    decisionRecordId: requireField(input.decisionRecordId, "decisionRecordId"),
    approvalEventId: requireField(input.approvalEventId, "approvalEventId"),
    actor: requireField(input.actor, "actor"),
    year: input.year,
    requestedSpend: input.requestedSpend ?? null,
  });
  rejectSpend(req.requestedSpend);
  return runGateTx(client, async () => {
    const snap = await loadGateDrTx(client, meta, req.decisionRecordId);
    const dr = snap.document;
    const actors = await validateApprovalTx(client, snap, req.approvalEventId);
    const minted = await mintVentureAtG01Tx(client, {
      name: req.name,
      opportunityRef: req.opportunityRef,
      drRef: dr.id,
      year: req.year,
    });
    const eventId = await appendEventTx(client, {
      id: `EV-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: req.actor,
      event_type: "gate_passed",
      object_type: "venture",
      object_id: minted.id,
      payload: {
        gate_id: meta.id,
        gate_name: meta.name,
        dr_id: dr.id,
        approval_event_id: req.approvalEventId,
        proposer_actor_id: actors.proposer,
        approver_actor_id: actors.approver,
        kill_criteria: dr.kill_criteria ?? [],
        reversibility_class: dr.reversibility_class,
        dr_digest: snap.digest,
        transition_kind: "gate_pass",
        from_state: null, // pre-venture: an opportunity KI, not a state
        to_state: minted.state,
        venture_id: minted.id,
        effect: "venture_created",
        opportunity_ref: req.opportunityRef,
      },
    });
    await insertGatePassTx(client, {
      gateId: meta.id,
      drId: dr.id,
      approvalEventId: req.approvalEventId,
      gateEventId: eventId.id,
      ventureId: minted.id,
      proposer: actors.proposer,
      approver: actors.approver,
    });
    return {
      gateId: meta.id,
      eventId: eventId.id,
      drId: dr.id,
      ventureId: minted.id,
      fromState: null,
      toState: minted.state,
    };
  });
}

// --- G-02..G-06: gated venture advances ------------------------------------------

/**
 * Pass a pipeline gate G-02..G-06, advancing the venture one stage. The
 * transition is derived from the state machine and the venture's ACTUAL row
 * state — never from caller-supplied from/to. Emits exactly one `gate_passed`
 * event; NO `venture.stage_advanced` event exists since issue #9. G-01 must go
 * through `passG01CreateVenture` (it mints the venture).
 */
export async function passPipelineGate(
  client: Queryable,
  input: {
    gateId: string;
    ventureId: string;
    decisionRecordId: string;
    approvalEventId: string;
    actor: string;
    requestedSpend?: number | null;
  },
): Promise<GatePassResult> {
  const gateId = requireField(input.gateId, "gateId");
  const meta = implementedMeta(gateId);
  if (!PIPELINE_GATES.includes(gateId)) {
    throw new Error(`gate ${gateId} (${meta.name}) is a standing gate — use passStandingGate()`);
  }
  if (gateId === ENTRY_GATE) {
    throw new Error(
      "G-01 mints the venture — use passG01CreateVenture() (there is no venture to advance yet)",
    );
  }
  // FULL request snapshot BEFORE the first await (see passG01CreateVenture):
  // every field is read once here, then `input` is never touched again. The DR
  // is loaded from the immutable store inside the transaction, by id.
  const req = Object.freeze({
    gateId,
    ventureId: requireField(input.ventureId, "ventureId"),
    decisionRecordId: requireField(input.decisionRecordId, "decisionRecordId"),
    approvalEventId: requireField(input.approvalEventId, "approvalEventId"),
    actor: requireField(input.actor, "actor"),
    requestedSpend: input.requestedSpend ?? null,
  });
  rejectSpend(req.requestedSpend);
  return runGateTx(client, async () => {
    const snap = await loadGateDrTx(client, meta, req.decisionRecordId);
    const dr = snap.document;
    const actors = await validateApprovalTx(client, snap, req.approvalEventId);
    const effect = await advanceVentureForGateTx(client, {
      ventureId: req.ventureId,
      gateId: meta.id,
    });
    const eventId = await appendEventTx(client, {
      id: `EV-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: req.actor,
      event_type: "gate_passed",
      object_type: "venture",
      object_id: req.ventureId,
      payload: {
        gate_id: meta.id,
        gate_name: meta.name,
        dr_id: dr.id,
        approval_event_id: req.approvalEventId,
        proposer_actor_id: actors.proposer,
        approver_actor_id: actors.approver,
        kill_criteria: dr.kill_criteria ?? [],
        reversibility_class: dr.reversibility_class,
        dr_digest: snap.digest,
        transition_kind: "gate_pass",
        from_state: effect.from,
        to_state: effect.to,
        venture_id: req.ventureId,
        effect: "stage_advanced",
      },
    });
    await insertGatePassTx(client, {
      gateId: meta.id,
      drId: dr.id,
      approvalEventId: req.approvalEventId,
      gateEventId: eventId.id,
      ventureId: req.ventureId,
      proposer: actors.proposer,
      approver: actors.approver,
    });
    return {
      gateId: meta.id,
      eventId: eventId.id,
      drId: dr.id,
      ventureId: req.ventureId,
      fromState: effect.from,
      toState: effect.to,
    };
  });
}

// --- G-17 / G-18: standing authorizations ----------------------------------------

/**
 * Pass a standing gate (G-17 Public Communication / G-18 Data Use Expansion).
 * Authorizes a SUBJECT — it never transitions a venture. Same protocol (DR,
 * approval evidence, role separation, exact gate); kill criteria only if the
 * registry marks them mandatory (it does not for standing gates). Records the
 * authorization only: no communication is sent, no data is touched.
 */
export async function passStandingGate(
  client: Queryable,
  input: {
    gateId: string;
    subjectType: string;
    subjectId: string;
    ventureId?: string | null;
    decisionRecordId: string;
    approvalEventId: string;
    actor: string;
    requestedSpend?: number | null;
  },
): Promise<GatePassResult> {
  const gateId = requireField(input.gateId, "gateId");
  const meta = implementedMeta(gateId);
  if (!STANDING_GATES.includes(gateId)) {
    throw new Error(
      `gate ${gateId} (${meta.name}) is a pipeline gate — use passPipelineGate() / passG01CreateVenture()`,
    );
  }
  // FULL request snapshot BEFORE the first await (see passG01CreateVenture):
  // read each field once, validate, then never touch `input` again. The DR is
  // loaded from the immutable store inside the transaction, by id.
  const rawSubjectType = input.subjectType;
  const rawSubjectId = input.subjectId;
  if (
    typeof rawSubjectType !== "string" ||
    !rawSubjectType.trim() ||
    typeof rawSubjectId !== "string" ||
    !rawSubjectId.trim()
  ) {
    throw new Error(
      `standing gate ${gateId} requires non-empty subjectType and subjectId (it authorizes a subject, not a venture transition)`,
    );
  }
  const req = Object.freeze({
    gateId,
    subjectType: rawSubjectType,
    subjectId: rawSubjectId,
    ventureId: input.ventureId == null ? null : requireField(input.ventureId, "ventureId"),
    decisionRecordId: requireField(input.decisionRecordId, "decisionRecordId"),
    approvalEventId: requireField(input.approvalEventId, "approvalEventId"),
    actor: requireField(input.actor, "actor"),
    requestedSpend: input.requestedSpend ?? null,
  });
  rejectSpend(req.requestedSpend);
  return runGateTx(client, async () => {
    const snap = await loadGateDrTx(client, meta, req.decisionRecordId);
    const dr = snap.document;
    const actors = await validateApprovalTx(client, snap, req.approvalEventId);
    if (req.ventureId) {
      const v = await client.query("SELECT 1 FROM ventures WHERE id = $1", [req.ventureId]);
      if (!v.rows.length) throw new Error(`venture not found: ${req.ventureId}`);
    }
    const eventId = await appendEventTx(client, {
      id: `EV-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: req.actor,
      event_type: "gate_passed",
      object_type: req.subjectType,
      object_id: req.subjectId,
      payload: {
        gate_id: meta.id,
        gate_name: meta.name,
        dr_id: dr.id,
        approval_event_id: req.approvalEventId,
        proposer_actor_id: actors.proposer,
        approver_actor_id: actors.approver,
        kill_criteria: dr.kill_criteria ?? null,
        reversibility_class: dr.reversibility_class,
        dr_digest: snap.digest,
        transition_kind: "authorization", // standing: no venture transition
        from_state: null,
        to_state: null,
        venture_id: req.ventureId ?? null,
        subject_type: req.subjectType,
        subject_id: req.subjectId,
      },
    });
    await insertGatePassTx(client, {
      gateId: meta.id,
      drId: dr.id,
      approvalEventId: req.approvalEventId,
      gateEventId: eventId.id,
      ventureId: req.ventureId ?? null,
      subjectType: req.subjectType,
      subjectId: req.subjectId,
      proposer: actors.proposer,
      approver: actors.approver,
    });
    return {
      gateId: meta.id,
      eventId: eventId.id,
      drId: dr.id,
      ventureId: req.ventureId ?? null,
      fromState: null,
      toState: null,
    };
  });
}

// --- Dispatcher --------------------------------------------------------------------

/**
 * Dispatch a gate pass by id, preserving the pipeline/standing distinction.
 * G-00 is rejected here with a specific error (stop mechanism = issue #12);
 * unknown and unimplemented gates are rejected with specific errors.
 */
export async function passGate(
  client: Queryable,
  input: {
    gateId: string;
    decisionRecordId: string;
    approvalEventId: string;
    actor: string;
    requestedSpend?: number | null;
    // G-01
    name?: string;
    opportunityRef?: string;
    year?: number;
    // G-02..G-06
    ventureId?: string | null;
    // G-17/G-18
    subjectType?: string;
    subjectId?: string;
  },
): Promise<GatePassResult> {
  const gateId = requireField(input.gateId, "gateId");
  implementedMeta(gateId); // unknown / not-implemented / G-00 rejected here
  // Capture the whole request once, synchronously, before delegating. The
  // dispatcher has no await of its own, and each pass function snapshots its
  // arguments synchronously before ITS first await, so the entire chain reads
  // the caller's fields once — a later mutation cannot affect the pass.
  const req = Object.freeze({
    gateId,
    decisionRecordId: input.decisionRecordId,
    approvalEventId: input.approvalEventId,
    actor: input.actor,
    requestedSpend: input.requestedSpend,
    name: input.name,
    opportunityRef: input.opportunityRef,
    year: input.year,
    ventureId: input.ventureId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });
  if (gateId === ENTRY_GATE) {
    return passG01CreateVenture(client, {
      name: req.name ?? "",
      opportunityRef: req.opportunityRef ?? "",
      decisionRecordId: req.decisionRecordId,
      approvalEventId: req.approvalEventId,
      actor: req.actor,
      year: req.year,
      requestedSpend: req.requestedSpend,
    });
  }
  if (PIPELINE_GATES.includes(gateId)) {
    if (req.ventureId == null) throw new Error(`gate ${gateId} requires a ventureId`);
    return passPipelineGate(client, {
      gateId,
      ventureId: req.ventureId,
      decisionRecordId: req.decisionRecordId,
      approvalEventId: req.approvalEventId,
      actor: req.actor,
      requestedSpend: req.requestedSpend,
    });
  }
  return passStandingGate(client, {
    gateId,
    subjectType: req.subjectType ?? "",
    subjectId: req.subjectId ?? "",
    ventureId: req.ventureId ?? null,
    decisionRecordId: req.decisionRecordId,
    approvalEventId: req.approvalEventId,
    actor: req.actor,
    requestedSpend: req.requestedSpend,
  });
}

// Model sanity: every pipeline gate G-02..G-06 corresponds to exactly one
// gate_pass transition in the venture machine, and G-01 is the entry gate.
// (Verified again by tests; kept here as a load-time invariant.)
for (const gid of PIPELINE_GATES) {
  if (gid === ENTRY_GATE) continue;
  const t = TRANSITIONS.find((x) => x.kind === "gate_pass" && x.gate === gid);
  if (!t) throw new Error(`gate registry/machine mismatch: no gate_pass transition for ${gid}`);
}
if (ENTRY_STATE !== "trend_analysis") {
  throw new Error("gate system expects ventures to be born in trend_analysis (Part V §1.2)");
}
