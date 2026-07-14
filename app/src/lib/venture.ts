/**
 * EvolveOS venture record + macro-state machine, stages 1-12 (issue #8, P0-7).
 *
 * Part V models the lifecycle as a gated state machine; per BUILDABILITY_AUDIT
 * §6(f) the MVP models stages 1-12 as a linear enum with the stage 5-9 analysis
 * block as a checklist inside the single macro-state 'analysis'. Stages 13+
 * (G-07 onward) are out of scope here.
 *
 * VENTURE BIRTH (Part V §1.2): "Venture IDs are minted at G-01 pass. Pre-G-01
 * opportunity briefs are not ventures; they are knowledge items in the
 * opportunity backlog." Therefore stage 1 (Opportunity Discovery) is
 * PRE-VENTURE: it has no `ventures` row and no V- id. `createVenture` IS the
 * G-01 pass: it requires a non-empty reference to the opportunity brief/KI and
 * the G-01 authorization (DR) reference, mints `V-yyyy-seq`, and creates the
 * row directly in 'trend_analysis' (stage 2). No opportunity-backlog/KI store
 * is built here — the external reference is required and recorded.
 *
 * CANONICAL SOURCES in this module (do not spread this logic elsewhere):
 *   - VENTURE_STATES: the allowed persisted states, in order.
 *   - ENTRY_GATE / ENTRY_STATE: the birth gate (G-01) and birth state.
 *   - STAGE_MAP: original Part V stages 1-12 -> state (stage 1 -> null:
 *     pre-venture).
 *   - TRANSITIONS: the only legal advances, each typed as 'gate_pass' (a new
 *     gate decision) or 'handoff' (intra-envelope, no new gate pass), with the
 *     Appendix C gate that authorizes it.
 *   - ANALYSIS_ITEMS: the five mandatory stage 5-9 checklist items.
 *
 * TRANSITION KINDS: Trend Analysis -> Research is an "intra-envelope handoff
 * inside the G-01 research grant" (Part V Stage 2) — NOT a second gate pass.
 * It is executed by `handoffStage`, which takes no gate and no DR: it reuses
 * the venture's stored G-01 authorization (`entry_dr_ref`) and records a
 * distinct `venture.stage_handoff` event. `advanceStage` only accepts
 * 'gate_pass' transitions, so a caller cannot present an arbitrary gate for
 * the handoff.
 *
 * State changes happen ONLY through `advanceStage` (gate pass), `handoffStage`
 * (the 2->3 handoff), or `killVenture` (kill-from-any-stage -> archived,
 * mandatory post-mortem reference). All run the issue-#7 discipline: one
 * transaction, event-chain advisory lock FIRST, then `SELECT ... FOR UPDATE`
 * on the venture row, validate, update, COMMIT — any failure rolls back the
 * provisional event, so no event persists for a rejected mutation and no row
 * changes without its event.
 *
 * Boundary with issue #9 (P0-8, gate system v0): the full gate-pass protocol —
 * DR validated against its schema, pre-registered kill criteria, an approval
 * event by a user holding the approver role, proposer≠approver — belongs to
 * #9. Here a gate pass must cite the EXACT gate for the transition plus a
 * non-empty authorization reference (`drRef`), recorded in the event payload
 * for #9 to validate. Documented in docs/VENTURE_STATE_MACHINE.md.
 */
import { randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEventTx, acquireEventChainLock } from "./eventlog.js";

type Queryable = Client | PoolClient;

// --- Canonical state model ---------------------------------------------------

export const VENTURE_STATES = [
  "trend_analysis", // stage 2 — birth state, minted at G-01 pass
  "research", //        stage 3
  "validation", //      stage 4
  "analysis", //        stages 5-9 (checklist block)
  "prototype", //       stage 10
  "mvp", //             stage 11
  "pmf", //             stage 12 (Product-Market Fit)
  "archived", //        terminal (pre-entity kill target)
] as const;
export type VentureState = (typeof VENTURE_STATES)[number];

/** The gate whose pass mints a venture (Part V §1.2), and the birth state. */
export const ENTRY_GATE = "G-01";
export const ENTRY_STATE: VentureState = "trend_analysis";

/**
 * Original Part V stages 1-12 -> the persisted state that carries them.
 * Stage 1 maps to null: pre-G-01 opportunity briefs are knowledge items in the
 * opportunity backlog, NOT ventures — no row, no V- id.
 */
