import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  canonicalize,
  computeHash,
  appendEvent,
  verifyChainRecords,
  verifyChainInDb,
  type EventRecord,
  type AppendInput,
} from "../src/lib/eventlog.js";

// ---------------------------------------------------------------------------
// Pure tests — no database. Determinism, hashing, and tamper detection.
// ---------------------------------------------------------------------------

describe("canonicalize / computeHash", () => {
  it("is independent of object key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ x: { q: 1, p: 2 } })).toBe('{"x":{"p":2,"q":1}}');
  });

  it("is deterministic and depends on content", () => {
    const base = {
      id: "EV-1", timestamp: "2027-01-01T00:00:00Z", actor_type: "system" as const,
      actor_id: "test", event_type: "unit.test", object_type: null, object_id: null,
      payload: { a: 1 }, previous_hash: null, trace_id: null,
    };
    expect(computeHash(base)).toBe(computeHash({ ...base }));
    expect(computeHash({ ...base, payload: { a: 2 } })).not.toBe(computeHash(base));
    expect(computeHash({ ...base, actor_id: "other" })).not.toBe(computeHash(base));
  });
});

/** Build a valid in-memory chain (a "dump") of `n` events. */
function buildChain(n: number): EventRecord[] {
  const out: EventRecord[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const base = {
      id: `EV-${i}`, timestamp: `2027-01-01T00:0${i}:00Z`, actor_type: "system" as const,
      actor_id: "seed", event_type: "unit.seed", object_type: null, object_id: null,
      payload: { i }, previous_hash: prev, trace_id: null,
    };
    const hash = computeHash(base);
    out.push({ ...base, hash });
    prev = hash;
  }
  return out;
}

describe("verifyChainRecords (fixture dump)", () => {
  it("accepts a well-formed chain", () => {
    expect(verifyChainRecords(buildChain(4))).toEqual({ ok: true, length: 4 });
  });

  it("detects a tampered row (payload changed, hash not recomputed)", () => {
    const chain = buildChain(4);
    chain[2] = { ...chain[2], payload: { i: 999 } }; // tamper, keep old hash
    const r = verifyChainRecords(chain);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
    expect(r.reason).toBe("hash_mismatch");
  });

  it("detects a broken link (previous_hash rewritten)", () => {
    const chain = buildChain(3);
    chain[1] = { ...chain[1], previous_hash: "deadbeef" };
    const r = verifyChainRecords(chain);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
    expect(r.reason).toBe("previous_hash_mismatch");
  });
});

// ---------------------------------------------------------------------------
// Database tests — append path and the append-only triggers.
// ---------------------------------------------------------------------------

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());

describe("events table (Postgres)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  function input(n: number, payload: Record<string, unknown>): AppendInput {
    return {
      id: `EV-db-${runId}-${n}`, timestamp: `2027-02-01T00:0${n}:00Z`,
      actor_type: "system", actor_id: "test-runner", event_type: "unit.db",
      payload,
    };
  }

  it("appends events that hash-chain to the prior head", async () => {
    const a = await appendEvent(client, input(1, { step: "a" }));
    const b = await appendEvent(client, input(2, { step: "b" }));
    expect(b.previous_hash).toBe(a.hash);
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it("verifyChainInDb reports the whole chain is intact", async () => {
    const r = await verifyChainInDb(client);
    expect(r.ok).toBe(true);
  });

  it("rejects UPDATE via the append-only trigger", async () => {
    await appendEvent(client, input(3, { step: "c" }));
    await expect(
      client.query("UPDATE events SET payload = '{}'::jsonb WHERE id = $1", [`EV-db-${runId}-3`]),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE via the append-only trigger", async () => {
    await expect(
      client.query("DELETE FROM events WHERE id = $1", [`EV-db-${runId}-3`]),
    ).rejects.toThrow(/append-only/i);
  });
});
