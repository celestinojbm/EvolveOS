/**
 * EvolveOS audit conventions registry (issue #13, P0-12) — the single
 * machine-readable source of truth for the Phase 0 event taxonomy.
 *
 * Part VI §1 makes the L0 `events` table the append-only source of truth; the
 * derived projections (users, ventures, gate_passes, decision_records,
 * system_stop_state) are views onto it. This module documents, in one place, the
 * CONTRACT of every event type a Phase 0 productive module emits: who may emit
 * it (actor types), what it is about (object type + object-id obligation), the
 * exact shape of its payload (a JSON Schema, or `null`), AND the cross-field
 * INVARIANTS the event asserts about itself (e.g. a gate pass's `object_id`
 * equals its `payload.venture_id`; an approval's approver differs from its
 * proposer). It is DECLARATIVE + PURE only — it opens no transaction, reads no
 * database, emits no event, and never mutates a stored event.
 *
 * It is NOT a second hashing authority. app/src/lib/eventlog.ts remains the sole
 * owner of `canonicalize` / `computeHash` / `previous_hash` semantics and the
 * `events.seq` chain order; this registry adds a *convention* layer on top of the
 * integrity layer. A cryptographically valid event (its stored hash matches a
 * recomputation) can still be convention-invalid — an unknown type, a wrong
 * actor, a malformed payload, or a violated invariant — and
 * `validateEventConvention` reports exactly that, as structured errors with
 * precise paths, never a bare boolean. The SHA-256 used for the docs *contracts
 * digest* below is over the CONTRACT DEFINITIONS (documentation), never events.
 *
 * Runtime-immutable: every convention, payload schema, and invariant list is
 * deep-frozen at load, the array is exported read-only and deterministically
 * ordered (issue ascending, then module emission order), and there are no
 * duplicate event types. The CLI (ops/verify-log.ts), the drift guard
 * (ops/check-audit-conventions.ts), and the tests all import from here.
 *
 * Adding an event type: append its convention here (in issue order), give it a
 * real productive writer, and regenerate docs/AUDIT_CONVENTIONS.md (the summary
 * table AND the full contracts section) between their markers. `pnpm check:audit`
 * fails CI until the registry, the productive writers (verified by AST), and the
 * doc all agree.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// --- ajv (CJS under NodeNext ESM: require + .default; mirrors dr.ts) ----------

interface AjvError {
  instancePath?: string;
  keyword?: string;
  message?: string;
  params?: Record<string, unknown>;
}
type AjvValidate = ((data: unknown) => boolean) & { errors?: AjvError[] | null };
interface AjvLike {
  compile(schema: unknown): AjvValidate;
}
const require = createRequire(import.meta.url);
const ajvModule = require("ajv/dist/2020.js") as
  | (new (opts: object) => AjvLike)
  | { default: new (opts: object) => AjvLike };
const Ajv2020 = ("default" in ajvModule ? ajvModule.default : ajvModule) as new (
  opts: object,
) => AjvLike;
// strict:false to match dr.ts; NO coerceTypes (ajv default) so "1" !== 1 and
// true !== 1 — the convention validator rejects coerced types.
const ajv = new Ajv2020({ allErrors: true, strict: false });

// --- the record shape a convention describes ---------------------------------

/** The actor types allowed by schemas/event.schema.json. */
export type ActorType = "human" | "agent" | "kernel" | "watchdog" | "system";

export const ACTOR_TYPES: readonly ActorType[] = Object.freeze([
  "human",
  "agent",
  "kernel",
  "watchdog",
  "system",
]);

/** The JS safe-integer bound (mirrors system_stop_state_gen_safe in 0007). */
export const MAX_SAFE_GENERATION = 9007199254740991; // Number.MAX_SAFE_INTEGER

/**
 * The event fields a convention is validated against — exactly
 * schemas/event.schema.json (the fields eventlog.ts hashes) with the caller's
 * stored `hash`. `validateEventConvention` accepts anything of this shape (it is
 * defensive about actual runtime types).
 */
export interface AuditEventRecord {
  id: string;
  timestamp: string;
  actor_type: string;
  actor_id: string;
  event_type: string;
  object_type: string | null;
  object_id: string | null;
  payload: Record<string, unknown> | null;
  previous_hash: string | null;
  hash: string;
  trace_id: string | null;
}

// --- the convention model ----------------------------------------------------

/**
 * Sentinel `objectType`: the writer sets `object_type` to a caller-supplied,
 * NON-BLANK value that varies per call. `approval.recorded` binds to whatever
 * artifact is being approved; `gate_passed` binds to a `venture` for pipeline
 * gates and to the authorized subject's type for standing gates. The contract
 * requires a non-blank `object_type`, but not one fixed string — the exact
 * binding is then pinned by that event's invariants.
 */
export const ANY_OBJECT_TYPE = "*";

/** The obligation on `object_id` for an event type. */
export type ObjectIdRule = "required" | "null" | "optional";

export interface ObjectContract {
  /**
   * The exact required `object_type` string; `ANY_OBJECT_TYPE` when the writer
   * sets a caller-supplied non-blank value; or `null` when `object_type` must be
   * null.
   */
  objectType: string | null;
  /** Whether `object_id` must be a non-blank string / must be null / may be either. */
  objectId: ObjectIdRule;
}

export type ConventionErrorCategory =
  | "base_record"
  | "unknown_event_type"
  | "actor_type"
  | "object_type"
  | "object_id"
  | "payload_null"
  | "payload_schema"
  | "venture_reference"
  | "invariant";

