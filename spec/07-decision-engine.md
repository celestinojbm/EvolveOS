# EvolveOS Specification — Part VII: Decision Engine

**Status:** Draft v0.1 · **Change class:** R3 (standard amendment process, Part XII)

> **Scope of change class.** The prose and algorithms of this part are amendable as R3 via Part XII (`12-self-evolution.md`). Two carve-outs: (a) changes to the scoring-weight vectors of §3.2 that affect capital-allocation decisions MUST additionally be ratified by the Investment Committee; (b) anything in this part that restates the autonomy–reversibility matrix or gate mechanics merely *cites* the Constitutional Layer — modifying those underlying rules is a G-16 action, never an amendment to this file.

Cross-references: `00-overview.md` (R/A taxonomies), `appendix-b-agent-registry.md` (agent IDs), `appendix-c-decision-gates.md` (gates), `05-business-creation-pipeline.md` (stage transitions), `06-knowledge-system.md` (evidence packs, counterfactual ledger storage), `08-finance.md` (envelopes, capital allocation), `11-governance.md` (human bodies), `12-self-evolution.md` (amendment process), `13-failure-analysis.md` (risk register).

---

## 1. Purpose and design stance

The Decision Engine is the subsystem that converts evidence into committed action under uncertainty. It is not a single agent: it is a **protocol plus a small set of services** (`RISK-QUANT` for risk quantification, `FIN-MODEL` for economic models, `EVALUATOR` for calibration tracking) that every deciding agent and every human approver uses.

Three commitments shape everything below:

1. **Decisions are data.** A decision that is not recorded in machine-readable form with its predicted outcomes cannot be learned from. EvolveOS's compounding advantage (see `01-philosophy.md`) depends on a labeled dataset of decisions → outcomes; therefore every R2+ decision MUST produce a Decision Record (§2).
2. **Distributions, not point estimates.** Point forecasts hide exactly the information a portfolio operator needs (tail risk, variance, skew). All predictive outputs feeding a DR MUST be probability distributions or calibrated intervals (§7).
3. **Human attention is the scarcest resource in the system.** The engine's job at R3/R4 is to *compress* a decision into a reviewable artifact — options, distributions, top risks, dissent — not to replace human judgment (§8). A decision engine that floods humans with raw analysis has failed as surely as one that hides risk.

## 2. The Decision Record (DR)

### 2.1 Why every R2+ decision produces a DR

- **Learning requires labels.** Calibration scoring (§7), counterfactual scoring (§11), and weight tuning (§3.4) all require knowing what was predicted, what was chosen, and what happened. Without the DR there is no training signal, only anecdote.
- **Accountability requires provenance.** `appendix-c-decision-gates.md` gate mechanic 2 requires a DR at every gate; the DR is where human approvers' written risk acknowledgments live.
- **Rollback requires a plan written in advance.** Rollback plans authored during a crisis are systematically worse than plans authored when the decision was made (§12).
- R1 decisions are exempt because their volume (thousands/day) would drown the ledger and their reversal cost is bounded by definition (`00-overview.md` §5). R1 actions are still captured in the ordinary audit log (Kernel, see `10-security.md`); they are just not first-class DRs. **[ASSUMPTION]** The R1 exemption holds while R1 volume exceeds roughly 100× R2+ volume; if agents begin routing material decisions through R1 fragmentation ("salami-slicing"), the Kernel's aggregation rules (§2.4) close the loophole.

### 2.2 DR schema (normative)

DRs are immutable JSON documents identified as `DR-<yyyy>-<seq>` (`00-overview.md` §8), stored append-only with content hashes chained into the audit log (`10-security.md`). The schema below is normative; fields marked `∅-ok` may be null at creation and filled by later *append-only amendments* (a new signed record referencing the original — the original bytes never change).

