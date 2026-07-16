/**
 * EvolveOS founding-ratification CORE (issue #11, P0-10) — the pure primitives
 * plus the INJECTABLE database evaluators. NO productive file loader lives here:
 * the only productive wrapper is app/src/lib/flags.ts, which always loads the
 * canonical docs/RATIFICATION_PACK.md and passes its exact bytes in. No other
 * production file may import this module (ops/check-ratification-writer.mjs
 * enforces that), so there is no productive API that activates the flag from
 * arbitrary bytes.
 *
 * Contents:
 *   - exact-byte SHA-256 digest of the pack (NOT the DR JSON canonicalization);
 *   - strict manifest extraction (exactly one JSON block between the markers);
 *   - strict manifest validation with structured {path, keyword, message} errors,
 *     including the CONSTITUTIONAL INVENTORIES (required threshold ids, the
 *     THR-SPEND-EXEC = 0 no-spend invariant, and the required capacity policy);
 *   - DERIVED readiness (never trusts the declared booleans);
 *   - required signers DERIVED from role_assignments (one list, no divergence);
 *   - deterministic renderers + runtime table/section binding;
 *   - full structural validation of a signature evidence event;
 *   - the injectable DB evaluators (`recordSignatureForSnapshot`,
 *     `evaluateRealMoneyForSnapshot`) — signatures are bound to an active session
 *     and the flag is evaluated inside one serialized REPEATABLE READ transaction.
 *
 * This module builds NO real-money mechanism. `real_money = true` records that a
 * human ratification act happened; THR-SPEND-EXEC is pinned to 0 and no spend is
 * ever executed here.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEventTx, acquireEventChainLock } from "./eventlog.js";
import { hasActiveRole } from "./auth.js";

type Queryable = Client | PoolClient;

export const RATIFICATION_EVENT_TYPE = "ratification.signature_recorded";
export const RATIFICATION_OBJECT_TYPE = "founding-ratification-pack";

/** Capacities a required signer may hold. Frozen at runtime. */
export const KNOWN_CAPACITIES = Object.freeze([
  "founding_signatory",
  "portfolio_review_lead",
  "operator",
  "curator",
] as const);
export type KnownCapacity = (typeof KNOWN_CAPACITIES)[number];

/** The complete, immutable inventory of pathfinder thresholds the pack must carry. */
export const REQUIRED_THRESHOLD_IDS = Object.freeze([
  "THR-SPEND-EXEC",
  "THR-RERATIFY",
  "THR-CAPITAL",
  "THR-R1",
  "THR-R2",
  "THR-R3",
  "THR-R4",
  "THR-G01",
  "THR-G02",
  "THR-G03",
  "THR-G04",
  "THR-G05",
  "THR-G06",
] as const);

/** The no-spend invariant identifier and its pinned deployment value. */
export const SPEND_EXEC_ID = "THR-SPEND-EXEC";

/**
 * Constitutional capacity policy: exactly one founding_signatory / one
 * portfolio_review_lead / one curator, and at least one operator, all as
 * required signers. Frozen at runtime.
 */
export const REQUIRED_SIGNER_POLICY = Object.freeze({
  singular: Object.freeze(["founding_signatory", "portfolio_review_lead", "curator"] as const),
  atLeastOne: Object.freeze(["operator"] as const),
});

export const MANIFEST_START = "<!-- RATIFICATION_MANIFEST_START -->";
export const MANIFEST_END = "<!-- RATIFICATION_MANIFEST_END -->";
export const THRESHOLDS_START = "<!-- RATIFICATION_THRESHOLDS_START -->";
export const THRESHOLDS_END = "<!-- RATIFICATION_THRESHOLDS_END -->";
export const ROLES_START = "<!-- RATIFICATION_ROLES_START -->";
export const ROLES_END = "<!-- RATIFICATION_ROLES_END -->";
export const G00_START = "<!-- RATIFICATION_G00_START -->";
export const G00_END = "<!-- RATIFICATION_G00_END -->";
export const NONSCOPE_START = "<!-- RATIFICATION_NONSCOPE_START -->";
export const NONSCOPE_END = "<!-- RATIFICATION_NONSCOPE_END -->";
export const SIGNATURE_START = "<!-- RATIFICATION_SIGNATURE_START -->";
export const SIGNATURE_END = "<!-- RATIFICATION_SIGNATURE_END -->";

const PACK_ID_RE = /^FRP-\d{4}-\d+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const PLACEHOLDER_TOKENS = new Set(["", "UNASSIGNED", "UNRESOLVED", "TBD", "TBC", "TODO", "UNKNOWN", "PENDING", "N/A", "NA"]);
const ALLOWED_DOC_STATUS = ["proposed", "ratification-ready"] as const;
type DocStatus = (typeof ALLOWED_DOC_STATUS)[number];

