/**
 * EvolveOS venture record + macro-state machine, stages 1-12 (issue #8, P0-7).
 *
 * Part V models the lifecycle as a gated state machine; per BUILDABILITY_AUDIT
 * §6(f) the MVP models stages 1-12 as a linear enum with the stage 5-9 analysis
 * block as a checklist inside the single macro-state 'analysis'. Stages 13+
 * (G-07 onward) are out of scope here.
 *
 * CANONICAL SOURCES in this module (do not spread this logic elsewhere):
 *   - VENTURE_STATES: the allowed states, in order.
 *   - STAGE_MAP: original Part V stages 1-12 -> state.
 *   - TRANSITIONS: the only legal advances, each with the exact Appendix C gate
 *     that authorizes it.
 *   - ANALYSIS_ITEMS: the five mandatory stage 5-9 checklist items.
 *
 * State changes happen ONLY through `advanceStage` (gate pass) or `killVenture`
 * (kill-from-any-stage -> archived, mandatory post-mortem reference). Both run
 * the issue-#7 discipline: one transaction, event-chain advisory lock FIRST
 * (via appendEventTx / acquireEventChainLock), then `SELECT ... FOR UPDATE` on
 * the venture row, validate, update, COMMIT — any failure rolls back the
 * provisional event, so no event persists for a rejected mutation and no row
 * changes without its event.
 *
 * Boundary with issue #9 (P0-8, gate system v0): the full gate-pass protocol —
 * DR validated against its schema, pre-registered kill criteria, an approval
 * event by a user holding the approver role, proposer≠approver — belongs to
 * #9. Here a gate pass must cite the EXACT gate for the transition plus a
 * non-empty authorization reference (`drRef`), which is recorded in the event
 * payload for #9 to validate. Documented in docs/VENTURE_STATE_MACHINE.md.
 *
 * Spec reconciliation (mechanical, non-normative): Part V stage 2->3 (Trend
 * Analysis -> Research) has no decision gate — it is an "intra-envelope handoff
 * inside the G-01 research grant". Appendix C defines G-01 as admitting to
 * "Trend Analysis/Research" jointly, so that transition cites G-01 (the grant
 * that authorizes it), keeping the issue's rule "state changes only via gate
 * passes or kill" without inventing a gate.
 */
import { randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEventTx, acquireEventChainLock } from "./eventlog.js";

type Queryable = Client | PoolClient;

// --- Canonical state model ---------------------------------------------------

export const VENTURE_STATES = [
  "opportunity_discovery", // stage 1
  "trend_analysis", //         stage 2
  "research", //               stage 3
  "validation", //             stage 4
  "analysis", //               stages 5-9 (checklist block)
  "prototype", //              stage 10
  "mvp", //                    stage 11
  "pmf", //                    stage 12 (Product-Market Fit)
  "archived", //               terminal (pre-entity kill target)
] as const;
export type VentureState = (typeof VENTURE_STATES)[number];

/** Original Part V stages 1-12 -> the macro-state that carries them here. */
export const STAGE_MAP: Readonly<Record<number, { name: string; state: VentureState }>> = {
  1: { name: "Opportunity Discovery", state: "opportunity_discovery" },
  2: { name: "Trend Analysis", state: "trend_analysis" },
  3: { name: "Research", state: "research" },
  4: { name: "Validation", state: "validation" },
  5: { name: "Customer Discovery", state: "analysis" },
  6: { name: "Competitive Analysis", state: "analysis" },
  7: { name: "Financial Modeling", state: "analysis" },
  8: { name: "Risk Analysis", state: "analysis" },
  9: { name: "Legal Analysis", state: "analysis" },
  10: { name: "Prototype", state: "prototype" },
  11: { name: "MVP", state: "mvp" },
  12: { name: "Product-Market Fit", state: "pmf" },
};

/** The five mandatory items of the stage 5-9 analysis block (Part V Phase B). */
export const ANALYSIS_ITEMS = [
  "customer_discovery", //   stage 5
  "competitive_analysis", // stage 6
  "financial_modeling", //   stage 7
  "risk_analysis", //        stage 8
  "legal_analysis", //       stage 9
] as const;
export type AnalysisItem = (typeof ANALYSIS_ITEMS)[number];

export interface Transition {
  from: VentureState;
  to: VentureState;
  gate: string;
  note?: string;
}

