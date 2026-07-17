/**
 * EvolveOS audit conventions registry (issue #13, P0-12) — the single
 * machine-readable source of truth for the Phase 0 event taxonomy.
 *
 * Part VI §1 makes the L0 `events` table the append-only source of truth; the
 * derived projections (users, ventures, gate_passes, decision_records,
 * system_stop_state) are views onto it. This module documents, in one place, the
 * CONTRACT of every event type a Phase 0 productive module emits: who may emit
 * it (actor types), what it is about (object type + object-id obligation), and
 * the exact shape of its payload (a JSON Schema, or `null` when the payload must
 * be null). It is DECLARATIVE only — it opens no transaction, reads no database,
 * emits no event, and never mutates a stored event.
 *
 * It is NOT a second hashing authority. app/src/lib/eventlog.ts remains the sole
 * owner of `canonicalize` / `computeHash` / `previous_hash` semantics and the
 * `events.seq` chain order; this registry adds a *convention* layer on top of the
 * integrity layer. A cryptographically valid event (its stored hash matches a
 * recomputation) can still be convention-invalid — an unknown event type, a wrong
 * actor type, a malformed payload — and `validateEventConvention` reports exactly
 * that, as structured errors, never a bare boolean.
 *
 * Runtime-immutable: every convention and its payload schema is deep-frozen at
 * load, the array is exported read-only and deterministically ordered (issue
 * ascending, then module emission order), and there are no duplicate event types.
 * The CLI (ops/verify-log.ts), the drift guard (ops/check-audit-conventions.ts),
 * and the tests all import from here — one inventory, no divergence.
 *
 * Adding an event type: append its convention here (in issue order), give it a
 * real productive writer, and mirror the row in docs/AUDIT_CONVENTIONS.md between
 * the table markers. `pnpm check:audit` fails CI until all three agree.
 */
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
 * NON-NULL value that varies per call. `approval.recorded` binds to whatever
 * artifact is being approved (a `decision-record`, or another object type);
 * `gate_passed` binds to a `venture` for pipeline gates and to the authorized
 * subject's type for standing gates. The contract requires a non-empty
 * `object_type`, but not one fixed string.
 */
export const ANY_OBJECT_TYPE = "*";

/** The obligation on `object_id` for an event type. */
export type ObjectIdRule = "required" | "null" | "optional";

export interface ObjectContract {
  /**
   * The exact required `object_type` string; `ANY_OBJECT_TYPE` when the writer
   * sets a caller-supplied non-null value; or `null` when `object_type` must be
   * null.
   */
  objectType: string | null;
  /** Whether `object_id` must be a non-empty string / must be null / may be either. */
  objectId: ObjectIdRule;
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
   * types (no coercion), required fields enumerated.
   */
  payloadSchema: Record<string, unknown> | null;
  /**
   * Dot-paths (in addition to the universal `object_type='venture'` rule) at
   * which a venture id may be referenced — used by the extract's `--venture`
   * filter so a venture-scoped event bound to another artifact (a standing gate
   * pass authorizing a subject, carrying `payload.venture_id`) is still matched.
   * Empty when the event carries no such reference.
   */
  ventureReferencePaths: readonly string[];
}

// --- shared payload schema fragments -----------------------------------------