const TOP_LEVEL_KEYS = [
  "pack_id", "version", "proposed_date", "document_status", "adr_ref", "spec_ref",
  "acknowledgement", "acknowledgement_version", "thresholds", "role_assignments",
  "thresholds_resolved", "roles_assigned", "ratification_ready",
] as const;
const THRESHOLD_KEYS = ["id", "concept", "deployment_value", "unit", "status"] as const;
const ROLE_KEYS = ["capacity", "actor_id", "name", "required_signer", "status"] as const;

export interface Threshold {
  id: string;
  concept: string;
  deployment_value: string | number;
  unit: string;
  status: "resolved" | "unresolved";
}

export interface RoleAssignment {
  capacity: KnownCapacity;
  actor_id: string;
  name: string;
  required_signer: boolean;
  status: "assigned" | "unassigned";
}

export interface RatificationManifest {
  pack_id: string;
  version: string;
  proposed_date: string;
  document_status: DocStatus;
  adr_ref: string;
  spec_ref: string;
  acknowledgement: string;
  acknowledgement_version: string;
  thresholds: Threshold[];
  role_assignments: RoleAssignment[];
  thresholds_resolved: boolean;
  roles_assigned: boolean;
  ratification_ready: boolean;
}

export interface RequiredSigner {
  actor_id: string;
  name: string;
  capacity: KnownCapacity;
}

export interface RatificationError {
  path: string;
  keyword: string;
  message: string;
}

export interface RatificationReadiness {
  thresholds_resolved: boolean;
  roles_assigned: boolean;
  ratification_ready: boolean;
  required_signers: RequiredSigner[];
  reasons: string[];
}

export interface RatificationPackSnapshot {
  bytes: string;
  digest: string;
  manifest: RatificationManifest;
  packId: string;
  version: string;
  requiredSigners: RequiredSigner[];
  ready: boolean;
}

export interface RatificationPackResult {
  snapshot: RatificationPackSnapshot | null;
  errors: RatificationError[];
}

export class RatificationPackInvalid extends Error {
  readonly errors: RatificationError[];
  constructor(errors: RatificationError[]) {
    super(`ratification pack is not signable: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
    this.name = "RatificationPackInvalid";
    this.errors = errors;
  }
}

// --- utilities ---------------------------------------------------------------

/** Recursively freeze an object/array graph (runtime immutability). */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** SHA-256 (lowercase hex) of the exact UTF-8 bytes of the document. */
export function digestPackBytes(bytes: string): string {
  return createHash("sha256").update(Buffer.from(bytes, "utf8")).digest("hex");
}

function err(path: string, keyword: string, message: string): RatificationError {
  return { path, keyword, message };
}
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function nonEmptyTrimmed(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isPlaceholder(v: string | number): boolean {
  return PLACEHOLDER_TOKENS.has(String(v).trim().toUpperCase());
}
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Extract the exact text between a START/END marker pair (null if absent/ambiguous). */
export function extractBetween(bytes: string, start: string, end: string): string | null {
  if (countOccurrences(bytes, start) !== 1 || countOccurrences(bytes, end) !== 1) return null;
  const s = bytes.indexOf(start) + start.length;
  const e = bytes.indexOf(end);
  if (e < s) return null;
  return bytes.slice(s, e);
}

/** Normalize a marker-delimited block for comparison (trim lines + edges). */
export function normalizeBlock(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

// --- manifest extraction (strict) --------------------------------------------

function extractManifestJson(bytes: string, errors: RatificationError[]): unknown | null {
  const starts = countOccurrences(bytes, MANIFEST_START);
  const ends = countOccurrences(bytes, MANIFEST_END);
  if (starts === 0) {
    errors.push(err("manifest", "missing", "no RATIFICATION_MANIFEST_START marker"));
    return null;
  }
  if (starts > 1 || ends > 1) {
    errors.push(err("manifest", "duplicated", "RATIFICATION_MANIFEST markers must appear exactly once"));
    return null;
  }
  if (ends === 0) {
    errors.push(err("manifest", "unterminated", "no RATIFICATION_MANIFEST_END marker"));
    return null;
  }
  const startIdx = bytes.indexOf(MANIFEST_START) + MANIFEST_START.length;
  const endIdx = bytes.indexOf(MANIFEST_END);
  if (endIdx < startIdx) {
    errors.push(err("manifest", "order", "RATIFICATION_MANIFEST_END precedes _START"));
    return null;
  }
  const between = bytes.slice(startIdx, endIdx);
  const jsonFences = countOccurrences(between, "```json");
  if (jsonFences === 0) {
    errors.push(err("manifest", "missing", "no ```json fenced block between the manifest markers"));
    return null;
  }
  if (jsonFences > 1) {
    errors.push(err("manifest", "ambiguous", "more than one ```json block between the manifest markers"));
    return null;
  }
  if (countOccurrences(between, "```") !== 2) {
    errors.push(err("manifest", "ambiguous", "unexpected fenced content between the manifest markers"));
    return null;
  }
  const fence = between.match(/```json\s*([\s\S]*?)```/);
  if (!fence) {
    errors.push(err("manifest", "malformed", "the ```json fence is not closed"));
    return null;
  }
  try {
    return JSON.parse(fence[1]);
  } catch (e) {
    errors.push(err("manifest", "json", `does not parse: ${e instanceof Error ? e.message : String(e)}`));
    return null;
  }
}

// --- manifest shape validation (strict) --------------------------------------

function exactKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string, errors: RatificationError[]): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(err(`${path}.${k}`, "additionalProperties", `unknown property '${k}'`));
  }
  for (const k of allowed) {
    if (!(k in obj)) errors.push(err(`${path}.${k}`, "required", `missing property '${k}'`));
  }
}