/**
 * The only legal advances (linear; no skips, no backward moves). Gates are the
 * Appendix C ids exactly (see schemas/data/gates.json).
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: "opportunity_discovery", to: "trend_analysis", gate: "G-01" },
  {
    from: "trend_analysis",
    to: "research",
    gate: "G-01",
    note: "intra-envelope handoff inside the G-01 research grant (Part V Stage 2; Appendix C G-01 admits to Trend Analysis/Research jointly)",
  },
  { from: "research", to: "validation", gate: "G-02" },
  { from: "validation", to: "analysis", gate: "G-03" },
  {
    from: "analysis",
    to: "prototype",
    gate: "G-04",
    note: "conjunctive block gate: requires all five analysis items complete",
  },
  { from: "prototype", to: "mvp", gate: "G-05" },
  { from: "mvp", to: "pmf", gate: "G-06" },
  // pmf -> operating (G-07, stage 13+) is deliberately absent: out of scope
  // for issue #8 per audit §6(f).
];

const TERMINAL_STATES: readonly VentureState[] = ["archived"];

export function nextTransition(from: VentureState): Transition | null {
  return TRANSITIONS.find((t) => t.from === from) ?? null;
}

// --- Row shape ----------------------------------------------------------------

export interface ChecklistEntry {
  completed_at: string;
  actor: string;
  evidence_ref: string | null;
}

export interface VentureRow {
  id: string;
  name: string;
  state: VentureState;
  analysis_checklist: Partial<Record<AnalysisItem, ChecklistEntry>>;
  post_mortem_ref: string | null;
  archived_reason: string | null;
}

// --- Internal helpers ----------------------------------------------------------

/** Run fn in one transaction: BEGIN -> fn -> COMMIT, ROLLBACK on any error. */
async function inTransaction<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Append one venture event inside the current transaction; returns event id. */
async function logVentureEventTx(
  client: Queryable,
  args: {
    actorId: string;
    eventType: string;
    ventureId: string;
    payload: Record<string, unknown>;
  },
): Promise<string> {
  const ev = await appendEventTx(client, {
    id: `EV-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    actor_type: "human",
    actor_id: args.actorId,
    event_type: args.eventType,
    object_type: "venture",
    object_id: args.ventureId,
    payload: args.payload,
  });
  return ev.id;
}

/** Lock and load the venture row (FOR UPDATE). Throws if it does not exist. */
async function lockVenture(client: Queryable, ventureId: string): Promise<VentureRow> {
  const { rows } = await client.query<VentureRow>(
    `SELECT id, name, state, analysis_checklist, post_mortem_ref, archived_reason
       FROM ventures WHERE id = $1 FOR UPDATE`,
    [ventureId],
  );
  if (!rows.length) throw new Error(`venture not found: ${ventureId}`);
  return rows[0];
}

// --- Public API -----------------------------------------------------------------

/**
 * Create a venture in the initial state (stage 1, standing entry per Part V —
 * creation is not a stage transition and needs no gate). Id format V-yyyy-seq,
 * sequence per year, assigned race-free under the event-chain advisory lock.
 */
export async function createVenture(
  client: Queryable,
  input: { name: string; actor: string; year?: number },
): Promise<{ id: string; state: VentureState; eventId: string }> {
  if (!input.name.trim()) throw new Error("venture name must be non-empty");
  const year = input.year ?? new Date().getUTCFullYear();
  return inTransaction(client, async () => {
    // Advisory lock FIRST (consistent order), explicitly — the id must be
    // computed before the event that records it.
    await acquireEventChainLock(client);
    const { rows } = await client.query<{ last_seq: number }>(
      `INSERT INTO venture_counters (year, last_seq) VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE SET last_seq = venture_counters.last_seq + 1
       RETURNING last_seq`,
      [year],
    );
    const id = `V-${year}-${rows[0].last_seq}`;
    await client.query("INSERT INTO ventures (id, name) VALUES ($1, $2)", [id, input.name]);
    const eventId = await logVentureEventTx(client, {
      actorId: input.actor,
      eventType: "venture.created",
      ventureId: id,
      payload: { name: input.name, state: "opportunity_discovery" },
    });
    return { id, state: "opportunity_discovery" as VentureState, eventId };
  });
}

/**
 * Advance a venture one stage via a gate pass. The ONLY way (besides kill) a
 * venture changes state. Validates, inside the serialized transaction: the
 * venture exists; it is not archived; its actual state equals `expectedFrom`;
 * that state has a next legal transition; `gateId` is EXACTLY that transition's
 * gate; and, when leaving 'analysis', that all five checklist items are
 * complete. `drRef` (the authorizing DR / grant reference) is required and
 * recorded in the event payload; full DR/approval validation is issue #9.
 */
export async function advanceStage(
  client: Queryable,
  input: {
    ventureId: string;
    expectedFrom: VentureState;
    gateId: string;
    actor: string;
    drRef: string;
    approvalRef?: string | null;
  },
): Promise<{ from: VentureState; to: VentureState; eventId: string }> {
  if (!input.drRef?.trim()) {
    throw new Error("authorization required: drRef (DR / grant reference) must be non-empty");
  }
  return inTransaction(client, async () => {
    // Provisional event first (advisory lock = first lock, consistent order).
    // Rolled back if any validation below fails.
    const t = TRANSITIONS.find((x) => x.from === input.expectedFrom);
    if (!t) {
      throw new Error(
        `no legal transition from '${input.expectedFrom}'` +
          (TERMINAL_STATES.includes(input.expectedFrom) ? " (terminal state)" : ""),
      );
    }
    if (t.gate !== input.gateId) {
      throw new Error(
        `wrong gate: transition ${t.from} -> ${t.to} requires ${t.gate}, got ${input.gateId}`,
      );
    }
    const eventId = await logVentureEventTx(client, {
      actorId: input.actor,
      eventType: "venture.stage_advanced",
      ventureId: input.ventureId,
      payload: {
        from: t.from,
        to: t.to,
        gate_id: t.gate,
        dr_ref: input.drRef,
        approval_ref: input.approvalRef ?? null,
      },
    });

    const row = await lockVenture(client, input.ventureId);
    if (row.state === "archived") {
      throw new Error(`venture ${row.id} is archived; no further transitions are possible`);
    }
    if (row.state !== input.expectedFrom) {
      throw new Error(
        `stale state: expected '${input.expectedFrom}' but venture is in '${row.state}'`,
      );
    }
    if (t.from === "analysis") {
      const missing = ANALYSIS_ITEMS.filter((i) => !row.analysis_checklist?.[i]);
      if (missing.length) {
        throw new Error(
          `analysis block incomplete: missing ${missing.join(", ")} — G-04 is conjunctive (all five required)`,
        );
      }
    }
    await client.query("UPDATE ventures SET state = $2, updated_at = now() WHERE id = $1", [
      row.id,
      t.to,
    ]);
    return { from: t.from, to: t.to, eventId };
  });
}

/**
 * Mark one stage 5-9 analysis item complete. Allowed only while the venture is
 * in 'analysis'; a duplicate completion is rejected (an output is filed once).
 * Completing items NEVER changes the macro-state — exiting the block is only
 * the G-04 pass (Part V: "the block completes when all five outputs are filed",
 * and the gate decision is separate and conjunctive).
 */
export async function completeAnalysisItem(
  client: Queryable,
  input: { ventureId: string; item: AnalysisItem; actor: string; evidenceRef?: string | null },
): Promise<{ eventId: string; completed: AnalysisItem[] }> {
  if (!(ANALYSIS_ITEMS as readonly string[]).includes(input.item)) {
    throw new Error(`unknown analysis item: ${input.item}`);
  }
  return inTransaction(client, async () => {
    const eventId = await logVentureEventTx(client, {
      actorId: input.actor,
      eventType: "venture.analysis_item_completed",
      ventureId: input.ventureId,
      payload: { item: input.item, evidence_ref: input.evidenceRef ?? null },
    });
    const row = await lockVenture(client, input.ventureId);
    if (row.state !== "analysis") {
      throw new Error(
        `analysis items can only be completed in state 'analysis' (venture is in '${row.state}')`,
      );
    }
    if (row.analysis_checklist?.[input.item]) {
      throw new Error(`analysis item already completed: ${input.item}`);
    }
    const entry: ChecklistEntry = {
      completed_at: new Date().toISOString(),
      actor: input.actor,
      evidence_ref: input.evidenceRef ?? null,
    };
    await client.query(
      `UPDATE ventures
          SET analysis_checklist = analysis_checklist || jsonb_build_object($2::text, $3::jsonb),
              updated_at = now()
        WHERE id = $1`,
      [row.id, input.item, JSON.stringify(entry)],
    );
    const completed = [...ANALYSIS_ITEMS.filter((i) => row.analysis_checklist?.[i]), input.item];
    return { eventId, completed };
  });
}

/**
 * Kill a venture from any non-terminal state -> 'archived' (Part V invariant:
 * kill is possible from any stage; pre-entity kills terminate to Archived).
 * Requires a non-empty post-mortem artifact reference — a kill without one is
 * rejected BEFORE the transaction, so nothing is modified and no event is
 * recorded. After archiving, no further transition of any kind is possible.
 */
export async function killVenture(
  client: Queryable,
  input: { ventureId: string; actor: string; reason: string; postMortemRef: string },
): Promise<{ from: VentureState; eventId: string }> {
  if (!input.postMortemRef?.trim()) {
    throw new Error("kill rejected: a non-empty post_mortem_ref is mandatory");
  }
  if (!input.reason?.trim()) {
    throw new Error("kill rejected: a non-empty reason is mandatory");
  }
  return inTransaction(client, async () => {
    const eventId = await logVentureEventTx(client, {
      actorId: input.actor,
      eventType: "venture.killed",
      ventureId: input.ventureId,
      payload: { reason: input.reason, post_mortem_ref: input.postMortemRef },
    });
    const row = await lockVenture(client, input.ventureId);
    if (row.state === "archived") {
      throw new Error(`venture ${row.id} is already archived`);
    }
    await client.query(
      `UPDATE ventures
          SET state = 'archived', post_mortem_ref = $2, archived_reason = $3,
              archived_at = now(), updated_at = now()
        WHERE id = $1`,
      [row.id, input.postMortemRef, input.reason],
    );
    return { from: row.state, eventId };
  });
}

/** Read one venture row (no lock). Returns null if it does not exist. */
export async function getVenture(client: Queryable, id: string): Promise<VentureRow | null> {
  const { rows } = await client.query<VentureRow>(
    `SELECT id, name, state, analysis_checklist, post_mortem_ref, archived_reason
       FROM ventures WHERE id = $1`,
    [id],
  );
  return rows.length ? rows[0] : null;
}
