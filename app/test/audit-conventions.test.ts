/**
 * Audit-trail conventions + event-log verification (issue #13, P0-12).
 *
 * Three layers:
 *   1. the pure convention validator (app/src/lib/audit-conventions.ts) — base
 *      record rules + per-type contracts, with structured errors and NO coercion;
 *   2. the real CLI (ops/verify-log.ts) run as a CHILD PROCESS against isolated
 *      temporary databases — verify on a seeded DB (exit 0), tamper detection with
 *      the append-only triggers temporarily disabled (exit 1), and the extract
 *      filters (date range, venture, escaping, fail-closed over an invalid chain);
 *   3. the drift guard (ops/check-audit-conventions.ts) — registry ⇄ productive
 *      writers ⇄ docs, driven both by the real scan and by fixtures.
 *
 * Tampering uses a superuser connection to an isolated temp DB to DISABLE the
 * append-only triggers, mutate a row, and re-enable them — exactly the DB-admin
 * compromise the tool's honest-limitations section says it CAN detect at the
 * single-row level (a full re-forge it cannot; that needs an external anchor).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  validateEventConvention,
  ventureIdsReferenced,
  renderConventionsTable,
  renderConventionsContracts,
  contractsDigest,
  getConvention,
  isValidEventTimestamp,
  isNonBlankString,
  EVENT_TYPES,
  EVENT_CONVENTIONS,
  ANY_OBJECT_TYPE,
  MAX_SAFE_GENERATION,
  type AuditEventRecord,
} from "../src/lib/audit-conventions.js";
import {
  analyzeEmitters,
  readProductiveSources,
  extractDocTable,
  extractDocContracts,
  computeDrift,
} from "../../ops/check-audit-conventions.js";
import { appendEvent, computeHash } from "../src/lib/eventlog.js";
import { createUser, grantRole, startSession, endSession, seedAuditChain } from "./audit-seed.js";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const TSX = join(REPO_ROOT, "app", "node_modules", ".bin", "tsx");
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());

const HEX64 = "a".repeat(64);

/** Build a convention-valid event record (valid hash FORMAT, not a chain hash). */
function mkEvent(overrides: Partial<AuditEventRecord>): AuditEventRecord {
  return {
    id: "EV-1",
    timestamp: "2026-07-17T00:00:00Z",
    actor_type: "human",
    actor_id: "u1",
    event_type: "user.created",
    object_type: "user",
    object_id: "u2",
    payload: { display_name: "Alice" },
    previous_hash: null,
    hash: HEX64,
    trace_id: null,
    ...overrides,
  };
}

/** A fully valid G-01 gate_passed (actor is the approver). */
function validG01(payloadOver: Record<string, unknown> = {}, over: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return mkEvent({
    event_type: "gate_passed", actor_id: "appr", object_type: "venture", object_id: "V-1",
    payload: {
      gate_id: "G-01", gate_name: "Opportunity Intake", dr_id: "DR-1", approval_event_id: "EV-a",
      proposer_actor_id: "prop", approver_actor_id: "appr", kill_criteria: ["k"], reversibility_class: "R1",
      dr_digest: HEX64, transition_kind: "gate_pass", from_state: null, to_state: "trend_analysis",
      venture_id: "V-1", effect: "venture_created", opportunity_ref: "KI-1", ...payloadOver,
    },
    ...over,
  });
}

/** A fully valid pipeline (G-03) gate_passed. */
function validPipeline(payloadOver: Record<string, unknown> = {}, over: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return mkEvent({
    event_type: "gate_passed", actor_id: "appr", object_type: "venture", object_id: "V-1",
    payload: {
      gate_id: "G-03", gate_name: "Validation", dr_id: "DR-1", approval_event_id: "EV-a",
      proposer_actor_id: "prop", approver_actor_id: "appr", kill_criteria: ["k"], reversibility_class: "R2",
      dr_digest: HEX64, transition_kind: "gate_pass", from_state: "validation", to_state: "analysis",
      venture_id: "V-1", effect: "stage_advanced", ...payloadOver,
    },
    ...over,
  });
}

/** A fully valid standing (G-17) gate_passed (object is the subject). */
function validStanding(payloadOver: Record<string, unknown> = {}, over: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return mkEvent({
    event_type: "gate_passed", actor_id: "appr", object_type: "campaign", object_id: "camp-1",
    payload: {
      gate_id: "G-17", gate_name: "Public Communication", dr_id: "DR-1", approval_event_id: "EV-a",
      proposer_actor_id: "prop", approver_actor_id: "appr", kill_criteria: null, reversibility_class: "R3",
      dr_digest: HEX64, transition_kind: "authorization", from_state: null, to_state: null,
      venture_id: null, subject_type: "campaign", subject_id: "camp-1", ...payloadOver,
    },
    ...over,
  });
}

/** A fully valid decision-record approval. */
function validApprovalDR(payloadOver: Record<string, unknown> = {}, over: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return mkEvent({
    event_type: "approval.recorded", actor_id: "appr", object_type: "decision-record", object_id: "DR-1",
    payload: { proposer_actor_id: "prop", object_digest: HEX64, ...payloadOver },
    ...over,
  });
}

/** Delete a key from a copied payload (for "field must be absent" tests). */
function withoutKey(rec: AuditEventRecord, key: string): AuditEventRecord {
  const p = { ...(rec.payload as Record<string, unknown>) };
  delete p[key];
  return { ...rec, payload: p };
}

// ---------------------------------------------------------------------------
// 1. Pure convention validator
// ---------------------------------------------------------------------------