function validateThreshold(raw: unknown, i: number, errors: RatificationError[]): Threshold | null {
  const path = `thresholds[${i}]`;
  if (!isObject(raw)) {
    errors.push(err(path, "type", "must be an object"));
    return null;
  }
  exactKeys(raw, THRESHOLD_KEYS, path, errors);
  if (!nonEmptyTrimmed(raw.id)) errors.push(err(`${path}.id`, "nonEmpty", "must be a non-empty string"));
  if (!nonEmptyTrimmed(raw.concept)) errors.push(err(`${path}.concept`, "nonEmpty", "must be a non-empty string"));
  if (typeof raw.deployment_value !== "string" && typeof raw.deployment_value !== "number") {
    errors.push(err(`${path}.deployment_value`, "type", "must be a string or number"));
  }
  if (!nonEmptyTrimmed(raw.unit)) errors.push(err(`${path}.unit`, "nonEmpty", "must be a non-empty string"));
  if (raw.status !== "resolved" && raw.status !== "unresolved") {
    errors.push(err(`${path}.status`, "enum", "must be 'resolved' or 'unresolved'"));
  }
  return errors.some((e) => e.path.startsWith(path)) ? null : (raw as unknown as Threshold);
}

function validateRole(raw: unknown, i: number, errors: RatificationError[]): RoleAssignment | null {
  const path = `role_assignments[${i}]`;
  if (!isObject(raw)) {
    errors.push(err(path, "type", "must be an object"));
    return null;
  }
  exactKeys(raw, ROLE_KEYS, path, errors);
  if (!nonEmptyTrimmed(raw.capacity)) {
    errors.push(err(`${path}.capacity`, "nonEmpty", "must be a non-empty string"));
  } else if (!(KNOWN_CAPACITIES as readonly string[]).includes(raw.capacity)) {
    errors.push(err(`${path}.capacity`, "enum", `'${raw.capacity}' is not a known capacity`));
  }
  if (typeof raw.actor_id !== "string" || raw.actor_id.trim() !== raw.actor_id || raw.actor_id.length === 0) {
    errors.push(err(`${path}.actor_id`, "string", "must be a trimmed non-empty string"));
  }
  if (typeof raw.name !== "string" || raw.name.trim() !== raw.name || raw.name.length === 0) {
    errors.push(err(`${path}.name`, "string", "must be a trimmed non-empty string"));
  }
  if (typeof raw.required_signer !== "boolean") errors.push(err(`${path}.required_signer`, "type", "must be a boolean"));
  if (raw.status !== "assigned" && raw.status !== "unassigned") {
    errors.push(err(`${path}.status`, "enum", "must be 'assigned' or 'unassigned'"));
  }
  return errors.some((e) => e.path.startsWith(path)) ? null : (raw as unknown as RoleAssignment);
}

/** Structural completeness of the threshold inventory + the no-spend invariant. */
function validateThresholdInventory(thresholds: Threshold[], errors: RatificationError[]): void {
  const ids = thresholds.map((t) => t.id);
  for (const reqId of REQUIRED_THRESHOLD_IDS) {
    const count = ids.filter((id) => id === reqId).length;
    if (count === 0) errors.push(err(`thresholds.${reqId}`, "required", `required threshold '${reqId}' is missing`));
    if (count > 1) errors.push(err(`thresholds.${reqId}`, "unique", `required threshold '${reqId}' appears ${count} times`));
  }
  const spend = thresholds.find((t) => t.id === SPEND_EXEC_ID);
  if (spend) {
    if (spend.status !== "resolved" || spend.unit !== "USD" || spend.deployment_value !== 0) {
      errors.push(err(`thresholds.${SPEND_EXEC_ID}`, "invariant", "no-spend invariant: THR-SPEND-EXEC must be resolved, unit USD, deployment_value 0"));
    }
  }
}

