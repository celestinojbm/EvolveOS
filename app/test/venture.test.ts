import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { verifyChainInDb } from "../src/lib/eventlog.js";
import {
  VENTURE_STATES,
  TRANSITIONS,
  ANALYSIS_ITEMS,
  STAGE_MAP,
  createVenture,
  advanceStage,
  completeAnalysisItem,
  killVenture,
  getVenture,
  type VentureState,
} from "../src/lib/venture.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());
const here = dirname(fileURLToPath(import.meta.url));

// Year namespace per run so V-yyyy-seq ids never collide across suite runs
// against the same database (venture_counters is per-year).
let yearCounter = 2100 + (Number(runId.replace(/\D/g, "").slice(-3)) % 800);
function freshYear(): number {
  yearCounter += 1;
  return yearCounter;
}

async function countVentureEvents(client: pg.Client, type: string, vid: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE event_type = $1 AND object_type = 'venture' AND object_id = $2",
    [type, vid],
  );
  return rows[0].n;
}

async function eventSeq(client: pg.Client, eventId: string): Promise<number | null> {
  const { rows } = await client.query<{ seq: string }>("SELECT seq FROM events WHERE id = $1", [
    eventId,
  ]);
  return rows.length ? Number(rows[0].seq) : null;
}

/** Install an always-raising trigger on `table` for `op`, run fn, drop it. */
async function withBlocked<T>(
  client: pg.Client,
  table: string,
  op: "INSERT" | "UPDATE",
  fn: () => Promise<T>,
): Promise<T> {
  await client.query(
    "CREATE OR REPLACE FUNCTION __vtest_block() RETURNS trigger AS " +
      "$$ BEGIN RAISE EXCEPTION 'vtest-injected failure'; END; $$ LANGUAGE plpgsql;",
  );
  await client.query(
    `CREATE TRIGGER __vtest_block_trg BEFORE ${op} ON ${table} FOR EACH ROW EXECUTE FUNCTION __vtest_block()`,
  );
  try {
    return await fn();
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS __vtest_block_trg ON ${table}`);
  }
}

/** Drive a fresh venture to the given state via legal gate passes. */
async function ventureAt(
  client: pg.Client,
  target: VentureState,
  opts?: { completeChecklist?: boolean },
): Promise<string> {
  const v = await createVenture(client, {
    name: `vt-${runId}-${Math.random().toString(36).slice(2, 8)}`,
    actor: "operator-1",
    year: freshYear(),
  });
  let state: VentureState = v.state;
  while (state !== target) {
    const t = TRANSITIONS.find((x) => x.from === state);
    if (!t) throw new Error(`cannot reach ${target} from ${state}`);
    if (t.from === "analysis" && opts?.completeChecklist !== false) {
      for (const item of ANALYSIS_ITEMS) {
        await completeAnalysisItem(client, { ventureId: v.id, item, actor: "operator-1" });
      }
    }
    await advanceStage(client, {
      ventureId: v.id,
      expectedFrom: state,
      gateId: t.gate,
      actor: "operator-1",
      drRef: `DR-${runId}-auto`,
    });
    state = t.to;
  }
  return v.id;
}

// ---------------------------------------------------------------------------
// Pure: the canonical model agrees with the machine-readable gate data.
// ---------------------------------------------------------------------------

describe("canonical model", () => {
  it("every transition gate exists in schemas/data/gates.json", () => {
    const gates = JSON.parse(
      readFileSync(join(here, "..", "..", "schemas", "data", "gates.json"), "utf8"),
    ) as { gates: { id: string }[] };
    const ids = new Set(gates.gates.map((g) => g.id));
    for (const t of TRANSITIONS) expect(ids.has(t.gate), `${t.gate} missing`).toBe(true);
  });

  it("stage map covers stages 1-12 and only uses declared states", () => {
    for (let s = 1; s <= 12; s++) {
      expect(STAGE_MAP[s]).toBeDefined();
      expect(VENTURE_STATES).toContain(STAGE_MAP[s].state);
    }
    // stages 5-9 collapse into the single 'analysis' macro-state
    for (let s = 5; s <= 9; s++) expect(STAGE_MAP[s].state).toBe("analysis");
  });

  it("transitions are linear: one exit per state, no cycles, ending before G-07", () => {
    const froms = TRANSITIONS.map((t) => t.from);
    expect(new Set(froms).size).toBe(froms.length); // one exit per state
    expect(TRANSITIONS.find((t) => t.from === "pmf")).toBeUndefined(); // G-07+ out of scope
    expect(TRANSITIONS.find((t) => t.from === "archived")).toBeUndefined(); // terminal
  });
});

// ---------------------------------------------------------------------------
// Database behavior.
// ---------------------------------------------------------------------------

describe("venture state machine (Postgres)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("creates a venture with a V-yyyy-seq id, initial state, and event", async () => {
    const year = freshYear();
    const a = await createVenture(client, { name: "n1", actor: "op", year });
    const b = await createVenture(client, { name: "n2", actor: "op", year });
    expect(a.id).toBe(`V-${year}-1`);
    expect(b.id).toBe(`V-${year}-2`);
    expect(a.state).toBe("opportunity_discovery");
    expect(await countVentureEvents(client, "venture.created", a.id)).toBe(1);
  });

  it("DB rejects a malformed venture id (format CHECK backstop)", async () => {
    await expect(
      client.query("INSERT INTO ventures (id, name) VALUES ('VENTURE-1', 'bad')"),
    ).rejects.toThrow(/check/i);
  });

  it("advances through a legal transition and records the event with gate + dr refs", async () => {
    const vid = await ventureAt(client, "opportunity_discovery");
    const r = await advanceStage(client, {
      ventureId: vid,
      expectedFrom: "opportunity_discovery",
      gateId: "G-01",
      actor: "op",
      drRef: "DR-2027-100",
    });
    expect(r.to).toBe("trend_analysis");
    expect((await getVenture(client, vid))!.state).toBe("trend_analysis");
    expect(await countVentureEvents(client, "venture.stage_advanced", vid)).toBe(1);
  });

  it("rejects the wrong gate for a transition", async () => {
    const vid = await ventureAt(client, "opportunity_discovery");
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "opportunity_discovery",
        gateId: "G-03",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/wrong gate/i);
    expect(await countVentureEvents(client, "venture.stage_advanced", vid)).toBe(0);
  });

  it("rejects a skipped state (stale expectedFrom)", async () => {
    const vid = await ventureAt(client, "opportunity_discovery");
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "validation", // venture is actually at stage 1
        gateId: "G-03",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/stale state/i);
  });

  it("rejects a backward/repeated transition (state already moved on)", async () => {
    const vid = await ventureAt(client, "validation");
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "research", // already consumed
        gateId: "G-02",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/stale state/i);
  });

  it("rejects an advance on a non-existent venture, with no persisted event", async () => {
    await expect(
      advanceStage(client, {
        ventureId: "V-2099-999",
        expectedFrom: "opportunity_discovery",
        gateId: "G-01",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/not found/i);
    expect(await countVentureEvents(client, "venture.stage_advanced", "V-2099-999")).toBe(0);
  });

  it("requires a non-empty drRef", async () => {
    const vid = await ventureAt(client, "opportunity_discovery");
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "opportunity_discovery",
        gateId: "G-01",
        actor: "op",
        drRef: "  ",
      }),
    ).rejects.toThrow(/drRef/i);
  });

  it("analysis: incomplete checklist blocks G-04; completing items does not change state", async () => {
    const vid = await ventureAt(client, "analysis", { completeChecklist: false });
    await completeAnalysisItem(client, { ventureId: vid, item: "customer_discovery", actor: "op" });
    expect((await getVenture(client, vid))!.state).toBe("analysis"); // no auto-advance
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "analysis",
        gateId: "G-04",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/analysis block incomplete/i);
  });

  it("analysis: duplicate item completion is rejected; wrong-state completion is rejected", async () => {
    const vid = await ventureAt(client, "analysis", { completeChecklist: false });
    await completeAnalysisItem(client, { ventureId: vid, item: "risk_analysis", actor: "op" });
    await expect(
      completeAnalysisItem(client, { ventureId: vid, item: "risk_analysis", actor: "op" }),
    ).rejects.toThrow(/already completed/i);
    expect(await countVentureEvents(client, "venture.analysis_item_completed", vid)).toBe(1);

    const early = await ventureAt(client, "opportunity_discovery");
    await expect(
      completeAnalysisItem(client, { ventureId: early, item: "risk_analysis", actor: "op" }),
    ).rejects.toThrow(/only be completed in state 'analysis'/i);
  });

  it("analysis: full checklist allows exit via G-04 exactly", async () => {
    const vid = await ventureAt(client, "analysis", { completeChecklist: false });
    for (const item of ANALYSIS_ITEMS) {
      await completeAnalysisItem(client, { ventureId: vid, item, actor: "op" });
    }
    expect(await countVentureEvents(client, "venture.analysis_item_completed", vid)).toBe(5);
    const r = await advanceStage(client, {
      ventureId: vid,
      expectedFrom: "analysis",
      gateId: "G-04",
      actor: "op",
      drRef: "DR-x",
    });
    expect(r.to).toBe("prototype");
  });

  it("kill works from an early stage, from the analysis block, and from a late stage", async () => {
    for (const target of ["opportunity_discovery", "analysis", "mvp"] as VentureState[]) {
      const vid = await ventureAt(client, target);
      const r = await killVenture(client, {
        ventureId: vid,
        actor: "op",
        reason: "kill criteria fired",
        postMortemRef: `KI-pm-${vid}`,
      });
      expect(r.from).toBe(target);
      const row = (await getVenture(client, vid))!;
      expect(row.state).toBe("archived");
      expect(row.post_mortem_ref).toBe(`KI-pm-${vid}`);
      expect(await countVentureEvents(client, "venture.killed", vid)).toBe(1);
    }
  });

  it("kill without a post-mortem reference is rejected with no change and no event", async () => {
    const vid = await ventureAt(client, "validation");
    await expect(
      killVenture(client, { ventureId: vid, actor: "op", reason: "r", postMortemRef: "" }),
    ).rejects.toThrow(/post_mortem_ref/i);
    expect((await getVenture(client, vid))!.state).toBe("validation");
    expect(await countVentureEvents(client, "venture.killed", vid)).toBe(0);
  });

  it("no transition of any kind is possible after archived", async () => {
    const vid = await ventureAt(client, "trend_analysis");
    await killVenture(client, {
      ventureId: vid,
      actor: "op",
      reason: "r",
      postMortemRef: "KI-pm",
    });
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "trend_analysis",
        gateId: "G-01",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/archived/i);
    await expect(
      killVenture(client, { ventureId: vid, actor: "op", reason: "r2", postMortemRef: "KI-2" }),
    ).rejects.toThrow(/already archived/i);
    expect(await countVentureEvents(client, "venture.killed", vid)).toBe(1);
  });

  it("DB backstop: archived without post-mortem is impossible; live venture cannot carry one", async () => {
    const vid = await ventureAt(client, "research");
    await expect(
      client.query("UPDATE ventures SET state = 'archived' WHERE id = $1", [vid]),
    ).rejects.toThrow(/ventures_archived_requires_postmortem|check/i);
    await expect(
      client.query("UPDATE ventures SET post_mortem_ref = 'x' WHERE id = $1", [vid]),
    ).rejects.toThrow(/ventures_live_has_no_postmortem|check/i);
  });

  it("rollback: if the event append fails, the state does not change", async () => {
    const vid = await ventureAt(client, "opportunity_discovery");
    await expect(
      withBlocked(client, "events", "INSERT", () =>
        advanceStage(client, {
          ventureId: vid,
          expectedFrom: "opportunity_discovery",
          gateId: "G-01",
          actor: "op",
          drRef: "DR-x",
        }),
      ),
    ).rejects.toThrow(/vtest-injected/i);
    expect((await getVenture(client, vid))!.state).toBe("opportunity_discovery");
  });

  it("rollback: if the venture UPDATE fails, no event persists", async () => {
    const vid = await ventureAt(client, "opportunity_discovery");
    await expect(
      withBlocked(client, "ventures", "UPDATE", () =>
        advanceStage(client, {
          ventureId: vid,
          expectedFrom: "opportunity_discovery",
          gateId: "G-01",
          actor: "op",
          drRef: "DR-x",
        }),
      ),
    ).rejects.toThrow(/vtest-injected/i);
    expect(await countVentureEvents(client, "venture.stage_advanced", vid)).toBe(0);
    expect((await getVenture(client, vid))!.state).toBe("opportunity_discovery");
  });
});

// ---------------------------------------------------------------------------
// Concurrency — two live connections.
// ---------------------------------------------------------------------------

describe("venture concurrency (Postgres)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  async function freshClient(): Promise<pg.Client> {
    const c = new pg.Client({ connectionString: DATABASE_URL });
    await c.connect();
    return c;
  }

  it("two concurrent advances from the same state: exactly one wins, one event", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      for (let i = 0; i < 5; i++) {
        const vid = await ventureAt(client, "opportunity_discovery");
        const args = {
          ventureId: vid,
          expectedFrom: "opportunity_discovery" as VentureState,
          gateId: "G-01",
          actor: "op",
          drRef: "DR-cc",
        };
        const results = await Promise.allSettled([advanceStage(a, args), advanceStage(b, args)]);
        const ok = results.filter((r) => r.status === "fulfilled");
        const bad = results.filter((r) => r.status === "rejected");
        expect(ok.length).toBe(1);
        expect(bad.length).toBe(1);
        expect(String((bad[0] as PromiseRejectedResult).reason)).toMatch(/stale state/i);
        expect(await countVentureEvents(client, "venture.stage_advanced", vid)).toBe(1);
        expect((await getVenture(client, vid))!.state).toBe("trend_analysis");
      }
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("concurrent advance + kill: coherent order; kill always ends archived; seq reflects order", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      for (let i = 0; i < 8; i++) {
        const vid = await ventureAt(client, "prototype");
        // ventureAt performed setup advances; measure the race as a delta.
        const advancesBefore = await countVentureEvents(client, "venture.stage_advanced", vid);
        const [adv, kill] = await Promise.allSettled([
          advanceStage(a, {
            ventureId: vid,
            expectedFrom: "prototype",
            gateId: "G-05",
            actor: "op",
            drRef: "DR-cc",
          }),
          killVenture(b, { ventureId: vid, actor: "op", reason: "r", postMortemRef: "KI-cc" }),
        ]);
        const row = (await getVenture(client, vid))!;
        const kills = await countVentureEvents(client, "venture.killed", vid);
        const advances =
          (await countVentureEvents(client, "venture.stage_advanced", vid)) - advancesBefore;

        if (kill.status === "fulfilled") {
          // Kill committed -> venture is archived, exactly one kill event.
          expect(row.state).toBe("archived");
          expect(kills).toBe(1);
          if (adv.status === "fulfilled") {
            // Advance won the race first; its event must precede the kill's.
            const advSeq = await eventSeq(client, adv.value.eventId);
            const killSeq = await eventSeq(client, kill.value.eventId);
            expect(advances).toBe(1);
            expect(advSeq!).toBeLessThan(killSeq!);
          } else {
            // Kill won first -> the advance was rejected (archived/stale) and
            // left no event.
            expect(advances).toBe(0);
            expect(String(adv.reason)).toMatch(/archived|stale/i);
          }
        } else {
          // Kill can only fail here if the venture was already archived — not
          // possible in this setup — so it must have succeeded.
          throw new Error(`unexpected kill failure: ${String(kill.reason)}`);
        }
      }
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("two concurrent kills: only one archives, exactly one kill event", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      for (let i = 0; i < 5; i++) {
        const vid = await ventureAt(client, "validation");
        const results = await Promise.allSettled([
          killVenture(a, { ventureId: vid, actor: "op", reason: "r1", postMortemRef: "KI-1" }),
          killVenture(b, { ventureId: vid, actor: "op", reason: "r2", postMortemRef: "KI-2" }),
        ]);
        const ok = results.filter((r) => r.status === "fulfilled");
        const bad = results.filter((r) => r.status === "rejected");
        expect(ok.length).toBe(1);
        expect(bad.length).toBe(1);
        expect(String((bad[0] as PromiseRejectedResult).reason)).toMatch(/already archived/i);
        expect(await countVentureEvents(client, "venture.killed", vid)).toBe(1);
        expect((await getVenture(client, vid))!.state).toBe("archived");
      }
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("the event-log hash chain is intact after all venture activity", async () => {
    const r = await verifyChainInDb(client);
    expect(r.ok).toBe(true);
  });
});
