import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { verifyChainInDb } from "../src/lib/eventlog.js";
import { revokeRole } from "../src/lib/auth.js";
import {
  passGate,
  passG01CreateVenture,
  passPipelineGate,
  passStandingGate,
} from "../src/lib/gates.js";
import { getVenture } from "../src/lib/venture.js";
import {
  runId,
  freshYear,
  setupActors,
  makeDR,
  approveDR,
  mintVenture,
  passGateFor,
  ventureTo,
  countEventsFor,
  type Actors,
} from "./helpers.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";

async function gatePassRows(client: pg.Client, drId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM gate_passes WHERE dr_id = $1",
    [drId],
  );
  return rows[0].n;
}

/** Install an always-raising trigger on `table` for `op`, run fn, drop it. */
async function withBlocked<T>(
  client: pg.Client,
  table: string,
  op: "INSERT" | "UPDATE",
  fn: () => Promise<T>,
): Promise<T> {
  await client.query(
    "CREATE OR REPLACE FUNCTION __gtest_block() RETURNS trigger AS " +
      "$$ BEGIN RAISE EXCEPTION 'gtest-injected failure'; END; $$ LANGUAGE plpgsql;",
  );
  await client.query(
    `CREATE TRIGGER __gtest_block_trg BEFORE ${op} ON ${table} FOR EACH ROW EXECUTE FUNCTION __gtest_block()`,
  );
  try {
    return await fn();
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS __gtest_block_trg ON ${table}`);
  }
}

describe("gate system v0 — requirement failures (specific error, zero effects)", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "gf");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  /** Expect the pass to fail with `re`, leaving no gate_passed and no projection. */
  async function expectRejected(
    fn: () => Promise<unknown>,
    re: RegExp,
    drId?: string,
  ): Promise<void> {
    await expect(fn()).rejects.toThrow(re);
    if (drId) expect(await gatePassRows(client, drId)).toBe(0);
  }

  it("1. unknown gate", async () => {
    const dr = makeDR({ gateId: "G-99", proposer: actors.proposer, approver: actors.approver });
    await expectRejected(
      () => passGate(client, { gateId: "G-99", decisionRecord: dr, approvalEventId: "EV-x", actor: "op" }),
      /unknown gate/i,
      dr.id,
    );
  });

  it("2. known but not-implemented gate", async () => {
    const dr = makeDR({ gateId: "G-08", proposer: actors.proposer, approver: actors.approver });
    await expectRejected(
      () => passGate(client, { gateId: "G-08", decisionRecord: dr, approvalEventId: "EV-x", actor: "op" }),
      /not implemented in gate system v0/i,
      dr.id,
    );
  });

  it("3. G-00 through the pass path is rejected toward the issue-#12 stop mechanism", async () => {
    const dr = makeDR({ gateId: "G-00", proposer: actors.proposer, approver: actors.approver });
    await expectRejected(
      () => passGate(client, { gateId: "G-00", decisionRecord: dr, approvalEventId: "EV-x", actor: "op" }),
      /stop invocation.*issue #12/i,
      dr.id,
    );
  });

  it("4. DR failing the JSON schema", async () => {
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    (dr as Record<string, unknown>).reversibility_class = "R9"; // not in enum
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId: "EV-x", actor: "op",
        }),
      /fails decision-record\.schema\.json/i,
      dr.id,
    );
  });

  it("5. DR citing a different gate", async () => {
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-03", proposer: actors.proposer, approver: actors.approver });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId: "EV-x", actor: "op",
        }),
      /gate mismatch/i,
      dr.id,
    );
  });

  it("6. DR not approved", async () => {
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({
      gateId: "G-02", proposer: actors.proposer, approver: actors.approver, status: "proposed",
    });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId: "EV-x", actor: "op",
        }),
      /not approved/i,
      dr.id,
    );
  });

  it("7. empty proposer", async () => {
    const dr = makeDR({ gateId: "G-02", proposer: "  ", approver: actors.approver });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: "V-2099-1", decisionRecord: dr, approvalEventId: "EV-x", actor: "op",
        }),
      /empty proposer/i,
      dr.id,
    );
  });

  it("8. missing approver", async () => {
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: null });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: "V-2099-1", decisionRecord: dr, approvalEventId: "EV-x", actor: "op",
        }),
      /no approver/i,
      dr.id,
    );
  });

  it("9. proposer == approver", async () => {
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.proposer });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: "V-2099-1", decisionRecord: dr, approvalEventId: "EV-x", actor: "op",
        }),
      /role separation/i,
      dr.id,
    );
  });

  it("10. missing kill criteria on a pipeline gate", async () => {
    const dr = makeDR({
      gateId: "G-02", proposer: actors.proposer, approver: actors.approver, killCriteria: null,
    });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: "V-2099-1", decisionRecord: dr, approvalEventId: "EV-x", actor: "op",
        }),
      /kill criterion/i,
      dr.id,
    );
  });

  it("11. kill criteria that are only blank strings", async () => {
    const dr = makeDR({
      gateId: "G-02", proposer: actors.proposer, approver: actors.approver, killCriteria: ["  ", ""],
    });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: "V-2099-1", decisionRecord: dr, approvalEventId: "EV-x", actor: "op",
        }),
      /kill criterion/i,
      dr.id,
    );
  });

  it("12. approval event does not exist", async () => {
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr,
          approvalEventId: `EV-missing-${runId}`, actor: "op",
        }),
      /approval event not found/i,
      dr.id,
    );
  });

  it("13. referenced event is not approval.recorded", async () => {
    const v = await mintVenture(client, actors); // its eventId is a gate_passed event
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: v.ventureId!, decisionRecord: dr,
          approvalEventId: v.eventId, actor: "op",
        }),
      /not an approval\.recorded event/i,
      dr.id,
    );
  });

  it("14. approval is for another DR", async () => {
    const vid = await ventureTo(client, actors, "research");
    const other = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    const otherApproval = await approveDR(client, actors, other);
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr,
          approvalEventId: otherApproval, actor: "op",
        }),
      /approves DR/i,
      dr.id,
    );
  });

  it("15. approval actors do not match the DR", async () => {
    const pair2 = await setupActors(client, "gf2");
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    const foreignApproval = await approveDR(client, pair2, dr); // same DR id, wrong actors
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr,
          approvalEventId: foreignApproval, actor: "op",
        }),
      /actors do not match/i,
      dr.id,
    );
  });

  it("16. approver lost the approver role after approving", async () => {
    const pair3 = await setupActors(client, "gf3");
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-02", proposer: pair3.proposer, approver: pair3.approver });
    const approvalEventId = await approveDR(client, pair3, dr);
    await revokeRole(client, { userId: pair3.approver, role: "approver", revokedBy: "admin" });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId, actor: "op",
        }),
      /no longer holds an active 'approver' role/i,
      dr.id,
    );
  });

  it("17. an already-executed DR cannot be reused (no gate shopping)", async () => {
    const vidA = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    const approvalEventId = await approveDR(client, actors, dr);
    await passPipelineGate(client, {
      gateId: "G-02", ventureId: vidA, decisionRecord: dr, approvalEventId, actor: "op",
    });
    const vidB = await ventureTo(client, actors, "research");
    await expect(
      passPipelineGate(client, {
        gateId: "G-02", ventureId: vidB, decisionRecord: dr, approvalEventId, actor: "op",
      }),
    ).rejects.toThrow(/no gate shopping|already been executed/i);
    expect(await gatePassRows(client, dr.id)).toBe(1); // still exactly one
    expect((await getVenture(client, vidB))!.state).toBe("research"); // untouched
  });

  it("18/19. wrong gate for the venture's actual state / stale state", async () => {
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-03", proposer: actors.proposer, approver: actors.approver });
    const approvalEventId = await approveDR(client, actors, dr);
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-03", ventureId: vid, decisionRecord: dr, approvalEventId, actor: "op",
        }),
      /wrong gate for venture state/i,
      dr.id,
    );
    expect((await getVenture(client, vid))!.state).toBe("research");
  });

  it("20. G-04 without the five filed artifacts", async () => {
    const vid = await ventureTo(client, actors, "analysis", { completeChecklist: false });
    const dr = makeDR({ gateId: "G-04", proposer: actors.proposer, approver: actors.approver });
    const approvalEventId = await approveDR(client, actors, dr);
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-04", ventureId: vid, decisionRecord: dr, approvalEventId, actor: "op",
        }),
      /analysis block incomplete/i,
      dr.id,
    );
  });

  it("spend requests are rejected toward the manual queue (mechanic 3, ADR-006)", async () => {
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr,
          approvalEventId: "EV-x", actor: "op", requestedSpend: 500,
        }),
      /requires manual queue \(A1\)/i,
      dr.id,
    );
  });
});

describe("gate system v0 — full path", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "gp");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("G-01 mints the venture: one gate_passed, zero venture.created, projection row", async () => {
    const r = await mintVenture(client, actors);
    const vid = r.ventureId!;
    const row = (await getVenture(client, vid))!;
    expect(row.state).toBe("trend_analysis");
    expect(row.entry_dr_ref).toBe(r.drId);
    expect(await countEventsFor(client, "gate_passed", vid)).toBe(1);
    expect(await countEventsFor(client, "venture.created", vid)).toBe(0);
    const { rows } = await client.query(
      "SELECT gate_id, venture_id, gate_event_id FROM gate_passes WHERE dr_id = $1",
      [r.drId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].gate_id).toBe("G-01");
    expect(rows[0].venture_id).toBe(vid);
    expect(rows[0].gate_event_id).toBe(r.eventId);
    const ev = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM events WHERE id = $1",
      [r.eventId],
    );
    const p = ev.rows[0].payload;
    expect(p.gate_id).toBe("G-01");
    expect(p.gate_name).toBe("Opportunity Intake");
    expect(p.from_state).toBeNull();
    expect(p.to_state).toBe("trend_analysis");
    expect(p.effect).toBe("venture_created");
    expect(p.transition_kind).toBe("gate_pass");
    expect(p.dr_id).toBe(r.drId);
    expect(typeof p.opportunity_ref).toBe("string");
  });

  it("G-02..G-06 advance with exactly one gate_passed each and zero venture.stage_advanced", async () => {
    const v = await mintVenture(client, actors);
    const vid = v.ventureId!;
    const { handoffStage, completeAnalysisItem, ANALYSIS_ITEMS } = await import(
      "../src/lib/venture.js"
    );
    await handoffStage(client, { ventureId: vid, expectedFrom: "trend_analysis", actor: "op" });
    const plan: Array<[string, string]> = [
      ["G-02", "validation"], ["G-03", "analysis"], ["G-04", "prototype"],
      ["G-05", "mvp"], ["G-06", "pmf"],
    ];
    for (const [gate, expectedTo] of plan) {
      if (gate === "G-04") {
        for (const item of ANALYSIS_ITEMS) {
          await completeAnalysisItem(client, {
            ventureId: vid, item, actor: "op", evidenceRef: `artifact-${item}`,
          });
        }
      }
      const r = await passGateFor(client, actors, vid, gate);
      expect(r.toState).toBe(expectedTo);
    }
    expect((await getVenture(client, vid))!.state).toBe("pmf");
    expect(await countEventsFor(client, "gate_passed", vid)).toBe(1 + plan.length); // G-01 + 5
    expect(await countEventsFor(client, "venture.stage_advanced", vid)).toBe(0);
    expect(await countEventsFor(client, "venture.stage_handoff", vid)).toBe(1);
  });

  it("standing gates G-17/G-18 authorize a subject and never move the venture", async () => {
    const vid = await ventureTo(client, actors, "validation");
    const before = (await getVenture(client, vid))!.state;
    for (const gateId of ["G-17", "G-18"]) {
      const dr = makeDR({ gateId, proposer: actors.proposer, approver: actors.approver, killCriteria: null });
      const approvalEventId = await approveDR(client, actors, dr);
      const r = await passStandingGate(client, {
        gateId, subjectType: gateId === "G-17" ? "communication" : "data-use",
        subjectId: `subject-${dr.id}`, ventureId: vid,
        decisionRecord: dr, approvalEventId, actor: "op",
      });
      expect(r.fromState).toBeNull();
      expect(r.toState).toBeNull();
      expect(await gatePassRows(client, dr.id)).toBe(1);
    }
    expect((await getVenture(client, vid))!.state).toBe(before); // unchanged
  });

  it("standing gates demand a non-empty subject", async () => {
    const dr = makeDR({ gateId: "G-17", proposer: actors.proposer, approver: actors.approver, killCriteria: null });
    await expect(
      passStandingGate(client, {
        gateId: "G-17", subjectType: " ", subjectId: "", decisionRecord: dr,
        approvalEventId: "EV-x", actor: "op",
      }),
    ).rejects.toThrow(/non-empty subjectType and subjectId/i);
  });

  it("the projection only references real events (FK join holds)", async () => {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM gate_passes gp
        LEFT JOIN events ge ON ge.id = gp.gate_event_id
        LEFT JOIN events ae ON ae.id = gp.approval_event_id
       WHERE ge.id IS NULL OR ae.id IS NULL OR ge.event_type <> 'gate_passed'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("passGate dispatcher: G-01 without name/opportunity is rejected; pipeline needs ventureId", async () => {
    const dr = makeDR({ gateId: "G-01", proposer: actors.proposer, approver: actors.approver });
    await expect(
      passGate(client, { gateId: "G-01", decisionRecord: dr, approvalEventId: "EV-x", actor: "op" }),
    ).rejects.toThrow(/name|opportunityRef/i);
    const dr2 = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    await expect(
      passGate(client, { gateId: "G-02", decisionRecord: dr2, approvalEventId: "EV-x", actor: "op" }),
    ).rejects.toThrow(/requires a ventureId/i);
  });
});

describe("gate system v0 — atomicity", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "ga");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("event-append failure: no transition, no projection", async () => {
    const vid = await ventureTo(client, actors, "research");
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    const approvalEventId = await approveDR(client, actors, dr);
    await expect(
      withBlocked(client, "events", "INSERT", () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId, actor: "op",
        }),
      ),
    ).rejects.toThrow(/gtest-injected/i);
    expect((await getVenture(client, vid))!.state).toBe("research");
    expect(await gatePassRows(client, dr.id)).toBe(0);
  });

  it("projection-insert failure: event and transition roll back", async () => {
    const vid = await ventureTo(client, actors, "research");
    const before = await countEventsFor(client, "gate_passed", vid);
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    const approvalEventId = await approveDR(client, actors, dr);
    await expect(
      withBlocked(client, "gate_passes", "INSERT", () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId, actor: "op",
        }),
      ),
    ).rejects.toThrow(/gtest-injected/i);
    expect((await getVenture(client, vid))!.state).toBe("research");
    expect(await countEventsFor(client, "gate_passed", vid)).toBe(before);
  });

  it("venture-update failure: no gate_passed", async () => {
    const vid = await ventureTo(client, actors, "research");
    const before = await countEventsFor(client, "gate_passed", vid);
    const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
    const approvalEventId = await approveDR(client, actors, dr);
    await expect(
      withBlocked(client, "ventures", "UPDATE", () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId, actor: "op",
        }),
      ),
    ).rejects.toThrow(/gtest-injected/i);
    expect(await countEventsFor(client, "gate_passed", vid)).toBe(before);
    expect(await gatePassRows(client, dr.id)).toBe(0);
  });

  it("G-01 creation failure: no venture, no event, no projection", async () => {
    const year = freshYear();
    const dr = makeDR({ gateId: "G-01", proposer: actors.proposer, approver: actors.approver });
    const approvalEventId = await approveDR(client, actors, dr);
    await expect(
      withBlocked(client, "ventures", "INSERT", () =>
        passG01CreateVenture(client, {
          name: "ghost", opportunityRef: "KI-x", decisionRecord: dr,
          approvalEventId, actor: "op", year,
        }),
      ),
    ).rejects.toThrow(/gtest-injected/i);
    const { rows } = await client.query("SELECT 1 FROM ventures WHERE id = $1", [`V-${year}-1`]);
    expect(rows.length).toBe(0);
    expect(await gatePassRows(client, dr.id)).toBe(0);
  });
});

describe("gate system v0 — concurrency", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "gc");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  async function freshClient(): Promise<pg.Client> {
    const c = new pg.Client({ connectionString: DATABASE_URL });
    await c.connect();
    return c;
  }

  it("two concurrent passes of the same gate + same DR: one commits, one event, one projection", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      const vid = await ventureTo(client, actors, "research");
      const dr = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
      const approvalEventId = await approveDR(client, actors, dr);
      const args = { gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId, actor: "op" };
      const results = await Promise.allSettled([passPipelineGate(a, args), passPipelineGate(b, args)]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      expect(await gatePassRows(client, dr.id)).toBe(1);
      const gp = await countEventsFor(client, "gate_passed", vid);
      expect(gp).toBe(2); // G-01 mint + this single G-02 pass
      expect((await getVenture(client, vid))!.state).toBe("validation");
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("two concurrent passes from the same state with different DRs: one advances, loser leaves nothing", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      const vid = await ventureTo(client, actors, "research");
      const drA = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
      const drB = makeDR({ gateId: "G-02", proposer: actors.proposer, approver: actors.approver });
      const [apA, apB] = [await approveDR(client, actors, drA), await approveDR(client, actors, drB)];
      const results = await Promise.allSettled([
        passPipelineGate(a, { gateId: "G-02", ventureId: vid, decisionRecord: drA, approvalEventId: apA, actor: "op" }),
        passPipelineGate(b, { gateId: "G-02", ventureId: vid, decisionRecord: drB, approvalEventId: apB, actor: "op" }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok.length).toBe(1);
      expect(String(bad[0].reason)).toMatch(/wrong gate for venture state/i);
      expect((await gatePassRows(client, drA.id)) + (await gatePassRows(client, drB.id))).toBe(1);
      expect((await getVenture(client, vid))!.state).toBe("validation");
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("gate pass vs approver-role revocation: serialized; never a pass after an effective revoke", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      for (let i = 0; i < 6; i++) {
        const pair = await setupActors(client, `gcr${i}`);
        const vid = await ventureTo(client, actors, "research");
        const dr = makeDR({ gateId: "G-02", proposer: pair.proposer, approver: pair.approver });
        const approvalEventId = await approveDR(client, pair, dr);
        const [pass, rev] = await Promise.allSettled([
          passPipelineGate(a, { gateId: "G-02", ventureId: vid, decisionRecord: dr, approvalEventId, actor: "op" }),
          revokeRole(b, { userId: pair.approver, role: "approver", revokedBy: "admin" }),
        ]);
        expect(rev.status).toBe("fulfilled");
        if (pass.status === "fulfilled") {
          // The pass serialized first: its event seq precedes the revoke's.
          const passSeq = await client.query<{ seq: string }>(
            "SELECT seq FROM events WHERE id = $1", [pass.value.eventId]);
          const revSeq = await client.query<{ seq: string }>(
            "SELECT seq FROM events WHERE event_type = 'role.revoked' AND object_id = $1 ORDER BY seq DESC LIMIT 1",
            [pair.approver]);
          expect(Number(passSeq.rows[0].seq)).toBeLessThan(Number(revSeq.rows[0].seq));
        } else {
          expect(String(pass.reason)).toMatch(/no longer holds an active 'approver' role/i);
          expect(await gatePassRows(client, dr.id)).toBe(0);
        }
      }
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("concurrent G-01 with the same DR: one venture, one gate_passed", async () => {
    const a = await freshClient();
    const b = await freshClient();
    try {
      const year = freshYear();
      const dr = makeDR({ gateId: "G-01", proposer: actors.proposer, approver: actors.approver });
      const approvalEventId = await approveDR(client, actors, dr);
      const args = {
        name: "cc-venture", opportunityRef: "KI-cc", decisionRecord: dr,
        approvalEventId, actor: "op", year,
      };
      const results = await Promise.allSettled([
        passG01CreateVenture(a, args), passG01CreateVenture(b, args),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok.length).toBe(1);
      expect(String(bad[0].reason)).toMatch(/no gate shopping|already been executed/i);
      const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM ventures WHERE entry_dr_ref = $1", [dr.id]);
      expect(rows[0].n).toBe(1);
      expect(await gatePassRows(client, dr.id)).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("the event-log hash chain is intact after all gate activity", async () => {
    const r = await verifyChainInDb(client);
    expect(r.ok).toBe(true);
  });
});
