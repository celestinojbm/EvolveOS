# Venture record + macro-state machine (stages 1–12)

**Status:** Phase 0 · Implements issue **[#8](https://github.com/celestinojbm/EvolveOS/issues/8)** (P0-7). The single venture record and the pre-entity slice of Part V's gated state machine — stages 1–12 as a linear enum, with the stage 5–9 analysis block as a checklist inside one macro-state, per [Buildability Audit](BUILDABILITY_AUDIT.md) §6(f). Stages 13–23 (G-07 onward: entity, operating tracks, growth, terminal states) are deliberately out of scope.

Canonical sources live in **one place each**: the states, the stage 1–12 mapping, the typed transition table (with its gates), and the five analysis items are declared in [`app/src/lib/venture.ts`](../app/src/lib/venture.ts); the DB backstop constraints in [`ops/migrations/0004_ventures.sql`](../ops/migrations/0004_ventures.sql). Tests cross-check every transition **semantically** against the machine-readable [`schemas/data/gates.json`](../schemas/data/gates.json) (gate id, name, and Appendix C transition text — not just id existence).

## Venture birth: ids are minted at G-01 (Part V §1.2)

> "Venture IDs are minted at G-01 pass. Pre-G-01 opportunity briefs are not ventures; they are knowledge items (Part VI) in the opportunity backlog."

**Stage 1 (Opportunity Discovery) is pre-venture:** no `ventures` row, no `V-…` id — the opportunity lives as a knowledge item in the backlog (no KI store is built in this issue; the external reference is required and recorded). Since issue #9, the G-01 pass is executed by **`passG01CreateVenture` in [`gates.ts`](../app/src/lib/gates.ts)** — the single atomic operation that validates the full gate protocol AND mints the venture (see [GATE_SYSTEM](GATE_SYSTEM.md)). It:

- requires a non-empty `opportunityRef` (the pre-G-01 opportunity brief / KI) and a non-empty `drRef` (the G-01 authorization / DR);
- mints `V-yyyy-seq` (per-year counter, race-free under the event-chain advisory lock);
- creates the row directly in **`trend_analysis`** (stage 2 — the first persisted state);
- records exactly **one `gate_passed` event** (`effect: venture_created`, `from_state: null`, `to_state: trend_analysis`, `opportunity_ref`, `dr_id`) — there is no separate `venture.created` event since issue #9;
- stores both references on the row (`opportunity_ref`, `entry_dr_ref` — both `NOT NULL` + non-empty CHECKs).

## The single venture record

One row per venture in `ventures` — identity, birth references, current macro-state, the analysis checklist, and archival fields. The row is a queryable **projection**; the append-only [event log](EVENT_LOG.md) is the audit source of truth, and every mutation records its event in the same transaction (the issue-#7 discipline).

| Column | Notes |
|---|---|
| `id` | `V-yyyy-seq` (DB CHECK on format) |
| `name` | display name |
| `state` | one of the eight states below (DB CHECK — `opportunity_discovery` is not among them) |
| `opportunity_ref` | the pre-G-01 opportunity brief / KI the venture was minted from (`NOT NULL`, non-empty CHECK) |
| `entry_dr_ref` | the G-01 authorization that minted it (`NOT NULL`, non-empty CHECK) |
| `analysis_checklist` | JSONB `{item: {completed_at, actor, evidence_ref}}`; keys restricted by CHECK to the five items, and **every entry must carry a non-empty `evidence_ref`** (immutable-function CHECK) |
| `post_mortem_ref`, `archived_reason`, `archived_at` | kill-path fields; DB CHECKs force all three when `state='archived'` and none otherwise |
| `created_at`, `updated_at` | timestamps |

## States and the stage 1–12 mapping

| State | Part V stages | Entered via |
|---|---|---|
| *(none — pre-venture)* | 1 — Opportunity Discovery | n/a: a KI in the opportunity backlog, not a venture |
| `trend_analysis` | 2 — Trend Analysis | **G-01 pass = venture creation** (Opportunity Intake) |
| `research` | 3 — Research | **handoff** riding the original G-01 grant (see below) |
| `validation` | 4 — Validation | **G-02** (Research Commit) |
| `analysis` | 5–9 — Customer Discovery, Competitive Analysis, Financial Modeling, Risk Analysis, Legal Analysis (checklist) | **G-03** (Validation Verdict) |
| `prototype` | 10 — Prototype | **G-04** (Prototype Commit; conjunctive — five filed artifacts required) |
| `mvp` | 11 — MVP | **G-05** (MVP Commit) |
| `pmf` | 12 — Product-Market Fit | **G-06** (Launch / GTM) |
| `archived` | terminal | **kill** from any non-terminal state |

The machine is strictly linear: one legal exit per state, no skips, no backward moves, no repeats. `pmf` has no outgoing advance — its next transition (G-07, venture formation) belongs to a later issue.

## Transition kinds: gate pass vs handoff

The transition table is **typed** (`kind: "gate_pass" | "handoff"`), and exactly one transition is a handoff:

- **`trend_analysis → research` is an intra-envelope handoff, not a second gate pass.** Part V Stage 2: "Trend Analysis → Research is an intra-envelope handoff inside the G-01 research grant"; Appendix C's G-01 admits to "Trend Analysis/Research" jointly. It is executed by **`handoffStage`**, which takes **no gate and no DR** — by construction the caller cannot present a gate for it. It reuses the venture's stored G-01 authorization (`entry_dr_ref`) and records a distinct **`venture.stage_handoff`** event with `transition_kind: "handoff"`, `authorization_gate_id: "G-01"`, and `authorization_ref: <the original G-01 reference>`. No new `gate_passed`-style record, no new approval, no new DR.
- Every other advance is a **gate pass** via `advanceStage`, which rejects handoff transitions (and vice versa: `handoffStage` rejects gate-pass transitions).

`advanceStage` validates, inside one serialized transaction: the venture exists and is not `archived`; the caller's `expectedFrom` equals the row's actual state; the transition is the next legal one **of kind `gate_pass`**; `gateId` is **exactly** that transition's gate; leaving `analysis` requires all five artifacts (below); and a non-empty `drRef`, recorded in the event payload.

**Gate protocol (issue #9, implemented):** the full gate-pass protocol — DR validated against `decision-record.schema.json`, pre-registered kill criteria, approval evidence by a user holding the `approver` role, proposer≠approver — is enforced by `gates.ts` on every pass. See [GATE_SYSTEM](GATE_SYSTEM.md).

## The analysis block (stages 5–9): real artifacts, not checkmarks

- One macro-state (`analysis`); five items: `customer_discovery`, `competitive_analysis`, `financial_modeling`, `risk_analysis`, `legal_analysis` — **all mandatory**.
- `completeAnalysisItem` files one item's **output**: it requires a **non-empty `evidenceRef`** (the artifact reference G-04's "full analysis pack" is made of). An empty/whitespace reference is rejected before the transaction — no event, no change. The reference is recorded in the `venture.analysis_item_completed` event and in the row.
- Only while the venture is in `analysis`; a duplicate completion is rejected (an output is filed once).
- Completing items **never changes the macro-state** — exit is only the conjunctive G-04 pass, which re-checks that **all five entries exist and each carries a non-empty artifact reference**.
- DB backstop: an immutable-function CHECK makes a checklist entry without a non-empty `evidence_ref` impossible even for a direct write.

## Kill path

From any non-terminal state, `killVenture` moves the venture to `archived` with a **mandatory non-empty `post_mortem_ref`**, a reason, and the acting user. A kill without a post-mortem reference is rejected *before* the transaction — nothing changes and no event is recorded. After archiving, every further transition (advance, handoff, or second kill) is rejected. DB CHECKs backstop this in both directions.

## Transactions, locks, and concurrency

Same discipline and lock order as issue #7 — the event-chain advisory lock is the single serialization point, acquired first:

```
BEGIN → advisory lock (appendEventTx, or explicitly when row data feeds the event)
      → SELECT ... FOR UPDATE on the venture row
      → validate (existence, state, kind, gate, artifacts)
      → UPDATE ventures / INSERT venture + event
      → COMMIT          (any failure → ROLLBACK, provisional event undone)
```

`createVenture` and `handoffStage` take the advisory lock explicitly first (the id counter / the stored G-01 reference feed the event payload), then append — transaction-scoped advisory locks are reentrant, so the order stays advisory → row everywhere.

Covered by tests against real Postgres with two connections: two concurrent gate passes → exactly one commits (loser: *stale state*, no event); two concurrent handoffs → one wins, one `venture.stage_handoff` event; advance vs kill → totally ordered via `events.seq`, never an advance after an effective kill; two kills → one archives; rollback tests for a failed event append (gate pass and handoff), a failed row UPDATE, and a failed venture INSERT at creation.

## Events

All through `appendEventTx` (never a direct `events` write), with `object_type: "venture"`, `object_id: <venture id>`, details in `payload`:

| Event | When | Payload |
|---|---|---|
| `gate_passed` | G-01 mint and every G-02…G-06 advance (emitted by `gates.ts`; replaces the pre-#9 `venture.created` / `venture.stage_advanced`) | `gate_id`, `gate_name`, `dr_id`, `approval_event_id`, actors, `kill_criteria`, `transition_kind: "gate_pass"`, `from_state`, `to_state`, `venture_id`, `effect` |
| `venture.stage_handoff` | the 2→3 intra-envelope handoff | `from`, `to`, `transition_kind: "handoff"`, `authorization_gate_id: "G-01"`, `authorization_ref` (the original G-01 reference) |
| `venture.analysis_item_completed` | checklist artifact filed | `item`, `evidence_ref` (non-empty) |
| `venture.killed` | kill → archived | `reason`, `post_mortem_ref` |

`event.schema.json` is unchanged; the pending decision on promoting `venture_id`/`reversibility_class` to event-log columns remains a separate issue.

## Running it

```bash
pnpm migrate     # applies ops/migrations/0004_ventures.sql
pnpm test        # vitest: model/semantic gate mapping, behavior, rollback, concurrency
pnpm verify:events
```

## Known limitations (deliberate)

- Stages 13–23 (G-07 onward), the operating tracks, and the orthogonal-region machinery are **not** modeled (audit §6(f): wait for stages 13–17).
- The opportunity backlog / KI store behind `opportunity_ref` is Part VI tooling (a later issue); DR persistence/immutability is issue #10.
- Actor identity is recorded, not authenticated (see [AUTH](AUTH.md)).
- One venture at a time is the expected scale (pathfinder rule); the per-year id counter and the single advisory lock are deliberately simple.
