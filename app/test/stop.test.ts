/**
 * G-00 manual stop mechanism (issue #12, P0-11).
 *
 * Real PostgreSQL. Covers: genesis (on a truly clean isolated DB), stop
 * authorization (any authorized human; every rejection), atomicity, idempotence,
 * the central gate guard on every public route, the lock-held agent-invocation
 * boundary (fake local callback — no real agents/credentials/models),
 * restart (approver + rationale), deterministic stop-vs-gate and stop-vs-invocation
 * ordering in both directions and concurrency (no sleeps), and projection↔event
 * corruption failing closed.
 *
 * The `system_stop_state` singleton is global to the DB and its history is
 * append-only, so cleanup uses the REAL API (release any stop) — never a
 * historically-impossible raw genesis reset. Generation is compared against a
 * per-test baseline, not a hardcoded 1. Genesis and corruption run on isolated
 * temporary databases so they never fabricate or pollute the shared history.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { execSync } from "node:child_process";
import {
  engageSystemStop,
  releaseSystemStop,
  getSystemStopState,
  assertSystemRunning,
  runGuardedAgentInvocation,
  SystemStoppedError,
  StopStateCorruptError,
  UnauthorizedStopActorError,
  RestartRequiresApproverError,
  RestartRationaleRequiredError,
  STOP_EVENT_TYPE,
  RESTART_EVENT_TYPE,
  STOP_OBJECT_TYPE,
  STOP_OBJECT_ID,
} from "../src/lib/stop.js";
import { createUser, grantRole, startSession, endSession, type Role } from "../src/lib/auth.js";
import { passPipelineGate, passStandingGate, passGate } from "../src/lib/gates.js";
import { appendEvent, verifyChainInDb } from "../src/lib/eventlog.js";
import { setupActors, fileDR, approveDR, ventureTo, mintVenture, type Actors } from "./helpers.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const MIGRATION_0007 = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "ops", "migrations", "0007_system_stop.sql");
const MAX = Number.MAX_SAFE_INTEGER; // 9007199254740991

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());
const EVENT_CHAIN_LOCK_KEY = 4207001; // mirrors APPEND_LOCK_KEY in eventlog.ts

let seq = 0;

interface Human {
  actorId: string;
  sessionId: string;
  name: string;
}

async function makeHuman(client: pg.Client, tag: string, roles: Role[]): Promise<Human> {
  const actorId = `usr-${runId}-${tag}-${seq++}`;
  const name = `Human ${tag}`;
  await createUser(client, { id: actorId, displayName: name });
  for (const r of roles) await grantRole(client, { userId: actorId, role: r, grantedBy: "admin" });
  const sessionId = (await startSession(client, { userId: actorId })).id;
  return { actorId, sessionId, name };
}

async function countEvents(client: pg.Client, type: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE event_type = $1",
    [type],
  );
  return rows[0].n;
}

async function stop(client: pg.Client, h: Human, reason?: string) {
  return engageSystemStop(client, { actorId: h.actorId, sessionId: h.sessionId, reason });
}
async function restart(client: pg.Client, h: Human, rationale = "cleared, safe to resume") {
  return releaseSystemStop(client, { actorId: h.actorId, sessionId: h.sessionId, rationale });
}
/** Return the system to running via the REAL API (never a raw genesis reset). */
async function ensureRunning(client: pg.Client, approver: Human): Promise<void> {
  const s = await getSystemStopState(client);
  if (s.isStopped) await restart(client, approver, "test cleanup");
}

async function waitForLockWaiter(observer: pg.Client, pid: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { rows } = await observer.query(
      "SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted AND locktype = 'advisory' LIMIT 1",
      [pid],
    );
    if (rows.length) return;
  }
  throw new Error(`no pending advisory lock appeared for pid ${pid}`);
}

