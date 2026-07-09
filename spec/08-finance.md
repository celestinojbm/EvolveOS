# EvolveOS Specification — Part VIII: Finance

**Status:** Draft v0.1 · **Change class:** R3 (standard amendment process, Part XII)

> **Scope of change class.** Prose and mechanisms here amend as R3 via Part XII (`12-self-evolution.md`), with carve-outs: (a) treasury policy (§4) — instrument whitelist, counterparty limits, liquidity floor — MUST be ratified by the Investment Committee, and re-ratified alongside the threshold re-ratification duty in `appendix-c-decision-gates.md`; (b) anything touching gate thresholds, approver sets, or the autonomy–reversibility matrix is Constitutional and changes only via G-16. This part **owns budget-envelope structure** per `00-overview.md` §9; the dollar amounts attached to gates remain owned by `appendix-c-decision-gates.md` and are only cited here.

Cross-references: `00-overview.md` (taxonomies, ownership rules), `appendix-b-agent-registry.md`, `appendix-c-decision-gates.md`, `05-business-creation-pipeline.md` (stages), `06-knowledge-system.md` (knowledge items, playbooks), `07-decision-engine.md` (DRs, VoI, risk service), `09-technology.md` (cells, metering), `10-security.md` (Kernel, audit log), `11-governance.md` (IC, CFO, Board), `13-failure-analysis.md` (risk register).

---

## 1. Purpose and design stance

Finance in EvolveOS is not a back office; it is the **selection environment**. Capital allocation is how the portfolio expresses beliefs, budgets are how autonomy is bounded in dollars, and unit economics are how ventures are compared without self-report. Three commitments:

1. **One source of financial truth, agent-writable but never agent-mutable** (§2).
2. **Money moves only inside envelopes or through gates** — the financial system is the physical enforcement of `00-overview.md` §6, denominated in dollars.
3. **Every forecast is a scored prediction.** Finance produces more labeled predictions than any other domain (forecasts, budgets, valuations); wasting that calibration signal would be negligent (§6.3, `07-decision-engine.md` §7.3).

## 2. [DECISION] The financial source of truth: event-sourced double-entry ledger

### 2.1 The decision

EvolveOS's financial source of truth is an **event-sourced, double-entry ledger**: every economic event (invoice issued, payment received, payroll run, cloud charge metered, envelope granted, transfer executed) is an immutable, append-only, Kernel-signed event; all books — journals, per-entity general ledgers, trial balances, consolidated statements — are **derived, reproducible projections** of the event stream through versioned posting rules. Corrections are new reversing/adjusting events, never edits.

Alternative considered: **conventional ERP-first** — adopt a commercial ERP as the system of record and have agents operate it through its APIs.

### 2.2 Why event-sourced wins (justification)

