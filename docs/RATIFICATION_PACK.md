# Founding Ratification Pack (operational)

**Pack ID:** `FRP-2026-001` · **Version:** `0.1.0` · **Proposed:** 2026-07-15 · **Document status:** `proposed` (NOT ratification-ready)

This is the **single, signable, machine-readable** instrument that gates the `real_money` feature flag (issue **[#11](https://github.com/celestinojbm/EvolveOS/issues/11)**, P0-10). It operationalizes **[ADR-006](ARCHITECTURE_DECISIONS.md)** (all spec dollar thresholds are unratified until this Pack is signed) and adapts the **Part 0 §5** `[ASSUMPTION]` thresholds to the pathfinder deployment **without amending the specification** (Appendix C stays the single source of truth for the spec; this Pack records *deployment* values only).

The deeper constitutional context — the founding amendment mode (`spec/00-overview.md` §4.1), the ratification statement, MVP security deviations, and re-entry triggers — lives in [FOUNDING_RATIFICATION_PACK.md](FOUNDING_RATIFICATION_PACK.md). **This file is the operational pack the code reads and hashes.** There is no second machine-readable source of truth.

> **Signatures bind the exact bytes of this file.** The `real_money` flag reads `true` only when a valid, self-signed human signature event exists for **every** required signer, each bound to the SHA-256 of this document's exact UTF-8 bytes. Editing **any** byte — a threshold, a name, a word of the non-scope, or the manifest — changes the digest and invalidates every prior signature. See [RATIFICATION.md](RATIFICATION.md) and §F below.

**This Pack is NOT ratification-ready.** Its thresholds are `UNRESOLVED` and its signers are `UNASSIGNED` (see §B, §C). Until a human founder resolves them and sets `ratification_ready: true` in the manifest, `real_money` stays `false` and no signature can be recorded.

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

Each row records the **original normative value** (from Part 0 §5 / Appendix C, calibrated to ~$10M deployable capital that does not exist yet) and the **value proposed for this deployment**. Where no pathfinder-scale value has been proposed in any existing document, the proposed value is **`UNRESOLVED`** — a real human founder must decide it. No economic number is invented here.

| ID | Concept | Original normative value | Proposed (this deployment) | Unit | Scope | Responsible | Evidence / rationale | Reversibility implication | Status |
|---|---|---|---|---|---|---|---|---|---|
| `THR-SPEND-EXEC` | Deployment-wide spend-execution authority | — (not a spec threshold) | **$0** | USD | whole deployment | founding signatory | MVP non-scope (`MVP_SCOPE.md` §2: "no money movement; no agent-adjacent spend before this Pack is signed"); [ADR-006](ARCHITECTURE_DECISIONS.md), [ADR-007](ARCHITECTURE_DECISIONS.md); the gate system already rejects any `requestedSpend ≠ 0`. | Zero — v1 executes no spend at all. | **PROPOSED** (supported; resolved-by-construction for v1) |
| `THR-RERATIFY` | Re-ratification trigger | AUM change > 2× | > 2× (adopted as-is) | ratio | portfolio | Investment Committee (dormant → founding signatory) | Part 0 §5; [ADR-006](ARCHITECTURE_DECISIONS.md) revisit trigger | Forces re-signing this Pack. | **PROPOSED** (rule adopted unchanged) |
| `THR-CAPITAL` | Deployable capital base | ~$10,000,000 `[ASSUMPTION]` | `UNRESOLVED` (pathfinder / personal-project scale) | USD | portfolio | founding signatory | Part 0 §5 `[ASSUMPTION]`; audit §6(c) ("scaled-down, personal-project scale"); no concrete pathfinder figure exists | All dollar bands scale from this. | `UNRESOLVED` |
| `THR-R1` | R1 undo-cost ceiling | ≤ $1,000 (and ≤ 1 hour) | `UNRESOLVED` | USD | reversibility classifier | founding signatory | Part 0 §5 | Sets the R1 boundary. | `UNRESOLVED` |
| `THR-R2` | R2 undo-cost ceiling | ≤ $50,000 (and ≤ 30 days) | `UNRESOLVED` | USD | reversibility classifier | founding signatory | Part 0 §5 | Sets the R2 boundary. | `UNRESOLVED` |
| `THR-R3` | R3 cost band | $50,000 – $1,000,000 | `UNRESOLVED` | USD | reversibility classifier | founding signatory | Part 0 §5 | Sets the R3 band. | `UNRESOLVED` |
| `THR-R4` | R4 irreversible / existential floor | > $1,000,000 | `UNRESOLVED` | USD | reversibility classifier | founding signatory | Part 0 §5 | Existential; R4 is never automated. | `UNRESOLVED` |
| `THR-G01` | G-01 research budget | ≤ $2,000 | `UNRESOLVED` | USD | per venture | Portfolio Review lead | Appendix C | R1. | `UNRESOLVED` |
| `THR-G02` | G-02 validation budget | ≤ $10,000 | `UNRESOLVED` | USD | per venture | Portfolio Review lead | Appendix C | R1/R2. | `UNRESOLVED` |
| `THR-G03` | G-03 discovery budget | ≤ $15,000 | `UNRESOLVED` | USD | per venture | Portfolio Review lead | Appendix C | R2. | `UNRESOLVED` |
| `THR-G04` | G-04 prototype budget | ≤ $25,000 | `UNRESOLVED` | USD | per venture | Portfolio Review lead | Appendix C | R2. | `UNRESOLVED` |
| `THR-G05` | G-05 MVP budget | ≤ $150,000 | `UNRESOLVED` | USD | per venture | Portfolio Review lead | Appendix C | R3. | `UNRESOLVED` |
| `THR-G06` | G-06 GTM budget | ≤ $100,000 / quarter | `UNRESOLVED` | USD/quarter | per venture | Portfolio Review lead | Appendix C | R3. | `UNRESOLVED` |

**Because rows above are `UNRESOLVED`, `thresholds_resolved` is `false`.** The Pack cannot be ratification-ready, and `real_money` cannot be enabled, until a founder replaces every `UNRESOLVED` with a concrete pathfinder value (or explicitly adopts the original as the deployment value). The `THR-SPEND-EXEC = $0` row means that even after ratification, this deployment authorizes **no** spend execution: enabling `real_money` records that ratification happened; it does **not** move money and no gate executes a payment (see §E and [GATE_SYSTEM.md](GATE_SYSTEM.md)).

> Appendix C is **not** re-thresholded here and is not edited. Re-thresholding a gate in the spec is itself a G-16 action; this Pack records deployment values only.

---

## C. Role assignments

Each constitutional role that the pathfinder deployment depends on. A real human founder must fill in the actor ID and name; until then every entry is `UNASSIGNED` and the Pack is not ratification-ready. **No person is invented here.**

| Capacity | Actor ID | Human name | Responsibility | Scope | Status |
|---|---|---|---|---|---|
| `founding_signatory` | `UNASSIGNED` | `UNASSIGNED` | Ratify the constitutional core, the thresholds (§B), the manual G-00 procedure (§D), and the non-scope (§E); exercise the founding amendment mode. | Founding amendment mode (`spec/00-overview.md` §4.1) | `UNASSIGNED` |
| `portfolio_review_lead` | `UNASSIGNED` | `UNASSIGNED` | Approve G-05/G-06; chair the weekly A2 batch review; the `approver` role (issue #7). | Pipeline gate approvals | `UNASSIGNED` |
| `operator` | `UNASSIGNED` | `UNASSIGNED` | Run the console workflows and invoke agents; author opportunity briefs and DRs. May be more than one person (each a separate signer). | Console operations | `UNASSIGNED` |
| `curator` | `UNASSIGNED` | `UNASSIGNED` | Human validation of Knowledge Items (the `CURATOR` role is a human — MVP scope §1). | Knowledge base | `UNASSIGNED` |

**Because entries above are `UNASSIGNED`, `roles_assigned` is `false`.** The same person may hold multiple capacities, but the proposer≠approver separation (Part III, issue #7) still holds per gate decision. Each distinct required signer in the manifest must be a distinct assigned human before ratification.

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
  "acknowledgement_version": "1.0.0",
  "acknowledgement": "I have read this Founding Ratification Pack in full and I ratify, as my own act and by my own hand, the pathfinder-scale thresholds, the role assignments, the manual G-00 procedure, and the MVP non-scope recorded in it; I acknowledge the stated risks; and I acknowledge that altering any byte of this Pack invalidates every prior signature.",
  "ratification_ready": false,
  "thresholds_resolved": false,
  "roles_assigned": false,
  "required_signers": [
    { "actor_id": "UNASSIGNED", "name": "UNASSIGNED", "capacity": "founding_signatory" },
    { "actor_id": "UNASSIGNED", "name": "UNASSIGNED", "capacity": "portfolio_review_lead" },
    { "actor_id": "UNASSIGNED", "name": "UNASSIGNED", "capacity": "operator" },
    { "actor_id": "UNASSIGNED", "name": "UNASSIGNED", "capacity": "curator" }
  ]
}
```
<!-- RATIFICATION_MANIFEST_END -->

---

## What a founder must resolve before this Pack can be signed

1. **Thresholds (§B):** replace every `UNRESOLVED` with a concrete pathfinder value (or explicitly adopt the original as the deployment value), then set `thresholds_resolved: true`.
2. **Roles (§C):** give every required signer a real `actor_id` and human `name` (no `UNASSIGNED`), then set `roles_assigned: true`.
3. **Review §D, §E, §F** and confirm they are acceptable.
4. Set `ratification_ready: true` in the manifest.
5. Compute the resulting exact-byte digest and have **every** required signer record a `ratification.signature_recorded` event bound to that digest and version (via the console; never automatically).

Only when all required signers have signed the final bytes does `isRealMoneyEnabled` return `true` — and even then, `THR-SPEND-EXEC = $0` means no money moves in v1.