/** Structural completeness of the constitutional capacity inventory. */
function validateCapacityInventory(roles: RoleAssignment[], errors: RatificationError[]): void {
  const requiredByCapacity = new Map<string, number>();
  for (const r of roles) {
    if (r.required_signer) requiredByCapacity.set(r.capacity, (requiredByCapacity.get(r.capacity) ?? 0) + 1);
    // A constitutional capacity may not be demoted out of the required set.
    if ((KNOWN_CAPACITIES as readonly string[]).includes(r.capacity) && r.required_signer === false) {
      errors.push(err(`role_assignments.${r.capacity}`, "required_signer", `constitutional capacity '${r.capacity}' must be a required signer`));
    }
  }
  for (const cap of REQUIRED_SIGNER_POLICY.singular) {
    const n = requiredByCapacity.get(cap) ?? 0;
    if (n === 0) errors.push(err(`role_assignments.${cap}`, "required", `exactly one required '${cap}' is mandatory (found 0)`));
    if (n > 1) errors.push(err(`role_assignments.${cap}`, "unique", `exactly one required '${cap}' is allowed (found ${n})`));
  }
  for (const cap of REQUIRED_SIGNER_POLICY.atLeastOne) {
    if ((requiredByCapacity.get(cap) ?? 0) < 1) {
      errors.push(err(`role_assignments.${cap}`, "required", `at least one required '${cap}' is mandatory`));
    }
  }
}

function validateManifestShape(raw: unknown, errors: RatificationError[]): RatificationManifest | null {
  if (!isObject(raw)) {
    errors.push(err("manifest", "type", "manifest is not a JSON object"));
    return null;
  }
  exactKeys(raw, TOP_LEVEL_KEYS, "manifest", errors);

  if (!nonEmptyTrimmed(raw.pack_id) || !PACK_ID_RE.test(raw.pack_id as string)) {
    errors.push(err("pack_id", "format", "must match ^FRP-\\d{4}-\\d+$"));
  }
  if (!nonEmptyTrimmed(raw.version) || !SEMVER_RE.test(raw.version as string)) {
    errors.push(err("version", "format", "must be a semver string x.y.z"));
  }
  if (!nonEmptyTrimmed(raw.proposed_date)) errors.push(err("proposed_date", "nonEmpty", "must be a non-empty string"));
  if (!nonEmptyTrimmed(raw.adr_ref)) errors.push(err("adr_ref", "nonEmpty", "must be a non-empty string"));
  if (!nonEmptyTrimmed(raw.spec_ref)) errors.push(err("spec_ref", "nonEmpty", "must be a non-empty string"));
  if (!nonEmptyTrimmed(raw.acknowledgement)) errors.push(err("acknowledgement", "nonEmpty", "must be a non-empty string"));
  if (!nonEmptyTrimmed(raw.acknowledgement_version) || !SEMVER_RE.test(raw.acknowledgement_version as string)) {
    errors.push(err("acknowledgement_version", "format", "must be a semver string x.y.z"));
  }
  if (!(ALLOWED_DOC_STATUS as readonly string[]).includes(raw.document_status as string)) {
    errors.push(err("document_status", "enum", "must be 'proposed' or 'ratification-ready'"));
  }
  for (const k of ["thresholds_resolved", "roles_assigned", "ratification_ready"] as const) {
    if (typeof raw[k] !== "boolean") errors.push(err(k, "type", "must be a boolean"));
  }

  let thresholds: Threshold[] | null = null;
  if (!Array.isArray(raw.thresholds) || raw.thresholds.length === 0) {
    errors.push(err("thresholds", "nonEmpty", "must be a non-empty array"));
  } else {
    const validated = raw.thresholds.map((t, i) => validateThreshold(t, i, errors));
    const seen = new Set<string>();
    validated.forEach((t, i) => {
      if (t && seen.has(t.id)) errors.push(err(`thresholds[${i}].id`, "unique", `duplicate threshold id '${t.id}'`));
      if (t) seen.add(t.id);
    });
    if (validated.every((t): t is Threshold => t !== null)) {
      thresholds = validated;
      validateThresholdInventory(thresholds, errors);
    }
  }

  let roles: RoleAssignment[] | null = null;
  if (!Array.isArray(raw.role_assignments) || raw.role_assignments.length === 0) {
    errors.push(err("role_assignments", "nonEmpty", "must be a non-empty array"));
  } else {
    const validated = raw.role_assignments.map((r, i) => validateRole(r, i, errors));
    if (validated.every((r): r is RoleAssignment => r !== null)) {
      roles = validated;
      validateCapacityInventory(roles, errors);
    }
  }

  return errors.length ? null : (raw as unknown as RatificationManifest);
}

// --- derived required signers + readiness ------------------------------------

export function deriveRequiredSigners(manifest: RatificationManifest): RequiredSigner[] {
  return manifest.role_assignments
    .filter((r) => r.required_signer === true)
    .map((r) => ({ actor_id: r.actor_id, name: r.name, capacity: r.capacity }));
}

