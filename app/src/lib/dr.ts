/**
 * EvolveOS Decision Record tooling (issue #10, P0-9). Create, validate, file
 * (immutably), amend, read, and render Decision Records.
 *
 * This module is the SINGLE owner of DR content canonicalization and the DR
 * store: nothing else computes a DR digest or writes `decision_records`
 * (ops/check-dr-writer.mjs enforces this in CI). The gate system (issue #9,
 * gates.ts) IMPORTS the content primitives from here — it never re-implements
 * canonicalization or the digest, so a gate pass binds to exactly the bytes
 * this module filed.
 *
 * Canonicalization is the one established in issue #9 and is BINDING:
 *   digest = SHA-256_lowercase_hex( canonicalize(document) )
 * where `canonicalize` is eventlog.ts's deterministic key-sorted JSON. A golden
 * test pins the digest so the refactor cannot silently change it.
 *
 * Immutability (Part VII §2.2): a filed DR is append-only at the DB layer
 * (UPDATE/DELETE/TRUNCATE are rejected by triggers). The only way to change or
 * complete a filed decision is to file ANOTHER immutable DR that references the
 * original via `amends_dr_id` — the original bytes never change.
 *
 * dr.ts NEVER imports gates.ts (no cycle). Gate-specific semantics (which gate,
 * approved status, reversibility-vs-gate, kill-mandatory-per-registry) stay in
 * gates.ts; DR-intrinsic semantics (Part VII option/kill/rollback rules) live
 * here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEventTx, acquireEventChainLock, canonicalize } from "./eventlog.js";

type Queryable = Client | PoolClient;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Current DR schema version — stamped onto every filed document. */
export const DR_SCHEMA_VERSION = "1.0.0";

// --- Document shape (canonical owner of the DR type) -------------------------

export interface DecisionRecordOption {
  option_id: string;
  summary: string;
  predicted_outcome_distribution?: Record<string, unknown> | null;
  evidence_refs?: string[];
  risk_note?: string | null;
}

export interface DecisionRecordDissent {
  author?: string | null;
  position?: string | null;
  argument: string;
  reference?: string | null;
  shown_to_humans?: boolean;
}

export interface DecisionRecordDoc {
  schema_version?: string;
  id: string;
  title: string;
  proposer: string;
  approver?: string | null;
  gate_id?: string | null;
  reversibility_class: string;
  autonomy_level_involved?: string | null;
  decision: string;
  rationale?: string;
  assumptions?: string[];
  evidence_links?: string[];
  risks?: string[];
  kill_criteria?: string[];
  rollback_plan?: string | null;
  options?: DecisionRecordOption[];
  chosen_option?: string | null;
  dissent_record?: DecisionRecordDissent[];
  amends_dr_id?: string | null;
  status: string;
  created_at?: string | null;
  decided_at?: string | null;
  human_approval?: Record<string, unknown> | null;
}

/** Content submitted for filing: the store mints `id` and stamps `schema_version`. */
export type DecisionRecordInput = Omit<DecisionRecordDoc, "id" | "schema_version">;

// --- ajv (CJS under NodeNext ESM: require + .default; see gates.ts) ----------