/** Create + migrate an isolated temporary database; returns its connection URL. */
async function makeTempDb(admin: pg.Client, name: string): Promise<string> {
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  const url = DATABASE_URL.replace(/\/[^/]+$/, `/${name}`);
  execSync("node ../ops/migrate.mjs", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  return url;
}

// ---------------------------------------------------------------------------

describe("G-00 stop — authorization, atomicity, idempotence", () => {
  let client: pg.Client;
  let cleanup: Human;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    cleanup = await makeHuman(client, "clean-a", ["approver"]);
  });
  afterEach(async () => ensureRunning(client, cleanup));
  afterAll(async () => {
    await ensureRunning(client, cleanup);
    await client.end();
  });

  it.each(["operator", "approver", "viewer"] as const)("an authorized %s can stop", async (role) => {
    const base = (await getSystemStopState(client)).generation;
    const h = await makeHuman(client, `auth-${role}`, [role]);
    const r = await stop(client, h);
    expect(r.idempotent).toBe(false);
    const s = await getSystemStopState(client);
    expect(s.isStopped).toBe(true);
    expect(s.generation).toBe(base + 1);
  });

  it("an unregistered user, bad/ended/foreign session, or no-role user cannot stop", async () => {
    await expect(engageSystemStop(client, { actorId: `ghost-${runId}`, sessionId: "x" })).rejects.toThrow(UnauthorizedStopActorError);
    const h = await makeHuman(client, "authneg", ["operator"]);
    await expect(engageSystemStop(client, { actorId: h.actorId, sessionId: `no-${runId}` })).rejects.toThrow(/session .* does not exist/i);
    const ended = (await startSession(client, { userId: h.actorId })).id;
    await endSession(client, { sessionId: ended, userId: h.actorId });
    await expect(engageSystemStop(client, { actorId: h.actorId, sessionId: ended })).rejects.toThrow(/already ended/i);
    const other = await makeHuman(client, "authneg-other", ["operator"]);
    await expect(engageSystemStop(client, { actorId: h.actorId, sessionId: other.sessionId })).rejects.toThrow(/different user/i);
    const noRole = `usr-${runId}-norole-${seq++}`;
    await createUser(client, { id: noRole, displayName: "No Role" });
    const sess = (await startSession(client, { userId: noRole })).id;
    await expect(engageSystemStop(client, { actorId: noRole, sessionId: sess })).rejects.toThrow(/no active role/i);
    expect((await getSystemStopState(client)).isStopped).toBe(false);
  });

  it("reason is optional: absent and whitespace store null; a real reason is preserved", async () => {
    const h1 = await makeHuman(client, "reason-none", ["operator"]);
    await stop(client, h1);
    expect((await getSystemStopState(client)).reason).toBeNull();
    await ensureRunning(client, cleanup);
    const h2 = await makeHuman(client, "reason-ws", ["operator"]);
    await engageSystemStop(client, { actorId: h2.actorId, sessionId: h2.sessionId, reason: "   " });
    expect((await getSystemStopState(client)).reason).toBeNull();
    await ensureRunning(client, cleanup);
    const h3 = await makeHuman(client, "reason-real", ["operator"]);
    await stop(client, h3, "smoke in the datacenter");
    expect((await getSystemStopState(client)).reason).toBe("smoke in the datacenter");
  });

  it("a stop emits exactly one event, atomic with the projection, chain intact", async () => {
    const base = (await getSystemStopState(client)).generation;
    const h = await makeHuman(client, "atomic", ["operator"]);
    const before = await countEvents(client, STOP_EVENT_TYPE);
    const r = await stop(client, h, "reason");
    expect(await countEvents(client, STOP_EVENT_TYPE)).toBe(before + 1);
    const s = await getSystemStopState(client);
    expect(s.currentEventId).toBe(r.eventId);
    expect(s.generation).toBe(base + 1);
    const { rows } = await client.query("SELECT actor_type, object_type, object_id, payload FROM events WHERE id = $1", [r.eventId]);
    expect(rows[0].actor_type).toBe("human");
    expect(rows[0].object_type).toBe(STOP_OBJECT_TYPE);
    expect(rows[0].object_id).toBe(STOP_OBJECT_ID);
    expect(rows[0].payload.generation).toBe(base + 1);
    expect(rows[0].payload.session_id).toBe(h.sessionId);
    expect((await verifyChainInDb(client)).ok).toBe(true);
  });

  it("a projection-write failure rolls back the stop event (no partial effect)", async () => {
    const h = await makeHuman(client, "rollback", ["operator"]);
    const before = await countEvents(client, STOP_EVENT_TYPE);
    const wasStopped = (await getSystemStopState(client)).isStopped;
    await client.query("CREATE OR REPLACE FUNCTION __stop_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'blocked'; END; $$ LANGUAGE plpgsql;");
    await client.query("CREATE TRIGGER __stop_block_trg BEFORE UPDATE ON system_stop_state FOR EACH ROW EXECUTE FUNCTION __stop_block()");
    try {
      await expect(stop(client, h)).rejects.toThrow(/blocked/);
    } finally {
      await client.query("DROP TRIGGER IF EXISTS __stop_block_trg ON system_stop_state");
    }
    expect(await countEvents(client, STOP_EVENT_TYPE)).toBe(before);
    expect((await getSystemStopState(client)).isStopped).toBe(wasStopped);
  });

  it("stopping when already stopped is idempotent: same event, no generation bump", async () => {
    const h = await makeHuman(client, "idem", ["operator"]);
    const first = await stop(client, h, "first");
    const gen = (await getSystemStopState(client)).generation;
    const before = await countEvents(client, STOP_EVENT_TYPE);
    const again = await stop(client, h, "again");
    expect(again.idempotent).toBe(true);
    expect(again.eventId).toBe(first.eventId);
    expect(await countEvents(client, STOP_EVENT_TYPE)).toBe(before);
    expect((await getSystemStopState(client)).generation).toBe(gen);
  });
});