/** One structured convention failure: category + path + message (+ expected/actual). */
export interface ConventionError {
  category: ConventionErrorCategory;
  /** A dotted path within the event record (e.g. `payload.session_id`). */
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface EventConvention {
  /** The stable event type string exactly as emitted. */
  eventType: string;
  /** One line: what the event means. */
  description: string;
  /** The productive module that owns (emits) it, repo-relative. */
  ownerModule: string;
  /** The Phase 0 issue that introduced it. */
  introducedByIssue: number;
  /** The actor types allowed to emit it (Phase 0: always `human`). */
  allowedActorTypes: readonly ActorType[];
  /** The object binding: object type + object-id obligation. */
  objectContract: ObjectContract;
  /**
   * The JSON Schema (draft 2020-12) the payload must satisfy, or `null` when the
   * payload MUST be null. Schemas are strict: `additionalProperties: false`, real
   * types (no coercion), required fields enumerated, non-blank strings.
   */
  payloadSchema: Record<string, unknown> | null;
  /**
   * Dot-paths (besides the universal `object_type='venture'` rule) at which a
   * venture id may be referenced — used by the extract's `--venture` filter.
   */
  ventureReferencePaths: readonly string[];
  /**
   * Human/machine-readable statements of the cross-field invariants this event
   * asserts (documented AND enforced by `validateInvariants`). Included in the
   * generated docs + contracts digest, so changing an invariant changes the doc.
   */
  invariants: readonly string[];
  /**
   * Pure cross-field / whole-record checks that the payload JSON Schema cannot
   * express (equalities between fields, variant exclusivity, conditional digest
   * rules). Returns structured errors with precise paths; `[]` when it holds.
   * Never touches a DB, session, or projection — only the record itself.
   */
  validateInvariants?: (record: AuditEventRecord) => ConventionError[];
}

// --- shared schema fragments + primitives ------------------------------------

/** A string with at least one NON-WHITESPACE character (not merely non-empty). */
export const NON_BLANK_STRING = { type: "string", minLength: 1, pattern: "\\S" } as const;
const NULLABLE_NON_BLANK = { oneOf: [{ type: "null" }, NON_BLANK_STRING] } as const;
const SHA256_STRING = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const ROLE_ENUM = { type: "string", enum: ["operator", "approver", "viewer"] } as const;
const ANALYSIS_ITEM_ENUM = {
  type: "string",
  enum: [
    "customer_discovery",
    "competitive_analysis",
    "financial_modeling",
    "risk_analysis",
    "legal_analysis",
  ],
} as const;

const SHA256_RE = /^[0-9a-f]{64}$/;

/** True for a string with at least one non-whitespace character. */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Read a payload field defensively (undefined when payload is not an object). */
function pget(record: AuditEventRecord, key: string): unknown {
  return isPlainObject(record.payload) ? record.payload[key] : undefined;
}

function has(record: AuditEventRecord, key: string): boolean {
  return isPlainObject(record.payload) && Object.prototype.hasOwnProperty.call(record.payload, key);
}

/** Build a strict object schema: additionalProperties false, all listed required. */
function strictObject(
  properties: Record<string, unknown>,
  required?: readonly string[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: required ?? Object.keys(properties),
    properties,
  };
}

// --- invariant helpers -------------------------------------------------------

function err(
  category: ConventionErrorCategory,
  path: string,
  message: string,
  expected?: string,
  actual?: string,
): ConventionError {
  return { category, path, message, expected, actual };
}

function show(v: unknown): string {
  if (v === undefined) return "(absent)";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

const PIPELINE_GATE_SET = new Set(["G-02", "G-03", "G-04", "G-05", "G-06"]);
const STANDING_GATE_SET = new Set(["G-17", "G-18"]);

// --- per-event invariants ----------------------------------------------------

function approvalRecordedInvariants(record: AuditEventRecord): ConventionError[] {
  const out: ConventionError[] = [];
  const proposer = pget(record, "proposer_actor_id");
  if (isNonBlankString(record.actor_id) && isNonBlankString(proposer) && record.actor_id === proposer) {
    out.push(err("invariant", "payload.proposer_actor_id", "the approver (actor_id) must differ from the proposer", "actor_id !== proposer_actor_id", record.actor_id));
  }
  const digest = pget(record, "object_digest");
  if (record.object_type === "decision-record") {
    // A decision-record approval MUST bind the exact content (never null).
    if (typeof digest !== "string" || !SHA256_RE.test(digest)) {
      out.push(err("invariant", "payload.object_digest", "a decision-record approval must carry a 64-char lowercase SHA-256 object_digest (not null)", "^[0-9a-f]{64}$", show(digest)));
    }
  } else if (digest !== null && (typeof digest !== "string" || !SHA256_RE.test(digest))) {
    out.push(err("invariant", "payload.object_digest", "object_digest must be null or a 64-char lowercase SHA-256 for a non-decision-record approval", "null | ^[0-9a-f]{64}$", show(digest)));
  }
  return out;
}

function gatePassedInvariants(record: AuditEventRecord): ConventionError[] {
  const out: ConventionError[] = [];
  const gateId = pget(record, "gate_id");
  const transition = pget(record, "transition_kind");
  const effect = pget(record, "effect");
  const ventureId = pget(record, "venture_id");
  const subjectType = pget(record, "subject_type");
  const subjectId = pget(record, "subject_id");
  const fromState = pget(record, "from_state");
  const toState = pget(record, "to_state");
  const opportunityRef = pget(record, "opportunity_ref");
  const killCriteria = pget(record, "kill_criteria");
  const proposer = pget(record, "proposer_actor_id");
  const approver = pget(record, "approver_actor_id");

  // Common to every implemented variant: the pass actor is the approver, and
  // the proposer differs from the approver.
  if (isNonBlankString(approver) && record.actor_id !== approver) {
    out.push(err("invariant", "actor_id", "the gate-pass actor must be the approver", "actor_id === approver_actor_id", show(record.actor_id)));
  }
  if (isNonBlankString(proposer) && isNonBlankString(approver) && proposer === approver) {
    out.push(err("invariant", "payload.approver_actor_id", "proposer and approver must differ", "proposer !== approver", show(approver)));
  }

  const requireAbsent = (key: string): void => {
    if (has(record, key)) out.push(err("invariant", `payload.${key}`, `${key} must be absent for this gate variant`, "(absent)", show(pget(record, key))));
  };

  if (gateId === "G-01") {
    if (transition !== "gate_pass") out.push(err("invariant", "payload.transition_kind", "G-01 must be a gate_pass", "gate_pass", show(transition)));
    if (record.object_type !== "venture") out.push(err("invariant", "object_type", "G-01 binds to a venture", "venture", show(record.object_type)));
    if (!isNonBlankString(ventureId)) out.push(err("invariant", "payload.venture_id", "G-01 requires a non-blank venture_id", "non-blank string", show(ventureId)));
    else if (record.object_id !== ventureId) out.push(err("invariant", "object_id", "G-01 object_id must equal payload.venture_id", show(ventureId), show(record.object_id)));
    if (fromState !== null) out.push(err("invariant", "payload.from_state", "G-01 from_state must be null (pre-venture)", "null", show(fromState)));
    if (!isNonBlankString(toState)) out.push(err("invariant", "payload.to_state", "G-01 to_state must be non-blank", "non-blank string", show(toState)));
    if (effect !== "venture_created") out.push(err("invariant", "payload.effect", "G-01 effect must be venture_created", "venture_created", show(effect)));
    if (!isNonBlankString(opportunityRef)) out.push(err("invariant", "payload.opportunity_ref", "G-01 requires a non-blank opportunity_ref", "non-blank string", show(opportunityRef)));
    requireAbsent("subject_type");
    requireAbsent("subject_id");
    if (!Array.isArray(killCriteria)) out.push(err("invariant", "payload.kill_criteria", "G-01 kill_criteria must be an array", "array", show(killCriteria)));
  } else if (typeof gateId === "string" && PIPELINE_GATE_SET.has(gateId)) {
    if (transition !== "gate_pass") out.push(err("invariant", "payload.transition_kind", "a pipeline gate must be a gate_pass", "gate_pass", show(transition)));
    if (record.object_type !== "venture") out.push(err("invariant", "object_type", "a pipeline gate binds to a venture", "venture", show(record.object_type)));
    if (!isNonBlankString(ventureId)) out.push(err("invariant", "payload.venture_id", "a pipeline gate requires a non-blank venture_id", "non-blank string", show(ventureId)));
    else if (record.object_id !== ventureId) out.push(err("invariant", "object_id", "pipeline object_id must equal payload.venture_id", show(ventureId), show(record.object_id)));
    if (!isNonBlankString(fromState)) out.push(err("invariant", "payload.from_state", "a pipeline gate requires a non-blank from_state", "non-blank string", show(fromState)));
    if (!isNonBlankString(toState)) out.push(err("invariant", "payload.to_state", "a pipeline gate requires a non-blank to_state", "non-blank string", show(toState)));
    if (effect !== "stage_advanced") out.push(err("invariant", "payload.effect", "a pipeline gate effect must be stage_advanced", "stage_advanced", show(effect)));
    requireAbsent("opportunity_ref");
    requireAbsent("subject_type");
    requireAbsent("subject_id");
    if (!Array.isArray(killCriteria)) out.push(err("invariant", "payload.kill_criteria", "a pipeline gate kill_criteria must be an array", "array", show(killCriteria)));
  } else if (typeof gateId === "string" && STANDING_GATE_SET.has(gateId)) {
    if (transition !== "authorization") out.push(err("invariant", "payload.transition_kind", "a standing gate must be an authorization", "authorization", show(transition)));
    if (!isNonBlankString(subjectType)) out.push(err("invariant", "payload.subject_type", "a standing gate requires a non-blank subject_type", "non-blank string", show(subjectType)));
    else if (record.object_type !== subjectType) out.push(err("invariant", "object_type", "standing object_type must equal payload.subject_type", show(subjectType), show(record.object_type)));
    if (!isNonBlankString(subjectId)) out.push(err("invariant", "payload.subject_id", "a standing gate requires a non-blank subject_id", "non-blank string", show(subjectId)));
    else if (record.object_id !== subjectId) out.push(err("invariant", "object_id", "standing object_id must equal payload.subject_id", show(subjectId), show(record.object_id)));
    if (fromState !== null) out.push(err("invariant", "payload.from_state", "a standing gate from_state must be null", "null", show(fromState)));
    if (toState !== null) out.push(err("invariant", "payload.to_state", "a standing gate to_state must be null", "null", show(toState)));
    if (ventureId !== null && !isNonBlankString(ventureId)) out.push(err("invariant", "payload.venture_id", "a standing gate venture_id must be null or non-blank", "null | non-blank string", show(ventureId)));
    requireAbsent("effect");
    requireAbsent("opportunity_ref");
    if (killCriteria !== null && !Array.isArray(killCriteria)) out.push(err("invariant", "payload.kill_criteria", "a standing gate kill_criteria must be an array or null", "array | null", show(killCriteria)));
  } else {
    out.push(err("invariant", "payload.gate_id", "gate_passed only recognizes the Phase 0 implemented gates (G-01..G-06, G-17, G-18)", "G-01..G-06 | G-17 | G-18", show(gateId)));
  }
  return out;
}

function ratificationInvariants(record: AuditEventRecord): ConventionError[] {
  const out: ConventionError[] = [];
  const signer = pget(record, "signer_actor_id");
  if (isNonBlankString(signer) && record.actor_id !== signer) {
    out.push(err("invariant", "payload.signer_actor_id", "the signature actor must be the signer", "actor_id === signer_actor_id", show(record.actor_id)));
  }
  return out;
}

// --- the canonical inventory (deterministic order: issue asc, emission order) ---

const CONVENTIONS: EventConvention[] = [
  // --- issue #7 (P0-6): user/role model, sessions, approvals -----------------
  {
    eventType: "user.created",
    description: "A user was registered in the projection.",
    ownerModule: "app/src/lib/auth.ts",
    introducedByIssue: 7,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "user", objectId: "required" },
    payloadSchema: strictObject({ display_name: NON_BLANK_STRING }),
    ventureReferencePaths: [],
    invariants: [],
  },
  {
    eventType: "role.granted",
    description: "A role (operator/approver/viewer) was granted to a user.",
    ownerModule: "app/src/lib/auth.ts",
    introducedByIssue: 7,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "user", objectId: "required" },
    payloadSchema: strictObject({ role: ROLE_ENUM }),
    ventureReferencePaths: [],
    invariants: [],
  },
  {
    eventType: "role.revoked",
    description: "An active role grant was revoked from a user.",
    ownerModule: "app/src/lib/auth.ts",
    introducedByIssue: 7,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "user", objectId: "required" },
    payloadSchema: strictObject({ role: ROLE_ENUM }),
    ventureReferencePaths: [],
    invariants: [],
  },
  {
    eventType: "approval.recorded",
    description:
      "A human approval of an artifact (e.g. a decision-record), bound to the proposer and, for a decision-record, the content digest. Separation: the approver differs from the proposer.",
    ownerModule: "app/src/lib/auth.ts",
    introducedByIssue: 7,
    allowedActorTypes: ["human"],
    // The approved artifact's type varies (decision-record, or another object).
    objectContract: { objectType: ANY_OBJECT_TYPE, objectId: "required" },
    payloadSchema: strictObject({
      proposer_actor_id: NON_BLANK_STRING,
      // present, string-or-null; the exact digest rule is enforced per object_type by the invariant.
      object_digest: { type: ["string", "null"] },
    }),
    ventureReferencePaths: [],
    invariants: [
      "actor_id !== payload.proposer_actor_id (approver differs from proposer)",
      "object_type === 'decision-record' ⇒ payload.object_digest is a 64-char lowercase SHA-256 (never null)",
      "object_type !== 'decision-record' ⇒ payload.object_digest is null or a 64-char lowercase SHA-256",
    ],
    validateInvariants: approvalRecordedInvariants,
  },
  {
    eventType: "auth.session_started",
    description: "A user opened an opaque session (Phase 0 session attribution).",
    ownerModule: "app/src/lib/auth.ts",
    introducedByIssue: 7,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "session", objectId: "required" },
    payloadSchema: null,
    ventureReferencePaths: [],
    invariants: [],
  },
  {
    eventType: "auth.session_ended",
    description: "A user closed a session (does not alter historical events).",
    ownerModule: "app/src/lib/auth.ts",
    introducedByIssue: 7,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "session", objectId: "required" },
    payloadSchema: null,
    ventureReferencePaths: [],
    invariants: [],
  },

  // --- issue #8 (P0-7): venture record + macro-state machine -----------------
  {
    eventType: "venture.stage_handoff",
    description:
      "The intra-envelope Trend Analysis → Research handoff (Part V Stage 2): no new gate pass, reuses the venture's stored G-01 authorization.",
    ownerModule: "app/src/lib/venture.ts",
    introducedByIssue: 8,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "venture", objectId: "required" },
    payloadSchema: strictObject({
      from: NON_BLANK_STRING,
      to: NON_BLANK_STRING,
      transition_kind: { type: "string", enum: ["handoff"] },
      authorization_gate_id: NON_BLANK_STRING,
      authorization_ref: NON_BLANK_STRING,
    }),
    ventureReferencePaths: [],
    invariants: [],
  },
  {
    eventType: "venture.analysis_item_completed",
    description:
      "One of the five stage 5–9 analysis-block items was filed with a non-empty artifact reference.",
    ownerModule: "app/src/lib/venture.ts",
    introducedByIssue: 8,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "venture", objectId: "required" },
    payloadSchema: strictObject({
      item: ANALYSIS_ITEM_ENUM,
      evidence_ref: NON_BLANK_STRING,
    }),
    ventureReferencePaths: [],
    invariants: [],
  },
  {
    eventType: "venture.killed",
    description:
      "A venture was killed to Archived from a non-terminal state, with a mandatory reason and post-mortem reference.",
    ownerModule: "app/src/lib/venture.ts",
    introducedByIssue: 8,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "venture", objectId: "required" },
    payloadSchema: strictObject({
      reason: NON_BLANK_STRING,
      post_mortem_ref: NON_BLANK_STRING,
    }),
    ventureReferencePaths: [],
    invariants: [],
  },

  // --- issue #9 (P0-8): gate system v0 ---------------------------------------
  {
    eventType: "gate_passed",
    description:
      "Exactly one authorization event per gate pass. Pipeline gates (G-01..G-06) bind to a venture and carry an effect; standing gates (G-17/G-18) authorize a subject and carry subject_type/subject_id. The event IS the authorization and (for pipeline gates) the venture effect.",
    ownerModule: "app/src/lib/gates.ts",
    introducedByIssue: 9,
    allowedActorTypes: ["human"],
    // Pipeline gates: object is the venture. Standing gates: object is the
    // authorized subject (caller-supplied type). Both bind a non-blank object_id;
    // the exact per-variant binding is pinned by the invariants below.
    objectContract: { objectType: ANY_OBJECT_TYPE, objectId: "required" },
    payloadSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "gate_id",
        "gate_name",
        "dr_id",
        "approval_event_id",
        "proposer_actor_id",
        "approver_actor_id",
        "kill_criteria",
        "reversibility_class",
        "dr_digest",
        "transition_kind",
        "from_state",
        "to_state",
        "venture_id",
      ],
      properties: {
        gate_id: NON_BLANK_STRING,
        gate_name: NON_BLANK_STRING,
        dr_id: NON_BLANK_STRING,
        approval_event_id: NON_BLANK_STRING,
        proposer_actor_id: NON_BLANK_STRING,
        approver_actor_id: NON_BLANK_STRING,
        kill_criteria: { oneOf: [{ type: "null" }, { type: "array", items: { type: "string" } }] },
        reversibility_class: NON_BLANK_STRING,
        dr_digest: SHA256_STRING,
        transition_kind: { type: "string", enum: ["gate_pass", "authorization"] },
        from_state: NULLABLE_NON_BLANK,
        to_state: NULLABLE_NON_BLANK,
        venture_id: NULLABLE_NON_BLANK,
        effect: { type: "string", enum: ["venture_created", "stage_advanced"] },
        opportunity_ref: NON_BLANK_STRING,
        subject_type: NON_BLANK_STRING,
        subject_id: NON_BLANK_STRING,
      },
    },
    ventureReferencePaths: ["payload.venture_id"],
    invariants: [
      "actor_id === payload.approver_actor_id; payload.proposer_actor_id !== payload.approver_actor_id",
      "G-01: transition_kind='gate_pass', object_type='venture', object_id===payload.venture_id (non-blank), from_state=null, to_state non-blank, effect='venture_created', opportunity_ref non-blank, subject_* absent, kill_criteria array",
      "G-02..G-06: transition_kind='gate_pass', object_type='venture', object_id===payload.venture_id, from_state & to_state non-blank, effect='stage_advanced', opportunity_ref/subject_* absent, kill_criteria array",
      "G-17/G-18: transition_kind='authorization', object_type===payload.subject_type, object_id===payload.subject_id (non-blank), from_state=null, to_state=null, venture_id null|non-blank, effect/opportunity_ref absent, kill_criteria array|null",
      "any other gate_id is rejected (only the Phase 0 implemented gates)",
    ],
    validateInvariants: gatePassedInvariants,
  },

  // --- issue #10 (P0-9): Decision Record tooling -----------------------------
  {
    eventType: "decision_record.filed",
    description: "A new immutable Decision Record was filed (amends_dr_id is null).",
    ownerModule: "app/src/lib/dr.ts",
    introducedByIssue: 10,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "decision-record", objectId: "required" },
    payloadSchema: strictObject({
      content_digest: SHA256_STRING,
      schema_version: NON_BLANK_STRING,
      amends_dr_id: { type: "null" },
    }),
    ventureReferencePaths: [],
    invariants: [],
  },
  {
    eventType: "decision_record.amended",
    description:
      "An amendment: a new immutable Decision Record that references an existing one via a non-null amends_dr_id.",
    ownerModule: "app/src/lib/dr.ts",
    introducedByIssue: 10,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "decision-record", objectId: "required" },
    payloadSchema: strictObject({
      content_digest: SHA256_STRING,
      schema_version: NON_BLANK_STRING,
      amends_dr_id: NON_BLANK_STRING,
    }),
    ventureReferencePaths: [],
    invariants: [],
  },

  // --- issue #11 (P0-10): founding ratification ------------------------------
  {
    eventType: "ratification.signature_recorded",
    description:
      "One required signer's human signature on the Founding Ratification Pack, attributed to an active session (Phase 0 session auth, not a cryptographic key).",
    ownerModule: "app/src/lib/ratification-core.ts",
    introducedByIssue: 11,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "founding-ratification-pack", objectId: "required" },
    payloadSchema: strictObject({
      pack_digest: SHA256_STRING,
      pack_version: NON_BLANK_STRING,
      signer_actor_id: NON_BLANK_STRING,
      signer_capacity: NON_BLANK_STRING,
      acknowledgement_version: NON_BLANK_STRING,
      session_id: NON_BLANK_STRING,
    }),
    ventureReferencePaths: [],
    invariants: ["actor_id === payload.signer_actor_id"],
    validateInvariants: ratificationInvariants,
  },

  // --- issue #12 (P0-11): G-00 manual stop -----------------------------------
  {
    eventType: "system.stop_engaged",
    description:
      "The manual emergency stop was engaged (G-00) — the cheapest action: any authorized human, one call, optional reason.",
    ownerModule: "app/src/lib/stop.ts",
    introducedByIssue: 12,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "system-stop", objectId: "required" },
    payloadSchema: strictObject({
      generation: { type: "integer", minimum: 1, maximum: MAX_SAFE_GENERATION },
      reason: NULLABLE_NON_BLANK,
      session_id: NON_BLANK_STRING,
    }),
    ventureReferencePaths: [],
    invariants: [],
  },
  {
    eventType: "system.stop_released",
    description:
      "The stop was released (restart) by an approver with a mandatory non-empty rationale, referencing the released stop event.",
    ownerModule: "app/src/lib/stop.ts",
    introducedByIssue: 12,
    allowedActorTypes: ["human"],
    objectContract: { objectType: "system-stop", objectId: "required" },
    payloadSchema: strictObject({
      generation: { type: "integer", minimum: 1, maximum: MAX_SAFE_GENERATION },
      rationale: NON_BLANK_STRING,
      session_id: NON_BLANK_STRING,
      released_stop_event_id: NON_BLANK_STRING,
    }),
    ventureReferencePaths: [],
    invariants: [],
  },
];