const NON_EMPTY_STRING = { type: "string", minLength: 1 } as const;
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
    payloadSchema: strictObject({ display_name: NON_EMPTY_STRING }),
    ventureReferencePaths: [],
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
      proposer_actor_id: NON_EMPTY_STRING,
      // null for a non-decision-record approval; a 64-char SHA-256 hex for a
      // decision-record. Both cases go through this event type.
      object_digest: {
        oneOf: [{ type: "null" }, { type: "string", pattern: "^[0-9a-f]{64}$" }],
      },
    }),
    ventureReferencePaths: [],
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
      from: NON_EMPTY_STRING,
      to: NON_EMPTY_STRING,
      transition_kind: { type: "string", enum: ["handoff"] },
      authorization_gate_id: NON_EMPTY_STRING,
      authorization_ref: NON_EMPTY_STRING,
    }),
    ventureReferencePaths: [],
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
      evidence_ref: NON_EMPTY_STRING,
    }),
    ventureReferencePaths: [],
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
      reason: NON_EMPTY_STRING,
      post_mortem_ref: NON_EMPTY_STRING,
    }),
    ventureReferencePaths: [],
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
    // authorized subject (caller-supplied type). Both bind a non-null object_id.
    objectContract: { objectType: ANY_OBJECT_TYPE, objectId: "required" },
    // A single strict schema covering all three real shapes: the 13 common
    // fields are required; the four variant fields (effect, opportunity_ref for
    // G-01; subject_type/subject_id for standing gates) are optional. Types are
    // exact and additionalProperties is false, so a forged or malformed
    // gate_passed payload is rejected even though it links cryptographically.
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
        gate_id: NON_EMPTY_STRING,
        gate_name: NON_EMPTY_STRING,
        dr_id: NON_EMPTY_STRING,
        approval_event_id: NON_EMPTY_STRING,
        proposer_actor_id: NON_EMPTY_STRING,
        approver_actor_id: NON_EMPTY_STRING,
        // pipeline gates: an array (possibly empty); standing gates: array or null.
        kill_criteria: {
          oneOf: [{ type: "null" }, { type: "array", items: { type: "string" } }],
        },
        reversibility_class: NON_EMPTY_STRING,
        dr_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
        transition_kind: { type: "string", enum: ["gate_pass", "authorization"] },
        from_state: { oneOf: [{ type: "null" }, NON_EMPTY_STRING] },
        to_state: { oneOf: [{ type: "null" }, NON_EMPTY_STRING] },
        venture_id: { oneOf: [{ type: "null" }, NON_EMPTY_STRING] },
        // variant fields:
        effect: { type: "string", enum: ["venture_created", "stage_advanced"] },
        opportunity_ref: NON_EMPTY_STRING,
        subject_type: NON_EMPTY_STRING,
        subject_id: NON_EMPTY_STRING,
      },
    },
    // A standing gate pass is object-bound to the subject, but may carry the
    // related venture in payload.venture_id — the extract must match it there.
    ventureReferencePaths: ["payload.venture_id"],
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
      content_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
      schema_version: NON_EMPTY_STRING,
      amends_dr_id: { type: "null" },
    }),
    ventureReferencePaths: [],
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
      content_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
      schema_version: NON_EMPTY_STRING,
      amends_dr_id: NON_EMPTY_STRING,
    }),
    ventureReferencePaths: [],
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
      pack_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
      pack_version: NON_EMPTY_STRING,
      signer_actor_id: NON_EMPTY_STRING,
      signer_capacity: NON_EMPTY_STRING,
      acknowledgement_version: NON_EMPTY_STRING,
      session_id: NON_EMPTY_STRING,
    }),
    ventureReferencePaths: [],
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
      generation: { type: "integer", minimum: 1 },
      reason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING] },
      session_id: NON_EMPTY_STRING,
    }),
    ventureReferencePaths: [],
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
      generation: { type: "integer", minimum: 1 },
      rationale: NON_EMPTY_STRING,
      session_id: NON_EMPTY_STRING,
      released_stop_event_id: NON_EMPTY_STRING,
    }),
    ventureReferencePaths: [],
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

export type ConventionErrorCategory =
  | "base_record"
  | "unknown_event_type"
  | "actor_type"
  | "object_type"
  | "object_id"
  | "payload_null"
  | "payload_schema"
  | "venture_reference";

/** One structured convention failure: category + path + message (+ expected/actual). */
export interface ConventionError {
  category: ConventionErrorCategory;
  /** A dotted path within the event record (e.g. `payload.session_id`). */
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

const SHA256_RE = /^[0-9a-f]{64}$/;
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

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
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
 * Validate one event against the base record rules AND its event-type contract,
 * returning EVERY failure as a structured error (empty array = valid). This is a
 * pure primitive: no DB, no repair, no normalization — a historical event is
 * judged exactly as stored.
 *
 * Base rules (independent of type): non-empty `id`; a strict RFC3339 `timestamp`
 * with real calendar fields; `actor_type` in the schema enum; non-empty
 * `actor_id`; `event_type` registered; `hash` a 64-char lowercase SHA-256;
 * `previous_hash` null or SHA-256; `trace_id` null or non-empty.
 *
 * Contract rules (per type): `actor_type` allowed; exact `object_type` (or a
 * non-null one for the `*` sentinel, or null); `object_id` per its obligation;
 * payload null when the type carries no payload, else valid against the type's
 * strict JSON Schema (exact types, no coercion, additionalProperties false);
 * each declared venture-reference path, when present, a non-empty string.
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
  if (!isNonEmptyString(record.id)) {
    push("base_record", "id", "id must be a non-empty string", "non-empty string", typeName(record.id));
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
    push(
      "base_record",
      "actor_type",
      "actor_type must be one of the schema actor types",
      ACTOR_TYPES.join("|"),
      String(record.actor_type),
    );
  }
  if (!isNonEmptyString(record.actor_id)) {
    push("base_record", "actor_id", "actor_id must be a non-empty string", "non-empty string", typeName(record.actor_id));
  }
  if (typeof record.hash !== "string" || !SHA256_RE.test(record.hash)) {
    push("base_record", "hash", "hash must be a 64-char lowercase SHA-256 hex string", "^[0-9a-f]{64}$", String(record.hash));
  }
  if (record.previous_hash !== null && (typeof record.previous_hash !== "string" || !SHA256_RE.test(record.previous_hash))) {
    push("base_record", "previous_hash", "previous_hash must be null or a 64-char lowercase SHA-256 hex string", "null | ^[0-9a-f]{64}$", String(record.previous_hash));
  }
  if (record.trace_id !== null && !isNonEmptyString(record.trace_id)) {
    push("base_record", "trace_id", "trace_id must be null or a non-empty string", "null | non-empty string", typeName(record.trace_id));
  }