- **Auditability.** Agents will generate financial writes at a volume and speed no human bookkeeping control was designed for. An append-only stream with hash-chained Kernel signatures (`10-security.md`) gives bit-level, replayable audit: any balance at any time is recomputable from events, and any discrepancy localizes to a specific event or posting-rule version. ERP audit trails are mutable-by-design at the record level and opaque at the derivation level.
- **Multi-entity consolidation.** The portfolio continuously forms, merges, and dissolves entities (G-07, G-13, G-15). With entity tags on events and entity-scoped projections, consolidation and inter-company elimination are *queries over one stream*, and a restructuring is a re-projection — not a months-long ERP re-implementation per entity.
- **Agent-writability with Kernel enforcement.** Agents never write "into the books"; they emit typed economic events through the Kernel, which validates schema, envelope authority (does this agent's envelope cover this event class and amount?), and double-entry integrity (balanced postings per posting rule) *before* append. The security model is enforced at the single choke point we already trust, rather than replicated across an ERP's permission matrix.
- **Learning.** The event stream is simultaneously the finance system of record and the highest-quality behavioral dataset in the portfolio (every economic action, timestamped, attributed) — feeding `UNIT-ECON`, forecast scoring, and the DR outcome amendments of `07-decision-engine.md` §2.2 with zero reconciliation.

Costs accepted: we must build and maintain posting rules, projections, and controls that ERPs ship with; derived views are eventually consistent (bounded staleness SLOs in §16); and statutory/tax outputs still require conventional formats. Mitigation **[ASSUMPTION]**: derived books are exported on a schedule into a commercial accounting package used as a *read-only reporting surface* for auditors and tax preparers — the package is downstream, never authoritative. If a regulator or auditor requires attestation against the commercial package, the export pipeline itself is in audit scope. This hybrid is revisited once external audits have been passed twice **[UNCERTAIN — auditor acceptance of event-sourced primary records is plausible but unproven for us; the export hedge exists for exactly this reason]**.

### 2.3 Binding rules

- All economic events MUST flow through the Kernel event API; no agent or human writes directly to projections. Human corrections are also events, signed by the human's identity.
- Posting rules are versioned knowledge items (`06-knowledge-system.md`); changing a posting rule is R2 (re-projection is cheap and reversible), but changing a rule with revenue-recognition or tax effect is R3 and requires CFO approval as the named human under the autonomy–reversibility matrix.
- Projections MUST be deterministically reproducible: same events + same rule versions = same books, verified by scheduled replay checks run by `ARCHIVIST` alongside its audit-log integrity duties.

## 3. Accounting

### 3.1 Chart-of-accounts strategy

- One **canonical portfolio CoA template**, owned by `FIN-DIR`, from which every entity's chart is instantiated. Account codes are structured: `<entity>.<statement class>.<canonical account>.<venture extension>`, with venture-specific accounts allowed only in reserved extension ranges and only by mapping to a canonical parent.
- WHY: cross-venture comparability (§9) dies the day two ventures book the same economic reality to differently-shaped accounts. The template makes consolidation and benchmarking structural rather than heroic.
- New entities (formed at G-07) receive their chart automatically at formation; `LEDGER` maintains mappings; unmapped extension requests queue to `FIN-DIR` (A2 exception path).

### 3.2 Close automation

- `LEDGER` runs a **continuous close**: reconciliation (bank feeds vs events, subledger vs GL projections), accrual generation, and inter-company matching run daily, so period-end is a cutoff plus review, not a scramble.
- Target: monthly close ≤ 3 business days **[ASSUMPTION — aggressive for multi-entity but realistic when reconciliation is continuous and books are derived; re-baseline after the first two quarters of operation]**. Close SLA is owned by this part.
- Close checklist per entity is a playbook (`06-knowledge-system.md`); human sign-off of the close package by the CFO (or delegate) is required before statements are released internally — the close itself is R1/R2 mechanics, but *releasing* statements that downstream decisions consume is a control point.

### 3.3 Revenue recognition

- A **policy library** keyed by business-model archetype: SaaS (ratable over service period, with usage components recognized as delivered), marketplace (gross-vs-net determination documented per the control/inventory-risk criteria, take-rate recognized net where EvolveOS is agent), services (milestone or percentage-of-completion per contract). Each venture is assigned exactly one policy set at G-05/G-06 packet time.
- Adopting or changing a venture's rev-rec policy is **R3** (it changes reported reality for external parties) → CFO approval as named human; the change is a DR with the old/new policy diff.
- `LEDGER` enforces recognition mechanically via posting rules; deferred revenue and contract-asset schedules are projections, recomputable per §2.3.

### 3.4 Consolidation

Consolidated statements are a projection over all entity streams with elimination rules for inter-company events (management fees, shared-cost recharges §12, inter-company loans from treasury §4). Because inter-company transactions are *single events with two entity legs*, elimination is exact by construction — the classic consolidation failure mode (mismatched inter-company bookings) is structurally impossible, which is a further §2.2 justification.

## 4. Treasury

Operated by `TREASURER` under `FIN-DIR`; ultimate human authority is the **CFO** (`11-governance.md`). `TREASURER`'s ceiling is A1 for movements per `appendix-b-agent-registry.md` — it prepares, humans execute approval.

### 4.1 Cash management policy (IC-ratified per header note)

- **Instrument whitelist [ASSUMPTION]:** insured deposits, treasury bills / government money-market funds, and investment-grade short-duration instruments; nothing with principal risk beyond that, no leverage, no crypto treasury. Yield is not the treasury's job; survival is.
- **Counterparty diversification [ASSUMPTION]:** no more than 25% of total portfolio cash with any single banking counterparty; no more than 50% with counterparties sharing a common failure mode (same sponsor bank, same sweep network). `TREASURER` monitors continuously and proposes rebalancing sweeps when drift exceeds 5 points.
- **Liquidity floor [ASSUMPTION]:** portfolio-level unrestricted liquidity ≥ 12 months of forward portfolio burn at the current 13-week forecast (§6.1) run-rate. The floor is a hard limit registered with `RISK-QUANT` limit checks (`07-decision-engine.md` §4.3): any decision whose funded downside would breach the floor hard-blocks and escalates to the IC. This is the survival constraint of §14 made operational.

### 4.2 Movement authorities in R/A terms

- **Internal, within-whitelist repositioning** (between portfolio accounts, within policy): R2; `TREASURER` prepares, executes at A1 with CFO-delegate approval; batches reviewed weekly.
- **All external transfers are ≥ R3** (they touch external parties and are costly to claw back): named human approval per the autonomy–reversibility matrix — CFO or written delegate, with two-human verification on first-time payees (payment-fraud control, with `FRAUD-WATCH` screening pre-release).
- **Movements that are capital deployment > $1M, inter-company capitalization of ventures, or new financing** are R4 per `00-overview.md` §5 and occur only pursuant to their owning gates: venture funding via G-07/G-08, acquisitions via G-12, wind-down disbursements via G-15. Treasury executes gate-authorized movements; it never originates R4 authority.
- Venture entities hold only **operating float [ASSUMPTION: ≤ 8 weeks of that venture's forecast burn]**; excess sweeps to portfolio treasury. WHY: cash sitting in venture accounts is cash outside portfolio-level counterparty and liquidity controls.

## 5. Budgeting: the envelope system (structure owned by this part)

### 5.1 Envelope hierarchy

Envelopes are the glossary's policy/budget envelopes with a defined decomposition. Structure:

```
Portfolio capital plan (IC, annual + quarterly reforecast)
└── Venture envelope        granted at gates; amounts owned by appendix-c
    └── Departmental envelope   per venture function (growth, eng, ops, …)
        └── Agent envelope       per agent instance, per period
            └── Task-contract slice   per delegated task (Part IV task contract)
```

Every envelope is a tuple: **{amount, period, category constraints (what classes of spend), counterparty constraints, rate limits (max per transaction / per day), tool and data-class bindings, expiry}**. The non-monetary members exist because the glossary envelope is a *policy* envelope: dollars and permissions travel together, and the Kernel checks the whole tuple on every event (§2.3).

**Decomposition invariants (Kernel-enforced):**
1. Sum of child envelope amounts ≤ parent amount − parent reserve. **[ASSUMPTION]** Default reserve retained at venture level: 10% of the venture envelope, releasable only by `VENTURE-ORCH` with `FPA` concurrence.
2. Child constraints MUST be equal to or stricter than parent constraints on every dimension (no child may spend a category its parent cannot).
3. A task-contract slice inherits from the delegating agent's envelope and is destroyed with the worker (`appendix-b-agent-registry.md` T4 rules).

### 5.2 Zero-based per stage

Venture envelopes do **not** roll over across gates. Each gate pass grants a fresh envelope (amount per `appendix-c-decision-gates.md`) against a zero base, justified by the stage plan in the gate DR; unspent balances from the prior stage are returned to portfolio treasury at gate time. WHY: rollover converts budgets into entitlements and hides the real cost of each stage; zero-basing keeps every stage's spend a live decision, consistent with the staged real-options framing (`07-decision-engine.md` §6).

### 5.3 Variance monitoring and automatic freezes

`FPA` monitors every envelope continuously against its stage plan:

- **Yellow** at ≥ 80% consumption before 80% of period elapsed, or category variance > 15% vs plan **[ASSUMPTION — starting thresholds; tune on false-positive rate]**: alert to envelope owner and its parent owner; no enforcement change.
- **Breach** (consumption reaching 100%, or a constraint violation attempt): the Kernel **automatically freezes** the envelope — further spend events queue rather than execute, which is exactly the glossary's A→A1 conversion and the queueing mechanic of `appendix-c-decision-gates.md`, applied to money. Unfreezing requires the parent envelope owner (agent within its ceiling, else the human owner) via a DR.
- Freezes are blunt by design: a frozen ad campaign is R2 damage; an unbounded one is not. `FPA` reports freeze frequency per agent as an input to envelope-sizing revisions and to `EVALUATOR` (chronic breachers are miscalibrated planners).

## 6. Forecasting

### 6.1 Rolling 13-week cash forecast

Produced weekly by `TREASURER` with `FPA`, per entity and consolidated: receipts (AR aging × collection curves per archetype §7), disbursements (payroll, AP, envelope drawdown schedules), and treasury movements. This is the liquidity-floor (§4.1) measurement instrument; a projected floor breach anywhere in the 13 weeks is an automatic escalation to CFO and IC.

### 6.2 18-month driver-based forecast

Refreshed quarterly (and at every G-07/G-08 packet) by `FPA` with `FIN-MODEL`: driver graphs (the same driver structure `RISK-QUANT` simulates, `07-decision-engine.md` §10.1) per venture, aggregated to portfolio. Driver-based, never trend-line: forecasts must break when an assumption breaks, visibly, driver by driver.

### 6.3 Forecast error as a first-class learning metric

Every forecast is stored as a scored prediction: MAPE and signed bias per line, per horizon, per forecasting agent, computed against actuals from the ledger (§2) with no manual reconciliation. `EVALUATOR` folds these into the calibration ledgers of `07-decision-engine.md` §7.3 — a persistently optimistic `FPA` instance is a calibration defect with a paper trail. Portfolio-level forecast-error trend is a component of the portfolio learning rate (`appendix-a-glossary.md`; reported per `01-philosophy.md` metrics).

## 7. Cash flow and working capital by archetype

Working-capital policy is set per business-model archetype at G-05/G-06 packet time, monitored by `FPA`:

- **SaaS:** favor annual prepay with discount guardrails via `DEALDESK` policy (§11); deferred revenue is a financing asset — negative working capital is the goal; collections playbook automated by `LEDGER` (dunning within `LIFECYCLE` messaging envelopes).
- **Marketplace:** segregate GMV float from own cash *operationally and in the books* (distinct event types and accounts; float is never counted toward liquidity floor §4.1); payout timing policy balances supplier trust vs float benefit and is R3 to change (touches external parties at scale); reserve for chargebacks per `FRAUD-WATCH` loss curves.
- **Services:** milestone billing with deposits; WIP tracked as contract assets (§3.3); utilization forecast feeds the 13-week cash directly since payroll is the dominant outflow.

**[ASSUMPTION]** Archetype list starts with these three; new archetypes (hardware, fintech with regulatory capital, etc.) require a working-capital policy addendum before any G-05 pass for a venture of that archetype — a venture without a working-capital policy is unbudgetable.

## 8. Capital allocation: the portfolio algorithm

### 8.1 The funnel as an options book

Portfolio capital is deployed as a book of staged real options across the pipeline (`05-business-creation-pipeline.md`): many cheap options early (G-01–G-04 envelopes), few expensive commitments late (G-07/G-08). Amounts per stage are owned by `appendix-c-decision-gates.md`. The engine's option-valuation logic is `07-decision-engine.md` §6; this section owns the *portfolio-level* discipline that sits above individual gate decisions.

### 8.2 Periodic reallocation

Quarterly, `PORTFOLIO` produces a reallocation proposal: pipeline throughput vs plan, per-venture marginal returns (realized + §6.2 forecast), kill/recycle summary, and a proposed division of the next quarter's deployable capital across (a) new intake (G-01–G-04 funnel budget), (b) committed venture tranches, (c) reserves. The proposal goes to the **IC**; tranche approvals occur at **G-08** per its approver set. `PORTFOLIO` proposes; the IC disposes — reallocation is R4-adjacent capital steering and stays human-decided.

### 8.3 Kill-and-recycle discipline

Capital released by kills (G-03 verdicts, G-15 shutdowns) and by §5.2 zero-basing returns to the deployable pool *in the same quarter*. Kill-and-recycle velocity — dollars recycled × redeployment lag — is a named portfolio KPI: the funnel's economics depend on the kill branch actually returning capital, not stranding it (`07-decision-engine.md` §6.2's kill-branch VoI argument, in cash terms).

### 8.4 Reserves

**[ASSUMPTION]** Portfolio MUST hold: (a) an **opportunity reserve** ≥ 15% of annual deployable capital (for out-of-cycle opportunities — competitive responses, acquisition windows at G-12); (b) a **follow-on reserve** sized so every post-G-07 venture on plan can receive its next modeled tranche without new financing (avoid diluting winners because losers consumed the plan); (c) the liquidity floor of §4.1, which is senior to both. Reserve levels are IC-ratified with treasury policy.

### 8.5 Portfolio construction constraints (registered as `RISK-QUANT` limits)

**[ASSUMPTION — all initial values; IC re-ratifies with the threshold-re-ratification duty in `appendix-c-decision-gates.md`]**
- **Single-venture concentration:** ≤ 25% of total deployed capital in any one venture, measured at cost.
- **Correlation limit:** ≤ 40% of deployed capital in ventures loading on the same dominant risk factor from the `13-failure-analysis.md` factor model (same channel dependence, same model-provider dependence, same regulatory regime) — enforced via `07-decision-engine.md` §4.2's marginal-portfolio-risk computation.
- **Stage diversification:** post-G-07 ventures ≤ 70% of deployed capital, so the funnel is never starved to feed scale-stage incumbents; and ≥ 3 ventures in G-02–G-06 stages at any time, else intake is failing.

### 8.6 [DECISION] Sizing rule: Kelly-inspired vs fixed-tranche staging

- **Kelly-inspired sizing** (bet fraction ∝ edge/odds, i.e., size each venture's allocation by estimated expected log-growth contribution): theoretically the growth-optimal policy for §14's objective, and beautifully aligned with log-utility (`07-decision-engine.md` §3.1.2). Rejected as the *mechanical* rule: Kelly is savagely sensitive to the edge estimate, and our edge estimates come from agents whose calibration is, by construction, unproven in the early years (`07-decision-engine.md` §7.3 cold start). Full-Kelly on overestimated edge is the classic ruin recipe; even fractional Kelly inherits the estimation problem, just scaled.
- **Fixed-tranche staging** (standard envelope per gate, per `appendix-c-decision-gates.md`): robust to estimation error, simple to enforce, but throws away real information when calibrated conviction genuinely differs across ventures.
- **CHOSEN: fixed tranches at gates, with Kelly-informed sizing inside IC discretion.** Gate envelopes stay standardized (predictable, gameproof, Kernel-enforceable). At G-08 — where tranches are "per IC resolution" — `FIN-MODEL` MUST present a fractional-Kelly calculation (with the calibration grade of its inputs attached) as *decision support*, and the IC MAY size within its resolution authority accordingly. As calibration scores mature and demonstrate genuine edge-estimation skill, an Evolution Proposal MAY narrow the gap toward systematic Kelly-fractional sizing **[UNCERTAIN — earliest plausible after ~2 years of scored outcomes]**. WHY this split: it puts the estimation-fragile math where a human quorum absorbs it, and keeps the Kernel-enforced layer estimation-free.

## 9. Unit economics (`UNIT-ECON`)

One metric dictionary, portfolio-wide, instrumented identically in every venture. Definitions are versioned knowledge items co-owned by `UNIT-ECON` and `INSIGHT` (metric definitions are `INSIGHT`'s registry; economics semantics are `UNIT-ECON`'s):

- **CAC by channel:** fully loaded — media spend + creative/agency + attributable agent compute (metered per §12) + tooling — divided by new customers attributed under the portfolio-standard attribution model. Blended CAC is reported but never used for channel decisions.
- **LTV:** discounted contribution margin over the retention curve — cohort-empirical curves once ≥ 2 quarters of cohort data exist, archetype priors before that (flagged as prior-based) — discounted at the venture's hurdle rate (§10). LTV without discounting and without margin (revenue-LTV) is prohibited in DRs; it flatters everything.
- **Contribution margin:** revenue − COGS − variable service costs (including metered AI/infra per §12) − variable payment/support costs. The line between contribution and fixed is defined in the dictionary, not per venture.
- **Payback:** months for cumulative per-customer contribution to cover CAC, computed on cohorts, undiscounted (it is a liquidity metric, not a value metric — §6.1 consumes it).

**WHY identical instrumentation is a moat:** cross-venture comparability is what lets `PORTFOLIO` reallocate on evidence (§8.2) and lets playbooks transfer with their economics attached (`06-knowledge-system.md`). A portfolio whose ventures each define CAC conveniently has no portfolio brain — it has anecdotes. Deviation from dictionary definitions is a data-quality incident, not a style choice.

## 10. ROI and hurdle rates

**[ASSUMPTION]** Hurdle rates by risk class of investment (annual, on invested capital; IC-ratified):

| Investment class | Hurdle |
|---|---|
| Portfolio infrastructure / shared platform | 15% |
| Post-G-08 scaling investment in a venture with proven cohorts | 25% |
| G-07 seed-stage capital | 40% |
| Pre-G-07 pipeline spend | evaluated as options/VoI (`07-decision-engine.md` §6), not IRR — demanding IRR of an option purchase is a category error |

**Learning value credited explicitly.** Experiment ROI = direct expected value + **learning credit**, where learning credit = the VoI computed at approval (`07-decision-engine.md` §6.2), carried as a separate, labeled line — never blended into revenue projections. Cap: learning credit MAY NOT exceed 100% of experiment cost without `PORTFOLIO`-level review **[ASSUMPTION]**; uncapped learning credit rationalizes any spend as "research." Post-hoc, `EVALUATOR` scores whether the claimed information was actually obtained (did the posterior move? was the next decision changed?) — learning credit is a prediction and gets calibrated like one.

## 11. Pricing (`PRICER`)

- **Research and test methods:** willingness-to-pay research (van Westendorp, Gabor–Granger), conjoint for feature/tier structure, and controlled elasticity experiments — run pre-launch in validation contexts, and post-launch only inside experiment scopes approved at G-05/G-06 (new-cohort-only tests, geo/segment splits). Experiment design methodology per `DATA-DIR` standards.
- **Guardrails:** changes to live prices for existing customers are **R3** (public, contractual, trust-bearing) — `PRICER` operates at A1 for them per `appendix-b-agent-registry.md`, requiring the named human approver under the matrix, with grandfathering/migration terms in the DR's rollback plan (a pricing rollback is a mitigation ladder, `07-decision-engine.md` §12.3). Public pricing-page and packaging announcements additionally clear **G-17**.
- **Discounts:** exclusively via `DEALDESK` under the discount policy schedule (max discount by deal size/term, approval ladder above schedule). `PRICER` sets the schedule (policy change = R2 within bands, R3 if it changes published pricing posture); `DEALDESK` enforces per-deal. Off-schedule discounts queue to `SALES-DIR`'s human chain. WHY the split: list-price strategy and per-deal exception-making corrupt each other when one agent owns both.

## 12. Profitability and shared-cost allocation

- **Venture P&L standard:** monthly management P&L per venture from ledger projections (§2): revenue per §3.3 → contribution margin per §9 dictionary → venture opex → **venture EBITDA before allocated overhead** → allocated shared costs → fully loaded venture P&L. Both lines are always shown; hiding either invites the two classic lies (ventures look great excluding real costs; or look doomed under arbitrary overhead).
- **Metered direct costs:** infrastructure and AI/model costs are **metered per venture per cell** (`09-technology.md` metering; cells make attribution physical) and booked as venture COGS/opex at actual metered cost — not allocated, *metered*. WHY: honest unit economics require true costs; an AI-operated venture whose dominant variable cost (compute/inference) is socialized across the portfolio has fictional contribution margins, and every §9 metric downstream of them is fiction too.
- **Allocated shared costs:** genuinely shared services (Kernel, knowledge system, portfolio agents like `PRIME`/`PORTFOLIO`, human governance) are allocated by declared drivers (e.g., agent-hours consumed, event volume) — but *portfolio-level* costs with no venture driver (Board, fund administration, this specification) stay at portfolio level, unallocated. Allocation keys are reviewed annually by `FIN-DIR`; gaming an allocation key is a data-integrity incident.
- Venture-level profitability reviews feed G-08 (scale), G-13 (restructure), G-15 (shutdown) packets.

## 13. Acquisitions (with `CORPDEV-DIR` / `MNA-ANALYST`, gate G-12)

- **Valuation discipline:** every target valued three ways by `MNA-ANALYST` under `CORPDEV-DIR` — (a) DCF on driver-based models built with `FIN-MODEL` (with `RISK-QUANT` Monte Carlo, since point DCFs at G-12 would violate `07-decision-engine.md` §3.1); (b) comparable transactions/multiples; (c) **build-vs-buy replacement cost** — what would EvolveOS spend to reach the same position through the pipeline, at pipeline success rates? The third leg is our structural edge: a portfolio with a working venture factory should rarely pay strategic-premium multiples for things the factory can build.
- **Max multiples policy [ASSUMPTION — IC-ratified ceilings; exceeding them requires the G-12 approver set to acknowledge the breach explicitly in the DR]:** ≤ 4× ARR for SaaS targets with proven retention; ≤ 6× EBITDA for services/cash-flow targets; distressed/asset deals priced to replacement cost. Ceilings exist to fight the empirical regularity that acquirers systematically overpay under deal momentum; a pre-committed ceiling is a Ulysses contract against our own deal fever.
- **Integration cost accounting:** integration is budgeted as its own envelope attached to the deal DR at G-12 (LOI stage estimate, refined at close), tracked by `FPA` like any envelope (§5.3), and **counted in the deal's returns** — a deal's ROI is measured against price + integration + earnout at realistic probability, never headline price. Post-acquisition, the target's books are migrated onto the event ledger (§2) within a defined window **[ASSUMPTION: 2 close cycles]**, because an acquired entity outside the ledger is outside every control in this part.
- Post-mortem: every closed deal gets a 12-month lookback DR amendment (thesis vs realized), feeding `MNA-ANALYST` calibration — acquisition models are predictions like any other.

## 14. Investment strategy and portfolio optimization

- **Objective function:** maximize long-run compounded portfolio value — expected log-wealth growth — **subject to a survival constraint**: the probability of breaching the §4.1 liquidity floor within the planning horizon must stay below a bound set by the IC **[ASSUMPTION: ≤ 1% over any rolling 24 months, evaluated by `RISK-QUANT` on the §6 forecasts]**. Log-growth is chosen because the portfolio is a repeated game whose outcome is the *product* of period returns; arithmetic-mean maximization systematically prefers bets that compound into ruin. The survival constraint is senior to the objective: no expected-growth argument ever justifies violating it (it is a `RISK-QUANT` hard limit, `07-decision-engine.md` §4.3).
- **Diversification** is implemented, not aspired to: the §8.5 concentration/correlation/stage limits are the diversification policy.
- **Rebalancing cadence:** quarterly via §8.2 (matching the IC calendar), with out-of-cycle IC sessions only for G-12 windows or limit breaches. WHY quarterly: venture-stage evidence arrives in months, not days; faster rebalancing would trade on noise and thrash envelopes.
- **Return vs recycle:** capital is recycled (§8.3) while the marginal pipeline opportunity clears its §10 hurdle. When the deployable pool's marginal opportunity has failed to clear hurdles for **[ASSUMPTION: 3 consecutive quarterly reviews]**, `PORTFOLIO` MUST table a capital-return option (distribution to the holding's owners) at the IC alongside any recycle proposal — the system MUST NOT manufacture ventures to justify retaining capital; that failure mode (asset-gathering) is named in `13-failure-analysis.md`. Exits (G-14) and shutdown recoveries (G-15) flow to the same recycle-or-return test.

## 15. Financial dashboards (canonical set)

Owned by this part; rendered by `INSIGHT` from ledger projections and agent feeds; staleness SLOs are binding (§16 consistency note). "Owner" = accountable agent; "Consumer" = primary human audience per `11-governance.md`.

| Dashboard | Contents | Owner | Primary consumers | Refresh SLA |
|---|---|---|---|---|
| Portfolio cash & liquidity | Cash by entity/counterparty, liquidity floor headroom, 13-week forecast vs floor, counterparty concentration | `TREASURER` | CFO, IC | Daily |
| Per-venture unit economics | §9 dictionary metrics by cohort/channel, vs archetype benchmarks | `UNIT-ECON` | Portfolio Review lead, IC, `VENTURE-ORCH` | Weekly |
| Envelope utilization | Consumption vs envelope across the §5.1 hierarchy, yellow/breach states, freeze log | `FPA` | Envelope owners, `PRIME`, ARC | Daily |
| Forecast error | MAPE/bias by line, horizon, agent; trend vs learning-rate target | `FPA` (scored by `EVALUATOR`) | CFO, TSC | Monthly |
| Capital at risk | Deployed capital by venture/stage/factor vs §8.5 limits; CVaR₉₅ portfolio loss; survival-constraint status | `RISK-QUANT` | IC, ARC | Weekly |
| Close & controls | Close SLA status per entity, reconciliation breaks, replay-check results (§2.3), unposted-event queue | `LEDGER` | CFO, ARC | Daily during close; weekly otherwise |

Every dashboard number MUST be traceable to ledger events or named agent feeds — a dashboard figure that cannot be replayed to sources is removed, not defended.

## 16. Consistency and interface notes

- **Derived-view staleness [ASSUMPTION]:** ledger projections serve reads with ≤ 15 minutes staleness for operational views and exact-as-of-close for statements; dashboards display their as-of timestamp. Eventual consistency is acceptable everywhere except limit checks (§4.1, §8.5), which the Kernel evaluates against the event stream directly.
- This part supplies: envelope structure and finance SLAs (owned here), forecast and unit-economics feeds to `07-decision-engine.md`, close/ledger evidence to `11-governance.md` audits, and cost metering requirements to `09-technology.md`.
- This part consumes and never restates: gate amounts, approver sets, and SLAs (`appendix-c-decision-gates.md`); R/A taxonomies and the autonomy–reversibility matrix (`00-overview.md`); DR machinery (`07-decision-engine.md`).
