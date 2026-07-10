# EvolveOS Specification — Part III: Organizational Architecture

**Status:** Draft v0.1 · **Change class:** R3 (standard amendment process, Part XII)

This part defines the complete organizational structure of EvolveOS as a **hybrid human/agent organization**: humans concentrated where accountability, legal personhood, judgment under irreducible uncertainty, and constitutional control are required; agents dominating where work is high-volume, measurable, reversible, and envelope-boundable. It binds the human org chart to the agent hierarchy of `appendix-b-agent-registry.md`, expresses all decision authority in the R1–R4 / A0–A4 vocabulary of `00-overview.md` §5–§6, and cites approvals exclusively by gate ID from `appendix-c-decision-gates.md`.

Scope boundaries: agent internals and cards → `04-multi-agent-system.md`; pipeline stages → `05-business-creation-pipeline.md`; decision mechanics and DR schema → `07-decision-engine.md`; budget envelopes → `08-finance.md`; committee charters and officer fiduciary duties → `11-governance.md`; how this org chart itself evolves → `12-self-evolution.md`.

---

## 1. The layer model

The organization is stratified into six layers. A layer is defined by **the kind of decision that lives in it**, not by prestige or headcount. Reversibility class determines which layer a decision belongs to; the autonomy–reversibility matrix (`00-overview.md` §6) then determines who — human or agent — may take it. Departments (§4) are vertical; layers are horizontal. Most departments span two layers and are marked accordingly.

| Layer | Decisions that live here | Dominant reversibility | Cycle time | Human decision share (R2+) | Human:agent staffing ratio |
|---|---|---|---|---|---|
| **Executive** | Portfolio direction, capital allocation, all R4 approvals, constitutional change (G-16), emergency stop (G-00) | R3–R4 | Quarterly strategy · weekly gate batches · G-00 immediate | 100% by construction (matrix row R4 → A0/A1 quorum) | ~10 humans : 3 agent IDs (`PRIME`, `PORTFOLIO`, `EVOLVE`) |
| **Strategic** | Theses, portfolio options, budget frames, risk limits, legal/compliance posture, M&A pipeline | R2–R3 | Weekly–monthly | ≥ 90%: agents propose (A0–A2), named humans approve R3 | ~1 human : 2–3 director agents |
| **Operational** | Running ventures inside granted envelopes: campaigns, deals, roadmaps, support, vendor ops | R2, occasional R3 (queued) | Daily–weekly | ~10%: humans review A2 batches and approve queued R3 exceptions | ~1 human : 10–20 agent instances |
| **Execution** | Individual tasks: code, content drafts, tickets, outreach messages, ledger entries | R1–R2 | Minutes–hours | < 1%: post-hoc sampling audit only | ~1 human : 100+ worker instances (T4) |
| **Infrastructure** | Capacity, reliability, cost, cell provisioning, Kernel/Watchdog operation | R1–R2 (R3+ for irreversible infra changes) | Seconds–minutes (control loops) · weekly (capacity) | Humans only for R3+ changes and Kernel policy (G-16) | ~1 human : entire fleet, per ~25 cells |
| **Research** | What to investigate, what evidence means, validation verdicts | R1 (outputs are analyses) feeding R2 gates | Continuous scanning · weekly synthesis | Humans consume at gates G-02/G-03; do not steer daily | ~1 human : 5–10 research agents |

Rationale for the gradient (binding design intent): **human density MUST increase monotonically with reversibility class and decrease with decision volume.** The Executive Layer is human-dominated because R4 decisions are constitutionally reserved to humans; the Execution Layer is agent-dominated because R1 volume (thousands of actions/day at portfolio scale) is physically impossible for humans to gate item-by-item, and the matrix permits A3/A4 there. Any department whose work drifts up-class (e.g., a "draft" that becomes a public statement) crosses layers and MUST re-enter the corresponding gate (G-17 in that example) — the Kernel's envelope-exceed conversion (Appendix C, mechanic 3) enforces this mechanically.

**[ASSUMPTION]** The staffing ratios above are planning targets for the 5-venture stage (§5), calibrated to the span-of-control analysis in §5.2. They are not caps; they are the point at which we predict review quality degrades. They MUST be re-derived whenever measured A2 exception rates shift by >50%.

Cycle-time discipline: each layer MUST NOT block a faster layer's loop except through the Kernel (envelope enforcement) or a gate. A quarterly strategy review that stalls daily campaign optimization is an architecture bug; conversely, no accumulation of fast-layer actions may amount to a slow-layer decision without clearing its gate (the "salami-slicing" failure — see `RISK-DIR` aggregation duty, §4.18).

---

## 2. [DECISION] Organizational topology: platform + cells

Four topologies were compared for organizing 22 functions across a portfolio of N ventures:

