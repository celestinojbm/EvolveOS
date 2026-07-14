/**
 * Shared test helpers: actors with roles, in-memory Decision Records, approval
 * evidence, and full-protocol gate passes (the production path via gates.ts).
 */
import pg from "pg";
import { createUser, grantRole } from "../src/lib/auth.js";
import { recordApproval } from "../src/lib/auth.js";
import {
  passG01CreateVenture,
  passPipelineGate,
  type DecisionRecordDoc,
  type GatePassResult,
} from "../src/lib/gates.js";
import {
  TRANSITIONS,
  ANALYSIS_ITEMS,
  handoffStage,
  completeAnalysisItem,
  type VentureState,
} from "../src/lib/venture.js";

export const runId = process.env.TEST_RUN_ID ?? String(Date.now());

// Unique numeric base so DR ids / years never collide across runs on one DB.
let drSeq = Number(String(Date.now()).slice(-8));
let yearCounter = 2100 + (Number(runId.replace(/\D/g, "").slice(-3)) % 800);

export function freshYear(): number {
  yearCounter += 1;
  return yearCounter;
}

export interface Actors {
  proposer: string;
  approver: string;
}

/** Create proposer + approver users; grant the approver role. */
export async function setupActors(client: pg.Client, tag: string): Promise<Actors> {
  const proposer = `prop-${runId}-${tag}`;
  const approver = `appr-${runId}-${tag}`;
  await createUser(client, { id: proposer, displayName: "Proposer" });
  await createUser(client, { id: approver, displayName: "Approver" });
  await grantRole(client, { userId: approver, role: "approver", grantedBy: "admin" });
  return { proposer, approver };
}

/** Build a schema-valid, approved DR for a gate (overridable for failure tests). */
export function makeDR(opts: {
  gateId: string;
  proposer: string;
  approver?: string | null;
  status?: string;
  killCriteria?: string[] | null;
  id?: string;
}): DecisionRecordDoc {
  drSeq += 1;
  const dr: DecisionRecordDoc = {
    id: opts.id ?? `DR-2027-${drSeq}`,
    title: `Test decision for ${opts.gateId}`,
    proposer: opts.proposer,
    approver: opts.approver === undefined ? null : opts.approver,
    gate_id: opts.gateId,
    reversibility_class: "R2",
    decision: "Proceed to the next stage.",
    status: opts.status ?? "approved",
  };
  if (opts.killCriteria !== null) {
    dr.kill_criteria = opts.killCriteria ?? ["conversion below 2% after 1000 sessions"];
  }
  return dr;
}

/** Record the approval evidence for a DR (issue-#7 approvals path). */
export async function approveDR(
  client: pg.Client,
  actors: Actors,
  dr: DecisionRecordDoc,
): Promise<string> {
  const r = await recordApproval(client, {
    objectType: "decision-record",
    objectId: dr.id,
    proposerActorId: actors.proposer,
    approverActorId: actors.approver,
  });
  return r.eventId;
}

/** Full-protocol G-01 pass: mints a venture in trend_analysis. */
export async function mintVenture(
  client: pg.Client,
  actors: Actors,
  opts?: { name?: string; year?: number; opportunityRef?: string },
): Promise<GatePassResult & { drId: string }> {
  const dr = makeDR({ gateId: "G-01", proposer: actors.proposer, approver: actors.approver });
  const approvalEventId = await approveDR(client, actors, dr);
  const r = await passG01CreateVenture(client, {
    name: opts?.name ?? `venture-${dr.id}`,
    opportunityRef: opts?.opportunityRef ?? `KI-opp-${dr.id}`,
    decisionRecord: dr,
    approvalEventId,
    actor: actors.approver,
    year: opts?.year ?? freshYear(),
  });
  return { ...r, drId: dr.id };
}

/** Full-protocol pass of one pipeline gate G-02..G-06 with a fresh DR. */
export async function passGateFor(
  client: pg.Client,
  actors: Actors,
  ventureId: string,
  gateId: string,
): Promise<GatePassResult> {
  const dr = makeDR({ gateId, proposer: actors.proposer, approver: actors.approver });
  const approvalEventId = await approveDR(client, actors, dr);
  return passPipelineGate(client, {
    gateId,
    ventureId,
    decisionRecord: dr,
    approvalEventId,
    actor: actors.approver,
  });
}

/** Drive a freshly-minted venture to `target` via the real gate/handoff path. */
export async function ventureTo(
  client: pg.Client,
  actors: Actors,
  target: VentureState,
  opts?: { completeChecklist?: boolean },
): Promise<string> {
  const v = await mintVenture(client, actors);
  const vid = v.ventureId!;
  let state: VentureState = "trend_analysis";
  while (state !== target) {
    const t = TRANSITIONS.find((x) => x.from === state);
    if (!t) throw new Error(`cannot reach ${target} from ${state}`);
    if (t.kind === "handoff") {
      await handoffStage(client, { ventureId: vid, expectedFrom: state, actor: actors.approver });
    } else {
      if (t.from === "analysis" && opts?.completeChecklist !== false) {
        for (const item of ANALYSIS_ITEMS) {
          await completeAnalysisItem(client, {
            ventureId: vid,
            item,
            actor: actors.approver,
            evidenceRef: `artifact-${item}-${vid}`,
          });
        }
      }
      await passGateFor(client, actors, vid, t.gate);
    }
    state = t.to;
  }
  return vid;
}

export async function countEventsFor(
  client: pg.Client,
  type: string,
  objectId: string,
): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE event_type = $1 AND object_id = $2",
    [type, objectId],
  );
  return rows[0].n;
}
