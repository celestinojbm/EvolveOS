import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { verifyChainInDb } from "../src/lib/eventlog.js";
import { revokeRole } from "../src/lib/auth.js";
import {
  passGate,
  passG01CreateVenture,
  passPipelineGate,
  passStandingGate,
  gateMeta,
  PIPELINE_GATES,
  STANDING_GATES,
} from "../src/lib/gates.js";
import { appendEvent } from "../src/lib/eventlog.js";
import { getVenture } from "../src/lib/venture.js";
import {
  runId,
  freshYear,
  setupActors,
  fileDR,
  approveDR,
  mintVenture,
  passGateFor,
  ventureTo,
  countEventsFor,
  digestDecisionRecordContent,
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

  it("1. unknown gate (rejected before any DR is loaded)", async () => {
    await expectRejected(
      () =>
        passGate(client, {
          gateId: "G-99",
          decisionRecordId: "DR-2099-1",
          approvalEventId: "EV-x",
          actor: "op",
        }),
      /unknown gate/i,
    );
  });

  it("2. known but not-implemented gate", async () => {
    await expectRejected(
      () =>
        passGate(client, {
          gateId: "G-08",
          decisionRecordId: "DR-2099-1",
          approvalEventId: "EV-x",
          actor: "op",
        }),
      /not implemented in gate system v0/i,
    );
  });

  it("3. G-00 through the pass path is rejected toward the issue-#12 stop mechanism", async () => {
    await expectRejected(
      () =>
        passGate(client, {
          gateId: "G-00",
          decisionRecordId: "DR-2099-1",
          approvalEventId: "EV-x",
          actor: "op",
        }),
      /stop invocation.*issue #12/i,
    );
  });

  it("4. a decisionRecordId that was never filed is rejected", async () => {
    const vid = await ventureTo(client, actors, "research");
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: `DR-2099-${Math.floor(Math.random() * 1e6)}`,
          approvalEventId: "EV-x",
          actor: "op",
        }),
      /decision record not filed/i,
    );
  });

  it("5. filed DR citing a different gate", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-03" });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId: "EV-x",
          actor: "op",
        }),
      /gate mismatch/i,
      filed.drId,
    );
  });

  it("6. filed DR not approved (status)", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02", status: "proposed" });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId: "EV-x",
          actor: "op",
        }),
      /not approved/i,
      filed.drId,
    );
  });

  it("7. filed DR with no approver", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02", approver: null });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId: "EV-x",
          actor: "op",
        }),
      /no approver/i,
      filed.drId,
    );
  });

  it("8. filed DR whose proposer equals its approver", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02", approver: actors.proposer });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId: "EV-x",
          actor: "op",
        }),
      /role separation/i,
      filed.drId,
    );
  });

  it("9. gate-mandatory kill criteria absent (G-01, an R1 gate that still requires them)", async () => {
    // G-01 is R1, so the DR-intrinsic R2+ kill rule does not apply — the DR is
    // filable — but the gate registry marks kill criteria mandatory for G-01, so
    // the GATE rejects it.
    const filed = await fileDR(client, actors, { gateId: "G-01", killCriteria: null });
    const approvalEventId = await approveDR(client, actors, filed);
    await expectRejected(
      () =>
        passG01CreateVenture(client, {
          name: "no-kill",
          opportunityRef: "KI-no-kill",
          decisionRecordId: filed.drId,
          approvalEventId,
          actor: actors.approver,
          year: freshYear(),
        }),
      /kill criterion/i,
      filed.drId,
    );
  });

  it("10. approval event does not exist", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId: `EV-missing-${runId}`,
          actor: "op",
        }),
      /approval event not found/i,
      filed.drId,
    );
  });

  it("11. referenced event is not approval.recorded", async () => {
    const v = await mintVenture(client, actors); // its eventId is a gate_passed event
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: v.ventureId!,
          decisionRecordId: filed.drId,
          approvalEventId: v.eventId,
          actor: "op",
        }),
      /not an approval\.recorded event/i,
      filed.drId,
    );
  });

  it("12. approval is for another DR", async () => {
    const vid = await ventureTo(client, actors, "research");
    const other = await fileDR(client, actors, { gateId: "G-02" });
    const otherApproval = await approveDR(client, actors, other);
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId: otherApproval,
          actor: "op",
        }),
      /approves DR/i,
      filed.drId,
    );
  });

  it("13. approval actors do not match the DR", async () => {
    const pair2 = await setupActors(client, "gf2");
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" }); // DR approver = actors.approver
    const foreignApproval = await approveDR(client, pair2, filed); // recorded by pair2.approver
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId: foreignApproval,
          actor: "op",
        }),
      /approval event actor mismatch/i,
      filed.drId,
    );
  });

  it("14. approver lost the approver role after approving", async () => {
    const pair3 = await setupActors(client, "gf3");
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, pair3, { gateId: "G-02" }); // proposer/approver = pair3
    const approvalEventId = await approveDR(client, pair3, filed);
    await revokeRole(client, { userId: pair3.approver, role: "approver", revokedBy: "admin" });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId,
          actor: "op",
        }),
      /no longer holds an active 'approver' role/i,
      filed.drId,
    );
  });

  it("15. an already-executed DR cannot be reused (no gate shopping)", async () => {
    const vidA = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const approvalEventId = await approveDR(client, actors, filed);
    await passPipelineGate(client, {
      gateId: "G-02",
      ventureId: vidA,
      decisionRecordId: filed.drId,
      approvalEventId,
      actor: "op",
    });
    const vidB = await ventureTo(client, actors, "research");
    await expect(
      passPipelineGate(client, {
        gateId: "G-02",
        ventureId: vidB,
        decisionRecordId: filed.drId,
        approvalEventId,
        actor: "op",
      }),
    ).rejects.toThrow(/no gate shopping|already been executed/i);
    expect(await gatePassRows(client, filed.drId)).toBe(1); // still exactly one
    expect((await getVenture(client, vidB))!.state).toBe("research"); // untouched
  });

  it("16/17. wrong gate for the venture's actual state / stale state", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-03" });
    const approvalEventId = await approveDR(client, actors, filed);
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-03",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId,
          actor: "op",
        }),
      /wrong gate for venture state/i,
      filed.drId,
    );
    expect((await getVenture(client, vid))!.state).toBe("research");
  });

  it("18. G-04 without the five filed artifacts", async () => {
    const vid = await ventureTo(client, actors, "analysis", { completeChecklist: false });
    const filed = await fileDR(client, actors, { gateId: "G-04" });
    const approvalEventId = await approveDR(client, actors, filed);
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-04",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId,
          actor: "op",
        }),
      /analysis block incomplete/i,
      filed.drId,
    );
  });

  it("spend requests are rejected toward the manual queue (mechanic 3, ADR-006)", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    await expectRejected(
      () =>
        passPipelineGate(client, {
          gateId: "G-02",
          ventureId: vid,
          decisionRecordId: filed.drId,
          approvalEventId: "EV-x",
          actor: "op",
          requestedSpend: 500,
        }),
      /requires manual queue \(A1\)/i,
      filed.drId,
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
      const filed = await fileDR(client, actors, { gateId });
      const approvalEventId = await approveDR(client, actors, filed);
      const r = await passStandingGate(client, {
        gateId, subjectType: gateId === "G-17" ? "communication" : "data-use",
        subjectId: `subject-${filed.drId}`, ventureId: vid,
        decisionRecordId: filed.drId, approvalEventId, actor: "op",
      });
      expect(r.fromState).toBeNull();
      expect(r.toState).toBeNull();
      expect(await gatePassRows(client, filed.drId)).toBe(1);
    }
    expect((await getVenture(client, vid))!.state).toBe(before); // unchanged
  });

  it("standing gates demand a non-empty subject", async () => {
    const filed = await fileDR(client, actors, { gateId: "G-17" });
    await expect(
      passStandingGate(client, {
        gateId: "G-17", subjectType: " ", subjectId: "", decisionRecordId: filed.drId,
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
    const g1 = await fileDR(client, actors, { gateId: "G-01" });
    await expect(
      passGate(client, { gateId: "G-01", decisionRecordId: g1.drId, approvalEventId: "EV-x", actor: "op" }),
    ).rejects.toThrow(/name|opportunityRef/i);
    const g2 = await fileDR(client, actors, { gateId: "G-02" });
    await expect(
      passGate(client, { gateId: "G-02", decisionRecordId: g2.drId, approvalEventId: "EV-x", actor: "op" }),
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
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const approvalEventId = await approveDR(client, actors, filed);
    await expect(
      withBlocked(client, "events", "INSERT", () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId, actor: "op",
        }),
      ),
    ).rejects.toThrow(/gtest-injected/i);
    expect((await getVenture(client, vid))!.state).toBe("research");
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });

  it("projection-insert failure: event and transition roll back", async () => {
    const vid = await ventureTo(client, actors, "research");
    const before = await countEventsFor(client, "gate_passed", vid);
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const approvalEventId = await approveDR(client, actors, filed);
    await expect(
      withBlocked(client, "gate_passes", "INSERT", () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId, actor: "op",
        }),
      ),
    ).rejects.toThrow(/gtest-injected/i);
    expect((await getVenture(client, vid))!.state).toBe("research");
    expect(await countEventsFor(client, "gate_passed", vid)).toBe(before);
  });

  it("venture-update failure: no gate_passed", async () => {
    const vid = await ventureTo(client, actors, "research");
    const before = await countEventsFor(client, "gate_passed", vid);
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const approvalEventId = await approveDR(client, actors, filed);
    await expect(
      withBlocked(client, "ventures", "UPDATE", () =>
        passPipelineGate(client, {
          gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId, actor: "op",
        }),
      ),
    ).rejects.toThrow(/gtest-injected/i);
    expect(await countEventsFor(client, "gate_passed", vid)).toBe(before);
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });

  it("G-01 creation failure: no venture, no event, no projection", async () => {
    const year = freshYear();
    const filed = await fileDR(client, actors, { gateId: "G-01" });
    const approvalEventId = await approveDR(client, actors, filed);
    await expect(
      withBlocked(client, "ventures", "INSERT", () =>
        passG01CreateVenture(client, {
          name: "ghost", opportunityRef: "KI-x", decisionRecordId: filed.drId,
          approvalEventId, actor: "op", year,
        }),
      ),
    ).rejects.toThrow(/gtest-injected/i);
    // Robust across reused DBs: no venture references this freshly-filed DR.
    const { rows } = await client.query("SELECT 1 FROM ventures WHERE entry_dr_ref = $1", [filed.drId]);
    expect(rows.length).toBe(0);
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });
});

