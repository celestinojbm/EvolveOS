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
  ENTRY_GATE,
  ENTRY_STATE,
  createVenture,
  advanceStage,
  handoffStage,
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

const OPP_REF = `KI-opp-${runId}`;
const G01_DR = `DR-g01-${runId}`;

function mint(client: pg.Client, name?: string) {
  return createVenture(client, {
    name: name ?? `vt-${runId}-${Math.random().toString(36).slice(2, 8)}`,
    actor: "operator-1",
    opportunityRef: OPP_REF,
    drRef: G01_DR,
    year: freshYear(),
  });
}

async function countVentureEvents(client: pg.Client, type: string, vid: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE event_type = $1 AND object_type = 'venture' AND object_id = $2",
    [type, vid],
  );
  return rows[0].n;
}

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

/** Drive a freshly-minted venture to the given state via legal transitions. */
async function ventureAt(
  client: pg.Client,
  target: VentureState,
  opts?: { completeChecklist?: boolean },
): Promise<string> {
  const v = await mint(client);
  let state: VentureState = v.state;
  while (state !== target) {
    const t = TRANSITIONS.find((x) => x.from === state);
    if (!t) throw new Error(`cannot reach ${target} from ${state}`);
    if (t.kind === "handoff") {
      await handoffStage(client, { ventureId: v.id, expectedFrom: state, actor: "operator-1" });
    } else {
      if (t.from === "analysis" && opts?.completeChecklist !== false) {
        for (const item of ANALYSIS_ITEMS) {
          await completeAnalysisItem(client, {
            ventureId: v.id,
            item,
            actor: "operator-1",
            evidenceRef: `artifact-${item}-${v.id}`,
          });
        }
      }
      await advanceStage(client, {
        ventureId: v.id,
        expectedFrom: state,
        gateId: t.gate,
        actor: "operator-1",
        drRef: `DR-${runId}-auto`,
      });
    }
    state = t.to;
  }
  return v.id;
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
    // Appendix C: the G-01 grant admits to Trend Analysis/Research jointly.
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
    expect(STAGE_MAP[1].state).toBeNull(); // Part V §1.2: pre-G-01 briefs are KIs, not ventures
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

  it("mints V-yyyy-seq at G-01 pass, born in trend_analysis, with full birth references", async () => {
    const year = freshYear();
    const a = await createVenture(client, {
      name: "n1",
      actor: "op",
      opportunityRef: OPP_REF,
      drRef: G01_DR,
      year,
    });
    const b = await createVenture(client, {
      name: "n2",
      actor: "op",
      opportunityRef: OPP_REF,
      drRef: G01_DR,
      year,
    });
    expect(a.id).toBe(`V-${year}-1`);
    expect(b.id).toBe(`V-${year}-2`);
    expect(a.state).toBe("trend_analysis"); // stage 2, never stage 1
    const row = (await getVenture(client, a.id))!;
    expect(row.state).toBe("trend_analysis");
    expect(row.opportunity_ref).toBe(OPP_REF);
    expect(row.entry_dr_ref).toBe(G01_DR);
    const p = (await lastEventPayload(client, "venture.created", a.id))!;
    expect(p.entry_gate_id).toBe("G-01");
    expect(p.opportunity_ref).toBe(OPP_REF);
    expect(p.dr_ref).toBe(G01_DR);
    expect(p.state).toBe("trend_analysis");
  });

  it("creation requires a non-empty opportunityRef and drRef (no pre-G-01 ventures)", async () => {
    await expect(
      createVenture(client, {
        name: "x",
        actor: "op",
        opportunityRef: "  ",
        drRef: G01_DR,
        year: freshYear(),
      }),
    ).rejects.toThrow(/opportunityRef/i);
    await expect(
      createVenture(client, {
        name: "x",
        actor: "op",
        opportunityRef: OPP_REF,
        drRef: "",
        year: freshYear(),
      }),
    ).rejects.toThrow(/drRef/i);
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
    const v = await mint(client);
    const r = await handoffStage(client, {
      ventureId: v.id,
      expectedFrom: "trend_analysis",
      actor: "op",
    });
    expect(r.from).toBe("trend_analysis");
    expect(r.to).toBe("research");
    expect((await getVenture(client, v.id))!.state).toBe("research");
    // Distinct handoff event; NOT a stage_advanced / gate pass.
    expect(await countVentureEvents(client, "venture.stage_handoff", v.id)).toBe(1);
    expect(await countVentureEvents(client, "venture.stage_advanced", v.id)).toBe(0);
    const p = (await lastEventPayload(client, "venture.stage_handoff", v.id))!;
    expect(p.transition_kind).toBe("handoff");
    expect(p.authorization_gate_id).toBe("G-01");
    expect(p.authorization_ref).toBe(G01_DR); // the ORIGINAL birth authorization
  });

  it("the handoff cannot be driven through advanceStage with any gate", async () => {
    const v = await mint(client);
    for (const gateId of ["G-01", "G-02"]) {
      await expect(
        advanceStage(client, {
          ventureId: v.id,
          expectedFrom: "trend_analysis",
          gateId,
          actor: "op",
          drRef: "DR-x",
        }),
      ).rejects.toThrow(/handoff/i);
    }
    expect((await getVenture(client, v.id))!.state).toBe("trend_analysis");
    expect(await countVentureEvents(client, "venture.stage_advanced", v.id)).toBe(0);
  });

  it("handoffStage rejects gate-pass transitions", async () => {
    const vid = await ventureAt(client, "research");
    await expect(
      handoffStage(client, { ventureId: vid, expectedFrom: "research", actor: "op" }),
    ).rejects.toThrow(/gate pass.*advanceStage/i);
  });

  it("advances research -> validation via G-02 and records the event", async () => {
    const vid = await ventureAt(client, "research");
    const r = await advanceStage(client, {
      ventureId: vid,
      expectedFrom: "research",
      gateId: "G-02",
      actor: "op",
      drRef: "DR-2027-100",
    });
    expect(r.to).toBe("validation");
    const p = (await lastEventPayload(client, "venture.stage_advanced", vid))!;
    expect(p.transition_kind).toBe("gate_pass");
    expect(p.gate_id).toBe("G-02");
  });

  it("rejects the wrong gate for a transition", async () => {
    const vid = await ventureAt(client, "research");
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "research",
        gateId: "G-03",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/wrong gate/i);
    expect(await countVentureEvents(client, "venture.stage_advanced", vid)).toBe(0);
  });

  it("rejects a skipped state, backward/repeated transitions, unknown ventures, empty drRef", async () => {
    const vid = await ventureAt(client, "validation");
    // skip / stale
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "research", // already consumed
        gateId: "G-02",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/stale state/i);
    // unknown venture
    await expect(
      advanceStage(client, {
        ventureId: "V-2099-999",
        expectedFrom: "research",
        gateId: "G-02",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/not found/i);
    // empty drRef
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "validation",
        gateId: "G-03",
        actor: "op",
        drRef: "  ",
      }),
    ).rejects.toThrow(/drRef/i);
  });

  it("analysis items require a non-empty artifact reference", async () => {
    const vid = await ventureAt(client, "analysis", { completeChecklist: false });
    await expect(
      completeAnalysisItem(client, {
        ventureId: vid,
        item: "customer_discovery",
        actor: "op",
        evidenceRef: "   ",
      }),
    ).rejects.toThrow(/evidenceRef/i);
    expect(await countVentureEvents(client, "venture.analysis_item_completed", vid)).toBe(0);
  });

  it("G-04 is rejected while any artifact is missing; five filed artifacts allow it", async () => {
    const vid = await ventureAt(client, "analysis", { completeChecklist: false });
    for (const item of ANALYSIS_ITEMS.slice(0, 4)) {
      await completeAnalysisItem(client, {
        ventureId: vid,
        item,
        actor: "op",
        evidenceRef: `artifact-${item}`,
      });
    }
    await expect(
      advanceStage(client, {
        ventureId: vid,
        expectedFrom: "analysis",
        gateId: "G-04",
        actor: "op",
        drRef: "DR-x",
      }),
    ).rejects.toThrow(/analysis block incomplete.*legal_analysis/i);
    await completeAnalysisItem(client, {
      ventureId: vid,
      item: "legal_analysis",
      actor: "op",
      evidenceRef: "artifact-legal",
    });
    const p = (await lastEventPayload(client, "venture.analysis_item_completed", vid))!;
    expect(p.evidence_ref).toBe("artifact-legal");
    const r = await advanceStage(client, {
      ventureId: vid,
      expectedFrom: "analysis",
      gateId: "G-04",
      actor: "op",
      drRef: "DR-x",
    });
    expect(r.to).toBe("prototype");
  });

  it("completing an item never changes state; duplicates and wrong-state filings are rejected", async () => {
    const vid = await ventureAt(client, "analysis", { completeChecklist: false });
    await completeAnalysisItem(client, {
      ventureId: vid,
      item: "risk_analysis",
      actor: "op",
      evidenceRef: "artifact-risk",
    });
    expect((await getVenture(client, vid))!.state).toBe("analysis"); // no auto-advance
    await expect(
      completeAnalysisItem(client, {
        ventureId: vid,
        item: "risk_analysis",
        actor: "op",
        evidenceRef: "artifact-risk-2",
      }),
    ).rejects.toThrow(/already completed/i);
    const early = await mint(client);
    await expect(
      completeAnalysisItem(client, {
        ventureId: early.id,
        item: "risk_analysis",
        actor: "op",
        evidenceRef: "artifact-x",
      }),
    ).rejects.toThrow(/only be completed in state 'analysis'/i);
  });

  it("DB backstop: a checklist entry without a non-empty evidence_ref is impossible", async () => {
    const vid = await ventureAt(client, "analysis", { completeChecklist: false });
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
    const v = await mint(client);
    await killVenture(client, {
      ventureId: v.id,
      actor: "op",
      reason: "r",
      postMortemRef: "KI-pm",
    });
    await expect(
      handoffStage(client, { ventureId: v.id, expectedFrom: "trend_analysis", actor: "op" }),
    ).rejects.toThrow(/archived/i);
    await expect(
      killVenture(client, { ventureId: v.id, actor: "op", reason: "r2", postMortemRef: "KI-2" }),
    ).rejects.toThrow(/already archived/i);
    expect(await countVentureEvents(client, "venture.killed", v.id)).toBe(1);
  });

  it("DB backstop: archived without post-mortem impossible; live venture cannot carry one", async () => {
    const vid = await ventureAt(client, "research");
    await expect(
      client.query("UPDATE ventures SET state = 'archived' WHERE id = $1", [vid]),
    ).rejects.toThrow(/ventures_archived_requires_postmortem|check/i);
    await expect(
      client.query("UPDATE ventures SET post_mortem_ref = 'x' WHERE id = $1", [vid]),
    ).rejects.toThrow(/ventures_live_has_no_postmortem|check/i);
  });

  it("rollback: if the event append fails, the state does not change (gate pass + handoff)", async () => {
    const vid = await ventureAt(client, "research");
    await expect(
      withBlocked(client, "events", "INSERT", () =>
        advanceStage(client, {
          ventureId: vid,
          expectedFrom: "research",
          gateId: "G-02",
          actor: "op",
          drRef: "DR-x",
        }),
      ),
    ).rejects.toThrow(/vtest-injected/i);
    expect((await getVenture(client, vid))!.state).toBe("research");

    const v2 = await mint(client);
    await expect(
      withBlocked(client, "events", "INSERT", () =>
        handoffStage(client, { ventureId: v2.id, expectedFrom: "trend_analysis", actor: "op" }),
      ),
    ).rejects.toThrow(/vtest-injected/i);
    expect((await getVenture(client, v2.id))!.state).toBe("trend_analysis");
  });

  it("rollback: if the venture UPDATE fails, no event persists", async () => {
    const vid = await ventureAt(client, "research");
    await expect(
      withBlocked(client, "ventures", "UPDATE", () =>
        advanceStage(client, {
          ventureId: vid,
          expectedFrom: "research",
          gateId: "G-02",
          actor: "op",
          drRef: "DR-x",
        }),
      ),
    ).rejects.toThrow(/vtest-injected/i);
    expect(await countVentureEvents(client, "venture.stage_advanced", vid)).toBe(0);
    expect((await getVenture(client, vid))!.state).toBe("research");
  });

  it("rollback: if the venture INSERT fails at creation, no venture and no event persist", async () => {
    const year = freshYear();
    await expect(
      withBlocked(client, "ventures", "INSERT", () =>
        createVenture(client, {
          name: "ghost",
          actor: "op",
          opportunityRef: OPP_REF,
          drRef: G01_DR,
          year,
        }),
      ),
    ).rejects.toThrow(/vtest-injected/i);
    const { rows } = await client.query("SELECT 1 FROM ventures WHERE id = $1", [`V-${year}-1`]);
    expect(rows.length).toBe(0);
    expect(await countVentureEvents(client, "venture.created", `V-${year}-1`)).toBe(0);
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

  it("two concurrent gate passes from the same state: exactly one wins, one event", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      for (let i = 0; i < 5; i++) {
        const vid = await ventureAt(client, "research");
        const before = await countVentureEvents(client, "venture.stage_advanced", vid);
        const args = {
          ventureId: vid,
          expectedFrom: "research" as VentureState,
          gateId: "G-02",
          actor: "op",
          drRef: "DR-cc",
        };
        const results = await Promise.allSettled([advanceStage(a, args), advanceStage(b, args)]);
        const ok = results.filter((r) => r.status === "fulfilled");
        const bad = results.filter((r) => r.status === "rejected");
        expect(ok.length).toBe(1);
        expect(bad.length).toBe(1);
        expect(String((bad[0] as PromiseRejectedResult).reason)).toMatch(/stale state/i);
        expect((await countVentureEvents(client, "venture.stage_advanced", vid)) - before).toBe(1);
        expect((await getVenture(client, vid))!.state).toBe("validation");
      }
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("two concurrent handoffs: exactly one wins, one handoff event", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      const v = await mint(client);
      const args = { ventureId: v.id, expectedFrom: "trend_analysis" as VentureState, actor: "op" };
      const results = await Promise.allSettled([handoffStage(a, args), handoffStage(b, args)]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      expect(await countVentureEvents(client, "venture.stage_handoff", v.id)).toBe(1);
      expect((await getVenture(client, v.id))!.state).toBe("research");
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
          expect(row.state).toBe("archived");
          expect(kills).toBe(1);
          if (adv.status === "fulfilled") {
            const advSeq = await eventSeq(client, adv.value.eventId);
            const killSeq = await eventSeq(client, kill.value.eventId);
            expect(advances).toBe(1);
            expect(advSeq!).toBeLessThan(killSeq!);
          } else {
            expect(advances).toBe(0);
            expect(String(adv.reason)).toMatch(/archived|stale/i);
          }
        } else {
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
        expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
        expect(
          String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason),
        ).toMatch(/already archived/i);
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