export const STAGE_MAP: Readonly<Record<number, { name: string; state: VentureState | null }>> = {
  1: { name: "Opportunity Discovery", state: null }, // pre-venture (KI backlog)
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

export type TransitionKind = "gate_pass" | "handoff";

export interface Transition {
  from: VentureState;
  to: VentureState;
  kind: TransitionKind;
  /** For gate_pass: the gate decided anew. For handoff: the already-held grant. */
  gate: string;
  note?: string;
}

/**
 * The only legal advances (linear; no skips, no backward moves). Gates are the
 * Appendix C ids exactly (see schemas/data/gates.json). Exactly one transition
 * is a handoff: 2->3 rides the G-01 grant already held since venture birth.
 */
export const TRANSITIONS: readonly Transition[] = [
  {
    from: "trend_analysis",
    to: "research",
    kind: "handoff",
    gate: "G-01",
    note: "intra-envelope handoff inside the G-01 research grant (Part V Stage 2) — no new gate pass; reuses the venture's stored G-01 authorization",
  },
  { from: "research", to: "validation", kind: "gate_pass", gate: "G-02" },
  { from: "validation", to: "analysis", kind: "gate_pass", gate: "G-03" },
  {
    from: "analysis",
    to: "prototype",
    kind: "gate_pass",
    gate: "G-04",
    note: "conjunctive block gate: requires all five analysis items complete, each with a non-empty artifact reference",
  },
  { from: "prototype", to: "mvp", kind: "gate_pass", gate: "G-05" },
  { from: "mvp", to: "pmf", kind: "gate_pass", gate: "G-06" },
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
  /** Reference to the filed analysis artifact/output. Always non-empty. */
  evidence_ref: string;
}

export interface VentureRow {
  id: string;
  name: string;
  state: VentureState;
  opportunity_ref: string;
  entry_dr_ref: string;
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
    `SELECT id, name, state, opportunity_ref, entry_dr_ref, analysis_checklist,
            post_mortem_ref, archived_reason
       FROM ventures WHERE id = $1 FOR UPDATE`,
    [ventureId],
  );
  if (!rows.length) throw new Error(`venture not found: ${ventureId}`);
  return rows[0];
}

function requireNonEmpty(value: string | undefined | null, what: string): string {
  const v = value?.trim();
  if (!v) throw new Error(`${what} must be a non-empty reference`);
  return v;
}

// --- Public API -----------------------------------------------------------------

/**
 * Create a venture AT G-01 PASS (Part V §1.2: venture ids are minted at G-01;
 * before that, the opportunity is a knowledge item, not a venture). Requires a
 * non-empty `opportunityRef` (the pre-G-01 opportunity brief / KI) and a
 * non-empty `drRef` (the G-01 authorization / DR — full protocol validation is
 * issue #9). Mints `V-yyyy-seq` race-free under the event-chain advisory lock
 * and creates the row directly in 'trend_analysis' (stage 2).
 */
