import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { verifyChainInDb } from "../src/lib/eventlog.js";
import {
  VENTURE_STATES,
  TRANSITIONS,
  STAGE_MAP,
  ENTRY_GATE,
  ENTRY_STATE,
  handoffStage,
  completeAnalysisItem,
  killVenture,
  getVenture,
  type VentureState,
} from "../src/lib/venture.js";
import {
  runId,
  setupActors,
  mintVenture,
  ventureTo,
  countEventsFor,
  type Actors,
} from "./helpers.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const here = dirname(fileURLToPath(import.meta.url));

async function lastEventPayload(
  client: pg.Client,
  type: string,
  vid: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM events WHERE event_type = $1 AND object_id = $2 ORDER BY seq DESC LIMIT 1",
    [type, vid],
  );
  return rows.length ? rows[0].payload : null;
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

// ---------------------------------------------------------------------------
// Pure: the canonical model agrees with the machine-readable gate data —
// semantically, not just by id existence.
// ---------------------------------------------------------------------------

describe("canonical model vs schemas/data/gates.json", () => {
  const gatesData = JSON.parse(
    readFileSync(join(here, "..", "..", "schemas", "data", "gates.json"), "utf8"),
  ) as { gates: { id: string; name: string; trigger_or_transition: string }[] };
  const byId = new Map(gatesData.gates.map((g) => [g.id, g]));

  it("venture creation is authorized by G-01 (Opportunity Intake: Discovery -> Trend Analysis)", () => {
    expect(ENTRY_GATE).toBe("G-01");
    expect(ENTRY_STATE).toBe("trend_analysis");
    const g = byId.get("G-01")!;
    expect(g.name).toBe("Opportunity Intake");
    expect(g.trigger_or_transition).toMatch(/Discovery/);
    expect(g.trigger_or_transition).toMatch(/Trend Analysis/);
  });

  it("trend_analysis -> research is a handoff riding G-01, not a gate pass", () => {
    const t = TRANSITIONS.find((x) => x.from === "trend_analysis")!;
    expect(t.to).toBe("research");
    expect(t.kind).toBe("handoff");
    expect(t.gate).toBe("G-01");
    expect(byId.get("G-01")!.trigger_or_transition).toMatch(/Trend Analysis\/Research/);
  });

  it.each([
    ["research", "validation", "G-02", /Research\s*→\s*Validation/],
    ["validation", "analysis", "G-03", /Validation\s*→/],
    ["analysis", "prototype", "G-04", /analyses\s*→\s*Prototype/],
    ["prototype", "mvp", "G-05", /Prototype\s*→\s*MVP/],
    ["mvp", "pmf", "G-06", /MVP\s*→\s*PMF/],
  ] as const)("%s -> %s is a gate pass via %s with matching Appendix C transition", (
    from,
    to,
    gate,
    triggerRe,
  ) => {
    const t = TRANSITIONS.find((x) => x.from === from)!;
    expect(t.to).toBe(to);
    expect(t.kind).toBe("gate_pass");
    expect(t.gate).toBe(gate);
    expect(byId.get(gate)!.trigger_or_transition).toMatch(triggerRe);
  });

  it("stage map: stage 1 is pre-venture (no persisted state); 5-9 collapse to 'analysis'", () => {
    expect(STAGE_MAP[1].state).toBeNull();
    expect(VENTURE_STATES).not.toContain("opportunity_discovery" as never);
    for (let s = 2; s <= 12; s++) {
      expect(STAGE_MAP[s].state).not.toBeNull();
      expect(VENTURE_STATES).toContain(STAGE_MAP[s].state!);
    }
    for (let s = 5; s <= 9; s++) expect(STAGE_MAP[s].state).toBe("analysis");
  });

  it("transitions are linear: one exit per state, terminal archived, ending before G-07", () => {
    const froms = TRANSITIONS.map((t) => t.from);
    expect(new Set(froms).size).toBe(froms.length);
    expect(TRANSITIONS.find((t) => t.from === "pmf")).toBeUndefined();
    expect(TRANSITIONS.find((t) => t.from === "archived")).toBeUndefined();
    expect(TRANSITIONS.filter((t) => t.kind === "handoff").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Database behavior (non-gated mutations; gated paths are in gates.test.ts).
// ---------------------------------------------------------------------------

describe("venture state machine (Postgres)", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "vm");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("DB backstops: malformed id, missing birth refs, and stage-1 state are impossible", async () => {
    await expect(
      client.query(
        "INSERT INTO ventures (id, name, state, opportunity_ref, entry_dr_ref) VALUES ('VENTURE-1', 'bad', 'trend_analysis', 'k', 'd')",
      ),
    ).rejects.toThrow(/check/i);
    await expect(
      client.query(
        "INSERT INTO ventures (id, name, state, opportunity_ref, entry_dr_ref) VALUES ('V-2098-1', 'bad', 'trend_analysis', ' ', 'd')",
      ),
    ).rejects.toThrow(/check/i);
    await expect(
      client.query(
        "INSERT INTO ventures (id, name, state, opportunity_ref, entry_dr_ref) VALUES ('V-2098-2', 'bad', 'opportunity_discovery', 'k', 'd')",
      ),
    ).rejects.toThrow(/check/i);
  });

  it("the 2->3 handoff reuses the original G-01 authorization and emits venture.stage_handoff", async () => {
    const v = await mintVenture(client, actors);
    const vid = v.ventureId!;
    const r = await handoffStage(client, {
      ventureId: vid,
      expectedFrom: "trend_analysis",
      actor: "op",
    });
    expect(r.from).toBe("trend_analysis");
    expect(r.to).toBe("research");
    expect((await getVenture(client, vid))!.state).toBe("research");
    expect(await countEventsFor(client, "venture.stage_handoff", vid)).toBe(1);
    expect(await countEventsFor(client, "venture.stage_advanced", vid)).toBe(0);
    const p = (await lastEventPayload(client, "venture.stage_handoff", vid))!;
    expect(p.transition_kind).toBe("handoff");
    expect(p.authorization_gate_id).toBe("G-01");
    expect(p.authorization_ref).toBe(v.drId); // the ORIGINAL birth authorization
  });

  it("handoffStage rejects gate-pass transitions", async () => {
    const vid = await ventureTo(client, actors, "research");
    await expect(
      handoffStage(client, { ventureId: vid, expectedFrom: "research", actor: "op" }),
    ).rejects.toThrow(/gate pass.*advanceStage|gate pass/i);
  });

  it("analysis items require a non-empty artifact reference", async () => {
    const vid = await ventureTo(client, actors, "analysis", { completeChecklist: false });
    await expect(
      completeAnalysisItem(client, {
        ventureId: vid,
        item: "customer_discovery",
        actor: "op",
        evidenceRef: "   ",
      }),
    ).rejects.toThrow(/evidenceRef/i);
    expect(await countEventsFor(client, "venture.analysis_item_completed", vid)).toBe(0);
  });

  it("completing an item never changes state; duplicates and wrong-state filings are rejected", async () => {
    const vid = await ventureTo(client, actors, "analysis", { completeChecklist: false });
    await completeAnalysisItem(client, {
      ventureId: vid,
      item: "risk_analysis",
      actor: "op",
      evidenceRef: "artifact-risk",
    });
    expect((await getVenture(client, vid))!.state).toBe("analysis");
    await expect(
      completeAnalysisItem(client, {
        ventureId: vid,
        item: "risk_analysis",
        actor: "op",
        evidenceRef: "artifact-risk-2",
      }),
    ).rejects.toThrow(/already completed/i);
    const early = await mintVenture(client, actors);
    await expect(
      completeAnalysisItem(client, {
        ventureId: early.ventureId!,
        item: "risk_analysis",
        actor: "op",
        evidenceRef: "artifact-x",
      }),
    ).rejects.toThrow(/only be completed in state 'analysis'/i);
  });

  it("DB backstop: a checklist entry without a non-empty evidence_ref is impossible", async () => {
    const vid = await ventureTo(client, actors, "analysis", { completeChecklist: false });
    await expect(
      client.query(
        `UPDATE ventures SET analysis_checklist =
           '{"risk_analysis": {"completed_at": "2027-01-01T00:00:00Z", "actor": "x", "evidence_ref": ""}}'::jsonb
         WHERE id = $1`,
        [vid],
      ),
    ).rejects.toThrow(/check/i);
  });

  it("kill works from birth state, from the analysis block, and from a late stage", async () => {
    for (const target of ["trend_analysis", "analysis", "mvp"] as VentureState[]) {
      const vid = await ventureTo(client, actors, target);
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
      expect(await countEventsFor(client, "venture.killed", vid)).toBe(1);
    }
  });

  it("kill without a post-mortem reference is rejected with no change and no event", async () => {
    const vid = await ventureTo(client, actors, "validation");
    await expect(
      killVenture(client, { ventureId: vid, actor: "op", reason: "r", postMortemRef: "" }),
    ).rejects.toThrow(/post_mortem_ref/i);
    expect((await getVenture(client, vid))!.state).toBe("validation");
    expect(await countEventsFor(client, "venture.killed", vid)).toBe(0);
  });

  it("no transition of any kind is possible after archived", async () => {
    const v = await mintVenture(client, actors);
    const vid = v.ventureId!;
    await killVenture(client, {
      ventureId: vid,
      actor: "op",
      reason: "r",
      postMortemRef: "KI-pm",
    });
    await expect(
      handoffStage(client, { ventureId: vid, expectedFrom: "trend_analysis", actor: "op" }),
    ).rejects.toThrow(/archived/i);
    await expect(
      killVenture(client, { ventureId: vid, actor: "op", reason: "r2", postMortemRef: "KI-2" }),
    ).rejects.toThrow(/already archived/i);
    expect(await countEventsFor(client, "venture.killed", vid)).toBe(1);
  });

  it("DB backstop: archived without post-mortem impossible; live venture cannot carry one", async () => {
    const vid = await ventureTo(client, actors, "research");
    await expect(
      client.query("UPDATE ventures SET state = 'archived' WHERE id = $1", [vid]),
    ).rejects.toThrow(/ventures_archived_requires_postmortem|check/i);
    await expect(
      client.query("UPDATE ventures SET post_mortem_ref = 'x' WHERE id = $1", [vid]),
    ).rejects.toThrow(/ventures_live_has_no_postmortem|check/i);
  });

  it("rollback: a failed event append leaves the handoff unapplied", async () => {
    const v = await mintVenture(client, actors);
    const vid = v.ventureId!;
    await expect(
      withBlocked(client, "events", "INSERT", () =>
        handoffStage(client, { ventureId: vid, expectedFrom: "trend_analysis", actor: "op" }),
      ),
    ).rejects.toThrow(/vtest-injected/i);
    expect((await getVenture(client, vid))!.state).toBe("trend_analysis");
  });
});

// ---------------------------------------------------------------------------
// Concurrency (non-gated mutations) — two live connections.
// ---------------------------------------------------------------------------

describe("venture concurrency (Postgres)", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, `vc-${runId.slice(-4)}`);
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  async function freshClient(): Promise<pg.Client> {
    const c = new pg.Client({ connectionString: DATABASE_URL });
    await c.connect();
    return c;
  }

  it("two concurrent handoffs: exactly one wins, one handoff event", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      const v = await mintVenture(client, actors);
      const vid = v.ventureId!;
      const args = { ventureId: vid, expectedFrom: "trend_analysis" as VentureState, actor: "op" };
      const results = await Promise.allSettled([handoffStage(a, args), handoffStage(b, args)]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      expect(await countEventsFor(client, "venture.stage_handoff", vid)).toBe(1);
      expect((await getVenture(client, vid))!.state).toBe("research");
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("two concurrent kills: only one archives, exactly one kill event", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      for (let i = 0; i < 3; i++) {
        const vid = await ventureTo(client, actors, "validation");
        const results = await Promise.allSettled([
          killVenture(a, { ventureId: vid, actor: "op", reason: "r1", postMortemRef: "KI-1" }),
          killVenture(b, { ventureId: vid, actor: "op", reason: "r2", postMortemRef: "KI-2" }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
        expect(await countEventsFor(client, "venture.killed", vid)).toBe(1);
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
