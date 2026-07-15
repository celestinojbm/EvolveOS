/**
 * Shared test helpers: actors with roles, Decision Records FILED into the
 * immutable store (issue #10), approval evidence bound to the filed digest, and
 * full-protocol gate passes that reference the DR by id (the production path via
 * gates.ts).
 */
import pg from "pg";
import { createUser, grantRole, recordApproval } from "../src/lib/auth.js";
import {
  fileDecisionRecord,
  digestDecisionRecordContent,
  type DecisionRecordDoc,
  type DecisionRecordInput,
} from "../src/lib/dr.js";
import {
  passG01CreateVenture,
  passPipelineGate,
  gateMeta,
  type GatePassResult,
} from "../src/lib/gates.js";
import {
  TRANSITIONS,
  ANALYSIS_ITEMS,
  handoffStage,
  completeAnalysisItem,
  type VentureState,
} from "../src/lib/venture.js";

export { digestDecisionRecordContent };

export const runId = process.env.TEST_RUN_ID ?? String(Date.now());

// Unique numeric base so DR placeholder ids / years never collide across runs.
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

/** The gate's canonical reversibility class (fallback R2 for unknown gates). */
function canonicalReversibility(gateId: string): string {
  try {
    return gateMeta(gateId).reversibility_class;
  } catch {
    return "R2";
  }
}

/**
 * Build a schema- and Part-VII-valid DR document for a gate (overridable for
 * failure tests). Includes kill criteria, a rollback plan, and two options with
 * a chosen option so it satisfies the R2+/R3+ intrinsic rules by default. The
 * `id` is a placeholder — filing mints the real `DR-yyyy-seq`.
 */
export function makeDR(opts: {
  gateId: string;
  proposer: string;
  approver?: string | null;
  status?: string;
  killCriteria?: string[] | null;
  id?: string;
  reversibility?: string;
  options?: DecisionRecordDoc["options"] | null;
  rollbackPlan?: string | null;
  risks?: string[];
  dissent?: DecisionRecordDoc["dissent_record"];
}): DecisionRecordDoc {
  drSeq += 1;
  const dr: DecisionRecordDoc = {
    id: opts.id ?? `DR-2027-${drSeq}`,
    title: `Test decision for ${opts.gateId}`,
    proposer: opts.proposer,
    approver: opts.approver === undefined ? null : opts.approver,
    gate_id: opts.gateId,
    reversibility_class: opts.reversibility ?? canonicalReversibility(opts.gateId),
    decision: "Proceed to the next stage.",
    status: opts.status ?? "approved",
  };
  if (opts.killCriteria !== null) {
    dr.kill_criteria = opts.killCriteria ?? ["conversion below 2% after 1000 sessions"];
  }
  if (opts.rollbackPlan !== null) {
    dr.rollback_plan = opts.rollbackPlan ?? "Archive; no external commitments were made.";
  }
  if (opts.options !== null) {
    // Every default option carries a non-empty predicted_outcome_distribution:
    // R3/R4 DRs (G-05/G-06/G-17/G-18) cannot be filed without one per option.
    dr.options = opts.options ?? [
      {
        option_id: "opt-proceed",
        summary: "Proceed to the next stage now.",
        predicted_outcome_distribution: {
          primary_metric: "stage_success_rate",
          representation: "qualitative",
          epistemic_share: 0.5,
        },
      },
      {
        option_id: "opt-defer",
        summary: "Defer one sprint to gather more evidence.",
        predicted_outcome_distribution: {
          primary_metric: "stage_success_rate",
          representation: "qualitative",
          epistemic_share: 0.4,
        },
      },
    ];
    dr.chosen_option = "opt-proceed";
  }
  // R3/R4 DRs cannot be filed with zero risks (Part VII §8.2 top risks).
  dr.risks = opts.risks ?? ["Execution risk at the next stage remains"];
  if (opts.dissent) dr.dissent_record = opts.dissent;
  return dr;
}

export interface FiledDR {
  drId: string;
  digest: string;
  document: DecisionRecordDoc;
}

/** File a DR (built via makeDR) into the immutable store; returns id + digest. */
export async function fileDR(
  client: pg.Client,
  actors: Actors,
  opts: {
    gateId: string;
    status?: string;
    killCriteria?: string[] | null;
    reversibility?: string;
    options?: DecisionRecordDoc["options"] | null;
    rollbackPlan?: string | null;
    approver?: string | null;
    year?: number;
  },
): Promise<FiledDR> {
  const doc = makeDR({
    gateId: opts.gateId,
    proposer: actors.proposer,
    approver: opts.approver === undefined ? actors.approver : opts.approver,
    status: opts.status,
    killCriteria: opts.killCriteria,
    reversibility: opts.reversibility,
    options: opts.options,
    rollbackPlan: opts.rollbackPlan,
  });
  const r = await fileDecisionRecord(client, {
    document: doc as DecisionRecordInput,
    filedBy: actors.proposer,
    year: opts.year,
  });
  return { drId: r.id, digest: r.digest, document: r.document };
}

/**
 * Record the human approval evidence for a FILED DR, bound to its stored digest
 * (issue-#7 approvals path reused). The gate later checks that the approval
 * event's object_digest equals the DR's stored digest.
 */
export async function approveDR(
  client: pg.Client,
  actors: Actors,
  filed: { drId: string; digest: string },
  opts?: { digest?: string },
): Promise<string> {
  const r = await recordApproval(client, {
    objectType: "decision-record",
    objectId: filed.drId,
    proposerActorId: actors.proposer,
    approverActorId: actors.approver,
    objectDigest: opts?.digest ?? filed.digest,
  });
  return r.eventId;
}

/** Full-protocol G-01 pass: files + approves a DR, then mints a venture. */
export async function mintVenture(
  client: pg.Client,
  actors: Actors,
  opts?: { name?: string; year?: number; opportunityRef?: string },
): Promise<GatePassResult & { drId: string }> {
  const filed = await fileDR(client, actors, { gateId: "G-01" });
  const approvalEventId = await approveDR(client, actors, filed);
  const r = await passG01CreateVenture(client, {
    name: opts?.name ?? `venture-${filed.drId}`,
    opportunityRef: opts?.opportunityRef ?? `KI-opp-${filed.drId}`,
    decisionRecordId: filed.drId,
    approvalEventId,
    actor: actors.approver,
    year: opts?.year ?? freshYear(),
  });
  return { ...r, drId: filed.drId };
}

/** Full-protocol pass of one pipeline gate G-02..G-06 with a fresh filed DR. */
export async function passGateFor(
  client: pg.Client,
  actors: Actors,
  ventureId: string,
  gateId: string,
): Promise<GatePassResult> {
  const filed = await fileDR(client, actors, { gateId });
  const approvalEventId = await approveDR(client, actors, filed);
  return passPipelineGate(client, {
    gateId,
    ventureId,
    decisionRecordId: filed.drId,
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
