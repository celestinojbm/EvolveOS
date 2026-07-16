# Founding Ratification Pack (operational)

**Pack ID:** `FRP-2026-001` · **Version:** `0.1.0` · **Proposed:** 2026-07-15 · **Document status:** `proposed` (NOT ratification-ready)

This is the **single, signable, machine-readable** instrument that gates the `real_money` feature flag (issue **[#11](https://github.com/celestinojbm/EvolveOS/issues/11)**, P0-10). It operationalizes **[ADR-006](ARCHITECTURE_DECISIONS.md)** (all spec dollar thresholds are unratified until this Pack is signed) and adapts the **Part 0 §5** `[ASSUMPTION]` thresholds to the pathfinder deployment **without amending the specification** (Appendix C stays the single source of truth for the spec; this Pack records *deployment* values only).

The deeper constitutional context — the founding amendment mode (`spec/00-overview.md` §4.1), the ratification statement, MVP security deviations, and re-entry triggers — lives in [FOUNDING_RATIFICATION_PACK.md](FOUNDING_RATIFICATION_PACK.md). **This file is the operational pack the code reads and hashes.** There is no second machine-readable source of truth.

> **The manifest is the source of truth.** The threshold table (§B) and the role table (§C) below are **rendered from the embedded JSON manifest** and enclosed in generated-block markers. `check:ratification` re-renders them from the manifest and fails if either table and the manifest diverge — so the human-readable tables can never drift from the machine-readable state.

> **Readiness is derived, not declared.** `thresholds_resolved`, `roles_assigned`, and `ratification_ready` appear in the manifest as readable declarations, but the code recomputes them from the structured `thresholds` and `role_assignments`. If a declared boolean does not equal the computed value, the pack is invalid. Setting the booleans to `true` while a threshold is `UNRESOLVED` or a role is `UNASSIGNED` does not make the pack ready — it makes it invalid.

> **Signatures bind the exact bytes of this file.** The `real_money` flag reads `true` only when a valid, self-signed, user-grounded human signature event exists for **every** required signer, each bound to the SHA-256 of this document's exact UTF-8 bytes. Editing **any** byte — a threshold, a name, a word of the non-scope, or the manifest — changes the digest and invalidates every prior signature. See [RATIFICATION.md](RATIFICATION.md) and §F below.

**This Pack is NOT ratification-ready.** Its thresholds are `UNRESOLVED` and its signers are `UNASSIGNED` (see §B, §C). Until a human founder resolves them, `real_money` stays `false` and no signature can be recorded.

---

## A. Identity of the pack

| Field | Value |
|---|---|
| Pack ID | `FRP-2026-001` (stable) |
| Version | `0.1.0` |
| Proposed date | 2026-07-15 |
| Document status | `proposed` — not ratification-ready |
| Build decision | [ADR-006](ARCHITECTURE_DECISIONS.md) (real-money flag off until signed) |
| Spec basis | Part 0 §5 (reversibility dollar bands, `[ASSUMPTION]`); Appendix C (gate envelopes) |
| Nature | Adapts the `[ASSUMPTION]` $10M-scale thresholds to this pathfinder deployment. **Does not modify the normative specification.** Appendix C and Part 0 are unchanged. |

---

## B. Pathfinder-scale threshold table

Rendered from the manifest's `thresholds`. Each `unresolved` row is a value a real human founder must decide; no economic number is invented here. The original normative context ($10M-scale `[ASSUMPTION]` values, scope, and reversibility implication) is discussed in the prose below the block; the block itself is the machine-readable state.

<!-- RATIFICATION_THRESHOLDS_START -->
| ID | Concept | Deployment value | Unit | Status |
|---|---|---|---|---|
| `THR-SPEND-EXEC` | Deployment-wide spend-execution authority | $0 | USD | resolved |
| `THR-RERATIFY` | Re-ratification trigger | > 2x current AUM | ratio | resolved |
| `THR-CAPITAL` | Deployable capital base (~$10,000,000 [ASSUMPTION]) | UNRESOLVED | USD | unresolved |
| `THR-R1` | R1 undo-cost ceiling (orig. <= $1,000) | UNRESOLVED | USD | unresolved |
| `THR-R2` | R2 undo-cost ceiling (orig. <= $50,000) | UNRESOLVED | USD | unresolved |
| `THR-R3` | R3 cost band (orig. $50,000-$1,000,000) | UNRESOLVED | USD | unresolved |
| `THR-R4` | R4 irreversible / existential floor (orig. > $1,000,000) | UNRESOLVED | USD | unresolved |
| `THR-G01` | G-01 research budget (orig. <= $2,000) | UNRESOLVED | USD | unresolved |
| `THR-G02` | G-02 validation budget (orig. <= $10,000) | UNRESOLVED | USD | unresolved |
| `THR-G03` | G-03 discovery budget (orig. <= $15,000) | UNRESOLVED | USD | unresolved |
| `THR-G04` | G-04 prototype budget (orig. <= $25,000) | UNRESOLVED | USD | unresolved |
| `THR-G05` | G-05 MVP budget (orig. <= $150,000) | UNRESOLVED | USD | unresolved |
| `THR-G06` | G-06 GTM budget (orig. <= $100,000/quarter) | UNRESOLVED | USD | unresolved |
<!-- RATIFICATION_THRESHOLDS_END -->

`THR-SPEND-EXEC = $0` is **resolved by construction**: this deployment authorizes no spend execution at all in v1 (`MVP_SCOPE.md` §2; [ADR-006](ARCHITECTURE_DECISIONS.md)/[ADR-007](ARCHITECTURE_DECISIONS.md)). `THR-RERATIFY` adopts the Part 0 §5 re-ratification rule (> 2× AUM) unchanged. Every remaining row is `UNRESOLVED`: no concrete pathfinder figure exists in any document, and the Buildability Audit §6(c) says only "personal-project scale" qualitatively. **Because unresolved rows exist, `thresholds_resolved` is `false`, the Pack cannot be ratification-ready, and `real_money` cannot be enabled** until a founder replaces every `UNRESOLVED` with a concrete pathfinder value (or explicitly adopts the original as the deployment value). Even after ratification, `THR-SPEND-EXEC = $0` means enabling `real_money` moves no money and no gate executes a payment (§E, [GATE_SYSTEM.md](GATE_SYSTEM.md)).

> Appendix C is **not** re-thresholded here and is not edited. Re-thresholding a gate in the spec is itself a G-16 action; this Pack records deployment values only.

---

## C. Role assignments

Rendered from the manifest's `role_assignments`. Every constitutional capacity the pathfinder deployment depends on is listed; a real human founder must fill in the actor ID and human name. **No person is invented here.** Every required signer must be a **distinct** registered human (see the policy note below).

<!-- RATIFICATION_ROLES_START -->
| Capacity | Actor ID | Name | Required signer | Status |
|---|---|---|---|---|
| `founding_signatory` | `UNASSIGNED` | UNASSIGNED | yes | unassigned |
| `portfolio_review_lead` | `UNASSIGNED` | UNASSIGNED | yes | unassigned |
| `operator` | `UNASSIGNED` | UNASSIGNED | yes | unassigned |
| `curator` | `UNASSIGNED` | UNASSIGNED | yes | unassigned |
<!-- RATIFICATION_ROLES_END -->

**Required-signer policy.** Each required constitutional signer is a **distinct human** with a **unique actor ID**; a single person may not cover multiple required-signing capacities. This preserves real separation and prevents one signature from controlling the whole Pack. At ratification each `actor_id` must resolve to a registered user whose `display_name` equals the `Name` here, and operational capacities must hold the matching active role (`portfolio_review_lead` → `approver`; `operator` → `operator`). `founding_signatory` and `curator` have no dedicated role enum in issue #11 (documented limit) and require a registered user only. **Because entries above are `UNASSIGNED`, `roles_assigned` is `false`.**

---

## D. Manual G-00 procedure (documentary only — pre issue #12)

This is the **manual** procedure that governs an emergency stop until the technical mechanism is built in issue **#12**. It is **documentary only**: there is no code enforcement here, `gates.ts` is not blocked, and there is no `stop.ts`. It mirrors Appendix C (G-00, mechanic 6 "Stop asymmetry") and Revision XV-1 without exceeding them.

1. **Who may invoke a stop.** Any single authorized human (Portfolio Review lead, an operator, or the founding signatory). Stopping never needs a quorum.
2. **Stopping is the cheapest action.** It must always be easier and faster to stop than to start. A stop is honored immediately.
3. **A reason is optional to stop.** No one may be required to justify a stop before it takes effect; the justification (if any) is recorded after.
4. **Expected manual effect.** Work in the stopped scope (a venture, a workflow, or the whole console) is paused by hand: no new gate passes, no new agent runs, no artifact acceptance in that scope.
5. **Communication channels.** The stop is announced on the founding team's agreed channel (to be named at ratification) so every operator sees it.
6. **Evidence to record.** After the stop, an event/note records: who stopped, the scope, the time, and any reason. (In v1 this is a manual log entry; issue #12 makes it a first-class event.)
7. **What is suspended.** Everything in the stopped scope stays suspended until an explicit restart.
8. **Restart requires a human approver.** Restart is authorized only by the **owning gate's approver** (for a venture/decision scope, the Portfolio Review lead). Stopping ≠ restarting.
9. **Restart requires a non-empty rationale**, recorded.
10. **Restart must be recorded** (who restarted, when, why).
11. **No automatic technical enforcement yet.** There is no flag, no `stop.ts`, no `gates.ts` block in this issue. The automatic mechanism is issue #12.

---

## E. MVP non-scope (binding)

The Phase 0 non-scope is binding under this Pack. It is copied and reconciled from `MVP_SCOPE.md` §2, the mandatory-human decisions, and [ADR-006](ARCHITECTURE_DECISIONS.md)/[ADR-007](ARCHITECTURE_DECISIONS.md). Nothing new is invented as a constitutional restriction.

- **No financial execution before ratification** — and, under `THR-SPEND-EXEC = $0`, no spend execution at all in v1. No treasury, payments, or money movement; no agent-adjacent spend. Enabling `real_money` records ratification; it does not move money.
- **No external agent credentials** (Phases 0–2); no external agent action.
- **No autonomy above A1** (nothing R4 is ever automated; no scheduled agent runs — that is Phase 3).
- **No mechanisms outside the Phase 0 roadmap** — in particular, no technical G-00 stop mechanism here (issue #12), no restart mechanism, no `stop.ts`.
- **No entity formation, funding, hiring, M&A, exit, shutdown** (gates G-07…G-15 unreachable by construction).
- **No external communications by agents** (email, outreach, ads, posting); G-17 records authorization only, executed by a human by hand.
- **No multi-venture, no portfolio/capital allocation, no self-evolution, no consensus/calibration machinery, no cells/Kafka/SPIFFE/OPA/vector store.**
- **No customer PII** (PC-2/PC-3 data classes banned in v1).
- **No dashboard/UI beyond the minimal console** the MVP needs.

---

## F. Signature statement

Each signer accepts, verbatim, the acknowledgement recorded in the manifest (`acknowledgement`). By signing, the signer affirms, as their own act and by their own hand:

- the pathfinder-scale **thresholds** (§B);
- the **role assignments** (§C);
- the **manual G-00 procedure** (§D);
- the **MVP non-scope** (§E);
- an **acknowledgement of the risks** in [FOUNDING_RATIFICATION_PACK.md](FOUNDING_RATIFICATION_PACK.md) §8;
- an **acknowledgement that altering any byte of this Pack invalidates every prior signature**.

A signature is a single, self-signed, append-only human event (`ratification.signature_recorded`, `actor_type: human`, `actor_id` = the signer) bound to this Pack's exact-byte digest and version. No delegated, automated, agent, env-var, seed, or config-flag signature is ever valid.

---

<!-- RATIFICATION_MANIFEST_START -->
```json
{
  "pack_id": "FRP-2026-001",
  "version": "0.1.0",
  "proposed_date": "2026-07-15",
  "document_status": "proposed",
  "adr_ref": "ADR-006",
  "spec_ref": "Part 0 §5",
  "acknowledgement": "I have read this Founding Ratification Pack in full and I ratify, as my own act and by my own hand, the pathfinder-scale thresholds, the role assignments, the manual G-00 procedure, and the MVP non-scope recorded in it; I acknowledge the stated risks; and I acknowledge that altering any byte of this Pack invalidates every prior signature.",
  "acknowledgement_version": "1.0.0",
  "thresholds_resolved": false,
  "roles_assigned": false,
  "ratification_ready": false,
  "thresholds": [
    { "id": "THR-SPEND-EXEC", "concept": "Deployment-wide spend-execution authority", "deployment_value": "$0", "unit": "USD", "status": "resolved" },
    { "id": "THR-RERATIFY", "concept": "Re-ratification trigger", "deployment_value": "> 2x current AUM", "unit": "ratio", "status": "resolved" },
    { "id": "THR-CAPITAL", "concept": "Deployable capital base (~$10,000,000 [ASSUMPTION])", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-R1", "concept": "R1 undo-cost ceiling (orig. <= $1,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-R2", "concept": "R2 undo-cost ceiling (orig. <= $50,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-R3", "concept": "R3 cost band (orig. $50,000-$1,000,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-R4", "concept": "R4 irreversible / existential floor (orig. > $1,000,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-G01", "concept": "G-01 research budget (orig. <= $2,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-G02", "concept": "G-02 validation budget (orig. <= $10,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-G03", "concept": "G-03 discovery budget (orig. <= $15,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-G04", "concept": "G-04 prototype budget (orig. <= $25,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-G05", "concept": "G-05 MVP budget (orig. <= $150,000)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" },
    { "id": "THR-G06", "concept": "G-06 GTM budget (orig. <= $100,000/quarter)", "deployment_value": "UNRESOLVED", "unit": "USD", "status": "unresolved" }
  ],
  "role_assignments": [
    { "capacity": "founding_signatory", "actor_id": "UNASSIGNED", "name": "UNASSIGNED", "required_signer": true, "status": "unassigned" },
    { "capacity": "portfolio_review_lead", "actor_id": "UNASSIGNED", "name": "UNASSIGNED", "required_signer": true, "status": "unassigned" },
    { "capacity": "operator", "actor_id": "UNASSIGNED", "name": "UNASSIGNED", "required_signer": true, "status": "unassigned" },
    { "capacity": "curator", "actor_id": "UNASSIGNED", "name": "UNASSIGNED", "required_signer": true, "status": "unassigned" }
  ]
}
```
<!-- RATIFICATION_MANIFEST_END -->

---

## What a founder must resolve before this Pack can be signed

1. **Thresholds (§B):** replace every `UNRESOLVED` with a concrete pathfinder value (or explicitly adopt the original as the deployment value) and set each row's `status` to `resolved`, then set `thresholds_resolved: true`.
2. **Roles (§C):** give every required signer a real `actor_id` and human `name` (no `UNASSIGNED`), set each `status` to `assigned`, register each as a user (with the matching `display_name` and role), then set `roles_assigned: true`.
3. **Review §D, §E, §F** and confirm they are acceptable.
4. Set `document_status: "ratification-ready"` and `ratification_ready: true` in the manifest (these must match the computed readiness or the pack is invalid).
5. Re-render the §B and §C tables from the manifest (they must match, or `check:ratification` fails), compute the resulting exact-byte digest, and have **every** required signer record a `ratification.signature_recorded` event bound to that digest and version (via the console; never automatically).

Only when all required signers have signed the final bytes does `isRealMoneyEnabled` return `true` — and even then, `THR-SPEND-EXEC = $0` means no money moves in v1.