```json
{
  "schema_version": "1.0",
  "id": "DR-2027-0142",
  "created_at": "2027-03-02T14:11:00Z",
  "decided_at": "2027-03-04T09:30:00Z",
  "decision_type": "gate_transition | envelope_change | vendor_commitment | pricing_change | hiring | architecture | rollback_execution | kill | other",
  "venture_id": "V-2027-004",
  "pipeline_stage": "S11-mvp",
  "gate_id": "G-05",
  "reversibility_class": "R3",
  "effective_autonomy": "A1",
  "requesting_agent": "VENTURE-ORCH@V-2027-004",
  "deciding_agents": ["PORTFOLIO", "RISK-QUANT", "FIN-MODEL"],
  "human_approvers": [
    { "role": "Portfolio Review lead", "person_ref": "HR-...", 
      "risk_acknowledgment": "signed:sha256:...", "decision": "approve" }
  ],
  "options": [
    {
      "option_id": "opt-a",
      "summary": "Commit MVP build with concierge fallback",
      "predicted_outcome_distribution": {
        "primary_metric": "activated_customers_at_90d",
        "horizon_days": 90,
        "representation": "quantiles",
        "quantiles": { "p05": 4, "p25": 11, "p50": 22, "p75": 40, "p95": 85 },
        "secondary_metrics": [
          { "metric": "net_cash_consumed_usd", "representation": "lognormal",
            "parameters": { "mu": 11.6, "sigma": 0.35 } }
        ],
        "epistemic_share": 0.6
      },
      "evidence_pack_refs": ["EP-2027-0871", "EP-2027-0902"],
      "scores": {
        "expected_utility": 0.412,
        "criteria": { "strategic_fit": 0.7, "capital_efficiency": 0.55,
                      "risk_adjusted_return": 0.48, "optionality": 0.8,
                      "learning_value": 0.65 },
        "risk": { "p_total_loss": 0.18, "cvar_95_usd": 140000,
                  "portfolio_correlation_note": "RISK-..." }
      },
      "agent_assessments": [
        { "agent": "RISK-QUANT", "rank": 1, "confidence": 0.62, "dissent": null },
        { "agent": "FIN-MODEL", "rank": 2, "confidence": 0.55,
          "dissent": "Payback assumption optimistic; see EP-2027-0902 §4" }
      ]
    }
  ],
  "chosen_option": "opt-a",
  "decision_rationale": "text, ≤ 500 words, citing evidence pack entries",
  "dissent_record": [
    { "agent": "FIN-MODEL", "position": "opt-b", "argument_ref": "EP-2027-0902 §4",
      "shown_to_humans": true }
  ],
  "kill_criteria": [
    { "id": "kc-1", "metric": "activation_rate", "comparator": "<", "value": 0.08,
      "window": "rolling_28d", "earliest_evaluation": "2027-04-15",
      "action_on_trip": "escalate_G-15_review" }
  ],
  "rollback_plan": {
    "triggers": ["kc-1", "spend > envelope", "security_incident_sev1"],
    "steps_ref": "RB-2027-0142",
    "owner_agent": "VENTURE-ORCH@V-2027-004",
    "human_owner_role": "Portfolio Review lead",
    "max_rollback_cost_usd_estimate": 30000,
    "rehearsed": false
  },
  "counterfactual_tracking": {
    "rejected_options": ["opt-b"],
    "observable_proxies": [
      { "option_id": "opt-b", "proxy": "competitor X traction in segment",
        "source": "COMP-INTEL quarterly readout", "review_at": "2027-09-01" }
    ]
  },
  "post_hoc_outcome": {
    "status": "pending",
    "realized_metrics": null,
    "scored_at": null,
    "calibration_contribution": null,
    "regret_estimate": null,
    "notes": null
  },
  "latency": { "requested_at": "...", "engine_ready_at": "...", "gate_cleared_at": "..." },
  "weight_vector_version": "W-2026.2",
  "content_hash": "sha256:..."
}
```

Field rules (binding):

- `gate_id` MUST cite a gate from `appendix-c-decision-gates.md` whenever the decision clears a gate; envelope-internal R2 decisions that clear no gate set it null but still record `reversibility_class`.
- `options` MUST contain ≥ 2 entries for R3+, one of which SHOULD be an explicit "do nothing / defer" option — deferral has a predicted outcome distribution too, and forcing its estimation prevents action bias.
- `kill_criteria` and `rollback_plan` are mandatory for every DR ≥ R2 (gate mechanic 1 in `appendix-c-decision-gates.md` makes gate passes without kill criteria invalid; this part extends the requirement to non-gate R2 DRs).
- `post_hoc_outcome` is the only section routinely amended after decision; amendments are authored by `EVALUATOR` (calibration fields) and `INSIGHT` (realized metrics), never by any agent that participated in the original decision — self-grading is prohibited because it corrupts the calibration signal.
- Every material claim in `decision_rationale` MUST trace to an evidence pack entry (`06-knowledge-system.md`).

### 2.3 DR lifecycle

`draft → assessed → decided → (executed | rejected) → outcome-scored → archived`. Transitions are Kernel-logged. A DR in `assessed` state is exactly what a human approver sees at an R3/R4 gate (§8.2). Outcome scoring occurs at the horizon named in each option's distribution, with early scoring on kill-criteria trips.

### 2.4 Anti-fragmentation rule

The Kernel MUST aggregate sequences of same-actor, same-target R1/R2 actions within a rolling window and reclassify the aggregate at the class of its combined worst-case reversal cost (`00-overview.md` §5 definitions). WHY: without aggregation, any R3 commitment can be laundered as thirty R1 steps. **[ASSUMPTION]** Window = 30 days, matching the R2 undo bound; tuning belongs to `10-security.md`.

