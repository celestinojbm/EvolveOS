# Gate system v0 — registry as data + transition validation

**Status:** Phase 0 · Implements issue **[#9](https://github.com/celestinojbm/EvolveOS/issues/9)** (P0-8). The pass protocol for the pre-entity gates, enforcing Appendix C mechanics 1–2 (and the v0 forms of 3 and 5) with the audit-§5.4 auto-approval downgrade. [`app/src/lib/gates.ts`](../app/src/lib/gates.ts) is the **only public entry point for gate passes**.

## Canonical registry (and the JSON/YAML discrepancy)

The registry is **`schemas/data/gates.json`** — the machine-readable gate data generated from Appendix C (issue #4). The issue text says `schemas/gates.yaml`; that file never existed — issue #4 chose JSON over YAML to keep CI dependency-free, so the gate system loads the real registry. **No second registry is created**; gate metadata (name, section, kill-criteria requirement) is read from the JSON, never duplicated in TypeScript.

**Immutable at runtime.** The registry is the single source of truth for gate classification, so a live process must not be able to re-classify a gate. Each `GateMeta` is **frozen** (`Object.freeze`) at load and its fields are `readonly`; the backing `Map` is a module-private `const` that is never exposed by reference; `gateMeta()` returns the frozen entry (mutating `gateMeta("G-05").reversibility_class` throws under ESM strict mode and cannot reach the map); and `PIPELINE_GATES` / `STANDING_GATES` are `Object.freeze`d — a gate cannot be **added, removed, or replaced** at runtime. Tests assert that a reclassification attempt leaves G-05 at R3, that G-08 cannot be pushed into the pipeline list (and stays rejected as not-implemented), and that G-01 stays classified as the pipeline entry gate.

## Gates in scope, correctly classified

| Gates | Class | Effect of a pass |
|---|---|---|
| **G-01** | pipeline (entry) | **mints the venture** (`V-yyyy-seq`, born in `trend_analysis` — Part V §1.2) |
| **G-02…G-06** | pipeline | advance the venture one stage (transition derived from the state machine, never caller-supplied) |
| **G-17, G-18** | standing | **authorize a subject** (`subjectType`/`subjectId` required); never move a venture; `venture_id` optional |
| **G-00** | stop | **not passable**: it is an emergency-stop invocation. `passGate("G-00")` is rejected with a specific error pointing to the issue-#12 stop mechanism; no event is emitted |

The "exactly one `gate_passed` + state transition" acceptance criterion applies to **G-01…G-06**; G-17/G-18 produce authorization without a venture transition. Any other gate id is rejected: unknown ids (not in the registry) and known-but-unimplemented gates (G-07+) each get a specific error.

## The pass protocol (every implemented gate)

0. **Whole-request snapshot before the first `await`.** Every public pass function (`passG01CreateVenture`, `passPipelineGate`, `passStandingGate`, and the `passGate` dispatcher) reads **each request field exactly once, synchronously**, into a frozen local snapshot *before* it opens the transaction, then never touches the caller's `input` again — validation, mutation, event, projection, and the returned result all read the snapshot. This closes the mutable-request TOCTOU for the **whole request**: mutating `ventureId`, `approvalEventId`, `actor`, `gateId`, `decisionRecordId`, `name`, `opportunityRef`, `year`, `subjectType`, or `subjectId` after the call cannot change which venture advances, which DR is loaded, which approval is checked, or what is recorded. Required auditable identifiers are validated non-empty and captured **verbatim** (an id is never silently rewritten). Tests prove immunity: a decoy venture B stays put while A advances, a bogus `approvalEventId` set after the call is ignored, and the recorded actor/subject/opportunity-ref are the originals.
1. **Decision Record — a FILED, immutable reference (issue #10).** Since issue #10 a pass takes a **`decisionRecordId`**, never a caller-supplied document. Inside the transaction the gate **loads the filed DR** from the immutable store ([`dr.getDecisionRecord`](../app/src/lib/dr.ts), which recomputes the digest from the stored canonical bytes and rejects corruption), then applies only the **gate-specific** semantics: `gate_id` equals the requested gate, `status: approved`, non-empty `proposer`, non-null/non-empty `approver`, `proposer ≠ approver`, and the **canonical reversibility class** (`dr.reversibility_class` must equal the gate's `reversibility_class` from `gates.json` — e.g. *"gate G-05 requires R3, DR declares R2"* is a specific error). The **content primitives** — canonical key-sorted JSON, deep clone, schema validation, and the **SHA-256 digest** — live in `dr.ts` (the single canonicalization owner) and are imported, so the gate binds to exactly the bytes `dr.ts` filed. See [DECISION_RECORDS](DECISION_RECORDS.md).
2. **Pre-registered kill criteria** (Appendix C mechanic 1): where the registry marks them mandatory (all pipeline gates), the DR must contain ≥ 1 **non-blank** criterion. The gate registry itself does not demand kill criteria for standing gates — but since issue #10, filing enforces Part VII §2.2 (kill criteria + rollback are mandatory for every **R2+** DR), and G-17/G-18 are R3, so a *filable* standing DR now carries them regardless.
3. **Approval evidence bound to the exact content** (issue #7 reused, no parallel system): approving a decision-record requires the **document digest** — `recordApproval` records `payload.object_digest` (SHA-256 of the canonical DR) in the append-only `approval.recorded` event, immutably binding the approval to the DR's id, its **full content**, the proposer, and the approver. `recordApproval` snapshots its own request before its first `await` and **validates the digest format** — a decision-record digest must be a canonical **64-char SHA-256 hex string (`[0-9a-f]`)**; missing, mis-length, non-hex, or uppercase digests are rejected up front, so a malformed digest can never be recorded as if it bound the content. At pass time `validateApprovalTx` verifies the **event itself** — `event_type`, `actor_id === dr.approver`, `object_type`/`object_id`, `payload.proposer_actor_id === dr.proposer`, and `payload.object_digest === <digest of the submitted snapshot>`. Because `object_digest` is untyped JSONB, the check **guards the type first** (`typeof === "string"` + SHA-256 shape) before calling any string method, so a forged event carrying a number, object, or malformed digest is rejected cleanly (never a `TypeError`). It then checks the linked `approvals` row (object, actors, separation) and the approver **currently holding** the `approver` role (checked after the advisory lock, so a concurrent revoke either lands first and the pass fails, or lands after and the pass's `events.seq` precedes it — never a pass after an effective revocation). The event is the primary immutable evidence; the row is the queryable projection. A DR mutated after approval — even keeping its id and actors — fails with an *approval digest mismatch* and zero effects.
4. **A3 → A1 downgrade (audit §5.4):** Appendix C grants G-01/G-02 agent auto-approval; the MVP downgrades them to A1 — they require exactly the same human approval evidence as every other gate. **Appendix C and `gates.json` are not modified**; this is a documented build-time policy.

## Exactly one `gate_passed`

A successful pass produces **one** `gate_passed` event — the event *is* both the authorization and the effect. Since issue #9 there is **no** `venture.created` and **no** `venture.stage_advanced`: G-01's single event records `effect: venture_created` (with `from_state: null` — pre-venture is an opportunity KI, not a state — `to_state: trend_analysis`, `opportunity_ref`); G-02…G-06's single event records `effect: stage_advanced` with real `from_state`/`to_state`. Payload always carries `gate_id`, `gate_name`, `dr_id`, `dr_digest` (the approved content hash), `reversibility_class` (validated against the registry), `approval_event_id`, `proposer_actor_id`, `approver_actor_id`, `kill_criteria`, `transition_kind`, `venture_id`. Non-gate events are unchanged: `venture.stage_handoff` (the 2→3 handoff), `venture.analysis_item_completed`, `venture.killed`.

## Integration with the venture machine

`venture.ts` keeps the canonical state model and now exposes **internal transaction primitives** — `mintVentureAtG01Tx`, `advanceVentureForGateTx` — that open no transaction, take no lock, and emit no events; they validate against the machine (next legal transition from the row's **actual** state, exact gate, five-artifact rule for G-04) and return the effect. `gates.ts` is their only production caller: **`ops/check-gate-bypass.mjs`** (CI, `pnpm check:gates`) fails if any other production file references them or writes `gate_passes`. There is no production API that creates a formal venture or advances a stage without the full gate protocol.

## The transaction (one, atomic, issue-#7 lock order)

```
BEGIN → acquireEventChainLock (advisory lock FIRST)
      → load the FILED DR + verify integrity + apply gate semantics
      → validate approval evidence (digest == stored digest) + live approver role
      → mint venture (G-01) / lock venture row FOR UPDATE + apply advance (G-02..06)
      → appendEventTx exactly once: gate_passed
      → INSERT gate_passes
      → COMMIT     (any failure → ROLLBACK: no venture, no state change, no event, no projection)
```

Registry and spend checks are pure and run before the transaction; the DR is loaded and verified **inside** the serialized transaction (by id, from the immutable store). Nothing partial can persist: tests inject failures at the event INSERT, the projection INSERT, the venture UPDATE, and the G-01 venture INSERT, and assert zero leftovers each time.

## Idempotence and the `gate_passes` projection

[`ops/migrations/0005_gate_passes.sql`](../ops/migrations/0005_gate_passes.sql): one row per pass, written only by `gates.ts` in the pass transaction. `dr_id UNIQUE` means **a DR executes at most once** — the v0 form of Appendix C mechanic 5 ("no gate shopping"); reuse fails with a specific error, and this also collapses concurrent duplicate passes (same DR) to exactly one. `gate_event_id UNIQUE + FK` keeps the projection 1:1 with real `gate_passed` events; `approval_event_id FK` keeps evidence real; the `gate_passes_gate_shape` CHECK makes G-00, G-07..G-16, and unknown gate ids unrepresentable even by direct INSERT, and forces the pipeline shape (venture, no subject) vs the standing shape (non-empty subject); `dr_id` is format-checked, **FK-references `decision_records(id)`** (added in migration 0006: a gate pass cannot cite an unfiled DR even by direct INSERT), and `proposer ≠ approver` is re-checked at the DB layer.

## Appendix C mechanics — v0 scope

- **1 (pre-registration)** — enforced (kill criteria before the pass, where mandatory).
- **2 (evidence)** — enforced (full DR + linked approval evidence).
- **3 (queueing)** — no real queue: any `requestedSpend ≠ 0` is rejected with a specific *"requires manual queue (A1)"* error, because envelopes are unratified (ADR-006) and v0 executes no spend. This rejection is **independent of the `real_money` flag** ([RATIFICATION](RATIFICATION.md), issue #11): even when `real_money` is `true`, spend is still rejected here — the flag records that founding ratification happened, it does not authorize or execute any payment (`THR-SPEND-EXEC = $0`).
- **5 (no gate shopping)** — DR reuse blocked (`dr_id UNIQUE`). Full resubmission validation (a diff against the rejected DR with materially new evidence) is **still deferred beyond issue #10** — the DR store persists and links amendments, but nothing yet validates that a resubmission carries materially new evidence.

## Boundaries (documented limits)

- **Issue #10 (DR tooling) — done:** the DR is **filed and immutable** ([DECISION_RECORDS](DECISION_RECORDS.md)); the gate loads it by `decisionRecordId` and binds to its stored digest. This protocol is otherwise unchanged, and the G-01 pass still mints the venture in the same atomic operation with one `gate_passed`.
- **Issue #12 (G-00) — done:** the [manual stop mechanism](G00_STOP.md). G-00 is still not a "gate pass" (the dispatcher refuses to pass it), but the stop now *enforces*: a single central guard (`assertSystemRunning` inside `runGateTx`, after the advisory lock and before any effect) makes **every** gate route refuse while the system is stopped — zero `gate_passed`, zero transition, zero partial effect. Restart is an approver action with a logged rationale.
- No dashboard/UI/API, no agents, no external communications or data execution (G-17/G-18 record authorization only), no real money, no real queue.

## What it guarantees / does NOT guarantee

**Guarantees:** no gate pass without a **filed**, schema-valid approved DR, pre-registered kill criteria (where mandatory), real linked human approval by a live approver bound to the exact **stored** DR content (SHA-256-hex digest, format-validated), and role separation; exactly one `gate_passed` + one projection row per pass, atomic with the venture effect; a DR never executes twice; the whole request is snapshotted before the first `await`, so post-call mutation of any field cannot change the pass; the gate registry and its lists are immutable at runtime (no re-classification, add, or removal); no production bypass of the gated paths (CI-enforced).

**Does NOT guarantee:** actor authentication (recorded, not verified — see [AUTH](AUTH.md)); envelope/spend enforcement (rejected wholesale until ratification); resubmission-diff validation (deferred beyond #10); anything about gates G-07+.

## Running it

```bash
pnpm migrate        # applies 0005_gate_passes.sql
pnpm check:gates    # CI guard: no gate-system bypass
pnpm test           # vitest: requirement failures, full path, atomicity, concurrency,
                    #         whole-request snapshot immunity, registry immutability
pnpm verify:events
```
