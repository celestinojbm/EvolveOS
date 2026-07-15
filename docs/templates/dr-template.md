<!--
  Decision Brief template — the deterministic ≤2-page rendering produced by
  `renderDecisionBrief` in app/src/lib/dr.ts (issue #10, P0-9), in the exact
  Part VII §8.2 order. This file documents the shape; the renderer is the source
  of truth. Never hand-edit a brief to add options, scores, or risks the DR does
  not contain, and never truncate dissent to fit the page budget.

  The renderer takes a full StoredDecisionRecord and verifies it
  CRYPTOGRAPHICALLY before rendering (pure, no DB): the document must hash to
  the record's digest and canonical bytes, and the record's id/amends link must
  match the document — otherwise DecisionBriefIntegrityError. A brief can never
  show content that does not correspond to the digest printed in §6.
-->

# Decision Brief — `DR-<yyyy>-<seq>`

## 1. The ask

`<decision, one sentence>` — reversibility **`<R1|R2|R3|R4>`**, gate **`<G-nn or —>`**.

Part VII §8.2 also names the envelope delta here; the Phase 0 DR schema has no
envelope field (envelopes are unratified per ADR-006 and v0 authorizes no
spend), so no delta exists to show — and none is invented.

## 2. Options

| Option | Chosen | Summary | Predicted outcome | Uncertainty |
|---|---|---|---|---|
| `<option_id>` | ✓ (chosen) | `<summary>` | `<primary_metric (representation) quantiles>` | `<epistemic share / representation>` |
| `<option_id>` |  | `<summary>` | … | … |

The chosen option is marked `✓`. Predicted outcome and uncertainty are shown
**only** from what the DR's `predicted_outcome_distribution` actually contains —
absent scores are never invented. For **R3/R4** decisions every option MUST
carry a non-empty `predicted_outcome_distribution` (filing rejects it
otherwise), so this table always shows real uncertainty for material decisions;
for R1/R2 the field is optional and an absent distribution renders as `—`.

Part VII admits multiple distribution representations, and an unrecognized one
is never hidden: when none of the known fields (`primary_metric`,
`representation`, `quantiles`) are present, the *predicted outcome* cell shows
the distribution's deterministic canonical JSON (markdown-escaped), and the
*uncertainty* cell falls back `epistemic_share` → `representation` → the
explicit note `structured distribution — see predicted outcome`. A valid,
non-empty distribution never renders as `—`.

## 3. Top three risks

1. `<risk 1>`
   - Mitigation: not separately recorded in the Phase 0 DR.
2. `<risk 2>`
   - Mitigation: not separately recorded in the Phase 0 DR.
3. `<risk 3>`
   - Mitigation: not separately recorded in the Phase 0 DR.
- …and `<N>` more (see the full decision record).  ← only when there are > 3

At most three risks are surfaced; any remainder is pointed to, never hidden.
Part VII §8.2 requires each shown risk to state its mitigation **or its
absence flatly** — the Phase 0 DR keeps risks as plain strings with no separate
mitigation field, so the absence is declared explicitly and honestly, never
invented. An R3/R4 DR cannot be filed with zero risks, so this section is never
"No risks recorded" for a material decision.

## 4. Dissent (verbatim)

- **`<author>`** (position: `<option_id>`): `<argument, reproduced verbatim>`

Every `dissent_record` entry appears un-summarized. Consensus machinery may
weight dissent down, but it must never hide it from the human.

## 5. Kill criteria and rollback

**Kill criteria:**
- `<kill criterion>`

**Rollback plan:** `<rollback_plan — what stops this, who pulls the cord, what it costs to undo>`

## 6. Drill-down

- Decision record: `DR-<yyyy>-<seq>` (schema `<version>`)
- Content digest: `<sha256 hex>`
- Evidence: `<evidence_links>`
- Amends: `DR-<yyyy>-<seq>`  ← only when this DR is an amendment
- Full record and simulation traces: stored `decision_records` row (drill-down unlimited).

---

## Rendered example

The brief below is what `renderDecisionBrief` produces from
[`schemas/examples/valid/decision-record.json`](../../schemas/examples/valid/decision-record.json):

```markdown
# Decision Brief — DR-2027-001

## 1. The ask

Proceed to Customer Discovery; validation cleared the pre-registered kill criteria. — reversibility **R2**, gate **G-03**.

## 2. Options

| Option | Chosen | Summary | Predicted outcome | Uncertainty |
|---|---|---|---|---|
| `opt-proceed` | ✓ | Proceed to Customer Discovery now. | discovery_activation_rate (quantiles) p05=0.18, p50=0.34, p95=0.52 | epistemic share 0.5 |
| `opt-defer` |  | Defer one sprint to collect more interviews. | discovery_activation_rate (qualitative) | epistemic share 0.4 |

## 3. Top three risks

1. Conversion may not hold at larger spend
   - Mitigation: not separately recorded in the Phase 0 DR.

## 4. Dissent (verbatim)

- **FIN-MODEL** (position: opt-defer): Payback assumption looks optimistic; one more sprint of interviews reduces the spend-scaling risk.

## 5. Kill criteria and rollback

**Kill criteria:**
- Discovery activation < 25% after 20 conversations
**Rollback plan:** Archive the venture; no external commitments were made.

## 6. Drill-down

- Decision record: `DR-2027-001` (schema 1.0.0)
- Content digest: `0a94aaa67bd9fdbeafb77619ebab171c9c4f42b438b7b1f44a2ef32e5d366d39`
- Evidence: `evidence/landing-test-summary`, `evidence/interview-corpus`
- Full record and simulation traces: stored decision_records row (drill-down unlimited).
```