## 3. Decision scoring

### 3.1 Expected utility over explicit outcome distributions

Conceptual algorithm, per option:

1. **Elicit distributions.** Each assessing agent produces, for the primary metric and mandated secondary metrics (cash consumed, time consumed, downside exposure), either a parametric distribution or a 5-point quantile sketch (p05/p25/p50/p75/p95). Quantile sketches are the default because agents produce better-calibrated quantiles than parametric fits **[ASSUMPTION — supported by human forecasting literature; to be re-validated on our own agents by `EVALUATOR` within two quarters]**.
2. **Convert to utility.** Outcomes are mapped to portfolio utility with a concave function: u(x) = ln(1 + x/C), where x is the risk-adjusted net value of the outcome in dollars and C is a portfolio-level curvature constant set by the IC alongside the risk limits it already ratifies (`00-overview.md` §5 threshold-ratification duty). Concavity is not decoration — it is how "don't bet the portfolio" enters arithmetic: a 10% chance of losing half the portfolio is penalized far more than 10× a 5% loss.
3. **Integrate.** EU(option) = Σ over sampled outcomes of p(outcome) × u(outcome), computed by Monte Carlo sampling from the (possibly correlated) joint distribution of metrics (§10). Never collapse to the mean first; EU of a distribution ≠ utility of its expectation, and the difference *is* the risk aversion.
4. **Penalize model uncertainty.** Where assessors materially disagree (inter-assessor divergence above threshold, §9.4), widen the mixture: EU is computed over the calibration-weighted *mixture* of assessor distributions, not over a single consensus curve. Disagreement thus automatically lowers EU of high-variance options — epistemic humility with no extra machinery.

### 3.2 Multi-criteria layer

Expected utility on the primary economic metric is necessary but not sufficient: some value dimensions (strategy, optionality, learning) resist honest monetization early. Each option therefore also receives five criterion scores on [0,1]:

| Criterion | Meaning | Primary scorer |
|---|---|---|
| Strategic fit | Alignment with portfolio thesis (`01-philosophy.md`, maintained by `STRAT-DIR`) | `STRAT-DIR` |
| Capital efficiency | Value per dollar of envelope consumed; favors staged, cheap-to-test paths | `FIN-MODEL` |
| Risk-adjusted return | EU from §3.1, normalized to [0,1] within the option set | `RISK-QUANT` |
| Optionality | Count/value of follow-on decisions the option opens vs forecloses (§6) | `FIN-MODEL` + `STRAT-DIR` |
| Learning value | Expected reduction in decision-relevant uncertainty (value of information, §6.2) | `EVALUATOR` methodology, applied by assessors |

Composite score = Σ wᵢ · scoreᵢ with the declared weight vector. **[ASSUMPTION]** Default vector W-2026.2: strategic fit 0.20, capital efficiency 0.15, risk-adjusted return 0.35, optionality 0.15, learning value 0.15. Risk-adjusted return dominates because the composite must stay anchored to economics; learning value is nonzero even for late-stage decisions because the portfolio is a learning machine first (`01-philosophy.md`).

The composite ranks options; the EU distribution and risk block (§4) are shown alongside it, never hidden behind it. A high composite with a fat left tail MUST be flagged.

### 3.3 Stage-dependent weight profiles

Early pipeline stages (pre-G-04) SHOULD up-weight learning value and optionality; post-G-07 stages SHOULD up-weight risk-adjusted return and capital efficiency. Profiles are named variants of the base vector (e.g., W-2026.2-early), versioned identically.

### 3.4 Weight governance

- Weight vectors are versioned artifacts (`weight_vector_version` in every DR), stored as knowledge items with full history (`06-knowledge-system.md`).
- Changes are proposed only as Evolution Proposals through `EVOLVE` (`12-self-evolution.md`), with backtests over the DR corpus showing how past decisions would have re-ranked.
- Changes affecting capital-allocation decisions MUST be ratified by the Investment Committee before activation (header note). No agent may run a private weight vector; the Kernel rejects DRs citing unregistered versions. WHY: silently drifting weights are the quietest way an optimization process escapes oversight.

## 4. Risk scoring (`RISK-QUANT` service)

`RISK-QUANT` (under `RISK-DIR`) exposes a scoring service every R2+ DR MUST call. Conceptually:

1. **Loss distribution per option.** From the option's outcome distributions and the venture model (`FIN-MODEL`), derive the distribution of *loss* (negative net value including reversal cost from the rollback plan). Report p(total envelope loss), expected loss, and CVaR₉₅ — the mean loss in the worst 5% of scenarios. CVaR rather than VaR because VaR is blind to tail shape and gameable by pushing loss just past the quantile.
2. **Correlated-risk adjustment.** Ventures are not independent: shared channels, shared model providers, shared regulatory exposure, macro factors. `RISK-QUANT` maintains a portfolio factor model — each venture loads on named factors from the risk register (`13-failure-analysis.md`, `RISK-<category>-<seq>`). An option's *marginal* portfolio risk = risk of portfolio-with-option − risk of portfolio-without, computed on the joint factor simulation. An individually attractive bet that stacks a crowded factor scores worse than a diversifying one of equal standalone risk. WHY: the survival constraint (`08-finance.md` §14) lives at portfolio level, not venture level.
3. **Limit checks.** The option is tested against standing limits: portfolio concentration and correlation limits (`08-finance.md` §8.5), liquidity floor (`08-finance.md` §4), and register-specific limits owned by `RISK-DIR`. A limit breach does not merely lower a score — it hard-blocks autonomous approval and forces escalation to the limit's owning human body, per the queueing mechanic in `appendix-c-decision-gates.md`. Limits are constraints, not preferences; encoding them as score penalties would let a strong enough upside "buy" a limit breach.
4. **Output.** A signed risk block embedded in the DR: distributions, marginal portfolio effect, limit-check verdicts, and the top three risks in ranked plain language (consumed by §8.2).

`RISK-QUANT` operates at A3 for scoring (scores are R1 outputs); it never approves anything — separation of assessment from decision is deliberate.

## 5. Opportunity scoring (pipeline intake)

Used at stages feeding G-01/G-02/G-03 (`05-business-creation-pipeline.md`), on inputs from `SCOUT`, `TRENDS`, `DEEP-RES`, `COMP-INTEL`, `VALIDATOR`.

**Structure.** OppScore = f(Market size, Timing, Wedge quality, Execution fit), combined multiplicatively on normalized [0,1] sub-scores (geometric-mean flavor): a near-zero on any factor should kill the composite, which additive scoring fails to do. A huge market with no viable wedge is worth ~nothing; multiplication encodes that, addition hides it.

- **Market size:** distribution over attainable SOM at year 5, from `TRENDS` growth models and `DEEP-RES` sizing, entered as quantiles (never a single TAM headline — TAM headlines are the canonical garbage input).
- **Timing:** probability that the enabling shift (tech cost curve, regulation, behavior) is in its exploitable window now — penalizing both "too early" (evidence: repeated prior failures of the same idea) and "too late" (evidence: incumbent consolidation, CAC inflation measured by `COMP-INTEL`).
- **Wedge quality:** sharpness of the initial entry — identifiable underserved segment, acute pain, reachable channel — scored against a rubric maintained by `RSRCH-DIR`.
- **Execution fit:** match to portfolio capabilities: playbooks on file (`06-knowledge-system.md`), existing channel/asset reuse, regulatory familiarity. WHY: the same opportunity has different value to different holders; scoring "for us" not "in the abstract" is the point.

**Calibration feedback loop (mandatory).** Every scored opportunity's sub-scores are stored; when the venture reaches an outcome (kill, PMF, scale) or the rejected opportunity's market evolves observably (§11), `EVALUATOR` regresses realized outcomes on historical sub-scores. Sub-scores that carry no predictive weight are candidates for rubric revision via Evolution Proposal; systematic bias (e.g., timing consistently optimistic) is corrected by an explicit calibration transform applied to new scores, with the raw score preserved. WHY: an intake score that is never audited against outcomes converges to institutional astrology.

## 6. Investment scoring: staged funding as real options

### 6.1 Framing

Every funding decision at G-02 through G-08 is scored not as "fund the venture" but as "**buy the option** to make the *next* funding decision with better information." The tranche amounts and approvers per stage are owned by `appendix-c-decision-gates.md`; this section defines how the engine values the purchase.

### 6.2 Value of information (VoI) — conceptual algorithm

1. Enumerate the decision that the *next* stage's evidence will inform (continue / kill / pivot at the following gate).
2. Under current beliefs (prior distribution over venture quality θ), compute the expected value of acting optimally *without* the new information: V_prior = max over actions a of E_θ[value(a, θ)].
3. Model the next stage as an experiment producing signal s with known likelihood p(s|θ) (e.g., validation conversion above/below the pre-registered kill line). Compute the expected value of acting optimally *after* observing s: V_post = E_s[max over a of E_θ|s[value(a, θ)]].
4. **VoI = V_post − V_prior.** Fund the stage iff VoI + direct expected value of stage work > stage cost, where stage cost includes envelope spend *and* the opportunity cost of the pipeline slot.
5. The dominant term in V_post is usually the **kill branch**: information that lets the portfolio stop spending is worth the entire avoided downstream loss times its probability. This is why cheap experiments with sharp, pre-registered kill criteria score so well — they buy expensive information at low cost.

### 6.3 Why staged beats lump-sum (binding rationale)