  // --- event type must be registered -----------------------------------------
  const convention = getConvention(record.event_type);
  if (!convention) {
    push(
      "unknown_event_type",
      "event_type",
      `event type '${record.event_type}' is not in the audit conventions registry — an unknown type is a violation until the registry and docs are intentionally updated`,
      EVENT_TYPES.join("|"),
      String(record.event_type),
    );
    // Without a contract, the object/payload rules cannot be applied.
    return errors;
  }

  // --- actor type allowed ----------------------------------------------------
  if (!convention.allowedActorTypes.includes(record.actor_type as ActorType)) {
    push(
      "actor_type",
      "actor_type",
      `actor_type '${record.actor_type}' is not allowed for '${record.event_type}'`,
      convention.allowedActorTypes.join("|"),
      String(record.actor_type),
    );
  }

  // --- object binding --------------------------------------------------------
  const oc = convention.objectContract;
  if (oc.objectType === null) {
    if (record.object_type !== null) {
      push("object_type", "object_type", `object_type must be null for '${record.event_type}'`, "null", String(record.object_type));
    }
  } else if (oc.objectType === ANY_OBJECT_TYPE) {
    if (!isNonEmptyString(record.object_type)) {
      push("object_type", "object_type", `object_type must be a non-empty string for '${record.event_type}'`, "non-empty string", typeName(record.object_type));
    }
  } else if (record.object_type !== oc.objectType) {
    push("object_type", "object_type", `object_type must be '${oc.objectType}' for '${record.event_type}'`, oc.objectType, String(record.object_type));
  }

  if (oc.objectId === "required") {
    if (!isNonEmptyString(record.object_id)) {
      push("object_id", "object_id", `object_id must be a non-empty string for '${record.event_type}'`, "non-empty string", typeName(record.object_id));
    }
  } else if (oc.objectId === "null") {
    if (record.object_id !== null) {
      push("object_id", "object_id", `object_id must be null for '${record.event_type}'`, "null", String(record.object_id));
    }
  } else {
    // optional: null or non-empty string
    if (record.object_id !== null && !isNonEmptyString(record.object_id)) {
      push("object_id", "object_id", `object_id must be null or a non-empty string for '${record.event_type}'`, "null | non-empty string", typeName(record.object_id));
    }
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

  // --- venture references (must be non-empty strings when present) ------------
  for (const path of convention.ventureReferencePaths) {
    const v = readPath(record, path);
    if (v !== undefined && v !== null && !isNonEmptyString(v)) {
      push("venture_reference", path, `declared venture reference '${path}' must be a non-empty string when present`, "non-empty string", typeName(v));
    }
  }

  return errors;
}

/**
 * The set of venture ids an event references, per the conventions: the universal
 * `object_type='venture'` rule plus every declared `ventureReferencePath` that
 * holds a non-empty string. NOT a recursive scan of arbitrary payload strings —
 * only the declared binding points count, so an unrelated payload string that
 * happens to equal a venture id is never treated as a reference.
 */
export function ventureIdsReferenced(record: AuditEventRecord): Set<string> {
  const ids = new Set<string>();
  if (record.object_type === "venture" && isNonEmptyString(record.object_id)) {
    ids.add(record.object_id);
  }
  const convention = getConvention(record.event_type);
  if (convention) {
    for (const path of convention.ventureReferencePaths) {
      const v = readPath(record, path);
      if (isNonEmptyString(v)) ids.add(v);
    }
  }
  return ids;
}

// --- deterministic docs table renderer ---------------------------------------

/** Markdown markers the docs-drift guard uses to locate the conventions table. */
export const CONVENTIONS_TABLE_START = "<!-- AUDIT_CONVENTIONS_TABLE_START -->";
export const CONVENTIONS_TABLE_END = "<!-- AUDIT_CONVENTIONS_TABLE_END -->";

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
 * Render the canonical Phase 0 event-conventions table (deterministic order).
 * `docs/AUDIT_CONVENTIONS.md` embeds exactly this between the table markers, and
 * `pnpm check:audit` fails if the two ever diverge. `?` marks an optional field.
 */
export function renderConventionsTable(): string {
  const header =
    "| Event type | Issue | Owner module | Actor types | Object (type / id) | Payload fields | Description |\n" +
    "|---|---|---|---|---|---|---|";
  const rows = EVENT_CONVENTIONS.map(
    (c) =>
      `| \`${cell(c.eventType)}\` | #${c.introducedByIssue} | \`${cell(c.ownerModule)}\` | ${actorCell(c)} | ${objectCell(c)} | ${payloadCell(c)} | ${cell(c.description)} |`,
  );
  return [header, ...rows].join("\n");
}