// --- deep freeze + duplicate guard (runtime immutability) --------------------

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const seenTypes = new Set<string>();
for (const c of CONVENTIONS) {
  if (seenTypes.has(c.eventType)) {
    throw new Error(`audit-conventions: duplicate event type '${c.eventType}' in the registry`);
  }
  seenTypes.add(c.eventType);
}

/** The complete, immutable, deterministically-ordered Phase 0 event inventory. */
export const EVENT_CONVENTIONS: readonly EventConvention[] = deepFreeze(CONVENTIONS);

/** All registered event type strings, in the canonical order. */
export const EVENT_TYPES: readonly string[] = Object.freeze(
  EVENT_CONVENTIONS.map((c) => c.eventType),
);

const BY_TYPE: ReadonlyMap<string, EventConvention> = new Map(
  EVENT_CONVENTIONS.map((c) => [c.eventType, c]),
);

/** Look up a convention by event type, or null if the type is not registered. */
export function getConvention(eventType: string): EventConvention | null {
  return BY_TYPE.get(eventType) ?? null;
}

// Compile the payload validators once (the schemas are runtime-immutable).
const PAYLOAD_VALIDATORS = new Map<string, AjvValidate>();
for (const c of EVENT_CONVENTIONS) {
  if (c.payloadSchema !== null) {
    PAYLOAD_VALIDATORS.set(c.eventType, ajv.compile(c.payloadSchema));
  }
}