describe("G-00 stop — restart (approver + rationale)", () => {
  let client: pg.Client;
  let cleanup: Human;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    cleanup = await makeHuman(client, "clean-r", ["approver"]);
  });
  afterEach(async () => ensureRunning(client, cleanup));
  afterAll(async () => {
    await ensureRunning(client, cleanup);
    await client.end();
  });

  it("an approver + non-empty rationale restarts; the event records rationale and the released stop", async () => {
    const stopper = await makeHuman(client, "r-stop", ["operator"]);
    const stopRes = await stop(client, stopper, "halt");
    const genStopped = (await getSystemStopState(client)).generation;
    const approver = await makeHuman(client, "r-appr", ["approver"]);
    const r = await restart(client, approver, "root cause fixed");
    const s = await getSystemStopState(client);
    expect(s.isStopped).toBe(false);
    expect(s.generation).toBe(genStopped + 1);
    expect(s.reason).toBe("root cause fixed");
    const { rows } = await client.query("SELECT event_type, actor_id, payload FROM events WHERE id = $1", [r.eventId]);
    expect(rows[0].event_type).toBe(RESTART_EVENT_TYPE);
    expect(rows[0].actor_id).toBe(approver.actorId);
    expect(rows[0].payload.rationale).toBe("root cause fixed");
    expect(rows[0].payload.released_stop_event_id).toBe(stopRes.eventId);
  });

  it("restart without an approver role (operator/viewer) is rejected", async () => {
    const stopper = await makeHuman(client, "rn-stop", ["operator"]);
    await stop(client, stopper);
    await expect(restart(client, await makeHuman(client, "rn-op", ["operator"]))).rejects.toThrow(RestartRequiresApproverError);
    await expect(restart(client, await makeHuman(client, "rn-view", ["viewer"]))).rejects.toThrow(RestartRequiresApproverError);
    expect((await getSystemStopState(client)).isStopped).toBe(true);
  });

  it("restart with an absent/whitespace rationale, or an invalid session, is rejected", async () => {
    const stopper = await makeHuman(client, "rr-stop", ["operator"]);
    await stop(client, stopper);
    const approver = await makeHuman(client, "rr-appr", ["approver"]);
    await expect(releaseSystemStop(client, { actorId: approver.actorId, sessionId: approver.sessionId, rationale: "   " })).rejects.toThrow(RestartRationaleRequiredError);
    await expect(releaseSystemStop(client, { actorId: approver.actorId, sessionId: `no-${runId}`, rationale: "ok" })).rejects.toThrow(UnauthorizedStopActorError);
  });

  it("restart when already running is rejected with no event; the restarter need not be the stopper", async () => {
    const approver = await makeHuman(client, "rrun-appr", ["approver"]);
    const before = await countEvents(client, RESTART_EVENT_TYPE);
    await expect(restart(client, approver)).rejects.toThrow(/not stopped/i);
    expect(await countEvents(client, RESTART_EVENT_TYPE)).toBe(before);
    // Different person restarts.
    const stopper = await makeHuman(client, "diff-stop", ["viewer"]);
    await stop(client, stopper);
    await restart(client, approver, "different person restarts");
    expect((await getSystemStopState(client)).isStopped).toBe(false);
  });
});

describe("G-00 stop — halts every gate route and the agent boundary", () => {
  let client: pg.Client;
  let actors: Actors;
  let stopper: Human;
  let approver: Human;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "stop-gates");
    stopper = await makeHuman(client, "g-stop", ["operator"]);
    approver = await makeHuman(client, "g-appr", ["approver"]);
  });
  afterEach(async () => ensureRunning(client, approver));
  afterAll(async () => {
    await ensureRunning(client, approver);
    await client.end();
  });

  it("while stopped, G-01 mint is refused — no venture, no gate_passed event", async () => {
    await stop(client, stopper, "halt");
    const beforeGate = await countEvents(client, "gate_passed");
    const { rows: vb } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM ventures");
    await expect(mintVenture(client, actors)).rejects.toThrow(SystemStoppedError);
    expect(await countEvents(client, "gate_passed")).toBe(beforeGate);
    const { rows: va } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM ventures");
    expect(va[0].n).toBe(vb[0].n);
  });

  it("while stopped, a pipeline gate is refused; after restart it works", async () => {
    const vid = await ventureTo(client, actors, "research");
    await stop(client, stopper);
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const appr = await approveDR(client, actors, filed);
    const beforeGate = await countEvents(client, "gate_passed");
    await expect(
      passPipelineGate(client, { gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId: appr, actor: actors.approver }),
    ).rejects.toThrow(SystemStoppedError);
    expect(await countEvents(client, "gate_passed")).toBe(beforeGate);
    await restart(client, approver, "resume");
    const filed2 = await fileDR(client, actors, { gateId: "G-02" });
    const appr2 = await approveDR(client, actors, filed2);
    const ok = await passPipelineGate(client, { gateId: "G-02", ventureId: vid, decisionRecordId: filed2.drId, approvalEventId: appr2, actor: actors.approver });
    expect(ok.gateId).toBe("G-02");
  });

  it("while stopped, a standing gate and the dispatcher are refused", async () => {
    await stop(client, stopper);
    const filed = await fileDR(client, actors, { gateId: "G-17" });
    const appr = await approveDR(client, actors, filed);
    await expect(
      passStandingGate(client, { gateId: "G-17", subjectType: "post", subjectId: "p1", decisionRecordId: filed.drId, approvalEventId: appr, actor: actors.approver }),
    ).rejects.toThrow(SystemStoppedError);
    await expect(
      passGate(client, { gateId: "G-17", subjectType: "post", subjectId: "p2", decisionRecordId: filed.drId, approvalEventId: appr, actor: actors.approver }),
    ).rejects.toThrow(SystemStoppedError);
  });

  it("the agent boundary: running runs the callback once; stopped never runs it; restart re-allows", async () => {
    let ran = 0;
    await runGuardedAgentInvocation(client, () => { ran++; });
    expect(ran).toBe(1);
    await stop(client, stopper);
    await expect(runGuardedAgentInvocation(client, () => { ran++; })).rejects.toThrow(SystemStoppedError);
    expect(ran).toBe(1);
    await restart(client, approver, "resume");
    await runGuardedAgentInvocation(client, () => { ran++; });
    expect(ran).toBe(2);
  });
});

