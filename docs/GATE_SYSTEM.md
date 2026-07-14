# Gate system v0 — registry as data + transition validation

**Status:** Phase 0 · Implements issue **[#9](https://github.com/celestinojbm/EvolveOS/issues/9)** (P0-8). The pass protocol for the pre-entity gates, enforcing Appendix C mechanics 1–2 (and the v0 forms of 3 and 5) with the audit-§5.4 auto-approval downgrade. [`app/src/lib/gates.ts`](../app/src/lib/gates.ts) is the **only public entry point for gate passes**.

## Canonical registry (and the JSON/YAML discrepancy)

The registry is **`schemas/data/gates.json`** — the machine-readable gate data generated from Appendix C (issue #4). The issue text says `schemas/gates.yaml`; that file never existed — issue #4 chose JSON over YAML to keep CI dependency-free, so the gate system loads the real registry. **No second registry is created**; gate metadata (name, section, kill-criteria requirement) is read from the JSON, never duplicated in TypeScript.

## Gates in scope, correctly classified

| Gates | Class | Effect of a pass |
|---|---|---|
| **G-01** | pipeline (entry) | **mints the venture** (`V-yyyy-seq`, born in `trend_analysis` — Part V §1.2) |
| **G-02…G-06** | pipeline | advance the venture one stage (transition derived from the state machine, never caller-supplied) |
| **G-17, G-18** | standing | **authorize a subject** (`subjectType`/`subjectId` required); never move a venture; `venture_id` optional |
| **G-00** | stop | **not passable**: it is an emergency-stop invocation. `passGate("G-00")` is rejected with a specific error pointing to the issue-#12 stop mechanism; no event is emitted |

The "exactly one `gate_passed` + state transition" acceptance criterion applies to **G-01…G-06**; G-17/G-18 produce authorization without a venture transition. Any other gate id is rejected: unknown ids (not in the registry) and known-but-unimplemented gates (G-07+) each get a specific error.

## The pass protocol (every implemented gate)

1. **Decision Record, validated in memory** against [`schemas/decision-record.schema.json`](../schemas/decision-record.schema.json) (ajv, draft 2020-12) plus semantics: `gate_id` equals the requested gate, `status: approved`, non-empty `proposer`, non-null/non-empty `approver`, `proposer ≠ approver`.
2. **Pre-registered kill criteria** (Appendix C mechanic 1): where the registry marks them mandatory (all pipeline gates), the DR must contain ≥ 1 **non-blank** criterion. Standing gates don't require them (registry says so) — none are invented.
3. **Approval evidence** (issue #7, no parallel approval system): an `approvalEventId` that resolves — inside the serialized transaction — to a real `approval.recorded` event, its linked `approvals` row, `object_type = 'decision-record'`, `object_id` = this DR's id, actors matching the DR's proposer/approver, distinct, and the approver **currently holding** the `approver` role (checked after the advisory lock, so a concurrent revoke either lands first and the pass fails, or lands after and the pass's `events.seq` precedes it — never a pass after an effective revocation).
4. **A3 → A1 downgrade (audit §5.4):** Appendix C grants G-01/G-02 agent auto-approval; the MVP downgrades them to A1 — they require exactly the same human approval evidence as every other gate. **Appendix C and `gates.json` are not modified**; this is a documented build-time policy.

## Exactly one `gate_passed`

A successful pass produces **one** `gate_passed` event — the event *is* both the authorization and the effect. Since issue #9 there is **no** `venture.created` and **no** `venture.stage_advanced`: G-01's single event records `effect: venture_created` (with `from_state: null` — pre-venture is an opportunity KI, not a state — `to_state: trend_analysis`, `opportunity_ref`); G-02…G-06's single event records `effect: stage_advanced` with real `from_state`/`to_state`. Payload always carries `gate_id`, `gate_name`, `dr_id`, `approval_event_id`, `proposer_actor_id`, `approver_actor_id`, `kill_criteria`, `transition_kind`, `venture_id`. Non-gate events are unchanged: `venture.stage_handoff` (the 2→3 handoff), `venture.analysis_item_completed`, `venture.killed`.

## Integration with the venture machine

`venture.ts` keeps the canonical state model and now exposes **internal transaction primitives** — `mintVentureAtG01Tx`, `advanceVentureForGateTx` — that open no transaction, take no lock, and emit no events; they validate against the machine (next legal transition from the row's **actual** state, exact gate, five-artifact rule for G-04) and return the effect. `gates.ts` is their only production caller: **`ops/check-gate-bypass.mjs`** (CI, `pnpm check:gates`) fails if any other production file references them or writes `gate_passes`. There is no production API that creates a formal venture or advances a stage without the full gate protocol.

## The transaction (one, atomic, issue-#7 lock order)

```
BEGIN → acquireEventChainLock (advisory lock FIRST)
      → validate approval evidence + live approver role
      → mint venture (G-01) / lock venture row FOR UPDATE + apply advance (G-02..06)
      → appendEventTx exactly once: gate_passed
      → INSERT gate_passes
      → COMMIT     (any failure → ROLLBACK: no venture, no state change, no event, no projection)
```

Registry, DR, and spend checks are pure and run before the transaction. Nothing partial can persist: tests inject failures at the event INSERT, the projection INSERT, the venture UPDATE, and the G-01 venture INSERT, and assert zero leftovers each time.

## Idempotence and the `gate_passes` projection

[`ops/migrations/0005_gate_passes.sql`](../ops/migrations/0005_gate_passes.sql): one row per pass, written only by `gates.ts` in the pass transaction. `dr_id UNIQUE` means **a DR executes at most once** — the v0 form of Appendix C mechanic 5 ("no gate shopping"); reuse fails with a specific error, and this also collapses concurrent duplicate passes (same DR) to exactly one. `gate_event_id UNIQUE + FK` keeps the projection 1:1 with real `gate_passed` events; `approval_event_id FK` keeps evidence real; a CHECK requires a venture (pipeline) or a non-empty subject (standing); `proposer ≠ approver` is re-checked at the DB layer.

## Appendix C mechanics — v0 scope

- **1 (pre-registration)** — enforced (kill criteria before the pass, where mandatory).
- **2 (evidence)** — enforced (full DR + linked approval evidence).
- **3 (queueing)** — no real queue: any `requestedSpend ≠ 0` is rejected with a specific *"requires manual queue (A1)"* error, because envelopes are unratified (ADR-006) and v0 executes no spend.
- **5 (no gate shopping)** — DR reuse blocked (`dr_id UNIQUE`). Full resubmission validation (a diff against the rejected DR with materially new evidence) needs the issue-#10 DR store and is **deferred** — nothing pretends to validate new evidence.

## Boundaries (documented limits)

- **Issue #10 (DR tooling):** the DR is supplied and validated **in memory** here. #10 adds persistence, immutability, `DR-yyyy-seq` issuance, and lookup by reference; the integration will replace the direct input with a load **without changing this protocol**. #10 must also integrate the G-01 pass with venture creation as it already is here: one atomic operation, one `gate_passed`.
- **Issue #12 (G-00):** the stop mechanism. v0 only recognizes G-00 and refuses to "pass" it.
- No dashboard/UI/API, no agents, no external communications or data execution (G-17/G-18 record authorization only), no real money, no real queue.

## What it guarantees / does NOT guarantee

**Guarantees:** no gate pass without a schema-valid approved DR, pre-registered kill criteria (where mandatory), real linked human approval by a live approver, and role separation; exactly one `gate_passed` + one projection row per pass, atomic with the venture effect; a DR never executes twice; no production bypass of the gated paths (CI-enforced).

**Does NOT guarantee:** DR authenticity/immutability (in-memory input until #10); actor authentication (recorded, not verified — see [AUTH](AUTH.md)); envelope/spend enforcement (rejected wholesale until ratification); resubmission-diff validation (#10); anything about gates G-07+.

## Running it

```bash
pnpm migrate        # applies 0005_gate_passes.sql
pnpm check:gates    # CI guard: no gate-system bypass
pnpm test           # vitest: 20 requirement-failure cases, full path, atomicity, concurrency
pnpm verify:events
```