export function computeRatificationReadiness(manifest: RatificationManifest): RatificationReadiness {
  const reasons: string[] = [];

  let thresholdsResolved = manifest.thresholds.length > 0;
  for (const t of manifest.thresholds) {
    if (t.status !== "resolved") {
      thresholdsResolved = false;
      reasons.push(`threshold '${t.id}' is ${t.status}`);
    }
    if (isPlaceholder(t.deployment_value)) {
      thresholdsResolved = false;
      reasons.push(`threshold '${t.id}' has a placeholder deployment_value`);
    }
  }

  // Every assignment must be assigned; required signers must be distinct humans.
  let rolesAssigned = manifest.role_assignments.length > 0;
  const required = manifest.role_assignments.filter((r) => r.required_signer === true);
  if (required.length === 0) {
    rolesAssigned = false;
    reasons.push("no required signers declared");
  }
  for (const r of manifest.role_assignments) {
    if (r.status !== "assigned") {
      rolesAssigned = false;
      reasons.push(`role assignment for '${r.capacity}' is ${r.status}`);
    }
    if (isPlaceholder(r.actor_id) || isPlaceholder(r.name)) {
      rolesAssigned = false;
      reasons.push(`role assignment for '${r.capacity}' has a placeholder actor_id/name`);
    }
  }
  const actorIds = new Set<string>();
  for (const r of required) {
    if (actorIds.has(r.actor_id)) {
      rolesAssigned = false;
      reasons.push(`required signer actor_id '${r.actor_id}' is repeated`);
    }
    actorIds.add(r.actor_id);
  }

  const ackOk = nonEmptyTrimmed(manifest.acknowledgement) && SEMVER_RE.test(manifest.acknowledgement_version);
  if (!ackOk) reasons.push("acknowledgement / acknowledgement_version incomplete");

  const ratificationReady = thresholdsResolved && rolesAssigned && ackOk;
  return {
    thresholds_resolved: thresholdsResolved,
    roles_assigned: rolesAssigned,
    ratification_ready: ratificationReady,
    required_signers: deriveRequiredSigners(manifest),
    reasons,
  };
}

// --- deterministic renderers + runtime binding -------------------------------

function cell(v: string | number): string {
  return String(v).replace(/\|/g, "\\|");
}

export function renderThresholdsTable(manifest: RatificationManifest): string {
  const header = "| ID | Concept | Deployment value | Unit | Status |\n|---|---|---|---|---|";
  const rows = manifest.thresholds.map(
    (t) => `| \`${cell(t.id)}\` | ${cell(t.concept)} | ${cell(t.deployment_value)} | ${cell(t.unit)} | ${cell(t.status)} |`,
  );
  return [header, ...rows].join("\n");
}

export function renderRolesTable(manifest: RatificationManifest): string {
  const header = "| Capacity | Actor ID | Name | Required signer | Status |\n|---|---|---|---|---|";
  const rows = manifest.role_assignments.map(
    (r) => `| \`${cell(r.capacity)}\` | \`${cell(r.actor_id)}\` | ${cell(r.name)} | ${r.required_signer ? "yes" : "no"} | ${cell(r.status)} |`,
  );
  return [header, ...rows].join("\n");
}

export function verifyRenderedTables(snapshot: RatificationPackSnapshot): string[] {
  const problems: string[] = [];
  const checks: Array<[string, string, string, string]> = [
    ["thresholds", THRESHOLDS_START, THRESHOLDS_END, renderThresholdsTable(snapshot.manifest)],
    ["roles", ROLES_START, ROLES_END, renderRolesTable(snapshot.manifest)],
  ];
  for (const [label, start, end, expected] of checks) {
    const actual = extractBetween(snapshot.bytes, start, end);
    if (actual === null) {
      problems.push(`${label} block missing or duplicated`);
      continue;
    }
    if (normalizeBlock(actual) !== normalizeBlock(expected)) problems.push(`${label} table does not match the manifest`);
  }
  return problems;
}

// --- constitutional sections -------------------------------------------------

interface SectionSpec {
  label: string;
  start: string;
  end: string;
  clauses: Array<{ name: string; re: RegExp }>;
}