describe("G-00 stop — genesis on a clean isolated database", () => {
  let admin: pg.Client;
  let gc: pg.Client;
  const dbName = `evolveos_genesis_${runId}`;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    const url = await makeTempDb(admin, dbName);
    gc = new pg.Client({ connectionString: url });
    await gc.connect();
  });
  afterAll(async () => {
    if (gc) await gc.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  it("a truly clean DB is genesis running: gen 0, no transitions, guards allow", async () => {
    const s = await getSystemStopState(gc);
    expect(s.isStopped).toBe(false);
    expect(s.generation).toBe(0);
    expect(s.currentEventId).toBeNull();
    expect(s.actorId).toBeNull();
    expect(await countEvents(gc, STOP_EVENT_TYPE)).toBe(0);
    expect(await countEvents(gc, RESTART_EVENT_TYPE)).toBe(0);
    await expect(assertSystemRunning(gc)).resolves.toBeUndefined();
    let ran = 0;
    await runGuardedAgentInvocation(gc, () => { ran++; });
    expect(ran).toBe(1);
  });
});

describe("G-00 stop — projection↔event corruption fails closed (isolated DB)", () => {
  let admin: pg.Client;
  let gc: pg.Client;
  const dbName = `evolveos_corrupt_${runId}`;
  let stopperId: string;
  let nonTransitionEventId: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    const url = await makeTempDb(admin, dbName);
    gc = new pg.Client({ connectionString: url });
    await gc.connect();
    const stopper = await makeHuman(gc, "corrupt-stop", ["operator"]);
    stopperId = stopper.actorId;
    await stop(gc, stopper, "baseline stop");
    // A non-transition event to (mis)point the projection at.
    nonTransitionEventId = (await gc.query<{ id: string }>(
      "SELECT id FROM events WHERE event_type = 'user.created' LIMIT 1",
    )).rows[0].id;
  });
  afterAll(async () => {
    if (gc) await gc.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  async function expectFailsClosed(): Promise<void> {
    await expect(getSystemStopState(gc)).rejects.toThrow(StopStateCorruptError);
    await expect(assertSystemRunning(gc)).rejects.toThrow(StopStateCorruptError);
    let ran = 0;
    await expect(runGuardedAgentInvocation(gc, () => { ran++; })).rejects.toThrow(StopStateCorruptError);
    expect(ran).toBe(0);
  }

  /** Capture the valid projection, apply a raw corruption, assert, then restore. */
  async function corruptThenRestore(mutate: string, params: unknown[]): Promise<void> {
    const snap = (await gc.query("SELECT singleton, is_stopped, generation, current_event_id, actor_id, reason FROM system_stop_state")).rows;
    try {
      await gc.query(mutate, params);
      await expectFailsClosed();
    } finally {
      await gc.query("DELETE FROM system_stop_state");
      for (const r of snap) {
        await gc.query(
          "INSERT INTO system_stop_state (singleton, is_stopped, generation, current_event_id, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6)",
          [r.singleton, r.is_stopped, r.generation, r.current_event_id, r.actor_id, r.reason],
        );
      }
    }
  }

  it("genesis reconstructed while transitions exist → corrupt", async () => {
    await corruptThenRestore(
      "UPDATE system_stop_state SET is_stopped = FALSE, generation = 0, current_event_id = NULL, actor_id = NULL, reason = NULL WHERE singleton = TRUE",
      [],
    );
  });

  it("current_event_id points at a non-transition event → corrupt", async () => {
    await corruptThenRestore("UPDATE system_stop_state SET current_event_id = $1 WHERE singleton = TRUE", [nonTransitionEventId]);
  });

  it("actor mismatch between the projection and the current event → corrupt", async () => {
    await corruptThenRestore("UPDATE system_stop_state SET actor_id = 'someone-else' WHERE singleton = TRUE", []);
  });

  it("generation mismatch between the projection and the payload → corrupt", async () => {
    await corruptThenRestore("UPDATE system_stop_state SET generation = 999 WHERE singleton = TRUE", []);
  });

  it("reason mismatch between the projection and the stop payload → corrupt", async () => {
    await corruptThenRestore("UPDATE system_stop_state SET reason = 'a different reason' WHERE singleton = TRUE", []);
  });

  it("running (gen >= 1) while the latest transition is a stop → corrupt", async () => {
    await corruptThenRestore(
      "UPDATE system_stop_state SET is_stopped = FALSE, reason = 'x' WHERE singleton = TRUE",
      [],
    );
  });

  // Forged-event scenarios run LAST: they append newer transitions to this
  // isolated log, so the DB is dropped afterwards rather than restored.
  it("a restart referencing a non-stop event → corrupt", async () => {
    const forged = await appendEvent(gc, {
      id: `EV-forge-${runId}-${seq++}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: stopperId,
      event_type: RESTART_EVENT_TYPE,
      object_type: STOP_OBJECT_TYPE,
      object_id: STOP_OBJECT_ID,
      payload: { generation: 900, rationale: "forged", session_id: "s", released_stop_event_id: nonTransitionEventId },
    });
    await gc.query("DELETE FROM system_stop_state");
    await gc.query(
      "INSERT INTO system_stop_state (singleton, is_stopped, generation, current_event_id, actor_id, reason) VALUES (TRUE, FALSE, 900, $1, $2, 'forged')",
      [forged.id, stopperId],
    );
    await expectFailsClosed();
  });

  it("a current stop event whose payload is missing session_id → corrupt", async () => {
    const forged = await appendEvent(gc, {
      id: `EV-forge-${runId}-${seq++}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: stopperId,
      event_type: STOP_EVENT_TYPE,
      object_type: STOP_OBJECT_TYPE,
      object_id: STOP_OBJECT_ID,
      payload: { generation: 901, reason: null }, // no session_id
    });
    await gc.query("DELETE FROM system_stop_state");
    await gc.query(
      "INSERT INTO system_stop_state (singleton, is_stopped, generation, current_event_id, actor_id, reason) VALUES (TRUE, TRUE, 901, $1, $2, NULL)",
      [forged.id, stopperId],
    );
    await expectFailsClosed();
  });

  it("a current transition with an invalid timestamp → corrupt", async () => {
    const forged = await appendEvent(gc, {
      id: `EV-forge-${runId}-${seq++}`,
      timestamp: "not-a-real-timestamp",
      actor_type: "human",
      actor_id: stopperId,
      event_type: STOP_EVENT_TYPE,
      object_type: STOP_OBJECT_TYPE,
      object_id: STOP_OBJECT_ID,
      payload: { generation: 902, reason: null, session_id: "s" },
    });
    await gc.query("DELETE FROM system_stop_state");
    await gc.query(
      "INSERT INTO system_stop_state (singleton, is_stopped, generation, current_event_id, actor_id, reason) VALUES (TRUE, TRUE, 902, $1, $2, NULL)",
      [forged.id, stopperId],
    );
    await expectFailsClosed();
  });

  // --- strict generations + immediately-prior restart binding ---------------

  async function forge(
    eventType: string,
    payload: Record<string, unknown>,
    opts: { actorType?: string; timestamp?: string; actorId?: string } = {},
  ): Promise<string> {
    const ev = await appendEvent(gc, {
      id: `EV-forge-${runId}-${seq++}`,
      timestamp: opts.timestamp ?? new Date().toISOString(),
      actor_type: (opts.actorType ?? "human") as "human" | "agent" | "kernel" | "watchdog" | "system",
      actor_id: opts.actorId ?? stopperId,
      event_type: eventType,
      object_type: STOP_OBJECT_TYPE,
      object_id: STOP_OBJECT_ID,
      payload,
    });
    return ev.id;
  }
  async function setProjection(isStopped: boolean, generation: string | number, eventId: string, reason: string | null): Promise<void> {
    await gc.query("DELETE FROM system_stop_state");
    await gc.query(
      "INSERT INTO system_stop_state (singleton, is_stopped, generation, current_event_id, actor_id, reason) VALUES (TRUE, $1, $2, $3, $4, $5)",
      [isStopped, generation, eventId, stopperId, reason],
    );
  }

  it.each([
    ["a JSON string", "7"],
    ["a boolean", true],
    ["a float", 1.5],
    ["zero", 0],
    ["negative", -3],
    ["past MAX_SAFE_INTEGER", 9007199254740992],
  ] as const)("a current-transition payload.generation that is %s → corrupt", async (_label, badGen) => {
    const id = await forge(STOP_EVENT_TYPE, { generation: badGen, reason: null, session_id: "s" });
    await setProjection(true, 940, id, null);
    await expectFailsClosed();
  });

  it("a projection generation past the safe integer range → corrupt (read-level defense)", async () => {
    // The DB constraint normally blocks this; drop it to prove the read layer ALSO
    // fails closed (defense in depth), then restore it.
    const id = await forge(STOP_EVENT_TYPE, { generation: 945, reason: null, session_id: "s" });
    await gc.query("ALTER TABLE system_stop_state DROP CONSTRAINT system_stop_state_gen_safe");
    try {
      await setProjection(true, "9007199254740992", id, null);
      await expectFailsClosed();
    } finally {
      await gc.query("DELETE FROM system_stop_state");
      await gc.query("INSERT INTO system_stop_state (singleton, is_stopped, generation) VALUES (TRUE, FALSE, 0)");
      await gc.query("ALTER TABLE system_stop_state ADD CONSTRAINT system_stop_state_gen_safe CHECK (generation >= 0 AND generation <= 9007199254740991)");
    }
  });

  it("a restart that releases a stop that is NOT the immediately-preceding one → corrupt", async () => {
    const a = await forge(STOP_EVENT_TYPE, { generation: 960, reason: null, session_id: "s" });
    await forge(STOP_EVENT_TYPE, { generation: 961, reason: null, session_id: "s" }); // B (immediately-prior)
    const r = await forge(RESTART_EVENT_TYPE, { generation: 962, rationale: "x", session_id: "s", released_stop_event_id: a });
    await setProjection(false, 962, r, "x");
    await expectFailsClosed();
  });

  it("a restart with another restart between it and the released stop → corrupt", async () => {
    const a = await forge(STOP_EVENT_TYPE, { generation: 970, reason: null, session_id: "s" });
    await forge(RESTART_EVENT_TYPE, { generation: 971, rationale: "x", session_id: "s", released_stop_event_id: a });
    const r2 = await forge(RESTART_EVENT_TYPE, { generation: 972, rationale: "y", session_id: "s", released_stop_event_id: a });
    await setProjection(false, 972, r2, "y");
    await expectFailsClosed();
  });

  it("a released (immediately-prior) stop whose payload.generation is a string → corrupt", async () => {
    const a = await forge(STOP_EVENT_TYPE, { generation: "980", reason: null, session_id: "s" });
    const r = await forge(RESTART_EVENT_TYPE, { generation: 981, rationale: "x", session_id: "s", released_stop_event_id: a });
    await setProjection(false, 981, r, "x");
    await expectFailsClosed();
  });

  it("a released stop with actor_type agent → corrupt", async () => {
    const a = await forge(STOP_EVENT_TYPE, { generation: 990, reason: null, session_id: "s" }, { actorType: "agent" });
    const r = await forge(RESTART_EVENT_TYPE, { generation: 991, rationale: "x", session_id: "s", released_stop_event_id: a });
    await setProjection(false, 991, r, "x");
    await expectFailsClosed();
  });

  it("a released stop missing session_id → corrupt", async () => {
    const a = await forge(STOP_EVENT_TYPE, { generation: 993, reason: null }); // no session_id
    const r = await forge(RESTART_EVENT_TYPE, { generation: 994, rationale: "x", session_id: "s", released_stop_event_id: a });
    await setProjection(false, 994, r, "x");
    await expectFailsClosed();
  });

  it("a released stop with an invalid timestamp → corrupt", async () => {
    const a = await forge(STOP_EVENT_TYPE, { generation: 996, reason: null, session_id: "s" }, { timestamp: "nope" });
    const r = await forge(RESTART_EVENT_TYPE, { generation: 997, rationale: "x", session_id: "s", released_stop_event_id: a });
    await setProjection(false, 997, r, "x");
    await expectFailsClosed();
  });
});