Lump-sum funding pays today's price for capital that will be deployed under tomorrow's (better) information — it forfeits VoI entirely. Formally, staged funding's value over lump-sum equals the sum of VoI across stages minus staging overhead (re-decision cost, momentum loss). With venture-quality uncertainty as wide as intake-stage priors are, VoI dominates overhead by an order of magnitude; only when uncertainty is nearly resolved (late-stage, post-G-08) does the ordering ever invert, and even then tranching bounds blast radius. Therefore EvolveOS MUST fund through the gate structure of `appendix-c-decision-gates.md` and MUST NOT approve funding that pre-commits envelopes across more than one uncleared gate. Kill criteria are the mechanism that makes the option real: an option you will never exercise (never kill) has zero value, which is precisely the sunk-cost failure staged funding exists to prevent.

## 7. Confidence and uncertainty estimation

### 7.1 Output requirements

Every agent contributing predictions to a DR MUST output one of: (a) a full distribution, (b) 5-point quantiles, or (c) a probability for a discrete event. Naked point estimates are schema-invalid at the Kernel. Every prediction carries an `epistemic_share` ∈ [0,1]: the assessor's estimate of how much of the stated variance is epistemic (reducible by information) versus aleatoric (irreducible randomness of the world).

### 7.2 Why the decomposition matters operationally

- **Epistemic-dominated uncertainty → buy information.** The correct move is usually a §6.2 VoI purchase: run the experiment, do the research, wait for the signal. Committing capital against epistemic uncertainty is paying to avoid homework.
- **Aleatoric-dominated uncertainty → size the bet.** No experiment will narrow it; the correct move is position sizing (envelope size, tranche size, portfolio share per `08-finance.md` §8) and diversification. Running more studies against aleatoric variance is procrastination wearing a lab coat.
- The DR template forces the distinction so the *option set* is correct: high-epistemic decisions must include an information-buying option; high-aleatoric decisions must include differently-sized variants of the same bet.
- **[UNCERTAIN]** Agents' self-reported epistemic_share is itself uncalibrated initially. `EVALUATOR` audits it by checking whether "epistemic" variance actually shrinks after information purchases; persistent failure demotes the field to advisory until calibrated.

### 7.3 Calibration tracking

`EVALUATOR` maintains per-agent, per-decision-class calibration ledgers:

- **Brier score** for event probabilities: mean of (forecast − outcome)², decomposed into calibration and resolution terms so we can distinguish "honest but vague" from "confident and wrong."
- **Log score** for distributions/quantiles: −log density (or pinball loss per quantile) of the realized value; chosen because it is strictly proper — the score is maximized in expectation only by reporting true beliefs, so agents cannot game it by hedging or exaggerating.
- Scores are computed on `post_hoc_outcome` amendments (§2.2), aggregated with exponential time decay **[ASSUMPTION: half-life 180 days — recent behavior predicts current reliability better; revisit when the DR corpus supports empirical tuning]**.
- Consequences: calibration feeds consensus weights (§9), envelope reviews, and retraining/retirement triggers per the glossary's calibration-score entry and `12-self-evolution.md`.

## 8. Human intervention

### 8.1 When humans enter (restating nothing, citing everything)

Humans enter exactly where the autonomy–reversibility matrix (`00-overview.md` §6) and the gate table (`appendix-c-decision-gates.md`) put them: every R3 decision requires a named human approver (A1/A2 ceiling), every R4 decision requires the multi-human quorum of its owning gate, weekly batch review covers A2 gates (G-03, G-04), and G-00 stop authority is always one human. This part adds no approval paths and removes none; it defines what the engine must *deliver* to those humans.

### 8.2 What the human sees (the decision brief)

For each queued decision, the engine MUST render the DR into a brief with a hard structure — in order:

1. The ask, in one sentence, with `reversibility_class`, `gate_id`, and envelope delta.
2. Options table: composite score, EU, p(total loss), CVaR₉₅, one-line summary each — including the deferral option.
3. **Top three risks** in plain language (from `RISK-QUANT`'s ranked block) with the mitigation or its absence stated flatly.
4. **Dissent, verbatim.** Every `dissent_record` entry appears un-summarized. Consensus machinery may weight dissent down (§9); it MUST NOT hide it from humans. A system that filters dissent before the approver sees it has re-invented groupthink at machine speed.
5. Kill criteria and rollback plan (what stops this, who pulls the cord, what it costs to undo).
6. Drill-down links: full DR, evidence packs, simulation traces.

**[ASSUMPTION]** Brief length ≤ 2 pages rendered; drill-down unlimited. The constraint is the design: human attention is the scarcest resource, so the engine's obligation is compression *with* fidelity — surface the decision-relevant structure, keep every underlying byte one click away, and never pre-empt the human's judgment by omission.

### 8.3 What humans may do

Approve, reject, modify-and-approve (recorded as a new option authored by the human), defer with an information request (which becomes a §6.2 VoI task), or invoke G-00. Human overrides of the engine's top-ranked option are gold-label training data and MUST be flagged for `EVALUATOR` review: frequent overrides on a decision class mean the scoring is miscalibrated for it — or the human is — and outcome scoring will eventually say which.

## 9. Voting and consensus among agents

### 9.1 When multiple assessors are convened

Quorum rules by reversibility class of the decision (assessors are agents; human approvals remain per §8.1):

| Class | Minimum independent agent assessors | Mandatory participants |
|---|---|---|
| R2 | 1 (+ post-hoc sampling by `EVALUATOR`) | — |
| R3 | 3 | `RISK-QUANT`, plus the domain director owning the action |
| R4 | 5 | `RISK-QUANT`, `FIN-MODEL`, domain director, plus one assessor from *outside* the requesting domain (fresh-eyes rule) |

"Independent" means: no assessor may be the requesting agent, a sub-agent of the requesting agent, or share the requesting agent's immediate director when an outside assessor is mandated. WHY: correlated assessors are one assessor with extra steps.

### 9.2 Calibration-weighted aggregation (conceptual algorithm)

1. Each assessor i submits, per option: outcome distribution(s), criterion scores, an option ranking, and confidence.
2. `EVALUATOR` supplies each assessor's calibration weight for this decision class: wᵢ ∝ 1/(ε + B̄ᵢ), where B̄ᵢ is the time-decayed Brier/log-score loss on that class and ε prevents divide-by-zero deification of a lucky streak. Assessors with < 20 scored predictions in the class receive the class-median weight shrunk 50% toward uniform **[ASSUMPTION — cold-start prior; revisit with data]**.
3. Aggregate distributions as the weighted mixture (not weighted average of parameters — mixtures preserve multi-modality, and a bimodal "either it works or it dies" belief is decision-relevant structure that parameter-averaging destroys).
4. Aggregate rankings by weighted Borda count over the composite scores.
5. **Dissent preservation:** any assessor whose top option differs from the aggregate winner, or whose p(total loss) for the winner exceeds the aggregate's by more than 2×, automatically generates a `dissent_record` entry carried into the DR and the human brief (§8.2.4). Dissent is never averaged away; it is attached.

### 9.3 [DECISION] Aggregation mechanism — alternatives compared

- **Simple majority / unweighted average.** Rejected. Treats a chronically miscalibrated assessor as equal to a well-calibrated one, discards exactly the information `EVALUATOR` exists to produce, and invites quorum-stuffing with cheap correlated agents.
- **Prediction-market-style internal markets** (assessors stake calibration-capital on outcomes; prices aggregate belief). Attractive: incentive-compatible, continuous, self-liquidating. Rejected *for now*: markets need enough independent participants and event volume to make prices informative; with tens of agents whose errors correlate (shared base models, shared evidence), thin markets produce noise dressed as prices, plus manipulation surface. **[UNCERTAIN]** Revisit via Evolution Proposal once the registry exceeds ~100 independent assessing instances and ≥ 1,000 scored predictions/quarter per major decision class; run markets in shadow mode against §9.2 first (`12-self-evolution.md`).
- **Calibration-weighted aggregation with mandatory dissent preservation — CHOSEN.** Uses the calibration ledger we must maintain anyway, degrades gracefully to near-uniform weights at cold start, and keeps minority signal visible to humans instead of arbitraging it away. Cost: weights lag ability shifts (decay half-life) and inherit any bias in outcome scoring; both are audited by `EVALUATOR` regression tests.

### 9.4 Divergence escalation

If assessor distributions diverge beyond threshold (e.g., non-overlapping interquartile ranges on the primary metric), the engine MUST NOT silently aggregate: it triggers a structured adversarial round (assessors exchange evidence-pack critiques once, then re-submit), and if divergence persists, the DR is flagged `contested` — which caps autonomous approval at A1 regardless of class. Persistent disagreement between calibrated assessors is information: it usually means the evidence pack is thinner than anyone's confidence.

## 10. Simulation

### 10.1 Monte Carlo over venture models (mandatory for R3+)

For every R3+ DR with material economic consequence, `RISK-QUANT` runs Monte Carlo over the venture's financial model supplied by `FIN-MODEL`:

1. `FIN-MODEL` expresses the venture as a driver graph (acquisition → activation → retention → revenue → cash) with each driver a distribution, not a constant, and with declared correlations (e.g., CAC and churn both load on "segment fit").
2. `RISK-QUANT` samples the joint driver space (≥ 10,000 paths **[ASSUMPTION — enough for stable p05/p95 on the metrics we report; increase if tail estimates wobble across seeds]**), propagates through the model, and emits outcome distributions per option — these are the distributions the DR reports, so scoring and simulation cannot drift apart.
3. Sensitivity: rank drivers by contribution to output variance (Sobol-style variance decomposition, conceptually: how much does p95−p05 shrink if this driver is pinned?). Top sensitivities feed §6.2 — the highest-VoI experiment is usually aimed at the highest-sensitivity epistemic driver.

### 10.2 Scenario trees for sequenced decisions

Where decisions arrive in sequence (fund stage → observe → fund next), simulation MUST respect the decision structure: a tree whose branch points are *decisions under the policy that will actually be used* (including kill criteria), not a straight-line cash projection. Valuing a staged venture with a no-decision Monte Carlo understates it (ignores the value of killing bad branches) — this is the computational twin of §6.3.

### 10.3 Agent-based market simulation

Warranted only where interaction effects dominate aggregate elasticities: marketplace liquidity dynamics, pricing wars with a reactive competitor, network-effect cold starts. `RISK-QUANT` builds these on request from `STRAT-DIR`/`PROD-DIR`; results enter DRs as *scenario evidence*, never as calibrated probability — ABM outputs are sensitive to behavioral assumptions we cannot validate at build time.

### 10.4 Limits of simulation (binding humility)

Simulations condition on the model being roughly right; the dominant venture-stage risk is that it is not (unknown unknowns, reflexivity — our own entry changes the market, adversarial response). Therefore: simulation results MUST be labeled with model-confidence notes; no simulation output may relax a limit check (§4.3) or substitute for a pre-registered kill criterion; and DR briefs MUST show the simulation's key assumptions next to its outputs. A precise distribution from a wrong model is more dangerous than an honest interval.

## 11. Counterfactual reasoning

### 11.1 The counterfactual ledger

Per the glossary (`appendix-a-glossary.md`), the counterfactual ledger records decisions *not* taken. Mechanically: every DR's rejected options — including every kill at G-03/G-15 and every rejected intake at G-01/G-02 — carry `predicted_outcome_distribution`s and a `counterfactual_tracking` block naming **observable proxies** and a review date. Storage and retrieval live in `06-knowledge-system.md`; scoring logic lives here.

### 11.2 Scoring rejected options against reality

At each review date, `EVALUATOR` (with inputs from `COMP-INTEL`, `TRENDS`, `INSIGHT`) scores the prediction against the proxy: for a killed market, the subsequent trajectory of that market and of competitors who did enter (funding, traction, shutdowns); for a rejected vendor, the chosen vendor's realized performance against the rejected bid; for a passed acquisition, the target's later disclosed performance. The result amends the originating DR's `post_hoc_outcome` for the rejected option and feeds:

- **Calibration** (§7.3): kills are predictions too; an agent that only gets scored on what we *did* learns to be optimistic about action and pessimistic about inaction, unchecked.
- **Kill-criteria tuning:** systematic patterns — e.g., markets killed on criterion kc-X subsequently flourishing at rate above the criterion's implied false-kill rate — trigger Evolution Proposals to re-threshold that criterion class. This is how gate precision/recall (§13.2) becomes improvable rather than merely measurable.

### 11.3 Selection-bias limits [UNCERTAIN]

Counterfactual scoring is structurally biased and MUST be labeled as such in every readout: (a) proxies are observable only for *rejected* paths that someone else pursued — markets nobody entered stay dark, so the sample over-represents contested spaces; (b) a competitor's success in a killed market does not establish *we* would have succeeded (execution fit, §5, differs); (c) survivorship in proxy sources (funded competitors are visible, quiet failures are not) inflates apparent false-kill rates. Mitigations: report counterfactual scores with explicit proxy-quality grades; use them to tune *thresholds and calibration*, never as stand-alone justification to overturn a class of decisions; and let `CURATOR` flag proxy sources with known survivorship distortion. The ledger's honest yield is directional bias correction, not decision-grade counterfactual truth.

## 12. Rollback

### 12.1 Mandatory plans

Every DR ≥ R2 MUST contain a rollback plan (§2.2) authored *before* approval: triggers, executable steps (`steps_ref` pointing at a runbook or playbook per `06-knowledge-system.md`), owning agent, accountable human role, and a worst-case rollback cost estimate. The cost estimate is load-bearing: it is an input to the reversibility classification itself — if the honest rollback cost estimate exceeds the R-class bounds of `00-overview.md` §5, the decision is *misclassified* and MUST be re-classed upward before approval. Rollback planning is thus also the system's reversibility auditor.

### 12.2 Trigger monitoring

Rollback triggers (kill-criteria trips, envelope breaches, incident severities) are registered with Kernel Watchdogs at DR execution time and monitored automatically — not by the executing agent, whose incentives point the wrong way. A tripped trigger: (a) for R1/R2 scope, MAY auto-execute rollback at the executing agent's ceiling (e.g., `RELEASE`'s automatic rollback); (b) for R3+ scope, halts further forward execution (queue, not crash) and escalates to the rollback plan's human owner; (c) in emergencies, anyone authorized invokes G-00 — and per the stop asymmetry in `appendix-c-decision-gates.md`, restart needs the owning gate's approver set.