describe("gate system v0 — content binding + reversibility", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "gb");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  async function forgeApprovalEvent(
    payload: Record<string, unknown>,
    objectId: string,
    actorId: string,
  ): Promise<string> {
    const id = `EV-forged-${runId}-${Math.random().toString(36).slice(2, 10)}`;
    await appendEvent(client, {
      id,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: actorId,
      event_type: "approval.recorded",
      object_type: "decision-record",
      object_id: objectId,
      payload,
    });
    return id;
  }

  it("the gate binds to the FILED bytes: a stale in-memory copy cannot change the pass", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const approvalEventId = await approveDR(client, actors, filed);
    // Mutate the caller's in-memory document — the gate loads the immutable
    // stored copy by id, so the mutation is irrelevant.
    filed.document.decision = "changed in memory";
    filed.document.gate_id = "G-99";
    const r = await passPipelineGate(client, {
      gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId, actor: "op",
    });
    expect(r.toState).toBe("validation");
    const ev = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM events WHERE id = $1", [r.eventId]);
    const p = ev.rows[0].payload;
    expect(p.gate_id).toBe("G-02");
    expect(p.dr_digest).toBe(filed.digest);
    expect(p.reversibility_class).toBe("R2");
  });

  it("an approval bound to a different digest than the filed DR is rejected with zero effects", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    // Approve with a valid-format digest that is NOT the filed DR's digest.
    const wrongDigest = digestDecisionRecordContent({ ...filed.document, decision: "different" });
    const approvalEventId = await approveDR(client, actors, filed, { digest: wrongDigest });
    await expect(
      passPipelineGate(client, {
        gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId, actor: "op",
      }),
    ).rejects.toThrow(/approval digest mismatch/i);
    expect((await getVenture(client, vid))!.state).toBe("research");
    expect(await gatePassRows(client, filed.drId)).toBe(0);
    expect(await countEventsFor(client, "gate_passed", vid)).toBe(1); // only the G-01 mint
  });

  it("a forged approval event whose actor is not the approver is rejected", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const forged = await forgeApprovalEvent(
      { proposer_actor_id: actors.proposer, object_digest: filed.digest },
      filed.drId,
      "someone-else",
    );
    await expect(
      passPipelineGate(client, {
        gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId: forged, actor: "op",
      }),
    ).rejects.toThrow(/approval event actor mismatch/i);
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });

  it("an approval event without a digest is rejected", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const forged = await forgeApprovalEvent(
      { proposer_actor_id: actors.proposer }, filed.drId, actors.approver);
    await expect(
      passPipelineGate(client, {
        gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId: forged, actor: "op",
      }),
    ).rejects.toThrow(/carries no document digest/i);
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });

  it("an approval event with a different digest is rejected", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const forged = await forgeApprovalEvent(
      { proposer_actor_id: actors.proposer, object_digest: "0".repeat(64) },
      filed.drId,
      actors.approver,
    );
    await expect(
      passPipelineGate(client, {
        gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId: forged, actor: "op",
      }),
    ).rejects.toThrow(/approval digest mismatch/i);
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });

  it("an approval event whose digest is not a string is rejected cleanly (no TypeError)", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const forged = await forgeApprovalEvent(
      { proposer_actor_id: actors.proposer, object_digest: 1234567890 }, // a number, not hex
      filed.drId,
      actors.approver,
    );
    await expect(
      passPipelineGate(client, {
        gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId: forged, actor: "op",
      }),
    ).rejects.toThrow(/carries no document digest/i);
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });

  it("an approval event with a malformed (non-SHA-256) digest string is rejected", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const forged = await forgeApprovalEvent(
      { proposer_actor_id: actors.proposer, object_digest: "deadbeef" }, // valid hex, wrong length
      filed.drId,
      actors.approver,
    );
    await expect(
      passPipelineGate(client, {
        gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId: forged, actor: "op",
      }),
    ).rejects.toThrow(/malformed document digest/i);
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });

  it("a correct approval with the correct digest passes", async () => {
    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const approvalEventId = await approveDR(client, actors, filed);
    const r = await passPipelineGate(client, {
      gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId, actor: "op",
    });
    expect(r.toState).toBe("validation");
    expect(await gatePassRows(client, filed.drId)).toBe(1);
  });

  it.each([
    ["G-01", "R1"], ["G-02", "R2"], ["G-03", "R2"], ["G-04", "R2"],
    ["G-05", "R3"], ["G-06", "R3"], ["G-17", "R3"], ["G-18", "R3"],
  ])("gate %s requires canonical reversibility %s; a wrong class is rejected", async (
    gateId,
    klass,
  ) => {
    expect(gateMeta(gateId).reversibility_class).toBe(klass);
    const wrong = klass === "R2" ? "R3" : "R2";
    const filed = await fileDR(client, actors, { gateId, reversibility: wrong });
    await expect(
      passGate(client, {
        gateId, decisionRecordId: filed.drId, approvalEventId: "EV-x", actor: "op",
        name: "x", opportunityRef: "KI-x", ventureId: "V-2099-1",
        subjectType: "subject", subjectId: "subject-1",
      }),
    ).rejects.toThrow(
      new RegExp(`reversibility mismatch: gate ${gateId} requires ${klass}, DR declares ${wrong}`),
    );
    expect(await gatePassRows(client, filed.drId)).toBe(0);
  });

  it("DB backstop: gate_passes rejects G-00, unknown, G-07..G-16, and malformed shapes", async () => {
    const v = await mintVenture(client, actors);
    const eventId = v.eventId; // a real event id to satisfy the FKs
    async function tryInsert(gate: string, ventureId: string | null, st: string | null, si: string | null, drId: string) {
      return client.query(
        `INSERT INTO gate_passes (gate_id, dr_id, approval_event_id, gate_event_id, venture_id,
           subject_type, subject_id, proposer_actor_id, approver_actor_id)
         VALUES ($1,$2,$3,$3,$4,$5,$6,'p','a')`,
        [gate, drId, eventId, ventureId, st, si],
      );
    }
    for (const gate of ["G-00", "G-99", "G-07", "G-16"]) {
      await expect(tryInsert(gate, v.ventureId!, null, null, `DR-2098-${Math.floor(Math.random() * 1e6)}`))
        .rejects.toThrow(/gate_passes_gate_shape|check/i);
    }
    // pipeline without venture / pipeline with subject / standing without subject
    await expect(tryInsert("G-02", null, null, null, "DR-2098-900001")).rejects.toThrow(/check/i);
    await expect(tryInsert("G-02", v.ventureId!, "s", "s1", "DR-2098-900002")).rejects.toThrow(/check/i);
    await expect(tryInsert("G-17", null, null, null, "DR-2098-900003")).rejects.toThrow(/check/i);
    // malformed dr_id
    await expect(tryInsert("G-17", null, "s", "s1", "NOT-A-DR")).rejects.toThrow(/check/i);
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
      const filed = await fileDR(client, actors, { gateId: "G-02" });
      const approvalEventId = await approveDR(client, actors, filed);
      const args = { gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId, actor: "op" };
      const results = await Promise.allSettled([passPipelineGate(a, args), passPipelineGate(b, args)]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      expect(await gatePassRows(client, filed.drId)).toBe(1);
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
      const drA = await fileDR(client, actors, { gateId: "G-02" });
      const drB = await fileDR(client, actors, { gateId: "G-02" });
      const [apA, apB] = [await approveDR(client, actors, drA), await approveDR(client, actors, drB)];
      const results = await Promise.allSettled([
        passPipelineGate(a, { gateId: "G-02", ventureId: vid, decisionRecordId: drA.drId, approvalEventId: apA, actor: "op" }),
        passPipelineGate(b, { gateId: "G-02", ventureId: vid, decisionRecordId: drB.drId, approvalEventId: apB, actor: "op" }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok.length).toBe(1);
      expect(String(bad[0].reason)).toMatch(/wrong gate for venture state/i);
      expect((await gatePassRows(client, drA.drId)) + (await gatePassRows(client, drB.drId))).toBe(1);
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
        const filed = await fileDR(client, pair, { gateId: "G-02" });
        const approvalEventId = await approveDR(client, pair, filed);
        const [pass, rev] = await Promise.allSettled([
          passPipelineGate(a, { gateId: "G-02", ventureId: vid, decisionRecordId: filed.drId, approvalEventId, actor: "op" }),
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
          expect(await gatePassRows(client, filed.drId)).toBe(0);
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
      const filed = await fileDR(client, actors, { gateId: "G-01" });
      const approvalEventId = await approveDR(client, actors, filed);
      const args = {
        name: "cc-venture", opportunityRef: "KI-cc", decisionRecordId: filed.drId,
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
        "SELECT count(*)::int AS n FROM ventures WHERE entry_dr_ref = $1", [filed.drId]);
      expect(rows[0].n).toBe(1);
      expect(await gatePassRows(client, filed.drId)).toBe(1);
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

describe("gate system v0 — request-snapshot immunity (whole request, not just the DR)", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "gs");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("pipeline: mutating every request field after the call cannot change the pass", async () => {
    // Two ventures at the same stage: A is the real target, B a decoy.
    const vidA = await ventureTo(client, actors, "research");
    const vidB = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    const approvalEventId = await approveDR(client, actors, filed);
    const input = {
      gateId: "G-02",
      ventureId: vidA,
      decisionRecordId: filed.drId,
      approvalEventId,
      actor: "op-original",
      requestedSpend: 0 as number | null,
    };
    // Start the pass, THEN mutate every scalar field. The function captured them
    // synchronously before its first await, so mutations are ineffective.
    const p = passPipelineGate(client, input);
    input.ventureId = vidB;
    input.decisionRecordId = "DR-9999-1";
    input.approvalEventId = "EV-bogus-does-not-exist";
    input.actor = "mallory";
    input.gateId = "G-05";
    const r = await p;

    expect(r.ventureId).toBe(vidA);
    expect(r.gateId).toBe("G-02");
    expect(r.toState).toBe("validation");
    expect((await getVenture(client, vidA))!.state).toBe("validation"); // A advanced
    expect((await getVenture(client, vidB))!.state).toBe("research"); // B intact
    const ev = await client.query<{
      actor_id: string;
      object_id: string;
      payload: Record<string, unknown>;
    }>("SELECT actor_id, object_id, payload FROM events WHERE id = $1", [r.eventId]);
    expect(ev.rows[0].actor_id).toBe("op-original");
    expect(ev.rows[0].object_id).toBe(vidA);
    expect(ev.rows[0].payload.gate_id).toBe("G-02");
    expect(ev.rows[0].payload.venture_id).toBe(vidA);
    expect(ev.rows[0].payload.approval_event_id).toBe(approvalEventId);
    const gp = await client.query<{
      venture_id: string;
      approval_event_id: string;
      gate_id: string;
    }>("SELECT venture_id, approval_event_id, gate_id FROM gate_passes WHERE dr_id = $1", [filed.drId]);
    expect(gp.rows[0].venture_id).toBe(vidA);
    expect(gp.rows[0].approval_event_id).toBe(approvalEventId);
    expect(gp.rows[0].gate_id).toBe("G-02");
  });

  it("G-01: mutating name/opportunityRef/approvalEventId/actor/year cannot change the mint", async () => {
    const filed = await fileDR(client, actors, { gateId: "G-01" });
    const approvalEventId = await approveDR(client, actors, filed);
    const origYear = freshYear();
    const input = {
      name: "original-name",
      opportunityRef: "KI-original",
      decisionRecordId: filed.drId,
      approvalEventId,
      actor: "op-original",
      year: origYear,
      requestedSpend: 0 as number | null,
    };
    const p = passG01CreateVenture(client, input);
    input.name = "mutated-name";
    input.opportunityRef = "KI-mutated";
    input.approvalEventId = "EV-bogus";
    input.actor = "mallory";
    input.year = 9999;
    const r = await p;

    expect(r.ventureId!.startsWith(`V-${origYear}-`)).toBe(true); // original year
    const vr = await client.query<{ name: string; opportunity_ref: string }>(
      "SELECT name, opportunity_ref FROM ventures WHERE id = $1",
      [r.ventureId],
    );
    expect(vr.rows[0].name).toBe("original-name");
    expect(vr.rows[0].opportunity_ref).toBe("KI-original");
    const ev = await client.query<{ actor_id: string; payload: Record<string, unknown> }>(
      "SELECT actor_id, payload FROM events WHERE id = $1",
      [r.eventId],
    );
    expect(ev.rows[0].actor_id).toBe("op-original");
    expect(ev.rows[0].payload.opportunity_ref).toBe("KI-original");
    expect(ev.rows[0].payload.approval_event_id).toBe(approvalEventId);
  });

  it("standing: mutating subject/ventureId/approvalEventId/actor cannot change the authorization", async () => {
    const filed = await fileDR(client, actors, { gateId: "G-17" });
    const approvalEventId = await approveDR(client, actors, filed);
    const input = {
      gateId: "G-17",
      subjectType: "communication",
      subjectId: "subject-original",
      ventureId: null as string | null,
      decisionRecordId: filed.drId,
      approvalEventId,
      actor: "op-original",
      requestedSpend: 0 as number | null,
    };
    const p = passStandingGate(client, input);
    input.subjectType = "data-use";
    input.subjectId = "subject-mutated";
    input.ventureId = "V-9999-1"; // would trigger a "venture not found" if re-read
    input.approvalEventId = "EV-bogus";
    input.actor = "mallory";
    const r = await p;

    const ev = await client.query<{
      actor_id: string;
      object_type: string;
      object_id: string;
      payload: Record<string, unknown>;
    }>("SELECT actor_id, object_type, object_id, payload FROM events WHERE id = $1", [r.eventId]);
    expect(ev.rows[0].actor_id).toBe("op-original");
    expect(ev.rows[0].object_type).toBe("communication");
    expect(ev.rows[0].object_id).toBe("subject-original");
    expect(ev.rows[0].payload.subject_type).toBe("communication");
    expect(ev.rows[0].payload.subject_id).toBe("subject-original");
    expect(ev.rows[0].payload.venture_id).toBeNull();
    expect(ev.rows[0].payload.approval_event_id).toBe(approvalEventId);
    const gp = await client.query<{
      subject_type: string;
      subject_id: string;
      venture_id: string | null;
      approval_event_id: string;
    }>(
      "SELECT subject_type, subject_id, venture_id, approval_event_id FROM gate_passes WHERE dr_id = $1",
      [filed.drId],
    );
    expect(gp.rows[0].subject_type).toBe("communication");
    expect(gp.rows[0].subject_id).toBe("subject-original");
    expect(gp.rows[0].venture_id).toBeNull();
    expect(gp.rows[0].approval_event_id).toBe(approvalEventId);
  });
});

describe("gate system v0 — registry immutability at runtime", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "gr");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("a gate's metadata is frozen — reversibility_class cannot be re-classified", () => {
    const g5 = gateMeta("G-05");
    expect(g5.reversibility_class).toBe("R3");
    expect(() => {
      (g5 as { reversibility_class: string }).reversibility_class = "R1";
    }).toThrow();
    expect(gateMeta("G-05").reversibility_class).toBe("R3");
  });

  it("the gate lists are frozen — no gate can be added or removed at runtime", () => {
    expect(() => {
      (PIPELINE_GATES as string[]).push("G-08");
    }).toThrow();
    expect(() => {
      (PIPELINE_GATES as string[]).splice(0, 1); // try to remove G-01
    }).toThrow();
    expect(() => {
      (STANDING_GATES as string[])[0] = "G-99";
    }).toThrow();
    expect(PIPELINE_GATES.includes("G-08")).toBe(false);
    expect(PIPELINE_GATES).toContain("G-01");
    expect(STANDING_GATES).toContain("G-17");
  });

  it("runtime tampering cannot implement G-08 nor de-classify G-01", async () => {
    try {
      (PIPELINE_GATES as string[]).push("G-08");
    } catch {
      /* frozen */
    }
    await expect(
      passGate(client, { gateId: "G-08", decisionRecordId: "DR-2099-1", approvalEventId: "EV-x", actor: "op" }),
    ).rejects.toThrow(/not implemented in gate system v0/i);
    const minted = await mintVenture(client, actors);
    expect(minted.ventureId!.startsWith("V-")).toBe(true);
    expect(PIPELINE_GATES).toContain("G-01");
  });
});