describe("G-00 stop — DB-level integrity", () => {
  let client: pg.Client;
  let cleanup: Human;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    cleanup = await makeHuman(client, "clean-i", ["approver"]);
  });
  afterAll(async () => {
    await ensureRunning(client, cleanup);
    await client.end();
  });

  it("a second singleton row is impossible", async () => {
    await expect(
      client.query("INSERT INTO system_stop_state (singleton, is_stopped, generation) VALUES (TRUE, FALSE, 0)"),
    ).rejects.toThrow();
  });

  it("an incoherent state (gen >= 1 with no event) is rejected by the CHECK", async () => {
    await expect(
      client.query(
        "UPDATE system_stop_state SET is_stopped = TRUE, generation = 1, current_event_id = NULL, actor_id = NULL, reason = NULL WHERE singleton = TRUE",
      ),
    ).rejects.toThrow(/system_stop_state_coherent/);
  });

  it("a current_event_id that is not a real event is rejected by the FK", async () => {
    await expect(
      client.query("UPDATE system_stop_state SET is_stopped = TRUE, generation = 1, current_event_id = 'EV-nope', actor_id = 'x' WHERE singleton = TRUE"),
    ).rejects.toThrow(/foreign key|current_event_id/i);
  });
});

describe("G-00 stop — generation exhaustion & the safe-integer bound (isolated DB)", () => {
  let admin: pg.Client;
  let gc: pg.Client;
  const dbName = `evolveos_maxgen_${runId}`;
  let operator: Human;
  let approver: Human;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    const url = await makeTempDb(admin, dbName);
    gc = new pg.Client({ connectionString: url });
    await gc.connect();
    operator = await makeHuman(gc, "max-op", ["operator"]);
    approver = await makeHuman(gc, "max-appr", ["approver"]);
  });
  afterAll(async () => {
    if (gc) await gc.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  async function forgeEvent(eventType: string, actorId: string, payload: Record<string, unknown>): Promise<string> {
    const ev = await appendEvent(gc, {
      id: `EV-forge-${runId}-${seq++}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: actorId,
      event_type: eventType,
      object_type: STOP_OBJECT_TYPE,
      object_id: STOP_OBJECT_ID,
      payload,
    });
    return ev.id;
  }
  async function setProjection(isStopped: boolean, generation: number, eventId: string, actorId: string, reason: string | null): Promise<void> {
    await gc.query("DELETE FROM system_stop_state");
    await gc.query(
      "INSERT INTO system_stop_state (singleton, is_stopped, generation, current_event_id, actor_id, reason) VALUES (TRUE, $1, $2, $3, $4, $5)",
      [isStopped, generation, eventId, actorId, reason],
    );
  }

  it("engaging a stop from a valid running state at MAX generation is refused; nothing is written", async () => {
    // Coherent running state at MAX: restart(gen MAX) releasing stop(gen MAX-1).
    const s = await forgeEvent(STOP_EVENT_TYPE, operator.actorId, { generation: MAX - 1, reason: null, session_id: "s" });
    const r = await forgeEvent(RESTART_EVENT_TYPE, approver.actorId, { generation: MAX, rationale: "x", session_id: "s", released_stop_event_id: s });
    await setProjection(false, MAX, r, approver.actorId, "x");
    // The state validates correctly at MAX.
    const st = await getSystemStopState(gc);
    expect(st.isStopped).toBe(false);
    expect(st.generation).toBe(MAX);

    const beforeStops = await countEvents(gc, STOP_EVENT_TYPE);
    await expect(stop(gc, operator)).rejects.toThrow(StopStateCorruptError);
    expect(await countEvents(gc, STOP_EVENT_TYPE)).toBe(beforeStops); // no new event
    const after = await getSystemStopState(gc);
    expect(after.generation).toBe(MAX); // projection unchanged
    expect(after.isStopped).toBe(false);
    expect((await verifyChainInDb(gc)).ok).toBe(true);
  });

  it("releasing from a valid stopped state at MAX generation is refused before any event", async () => {
    const s = await forgeEvent(STOP_EVENT_TYPE, operator.actorId, { generation: MAX, reason: null, session_id: "s" });
    await setProjection(true, MAX, s, operator.actorId, null);
    const st = await getSystemStopState(gc);
    expect(st.isStopped).toBe(true);
    expect(st.generation).toBe(MAX);

    const beforeRestarts = await countEvents(gc, RESTART_EVENT_TYPE);
    await expect(restart(gc, approver)).rejects.toThrow(StopStateCorruptError);
    expect(await countEvents(gc, RESTART_EVENT_TYPE)).toBe(beforeRestarts);
    const after = await getSystemStopState(gc);
    expect(after.generation).toBe(MAX);
    expect(after.isStopped).toBe(true);
    expect((await verifyChainInDb(gc)).ok).toBe(true);
  });

  it("the SQL constraint rejects a generation past MAX but allows MAX", async () => {
    // A coherent stopped row to update (a real stop event exists at gen MAX).
    const s = await forgeEvent(STOP_EVENT_TYPE, operator.actorId, { generation: MAX, reason: null, session_id: "s" });
    await setProjection(true, MAX, s, operator.actorId, null);
    // MAX + 1 as a decimal string (never an unsafe JS number) is rejected.
    await expect(
      gc.query("UPDATE system_stop_state SET generation = $1 WHERE singleton = TRUE", ["9007199254740992"]),
    ).rejects.toThrow(/system_stop_state_gen_safe/);
    // MAX is still representable (no constraint violation).
    await expect(
      gc.query("UPDATE system_stop_state SET generation = $1 WHERE singleton = TRUE", ["9007199254740991"]),
    ).resolves.toBeTruthy();
  });
});

describe("G-00 stop — 0007 migration is idempotent and upgrades an old table (isolated DB)", () => {
  let admin: pg.Client;
  let gc: pg.Client;
  const dbName = `evolveos_mig_${runId}`;
  const sql = readFileSync(MIGRATION_0007, "utf8");

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    const url = await makeTempDb(admin, dbName);
    gc = new pg.Client({ connectionString: url });
    await gc.connect();
  });
  afterAll(async () => {
    if (gc) await gc.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  async function hasGenSafe(): Promise<boolean> {
    const { rows } = await gc.query("SELECT 1 FROM pg_constraint WHERE conname = 'system_stop_state_gen_safe'");
    return rows.length > 0;
  }

  it("re-running 0007 adds the safe-integer constraint to a table that lacked it, idempotently", async () => {
    expect(await hasGenSafe()).toBe(true); // fresh migrate already added it
    // Simulate a table created by the earlier version of 0007 (no bound).
    await gc.query("ALTER TABLE system_stop_state DROP CONSTRAINT system_stop_state_gen_safe");
    expect(await hasGenSafe()).toBe(false);
    // Re-running the migration SQL re-adds it (DO block, not CREATE TABLE).
    await gc.query(sql);
    expect(await hasGenSafe()).toBe(true);
    // Running it AGAIN is a no-op (idempotent) — no error, still one constraint.
    await gc.query(sql);
    expect(await hasGenSafe()).toBe(true);
    // And the re-added constraint actually rejects an overflow.
    await gc.query(
      "INSERT INTO events (id, timestamp, actor_type, actor_id, event_type, object_type, object_id, payload, previous_hash, hash) " +
        "VALUES ('EV-mig','2026-07-17T00:00:00.000Z','human','u','system.stop_engaged','system-stop','system','{}'::jsonb,NULL,'h-mig')",
    );
    await gc.query(
      "UPDATE system_stop_state SET is_stopped = TRUE, generation = 1, current_event_id = 'EV-mig', actor_id = 'u', reason = NULL WHERE singleton = TRUE",
    );
    await expect(
      gc.query("UPDATE system_stop_state SET generation = $1 WHERE singleton = TRUE", ["9007199254740992"]),
    ).rejects.toThrow(/system_stop_state_gen_safe/);
  });
});

describe("G-00 stop — deterministic concurrency & ordering (Postgres)", () => {
  let a: pg.Client;
  let b: pg.Client;
  let h: pg.Client;
  let obs: pg.Client;
  let cleanup: Human;
  beforeAll(async () => {
    a = new pg.Client({ connectionString: DATABASE_URL });
    b = new pg.Client({ connectionString: DATABASE_URL });
    h = new pg.Client({ connectionString: DATABASE_URL });
    obs = new pg.Client({ connectionString: DATABASE_URL });
    await Promise.all([a.connect(), b.connect(), h.connect(), obs.connect()]);
    cleanup = await makeHuman(a, "clean-cc", ["approver"]);
  });
  afterEach(async () => ensureRunning(a, cleanup));
  afterAll(async () => {
    await ensureRunning(a, cleanup);
    await Promise.all([a.end(), b.end(), h.end(), obs.end()]);
  });

  it("two concurrent stops collapse to exactly one event", async () => {
    const base = (await getSystemStopState(a)).generation;
    const h1 = await makeHuman(a, "cc-s1", ["operator"]);
    const h2 = await makeHuman(a, "cc-s2", ["operator"]);
    const before = await countEvents(a, STOP_EVENT_TYPE);
    await Promise.all([stop(a, h1), stop(b, h2)]);
    expect(await countEvents(a, STOP_EVENT_TYPE)).toBe(before + 1);
    expect((await getSystemStopState(a)).generation).toBe(base + 1);
  });

  it("two concurrent restarts collapse to exactly one effective release", async () => {
    const stopper = await makeHuman(a, "cc-rstop", ["operator"]);
    await stop(a, stopper);
    const ap1 = await makeHuman(a, "cc-r1", ["approver"]);
    const ap2 = await makeHuman(a, "cc-r2", ["approver"]);
    const before = await countEvents(a, RESTART_EVENT_TYPE);
    const results = await Promise.allSettled([restart(a, ap1), restart(b, ap2)]);
    expect(await countEvents(a, RESTART_EVENT_TYPE)).toBe(before + 1);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
    expect((await getSystemStopState(a)).isStopped).toBe(false);
  });

  it("stop that wins the lock → a queued gate pass then refuses", async () => {
    const actors = await setupActors(a, "race-svg");
    const vid = await ventureTo(a, actors, "research");
    const stopper = await makeHuman(a, "race-svg-stop", ["operator"]);
    const filed = await fileDR(a, actors, { gateId: "G-02" });
    const appr = await approveDR(a, actors, filed);
    await h.query("BEGIN");
    await h.query("SELECT pg_advisory_xact_lock($1)", [EVENT_CHAIN_LOCK_KEY]);
    const stopPid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const gatePid = (await a.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const stopP = stop(b, stopper, "halt now");
    await waitForLockWaiter(obs, stopPid);
    const gateP = passPipelineGate(a, { gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId: appr, actor: actors.approver });
    await waitForLockWaiter(obs, gatePid);
    await h.query("COMMIT");
    await expect(stopP).resolves.toMatchObject({ idempotent: false });
    await expect(gateP).rejects.toThrow(SystemStoppedError);
  });

  it("stop that wins the lock → a queued agent invocation refuses; callback never runs", async () => {
    const stopper = await makeHuman(a, "race-svi-stop", ["operator"]);
    await h.query("BEGIN");
    await h.query("SELECT pg_advisory_xact_lock($1)", [EVENT_CHAIN_LOCK_KEY]);
    const stopPid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const invPid = (await a.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const stopP = stop(b, stopper);
    await waitForLockWaiter(obs, stopPid);
    let ran = 0;
    const invP = runGuardedAgentInvocation(a, () => { ran++; });
    await waitForLockWaiter(obs, invPid);
    await h.query("COMMIT");
    await expect(stopP).resolves.toMatchObject({ idempotent: false });
    await expect(invP).rejects.toThrow(SystemStoppedError);
    expect(ran).toBe(0); // callback never ran after the stop committed
  });

  it("agent invocation that wins the lock completes coherently before a queued stop; the next invocation refuses", async () => {
    const stopper = await makeHuman(a, "race-ivs-stop", ["operator"]);
    let ran = 0;
    let releaseCallback!: () => void;
    let callbackStarted!: () => void;
    const barrier = new Promise<void>((r) => { releaseCallback = r; });
    const started = new Promise<void>((r) => { callbackStarted = r; });

    // The invocation acquires the lock (free) and enters the callback, which
    // holds the transaction open on the barrier.
    const invP = runGuardedAgentInvocation(a, async () => { callbackStarted(); await barrier; ran++; });
    await started;

    // A stop now queues behind the invocation's held lock.
    const stopPid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const stopP = stop(b, stopper);
    await waitForLockWaiter(obs, stopPid);

    // Release the callback: the invocation commits, THEN the stop lands.
    releaseCallback();
    await expect(invP).resolves.toBeUndefined();
    expect(ran).toBe(1);
    await expect(stopP).resolves.toMatchObject({ idempotent: false });

    // The next invocation, after the committed stop, refuses.
    let ran2 = 0;
    await expect(runGuardedAgentInvocation(a, () => { ran2++; })).rejects.toThrow(SystemStoppedError);
    expect(ran2).toBe(0);
  });
});