### 12.3 Semantics by reversibility class

- **R2:** rollback = actual restoration within the ≤ 30-day/≤ $50k bounds; plans SHOULD be mechanically executable (scripts, config reverts, campaign pauses).
- **R3:** full restoration is by definition costly; plans are *mitigation ladders* — exit clauses negotiated into contracts in advance (`CONTRACTS`), grandfathering paths for pricing reversions, staged de-launch sequences. The plan's job is to pre-purchase the cheapest available exit, at contract time when it is cheap, not at crisis time when it is not.
- **R4:** genuine rollback does not exist; the "plan" is a containment plan (liability caps, unwind provisions, communication sequences via G-17, data disposition). R4 briefs MUST say "this cannot be undone; containment only" in those words — euphemism at R4 is a safety defect.

### 12.4 Post-rollback learning capture

Every executed rollback produces: a DR of type `rollback_execution` (rollbacks at R2+ are themselves decisions), an amendment to the original DR linking realized rollback cost vs the estimate (mis-estimates feed §13.2 and reclassification audits), and a post-mortem knowledge item routed through `CURATOR`. Rehearsal: rollback plans for R3+ DRs SHOULD be rehearsed in sandbox where mechanically possible, flipping `rehearsed: true`; an unrehearsed plan is a hypothesis.

