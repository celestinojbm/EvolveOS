# Venture record + macro-state machine (stages 1–12)

**Status:** Phase 0 · Implements issue **[#8](https://github.com/celestinojbm/EvolveOS/issues/8)** (P0-7). The single venture record and the pre-entity slice of Part V's gated state machine — stages 1–12 as a linear enum, with the stage 5–9 analysis block as a checklist inside one macro-state, per [Buildability Audit](BUILDABILITY_AUDIT.md) §6(f). Stages 13–23 (G-07 onward: entity, operating tracks, growth, terminal states) are deliberately out of scope.

Canonical sources live in **one place each**: the states, the stage 1–12 mapping, the transition table (with its gates), and the five analysis items are declared in [`app/src/lib/venture.ts`](../app/src/lib/venture.ts); the DB backstop constraints in [`ops/migrations/0004_ventures.sql`](../ops/migrations/0004_ventures.sql). A test cross-checks every transition gate against the machine-readable [`schemas/data/gates.json`](../schemas/data/gates.json).

## The single venture record

One row per venture in `ventures` — identity, current macro-state, the analysis checklist, and archival fields. The row is a queryable **projection**; the append-only [event log](EVENT_LOG.md) is the audit source of truth, and every mutation records its event in the same transaction (the issue-#7 discipline).

| Column | Notes |
|---|---|
| `id` | `V-yyyy-seq` (DB CHECK on format); per-year sequence via `venture_counters`, assigned race-free under the event-chain advisory lock |
| `name` | display name |
| `state` | one of the nine states below (DB CHECK) |
| `analysis_checklist` | JSONB `{item: {completed_at, actor, evidence_ref}}`; keys restricted by CHECK to the five canonical items |
| `post_mortem_ref`, `archived_reason`, `archived_at` | kill-path fields; DB CHECKs force all three when `state='archived'` and none otherwise |
| `created_at`, `updated_at` | timestamps |

## States and the stage 1–12 mapping

| State | Part V stages | Entered via |
|---|---|---|
| `opportunity_discovery` | 1 — Opportunity Discovery | creation (standing entry; not a transition) |
| `trend_analysis` | 2 — Trend Analysis | **G-01** (Opportunity Intake) |
| `research` | 3 — Research | **G-01** — intra-envelope handoff (see below) |
| `validation` | 4 — Validation | **G-02** (Research Commit) |
| `analysis` | 5–9 — Customer Discovery, Competitive Analysis, Financial Modeling, Risk Analysis, Legal Analysis (checklist) | **G-03** (Validation Verdict) |
| `prototype` | 10 — Prototype | **G-04** (Prototype Commit; conjunctive — all five items required) |
| `mvp` | 11 — MVP | **G-05** (MVP Commit) |
| `pmf` | 12 — Product-Market Fit | **G-06** (Launch / GTM) |
| `archived` | terminal | **kill** from any non-terminal state |

The machine is strictly linear: one legal exit per state, no skips, no backward moves, no repeats. `pmf` has no outgoing advance — its next transition (G-07, venture formation) belongs to a later issue.

**The stage 2→3 handoff.** Part V Stage 2 defines Trend Analysis → Research as an *intra-envelope handoff inside the G-01 research grant* — there is no separate decision gate. Because the issue requires "state changes only via gate passes or kill", that transition **cites G-01** as its authorization: Appendix C itself defines G-01 as admitting to "Trend Analysis/Research" jointly, so the grant that authorizes stage 2 also authorizes stage 3. This is a mechanical reconciliation, not a rule change.

## Transition rules

`advanceStage` is the only way to move forward; `killVenture` the only way to terminate. Each validates, inside one serialized transaction:

- the venture exists and is not `archived`;
- the caller's `expectedFrom` equals the row's actual state (stale/concurrent attempts are rejected);
- the transition is the next legal one, and `gateId` is **exactly** that transition's gate;
- leaving `analysis` requires **all five** checklist items complete (G-04 is conjunctive per Part V Phase B);
- a non-empty `drRef` (the authorizing DR / grant reference), recorded in the event payload.

**Boundary with issue #9 (gate system v0):** the full gate-pass protocol — DR validated against `decision-record.schema.json`, pre-registered kill criteria, an approval event by a user holding the `approver` role, proposer≠approver — is P0-8/#9. Here the gate id is matched exactly and the authorization reference is required and recorded, so #9 can layer full validation on top without changing this module's shape.

## The analysis block (stages 5–9)

- One macro-state (`analysis`); five items: `customer_discovery`, `competitive_analysis`, `financial_modeling`, `risk_analysis`, `legal_analysis` — **all mandatory**.
- `completeAnalysisItem` files one item (actor + timestamp + optional evidence ref), only while the venture is in `analysis`; a duplicate completion is rejected (an output is filed once).
- Completing items **never changes the macro-state** — the block "completes" when all five outputs are filed, but exiting is only the G-04 pass (a separate, conjunctive decision).
- Every completion is audited as a `venture.analysis_item_completed` event (a filed analysis output is a real mutation of record).

## Kill path

From any non-terminal state, `killVenture` moves the venture to `archived` with a **mandatory non-empty `post_mortem_ref`**, a reason, and the acting user. A kill without a post-mortem reference is rejected *before* the transaction — nothing changes and no event is recorded. After archiving, every further transition (advance or second kill) is rejected. DB CHECKs backstop this: an `archived` row **must** carry post-mortem/reason/timestamp, and a live row must not.

## Transactions, locks, and concurrency

Same discipline and lock order as issue #7 — the event-chain advisory lock is the single serialization point, acquired first:

```
BEGIN → appendEventTx (advisory lock)            [provisional event]
      → SELECT ... FOR UPDATE on the venture row
      → validate (existence, state, gate, checklist)
      → UPDATE ventures
      → COMMIT          (any failure → ROLLBACK, provisional event undone)
```

(`createVenture` takes the advisory lock explicitly first — the id comes from the per-year counter — then appends; transaction-scoped advisory locks are reentrant.)

Consequences, all covered by tests against real Postgres with two connections:
- two concurrent advances from the same state: exactly one commits; the loser is rejected with a *stale state* error and leaves **no** event;
- advance vs kill: totally ordered — if the kill serializes first the advance is rejected; if the advance wins, the kill archives afterwards; `events.seq` reflects the order;
- two concurrent kills: one archives, one is rejected; exactly one `venture.killed` event;
- rollback tests: a failed event append leaves the state unchanged; a failed row UPDATE leaves no event.

## Events

All through `appendEventTx` (never a direct `events` write; `pnpm check:eventlog` covers this module too), with `object_type: "venture"`, `object_id: <venture id>`, details in `payload`:

| Event | When | Payload |
|---|---|---|
| `venture.created` | creation | `name`, initial `state` |
| `venture.stage_advanced` | gate pass | `from`, `to`, `gate_id`, `dr_ref`, `approval_ref` |
| `venture.analysis_item_completed` | checklist item filed | `item`, `evidence_ref` |
| `venture.killed` | kill → archived | `reason`, `post_mortem_ref` |

`event.schema.json` is unchanged; the pending decision on promoting `venture_id`/`reversibility_class` to event-log columns remains a separate issue.

## Running it

```bash
pnpm migrate     # applies ops/migrations/0004_ventures.sql
pnpm test        # vitest: model/pure, behavior, rollback, concurrency
pnpm verify:events
```

## Known limitations (deliberate)

- Stages 13–23 (G-07 onward), the operating tracks, and the orthogonal-region machinery are **not** modeled (audit §6(f): wait for stages 13–17).
- Gate passes cite but do not yet *validate* DR content, kill criteria, or approver roles — that is issue #9.
- Actor identity is recorded, not authenticated (see [AUTH](AUTH.md)).
- One venture at a time is the expected scale (pathfinder rule); the per-year id counter and the single advisory lock are deliberately simple.