describe("validateEventConvention — base record", () => {
  it("accepts a well-formed event", () => {
    expect(validateEventConvention(mkEvent({}))).toEqual([]);
  });

  it("rejects an empty id", () => {
    const errs = validateEventConvention(mkEvent({ id: "" }));
    expect(errs.some((e) => e.category === "base_record" && e.path === "id")).toBe(true);
  });

  it("rejects a malformed timestamp even with a valid hash", () => {
    const errs = validateEventConvention(mkEvent({ timestamp: "2026-13-40T99:99:99Z" }));
    expect(errs.some((e) => e.category === "base_record" && e.path === "timestamp")).toBe(true);
  });

  it("rejects an impossible calendar date (no silent roll-over)", () => {
    expect(isValidEventTimestamp("2026-02-30T00:00:00Z")).toBe(false);
    const errs = validateEventConvention(mkEvent({ timestamp: "2026-02-30T00:00:00Z" }));
    expect(errs.some((e) => e.path === "timestamp")).toBe(true);
  });

  it("rejects an out-of-enum actor_type", () => {
    const errs = validateEventConvention(mkEvent({ actor_type: "robot" }));
    expect(errs.some((e) => e.category === "base_record" && e.path === "actor_type")).toBe(true);
  });

  it("rejects a non-64-hex hash and a bad previous_hash", () => {
    expect(validateEventConvention(mkEvent({ hash: "xyz" })).some((e) => e.path === "hash")).toBe(true);
    expect(
      validateEventConvention(mkEvent({ previous_hash: "nothex" })).some((e) => e.path === "previous_hash"),
    ).toBe(true);
    // an uppercase hash is not lowercase SHA-256
    expect(validateEventConvention(mkEvent({ hash: "A".repeat(64) })).some((e) => e.path === "hash")).toBe(true);
  });

  it("accepts a null or non-empty trace_id, rejects an empty one", () => {
    expect(validateEventConvention(mkEvent({ trace_id: null }))).toEqual([]);
    expect(validateEventConvention(mkEvent({ trace_id: "T-1" }))).toEqual([]);
    expect(validateEventConvention(mkEvent({ trace_id: "" })).some((e) => e.path === "trace_id")).toBe(true);
  });
});

describe("validateEventConvention — unknown types and contracts", () => {
  it("flags an unknown event type (a valid hash does not make it conform)", () => {
    const errs = validateEventConvention(mkEvent({ event_type: "totally.unknown" }));
    expect(errs).toHaveLength(1);
    expect(errs[0].category).toBe("unknown_event_type");
  });

  it("rejects a disallowed actor_type for a known type", () => {
    const errs = validateEventConvention(mkEvent({ actor_type: "agent" }));
    // agent is a schema actor type (base ok) but not allowed for user.created
    expect(errs.some((e) => e.category === "actor_type")).toBe(true);
  });

  it("enforces the exact object_type and a required object_id", () => {
    expect(
      validateEventConvention(mkEvent({ object_type: "widget" })).some((e) => e.category === "object_type"),
    ).toBe(true);
    expect(
      validateEventConvention(mkEvent({ object_id: null })).some((e) => e.category === "object_id"),
    ).toBe(true);
  });

  it("requires a null payload for session events", () => {
    expect(validateEventConvention(mkEvent({ event_type: "auth.session_started", object_type: "session", payload: null }))).toEqual([]);
    const errs = validateEventConvention(
      mkEvent({ event_type: "auth.session_started", object_type: "session", payload: { x: 1 } }),
    );
    expect(errs.some((e) => e.category === "payload_null")).toBe(true);
  });

  it("validates a payload against its strict schema (extra field rejected)", () => {
    const errs = validateEventConvention(mkEvent({ payload: { display_name: "Al", extra: 1 } }));
    expect(errs.some((e) => e.category === "payload_schema")).toBe(true);
  });

  it("does NOT coerce types: \"1\" !== 1 and true !== 1 for an integer field", () => {
    const base = {
      event_type: "system.stop_engaged",
      object_type: "system-stop",
      object_id: "system",
    } as const;
    expect(validateEventConvention(mkEvent({ ...base, payload: { generation: 1, reason: null, session_id: "s" } }))).toEqual([]);
    expect(
      validateEventConvention(mkEvent({ ...base, payload: { generation: "1", reason: null, session_id: "s" } })).some(
        (e) => e.category === "payload_schema",
      ),
    ).toBe(true);
    expect(
      validateEventConvention(mkEvent({ ...base, payload: { generation: true, reason: null, session_id: "s" } })).some(
        (e) => e.category === "payload_schema",
      ),
    ).toBe(true);
  });

  it("accepts the caller-supplied object type for approval.recorded", () => {
    const ok = mkEvent({
      event_type: "approval.recorded",
      object_type: "decision-record",
      object_id: "DR-1",
      payload: { proposer_actor_id: "p", object_digest: HEX64 },
    });
    expect(validateEventConvention(ok)).toEqual([]);
    // object_digest may be null (non-decision-record approval)
    const ok2 = mkEvent({
      event_type: "approval.recorded",
      object_type: "widget",
      object_id: "W-1",
      payload: { proposer_actor_id: "p", object_digest: null },
    });
    expect(validateEventConvention(ok2)).toEqual([]);
    // but object_type may not be null for the "*" sentinel
    expect(
      validateEventConvention(mkEvent({ event_type: "approval.recorded", object_type: null, object_id: "X", payload: { proposer_actor_id: "p", object_digest: null } })).some(
        (e) => e.category === "object_type",
      ),
    ).toBe(true);
  });
});

const BLANKS = ["", " ", "\t", "\n", " \t "];

describe("validateEventConvention — non-blank strings (reject whitespace-only)", () => {
  it("isNonBlankString rejects every blank form", () => {
    for (const b of BLANKS) expect(isNonBlankString(b)).toBe(false);
    expect(isNonBlankString("x")).toBe(true);
    expect(isNonBlankString(" x ")).toBe(true);
  });

  it.each(BLANKS)("rejects a blank id %j", (blank) => {
    expect(validateEventConvention(mkEvent({ id: blank })).some((e) => e.path === "id")).toBe(true);
  });
  it.each(BLANKS)("rejects a blank actor_id %j", (blank) => {
    expect(validateEventConvention(mkEvent({ actor_id: blank })).some((e) => e.path === "actor_id")).toBe(true);
  });
  it.each(BLANKS)("rejects a blank required object_id %j", (blank) => {
    expect(validateEventConvention(mkEvent({ object_id: blank })).some((e) => e.category === "object_id")).toBe(true);
  });
  it.each(BLANKS)("rejects a blank trace_id %j (when not null)", (blank) => {
    expect(validateEventConvention(mkEvent({ trace_id: blank })).some((e) => e.path === "trace_id")).toBe(true);
  });
  it.each(BLANKS)("rejects a blank payload string field %j (display_name)", (blank) => {
    expect(validateEventConvention(mkEvent({ payload: { display_name: blank } })).some((e) => e.category === "payload_schema")).toBe(true);
  });
  it.each(BLANKS)("rejects a blank session_id %j in a stop event", (blank) => {
    const ev = mkEvent({ event_type: "system.stop_engaged", object_type: "system-stop", object_id: "system", payload: { generation: 1, reason: null, session_id: blank } });
    expect(validateEventConvention(ev).some((e) => e.category === "payload_schema")).toBe(true);
  });
});