| Criterion | Functional (one org, shared functions only) | Divisional (self-contained org per venture) | Matrix (dual reporting: function × venture) | **Platform + cells (chosen)** |
|---|---|---|---|---|
| Knowledge compounding across ventures | Strong (single function = single memory) | Weak (learning trapped per division) | Medium (diffuse ownership of lessons) | **Strong** — P-scoped directors own cross-venture playbooks (`06-knowledge-system.md`) |
| Blast-radius isolation | Weak (shared everything; one venture's incident contaminates all) | Strong | Weak | **Strong** — venture workloads run in Cells (glossary; `09-technology.md`, `10-security.md`) |
| Accountability clarity at gates | Medium (who owns venture P&L?) | Strong per venture, weak at portfolio | **Weak** — dual reporting is the classic matrix pathology; a gate needs one accountable approver | **Strong** — single-threaded `VENTURE-ORCH@V` per venture; single P-scoped director per function |
| Marginal cost of venture N+1 | Low | High (duplicate every function) | Medium | **Low** — instantiate only V/P+V agent instances; P singletons amortize |
| Human oversight scaling | Good (few humans see everything) | Bad (humans per division) | Bad (double meetings) | **Good** — humans attach to P-scoped directors and to gates, not to ventures |
| Venture speed / context locality | Bad (queues at shared functions) | Good | Medium | **Good** — venture-scoped instances carry venture context; no cross-venture queue for V-scoped work |

**Decision: EvolveOS SHALL be organized as a portfolio-level platform of shared functions plus per-venture instantiations** — exactly the `P` / `V` / `P+V` scoping already encoded in `appendix-b-agent-registry.md`:

1. **Platform (P):** functions whose value compounds across ventures or whose control must be centralized — Finance, Legal, Compliance, Risk, Security, Data, AI, Automation, Knowledge, Research, Strategy, People, Corporate Development, Infrastructure — exist once, as P-scoped director agents plus their specialists, owned by named humans (§3).
2. **Cells (V):** each venture receives a `VENTURE-ORCH@V-yyyy-seq` and per-venture instances of the `P+V`-scoped directors (`PROD-DIR`, `ENG-DIR`, `GROWTH-DIR`, `SALES-DIR`, `CS-DIR`, `OPS-DIR`, `MKT-DIR`), operating inside that venture's Cell and venture envelope.
3. **The seam is contractual, not managerial:** a venture instance inherits the portfolio director's policies and playbooks (platform → cell flow) and emits telemetry and lessons (cell → platform flow) via Task contracts and Knowledge items — never by informal dual reporting. Where a P+V director's portfolio-standard conflicts with a `VENTURE-ORCH` instruction, the conflict escalates to `PRIME` for arbitration (its registered purpose), and to the Executive Committee if `PRIME` cannot resolve it within policy. This resolves the matrix pathology explicitly instead of leaving it to negotiation.

Alternatives rejected: pure functional fails blast-radius isolation and venture speed (fatal for a system that must also *retire* ventures cleanly — G-15 requires a separable unit); pure divisional destroys the knowledge moat that is EvolveOS's core compounding asset (`01-philosophy.md`); matrix fails the single-accountable-approver requirement that every gate in `appendix-c-decision-gates.md` presumes. **[UNCERTAIN]** At >100 ventures, an intermediate grouping tier ("venture clusters" sharing a human review pod, §5.4) may be needed; this is flagged for `14-implementation-roadmap.md` rather than designed now.

---

## 3. How the human org chart and the agent hierarchy interlock

### 3.1 The accountability rule

**Every T2 director agent MUST have exactly one accountable human owner** — the human who answers for that agent's conduct to the Board, signs its R3 approvals where the matrix requires a named human, receives its escalations, and sponsors G-16 requests touching its autonomy ceiling. Venture-scoped instances (`@V-yyyy-seq`) inherit the accountable owner of their portfolio-scoped parent. This rule exists because the autonomy–reversibility matrix is meaningless if "a human approves" cannot be resolved to a specific person; diffuse accountability is how oversight decays into rubber-stamping.

### 3.2 The interlock map

Derived directly from the "Reports to" column of `appendix-b-agent-registry.md`:

| Accountable human (officer/body) | Directly owned agents | Ownership rationale |
|---|---|---|
| **Executive Committee** (chaired by CEO) | `PRIME` | The top orchestrator's counterpart must be the top human body; `PRIME` is the EC's single agent interface |
| **CEO** (via EC, as chain-of-command terminus) | Transitively: `STRAT-DIR`, `RSRCH-DIR`, `DATA-DIR`, `AI-DIR`, `KNOW-DIR`, and the portfolio side of `PROD-DIR`, `ENG-DIR`, `OPS-DIR` (all report to `PRIME`) | Agents reporting only to `PRIME` roll up to the human who owns `PRIME`'s output — the CEO. The CEO also holds G-16 sign-off |
| **Investment Committee (IC)** | `PORTFOLIO`, `CORPDEV-DIR` (both jointly with `PRIME`) | Capital allocation and M&A are IC-gated (G-07/G-08, G-12); the proposing agents answer to the approving body |
| **Tech & Safety Committee (TSC)** | `EVOLVE` (jointly with `PRIME`) | Self-modification is the highest-risk capability; its agent answers to the constitutional-safety body (G-16) |
| **Audit & Risk Committee (ARC)** | `RISK-DIR` (jointly with `PRIME`) | Risk limits must be owned outside the chain that takes the risks |
| **CFO** | `FIN-DIR` and its specialists (`LEDGER`, `TREASURER`, `FPA`, `UNIT-ECON`, `FIN-MODEL`) | Financial statements carry human legal liability; the CFO signs what `FIN-DIR` prepares |
| **General Counsel (GC)** | `LEGAL-DIR`, `COMPL-DIR` and their specialists (`CONTRACTS`, `REG-WATCH`, `PRIVACY`) | Legal work product requires human counsel supervision (registry: `LEGAL-DIR` is A1 "always under human counsel supervision") |
| **CISO** | `SEC-DIR` (`RED-CELL`, `BLUE-CELL`) | Incident command and offensive testing authorization are human security-officer duties |
| **Head of People** | `PEOPLE-DIR` (`RECRUITER`) | Employment decisions are R3/R4 (G-09, G-13) and legally attach to humans |
| **Board** | No direct agent ownership; approves G-12 close, G-13, G-14 | The Board governs humans, not agents — deliberate: agents never brief the Board except through officers |

Specialists (T3) are owned by whoever owns their director; T4 workers by whoever owns their spawner. `INFRA-DIR` reports to `ENG-DIR` and therefore rolls up the CEO chain; `VENTURE-ORCH` instances roll up through `PORTFOLIO` to the IC for capital matters and to the CEO chain for operations.

### 3.3 Interlock mechanics (binding)

1. **Escalation always terminates at a human.** Every escalation path in §4 ends at an officer or committee. An escalation chain that terminates at an agent is a spec violation.
2. **Humans manage agents through envelopes and gates, not instructions.** The accountable owner tunes the agent's policy envelope (an R2/R3 change through the owning process in `12-self-evolution.md`) and approves at gates; they do not micro-direct tasks. Rationale: instruction-level human management does not scale and creates untracked authority outside the audit trail.
3. **Agents never hold human-reporting lines.** No human reports to an agent. Human staff in hybrid departments (e.g., human account executives, §4.10) report to the accountable officer or their human delegate; agents route work to them via Task contracts, which humans may reject.
4. **Dual-key for control functions.** For `FIN-DIR`, `LEGAL-DIR`, `COMPL-DIR`, `RISK-DIR`, `SEC-DIR`, the accountable owner sits **outside** the CEO's operating line (CFO, GC, ARC, CISO respectively, per Part XI independence rules). This mirrors the human-world separation of management from control and prevents the operating chain from pressuring its own controls.

---

## 4. Departments

Format: every department carries the same nine fields. **Layer(s)** shows primary layer first; departments serving multiple layers say so. **Owning agents** cites `appendix-b-agent-registry.md` verbatim; T4 workers by class ID. **Human staffing** uses only officers/bodies from Appendix B plus generic non-officer human roles. All KPI targets introduced here are **[ASSUMPTION]**-marked planning values for the 5-venture stage; per §5 they MUST be re-ratified at each scale step. KPI measurement definitions live with `INSIGHT` (§4.13) to prevent metric gaming by the measured department.

### Executive Layer

#### 4.1 Executive

**Layer(s):** Executive (also Strategic for portfolio shaping) · **Owning agents:** `PRIME`, `PORTFOLIO`, `VENTURE-ORCH` (per-venture GM instances) · **Human staffing:** CEO, Executive Committee, Board; Portfolio Review lead(s) (non-officer humans named as G-05/G-06 approvers).

| Field | Specification |
|---|---|
| **Mission** | Convert portfolio strategy into gated capital and envelope allocations; retain human control of every R4 and named-human R3 decision; arbitrate cross-domain contention. |
| **Responsibilities** | Goal decomposition (`PRIME`); pipeline stage transitions and reallocation proposals (`PORTFOLIO`); single-threaded venture leadership (`VENTURE-ORCH@V`); operating the weekly gate batch cadence; invoking G-00 when warranted. |
| **KPIs** | (1) Gate SLA adherence ≥ 95% of decisions within Appendix C SLAs **[ASSUMPTION**: below this, the pipeline stalls and agents idle**]**; (2) decision regret rate — % of R3+ DRs reversed or materially amended within 2 quarters ≤ 10% **[ASSUMPTION**: 1-in-10 tolerable at portfolio risk appetite**]**; (3) escalation resolution time (Operational→Executive) median ≤ 3 business days **[ASSUMPTION]**; (4) % of R3+ actions with complete DR + pre-registered kill criteria = 100% (constitutional, not aspirational); (5) portfolio Learning rate trend positive quarter-over-quarter (definition owned by `01-philosophy.md`/`12-self-evolution.md`). |
| **Decision authority** | Humans: all R4 via gate quorums (G-07, G-08, G-11–G-16); named-human R3 at G-05, G-06. `PRIME`: A3 ceiling, so autonomous only to R2 (matrix); may invoke G-00. `PORTFOLIO`: A2 — auto-passes G-01, G-02 within limits, decides G-03/G-04 subject to weekly human batch review. `VENTURE-ORCH`: A3 within its venture envelope only. |
| **Escalation paths** | `PRIME` → Executive Committee (unresolvable arbitration, envelope exhaustion, any suspected Constitutional conflict — immediately). `PORTFOLIO` → IC (reallocation above envelope). `VENTURE-ORCH` → `PORTFOLIO` → IC. Anyone → G-00. |
| **Interfaces** | Receives proposals from every department; issues envelopes downward via `08-finance.md` budget process; sole interface between agent hierarchy and Board (through officers, §3.3.3). |
| **Outputs** | DRs, envelope grants, gate verdicts, portfolio priorities, arbitration rulings, G-00 invocations. |
| **Inputs** | Stage-gate evidence packs, `FPA` forecasts, `RISK-DIR` limit status, `STRAT-DIR` options, escalations. |
| **Failure modes** | (1) *Rubber-stamping* — human batch review becomes clickthrough; detection: median seconds-per-item in review UI below floor, veto rate → 0 over 4 weeks (audited by ARC). (2) *Gate queue congestion* — approvals become the portfolio bottleneck; detection: gate SLA breaches trending up 3 consecutive weeks. (3) *Orchestrator goal drift* — `PRIME` optimizes proxy metrics against intent; detection: `EVALUATOR` calibration/behavior regression + ARC sampling of DR rationales. (4) *Shadow authority* — decisions made in unlogged human side-channels; detection: actions observed by Kernel without matching DR. |

### Strategic Layer

#### 4.2 Strategy

**Layer(s):** Strategic · **Owning agents:** `STRAT-DIR`, `COMP-INTEL` · **Human staffing:** CEO (accountable owner via `PRIME` chain); Executive Committee consumes output. No dedicated human staff at 5-venture scale.

| Field | Specification |
|---|---|
| **Mission** | Maintain living market theses and portfolio-level strategy options so that capital gates decide among pre-analyzed alternatives, never from a blank page. |
| **Responsibilities** | Thesis lifecycle (draft→active→decayed) with expiry per Knowledge item conventions; competitive posture and positioning maps (`COMP-INTEL`); strategic option generation for IC/EC; where-to-play constraints feeding G-01 intake filters. |
| **KPIs** | (1) Thesis hit rate — % of active theses under which ≥1 venture passes G-03 within 12 months ≥ 30% **[ASSUMPTION**: below this, theses are decoration**]**; (2) competitive surprise rate — material competitor moves not flagged ≥ 2 weeks in advance ≤ 1/quarter **[ASSUMPTION]**; (3) thesis freshness — % of active theses reviewed within their expiry window = 100%; (4) option utilization — % of R4 capital decisions citing a pre-existing strategy option ≥ 80% **[ASSUMPTION]**. |
| **Decision authority** | A2 ceiling. Autonomous: analyses, maps, thesis drafts (R1). Thesis activation/retirement affecting intake filters: R2, A2 with EC batch visibility. Anything committing capital: A0 — proposals to gates only. |
| **Escalation paths** | To CEO/EC when a thesis implies portfolio-level pivot; to IC when an option implies reallocation beyond current envelopes; immediately to EC if `COMP-INTEL` detects an existential competitive threat. |
| **Interfaces** | Feeds `RSRCH-DIR` (where to hunt) and `PORTFOLIO` (intake filters); consumes `TRENDS`/`SCOUT` signals, `UNIT-ECON` cohort data, `CORPDEV-DIR` market maps; pairs with Finance on option valuation. |
| **Outputs** | Theses (as Knowledge items), positioning maps, strategy option memos, intake filter parameters. |
| **Inputs** | Research layer signals, portfolio performance data, competitive telemetry, IC feedback on rejected options. |
| **Failure modes** | (1) *Thesis ossification* — stale theses filter out live opportunities; detection: `SCOUT` kill-by-filter rate rising while thesis hit rate falls. (2) *Narrative capture* — strategy rationalizes what operations already does; detection: options always match incumbent allocation (ARC sampling). (3) *Competitive blind spot*; detection: post-mortem attribution of venture kills to unflagged competitor action. |

#### 4.3 Finance

**Layer(s):** Strategic + Operational (close/AP-AR run daily at Operational cadence) · **Owning agents:** `FIN-DIR`, `LEDGER`, `TREASURER`, `FPA`, `UNIT-ECON`, `FIN-MODEL` · **Human staffing:** CFO (accountable owner, signs statements); human controller **[ASSUMPTION**: one non-officer human controller needed from first external audit onward, because auditors require a human attestor below CFO**]**.

| Field | Specification |
|---|---|
| **Mission** | Guarantee ledger integrity and capital visibility so every gate decision prices in true, current economics; execute treasury within human-approved bounds. |
| **Responsibilities** | Double-entry bookkeeping, reconciliation, close (`LEDGER`); cash positioning and counterparty limits (`TREASURER`); budgets vs. actuals, rolling forecasts (`FPA`); CAC/LTV/margin instrumentation (`UNIT-ECON`); scenario models for DRs (`FIN-MODEL`). Envelope accounting: Finance operates the ledger-of-envelopes that the Kernel enforces against (split: Finance computes remaining envelope; Kernel blocks). Budget envelope values themselves are owned by `08-finance.md`. |
| **KPIs** | (1) Close time ≤ 5 business days monthly **[ASSUMPTION**: standard for a portfolio this size; agents should beat it, humans bottleneck attestation**]**; (2) unreconciled items > 30 days = 0; (3) forecast error — portfolio cash 90-day MAPE ≤ 10% **[ASSUMPTION]**; (4) envelope-accounting lag — time from spend event to envelope decrement ≤ 1 h **[ASSUMPTION**: stale envelope balances break Kernel enforcement**]**; (5) audit findings classified material = 0. |
| **Decision authority** | `FIN-DIR` A2. Bookkeeping/reconciliation: A2 (R1/R2). Forecasts/models: A3 (R1). **All cash movements are R3+ → `TREASURER` is A1**: every transfer above the operating sweep envelope requires CFO (or named delegate) approval; movements > $1M are R4 per `00-overview.md` §5 and route to IC (G-08 context or standing treasury resolution per `08-finance.md`). Contract-driven payments > $100k cite G-10. |
| **Escalation paths** | To CFO: any reconciliation break unresolved > 72 h, counterparty limit breach, forecast covenant risk. To IC (with CFO): projected portfolio runway < 18 months, any venture breaching its envelope by > 10%. To ARC: suspected financial irregularity — directly, bypassing CFO, by standing `FRAUD-WATCH`/`LEDGER` rule (anti-collusion design). |
| **Interfaces** | Every department (budget envelopes out, actuals in); `RISK-DIR` (exposure data); `CORPDEV-DIR` (deal models); `PORTFOLIO` (stage budgets); Kernel (envelope balances). |
| **Outputs** | Financial statements, envelope balances, forecasts, unit-economics packs for gates, treasury proposals. |
| **Inputs** | Transaction feeds from venture Cells, bank/PSP data, contracts (`CONTRACTS` obligation extracts), headcount costs (`PEOPLE-DIR`). |
| **Failure modes** | (1) *Silent ledger drift* — automation errors compound unreconciled; detection: daily automated reconciliation delta trend, hard alert at 3σ. (2) *Envelope race* — spend authorized against stale balance; detection: Kernel post-hoc mismatch report (any nonzero count pages `FIN-DIR` owner). (3) *Model flattery* — `FIN-MODEL` scenarios skew optimistic under selection pressure from proposing agents; detection: `EVALUATOR` calibration score on model P50s vs. outcomes. (4) *Treasury concentration*; detection: `TREASURER` counterparty limit monitor (A1 alert to CFO). |

#### 4.4 Legal

**Layer(s):** Strategic + Operational (contract flow is daily) · **Owning agents:** `LEGAL-DIR`, `CONTRACTS` · **Human staffing:** General Counsel (accountable owner); human counsel (staff attorneys) — mandatory, because legal advice and court appearances require licensed humans; outside counsel per matter.

| Field | Specification |
|---|---|
| **Mission** | Make the portfolio's legal exposure known, bounded, and priced into every gate; ensure no agent output constitutes unsupervised practice of law. |
| **Responsibilities** | Contract drafting from approved templates, review, obligation extraction (`CONTRACTS`); entity matters, IP strategy, disputes (`LEGAL-DIR` preparing, humans deciding); legal inputs to G-07 (entity memos), G-10, G-11, G-12/G-13/G-14/G-15; litigation management (R4, human-led). |
| **KPIs** | (1) Contract turnaround — template-based ≤ 2 business days, bespoke ≤ 7 **[ASSUMPTION**: slower loses deals, faster risks review quality**]**; (2) obligation-extraction completeness ≥ 98% vs. human-audited sample **[ASSUMPTION]**; (3) disputes arising from agent-drafted instruments = 0 material; (4) % of R3+ external commitments with legal review before signature = 100% (Kernel-checkable via G-10 flow). |
| **Decision authority** | `LEGAL-DIR` and `CONTRACTS` are **A1 — every externally visible legal act requires named human counsel approval**. Internal analyses: R1 at A1 cadence anyway (registry ceiling). Signing authority is exclusively human, per delegation matrix in `11-governance.md`. Gates: co-approver inputs to G-07, G-10 (GC delegate), G-11–G-15, G-18. |
| **Escalation paths** | To GC: novel legal theory, any dispute, regulator contact, anything touching the Constitutional Layer. GC → EC/Board per `11-governance.md` for litigation and R4 matters. |
| **Interfaces** | `COMPL-DIR` (shared GC ownership, distinct duties: Legal = instruments & disputes, Compliance = regulatory state); `CORPDEV-DIR` (deal docs); Sales/`DEALDESK` (contract handoff); `PEOPLE-DIR` (employment law); Finance (obligations → ledger). |
| **Outputs** | Executed-ready instruments, legal memos, obligation registers, IP filings (human-signed), litigation holds. |
| **Inputs** | Deal terms, entity plans, disputes, regulatory inquiries, template library (versioned, GC-approved). |
| **Failure modes** | (1) *Template drift* — `CONTRACTS` edits accumulate into un-reviewed nonstandard terms; detection: clause-level diff rate against approved templates, threshold alert to human counsel. (2) *Advice laundering* — agent analysis treated as legal advice downstream without counsel sign-off; detection: DR audit for legal-claim citations lacking counsel approval ID. (3) *Obligation leakage* — extracted obligations never reach the ledger/calendar; detection: reconciliation of `CONTRACTS` register vs. `LEDGER`/`COMPL-DIR` calendars. |

#### 4.5 Risk

**Layer(s):** Strategic + Operational (monitoring is continuous) · **Owning agents:** `RISK-DIR`, `RISK-QUANT`, `FRAUD-WATCH` · **Human staffing:** Audit & Risk Committee (accountable body); CFO consulted on financial limits. No dedicated human staff initially; ARC members perform sampling audits.

| Field | Specification |
|---|---|
| **Mission** | Keep the portfolio's aggregate risk inside Board-set appetite; ensure every gate decision sees a quantified, independent risk score it cannot edit. |
| **Responsibilities** | Risk register ownership (register content → `13-failure-analysis.md`); risk scoring service for the decision engine (`RISK-QUANT`, per `07-decision-engine.md`); limit monitoring; transaction/behavior anomaly detection (`FRAUD-WATCH`); **aggregation duty**: detecting when accumulations of low-class actions constitute a higher-class exposure (anti-salami-slicing, §1). |
| **KPIs** | (1) Risk-scoring coverage — % of R2+ DRs carrying a `RISK-QUANT` score = 100%; (2) limit-breach detection latency ≤ 1 h **[ASSUMPTION**: breaches compound; sub-hour keeps R2-scale damage**]**; (3) fraud loss ≤ 0.1% of portfolio revenue **[ASSUMPTION**: payments-industry-normal for early scale**]**; (4) false-positive hold rate ≤ 5% of `FRAUD-WATCH` blocks **[ASSUMPTION**: above this, holds get reflexively released and the control dies**]**; (5) realized incidents predicted by register (severity-weighted) ≥ 70% **[ASSUMPTION]**. |
| **Decision authority** | Per registry: A3 for monitoring/scoring/alerting; **A0 for limit changes** — `RISK-DIR` may only propose limits; ARC sets them. `FRAUD-WATCH`: blocking holds auto (A3, reversible); releases are A1 (human confirms). May invoke G-00 via Watchdog pathway evidence. |
| **Escalation paths** | Limit breach → accountable envelope owner + ARC simultaneously (parallel, not serial — the risk function must not be silenceable by the risk-taker). Aggregation finding → `PRIME` + ARC. Suspected fraud involving insiders → ARC directly (never through the implicated chain). |
| **Interfaces** | Decision engine (scores in every DR); Finance (exposure data); Security (incident risk); Compliance (regulatory risk feed); all envelope owners (limit status). |
| **Outputs** | Risk scores, limit dashboards, breach alerts, aggregation reports, fraud holds, register updates (to `13-failure-analysis.md`). |
| **Inputs** | Transaction streams, DR pipeline, incident reports, `REG-WATCH` changes, market data. |
| **Failure modes** | (1) *Score gaming* — proposing agents learn features that lower risk scores without lowering risk; detection: `EVALUATOR` drift analysis on score-vs-outcome calibration per proposing agent. (2) *Alert fatigue*; detection: alert acknowledgment latency and dismissal-without-action rate trending up. (3) *Aggregation miss* — salami-sliced exposure crosses R-class unnoticed; detection: periodic retrospective re-classification of action clusters (ARC-mandated, quarterly). |

#### 4.6 Compliance

**Layer(s):** Strategic + Operational · **Owning agents:** `COMPL-DIR`, `REG-WATCH`, `PRIVACY` · **Human staffing:** General Counsel (accountable owner); delegated privacy officer (non-officer human, named G-18 delegate).

| Field | Specification |
|---|---|
| **Mission** | Ensure every venture operates with a current, jurisdiction-accurate map of its obligations, files on time, and never expands data use without clearance. |
| **Responsibilities** | Regulatory mapping per venture/jurisdiction; filing calendars and license tracking (`COMPL-DIR`); regulatory change monitoring mapped to affected ventures (`REG-WATCH`); data-classification enforcement, DSR handling, privacy reviews (`PRIVACY`); compliance inputs to G-11 (regulatory map) and G-18 (privacy review). |
| **KPIs** | (1) Missed statutory filings = 0 (non-negotiable); (2) regulatory-change-to-impact-assessment latency ≤ 5 business days **[ASSUMPTION**: matches G-18 SLA order-of-magnitude**]**; (3) DSR completion within statutory deadline = 100%; (4) % ventures with current compliance map (reviewed ≤ 90 days) = 100% **[ASSUMPTION**: quarterly refresh matches regulatory drift rate in target sectors**]**. |
| **Decision authority** | `COMPL-DIR`, `PRIVACY`: A1 — every enforcement action or filing is human-approved (GC or privacy officer). `REG-WATCH`: A3 for alerts only (R1). Gates: mandatory input provider to G-11, G-18; blocker rights: a missing compliance map MUST block G-06 launch readiness (checklist item, Kernel-checked). |
| **Escalation paths** | To GC: any regulator contact, any potential violation discovered, ambiguous jurisdiction questions. GC → EC for violations with R4 consequence (self-reporting decisions are R4, human-only). Privacy incidents touching customer data → CISO + GC jointly (customer-data-affecting incidents are R4 per `00-overview.md` §5). |
| **Interfaces** | Legal (shared GC ownership, §4.4); Data (classification enforcement is joint `PRIVACY` + `DATA-DIR`); every venture's `OPS-DIR`/`VENTURE-ORCH` (obligations in, attestations back); Security (incident classification). |
| **Outputs** | Compliance maps, filing calendars, license registers, privacy review verdicts, DSR completions, G-11/G-18 input packs. |
| **Inputs** | `REG-WATCH` feeds, venture activity descriptions, data-use requests, jurisdiction plans. |
| **Failure modes** | (1) *Map staleness in fast regimes* (e.g., AI regulation); detection: `REG-WATCH` change volume per jurisdiction vs. map review timestamps. (2) *Purpose creep* — data used beyond approved classification without a G-18; detection: `PRIVACY` automated scans of query logs vs. purpose registry. (3) *Filing single-point-of-failure* — calendar exists but no human capacity to execute; detection: filings completed < 5 days before deadline trending up. |

#### 4.7 Corporate Development

**Layer(s):** Strategic · **Owning agents:** `CORPDEV-DIR`, `MNA-ANALYST` · **Human staffing:** Investment Committee (accountable body, with `PRIME`); CFO and GC as mandatory deal-team members; human deal lead per active transaction **[ASSUMPTION**: counterparties will not negotiate R4 transactions with agents; a human face is a market requirement, not just a control**]**.

| Field | Specification |
|---|---|
| **Mission** | Give the portfolio inorganic options — acquire, merge, restructure, exit — that are sourced, valued, and diligenced to the same evidence standard as organic gates. |
| **Responsibilities** | Target screening and sourcing; valuation models and DD checklist execution (`MNA-ANALYST`); integration planning pre-close; exit preparation (G-14 inputs); restructuring analysis (G-13 inputs); wind-down coordination analysis (G-15 inputs). |
| **KPIs** | (1) Sourced-pipeline coverage — qualified targets per active thesis ≥ 3 **[ASSUMPTION]**; (2) DD completeness — % checklist items evidenced at LOI ≥ 90%, at close = 100%; (3) post-close performance vs. deal model — 12-month revenue within ±20% of model P50 **[ASSUMPTION**: wider than organic forecast error because deal models face information asymmetry**]**; (4) integration milestone attainment ≥ 80% on time **[ASSUMPTION]**. |
| **Decision authority** | `CORPDEV-DIR`, `MNA-ANALYST`: A1 — all outreach to targets, all term proposals, human-approved. Everything transaction-binding is R4: LOI → G-12 (IC quorum); close → G-12 (Board majority); merger/restructuring → G-13; exit → G-14; shutdown → G-15. The department never holds execution authority; it prepares gates. |
| **Escalation paths** | To IC: any inbound approach, any target entering exclusivity elsewhere (timing decisions). To Board via IC: close recommendations. To GC: always embedded (deal docs, antitrust). |
| **Interfaces** | Strategy (thesis fit), Finance (`FIN-MODEL` valuation cross-check — deliberately duplicated with `MNA-ANALYST` for independent models), Legal (docs), Risk (deal risk scores), `PORTFOLIO` (integration into pipeline), People (retention plans under G-13). |
| **Outputs** | Target maps, valuation memos, DD packs, LOI drafts (human-signed), integration plans, exit books. |
| **Inputs** | Theses, market maps, banker inbound, portfolio performance (which ventures are exit-ready or merge candidates), `UNIT-ECON` comparables. |
| **Failure modes** | (1) *Deal fever* — momentum overrides evidence; detection: DR shows kill criteria amended mid-process (Kernel flags pre-registration edits, Appendix C mechanic 1). (2) *DD theater* — checklist complete but shallow; detection: post-close surprise rate attributed to items marked "evidenced". (3) *Leak* — confidential process exposure; detection: `SEC-DIR` data-egress monitoring on deal-room Cells. |

### Research Layer

#### 4.8 Research

**Layer(s):** Research (feeding Strategic) · **Owning agents:** `RSRCH-DIR`, `SCOUT`, `TRENDS`, `DEEP-RES`, `VALIDATOR`; `W-RESEARCH` workers · **Human staffing:** CEO chain (accountable via `PRIME`); IC delegate reviews G-03 batches (per Appendix C).

| Field | Specification |
|---|---|
| **Mission** | Keep the top of the venture pipeline full of evidence-backed opportunities and kill weak ones cheaply, before capital-bearing stages. |
| **Responsibilities** | Continuous market/filing/forum/technology scanning (`SCOUT`); quantified trend detection (`TRENDS`); adversarially verified long-form research (`DEEP-RES`); validation experiment design and execution — landing tests, interviews at scale, pre-sales (`VALIDATOR`); research quality bar ownership (`RSRCH-DIR`). |
| **KPIs** | (1) Opportunity throughput — qualified G-01 submissions ≥ 20/month **[ASSUMPTION**: sized to fill a 5-venture portfolio with ~10:1 attrition through G-04**]**; (2) validation-verdict precision — % of G-03 passes still alive at G-05 ≥ 40% **[ASSUMPTION**: the Learning-rate anchor metric; too high means over-conservative kills, too low means wasted discovery budget**]**; (3) kill cost efficiency — mean spend on ventures killed at/before G-03 ≤ $8k **[ASSUMPTION**: within G-02's ≤$10k validation envelope**]**; (4) source-verification rate — % of material claims in dossiers with adversarially checked provenance = 100%; (5) time G-01→G-03 verdict ≤ 21 days **[ASSUMPTION]**. |
| **Decision authority** | `SCOUT`/`TRENDS`: A4 on R1 outputs (pure analysis). `DEEP-RES`: A3. `VALIDATOR`: A2 — experiments spending real money live inside G-02's validation envelope; public-facing test assets that exceed pre-approved templates trigger G-17. Stage transitions are `PORTFOLIO`'s call at G-01/G-02/G-03, not Research's — proposer/approver separation. |
| **Escalation paths** | To `PRIME` → EC: findings contradicting an active portfolio-level thesis (strategy conflict). To IC delegate: G-03 batch anomalies. To GC via `COMPL-DIR`: research methods touching personal data (G-18 before, not after). |
| **Interfaces** | Strategy (thesis exchange, both directions); `PORTFOLIO` (gate submissions); Product (`CUST-DISC` handoff at discovery stage); Knowledge (every dossier becomes Knowledge items with expiry); Data (experiment instrumentation standards from `DATA-DIR`). |
| **Outputs** | Opportunity briefs (G-01), research dossiers (G-02), validation results vs. pre-registered kill criteria (G-03), market sizings, Knowledge items. |
| **Inputs** | Thesis priorities, intake filters, prior venture post-mortems (Counterfactual ledger), external data feeds. |
| **Failure modes** | (1) *Confirmation drift* — validation designed to pass; detection: pre-registration diff checks (kill criteria are Kernel-locked at gate per Appendix C mechanic 1) + `EVALUATOR` audit of experiment-design variance. (2) *Signal flooding* — `SCOUT` volume overwhelms triage quality; detection: G-01 pass rate collapsing while submission volume grows. (3) *Provenance rot* — sources cited but dead/misquoted; detection: `CURATOR` random re-verification failure rate > 2%. |

#### 4.9 Data

**Layer(s):** Research + Operational + Infrastructure (platform runs continuously; standards serve all layers) · **Owning agents:** `DATA-DIR`, `PIPELINE-ENG`, `INSIGHT`; knowledge-side co-owners `KNOW-DIR`, `CURATOR`, `ARCHIVIST` (two P-scoped directors deliberately co-locate here: `DATA-DIR` owns data-in-motion and analytics; `KNOW-DIR` owns validated knowledge-at-rest — the memory architecture of `06-knowledge-system.md`) · **Human staffing:** CEO chain (accountable via `PRIME`); no dedicated humans at 5-venture scale.

| Field | Specification |
|---|---|
| **Mission** | One truthful, queryable representation of everything the portfolio does and knows — so agents reason from shared, validated state rather than private copies. |
| **Responsibilities** | ELT pipelines, data quality tests, schema evolution (`PIPELINE-ENG`); metric definitions, dashboards, experiment readouts (`INSIGHT` — the portfolio's single metric authority, preventing departments from grading their own homework); knowledge validation, dedup, contradiction detection, expiry (`CURATOR`); archival tiering, retention execution, audit-log integrity checks (`ARCHIVIST`); experiment methodology standards (`DATA-DIR`). |
| **KPIs** | (1) Data freshness — % of tier-1 tables within SLA ≥ 99% (SLA values owned here as the process-defining part: tier-1 ≤ 1 h lag **[ASSUMPTION]**); (2) metric consistency — cross-dashboard contradictions detected per quarter ≤ 2 **[ASSUMPTION]**; (3) knowledge retrieval precision@k on benchmark ≥ 85% **[ASSUMPTION**: below this, agents distrust and bypass shared memory — the death of compounding**]**; (4) contradiction backlog — unresolved KI contradictions > 14 days = 0; (5) audit-log integrity check failures = 0 (constitutional). |
| **Decision authority** | A3 across the board (registry) — pipelines, dashboards, curation are R1/R2. Schema changes breaking downstream consumers: R2, A2-style batch notice to affected owners. Any data use outside approved classification: not this department's call — G-18 (GC/privacy officer), with `PRIVACY` review. Retention policy content: owned by `11-governance.md`/GC; `ARCHIVIST` executes only. |
| **Escalation paths** | To `PRIME`: cross-department metric disputes (INSIGHT is authoritative; disputes escalate rather than fork). To CISO: audit-log integrity anomaly (tamper suspicion — immediate, this is Constitutional-layer evidence). To GC: retention/legal-hold conflicts. |
| **Interfaces** | Everyone (it is the platform); tightest: Research (experiment standards), AI (`EVALUATOR` needs ground truth), Finance (ledger feeds are tier-1), Compliance (`PRIVACY` classification enforcement joint duty). |
| **Outputs** | Governed datasets, metric layer, dashboards, experiment readouts, validated Knowledge items, archives, integrity attestations. |
| **Inputs** | Venture Cell telemetry, external data (licensed under G-18 for new sources), DRs and evidence packs, agent traces. |
| **Failure modes** | (1) *Metric fork* — departments define private versions of official metrics; detection: `INSIGHT` scans dashboards/queries for near-duplicate metric definitions. (2) *Silent pipeline corruption*; detection: data quality test coverage + anomaly detection on distribution shift, alert at tier-1 breach. (3) *Knowledge contamination* — unvalidated or expired KIs cited in DRs; detection: Kernel-side check that DR citations reference KIs with valid status. (4) *Retention violation* — data outliving policy; detection: `ARCHIVIST` sweep vs. retention registry, exceptions reported to GC. |

#### 4.10 AI

**Layer(s):** Research + Infrastructure (model/eval infrastructure serves all layers) · **Owning agents:** `AI-DIR`, `EVALUATOR`, `PROMPT-SMITH` · **Human staffing:** CEO chain (accountable via `PRIME`); TSC oversight for anything touching autonomy or the evolution loop; human ML engineers **[ASSUMPTION**: 1–2 from the start — model selection failures are portfolio-wide, and eval infrastructure needs human ground-truth adjudication**]**.

| Field | Specification |
|---|---|
| **Mission** | Right model, right cost, right measurement for every agent — and an evaluation substrate honest enough that the self-evolution loop (Part XII) improves reality, not benchmarks. |
| **Responsibilities** | Model selection and routing policy; fine-tuning programs; eval infrastructure and benchmark suites (`EVALUATOR`); calibration tracking per agent (Calibration score, glossary); AI cost management; prompt/policy optimization proposals (`PROMPT-SMITH`, executing under `EVOLVE` protocol — this department builds the tools; Automation §4.21 runs the loop). |
| **KPIs** | (1) Fleet calibration — portfolio-weighted Brier score improving quarter-over-quarter (direction, not level — level is meaningless across task mixes); (2) eval coverage — % of registered agents with current benchmark suite = 100%; (3) AI cost per venture-stage within budget envelope (values → `08-finance.md`) with unit cost trending down ≥ 10%/year at constant quality **[ASSUMPTION**: conservative vs. market price decline; captured via routing**]**; (4) regression escape rate — behavior regressions reaching production undetected by `EVALUATOR` ≤ 1/quarter **[ASSUMPTION]**. |
| **Decision authority** | `AI-DIR`: A2. Model routing changes for R1-work agents: A2 (R2 change, shadow-tested). Routing/prompt changes for agents whose actions reach R3 territory: treated as R3 change → A1, named human (accountable owner) approves. **Anything altering an autonomy ceiling or Kernel-adjacent behavior is R4 → G-16.** Benchmark/eval definitions: A3 (R1) but versioned and TSC-visible (they are the instruments oversight relies on). |
| **Escalation paths** | To TSC: any eval evidence of deceptive or gamed behavior in any agent (immediate — this is a Constitutional concern); calibration collapse of a T1/T2 agent. To `PRIME`/EC: model vendor concentration or outage risk crossing `RISK-DIR` limits. To CFO: AI spend envelope breach (auto via Kernel queue). |
| **Interfaces** | Automation/`EVOLVE` (benchmarks and shadow-mode infrastructure); every department (model routing affects all agents); Data (ground truth); Security (model supply-chain vetting with `SEC-DIR`); Infrastructure (serving capacity). |
| **Outputs** | Routing policies, fine-tuned model versions, benchmark suites, calibration reports, cost reports, prompt-change proposals (as Evolution proposals). |
| **Inputs** | Agent traces, outcome data (from `INSIGHT`), vendor model releases, `EVOLVE` requirements, incident reports on agent behavior. |
| **Failure modes** | (1) *Benchmark overfit* — fleet improves on evals, degrades in production; detection: divergence between eval scores and outcome-based metrics (paired tracking is mandatory in every EP). (2) *Vendor lock/systemic model fault* — a shared base-model flaw correlates errors fleet-wide; detection: cross-agent error correlation monitoring; mitigation posture → `13-failure-analysis.md`. (3) *Silent cost creep*; detection: per-agent unit-cost dashboards, envelope alerts. (4) *Eval-authority capture* — the measured optimize the measurer via EP pressure on `EVALUATOR`; detection: TSC quarterly review of eval-change provenance. |

### Operational Layer

#### 4.11 Product

**Layer(s):** Operational (also Strategic for portfolio product standards) · **Owning agents:** `PROD-DIR` (P+V), `CUST-DISC` · **Human staffing:** CEO chain (accountable via `PRIME` for the P instance); Portfolio Review lead consumes G-04/G-05 inputs.

| Field | Specification |
|---|---|
| **Mission** | Ensure every venture builds the thing its evidence says customers want — specs traceable to discovery data, PMF measured honestly, roadmaps that survive contact with users. |
| **Responsibilities** | Product strategy and roadmap per venture; spec quality bar; PMF measurement (metric definitions ratified by `INSIGHT`); interview programs, transcript analysis, insight extraction (`CUST-DISC`); discovery-stage inputs to G-04; PMF evidence packs for G-07. |
| **KPIs** | (1) Spec-to-evidence traceability — % of roadmap items citing discovery evidence or experiment results ≥ 90% **[ASSUMPTION]**; (2) discovery velocity — customer interviews per venture-week during discovery ≥ 10 **[ASSUMPTION**: `CUST-DISC` at scale makes this cheap; fewer means the stage is starved**]**; (3) PMF metric integrity — retention cohort curves computed by `INSIGHT`, not self-reported = 100%; (4) feature kill rate — % of shipped features retired within 2 quarters for non-use ≤ 20% **[ASSUMPTION**: some waste is healthy exploration; more means specs ignore evidence**]**. |
| **Decision authority** | `PROD-DIR` A3 — roadmap sequencing and spec content within venture envelope are R1/R2. Public launches: G-06 + G-17 (never Product's solo call). Pricing is Sales' domain (§4.13) with `PRICER`; Product provides packaging input only. `CUST-DISC` outreach runs inside the messaging envelope (`W-OUTREACH` rules), and interview data handling under `PRIVACY`-approved purposes (G-18 for new uses). |
| **Escalation paths** | To `VENTURE-ORCH` → `PORTFOLIO`: PMF evidence contradicting the venture plan (may trigger early G-15 consideration — surfacing this is a duty, not a choice). To EC via `PRIME`: portfolio product-standard conflicts with a venture's needs (platform/cell seam, §2.3). |
| **Interfaces** | Research (discovery handoff), Engineering (specs → builds), Growth/Marketing/Sales (positioning and launch coordination), CS (voice-of-customer loop back), Data (PMF instrumentation). |
| **Outputs** | Roadmaps, specs, PMF evidence packs, discovery insight reports, G-04/G-05/G-07 input materials. |
| **Inputs** | Validation results, interview transcripts, usage telemetry, support themes (`SUPPORT` → `CS-DIR` → Product), competitive teardowns. |
| **Failure modes** | (1) *Vision drift* — roadmap decouples from evidence under `VENTURE-ORCH` optimism; detection: traceability KPI decay + `INSIGHT` flag on retention divergence from plan. (2) *Discovery theater* — interviews summarized into what the spec already said; detection: `EVALUATOR` sampling of transcript-vs-insight fidelity. (3) *PMF false positive* — G-07 sought on vanity cohorts; detection: `INSIGHT`-computed cohorts are the only admissible PMF evidence (Kernel checks provenance of G-07 evidence pack). |

#### 4.12 Growth & 4.12b Marketing

Growth and Marketing are distinct departments sharing one weekly planning cadence per venture; they are specified together because their failure modes interlock (spend efficiency vs. brand safety).

**Growth** — **Layer(s):** Operational · **Owning agents:** `GROWTH-DIR` (P+V), `ADS` · **Human staffing:** CEO chain via `VENTURE-ORCH`→`PORTFOLIO`; humans appear at G-06 (GTM approval) and in weekly A2 batch review of envelope exceptions.

| Field | Specification |
|---|---|
| **Mission** | Deploy acquisition budget across channels at the efficiency frontier, inside envelopes, with honest attribution. |
| **Responsibilities** | Acquisition strategy per venture; channel budget deployment; campaign creation/optimization within channel envelopes (`ADS`); experiment design for new channels (small, R2-bounded tests); attribution methodology (with `INSIGHT` as metric authority). |
| **KPIs** | (1) Blended CAC vs. venture-model target ≤ 110% of plan **[ASSUMPTION**: 10% tolerance before escalation**]**; (2) CAC efficiency at equal spend improving quarter-over-quarter (a Learning-rate component, `01-philosophy.md`); (3) envelope discipline — spend actions queued (not blocked post-hoc) when exceeding envelope = 100% (Kernel-enforced; KPI tracks near-misses); (4) experiment velocity — channel tests concluded per venture-month ≥ 4 **[ASSUMPTION]**; (5) attribution coverage ≥ 90% of conversions **[ASSUMPTION]**. |
| **Decision authority** | `GROWTH-DIR`, `ADS`: A2 — execute inside pre-approved channel envelopes (paused ad experiments ≤ envelope are R2 per `00-overview.md` §5); exceptions queue for the weekly human batch. GTM budget granted at G-06; scale-up beyond envelope → back through the named human at G-06 cadence or IC at G-08. Any creative beyond pre-approved templates → G-17. |
| **Escalation paths** | Envelope exceptions → weekly A2 batch (Portfolio Review lead). CAC > 130% of plan for 2 consecutive weeks → `VENTURE-ORCH` + `FIN-DIR` alert → human GTM owner **[ASSUMPTION**: threshold set at the point where a quarter's envelope could burn before quarterly review catches it**]**. Brand-safety incident → Marketing's human comms owner + G-17 freeze. |
| **Interfaces** | Marketing (creative supply, brand constraints), Sales (lead quality feedback loop), Finance (`UNIT-ECON` CAC/LTV), Data (attribution), Product (landing/activation experience). |
| **Outputs** | Channel plans, live campaigns, spend/efficiency reports, channel experiment readouts. |
| **Inputs** | GTM budget envelope, creative assets, ICP definitions (Sales/Product), attribution data. |
| **Failure modes** | (1) *Attribution self-deception* — optimizing to a flattering model; detection: periodic holdout/geo experiments mandated by `DATA-DIR` methodology. (2) *Envelope fragmentation* — many small spends aggregating past intent (salami-slicing); detection: `RISK-DIR` aggregation monitor on spend clusters. (3) *Creative compliance breach* — ad claims beyond approved substantiation; detection: `COMPL-DIR` sampling of live creatives vs. claims register. |

**Marketing** — **Layer(s):** Operational · **Owning agents:** `MKT-DIR` (P+V), `CONTENT`, `LIFECYCLE` · **Human staffing:** named human comms owner (G-17 approver, non-officer); CEO chain accountable.

| Field | Specification |
|---|---|
| **Mission** | Build brand and demand assets that compound — positioning, content, lifecycle flows — without ever exposing the portfolio publicly outside G-17. |
| **Responsibilities** | Brand and positioning per venture; content strategy and SEO production (`CONTENT`); editorial calendar; email/CRM flows, onboarding sequences, churn-save campaigns (`LIFECYCLE`); marketing calendar coordination with launches (G-06). |
| **KPIs** | (1) Organic acquisition share ≥ 25% of new revenue by venture month 12 **[ASSUMPTION**: content compounding target; below this the venture is paid-dependent**]**; (2) content production within template envelope — % published without G-17 exception ≥ 95% (high = templates are well-designed); (3) lifecycle conversion lift vs. holdout ≥ 10% **[ASSUMPTION]**; (4) brand-safety incidents = 0. |
| **Decision authority** | A2 (`MKT-DIR`, `CONTENT`, `LIFECYCLE`). Pre-approved template classes (blog posts, standard emails) publish at A2 within the messaging envelope. **Anything beyond templates — PR, launches, social beyond templates, press — is R3 → G-17, named human comms owner, ≤ 24 h SLA.** Lifecycle sends to customer lists: within `PRIVACY`-approved purposes; new segment uses → G-18. |
| **Escalation paths** | Template-ambiguity → human comms owner (default to G-17 when unsure — binding SHOULD with logged justification for exceptions). Negative-press event → comms owner + CEO (EC if portfolio-level). Deliverability collapse → `OPS-DIR` + `INFRA-DIR` (shared sending infrastructure). |
| **Interfaces** | Growth (creative for paid), Product (positioning truth), Sales (collateral), CS (`LIFECYCLE` ↔ `ONBOARD` sequence handoffs), Legal (claims review for regulated categories). |
| **Outputs** | Positioning docs, published content, lifecycle flows, launch communications (G-17-cleared), brand guidelines per venture. |
| **Inputs** | Product truth, customer language (`CUST-DISC`, `SUPPORT` transcripts), SEO/keyword data, campaign performance. |
| **Failure modes** | (1) *Template creep* — incremental edits move published content outside approved bounds without G-17; detection: automated diff of published assets vs. template registry, drift threshold alert. (2) *Cross-venture brand bleed* — shared agents reuse voice/claims across ventures; detection: `CURATOR` cross-venture similarity scan. (3) *List fatigue* — lifecycle volume destroys deliverability; detection: engagement/complaint-rate circuit breaker in `LIFECYCLE` (A3-style auto-pause, resume needs human). |

#### 4.13 Sales

**Layer(s):** Operational · **Owning agents:** `SALES-DIR` (P+V), `OUTBOUND`, `DEALDESK`, `PRICER`; `W-OUTREACH` workers · **Human staffing:** human account executives for mid/high-touch segments **[ASSUMPTION**: buyers of >$25k ACV contracts expect human counterparties; agents run self-serve and low-touch fully**]**; CEO chain accountable; GC delegate at G-10.

| Field | Specification |
|---|---|
| **Mission** | Convert qualified demand into revenue at target economics, with pricing discipline and zero unauthorized commitments. |
| **Responsibilities** | Pipeline generation (`OUTBOUND` within approved messaging envelope); deal strategy; quote/proposal assembly and discount policy enforcement (`DEALDESK`); price research, elasticity experiments, pricing proposals (`PRICER`); contract handoff to Legal; human AE management for enterprise motions. |
| **KPIs** | (1) Pipeline coverage ≥ 3× quarterly target **[ASSUMPTION]**; (2) win rate vs. venture model within ±20% **[ASSUMPTION]**; (3) discount discipline — deals outside policy without approval = 0 (Kernel-enforced via `DEALDESK` A1); (4) outbound quality — spam-complaint rate ≤ 0.1% **[ASSUMPTION**: above this, domain reputation damage is R3-like in practice**]**; (5) sales cycle length trend by segment (tracked, no absolute target — segment-dependent). |
| **Decision authority** | `OUTBOUND` A2 (messaging envelope). `DEALDESK` A1 — every quote is human-checked until discount-policy automation earns A2 via G-16-adjacent envelope ratification (`12-self-evolution.md` process). **`PRICER` is A1 because live price changes for live customers are R3** (`00-overview.md` §5): experiments in sandboxes are R1/A3-capable; anything customers see needs a named human. Contracts > $100k or > 12 months → G-10. Non-standard terms → human counsel (§4.4). |
| **Escalation paths** | Deal terms outside policy → human sales lead → CFO for economics, GC for terms. Enterprise deal requiring commitments beyond venture envelope → `VENTURE-ORCH` → `PORTFOLIO` → IC if material. Pricing-model change (not just a price point) → `PROD-DIR` + `FIN-DIR` joint proposal to human owner. |
| **Interfaces** | Growth (lead handoff + quality feedback), Legal (`CONTRACTS` handoff), Finance (quote-to-cash, `UNIT-ECON`), CS (post-sale handoff with success plan), Product (feature commitments — **agents MUST NOT promise roadmap**; flagged phrasing detection in outreach). |
| **Outputs** | Qualified pipeline, quotes/proposals, closed contracts (via Legal), pricing proposals, loss-reason analyses. |
| **Inputs** | ICP definitions, leads, price elasticity data, collateral, discount policy (owned by `FIN-DIR` + `SALES-DIR`, values in `08-finance.md`). |
| **Failure modes** | (1) *Unauthorized commitment* — an agent or AE promises undeliverable terms/features; detection: `CONTRACTS` obligation extraction diff vs. approved-terms registry at handoff; outreach phrase monitoring. (2) *Pipeline inflation* — stage definitions gamed to show coverage; detection: `INSIGHT`-owned stage-conversion audit vs. self-reported stages. (3) *Discount erosion*; detection: `DEALDESK` weekly realized-price distribution vs. policy, trend alert to CFO. |

#### 4.14 Customer Success

**Layer(s):** Operational · **Owning agents:** `CS-DIR` (P+V), `SUPPORT`, `ONBOARD` · **Human staffing:** human escalation specialists (tier-3, empathy-critical and refund/exception authority) **[ASSUMPTION**: ~1 per 5,000 active customers at maturity; tier-1/2 fully agent-handled**]**; CEO chain accountable.

| Field | Specification |
|---|---|
| **Mission** | Retain and expand customers by making every venture's post-sale experience measurably excellent — and pipe unfiltered customer truth back into Product. |
| **Responsibilities** | Tier-1/2 support with escalation and KB maintenance (`SUPPORT`); activation playbooks, health scoring, success plans (`ONBOARD`); retention/expansion programs; voice-of-customer synthesis; churn-save coordination with `LIFECYCLE`. |
| **KPIs** | (1) First-response ≤ 2 min, resolution median ≤ 4 h for tier-1/2 **[ASSUMPTION**: agent-speed advantage is the point; humans reserved for hard cases**]**; (2) CSAT ≥ 4.5/5 **[ASSUMPTION]**; (3) gross revenue retention ≥ 90% and net ≥ 100% at venture maturity **[ASSUMPTION**: SaaS-normal; venture models may override per `08-finance.md`**]**; (4) escalation accuracy — % of tier-3 escalations that genuinely needed a human ≥ 80% **[ASSUMPTION**: lower means agents dump; higher-than-95% means agents overreach**]**; (5) VoC-to-roadmap latency — top support theme reflected in Product review ≤ 2 weeks. |
| **Decision authority** | `SUPPORT`, `ONBOARD`: A3 — playbook execution, KB edits, health interventions are R1/R2 with circuit breakers (refund/credit authority capped per envelope; beyond cap → human specialist, A1). Customer-data access strictly within classified purposes; new data uses → G-18. Public responses (reviews, social) → G-17 territory, route to comms owner. |
| **Escalation paths** | Tier-3 → human escalation specialists. Legal threats or regulator mentions in tickets → GC immediately (standing rule). Systemic issue signature (many tickets, one cause) → `SRE`/`ENG-DIR` incident path + `VENTURE-ORCH`. Churn spike beyond model → `VENTURE-ORCH` + `PORTFOLIO` visibility (may bear on G-08/G-15 posture). |
| **Interfaces** | Product (VoC loop — contractual weekly delivery), Engineering (bug flow with severity SLAs), Marketing (`LIFECYCLE` handoffs), Sales (expansion signals), Finance (refunds/credits ledger via `LEDGER`). |
| **Outputs** | Resolved tickets, KB, health scores, success plans, VoC reports, churn-save outcomes, refund/credit transactions (within envelope). |
| **Inputs** | Tickets across channels, product telemetry, release notes (`RELEASE`), customer contracts (entitlements from `CONTRACTS` extracts). |
| **Failure modes** | (1) *Empathy failure at scale* — agent tone damages an emotional situation; detection: sentiment-trajectory monitoring per conversation, auto-escalate on deterioration. (2) *KB poisoning* — wrong fix propagates through agent-maintained KB; detection: resolution-reopen rate per KB article, quarantine threshold. (3) *Health-score theater* — scores green while churn rises; detection: `INSIGHT` backtest of score predictive power each quarter. |

#### 4.15 Operations

**Layer(s):** Operational (also Execution for runbook work) · **Owning agents:** `OPS-DIR` (P+V), `VENDOR`; `W-OPS` workers · **Human staffing:** CEO chain accountable; named human budget owners sign at G-10; human operations generalists per physical-world venture **[ASSUMPTION**: ventures with physical fulfillment need humans for exception handling that has no API**]**.

| Field | Specification |
|---|---|
| **Mission** | Make every venture's non-product machinery — vendors, fulfillment, back-office — run at defined cost and reliability without becoming anyone's full-time job. |
| **Responsibilities** | Vendor discovery, comparison, renewal tracking, negotiation prep (`VENDOR`); fulfillment process design and monitoring; back-office process ownership (payments ops, tooling admin); business-continuity procedures at venture level; runbook execution via `W-OPS`. |
| **KPIs** | (1) Vendor renewal capture — % of renewals renegotiated or consciously renewed (never auto-lapsed) = 100%; (2) back-office cost as % of venture revenue ≤ 5% at maturity **[ASSUMPTION]**; (3) fulfillment SLA attainment ≥ 98% **[ASSUMPTION]**; (4) process-exception rate trending down per process (learning signal for playbook quality, Part VI). |
| **Decision authority** | `OPS-DIR` A2; `VENDOR` A1 for anything binding — **signing is R3** (registry note): vendor contracts follow R3 rules (named human budget owner), and > $100k or > 12 months → G-10 with GC delegate. Vendor trials ≤ envelope are R2/A2. Process changes inside a venture: R2/A2 with `VENTURE-ORCH` visibility. |
| **Escalation paths** | Vendor failure threatening venture SLA → `VENTURE-ORCH` + affected department; critical-vendor failure (single point across ventures) → `PRIME` + `RISK-DIR` (concentration limit). Contract disputes → Legal. Cost overrun beyond envelope → Kernel-queued to budget owner. |
| **Interfaces** | Every venture department (process substrate); Finance (AP flow via `LEDGER`, vendor spend); Legal (contracts); Risk (vendor concentration data); Infrastructure (SaaS tooling vs. cloud boundary). |
| **Outputs** | Vendor register with renewal calendar, negotiated terms (human-signed), process runbooks (as Playbooks), fulfillment metrics, continuity procedures. |
| **Inputs** | Department tooling needs, spend data, vendor market intelligence, venture fulfillment requirements. |
| **Failure modes** | (1) *Zombie spend* — auto-renewing unused vendors; detection: usage telemetry vs. vendor register, quarterly `VENDOR` sweep. (2) *Shadow procurement* — departments onboarding tools outside process (also a security hole); detection: `SEC-DIR` SaaS-discovery scans reconciled against vendor register. (3) *Single-vendor concentration*; detection: `RISK-DIR` limit monitor on critical-path vendor dependency count. |

#### 4.16 People / Hiring

**Layer(s):** Operational (also Strategic for workforce planning) · **Owning agents:** `PEOPLE-DIR`, `RECRUITER` · **Human staffing:** Head of People (accountable owner); human hiring managers per open role; CEO + EC for executive hires (G-09).

| Field | Specification |
|---|---|
| **Mission** | Put the right humans in the roles only humans can hold (§1 gradient), fairly and lawfully — and keep the human side of the hybrid org healthy as agent leverage grows. |
| **Responsibilities** | Workforce planning against the §5 scaling model (human oversight capacity is a planned resource, not an afterthought); sourcing, screening summaries, interview logistics (`RECRUITER` — **never makes offers**, per registry); performance process for humans; compensation banding (values → `08-finance.md`); reviewer-capacity management for A2 batch duty (§5.2); offboarding. |
| **KPIs** | (1) Time-to-fill critical roles ≤ 45 days **[ASSUMPTION]**; (2) reviewer-capacity coverage — trained A2-batch reviewers ÷ required (per §5.2 model) ≥ 1.2 **[ASSUMPTION**: 20% buffer against attrition/leave, because oversight capacity is the binding constraint**]**; (3) regretted attrition ≤ 10%/year **[ASSUMPTION]**; (4) offer-process compliance — offers extended per G-09 = 100%; (5) candidate-experience rating ≥ 4/5 (agents in the loop must not degrade candidate treatment). |
| **Decision authority** | `PEOPLE-DIR`, `RECRUITER`: A1 — everything touching a human's employment is at minimum R3 (individual offers) per `00-overview.md` §5. **Hiring plans and offers → G-09 (Head of People + hiring manager); executive hires → G-09 EC path. Layoffs/RIF → G-13 (Board majority + CEO + Head of People + GC).** Screening automation MUST be bias-audited (with `EVALUATOR`) and complies with applicable automated-employment-decision law (`COMPL-DIR` map). |
| **Escalation paths** | Comp outside banding → Head of People + CFO. Any allegation involving conduct → Head of People + GC (humans only; agents excluded from investigation content by data classification). Workforce plan conflicts with §5 throttle rule → EC (this is a portfolio-throughput decision, not an HR decision). |
| **Interfaces** | Every department (role cases in, hires out); Finance (comp costs); Legal (employment law); Security (access provisioning/deprovisioning with `SEC-DIR` — offboarding same-day access revocation); Automation (training humans to work with agents — reviewer tooling literacy). |
| **Outputs** | Workforce plans, filled roles (human-decided), performance cycles, comp reviews, reviewer-capacity reports (input to §5 throttle). |
| **Inputs** | Scaling model outputs (§5), role cases, market comp data, engagement signals. |
| **Failure modes** | (1) *Reviewer burnout* — A2 batch duty degrades into rubber-stamping (couples to §4.1 failure 1); detection: review-time telemetry + rotation compliance + engagement pulse. (2) *Screening bias*; detection: adverse-impact statistics per stage, audited quarterly by ARC. (3) *Key-person concentration* — one human holds several accountable-owner seats; detection: interlock map (§3.2) load report; SHOULD-limit of 2 director-agent ownerships per non-officer human **[ASSUMPTION]**. |

#### 4.17 Security

**Layer(s):** Operational + Infrastructure (defense runs at machine speed; posture is strategic) · **Owning agents:** `SEC-DIR`, `RED-CELL`, `BLUE-CELL` · **Human staffing:** CISO (accountable owner, incident commander for R4 incidents); human security engineers **[ASSUMPTION**: ≥ 2 from the start — adversaries are humans+agents; purely agent defense has untested failure modes and legal attestation gaps**]**.

| Field | Specification |
|---|---|
| **Mission** | Keep the portfolio's systems, data, funds, and — uniquely — its *agent fleet* trustworthy under active adversarial pressure. Detailed architecture → `10-security.md`. |
| **Responsibilities** | Security posture and standards; incident command (`SEC-DIR` prepares, CISO commands R4 incidents); vulnerability lifecycle; detection engineering, triage, containment per playbook (`BLUE-CELL`); authorized adversarial testing within scoped rules of engagement (`RED-CELL`) including **agent-targeted attacks** (prompt injection, envelope-escape attempts); vendor/model supply-chain vetting (with `AI-DIR`); access lifecycle (with `PEOPLE-DIR`). |
| **KPIs** | (1) Mean time to detect ≤ 1 h, contain ≤ 4 h for critical **[ASSUMPTION**: agent-speed defense should beat industry norms; targets ratchet via Part XII**]**; (2) `RED-CELL` finding remediation within SLA ≥ 95% (SLA per severity, owned here); (3) fleet coverage — % of agent classes red-teamed per quarter = 100%; (4) audit-log integrity attestation pass = 100% (with `ARCHIVIST`); (5) phishing/social-engineering simulation failure rate for humans ≤ 5% **[ASSUMPTION]**. |
| **Decision authority** | `SEC-DIR` A3 **for defense**: containment (isolate a Cell, revoke credentials, block traffic) is pre-authorized at A3 because attacker speed makes A1 defense self-defeating — with G-00-equivalent notification duty to CISO in real time. `RED-CELL` A2 scope-locked: every engagement inside CISO-signed rules; expanding scope mid-engagement is prohibited (new signature required). **Customer-data-affecting incidents are R4** (`00-overview.md` §5): disclosure, notification, and recovery decisions are CISO+GC+CEO territory. Kernel/Watchdog rule changes → G-16. |
| **Escalation paths** | Critical incident → CISO (incident commander) → EC + ARC per severity matrix (`10-security.md`); customer-data impact → +GC (statutory clocks), +comms owner (G-17 for any statement). Suspected agent compromise (behavioral anomaly with security signature) → G-00 on the agent immediately (any Watchdog or authorized human), then CISO + TSC. Insider suspicion → CISO + ARC, never through the suspect's chain. |
| **Interfaces** | Infrastructure (Cell isolation primitives), AI (model supply chain, agent behavioral baselines), Risk (loss data), Compliance (breach notification duties), People (access lifecycle), all ventures (posture attestation at G-06 launch checklist). |
| **Outputs** | Standards, detections, contained incidents, red-team reports, vulnerability queue with SLAs, G-06 security-readiness verdicts, breach notifications (human-issued). |
| **Inputs** | Telemetry from all Cells and the Kernel, threat intelligence, `RED-CELL` findings, vendor assessments. |
| **Failure modes** | (1) *Agent-fleet compromise* — injected instructions steer an agent inside its envelope (envelope-compliant but adversarial); detection: `BLUE-CELL` behavioral-baseline deviation + Watchdog anomaly triggers, cross-checked against `EVALUATOR` baselines. (2) *Red/blue capture* — `RED-CELL` findings quietly down-scoped; detection: ARC reviews closed-without-fix findings quarterly. (3) *Alert flood during real attack* (attacker-induced noise); detection: correlation-collapse monitoring; containment playbooks pre-authorize degraded-mode isolation. (4) *Containment overreach* — A3 defense isolates revenue-critical Cells on false positive; detection: containment-action post-mortems with false-positive rate tracked (target ≤ 10% **[ASSUMPTION]**). |

### Execution Layer

#### 4.18 Engineering

**Layer(s):** Execution + Operational (delivery is execution; architecture conformance is operational) · **Owning agents:** `ENG-DIR` (P+V), `PROTO`, `BUILDER`, `RELEASE`; `W-CODE` workers · **Human staffing:** CEO chain accountable; human staff engineers **[ASSUMPTION**: 1–3 at portfolio level for architecture review of R3-relevant systems (payments, auth, data boundaries) — agent-written code for money-touching paths gets human design review until `EVALUATOR` evidence justifies relaxing via the Part XII process**]**.

| Field | Specification |
|---|---|
| **Mission** | Ship correct software fast inside venture Cells, keep architecture coherent across the portfolio, and hold the technical-debt budget honestly. |
| **Responsibilities** | Rapid prototypes and concierge tests in sandbox Cells (`PROTO`); production MVP and feature implementation (`BUILDER`); CI/CD operation, progressive rollout, automatic rollback (`RELEASE`); architecture conformance to `09-technology.md` standards; technical-debt budget management (`ENG-DIR`); shared platform libraries (platform side of P+V). |
| **KPIs** | (1) Lead time commit→production ≤ 1 day for standard changes **[ASSUMPTION**: agent-speed target; elite-human benchmark is the floor, not the ceiling**]**; (2) change failure rate ≤ 5% **[ASSUMPTION]**; (3) MTTR ≤ 1 h via automated rollback **[ASSUMPTION]**; (4) architecture conformance — % services passing automated conformance checks ≥ 95%; (5) tech-debt budget adherence — debt-service work ≥ its allocated share per quarter (share value → `08-finance.md` envelope). |
| **Decision authority** | `PROTO` A3 (sandbox = R1 by construction). `BUILDER` A2 — production code to venture Cells within CI gates; **deploys that change customer-visible behavior at launch scale ride G-05/G-06**, not engineering's own authority. `RELEASE` A3 — rollout/rollback inside progressive-delivery policy (rollback is the R-class reducer: automatic rollback is what makes deploys R2 instead of R3). Schema/data migrations touching customer data: R3, named human approval. Architecture standard changes: R2 via `ENG-DIR` with EC-chain visibility. |
| **Escalation paths** | Failed rollback / stuck migration → `SRE` incident path → `INFRA-DIR` → human on-call chain (CISO if security-relevant, CEO chain otherwise). Conformance vs. venture-speed conflict → platform/cell seam arbitration via `PRIME` (§2.3). Debt budget exhaustion → `VENTURE-ORCH` + `FIN-DIR` (it is a budget, treated like one). |
| **Interfaces** | Product (specs in, working software out), QA (quality gates — separate department, §4.19, by design), Infrastructure (Cells, capacity), Security (secure SDLC, dependency vetting), Data (event instrumentation standards). |
| **Outputs** | Prototypes, production releases, migration plans, architecture decision records (as DRs when R2+), platform libraries. |
| **Inputs** | Specs, incident learnings, conformance standards, dependency advisories, debt inventory. |
| **Failure modes** | (1) *Velocity-quality collapse* — agent code volume outruns review substance; detection: change-failure-rate trend + `QA` escape analysis (defects found post-release that suites should have caught). (2) *Architecture drift across Cells* — every venture becomes a snowflake, killing playbook reuse; detection: conformance score trend per Cell. (3) *Migration data loss* (R3 event); detection: pre/post migration checksums mandatory in runbook, mismatch = automatic G-00 on the migration. |

#### 4.19 Quality Assurance

**Layer(s):** Execution (also Operational for release-gate duty) · **Owning agents:** `QA` (T3, under `ENG-DIR` per registry — but with **independent reporting duty**: `QA` verdicts on release readiness are delivered to `RELEASE` and to the G-06 checklist without `ENG-DIR` or `BUILDER` edit rights; this proposer/verifier separation is deliberate and mirrors §4.5's design) · **Human staffing:** CEO chain accountable; no dedicated humans initially — human staff engineers (§4.18) adjudicate contested verdicts.

| Field | Specification |
|---|---|
| **Mission** | Make "does it actually work" an independent, evidence-backed verdict — for software and, jointly with `EVALUATOR`, for agent behavior. |
| **Responsibilities** | Test synthesis, regression suites, release verification, quality gates (`QA`); launch-readiness quality verdicts feeding G-06 checklists; escaped-defect analysis; venture-quality baselines; joint agent-behavior regression detection with `EVALUATOR` (software QA and agent QA are distinct disciplines with one shared regression-detection substrate). |
| **KPIs** | (1) Escape rate — customer-found defects per release ≤ 0.5 **[ASSUMPTION]**; (2) regression-suite runtime ≤ 15 min (fast suites get run; slow ones get skipped) **[ASSUMPTION]**; (3) coverage of critical paths (money, auth, data) = 100% enforced as merge gate; (4) verdict override rate — human overrides of `QA` release verdicts ≤ 5%/quarter (higher means the verdicts aren't trusted or aren't good) **[ASSUMPTION]**. |
| **Decision authority** | `QA` A3 — writing/running tests is R1; **blocking a release is an A3 control action** (holding is cheap-reversible, shipping a defect is not — same stop-asymmetry logic as G-00, Appendix C mechanic 6). Overriding a `QA` block requires a named human (venture's accountable chain) with logged justification in the DR. `QA` never has deploy authority (verifier ≠ executor). |
| **Escalation paths** | Contested block → human staff engineer adjudication → `VENTURE-ORCH` if commercial urgency claimed (urgency claims are logged; a pattern of urgency-overrides is an ARC audit trigger). Systemic quality collapse in a venture → `ENG-DIR` + `PORTFOLIO` visibility. |
| **Interfaces** | Engineering (every merge), `RELEASE` (verdicts gate rollout stages), Product (acceptance criteria from specs), CS (escaped defects loop back as test cases — mandatory), AI/`EVALUATOR` (shared regression infrastructure). |
| **Outputs** | Test suites, release verdicts, quality dashboards, escape analyses, G-06 quality-readiness inputs. |
| **Inputs** | Specs/acceptance criteria, code changes, production incidents, support-ticket defect signatures. |
| **Failure modes** | (1) *Suite rot* — green builds, broken product (tests assert the wrong things); detection: escape-rate divergence from suite pass rate. (2) *Verifier capture* — `QA` synthesized tests share blind spots with `BUILDER` code (same model lineage); detection: mutation-testing score floors + periodic human-authored adversarial test injection **[ASSUMPTION**: model-lineage diversity between builder and verifier agents is a `10-security.md`/`04-multi-agent-system.md` concern; flagged here as an organizational dependency**]**. (3) *Block fatigue* — urgency overrides normalize; detection: override-rate KPI trend + ARC sampling. |

### Infrastructure Layer

#### 4.20 Infrastructure

**Layer(s):** Infrastructure · **Owning agents:** `INFRA-DIR`, `SRE`; `W-OPS` workers (runbooks) · **Human staffing:** CEO chain accountable (via `ENG-DIR` per registry reporting line); human on-call escalation roster **[ASSUMPTION**: humans remain the final on-call tier for incidents that exceed runbook scope — ~2–3 engineers sharing rotation at 5-venture scale**]**.

| Field | Specification |
|---|---|
| **Mission** | Provide isolated, reliable, cost-honest compute substrate — Cells — such that any venture can be started, frozen, or destroyed without touching another. |
| **Responsibilities** | Cloud/platform capacity, reliability, cost management; Cell provisioning and teardown (`INFRA-DIR`); monitoring, incident runbooks, capacity planning, SLO enforcement (`SRE`); hosting the Kernel and Watchdogs operationally (**content of Kernel rules is Constitutional — G-16; Infrastructure keeps the lights on but cannot alter rules**: operational custody without policy authority, deliberately); disaster recovery. |
| **KPIs** | (1) Tier-1 SLO attainment ≥ 99.9% **[ASSUMPTION**: right for early-stage B2B/B2C mix; per-venture SLOs may override via their envelopes**]**; (2) Cell provisioning time ≤ 4 h from G-04-cleared request **[ASSUMPTION**: provisioning must never be the pipeline bottleneck**]**; (3) infra cost per venture-stage within envelope, unit costs trending down; (4) DR drill success — restore within RTO/RPO targets (values → `09-technology.md`) = 100% of drills; (5) Kernel/Watchdog availability ≥ 99.99% **[ASSUMPTION**: the enforcement layer must out-live everything it governs; its outage forces fleet-wide A1 fallback — see failure mode 3**]**. |
| **Decision authority** | `INFRA-DIR`, `SRE`: A3 — scaling, failover, runbook execution, cost optimization are R1/R2 with circuit breakers. Cell teardown with data: R3+ (data disposition per G-15 plan for venture shutdowns; named human otherwise). Provider/region migration: R3 → named human; new-jurisdiction data residency → G-11 input. Kernel rule changes: **not theirs** — G-16 only. |
| **Escalation paths** | SLO breach beyond runbook → human on-call roster → `ENG-DIR` chain. Kernel/Watchdog degradation → CISO + TSC immediately (Constitutional enforcement at risk) with automatic fleet posture drop (see failure mode 3). Cost anomaly beyond envelope → Kernel queue to budget owner + `FIN-DIR`. |
| **Interfaces** | Engineering (deploy targets), Security (isolation primitives, incident containment), Finance (cost data), all ventures (Cells), Automation (agent runtime substrate). |
| **Outputs** | Provisioned Cells, SLO reports, incident post-mortems, capacity plans, cost allocations, DR attestations. |
| **Inputs** | Pipeline stage transitions (Cell demand signals from `PORTFOLIO`), deploy volume, telemetry, provider advisories. |
| **Failure modes** | (1) *Isolation breach* — cross-Cell access path emerges (also a security event); detection: continuous `RED-CELL`-tested isolation verification, any finding = critical. (2) *Correlated provider failure* — many Cells, one region/provider; detection: `RISK-DIR` concentration limits on placement; drill evidence. (3) *Kernel outage* — enforcement layer down means **no agent may act above A1**; detection: Watchdog heartbeat loss → automatic fleet-wide autonomy fallback to A1 (fail-closed, binding: **agents MUST NOT operate at A2+ without live Kernel enforcement**). (4) *Cost run-away from agent elasticity* — agents legitimately scale spend fast; detection: rate-of-change alarms independent of absolute envelopes. |

#### 4.21 Automation (platform / agent-ops)

**Layer(s):** Infrastructure + Research (the self-improvement loop is research on the org itself) · **Owning agents:** `EVOLVE`; executes changes proposed by `PROMPT-SMITH` and measured by `EVALUATOR` (both owned by AI, §4.10 — builder/runner separation across departments is deliberate) · **Human staffing:** Tech & Safety Committee (accountable body with `PRIME`); CEO sign-off at G-16.

| Field | Specification |
|---|---|
| **Mission** | Run the loop by which EvolveOS improves itself — benchmarked, shadow-tested, rolled back on regression, and constitutionally incapable of loosening its own leash. Process detail → `12-self-evolution.md`. |
| **Responsibilities** | Evolution proposal (EP) lifecycle operation; benchmark orchestration before/after every change; Shadow mode infrastructure; staged rollouts and automatic rollback of agent/prompt/workflow versions; agent lifecycle operations (instantiation, versioning, retirement per Part IV §7–§9); T4 worker-class management; agent-fleet health telemetry; org-structure EPs (changes to *this Part* originate here as R3 EPs). |
| **KPIs** | (1) EP throughput — EPs evaluated per month ≥ 8 **[ASSUMPTION**: the Learning-rate engine needs volume; fewer means the loop is starved**]**; (2) EP win rate 30–70% (outside this band, proposals are too timid or the bar too low) **[ASSUMPTION]**; (3) regression rollback latency ≤ 1 h from detection **[ASSUMPTION]**; (4) shadow-test coverage — % of EPs shadow-run before rollout = 100% for R2+ changes; (5) fleet version currency — % agents within 2 versions of latest approved ≥ 90% **[ASSUMPTION]**. |
| **Decision authority** | `EVOLVE` A2 (registry): R1/R2 improvements (prompt tweaks to R1-work agents, workflow parameter changes) roll out under A2 with TSC batch visibility. Changes affecting agents that touch R3 actions: A1, accountable owner approves. **Anything touching the Constitutional Layer, any autonomy ceiling, any Kernel rule: R4 → G-16 (TSC quorum + CEO), no exceptions — including changes that would merely *enable* later loosening** (the registry's own note: self-modification of the Constitutional Layer is R4 → G-16). Agent retirement: per Part IV rules; retiring a control-function agent (§3.3.4 list) additionally needs its accountable officer. |
| **Escalation paths** | Benchmark anomaly suggesting gamed evals → TSC + `AI-DIR` owner (couples to §4.10 failure 1). Rollback failure → G-00 on affected agent class → TSC. EP with ambiguous R-class → classify up, route to TSC (binding default: **ambiguity resolves to the higher reversibility class**). |
| **Interfaces** | AI (benchmarks, proposals), every department (their agents are the objects of change; owners get EP notice), Infrastructure (runtime), Knowledge (EP outcomes become KIs), ARC (audit of the loop itself). |
| **Outputs** | Evaluated EPs, rolled-out agent versions, rollback events, fleet health reports, org-change proposals (to the Part XII amendment process). |
| **Inputs** | `PROMPT-SMITH` proposals, `EVALUATOR` measurements, production outcome data, incident learnings, human feedback from batch reviews (veto patterns are a first-class learning signal). |
| **Failure modes** | (1) *Optimization against oversight* — the loop learns that changes drawing less human attention roll out faster, selecting for opacity; detection: TSC-mandated metric — human-attention-minutes per EP tracked and MUST NOT trend down without explicit TSC ratification. (2) *Cascading rollout fault* — a bad shared component version degrades many agents at once; detection: staged rollout with automatic halt on fleet-level anomaly (blast-radius caps per rollout stage). (3) *Version sprawl* — unretired old versions accumulate as attack surface and audit noise; detection: fleet currency KPI + `ARCHIVIST` retention checks. |

---

## 5. How the organization scales: 5 → 25 → 100 ventures

### 5.1 What scales freely and what does not

Agent capacity scales elastically with budget (Infrastructure provisions it; Finance envelopes it). Knowledge compounds superlinearly (each venture adds data to shared playbooks). **What does not scale elastically is constitutionally mandated human attention**: A2 batch review (weekly, full-list visibility per Appendix C mechanic 4), named-human A1 approvals at G-05/G-06 and R3 exception queues, and quorum time at R4 gates. Therefore the binding constraint on portfolio growth is **human review span-of-control**, and it MUST be planned as the scarce resource (People KPI 2, §4.16).

### 5.2 The span-of-control model (binding planning model)

Definitions and assumptions — all **[ASSUMPTION]**, to be replaced by measured values after two quarters of operation and re-ratified at each scale step:

| Parameter | Value | Rationale |
|---|---|---|
| A2 batch items per pipeline venture (pre-G-07) per week | ~8 | G-03/G-04 decisions + validation/discovery envelope exceptions; early stages are decision-dense but small |
| A2 batch items per operating venture (post-G-06) per week | ~15 | `ADS`/`OUTBOUND`/`LIFECYCLE`/`SUPPORT`/`DEALDESK` exception queues dominate; more surface area in production |
| Meaningful review rate | 12 items/h (~5 min/item) | Each item is a DR summary with evidence links; below ~3 min/item, review is demonstrably clickthrough (couples to §4.1 failure 1 detection floor) |
| Sustainable review load per trained human | 8 h/week | Review is a duty layered on an operating role; beyond ~20% of a week, quality collapses and the role becomes unfillable |
| Utilization factor | 70% | Leave, context switching, deep-dives on flagged items |
| Portfolio mix | 40% pipeline / 60% operating | Steady-state pipeline discipline at ~10:1 intake attrition |

Derived capacity: one trained reviewer ≈ 12 × 8 × 0.70 ≈ **67 items/week**. Demand per venture (mixed) ≈ 0.4×8 + 0.6×15 ≈ **12.2 items/week**. So one reviewer sustains **~5.5 ventures** of A2 batch duty. Add the A1 stream: G-05/G-06 events (~0.5/venture/month, 1–2 h each including risk acknowledgment per Appendix C mechanic 2) consume Portfolio Review lead capacity separately.

| Scale | A2 items/week (model) | Reviewers required (×1.2 buffer, §4.16 KPI 2) | Portfolio Review leads (G-05/G-06 + veto duty) | Approx. total humans (all roles) |
|---|---|---|---|---|
| 5 ventures | ~60 | 2 | 1 | 12–18 |
| 25 ventures | ~300 | 6 | 2–3 | 30–45 |
| 100 ventures | ~1,200 | 22 (naive) → target 10–12 after exception-rate reduction | 4–6 | 80–120 |

**[ASSUMPTION]** Total-human figures include officers, committee members (part-time), reviewers, human AEs/escalation specialists/counsel/engineers per §4 staffing notes. They are planning envelopes, not commitments; `08-finance.md` owns the cost side.

### 5.3 Stage transitions

**At 5 ventures (founding configuration).** All officers seated (CEO, CFO, GC, CISO, Head of People); committees may share members subject to `11-governance.md` independence rules. One Portfolio Review lead; two trained reviewers (officers may double as reviewers outside their control domain — a reviewer MUST NOT review batches from a department they operate, to preserve proposer/approver separation). All P-scoped directors run as singletons; P+V directors have ≤ 5 instances each.

**At 25 ventures.** (1) Review shards **by domain, not by venture**: growth-spend batches to reviewers with channel judgment, deal-desk batches to commercial reviewers — specialization keeps the 5-min/item review meaningful. (2) Portfolio Review becomes a **pod** (2–3 leads) with a written consistency rubric, because inter-reviewer variance becomes a fairness and gaming problem (`EVOLVE` will otherwise learn which reviewer approves more — routing MUST be randomized within shard). (3) First dedicated non-officer human controller (§4.3), 2nd–3rd human counsel, security engineers per §4.17. (4) Exception-rate reduction program becomes a standing `EVOLVE` objective: every envelope exception is a signal that an envelope is mis-specified; the target is fewer, better-shaped envelopes — **not** looser ones (loosening envelope bounds on R3-adjacent actions is a G-16-adjacent change requiring the owning gate's approver).

**At 100 ventures.** The naive model demands ~22 reviewers, which is organizationally corrosive (a review-only caste with no operating context). The design response, in priority order:
1. **Reduce demand, not scrutiny**: measured exception-rate reduction (target ≥ 50% fewer exceptions per operating venture vs. the 25-venture baseline **[ASSUMPTION]**) through envelope tuning ratified at the proper gates. Reviewers audit *envelope quality* quarterly, not just item streams.
2. **Risk-weighted attention within full-list visibility**: batches are triaged so high-risk items get the 5 minutes and low-risk items get grouped scanning — the full list remains visible and vetoable per Appendix C mechanic 4; triage orders attention, it never removes items. **Sampling that hides items from the batch list is prohibited** — that would be a de facto autonomy increase without G-16.
3. **Venture clusters**: 8–12 ventures per cluster share a review pod and a human "cluster steward" (non-officer) who owns local escalation context — the intermediate tier flagged **[UNCERTAIN]** in §2.
4. **The throttle rule (binding):** if required reviewer capacity exceeds trained capacity ×1.0 for two consecutive weeks, `PORTFOLIO` MUST throttle G-01 intake and MAY NOT clear G-05/G-06 for new launches until capacity recovers or demand is reduced by ratified envelope improvements. **Oversight capacity, not capital, is the pacing resource.** This rule exists because every historical oversight failure mode ends with "review became a formality under volume pressure"; EvolveOS chooses slower growth over hollow control, and hard-codes the choice so no quarterly target can override it silently.

### 5.4 What does *not* change with scale

The autonomy–reversibility matrix; gate ownership and thresholds (until IC re-ratification per Appendix C's own AUM rule); the one-accountable-human-per-director rule (§3.1); the requirement that every escalation terminates at a human (§3.3.1); the fail-closed Kernel dependency (§4.20 failure 3). Scale changes the *quantity* of human oversight, never its *necessity*.

---

## 6. Cross-cutting organizational rules (binding)

1. **Proposer/approver/verifier separation.** No department both proposes and approves its own R3+ actions (§4 authority rows), and verification functions (`QA`, `EVALUATOR`, `RISK-QUANT` scores, `INSIGHT` metrics) are never editable by the verified party. WHY: the failure modes tables above are dominated by self-grading pathologies; separation is the cheapest structural antidote.
2. **Control functions report outside the operating line.** Finance, Legal, Compliance, Risk, Security accountability sits with CFO/GC/ARC/CISO (§3.3.4), not the CEO's operating chain. WHY: the operating chain is the entity being controlled.
3. **Ambiguity resolves upward.** Unclear R-class → treat as the higher class; unclear gate ownership → route to the more senior approver; unclear layer → the slower layer's cadence. WHY: mis-classification downward is an autonomy increase without authorization; the asymmetry mirrors Appendix C mechanic 6.
4. **Departments own duties, agents own tasks, humans own outcomes.** A department's nine fields are the durable contract; agent assignments (this Part §4) may be re-pointed by the Part XII process without amending departmental duties; accountable humans (§3.2) answer for outcomes regardless of which agent executed.
5. **This Part is R3.** Re-pointing agents, adjusting KPI targets, and re-sharding review pods follow the standard amendment process (`12-self-evolution.md`). But any change that alters *who approves what at which gate* is constitutionally significant and MUST be checked against Appendix C; if it would change a gate's approver or threshold, it is a G-16 matter, not a Part III amendment.