## 13. Decision latency budgets and quality metrics

### 13.1 Latency budgets (engine-side)

These budgets cover the engine's own span — decision requested → DR `assessed` and brief rendered. Human/gate approver SLAs are owned by `appendix-c-decision-gates.md` and are additive; this part deliberately does not restate them.

| Class | Engine budget (request → brief ready) | Rationale |
|---|---|---|
| R1 | ≤ 1 hour (no DR; envelope check only) | Volume; reversal is cheap by definition |
| R2 | ≤ 24 hours | Full DR with single assessor is mostly retrieval + modeling |
| R3 | ≤ 5 business days | 3-assessor quorum, Monte Carlo, adversarial round if contested |
| R4 | ≤ 15 business days | 5-assessor quorum, scenario trees, fresh-eyes review, red-team where gated |

**[ASSUMPTION]** Budgets set to keep the engine off the critical path of `appendix-c-decision-gates.md` SLAs while forbidding analysis sprawl. Breaches are reported weekly to `PRIME`; chronic breach on a class is an Evolution Proposal trigger (either the budget or the process is wrong). Deadline pressure MUST degrade *scope* (fewer secondary metrics, coarser simulation) transparently in the DR, never silently degrade quorum or skip limit checks — those are floors.

### 13.2 Decision-quality metrics (owned by this part, computed by `EVALUATOR`, reported to `PRIME` and the Audit & Risk Committee)

1. **Calibration** — per-agent and system-level Brier/log scores by decision class (§7.3), plus calibration of the *aggregate* (is the consensus better than its best member? it should be).
2. **Regret vs realized best option** — for outcome-scored DRs: realized value of chosen option minus best estimated realized value among all options (using counterfactual proxies for rejected ones, with §11.3 bias grades attached). Tracked as a distribution per decision class; rising median regret in a class means the scoring layer is mis-ranking there.
3. **Gate precision/recall on kills** — precision: of ventures killed, the fraction whose counterfactual proxies later confirm the kill; recall: of ventures that failed downstream, the fraction whose pre-registered kill criteria had flagged them at an earlier gate. The pair is reported together because each is trivially gameable alone (kill everything → perfect recall; kill nothing → undefined precision). Target movement, not target values, is the honest early goal **[UNCERTAIN — baselines unknowable until the first full pipeline cohorts complete]**.
4. **Human-override rate and override-regret** — how often humans overrule the engine's top option, and who turned out right (§8.3). Both directions are diagnostic: near-zero override rate suggests rubber-stamping; high override-with-human-regret suggests briefs are mis-framing.
5. **Rollback health** — trigger hit rate, rollback cost estimate error, time-to-execute vs plan.
6. **DR hygiene** — completeness at approval time, fragmentation-rule triggers (§2.4), contested-flag frequency.

These metrics are themselves inputs to `12-self-evolution.md`: the decision engine is inside the improvement loop it powers, and its change class (header) exists precisely so that improving it never requires — or permits — quietly amending the constitutional rules it operates under.