describe("validateEventConvention — impossible events (invariants) with a valid hash", () => {
  it("the valid variants pass cleanly", () => {
    expect(validateEventConvention(validG01())).toEqual([]);
    expect(validateEventConvention(validPipeline())).toEqual([]);
    expect(validateEventConvention(validStanding())).toEqual([]);
    expect(validateEventConvention(validApprovalDR())).toEqual([]);
  });

  // approval.recorded
  it("rejects a decision-record approval with a null digest", () => {
    const errs = validateEventConvention(validApprovalDR({ object_digest: null }));
    expect(errs.some((e) => e.category === "invariant" && e.path === "payload.object_digest")).toBe(true);
  });
  it("rejects an approval whose approver equals the proposer", () => {
    const errs = validateEventConvention(validApprovalDR({ proposer_actor_id: "appr" }));
    expect(errs.some((e) => e.category === "invariant" && /differ from the proposer/.test(e.message))).toBe(true);
  });
  it("rejects an approval with a whitespace-only proposer", () => {
    expect(validateEventConvention(validApprovalDR({ proposer_actor_id: "  " })).some((e) => e.category === "payload_schema")).toBe(true);
  });

  // gate_passed — G-01
  it("rejects G-01 with no opportunity_ref", () => {
    const errs = validateEventConvention(withoutKey(validG01(), "opportunity_ref"));
    expect(errs.some((e) => e.category === "invariant" && e.path === "payload.opportunity_ref")).toBe(true);
  });
  it("rejects G-01 carrying subject fields", () => {
    const errs = validateEventConvention(validG01({ subject_type: "campaign", subject_id: "x" }));
    expect(errs.some((e) => e.category === "invariant" && e.path === "payload.subject_type")).toBe(true);
  });
  it("rejects G-01 whose object_id differs from payload.venture_id", () => {
    const errs = validateEventConvention(validG01({}, { object_id: "V-other" }));
    expect(errs.some((e) => e.category === "invariant" && e.path === "object_id")).toBe(true);
  });

  // gate_passed — pipeline
  it("rejects a pipeline gate with no effect", () => {
    const errs = validateEventConvention(withoutKey(validPipeline(), "effect"));
    expect(errs.some((e) => e.category === "invariant" && e.path === "payload.effect")).toBe(true);
  });
  it("rejects a pipeline gate whose object_id differs from venture_id", () => {
    expect(validateEventConvention(validPipeline({}, { object_id: "V-x" })).some((e) => e.path === "object_id")).toBe(true);
  });

  // gate_passed — standing
  it("rejects a standing gate carrying an effect", () => {
    const errs = validateEventConvention(validStanding({ effect: "venture_created" }));
    expect(errs.some((e) => e.category === "invariant" && e.path === "payload.effect")).toBe(true);
  });
  it("rejects a standing gate with no subject fields", () => {
    const errs = validateEventConvention(withoutKey(withoutKey(validStanding(), "subject_type"), "subject_id"));
    expect(errs.some((e) => e.category === "invariant" && e.path === "payload.subject_type")).toBe(true);
  });
  it("rejects a standing gate whose object type/id differ from the subject", () => {
    expect(validateEventConvention(validStanding({}, { object_type: "other" })).some((e) => e.path === "object_type")).toBe(true);
    expect(validateEventConvention(validStanding({}, { object_id: "other" })).some((e) => e.path === "object_id")).toBe(true);
  });
  it("rejects an authorization with a non-null from/to state", () => {
    expect(validateEventConvention(validStanding({ from_state: "x" })).some((e) => e.path === "payload.from_state")).toBe(true);
    expect(validateEventConvention(validStanding({ to_state: "x" })).some((e) => e.path === "payload.to_state")).toBe(true);
  });

  // gate_passed — actor/proposer/scope
  it("rejects a gate pass whose actor is not the approver", () => {
    const errs = validateEventConvention(validPipeline({}, { actor_id: "someone-else" }));
    expect(errs.some((e) => e.category === "invariant" && e.path === "actor_id")).toBe(true);
  });
  it("rejects a gate pass whose proposer equals the approver", () => {
    const errs = validateEventConvention(validPipeline({ proposer_actor_id: "appr" }));
    expect(errs.some((e) => e.category === "invariant" && /proposer and approver must differ/.test(e.message))).toBe(true);
  });
  it("rejects an unimplemented gate id", () => {
    const errs = validateEventConvention(validPipeline({ gate_id: "G-09" }));
    expect(errs.some((e) => e.category === "invariant" && e.path === "payload.gate_id")).toBe(true);
  });

  // ratification + stop generation
  it("rejects a ratification signature whose actor is not the signer", () => {
    const ev = mkEvent({
      event_type: "ratification.signature_recorded", actor_id: "someone", object_type: "founding-ratification-pack", object_id: "FRP-2026-1",
      payload: { pack_digest: HEX64, pack_version: "1.0.0", signer_actor_id: "signer", signer_capacity: "operator", acknowledgement_version: "1.0.0", session_id: "s" },
    });
    expect(validateEventConvention(ev).some((e) => e.category === "invariant" && e.path === "payload.signer_actor_id")).toBe(true);
  });
  it("rejects a stop generation beyond MAX_SAFE_INTEGER, 0, or non-integer", () => {
    const stop = (gen: unknown) => mkEvent({ event_type: "system.stop_engaged", object_type: "system-stop", object_id: "system", payload: { generation: gen, reason: null, session_id: "s" } });
    expect(validateEventConvention(stop(MAX_SAFE_GENERATION))).toEqual([]);
    expect(validateEventConvention(stop(MAX_SAFE_GENERATION + 1)).some((e) => e.category === "payload_schema")).toBe(true);
    expect(validateEventConvention(stop(0)).some((e) => e.category === "payload_schema")).toBe(true);
    expect(validateEventConvention(stop(1.5)).some((e) => e.category === "payload_schema")).toBe(true);
    expect(validateEventConvention(stop("1")).some((e) => e.category === "payload_schema")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Registry shape + venture references
// ---------------------------------------------------------------------------

describe("registry", () => {
  it("has exactly the 15 Phase 0 event types, no duplicates", () => {
    expect(EVENT_TYPES).toHaveLength(15);
    expect(new Set(EVENT_TYPES).size).toBe(15);
  });

  it("is deterministically ordered (issue ascending)", () => {
    const issues = EVENT_CONVENTIONS.map((c) => c.introducedByIssue);
    expect(issues).toEqual([...issues].sort((a, b) => a - b));
  });

  it("renders a stable table, contracts, and digest across calls", () => {
    expect(renderConventionsTable()).toBe(renderConventionsTable());
    expect(renderConventionsContracts()).toBe(renderConventionsContracts());
    expect(contractsDigest()).toMatch(/^[0-9a-f]{64}$/);
    expect(contractsDigest()).toBe(contractsDigest());
    // the digest appears verbatim in the rendered contracts section
    expect(renderConventionsContracts()).toContain(contractsDigest());
  });

  it("gate_passed uses the caller-supplied object sentinel and declares payload.venture_id", () => {
    const c = getConvention("gate_passed")!;
    expect(c.objectContract.objectType).toBe(ANY_OBJECT_TYPE);
    expect(c.ventureReferencePaths).toContain("payload.venture_id");
  });

  it("every convention that declares invariants ships a validator (and vice versa)", () => {
    for (const c of EVENT_CONVENTIONS) {
      expect(c.invariants.length > 0).toBe(Boolean(c.validateInvariants));
    }
  });
});

describe("ventureIdsReferenced", () => {
  it("matches object_type='venture'", () => {
    const ids = ventureIdsReferenced(mkEvent({ event_type: "venture.killed", object_type: "venture", object_id: "V-1", payload: { reason: "r", post_mortem_ref: "PM" } }));
    expect([...ids]).toEqual(["V-1"]);
  });

  it("matches a standing gate via the declared payload.venture_id path (object is the subject)", () => {
    const ev = mkEvent({
      event_type: "gate_passed",
      object_type: "campaign",
      object_id: "camp-1",
      payload: gatePayload({ transition_kind: "authorization", venture_id: "V-9", subject_type: "campaign", subject_id: "camp-1", kill_criteria: null, from_state: null, to_state: null }),
    });
    expect(ventureIdsReferenced(ev).has("V-9")).toBe(true);
  });

  it("does NOT treat an arbitrary payload string as a venture reference", () => {
    // display_name equal to a venture-looking id is not a declared reference
    const ev = mkEvent({ payload: { display_name: "V-2026-1" } });
    expect(ventureIdsReferenced(ev).size).toBe(0);
  });
});

/** A complete gate_passed payload with overridable fields (test helper). */
function gatePayload(over: Record<string, unknown>): Record<string, unknown> {
  return {
    gate_id: "G-17",
    gate_name: "Public Communication",
    dr_id: "DR-1",
    approval_event_id: "EV-a",
    proposer_actor_id: "p",
    approver_actor_id: "q",
    kill_criteria: [],
    reversibility_class: "R3",
    dr_digest: HEX64,
    transition_kind: "gate_pass",
    from_state: null,
    to_state: null,
    venture_id: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 3. The CLI as a child process (isolated temp databases)
// ---------------------------------------------------------------------------

/** Run the CLI from the repo root against `dbUrl`; capture status + streams. */
function runCli(args: string[], dbUrl: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(TSX, ["ops/verify-log.ts", ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function makeTempDb(admin: pg.Client, name: string): Promise<string> {
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  const url = DATABASE_URL.replace(/\/[^/]+$/, `/${name}`);
  execSync("node ../ops/migrate.mjs", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  return url;
}

describe("CLI verify + extract (seeded isolated DB)", () => {
  let admin: pg.Client;
  let db: pg.Client;
  let url: string;
  const dbName = `evolveos_audit_${runId}`;
  let ventureId: string;
  let stopTs: string; // timestamp of the stop event

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    url = await makeTempDb(admin, dbName);
    db = new pg.Client({ connectionString: url });
    await db.connect();
    const seed = await seedAuditChain(db);
    ventureId = seed.ventureId;
    stopTs = seed.stopTs;
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  it("verifies a fully seeded chain (exit 0)", () => {
    const r = runCli(["verify"], url);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/chain intact and conventions satisfied/);
    expect(r.stdout).toMatch(/head hash [0-9a-f]{64}/);
  });

  it("extract --venture returns the venture-object events and the standing-gate reference", () => {
    const r = runCli(["extract", "--venture", ventureId], url);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/verification\s+OK/);
    expect(r.stdout).toMatch(/head hash\s+[0-9a-f]{64}/);
    // events are printed in seq ASC order
    const seqs = [...r.stdout.matchAll(/^seq (\d+)$/gm)].map((m) => Number(m[1]));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs.length).toBeGreaterThan(0);
    // gate_passed (G-01) and a venture.* event are present
    expect(r.stdout).toContain("gate_passed");
    expect(r.stdout).toContain("venture.");
  });

  it("a similar-but-not-exact venture id matches nothing (success, 0 matched)", () => {
    const r = runCli(["extract", "--venture", ventureId + "x"], url);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/0 events matched/);
  });

  it("--from is inclusive and --to is exclusive around the stop event", () => {
    // to = stop timestamp EXCLUDES the stop event
    const before = runCli(["extract", "--to", stopTs], url);
    expect(before.code).toBe(0);
    expect(before.stdout).not.toContain("system.stop_engaged");
    // from = stop timestamp INCLUDES the stop event
    const after = runCli(["extract", "--from", stopTs], url);
    expect(after.code).toBe(0);
    expect(after.stdout).toContain("system.stop_engaged");
  });

  it("rejects --from >= --to as a usage error (exit 2)", () => {
    const r = runCli(["extract", "--from", "2026-02-01T00:00:00Z", "--to", "2026-01-01T00:00:00Z"], url);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/must be strictly before/);
  });

  it("rejects a malformed --from date (exit 2)", () => {
    const r = runCli(["extract", "--from", "not-a-date"], url);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/strict RFC3339/);
  });

  it("prints canonical payload JSON (key-sorted)", () => {
    const r = runCli(["extract", "--venture", ventureId], url);
    // gate_passed payload has approval_event_id before dr_id alphabetically
    expect(r.stdout).toMatch(/payload\s+\{"approval_event_id"/);
  });

  it("--jsonl emits one JSON object per selected event", () => {
    const r = runCli(["extract", "--venture", ventureId, "--jsonl"], url);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    expect(lines.length).toBeGreaterThan(0);
  });

  it("does not leak the DATABASE_URL on a connection error (exit 2)", () => {
    const bad = "postgres://postgres:postgres@localhost:5432/nonexistent_db_zzz";
    const r = runCli(["verify"], bad);
    expect(r.code).toBe(2);
    expect(r.stderr).not.toContain("postgres:postgres@");
  });

  it("escapes control characters in untrusted event text", async () => {
    // Append (via the real path) an event whose actor_id carries a control char.
    // It is convention-valid EXCEPT nothing — actor_id non-empty is fine; the
    // control char must be rendered as an escape, never emitted raw.
    await appendEvent(db, {
      id: `EV-ctrl-${runId}`,
      timestamp: "2026-07-17T00:00:00Z",
      actor_type: "human",
      actor_id: "evilid",
      event_type: "auth.session_started",
      object_type: "session",
      object_id: `S-ctrl-${runId}`,
      payload: null,
    });
    const r = runCli(["extract"], url);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("evil\\x07id");
    expect(r.stdout).not.toContain("evilid");
  });
});

// ---------------------------------------------------------------------------
// 4. Tamper detection (append-only triggers disabled in a controlled fixture)
// ---------------------------------------------------------------------------

describe("CLI verify — tamper detection", () => {
  let admin: pg.Client;
  let db: pg.Client;
  let url: string;
  const dbName = `evolveos_tamper_${runId}`;
  let targetSeq: number;
  let original: Record<string, unknown>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    url = await makeTempDb(admin, dbName);
    db = new pg.Client({ connectionString: url });
    await db.connect();
    // A tiny valid chain via the real path.
    await createUser(db, { id: `t-${runId}`, displayName: "Tamper Target" });
    await grantRole(db, { userId: `t-${runId}`, role: "operator", grantedBy: "admin" });
    const s = await startSession(db, { userId: `t-${runId}` });
    await endSession(db, { sessionId: s.id, userId: `t-${runId}` });
    const row = await db.query("SELECT seq FROM events WHERE event_type='user.created' ORDER BY seq ASC LIMIT 1");
    targetSeq = Number(row.rows[0].seq);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  async function withTriggersDisabled(fn: () => Promise<void>): Promise<void> {
    await db.query("ALTER TABLE events DISABLE TRIGGER USER");
    try {
      await fn();
    } finally {
      await db.query("ALTER TABLE events ENABLE TRIGGER USER");
    }
  }

  async function saveTarget(): Promise<void> {
    const { rows } = await db.query(
      "SELECT payload, actor_id, event_type, previous_hash, hash FROM events WHERE seq=$1",
      [targetSeq],
    );
    original = rows[0];
  }
  async function restoreTarget(): Promise<void> {
    await withTriggersDisabled(async () => {
      await db.query(
        "UPDATE events SET payload=$2, actor_id=$3, event_type=$4, previous_hash=$5, hash=$6 WHERE seq=$1",
        [targetSeq, original.payload, original.actor_id, original.event_type, original.previous_hash, original.hash],
      );
    });
  }

  it("the un-tampered chain verifies (exit 0)", () => {
    expect(runCli(["verify"], url).code).toBe(0);
  });

  const mutations: Array<[string, string, unknown[]]> = [
    ["payload", "UPDATE events SET payload=jsonb_set(payload,'{display_name}','\"HACKED\"') WHERE seq=$1", []],
    ["actor_id", "UPDATE events SET actor_id='mallory' WHERE seq=$1", []],
    ["event_type", "UPDATE events SET event_type='role.granted' WHERE seq=$1", []],
    ["previous_hash", "UPDATE events SET previous_hash=$2 WHERE seq=$1", ["b".repeat(64)]],
    ["hash", "UPDATE events SET hash=$2 WHERE seq=$1", ["c".repeat(64)]],
  ];

  it.each(mutations)("detects a tampered %s (exit 1)", async (_label, sql, extra) => {
    await saveTarget();
    await withTriggersDisabled(async () => {
      await db.query(sql, [targetSeq, ...extra]);
    });
    const r = runCli(["verify"], url);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/FAIL/);
    await restoreTarget();
    expect(runCli(["verify"], url).code).toBe(0);
  });

  it("detects an unknown event type carrying a VALID recomputed hash (exit 1)", async () => {
    // Insert a row whose hash is correctly computed but whose type is unknown.
    await withTriggersDisabled(async () => {
      const head = await db.query("SELECT hash FROM events ORDER BY seq DESC LIMIT 1");
      const prev = head.rows.length ? head.rows[0].hash : null;
      const rec = {
        id: `EV-fake-${runId}`,
        timestamp: "2026-07-17T00:00:00Z",
        actor_type: "human" as const,
        actor_id: "u",
        event_type: "totally.unknown",
        object_type: "x",
        object_id: "y",
        payload: { z: 1 },
        previous_hash: prev,
        trace_id: null,
      };
      const hash = computeHash(rec);
      await db.query(
        `INSERT INTO events (id,timestamp,actor_type,actor_id,event_type,object_type,object_id,payload,previous_hash,hash,trace_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rec.id, rec.timestamp, rec.actor_type, rec.actor_id, rec.event_type, rec.object_type, rec.object_id, JSON.stringify(rec.payload), rec.previous_hash, hash, rec.trace_id],
      );
    });
    const r = runCli(["verify"], url);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/unknown_event_type/);
    // remove the injected row so the DB is clean for any later assertions
    await withTriggersDisabled(async () => {
      await db.query("DELETE FROM events WHERE id=$1", [`EV-fake-${runId}`]);
    });
  });

  it("extract refuses over a globally invalid chain, printing NO events (exit 1)", async () => {
    await saveTarget();
    await withTriggersDisabled(async () => {
      await db.query("UPDATE events SET actor_id='mallory' WHERE seq=$1", [targetSeq]);
    });
    const r = runCli(["extract"], url);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing to extract/);
    expect(r.stdout).not.toMatch(/^seq \d+$/m);
    await restoreTarget();
  });
});

// ---------------------------------------------------------------------------
// 5. Convention violations with a VALID hash (appended legitimately)
// ---------------------------------------------------------------------------

describe("CLI verify — valid-hash convention violations", () => {
  let admin: pg.Client;
  let db: pg.Client;
  let url: string;
  const dbName = `evolveos_conv_${runId}`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    url = await makeTempDb(admin, dbName);
    db = new pg.Client({ connectionString: url });
    await db.connect();
  }, 60_000);
  afterAll(async () => {
    if (db) await db.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  it("a semantically-invalid payload with a valid hash fails (exit 1)", async () => {
    // appendEvent computes a correct hash for ANY payload — so this row links
    // cryptographically but violates user.created's schema (extra field).
    await appendEvent(db, {
      id: `EV-badpay-${runId}`,
      timestamp: "2026-07-17T00:00:00Z",
      actor_type: "human",
      actor_id: "u",
      event_type: "user.created",
      object_type: "user",
      object_id: "u2",
      payload: { display_name: "ok", rogue: true },
    });
    const r = runCli(["verify"], url);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/payload_schema/);
  });

  it("a malformed timestamp with a valid hash fails (exit 1)", async () => {
    await appendEvent(db, {
      id: `EV-badts-${runId}`,
      timestamp: "not-a-timestamp",
      actor_type: "human",
      actor_id: "u",
      event_type: "auth.session_started",
      object_type: "session",
      object_id: `S-badts-${runId}`,
      payload: null,
    });
    const r = runCli(["verify"], url);
    expect(r.code).toBe(1);
    // both the bad payload above and this bad timestamp are reported
    expect(r.stderr).toMatch(/timestamp/);
  });
});

// ---------------------------------------------------------------------------
// 5b. Impossible events with a VALID hash, rejected by the REAL CLI (exit 1)
// ---------------------------------------------------------------------------

describe("CLI verify — impossible events with a valid hash (real CLI)", () => {
  let admin: pg.Client;
  let db: pg.Client;
  let url: string;
  const dbName = `evolveos_imposs_${runId}`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    url = await makeTempDb(admin, dbName);
    db = new pg.Client({ connectionString: url });
    await db.connect();
  }, 60_000);
  afterAll(async () => {
    if (db) await db.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  // Append the record's content via appendEvent — a correctly recomputed hash,
  // so ONLY the convention/invariant can fail (never hash/link).
  async function append(rec: AuditEventRecord, id: string): Promise<void> {
    await appendEvent(db, {
      id,
      timestamp: rec.timestamp,
      actor_type: rec.actor_type as "human",
      actor_id: rec.actor_id,
      event_type: rec.event_type,
      object_type: rec.object_type,
      object_id: rec.object_id,
      payload: rec.payload,
    });
  }

  it("detects G-01 without opportunity_ref, a standing gate with an effect, a null-digest DR approval, and actor≠approver (exit 1)", async () => {
    await append(withoutKey(validG01(), "opportunity_ref"), `EV-i1-${runId}`);
    await append(validStanding({ effect: "venture_created" }), `EV-i2-${runId}`);
    await append(validApprovalDR({ object_digest: null }), `EV-i3-${runId}`);
    await append(validPipeline({}, { actor_id: "not-approver" }), `EV-i4-${runId}`);

    const r = runCli(["verify"], url);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/category=invariant/);
    expect(r.stderr).toMatch(/path=payload\.opportunity_ref/);
    expect(r.stderr).toMatch(/path=payload\.effect/);
    expect(r.stderr).toMatch(/path=payload\.object_digest/);
    expect(r.stderr).toMatch(/path=actor_id/);
    // extract must also refuse over this now-invalid chain
    const ex = runCli(["extract"], url);
    expect(ex.code).toBe(1);
    expect(ex.stdout).not.toMatch(/^seq \d+$/m);
  });
});

// ---------------------------------------------------------------------------
// 6. Snapshot isolation (an uncommitted append is invisible to verify)
// ---------------------------------------------------------------------------

describe("CLI verify — snapshot isolation", () => {
  let admin: pg.Client;
  let writer: pg.Client;
  let url: string;
  const dbName = `evolveos_snap_${runId}`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    url = await makeTempDb(admin, dbName);
    writer = new pg.Client({ connectionString: url });
    await writer.connect();
    await createUser(writer, { id: `snap-${runId}`, displayName: "Snap" });
  }, 60_000);
  afterAll(async () => {
    if (writer) await writer.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  it("does not see an uncommitted concurrent append, then sees it after commit", async () => {
    const before = runCli(["verify"], url);
    expect(before.code).toBe(0);
    const beforeCount = Number(before.stdout.match(/\((\d+) event/)![1]);

    // Open a transaction that appends but does NOT commit.
    await writer.query("BEGIN");
    await writer.query("SELECT pg_advisory_xact_lock(4207001)");
    const head = await writer.query("SELECT hash FROM events ORDER BY seq DESC LIMIT 1");
    const prev = head.rows.length ? head.rows[0].hash : null;
    const rec = {
      id: `EV-uncommitted-${runId}`,
      timestamp: "2026-07-17T00:00:00Z",
      actor_type: "human" as const,
      actor_id: "u",
      event_type: "auth.session_started",
      object_type: "session",
      object_id: `S-uncommitted-${runId}`,
      payload: null,
      previous_hash: prev,
      trace_id: null,
    };
    const hash = computeHash(rec);
    await writer.query(
      `INSERT INTO events (id,timestamp,actor_type,actor_id,event_type,object_type,object_id,payload,previous_hash,hash,trace_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [rec.id, rec.timestamp, rec.actor_type, rec.actor_id, rec.event_type, rec.object_type, rec.object_id, rec.payload, rec.previous_hash, hash, rec.trace_id],
    );

    // A separate CLI process must NOT see the uncommitted row (still valid).
    const during = runCli(["verify"], url);
    expect(during.code).toBe(0);
    expect(Number(during.stdout.match(/\((\d+) event/)![1])).toBe(beforeCount);

    await writer.query("COMMIT");

    const after = runCli(["verify"], url);
    expect(after.code).toBe(0);
    expect(Number(after.stdout.match(/\((\d+) event/)![1])).toBe(beforeCount + 1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 7. Drift guard — AST emitter analysis + owner-aware drift (registry ⇄ writers ⇄ docs)
// ---------------------------------------------------------------------------

const REAL_REGISTRY = EVENT_CONVENTIONS.map((c) => ({ eventType: c.eventType, ownerModule: c.ownerModule }));
/** Emitters exactly matching the registry (each type by its owner) — the clean case. */
function cleanEmitters(): Map<string, Set<string>> {
  return new Map(EVENT_CONVENTIONS.map((c) => [c.eventType, new Set([c.ownerModule])]));
}
const DOC_MD = readFileSync(join(REPO_ROOT, "docs", "AUDIT_CONVENTIONS.md"), "utf8");

describe("AST emitter analysis (symbol-resolved, alias/namespace-proof)", () => {
  it("maps every registered type to EXACTLY its single owner module (real scan)", async () => {
    const { emitters, unresolved } = analyzeEmitters(await readProductiveSources());
    expect(unresolved).toEqual([]);
    expect([...emitters.keys()].sort()).toEqual([...EVENT_TYPES].sort());
    for (const c of EVENT_CONVENTIONS) {
      expect([...(emitters.get(c.eventType) ?? [])]).toEqual([c.ownerModule]);
    }
  });

  it("resolves a direct sink literal, a constant, and a funnel-helper call", () => {
    const { emitters, unresolved } = analyzeEmitters([
      {
        file: "app/src/lib/fixture.ts",
        text: `
          import { appendEventTx } from "./eventlog.js";
          const RATIFICATION_EVENT_TYPE = "ratification.signature_recorded";
          async function log(c: any, args: any) { await appendEventTx(c, { event_type: args.eventType }); }
          export async function a(c: any) { await appendEventTx(c, { event_type: "gate_passed" }); }
          export async function b(c: any) { await appendEventTx(c, { event_type: RATIFICATION_EVENT_TYPE }); }
          export async function d(c: any) { await log(c, { eventType: "user.created" }); }
        `,
      },
    ]);
    expect(unresolved).toEqual([]);
    expect(emitters.get("gate_passed")).toEqual(new Set(["app/src/lib/fixture.ts"]));
    expect(emitters.get("ratification.signature_recorded")).toEqual(new Set(["app/src/lib/fixture.ts"]));
    expect(emitters.get("user.created")).toEqual(new Set(["app/src/lib/fixture.ts"]));
  });

  it("detects a RENAMED import of appendEventTx (import { appendEventTx as emit })", () => {
    const { emitters } = analyzeEmitters([
      { file: "app/src/lib/rogue.ts", text: `import { appendEventTx as emit } from "./eventlog.js"; export async function f(c: any){ await emit(c, { event_type: "rogue.event" }); }` },
    ]);
    expect(emitters.get("rogue.event")).toEqual(new Set(["app/src/lib/rogue.ts"]));
  });

  it("detects a NAMESPACE import + property access (eventlog.appendEventTx)", () => {
    const { emitters } = analyzeEmitters([
      { file: "app/src/lib/rogue.ts", text: `import * as eventlog from "./eventlog.js"; export async function f(c: any){ await eventlog.appendEventTx(c, { event_type: "ns.event" }); }` },
    ]);
    expect(emitters.get("ns.event")).toEqual(new Set(["app/src/lib/rogue.ts"]));
  });

  it("keeps two files' same-named EVENT_TYPE constants distinct (per-symbol, not per-name)", () => {
    const { emitters } = analyzeEmitters([
      { file: "app/src/lib/a.ts", text: `import { appendEventTx } from "./eventlog.js"; const EVENT_TYPE = "a.type"; export async function f(c: any){ await appendEventTx(c, { event_type: EVENT_TYPE }); }` },
      { file: "app/src/lib/b.ts", text: `import { appendEventTx } from "./eventlog.js"; const EVENT_TYPE = "b.type"; export async function g(c: any){ await appendEventTx(c, { event_type: EVENT_TYPE }); }` },
    ]);
    expect(emitters.get("a.type")).toEqual(new Set(["app/src/lib/a.ts"]));
    expect(emitters.get("b.type")).toEqual(new Set(["app/src/lib/b.ts"]));
  });

  it("keeps two files' same-named funnel helpers distinct (per-symbol)", () => {
    const funnel = `async function log(c: any, args: any){ await appendEventTx(c, { event_type: args.eventType }); }`;
    const { emitters } = analyzeEmitters([
      { file: "app/src/lib/a.ts", text: `import { appendEventTx } from "./eventlog.js"; ${funnel} export async function f(c: any){ await log(c, { eventType: "a.evt" }); }` },
      { file: "app/src/lib/b.ts", text: `import { appendEventTx } from "./eventlog.js"; ${funnel} export async function g(c: any){ await log(c, { eventType: "b.evt" }); }` },
    ]);
    expect(emitters.get("a.evt")).toEqual(new Set(["app/src/lib/a.ts"]));
    expect(emitters.get("b.evt")).toEqual(new Set(["app/src/lib/b.ts"]));
  });

  it("follows an ALIAS of an imported constant to its real value", () => {
    const { emitters } = analyzeEmitters([
      { file: "app/src/lib/consts.ts", text: `export const REAL = "aliased.type";` },
      { file: "app/src/lib/x.ts", text: `import { appendEventTx } from "./eventlog.js"; import { REAL as RT } from "./consts.js"; export async function f(c: any){ await appendEventTx(c, { event_type: RT }); }` },
    ]);
    expect(emitters.get("aliased.type")).toEqual(new Set(["app/src/lib/x.ts"]));
  });

  it("reports a dynamic / non-resolvable event_type at a real sink as unresolved", () => {
    const { unresolved } = analyzeEmitters([
      { file: "app/src/lib/x.ts", text: `import { appendEventTx } from "./eventlog.js"; export async function f(c: any, kind: string){ await appendEventTx(c, { event_type: kind + "!" }); }` },
    ]);
    expect(unresolved.length).toBe(1);
    expect(unresolved[0].file).toBe("app/src/lib/x.ts");
  });

  it("does NOT count an event-type literal that never reaches a sink", () => {
    const { emitters, unresolved } = analyzeEmitters([
      { file: "app/src/lib/x.ts", text: `const notEmitted = { eventType: "user.created", note: "data" }; export const z = notEmitted;` },
    ]);
    expect(emitters.size).toBe(0);
    expect(unresolved).toEqual([]);
  });

  // --- fail-closed coverage: every sink/funnel call is concrete|forward|unresolved
  const IMPORTS = `import { appendEventTx } from "./eventlog.js"; import * as eventlog from "./eventlog.js";`;
  const emit1 = (body: string) => analyzeEmitters([{ file: "app/src/lib/x.ts", text: `${IMPORTS}\n${body}` }]);

  it("follows a local const alias of the sink (const emit = appendEventTx)", () => {
    const { emitters } = emit1(`const emit = appendEventTx; export async function f(c: any){ await emit(c, { event_type: "aliased.local" }); }`);
    expect(emitters.get("aliased.local")).toEqual(new Set(["app/src/lib/x.ts"]));
  });

  it("follows a local const alias from a namespace (const emit = eventlog.appendEventTx)", () => {
    const { emitters } = emit1(`const emit = eventlog.appendEventTx; export async function f(c: any){ await emit(c, { event_type: "aliased.namespace" }); }`);
    expect(emitters.get("aliased.namespace")).toEqual(new Set(["app/src/lib/x.ts"]));
  });

  it("recognizes a quoted event_type property", () => {
    const { emitters } = emit1(`export async function f(c: any){ await appendEventTx(c, { "event_type": "quoted.event" }); }`);
    expect(emitters.get("quoted.event")).toEqual(new Set(["app/src/lib/x.ts"]));
  });

  it("merges a static const spread deterministically", () => {
    const { emitters, unresolved } = emit1(`const base = { event_type: "spread.static" }; export async function f(c: any){ await appendEventTx(c, { ...base }); }`);
    expect(emitters.get("spread.static")).toEqual(new Set(["app/src/lib/x.ts"]));
    expect(unresolved).toEqual([]);
  });

  it.each([
    ["a builder call argument", `function buildEvent(){ return { event_type: "x" } as any; } export async function f(c: any){ await appendEventTx(c, buildEvent()); }`],
    ["a dynamic variable argument", `function makeInput(){ return {} as any; } export async function f(c: any){ const input = makeInput(); await appendEventTx(c, input); }`],
    ["a dynamic spread", `export async function f(c: any, input: any){ await appendEventTx(c, { ...input }); }`],
    ["a missing event_type", `export async function f(c: any){ await appendEventTx(c, { actor_type: "human" }); }`],
    ["a duplicated event_type", `export async function f(c: any){ await appendEventTx(c, { event_type: "a", event_type: "b" } as any); }`],
    ["a .bind() indirection around the sink", `export async function f(c: any){ await appendEventTx.bind(null)(c, { event_type: "bound.evt" }); }`],
  ])("fails closed (unresolved, no silent drop) on %s", (_label, body) => {
    const { emitters, unresolved } = emit1(body);
    expect(emitters.size).toBe(0);
    expect(unresolved.length).toBe(1);
  });
});

describe("check-audit-conventions drift guard", () => {
  it("the real docs table and full contracts equal the renderers", () => {
    expect(extractDocTable(DOC_MD)).toBe(renderConventionsTable());
    expect(extractDocContracts(DOC_MD)).toBe(renderConventionsContracts());
  });

  it("computeDrift is clean for the real sources", async () => {
    const { emitters, unresolved } = analyzeEmitters(await readProductiveSources());
    const problems = computeDrift({
      registry: REAL_REGISTRY,
      emitters,
      unresolved,
      docTable: extractDocTable(DOC_MD),
      expectedTable: renderConventionsTable(),
      docContracts: extractDocContracts(DOC_MD),
      expectedContracts: renderConventionsContracts(),
    });
    expect(problems).toEqual([]);
  });

  function driftWith(over: Partial<Parameters<typeof computeDrift>[0]>): string[] {
    return computeDrift({
      registry: REAL_REGISTRY,
      emitters: cleanEmitters(),
      unresolved: [],
      docTable: renderConventionsTable(),
      expectedTable: renderConventionsTable(),
      docContracts: renderConventionsContracts(),
      expectedContracts: renderConventionsContracts(),
      ...over,
    });
  }

  it("fails when a SECOND module emits system.stop_engaged (fixture)", () => {
    const emitters = cleanEmitters();
    emitters.get("system.stop_engaged")!.add("app/src/lib/rogue.ts");
    const problems = driftWith({ emitters });
    expect(problems.some((p) => /system\.stop_engaged.*emitted by 'app\/src\/lib\/rogue\.ts'.*only the owner/.test(p))).toBe(true);
  });

  it("fails when a second module emits user.created (fixture)", () => {
    const emitters = cleanEmitters();
    emitters.get("user.created")!.add("app/src/lib/other.ts");
    expect(driftWith({ emitters }).some((p) => /user\.created.*owner is 'app\/src\/lib\/auth\.ts'/.test(p))).toBe(true);
  });

  it("fails on an unregistered emitted type (fixture)", () => {
    const emitters = cleanEmitters();
    emitters.set("rogue.new_event", new Set(["app/src/lib/rogue.ts"]));
    expect(driftWith({ emitters }).some((p) => /rogue\.new_event.*NOT in the registry/.test(p))).toBe(true);
  });

  it("fails on a registered type with no writer (fixture)", () => {
    const emitters = cleanEmitters();
    emitters.delete("venture.killed");
    expect(driftWith({ emitters }).some((p) => /venture\.killed.*NO productive writer/.test(p))).toBe(true);
  });

  it("fails on an unresolved productive emission (fixture)", () => {
    const problems = driftWith({ unresolved: [{ file: "app/src/lib/x.ts", line: 9, detail: "non-resolvable event_type" }] });
    expect(problems.some((p) => /app\/src\/lib\/x\.ts:9.*non-resolvable/.test(p))).toBe(true);
  });

  it("fails when the docs summary table drifts (fixture)", () => {
    expect(driftWith({ docTable: "| Event type |\n|---|\n| `made.up` |" }).some((p) => /summary table does not match/.test(p))).toBe(true);
  });

  it("fails when the full contracts section drifts, even with the same field names (fixture)", () => {
    // Take the real contracts and flip one field's type int→string (generation),
    // keeping every field NAME identical — a names-only check would miss this.
    const mutated = renderConventionsContracts().replace('"type": "integer"', '"type": "string"');
    expect(mutated).not.toBe(renderConventionsContracts());
    expect(driftWith({ docContracts: mutated }).some((p) => /full contracts section does not match/.test(p))).toBe(true);
  });

  it("fails when the contracts markers are missing (fixture)", () => {
    expect(driftWith({ docContracts: null }).some((p) => /contracts markers/.test(p))).toBe(true);
  });
});