interface AjvError {
  instancePath?: string;
  keyword?: string;
  message?: string;
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
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateDrSchema = ajv.compile(
  JSON.parse(readFileSync(join(REPO_ROOT, "schemas", "decision-record.schema.json"), "utf8")),
);

// --- Validation (field-level errors) -----------------------------------------

/** One structured validation failure: a JSON-Pointer path, a keyword, a message. */
export interface DrFieldError {
  path: string;
  keyword: string;
  message: string;
}

export interface DrValidationResult {
  ok: boolean;
  errors: DrFieldError[];
}

const R2_PLUS = new Set(["R2", "R3", "R4"]);
const R3_PLUS = new Set(["R3", "R4"]);

function isBlank(v: unknown): boolean {
  return typeof v !== "string" || v.trim().length === 0;
}

/**
 * Validate a FULL Decision Record document (with `id`): JSON Schema first, then
 * the Part VII DR-intrinsic semantic rules. Returns every failure as a
 * structured field error (path + keyword + message) — never a single opaque
 * string. Gate-specific rules are NOT applied here (they live in gates.ts).
 */
export function validateDecisionRecord(document: unknown): DrValidationResult {
  const errors: DrFieldError[] = [];
  if (!validateDrSchema(document)) {
    for (const e of validateDrSchema.errors ?? []) {
      errors.push({
        path: e.instancePath && e.instancePath.length ? e.instancePath : "/",
        keyword: e.keyword ?? "schema",
        message: e.message ?? "schema violation",
      });
    }
    // Schema failed: object shape is unreliable, so stop before semantic checks.
    return { ok: false, errors };
  }
  const dr = document as DecisionRecordDoc;

  // Required auditable strings must not be whitespace-only (schema minLength 1
  // still admits "   ").
  for (const field of ["title", "proposer", "decision"] as const) {
    if (isBlank(dr[field])) {
      errors.push({ path: `/${field}`, keyword: "non_blank", message: `${field} must not be blank` });
    }
  }

  const options = dr.options ?? [];
  const optionIds = options.map((o) => o.option_id);
  const seen = new Set<string>();
  for (let i = 0; i < optionIds.length; i++) {
    const id = optionIds[i];
    if (seen.has(id)) {
      errors.push({
        path: `/options/${i}/option_id`,
        keyword: "unique",
        message: `duplicate option_id '${id}'`,
      });
    }
    seen.add(id);
  }
  for (let i = 0; i < options.length; i++) {
    if (isBlank(options[i].summary)) {
      errors.push({
        path: `/options/${i}/summary`,
        keyword: "non_blank",
        message: "option summary must not be blank",
      });
    }
  }

  if (options.length > 0) {
    if (dr.chosen_option == null || dr.chosen_option === "") {
      errors.push({
        path: "/chosen_option",
        keyword: "required",
        message: "chosen_option is required when options are present",
      });
    } else if (!optionIds.includes(dr.chosen_option)) {
      errors.push({
        path: "/chosen_option",
        keyword: "reference",
        message: `chosen_option '${dr.chosen_option}' does not match any option_id`,
      });
    }
  } else if (dr.chosen_option != null && dr.chosen_option !== "") {
    errors.push({
      path: "/chosen_option",
      keyword: "reference",
      message: "chosen_option is set but no options are present",
    });
  }

  if (R3_PLUS.has(dr.reversibility_class)) {
    if (options.length < 2) {
      errors.push({
        path: "/options",
        keyword: "min_options",
        message: `${dr.reversibility_class} decisions require at least two options (Part VII §2.2)`,
      });
    }
    // Uncertainty is mandatory content for R3/R4 (Part VII §8.2: the brief must
    // show it, so the DR must contain it). An option with no
    // predicted_outcome_distribution — or an empty {} — carries no predictive
    // information and is rejected. The field stays structurally optional in the
    // schema so R1/R2 documents remain filable without it.
    for (let i = 0; i < options.length; i++) {
      const d = options[i].predicted_outcome_distribution;
      if (d == null || typeof d !== "object" || Object.keys(d).length === 0) {
        errors.push({
          path: `/options/${i}/predicted_outcome_distribution`,
          keyword: "required",
          message: `${dr.reversibility_class} options require a non-empty predicted_outcome_distribution (Part VII §8.2 uncertainty)`,
        });
      }
    }
    // The §8.2 brief must surface the top risks for a material decision — an
    // R3/R4 DR with zero recorded risks would render "No risks recorded".
    const nonBlankRisks = (dr.risks ?? []).filter((r) => !isBlank(r));
    if (nonBlankRisks.length === 0) {
      errors.push({
        path: "/risks",
        keyword: "required",
        message: `${dr.reversibility_class} decisions require at least one non-blank risk (Part VII §8.2 top risks)`,
      });
    }
  }

  if (R2_PLUS.has(dr.reversibility_class)) {
    const kills = (dr.kill_criteria ?? []).filter((k) => !isBlank(k));
    if (kills.length === 0) {
      errors.push({
        path: "/kill_criteria",
        keyword: "required",
        message: `${dr.reversibility_class} decisions require at least one non-blank kill criterion (Part VII §2.2)`,
      });
    }
    if (isBlank(dr.rollback_plan)) {
      errors.push({
        path: "/rollback_plan",
        keyword: "required",
        message: `${dr.reversibility_class} decisions require a non-blank rollback_plan (Part VII §2.2)`,
      });
    }
  }

  for (let i = 0; i < (dr.dissent_record ?? []).length; i++) {
    if (isBlank((dr.dissent_record as DecisionRecordDissent[])[i].argument)) {
      errors.push({
        path: `/dissent_record/${i}/argument`,
        keyword: "non_blank",
        message: "dissent argument must not be blank",
      });
    }
  }

  if (dr.amends_dr_id != null && dr.amends_dr_id === dr.id) {
    errors.push({
      path: "/amends_dr_id",
      keyword: "self_reference",
      message: "a decision record cannot amend itself",
    });
  }

  return { ok: errors.length === 0, errors };
}

function formatErrors(errors: DrFieldError[]): string {
  return errors.map((e) => `${e.path} [${e.keyword}] ${e.message}`).join("; ");
}

/** Thrown by filing when the document is invalid; carries the field errors. */
export class DecisionRecordInvalid extends Error {
  readonly errors: DrFieldError[];
  constructor(errors: DrFieldError[]) {
    super(`decision record is invalid: ${formatErrors(errors)}`);
    this.name = "DecisionRecordInvalid";
    this.errors = errors;
  }
}

// --- Canonical snapshot + digest (the ONE shared with the gate system) -------

export interface DrContentSnapshot {
  /** Validated deep clone — the only document a caller should use from here. */
  document: DecisionRecordDoc;
  /** Canonical, deterministic key-sorted JSON — the exact bytes hashed/stored. */
  canonicalJson: string;
  /** SHA-256 (lowercase hex) of `canonicalJson`. */
  digest: string;
}

/** SHA-256 (lowercase hex) of a DR's canonical JSON. The canonical digest API. */
export function digestDecisionRecordContent(document: DecisionRecordDoc): string {
  return createHash("sha256").update(canonicalize(document), "utf8").digest("hex");
}

/**
 * Canonical, immutable snapshot of a DR document: canonical JSON, deep clone,
 * schema + semantic validation of the CLONE, and the SHA-256 digest. Fully
 * synchronous, so callers run it before their first `await`. Reused verbatim by
 * gates.ts so the gate binds to exactly these bytes. Throws
 * `DecisionRecordInvalid` on any validation failure.
 */
export function snapshotDecisionRecordContent(input: DecisionRecordDoc): DrContentSnapshot {
  const canonicalJson = canonicalize(input);
  const document = JSON.parse(canonicalJson) as DecisionRecordDoc; // deep clone
  const result = validateDecisionRecord(document);
  if (!result.ok) throw new DecisionRecordInvalid(result.errors);
  return {
    document,
    canonicalJson,
    digest: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
  };
}

// --- Store: filing, amendments, reads ----------------------------------------

export interface StoredDecisionRecord {
  id: string;
  document: DecisionRecordDoc;
  canonicalJson: string;
  digest: string;
  schemaVersion: string;
  amendsDrId: string | null;
  fileEventId: string;
  filedBy: string;
  filedAt: string;
}

export interface FileDecisionRecordResult {
  id: string;
  digest: string;
  eventId: string;
  document: DecisionRecordDoc;
  amendsDrId: string | null;
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

/**
 * Recursively freeze a value: objects, arrays, objects nested inside arrays —
 * every reachable layer. `Object.freeze` alone is shallow; a caller could still
 * push into `options` or rewrite `options[0].summary`. The frozen value is
 * plain JSON (deep-cloned from canonical bytes), so there are no cycles.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

async function inDrTx<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await acquireEventChainLock(client); // lock order: advisory FIRST (issue #7)
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function mintDrIdTx(client: Queryable, year: number): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO decision_record_counters (year, last_seq) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_seq = decision_record_counters.last_seq + 1
     RETURNING last_seq`,
    [year],
  );
  return `DR-${year}-${rows[0].last_seq}`;
}

/** Deep clone via canonical JSON (also drops undefined members deterministically). */
function cloneInput(input: DecisionRecordInput): DecisionRecordInput {
  return JSON.parse(canonicalize(input)) as DecisionRecordInput;
}

async function fileInternal(
  client: Queryable,
  captured: {
    docClone: DecisionRecordInput;
    filedBy: string;
    year: number;
    amendsDrId: string | null;
    eventType: "decision_record.filed" | "decision_record.amended";
  },
): Promise<FileDecisionRecordResult> {
  return inDrTx(client, async () => {
    // An amendment MUST reference an existing DR (also enforced by the FK).
    if (captured.amendsDrId != null) {
      const target = await client.query("SELECT 1 FROM decision_records WHERE id = $1", [
        captured.amendsDrId,
      ]);
      if (!target.rows.length) {
        throw new Error(`amends_dr_id references a non-existent decision record: ${captured.amendsDrId}`);
      }
    }
    const id = await mintDrIdTx(client, captured.year);
    // The store is authoritative for id, schema_version, and amends_dr_id.
    const finalDoc: DecisionRecordDoc = {
      ...captured.docClone,
      id,
      schema_version: DR_SCHEMA_VERSION,
      amends_dr_id: captured.amendsDrId,
    } as DecisionRecordDoc;
    if (finalDoc.amends_dr_id === finalDoc.id) {
      throw new Error("a decision record cannot amend itself");
    }
    const snap = snapshotDecisionRecordContent(finalDoc);

    const event = await appendEventTx(client, {
      id: `EV-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: captured.filedBy,
      event_type: captured.eventType,
      object_type: "decision-record",
      object_id: id,
      payload: {
        content_digest: snap.digest,
        schema_version: DR_SCHEMA_VERSION,
        amends_dr_id: captured.amendsDrId,
      },
    });

    await client.query(
      `INSERT INTO decision_records
         (id, canonical_json, document_json, content_digest, schema_version,
          amends_dr_id, file_event_id, filed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        snap.canonicalJson,
        snap.canonicalJson, // JSONB — stored from the SAME canonical bytes
        snap.digest,
        DR_SCHEMA_VERSION,
        captured.amendsDrId,
        event.id,
        captured.filedBy,
      ],
    );

    return {
      id,
      digest: snap.digest,
      eventId: event.id,
      document: snap.document,
      amendsDrId: captured.amendsDrId,
    };
  });
}

/**
 * File a new immutable Decision Record. Mints `DR-yyyy-seq`, stamps
 * `schema_version`, validates the final document, computes the canonical JSON +
 * digest, emits exactly one `decision_record.filed` event, and inserts the row
 * — all atomically. The whole request is captured before the first `await`.
 */
export async function fileDecisionRecord(
  client: Queryable,
  input: { document: DecisionRecordInput; filedBy: string; year?: number },
): Promise<FileDecisionRecordResult> {
  const captured = {
    docClone: cloneInput(input.document),
    filedBy: requireNonEmpty(input.filedBy, "filedBy"),
    year: input.year ?? new Date().getUTCFullYear(),
    amendsDrId: null as string | null,
    eventType: "decision_record.filed" as const,
  };
  return fileInternal(client, captured);
}

/**
 * File an amendment: a NEW immutable DR that references an existing one via
 * `amends_dr_id` and is recorded with a `decision_record.amended` event. The
 * original bytes never change — this is the only way to "revise" a filed DR.
 */
export async function fileDecisionRecordAmendment(
  client: Queryable,
  input: {
    amendsDrId: string;
    document: DecisionRecordInput;
    filedBy: string;
    year?: number;
  },
): Promise<FileDecisionRecordResult> {
  const captured = {
    docClone: cloneInput(input.document),
    filedBy: requireNonEmpty(input.filedBy, "filedBy"),
    year: input.year ?? new Date().getUTCFullYear(),
    amendsDrId: requireNonEmpty(input.amendsDrId, "amendsDrId"),
    eventType: "decision_record.amended" as const,
  };
  return fileInternal(client, captured);
}

/**
 * Read a filed DR and VERIFY it at the trust boundary. A row is only returned
 * after ALL of:
 *   1. `content_digest` is a well-formed SHA-256 hex string and equals a fresh
 *      recomputation over the stored canonical bytes;
 *   2. the canonical bytes round-trip (they really are canonical) and the JSONB
 *      projection canonicalizes to exactly the same string;
 *   3. the parsed document still passes `validateDecisionRecord` (schema +
 *      Part VII semantics) — a stored document that no longer validates is
 *      corruption, not data;
 *   4. column↔document bindings hold: `document.id === row.id`,
 *      `document.schema_version === row.schema_version`,
 *      `document.amends_dr_id ?? null === row.amends_dr_id`;
 *   5. the filing EVENT semantically represents this row: it exists, its type
 *      is `decision_record.filed` (or `.amended` when `amends_dr_id` is set),
 *      `object_type`/`object_id`/`actor_id` match the row, and its payload's
 *      `content_digest` / `schema_version` / `amends_dr_id` match the row — a
 *      mere FK to *some* event is not evidence.
 * Any mismatch throws a specific corruption error — corruption is rejected,
 * never returned as if trustworthy. The returned document is a DEEP-frozen
 * deep clone (objects, arrays, and nested objects all frozen).
 */
export async function getDecisionRecord(
  client: Queryable,
  id: string,
): Promise<StoredDecisionRecord | null> {
  const { rows } = await client.query<{
    id: string;
    canonical_json: string;
    document_json: unknown;
    content_digest: string;
    schema_version: string;
    amends_dr_id: string | null;
    file_event_id: string;
    filed_by: string;
    filed_at: string;
  }>(
    `SELECT id, canonical_json, document_json, content_digest, schema_version,
            amends_dr_id, file_event_id, filed_by, filed_at::text AS filed_at
       FROM decision_records WHERE id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const row = rows[0];

  // 1. Digest: well-formed, and the canonical bytes still hash to it.
  if (!/^[0-9a-f]{64}$/.test(row.content_digest)) {
    throw new Error(
      `decision record ${id} is corrupt: content_digest is not a 64-char SHA-256 hex string`,
    );
  }
  const recomputed = createHash("sha256").update(row.canonical_json, "utf8").digest("hex");
  if (recomputed !== row.content_digest) {
    throw new Error(
      `decision record ${id} is corrupt: stored digest ${row.content_digest.slice(0, 12)}… does not match its canonical bytes (${recomputed.slice(0, 12)}…)`,
    );
  }
  // 2. The parsed canonical bytes must round-trip to themselves (stored bytes
  // are canonical) AND the JSONB projection must canonicalize to the same string.
  const parsed = JSON.parse(row.canonical_json) as DecisionRecordDoc;
  if (canonicalize(parsed) !== row.canonical_json) {
    throw new Error(`decision record ${id} is corrupt: stored canonical_json is not canonical`);
  }
  if (canonicalize(row.document_json) !== row.canonical_json) {
    throw new Error(
      `decision record ${id} is corrupt: document_json does not match canonical_json`,
    );
  }
  // 3. The archived document must STILL be a valid Decision Record.
  const validation = validateDecisionRecord(parsed);
  if (!validation.ok) {
    throw new Error(
      `decision record ${id} is corrupt: the stored document no longer validates: ${formatErrors(validation.errors)}`,
    );
  }
  // 4. Column ↔ document bindings.
  if (parsed.id !== row.id) {
    throw new Error(
      `decision record ${id} is corrupt: the stored document carries id '${parsed.id}'`,
    );
  }
  if ((parsed.schema_version ?? null) !== row.schema_version) {
    throw new Error(
      `decision record ${id} is corrupt: document schema_version '${parsed.schema_version ?? "none"}' does not match the row's '${row.schema_version}'`,
    );
  }
  if ((parsed.amends_dr_id ?? null) !== row.amends_dr_id) {
    throw new Error(
      `decision record ${id} is corrupt: document amends_dr_id '${parsed.amends_dr_id ?? "null"}' does not match the row's '${row.amends_dr_id ?? "null"}'`,
    );
  }
  // 5. The filing event must semantically represent this filing.
  const expectedType =
    row.amends_dr_id === null ? "decision_record.filed" : "decision_record.amended";
  const ev = await client.query<{
    event_type: string;
    actor_id: string;
    object_type: string | null;
    object_id: string | null;
    payload: {
      content_digest?: unknown;
      schema_version?: unknown;
      amends_dr_id?: unknown;
    } | null;
  }>(
    "SELECT event_type, actor_id, object_type, object_id, payload FROM events WHERE id = $1",
    [row.file_event_id],
  );
  if (!ev.rows.length) {
    throw new Error(
      `decision record ${id} is corrupt: filing event ${row.file_event_id} does not exist`,
    );
  }
  const e = ev.rows[0];
  if (e.event_type !== expectedType) {
    throw new Error(
      `decision record ${id} is corrupt: filing event ${row.file_event_id} is '${e.event_type}', expected '${expectedType}'`,
    );
  }
  if (e.object_type !== "decision-record") {
    throw new Error(
      `decision record ${id} is corrupt: filing event ${row.file_event_id} is for object_type '${e.object_type}', not a decision-record`,
    );
  }
  if (e.object_id !== row.id) {
    throw new Error(
      `decision record ${id} is corrupt: filing event ${row.file_event_id} filed '${e.object_id}', not this record`,
    );
  }
  if (e.actor_id !== row.filed_by) {
    throw new Error(
      `decision record ${id} is corrupt: filing event actor '${e.actor_id}' does not match filed_by '${row.filed_by}'`,
    );
  }
  if (e.payload?.content_digest !== row.content_digest) {
    throw new Error(
      `decision record ${id} is corrupt: filing event payload digest does not match content_digest`,
    );
  }
  if (e.payload?.schema_version !== row.schema_version) {
    throw new Error(
      `decision record ${id} is corrupt: filing event payload schema_version does not match the row`,
    );
  }
  if ((e.payload?.amends_dr_id ?? null) !== row.amends_dr_id) {
    throw new Error(
      `decision record ${id} is corrupt: filing event payload amends_dr_id does not match the row`,
    );
  }

  return {
    id: row.id,
    document: deepFreeze(parsed),
    canonicalJson: row.canonical_json,
    digest: row.content_digest,
    schemaVersion: row.schema_version,
    amendsDrId: row.amends_dr_id,
    fileEventId: row.file_event_id,
    filedBy: row.filed_by,
    filedAt: row.filed_at,
  };
}

/** The chain of amendments that reference `id` (most recent first). */
export async function getAmendmentsOf(
  client: Queryable,
  id: string,
): Promise<{ id: string; filedBy: string; filedAt: string; digest: string }[]> {
  const { rows } = await client.query<{
    id: string;
    filed_by: string;
    filed_at: string;
    content_digest: string;
  }>(
    `SELECT id, filed_by, filed_at::text AS filed_at, content_digest
       FROM decision_records WHERE amends_dr_id = $1 ORDER BY filed_at DESC, id DESC`,
    [id],
  );
  return rows.map((r) => ({
    id: r.id,
    filedBy: r.filed_by,
    filedAt: r.filed_at,
    digest: r.content_digest,
  }));
}

// --- Decision brief renderer (Part VII §8.2) ---------------------------------

/**
 * Operational two-page approximation. Markdown has no stable pagination, so the
 * limit is a conservative word budget (~450 words/page). Mandatory content is
 * NEVER truncated to fit — overflow throws `DecisionBriefTooLong` so the caller
 * compresses the DR itself rather than shipping an incomplete brief.
 */
export const DECISION_BRIEF_WORD_LIMIT = 900;

export class DecisionBriefTooLong extends Error {
  readonly words: number;
  readonly limit: number;
  constructor(words: number, limit: number) {
    super(
      `decision brief is ${words} words, over the ${limit}-word (~2 page) limit — ` +
        `compress the decision record (never truncate dissent or risks)`,
    );
    this.name = "DecisionBriefTooLong";
    this.words = words;
    this.limit = limit;
  }
}

function countWords(md: string): number {
  const t = md.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

function outcomeCell(o: DecisionRecordOption): string {
  const d = o.predicted_outcome_distribution;
  if (!d || typeof d !== "object") return "—";
  const parts: string[] = [];
  if (typeof d.primary_metric === "string") parts.push(String(d.primary_metric));
  if (typeof d.representation === "string") parts.push(`(${String(d.representation)})`);
  if (d.quantiles && typeof d.quantiles === "object") {
    const q = d.quantiles as Record<string, unknown>;
    const bits = Object.keys(q)
      .map((k) => `${k}=${String(q[k])}`)
      .join(", ");
    if (bits) parts.push(bits);
  }
  return parts.length ? mdEscape(parts.join(" ")) : "—";
}

function uncertaintyCell(o: DecisionRecordOption): string {
  const d = o.predicted_outcome_distribution;
  if (!d || typeof d !== "object") return "—";
  if (typeof d.epistemic_share === "number") {
    return `epistemic share ${d.epistemic_share}`;
  }
  if (typeof d.representation === "string") return mdEscape(String(d.representation));
  return "—";
}

/** Escape the pipe and newline characters that would break a markdown table cell. */
function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Render a filed DR into a deterministic ≤2-page markdown decision brief, in the
 * exact Part VII §8.2 order. Dissent is reproduced VERBATIM and never
 * summarized; at most three risks are surfaced (the rest are pointed to, not
 * hidden). Throws `DecisionBriefTooLong` if the mandatory content exceeds the
 * word budget.
 */
export function renderDecisionBrief(record: {
  document: DecisionRecordDoc;
  digest: string;
  amendsDrId?: string | null;
}): string {
  const dr = record.document;
  const amendsDrId = record.amendsDrId ?? dr.amends_dr_id ?? null;
  const lines: string[] = [];

  lines.push(`# Decision Brief — ${dr.id}`, "");

  // 1. The ask.
  const drAny = dr as unknown as Record<string, unknown>;
  const envelope =
    typeof drAny.envelope_delta === "string" ? `, envelope delta: ${drAny.envelope_delta}` : "";
  lines.push("## 1. The ask", "");
  lines.push(
    `${dr.decision.trim()} — reversibility **${dr.reversibility_class}**, gate **${dr.gate_id ?? "—"}**${envelope}.`,
    "",
  );

  // 2. Options.
  lines.push("## 2. Options", "");
  const options = dr.options ?? [];
  if (options.length === 0) {
    lines.push("_No options recorded._", "");
  } else {
    lines.push("| Option | Chosen | Summary | Predicted outcome | Uncertainty |");
    lines.push("|---|---|---|---|---|");
    for (const o of options) {
      const chosen = dr.chosen_option === o.option_id ? "✓" : "";
      lines.push(
        `| \`${mdEscape(o.option_id)}\` | ${chosen} | ${mdEscape(o.summary)} | ${outcomeCell(o)} | ${uncertaintyCell(o)} |`,
      );
    }
    lines.push("");
  }

  // 3. Top three risks. §8.2 requires each shown risk to state its mitigation
  // or its absence flatly. The Phase 0 DR keeps risks as plain strings with no
  // separate mitigation field, so the absence is declared explicitly and
  // honestly — never invented. (An R3/R4 DR cannot reach here with zero risks:
  // validateDecisionRecord rejects it at filing.)
  lines.push("## 3. Top three risks", "");
  const risks = (dr.risks ?? []).filter((r) => !isBlank(r));
  if (risks.length === 0) {
    lines.push("_No risks recorded._", "");
  } else {
    risks.slice(0, 3).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.trim()}`);
      lines.push("   - Mitigation: not separately recorded in the Phase 0 DR.");
    });
    if (risks.length > 3) {
      lines.push(`- …and ${risks.length - 3} more (see the full decision record).`);
    }
    lines.push("");
  }

  // 4. Dissent, verbatim.
  lines.push("## 4. Dissent (verbatim)", "");
  const dissent = dr.dissent_record ?? [];
  if (dissent.length === 0) {
    lines.push("_No dissent recorded._", "");
  } else {
    for (const d of dissent) {
      const who = d.author ? `**${d.author}**` : "**(unattributed)**";
      const pos = d.position ? ` (position: ${d.position})` : "";
      const ref = d.reference ? ` [${d.reference}]` : "";
      lines.push(`- ${who}${pos}: ${d.argument}${ref}`);
    }
    lines.push("");
  }

  // 5. Kill criteria and rollback.
  lines.push("## 5. Kill criteria and rollback", "");
  const kills = (dr.kill_criteria ?? []).filter((k) => !isBlank(k));
  if (kills.length === 0) {
    lines.push("**Kill criteria:** _none recorded._");
  } else {
    lines.push("**Kill criteria:**");
    for (const k of kills) lines.push(`- ${k.trim()}`);
  }
  lines.push(
    `**Rollback plan:** ${isBlank(dr.rollback_plan) ? "_none recorded._" : (dr.rollback_plan as string).trim()}`,
    "",
  );

  // 6. Drill-down.
  lines.push("## 6. Drill-down", "");
  lines.push(`- Decision record: \`${dr.id}\` (schema ${dr.schema_version ?? DR_SCHEMA_VERSION})`);
  lines.push(`- Content digest: \`${record.digest}\``);
  const evidence = (dr.evidence_links ?? []).filter((e) => !isBlank(e));
  if (evidence.length) {
    lines.push(`- Evidence: ${evidence.map((e) => `\`${e}\``).join(", ")}`);
  }
  if (amendsDrId) {
    lines.push(`- Amends: \`${amendsDrId}\``);
  }
  lines.push("- Full record and simulation traces: stored decision_records row (drill-down unlimited).");
  lines.push("");

  const md = lines.join("\n");
  const words = countWords(md);
  if (words > DECISION_BRIEF_WORD_LIMIT) {
    throw new DecisionBriefTooLong(words, DECISION_BRIEF_WORD_LIMIT);
  }
  return md;
}
