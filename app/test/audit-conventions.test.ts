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
  getConvention,
  isValidEventTimestamp,
  EVENT_TYPES,
  EVENT_CONVENTIONS,
  ANY_OBJECT_TYPE,
  type AuditEventRecord,
} from "../src/lib/audit-conventions.js";
import {
  scanEmittedEventTypes,
  extractDocTable,
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

  it("renders a stable table across calls", () => {
    expect(renderConventionsTable()).toBe(renderConventionsTable());
  });

  it("gate_passed uses the caller-supplied object sentinel and declares payload.venture_id", () => {
    const c = getConvention("gate_passed")!;
    expect(c.objectContract.objectType).toBe(ANY_OBJECT_TYPE);
    expect(c.ventureReferencePaths).toContain("payload.venture_id");
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
// 7. Drift guard (registry ⇄ writers ⇄ docs)
// ---------------------------------------------------------------------------

describe("check-audit-conventions drift guard", () => {
  it("the real productive scan equals the registry set", async () => {
    const emitted = await scanEmittedEventTypes(join(REPO_ROOT, "app", "src"));
    expect([...emitted].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("the real docs table equals renderConventionsTable()", () => {
    const md = readFileSync(join(REPO_ROOT, "docs", "AUDIT_CONVENTIONS.md"), "utf8");
    expect(extractDocTable(md)).toBe(renderConventionsTable());
  });

  it("computeDrift is clean for the real sources", () => {
    const md = readFileSync(join(REPO_ROOT, "docs", "AUDIT_CONVENTIONS.md"), "utf8");
    const problems = computeDrift({
      registryTypes: EVENT_TYPES,
      emittedTypes: new Set(EVENT_TYPES),
      docTable: extractDocTable(md),
      expectedTable: renderConventionsTable(),
    });
    expect(problems).toEqual([]);
  });

  it("flags an unregistered productive writer (fixture)", () => {
    const problems = computeDrift({
      registryTypes: EVENT_TYPES,
      emittedTypes: new Set([...EVENT_TYPES, "rogue.new_event"]),
      docTable: renderConventionsTable(),
      expectedTable: renderConventionsTable(),
    });
    expect(problems.some((p) => /rogue\.new_event.*NOT in the registry/.test(p))).toBe(true);
  });

  it("flags a registered type with no writer (fixture)", () => {
    const problems = computeDrift({
      registryTypes: [...EVENT_TYPES, "ghost.type"],
      emittedTypes: new Set(EVENT_TYPES),
      docTable: renderConventionsTable(),
      expectedTable: renderConventionsTable(),
    });
    expect(problems.some((p) => /ghost\.type.*NO productive writer/.test(p))).toBe(true);
  });

  it("flags a docs table that drifts from the registry (fixture)", () => {
    const problems = computeDrift({
      registryTypes: EVENT_TYPES,
      emittedTypes: new Set(EVENT_TYPES),
      docTable: "| Event type |\n|---|\n| `made.up` |",
      expectedTable: renderConventionsTable(),
    });
    expect(problems.some((p) => /does not match renderConventionsTable/.test(p))).toBe(true);
    expect(problems.some((p) => /made\.up.*not in the registry/.test(p))).toBe(true);
  });

  it("flags missing table markers (fixture)", () => {
    const problems = computeDrift({
      registryTypes: EVENT_TYPES,
      emittedTypes: new Set(EVENT_TYPES),
      docTable: null,
      expectedTable: renderConventionsTable(),
    });
    expect(problems.some((p) => /table markers/.test(p))).toBe(true);
  });
});