const SECTION_SPECS: SectionSpec[] = [
  {
    label: "G-00",
    start: G00_START,
    end: G00_END,
    clauses: [
      { name: "who may stop", re: /who may invoke a stop|any single authorized human/i },
      { name: "reason optional", re: /reason is optional/i },
      { name: "restart by approver", re: /restart is authorized only by[\s\S]*approver|restart[\s\S]*approver/i },
      { name: "non-empty restart rationale", re: /non-empty rationale/i },
      { name: "technical enforcement is issue #12", re: /issue #12/i },
    ],
  },
  {
    label: "non-scope",
    start: NONSCOPE_START,
    end: NONSCOPE_END,
    clauses: [
      { name: "zero spend execution", re: /no spend execution/i },
      { name: "no external agent credentials", re: /external agent credentials/i },
      { name: "no R4 autonomy", re: /R4/ },
      { name: "no technical G-00 in this issue", re: /no technical G-00 stop mechanism/i },
    ],
  },
  {
    label: "signature statement",
    start: SIGNATURE_START,
    end: SIGNATURE_END,
    clauses: [
      { name: "thresholds", re: /threshold/i },
      { name: "roles", re: /role/i },
      { name: "G-00", re: /G-00/i },
      { name: "non-scope", re: /non-scope/i },
      { name: "risks", re: /risk/i },
      { name: "byte-change invalidation", re: /invalidates every prior signature/i },
    ],
  },
];

/** Every constitutional section must appear exactly once, non-empty, with its clauses. */
export function validateConstitutionalSections(bytes: string, errors: RatificationError[]): void {
  for (const spec of SECTION_SPECS) {
    if (countOccurrences(bytes, spec.start) !== 1 || countOccurrences(bytes, spec.end) !== 1) {
      errors.push(err(`section.${spec.label}`, "cardinality", `the ${spec.label} block must appear exactly once`));
      continue;
    }
    const body = extractBetween(bytes, spec.start, spec.end);
    if (body === null) {
      errors.push(err(`section.${spec.label}`, "order", `the ${spec.label} block markers are out of order`));
      continue;
    }
    if (body.trim().length === 0) {
      errors.push(err(`section.${spec.label}`, "empty", `the ${spec.label} block is empty`));
      continue;
    }
    for (const clause of spec.clauses) {
      if (!clause.re.test(body)) {
        errors.push(err(`section.${spec.label}`, "clause", `the ${spec.label} block is missing the '${clause.name}' clause`));
      }
    }
  }
}

// --- the injectable parser (bytes → frozen snapshot) -------------------------

/**
 * Parse + fully validate pack BYTES: manifest shape + inventories, derived
 * readiness (declared must equal computed), document_status consistency, the
 * runtime table binding, and the constitutional sections. Returns a DEEP-FROZEN
 * snapshot or `{ snapshot: null, errors }`. Never throws.
 */
export function parseRatificationPackBytes(bytes: string): RatificationPackResult {
  const errors: RatificationError[] = [];
  const rawManifest = extractManifestJson(bytes, errors);
  if (rawManifest === null) return { snapshot: null, errors };
  const manifest = validateManifestShape(rawManifest, errors);
  if (manifest === null) return { snapshot: null, errors };

  const computed = computeRatificationReadiness(manifest);
  if (manifest.thresholds_resolved !== computed.thresholds_resolved) {
    errors.push(err("thresholds_resolved", "inconsistent", `declared ${manifest.thresholds_resolved}, computed ${computed.thresholds_resolved}`));
  }
  if (manifest.roles_assigned !== computed.roles_assigned) {
    errors.push(err("roles_assigned", "inconsistent", `declared ${manifest.roles_assigned}, computed ${computed.roles_assigned}`));
  }
  if (manifest.ratification_ready !== computed.ratification_ready) {
    errors.push(err("ratification_ready", "inconsistent", `declared ${manifest.ratification_ready}, computed ${computed.ratification_ready}`));
  }
  const expectedStatus: DocStatus = computed.ratification_ready ? "ratification-ready" : "proposed";
  if (manifest.document_status !== expectedStatus) {
    errors.push(err("document_status", "inconsistent", `must be '${expectedStatus}' for the computed readiness`));
  }

  validateConstitutionalSections(bytes, errors);
  if (errors.length) return { snapshot: null, errors };

  const snapshot: RatificationPackSnapshot = {
    bytes,
    digest: digestPackBytes(bytes),
    manifest,
    packId: manifest.pack_id,
    version: manifest.version,
    requiredSigners: computed.required_signers,
    ready: computed.ratification_ready,
  };
  // Runtime table binding: fail closed if the human tables drift from the manifest.
  const tableProblems = verifyRenderedTables(snapshot);
  if (tableProblems.length) {
    return { snapshot: null, errors: tableProblems.map((p) => err("tables", "drift", p)) };
  }
  return { snapshot: deepFreeze(snapshot), errors: [] };
}

// --- signature evidence validation -------------------------------------------

export interface CandidateEvent {
  event_type?: unknown;
  actor_type?: unknown;
  actor_id?: unknown;
  object_type?: unknown;
  object_id?: unknown;
  timestamp?: unknown;
  payload?: unknown;
}

/**
 * Full structural check that `event` is a valid signature by `signer` on the
 * snapshot's exact digest/version/capacity/acknowledgement. Every field is
 * type-checked before comparison, and `payload.session_id` must be a non-empty
 * string (session binding is verified separately against the DB).
 */
export function validateRatificationSignatureEvent(
  event: CandidateEvent,
  signer: RequiredSigner,
  snapshot: RatificationPackSnapshot,
): boolean {
  if (event.event_type !== RATIFICATION_EVENT_TYPE) return false;
  if (event.actor_type !== "human") return false;
  if (event.actor_id !== signer.actor_id) return false;
  if (event.object_type !== RATIFICATION_OBJECT_TYPE) return false;
  if (event.object_id !== snapshot.packId) return false;
  const p = event.payload;
  if (!isObject(p)) return false;
  if (p.pack_digest !== snapshot.digest) return false;
  if (p.pack_version !== snapshot.version) return false;
  if (p.signer_actor_id !== signer.actor_id) return false;
  if (p.signer_capacity !== signer.capacity) return false;
  if (p.acknowledgement_version !== snapshot.manifest.acknowledgement_version) return false;
  if (typeof p.session_id !== "string" || p.session_id.length === 0) return false;
  return true;
}

// --- injectable database evaluators (snapshot in, no file loader) -------------

export interface RecordSignatureInput {
  packId: string;
  expectedDigest: string;
  signerActorId: string;
  signerCapacity: string;
  acknowledgement: string;
  /** The signer's active session id (Phase 0 session auth — opaque, not an IdP). */
  sessionId: string;
}

function requireField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

async function inRatificationTx<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
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
 * Ground a required signer to a registered user: the user must exist, their
 * `display_name` must equal the manifest name, and operational capacities must
 * carry the matching active role. Returns a reason string when grounding fails,
 * or null when it holds. `founding_signatory` / `curator` have no role enum yet
 * (documented limit for issue #11): they require a registered user only.
 */
export async function signerGroundingReason(client: Queryable, signer: RequiredSigner): Promise<string | null> {
  const { rows } = await client.query<{ display_name: string }>("SELECT display_name FROM users WHERE id = $1", [signer.actor_id]);
  if (rows.length === 0) return `signer '${signer.actor_id}' is not a registered user`;
  if (rows[0].display_name !== signer.name) {
    return `signer '${signer.actor_id}' name mismatch: registered '${rows[0].display_name}', pack '${signer.name}'`;
  }
  if (signer.capacity === "portfolio_review_lead" && !(await hasActiveRole(client, signer.actor_id, "approver"))) {
    return `signer '${signer.actor_id}' (portfolio_review_lead) lacks the active 'approver' role`;
  }
  if (signer.capacity === "operator" && !(await hasActiveRole(client, signer.actor_id, "operator"))) {
    return `signer '${signer.actor_id}' (operator) lacks the active 'operator' role`;
  }
  return null;
}

/**
 * The signature is a human act ATTRIBUTED TO an active registered session — not a
 * cryptographic personal signature (Phase 0: opaque session, no IdP, no personal
 * key). A historic signature stays valid after its session closes, as long as the
 * session belonged to the signer and was active at the event's timestamp.
 */
async function sessionValidAtEvent(
  client: Queryable,
  sessionId: unknown,
  signerActorId: string,
  eventTimestamp: unknown,
): Promise<boolean> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return false;
  if (typeof eventTimestamp !== "string" || eventTimestamp.length === 0) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM sessions
       WHERE id = $1 AND user_id = $2
         AND started_at <= $3::timestamptz
         AND (ended_at IS NULL OR ended_at >= $3::timestamptz)
       LIMIT 1`,
    [sessionId, signerActorId, eventTimestamp],
  );
  return rows.length > 0;
}

/**
 * Record one human signature against an already-parsed snapshot. INJECTABLE.
 * Captures the request before the first await, verifies the snapshot is ready and
 * the pack id / digest / capacity / acknowledgement match, then inside the
 * transaction (after the advisory lock) grounds the signer to a registered user +
 * role AND to an ACTIVE session they own, then emits exactly one append-only
 * `ratification.signature_recorded` event (payload includes `session_id`).
 * Idempotent on the full evidence; two concurrent signatures collapse to one.
 */
export async function recordSignatureForSnapshot(
  client: Queryable,
  snapshot: RatificationPackSnapshot,
  input: RecordSignatureInput,
): Promise<{ eventId: string; idempotent: boolean }> {
  const req = Object.freeze({
    packId: requireField(input.packId, "packId"),
    expectedDigest: requireField(input.expectedDigest, "expectedDigest"),
    signerActorId: requireField(input.signerActorId, "signerActorId"),
    signerCapacity: requireField(input.signerCapacity, "signerCapacity"),
    acknowledgement: requireField(input.acknowledgement, "acknowledgement"),
    sessionId: requireField(input.sessionId, "sessionId"),
  });

  if (!snapshot.ready) {
    throw new RatificationPackInvalid([{ path: "ratification_ready", keyword: "not-ready", message: "pack is not ratification-ready" }]);
  }
  if (req.packId !== snapshot.packId) throw new Error(`pack id mismatch: signing '${req.packId}', current pack is '${snapshot.packId}'`);
  if (req.expectedDigest !== snapshot.digest) {
    throw new Error(`stale pack digest: signer expects ${req.expectedDigest.slice(0, 12)}, current pack is ${snapshot.digest.slice(0, 12)}`);
  }
  const matches = snapshot.requiredSigners.filter((s) => s.actor_id === req.signerActorId);
  if (matches.length === 0) throw new Error(`'${req.signerActorId}' is not a required signer of pack ${req.packId}`);
  if (matches.length > 1) throw new Error(`'${req.signerActorId}' appears more than once in required signers`);
  const signer = matches[0];
  if (signer.capacity !== req.signerCapacity) {
    throw new Error(`capacity mismatch: '${req.signerActorId}' is required as '${signer.capacity}', signed as '${req.signerCapacity}'`);
  }
  if (req.acknowledgement !== snapshot.manifest.acknowledgement) {
    throw new Error("acknowledgement does not match the pack's required signature statement");
  }

  return inRatificationTx(client, async () => {
    const grounding = await signerGroundingReason(client, signer);
    if (grounding) throw new Error(`signer not grounded: ${grounding}`);

    // The signer must present an ACTIVE session they own.
    const sess = await client.query<{ user_id: string; ended_at: Date | null }>(
      "SELECT user_id, ended_at FROM sessions WHERE id = $1",
      [req.sessionId],
    );
    if (sess.rows.length === 0) throw new Error(`signing session '${req.sessionId}' does not exist`);
    if (sess.rows[0].user_id !== req.signerActorId) throw new Error(`signing session '${req.sessionId}' belongs to a different user`);
    if (sess.rows[0].ended_at !== null) throw new Error(`signing session '${req.sessionId}' is already ended`);

    const candidates = await client.query<CandidateEvent & { id: string }>(
      `SELECT id, event_type, actor_type, actor_id, object_type, object_id, timestamp, payload FROM events
        WHERE event_type = $1 AND object_type = $2 AND object_id = $3 AND actor_type = 'human' AND actor_id = $4`,
      [RATIFICATION_EVENT_TYPE, RATIFICATION_OBJECT_TYPE, req.packId, req.signerActorId],
    );
    const prior = candidates.rows.find((row) => validateRatificationSignatureEvent(row, signer, snapshot));
    if (prior) return { eventId: prior.id, idempotent: true };

    const ev = await appendEventTx(client, {
      id: `EV-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: signer.actor_id,
      event_type: RATIFICATION_EVENT_TYPE,
      object_type: RATIFICATION_OBJECT_TYPE,
      object_id: req.packId,
      payload: {
        pack_digest: snapshot.digest,
        pack_version: snapshot.version,
        signer_actor_id: signer.actor_id,
        signer_capacity: signer.capacity,
        acknowledgement_version: snapshot.manifest.acknowledgement_version,
        session_id: req.sessionId,
      },
    });
    return { eventId: ev.id, idempotent: false };
  });
}