// --- structured convention validation ----------------------------------------

const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * True only for a strict RFC3339 / ISO-8601 instant whose calendar fields are
 * REAL (no silent roll-over like 2026-02-30) and that resolves to a finite
 * instant. Mirrors the parser in stop.ts / ratification-core.ts.
 */
export function isValidEventTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const m = ISO_DATETIME_RE.exec(value);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3], hh = +m[4], mi = +m[5], ss = +m[6];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return false;
  const cal = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
  if (
    cal.getUTCFullYear() !== y ||
    cal.getUTCMonth() !== mo - 1 ||
    cal.getUTCDate() !== d ||
    cal.getUTCHours() !== hh ||
    cal.getUTCMinutes() !== mi ||
    cal.getUTCSeconds() !== ss
  ) {
    return false;
  }
  return Number.isFinite(new Date(value).getTime());
}

/** Read a value at a dot-path (e.g. `payload.venture_id`) — undefined if absent. */
function readPath(record: AuditEventRecord, path: string): unknown {
  let cur: unknown = record;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Validate one event against the base record rules, its event-type contract, AND
 * its cross-field invariants, returning EVERY failure as a structured error
 * (empty array = valid). Pure: no DB, no session, no projection, no repair, no
 * normalization — a historical event is judged exactly as stored.
 *
 * Base rules (independent of type): non-blank `id`; a strict RFC3339 `timestamp`
 * with real calendar fields; `actor_type` in the schema enum; non-blank
 * `actor_id`; a non-blank, registered `event_type`; `hash` a 64-char lowercase
 * SHA-256; `previous_hash` null or SHA-256; `trace_id` null or non-blank.
 *
 * Contract rules (per type): `actor_type` allowed; the object binding
 * (fixed/`*`/null type, and object-id obligation); payload null when the type
 * carries no payload, else valid against the type's strict JSON Schema (exact
 * types, no coercion, additionalProperties false, non-blank strings); each
 * declared venture-reference path, when present, non-blank.
 *
 * Invariant rules (per type): the cross-field equalities and variant contracts
 * the event asserts (gate-pass variants, approval separation + digest, ratifier
 * identity), checked ONLY against the record itself.
 *
 * NOTE: this does NOT check the hash chain (that is eventlog.ts / the CLI). A
 * cryptographically valid event can still fail here.
 */