export async function createVenture(
  client: Queryable,
  input: {
    name: string;
    actor: string;
    opportunityRef: string;
    drRef: string;
    year?: number;
  },
): Promise<{ id: string; state: VentureState; eventId: string }> {
  if (!input.name.trim()) throw new Error("venture name must be non-empty");
  const opportunityRef = requireNonEmpty(input.opportunityRef, "opportunityRef (opportunity brief / KI)");
  const drRef = requireNonEmpty(input.drRef, "drRef (G-01 authorization)");
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
    await client.query(
      `INSERT INTO ventures (id, name, state, opportunity_ref, entry_dr_ref)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.name, ENTRY_STATE, opportunityRef, drRef],
    );
    const eventId = await logVentureEventTx(client, {
      actorId: input.actor,
      eventType: "venture.created",
      ventureId: id,
      payload: {
        name: input.name,
        state: ENTRY_STATE,
        entry_gate_id: ENTRY_GATE,
        opportunity_ref: opportunityRef,
        dr_ref: drRef,
      },
    });
    return { id, state: ENTRY_STATE, eventId };
  });
}

/**
 * Advance a venture one stage via a GATE PASS. Only 'gate_pass' transitions
 * are accepted — the 2->3 handoff must go through `handoffStage`. Validates,
 * inside the serialized transaction: the venture exists; it is not archived;
 * its actual state equals `expectedFrom`; that state has a next legal
 * transition of kind 'gate_pass'; `gateId` is EXACTLY that transition's gate;
 * and, when leaving 'analysis', that all five checklist items are complete,
 * each with a non-empty artifact reference. `drRef` (the authorizing DR) is
 * required and recorded; full DR/approval validation is issue #9.
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
    throw new Error("authorization required: drRef (DR reference) must be non-empty");
  }
  const t = TRANSITIONS.find((x) => x.from === input.expectedFrom);
  if (!t) {
    throw new Error(
      `no legal transition from '${input.expectedFrom}'` +
        (TERMINAL_STATES.includes(input.expectedFrom) ? " (terminal state)" : ""),
    );
  }
  if (t.kind === "handoff") {
    throw new Error(
      `transition ${t.from} -> ${t.to} is an intra-envelope handoff, not a gate pass — use handoffStage()`,
    );
  }
  if (t.gate !== input.gateId) {
    throw new Error(
      `wrong gate: transition ${t.from} -> ${t.to} requires ${t.gate}, got ${input.gateId}`,
    );
  }
  return inTransaction(client, async () => {
    // Provisional event first (advisory lock = first lock, consistent order).
    // Rolled back if any validation below fails.
    const eventId = await logVentureEventTx(client, {
      actorId: input.actor,
      eventType: "venture.stage_advanced",
      ventureId: input.ventureId,
      payload: {
        from: t.from,
        to: t.to,
        transition_kind: "gate_pass",
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
      const missing = ANALYSIS_ITEMS.filter(
        (i) => !row.analysis_checklist?.[i]?.evidence_ref?.trim(),
      );
      if (missing.length) {
        throw new Error(
          `analysis block incomplete: missing filed artifact for ${missing.join(", ")} — ` +
            "G-04 is conjunctive (all five outputs required)",
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
 * Execute the intra-envelope HANDOFF (Trend Analysis -> Research, Part V Stage
 * 2). This is not a gate pass: it takes no gate and no DR — it reuses the
 * G-01 authorization stored on the venture at birth, and records a distinct
 * `venture.stage_handoff` event citing that original grant. The caller cannot
 * supply a gate here by construction.
 */
export async function handoffStage(
  client: Queryable,
  input: { ventureId: string; expectedFrom: VentureState; actor: string },
): Promise<{ from: VentureState; to: VentureState; eventId: string }> {
  const t = TRANSITIONS.find((x) => x.from === input.expectedFrom);
  if (!t) {
    throw new Error(`no legal transition from '${input.expectedFrom}'`);
  }
  if (t.kind !== "handoff") {
    throw new Error(
      `transition ${t.from} -> ${t.to} is a gate pass (${t.gate}), not a handoff — use advanceStage()`,
    );
  }
  return inTransaction(client, async () => {
    // Advisory lock first (consistent order); the event payload needs the
    // stored G-01 authorization, so lock and read the row before appending.
    await acquireEventChainLock(client);
    const row = await lockVenture(client, input.ventureId);
    if (row.state === "archived") {
      throw new Error(`venture ${row.id} is archived; no further transitions are possible`);
    }
    if (row.state !== input.expectedFrom) {
      throw new Error(
        `stale state: expected '${input.expectedFrom}' but venture is in '${row.state}'`,
      );
    }
    const eventId = await logVentureEventTx(client, {
      actorId: input.actor,
      eventType: "venture.stage_handoff",
      ventureId: row.id,
      payload: {
        from: t.from,
        to: t.to,
        transition_kind: "handoff",
        authorization_gate_id: t.gate, // the grant it rides: G-01
        authorization_ref: row.entry_dr_ref, // the ORIGINAL G-01 authorization
      },
    });
    await client.query("UPDATE ventures SET state = $2, updated_at = now() WHERE id = $1", [
      row.id,
      t.to,
    ]);
    return { from: t.from, to: t.to, eventId };
  });
}

/**
 * File one stage 5-9 analysis item's output. Requires a NON-EMPTY artifact
 * reference (`evidenceRef`) — the analysis pack G-04 consumes is made of real
 * outputs, not bare checkmarks. Allowed only while the venture is in
 * 'analysis'; a duplicate completion is rejected (an output is filed once).
 * Filing items NEVER changes the macro-state — exiting the block is only the
 * conjunctive G-04 pass.
 */
export async function completeAnalysisItem(
  client: Queryable,
  input: { ventureId: string; item: AnalysisItem; actor: string; evidenceRef: string },
): Promise<{ eventId: string; completed: AnalysisItem[] }> {
  if (!(ANALYSIS_ITEMS as readonly string[]).includes(input.item)) {
    throw new Error(`unknown analysis item: ${input.item}`);
  }
  const evidenceRef = requireNonEmpty(input.evidenceRef, "evidenceRef (analysis artifact)");
  return inTransaction(client, async () => {
    const eventId = await logVentureEventTx(client, {
      actorId: input.actor,
      eventType: "venture.analysis_item_completed",
      ventureId: input.ventureId,
      payload: { item: input.item, evidence_ref: evidenceRef },
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
      evidence_ref: evidenceRef,
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
    `SELECT id, name, state, opportunity_ref, entry_dr_ref, analysis_checklist,
            post_mortem_ref, archived_reason
       FROM ventures WHERE id = $1`,
    [id],
  );
  return rows.length ? rows[0] : null;
}