/**
 * Evaluate `real_money` against an already-parsed snapshot. INJECTABLE. Runs in
 * ONE serialized REPEATABLE READ transaction (advisory lock first) so it never
 * mixes states read at different instants and is totally ordered against role
 * grants/revokes, signature recording, and session start/end. True only when the
 * snapshot is ready AND every required signer has a valid signature event bound
 * to the CURRENT digest/version/capacity, made from a session they owned that was
 * active at the event's timestamp, AND is still grounded to a registered user +
 * role. Fails closed; never returns true from a partial state.
 */
export async function evaluateRealMoneyForSnapshot(client: Queryable, snapshot: RatificationPackSnapshot): Promise<boolean> {
  if (!snapshot.ready) return false;
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await acquireEventChainLock(client); // serialize against every audited mutation
    const { rows } = await client.query<CandidateEvent>(
      `SELECT event_type, actor_type, actor_id, object_type, object_id, timestamp, payload FROM events
         WHERE event_type = $1 AND object_type = $2 AND object_id = $3 AND actor_type = 'human'`,
      [RATIFICATION_EVENT_TYPE, RATIFICATION_OBJECT_TYPE, snapshot.packId],
    );
    let ok = true;
    for (const signer of snapshot.requiredSigners) {
      let signed = false;
      for (const r of rows) {
        if (!validateRatificationSignatureEvent(r, signer, snapshot)) continue;
        const sessionId = isObject(r.payload) ? r.payload.session_id : undefined;
        if (await sessionValidAtEvent(client, sessionId, signer.actor_id, r.timestamp)) {
          signed = true;
          break;
        }
      }
      if (!signed || (await signerGroundingReason(client, signer))) {
        ok = false;
        break;
      }
    }
    await client.query("COMMIT");
    return ok;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