export function validateEventConvention(record: AuditEventRecord): ConventionError[] {
  const errors: ConventionError[] = [];
  const push = (
    category: ConventionErrorCategory,
    path: string,
    message: string,
    expected?: string,
    actual?: string,
  ): void => {
    errors.push({ category, path, message, expected, actual });
  };

  // --- base record (integrity-adjacent, but not the hash chain) --------------
  if (!isNonBlankString(record.id)) {
    push("base_record", "id", "id must be a non-blank string", "non-blank string", typeName(record.id));
  }
  if (!isValidEventTimestamp(record.timestamp)) {
    push(
      "base_record",
      "timestamp",
      "timestamp must be a strict RFC3339 instant with real calendar fields",
      "RFC3339 date-time",
      typeof record.timestamp === "string" ? record.timestamp : typeName(record.timestamp),
    );
  }
  if (!ACTOR_TYPES.includes(record.actor_type as ActorType)) {
    push("base_record", "actor_type", "actor_type must be one of the schema actor types", ACTOR_TYPES.join("|"), String(record.actor_type));
  }
  if (!isNonBlankString(record.actor_id)) {
    push("base_record", "actor_id", "actor_id must be a non-blank string", "non-blank string", typeName(record.actor_id));
  }
  if (typeof record.hash !== "string" || !SHA256_RE.test(record.hash)) {
    push("base_record", "hash", "hash must be a 64-char lowercase SHA-256 hex string", "^[0-9a-f]{64}$", String(record.hash));
  }
  if (record.previous_hash !== null && (typeof record.previous_hash !== "string" || !SHA256_RE.test(record.previous_hash))) {
    push("base_record", "previous_hash", "previous_hash must be null or a 64-char lowercase SHA-256 hex string", "null | ^[0-9a-f]{64}$", String(record.previous_hash));
  }
  if (record.trace_id !== null && !isNonBlankString(record.trace_id)) {
    push("base_record", "trace_id", "trace_id must be null or a non-blank string", "null | non-blank string", typeName(record.trace_id));
  }

  // --- event type must be a non-blank, registered string ---------------------
  if (!isNonBlankString(record.event_type)) {
    push("base_record", "event_type", "event_type must be a non-blank string", "non-blank string", typeName(record.event_type));
    return errors;
  }
  const convention = getConvention(record.event_type);
  if (!convention) {
    push(
      "unknown_event_type",
      "event_type",
      `event type '${record.event_type}' is not in the audit conventions registry — an unknown type is a violation until the registry and docs are intentionally updated`,
      EVENT_TYPES.join("|"),
      String(record.event_type),
    );
    return errors;
  }

  // --- actor type allowed ----------------------------------------------------
  if (!convention.allowedActorTypes.includes(record.actor_type as ActorType)) {
    push("actor_type", "actor_type", `actor_type '${record.actor_type}' is not allowed for '${record.event_type}'`, convention.allowedActorTypes.join("|"), String(record.actor_type));
  }

  // --- object binding --------------------------------------------------------
  const oc = convention.objectContract;
  if (oc.objectType === null) {
    if (record.object_type !== null) {
      push("object_type", "object_type", `object_type must be null for '${record.event_type}'`, "null", String(record.object_type));
    }
  } else if (oc.objectType === ANY_OBJECT_TYPE) {
    if (!isNonBlankString(record.object_type)) {
      push("object_type", "object_type", `object_type must be a non-blank string for '${record.event_type}'`, "non-blank string", typeName(record.object_type));
    }
  } else if (record.object_type !== oc.objectType) {
    push("object_type", "object_type", `object_type must be '${oc.objectType}' for '${record.event_type}'`, oc.objectType, String(record.object_type));
  }

  if (oc.objectId === "required") {
    if (!isNonBlankString(record.object_id)) {
      push("object_id", "object_id", `object_id must be a non-blank string for '${record.event_type}'`, "non-blank string", typeName(record.object_id));
    }
  } else if (oc.objectId === "null") {
    if (record.object_id !== null) {
      push("object_id", "object_id", `object_id must be null for '${record.event_type}'`, "null", String(record.object_id));
    }
  } else if (record.object_id !== null && !isNonBlankString(record.object_id)) {
    push("object_id", "object_id", `object_id must be null or a non-blank string for '${record.event_type}'`, "null | non-blank string", typeName(record.object_id));
  }

  // --- payload ---------------------------------------------------------------
  if (convention.payloadSchema === null) {
    if (record.payload !== null) {
      push("payload_null", "payload", `payload must be null for '${record.event_type}'`, "null", typeName(record.payload));
    }
  } else {
    const validate = PAYLOAD_VALIDATORS.get(record.event_type)!;
    if (!validate(record.payload)) {
      for (const e of validate.errors ?? []) {
        const sub = e.instancePath && e.instancePath.length ? e.instancePath.replace(/^\//, "").replace(/\//g, ".") : "";
        const path = sub ? `payload.${sub}` : "payload";
        push("payload_schema", path, `${e.keyword ?? "schema"}: ${e.message ?? "payload does not satisfy the contract"}`);
      }
    }
  }

  // --- venture references (must be non-blank strings when present) ------------
  for (const path of convention.ventureReferencePaths) {
    const v = readPath(record, path);
    if (v !== undefined && v !== null && !isNonBlankString(v)) {
      push("venture_reference", path, `declared venture reference '${path}' must be a non-blank string when present`, "non-blank string", typeName(v));
    }
  }

  // --- cross-field invariants -------------------------------------------------
  if (convention.validateInvariants) {
    for (const e of convention.validateInvariants(record)) errors.push(e);
  }

  return errors;
}

/**
 * The set of venture ids an event references, per the conventions: the universal
 * `object_type='venture'` rule plus every declared `ventureReferencePath` that
 * holds a non-blank string. NOT a recursive scan of arbitrary payload strings —
 * only the declared binding points count.
 */
export function ventureIdsReferenced(record: AuditEventRecord): Set<string> {
  const ids = new Set<string>();
  if (record.object_type === "venture" && isNonBlankString(record.object_id)) {
    ids.add(record.object_id);
  }
  const convention = getConvention(record.event_type);
  if (convention) {
    for (const path of convention.ventureReferencePaths) {
      const v = readPath(record, path);
      if (isNonBlankString(v)) ids.add(v);
    }
  }
  return ids;
}

// --- deterministic docs renderers --------------------------------------------

/** Markers the docs-drift guard uses to locate the summary table. */
export const CONVENTIONS_TABLE_START = "<!-- AUDIT_CONVENTIONS_TABLE_START -->";
export const CONVENTIONS_TABLE_END = "<!-- AUDIT_CONVENTIONS_TABLE_END -->";
/** Markers the docs-drift guard uses to locate the full contracts section. */
export const CONVENTIONS_CONTRACTS_START = "<!-- AUDIT_CONVENTIONS_CONTRACTS_START -->";
export const CONVENTIONS_CONTRACTS_END = "<!-- AUDIT_CONVENTIONS_CONTRACTS_END -->";

function cell(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function actorCell(c: EventConvention): string {
  return c.allowedActorTypes.map((a) => `\`${a}\``).join(", ");
}

function objectCell(c: EventConvention): string {
  const t =
    c.objectContract.objectType === null
      ? "null"
      : c.objectContract.objectType === ANY_OBJECT_TYPE
        ? "_(caller-supplied)_"
        : `\`${c.objectContract.objectType}\``;
  return `${t} / id ${c.objectContract.objectId}`;
}

function payloadCell(c: EventConvention): string {
  if (c.payloadSchema === null) return "_null_";
  const props = (c.payloadSchema.properties ?? {}) as Record<string, unknown>;
  const required = new Set((c.payloadSchema.required as string[]) ?? []);
  const names = Object.keys(props).map((k) => (required.has(k) ? `\`${k}\`` : `\`${k}\`?`));
  return names.join(", ");
}

/**
 * Render the canonical Phase 0 event-conventions SUMMARY table (deterministic
 * order) — the human quick-reference. The FULL machine-readable contract lives
 * in `renderConventionsContracts()`. `?` marks an optional payload field.
 */
export function renderConventionsTable(): string {
  const header =
    "| Event type | Issue | Owner module | Actor types | Object (type / id) | Payload fields | Invariants | Description |\n" +
    "|---|---|---|---|---|---|---|---|";
  const rows = EVENT_CONVENTIONS.map(
    (c) =>
      `| \`${cell(c.eventType)}\` | #${c.introducedByIssue} | \`${cell(c.ownerModule)}\` | ${actorCell(c)} | ${objectCell(c)} | ${payloadCell(c)} | ${c.invariants.length} | ${cell(c.description)} |`,
  );
  return [header, ...rows].join("\n");
}

// --- full contract renderer (type/enum/pattern/nullability/variants) ---------

/** Recursively rebuild a value with object keys sorted — for a stable render. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** The complete machine-readable contract of one event (order-independent). */
function contractObject(c: EventConvention): Record<string, unknown> {
  return {
    eventType: c.eventType,
    issue: c.introducedByIssue,
    ownerModule: c.ownerModule,
    allowedActorTypes: [...c.allowedActorTypes],
    objectContract: { objectType: c.objectContract.objectType, objectId: c.objectContract.objectId },
    payloadSchema: c.payloadSchema, // full JSON Schema: types, enums, patterns, nullability, required, additionalProperties
    ventureReferencePaths: [...c.ventureReferencePaths],
    invariants: [...c.invariants],
  };
}

/** Compact canonical JSON (sorted keys) of a value — used for the digest. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** Pretty, sorted-key JSON of a value — human-readable and deterministic. */
function prettyJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

/**
 * A SHA-256 over the canonical contract DEFINITIONS (documentation) — NOT an
 * event hash. Any change to a type, enum, pattern, nullability, required/optional
 * status, object binding, venture path, variant, or invariant changes it.
 */
export function contractsDigest(): string {
  const canonical = EVENT_CONVENTIONS.map((c) => canonicalJson(contractObject(c))).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Render the FULL contracts section: one canonical JSON block per event
 * (deterministic key order) plus the contracts digest. `docs/AUDIT_CONVENTIONS.md`
 * embeds exactly this between the contracts markers, and `pnpm check:audit` fails
 * if the two ever diverge — so a change to any field type, enum, pattern,
 * nullability, required/optional status, variant, or invariant fails CI until the
 * doc is regenerated.
 */
export function renderConventionsContracts(): string {
  const lines: string[] = [];
  for (const c of EVENT_CONVENTIONS) {
    lines.push(`#### \`${c.eventType}\``);
    lines.push("");
    lines.push("```json");
    lines.push(prettyJson(contractObject(c)));
    lines.push("```");
    lines.push("");
  }
  lines.push(`**Contracts digest (SHA-256 of the canonical contract definitions):** \`${contractsDigest()}\``);
  return lines.join("\n");
}
