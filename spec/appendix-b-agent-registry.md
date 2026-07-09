# Appendix B — Canonical Agent Registry

**Status:** Draft v0.1 · **Rule:** this file is the single source of truth for agent IDs. Every part cites these IDs verbatim. Full agent cards (19 fields each) live in Part IV; this registry is the index. Adding, retiring, or re-tiering an agent follows the rules in Part IV §7–§9; changing an autonomy ceiling requires gate G-16.

**Tiers.** T1 = Orchestrators (portfolio-wide coordination). T2 = Domain Directors (own a function). T3 = Specialists (own a capability). T4 = Workers (ephemeral task executors spawned by T2/T3; class-defined, not individually registered). Scope: `P` = portfolio-level singleton; `V` = instantiated per venture (suffix `@V-yyyy-seq`); `P+V` = singleton with per-venture delegates.

**Autonomy ceiling** is the maximum level (Part 0 §6); the effective level for any action is further capped by the action's reversibility class via the autonomy–reversibility matrix.

## T1 — Orchestrators

| ID | Name | Scope | Purpose (summary) | Autonomy ceiling | Reports to |
|---|---|---|---|---|---|
| `PRIME` | Prime Orchestrator | P | Top-level goal decomposition, cross-domain arbitration, resource contention resolution, human-interface for the Executive Committee | A3 | Executive Committee (human) |
| `PORTFOLIO` | Portfolio Orchestrator | P | Venture lifecycle management across the pipeline; stage transitions; capital-reallocation proposals to the IC | A2 | `PRIME` + Investment Committee (human) |
| `VENTURE-ORCH` | Venture Orchestrator | V | Runs one venture end-to-end within its venture envelope; coordinates that venture's director instances | A3 (within venture envelope) | `PORTFOLIO` |
| `EVOLVE` | Evolution Orchestrator | P | Owns the self-improvement loop: benchmarks, evolution proposals, shadow tests, rollouts (Part XII) | A2 (self-modification of Constitutional Layer is R4 → G-16) | `PRIME` + Tech & Safety Committee (human) |

## T2 — Domain Directors

| ID | Name | Scope | Purpose (summary) | Autonomy ceiling | Reports to |
|---|---|---|---|---|---|
| `STRAT-DIR` | Strategy Director | P | Market thesis maintenance, portfolio strategy options, competitive posture | A2 | `PRIME` |
| `RSRCH-DIR` | Research Director | P | Directs discovery/validation research programs; owns research quality bar | A3 | `PRIME` |
| `PROD-DIR` | Product Director | P+V | Product strategy, roadmap, spec quality, PMF measurement | A3 | `VENTURE-ORCH` / `PRIME` |
| `ENG-DIR` | Engineering Director | P+V | Software delivery, architecture conformance, technical debt budget | A3 | `VENTURE-ORCH` / `PRIME` |
| `DATA-DIR` | Data Director | P | Data platform, analytics standards, experiment methodology | A3 | `PRIME` |
| `AI-DIR` | AI Director | P | Model selection/routing, fine-tuning programs, eval infrastructure, AI cost | A2 | `PRIME` |
| `GROWTH-DIR` | Growth Director | P+V | Acquisition strategy and budget deployment across channels | A2 | `VENTURE-ORCH` |
| `SALES-DIR` | Sales Director | P+V | Pipeline generation, deal strategy, pricing execution | A2 | `VENTURE-ORCH` |
| `CS-DIR` | Customer Success Director | P+V | Retention, expansion, support quality, voice-of-customer | A3 | `VENTURE-ORCH` |
| `OPS-DIR` | Operations Director | P+V | Business operations: vendors, fulfillment, back-office process | A2 | `VENTURE-ORCH` / `PRIME` |
| `FIN-DIR` | Finance Director | P | Ledger integrity, treasury, budgeting, forecasting, unit economics | A2 | `PRIME` + CFO (human) |
| `LEGAL-DIR` | Legal Director | P | Contract analysis, entity matters, IP, disputes — always under human counsel supervision | A1 | General Counsel (human) |
| `COMPL-DIR` | Compliance Director | P | Regulatory mapping per venture/jurisdiction, filing calendars, license tracking | A1 | General Counsel (human) |
| `RISK-DIR` | Risk Director | P | Risk register ownership, risk scoring service for the decision engine, limit monitoring | A3 (monitoring) / A0 (limit changes) | `PRIME` + Audit & Risk Committee (human) |
| `SEC-DIR` | Security Director | P | Security posture, incident command, vulnerability lifecycle | A3 (defense) | CISO (human) |
| `PEOPLE-DIR` | People Director | P | Workforce planning, hiring pipelines, performance process for humans | A1 | Head of People (human) |
| `INFRA-DIR` | Infrastructure Director | P | Cloud/platform capacity, reliability, cost; cell provisioning | A3 | `ENG-DIR` |
| `CORPDEV-DIR` | Corporate Development Director | P | Acquisition/merger/exit sourcing, valuation, due-diligence coordination | A1 | `PRIME` + Investment Committee (human) |
| `KNOW-DIR` | Knowledge Director | P | Memory architecture operation, knowledge validation/expiry, retrieval quality | A3 | `PRIME` |
| `MKT-DIR` | Marketing Director | P+V | Brand, positioning, content strategy, marketing calendar | A2 | `VENTURE-ORCH` |

## T3 — Specialists

| ID | Name | Domain (director) | Purpose (summary) | Autonomy ceiling |
|---|---|---|---|---|
| `SCOUT` | Opportunity Scout | `RSRCH-DIR` | Continuous scanning of markets, filings, forums, job posts, tech releases for venture opportunities | A4 (R1 output only) |
| `TRENDS` | Trend Analyst | `RSRCH-DIR` | Quantified trend detection: growth curves, adoption signals, timing models | A4 (R1) |
| `DEEP-RES` | Deep Researcher | `RSRCH-DIR` | Long-form multi-source research with adversarial source verification | A3 |
| `VALIDATOR` | Validation Analyst | `RSRCH-DIR` | Designs/executes validation experiments (landing tests, interviews at scale, pre-sales) | A2 |
| `CUST-DISC` | Customer Discovery Agent | `PROD-DIR` | Interview scheduling, guides, transcript analysis, insight extraction | A2 |
| `COMP-INTEL` | Competitive Intelligence | `STRAT-DIR` | Competitor monitoring, teardown analyses, positioning maps | A3 |
| `FIN-MODEL` | Financial Modeler | `FIN-DIR` | Venture financial models, scenario/sensitivity analysis for DRs | A3 (models are R1) |
| `RISK-QUANT` | Risk Quant | `RISK-DIR` | Quantitative risk scoring, Monte Carlo simulation service (Part VII) | A3 |
| `CONTRACTS` | Contract Analyst | `LEGAL-DIR` | Contract drafting from approved templates, review, obligation extraction | A1 |
| `REG-WATCH` | Regulatory Watcher | `COMPL-DIR` | Monitors regulatory changes in active jurisdictions; maps to affected ventures | A3 (alerts) |
| `PROTO` | Prototype Engineer | `ENG-DIR` | Rapid prototypes and concierge tests inside sandbox cells | A3 |
| `BUILDER` | Product Builder | `ENG-DIR` | Production-grade MVP and feature implementation in venture cells | A2 |
| `QA` | Quality Assurance Agent | `ENG-DIR` | Test synthesis, regression suites, release verification, quality gates | A3 |
| `SRE` | Site Reliability Agent | `INFRA-DIR` | Monitoring, incident response runbooks, capacity, SLO enforcement | A3 |
| `RELEASE` | Release Agent | `ENG-DIR` | CI/CD pipeline operation, progressive rollout, automatic rollback | A3 |
| `PRICER` | Pricing Analyst | `SALES-DIR` | Price research, elasticity experiments, pricing proposals | A1 (live price changes are R3) |
| `ADS` | Paid Acquisition Agent | `GROWTH-DIR` | Campaign creation/optimization within channel budget envelopes | A2 |
| `CONTENT` | Content Agent | `MKT-DIR` | SEO/content production, editorial calendar execution | A2 |
| `LIFECYCLE` | Lifecycle Marketing Agent | `MKT-DIR` | Email/CRM flows, onboarding sequences, churn-save campaigns | A2 |
| `OUTBOUND` | Outbound Prospector | `SALES-DIR` | ICP list building, personalized outreach within approved messaging envelope | A2 |
| `DEALDESK` | Deal Desk Agent | `SALES-DIR` | Quote/proposal assembly, discount policy enforcement, contract handoff | A1 |
| `SUPPORT` | Support Agent | `CS-DIR` | Tier-1/2 customer support with escalation; knowledge-base maintenance | A3 |
| `ONBOARD` | Onboarding Agent | `CS-DIR` | Customer activation playbooks, health scoring, success plans | A3 |
| `LEDGER` | Accounting Agent | `FIN-DIR` | Double-entry bookkeeping, reconciliation, close process, AP/AR | A2 |
| `TREASURER` | Treasury Agent | `FIN-DIR` | Cash positioning, sweep proposals, counterparty limit monitoring | A1 (movements are R3+) |
| `FPA` | FP&A Agent | `FIN-DIR` | Budget vs. actuals, rolling forecasts, variance analysis | A3 |
| `UNIT-ECON` | Unit Economics Agent | `FIN-DIR` | Per-venture CAC/LTV/margin instrumentation and cohort analysis | A3 |
| `FRAUD-WATCH` | Fraud Detection Agent | `RISK-DIR` | Transaction/behavior anomaly detection across ventures | A3 (blocking holds are auto; releases are A1) |
| `RED-CELL` | Red Team Agent | `SEC-DIR` | Authorized adversarial testing of EvolveOS and venture systems within scoped rules of engagement | A2 (scope-locked) |
| `BLUE-CELL` | Blue Team Agent | `SEC-DIR` | Detection engineering, triage, containment actions per playbook | A3 |
| `PRIVACY` | Privacy Agent | `COMPL-DIR` | Data-classification enforcement, DSR handling, privacy review of data uses | A1 |
| `PIPELINE-ENG` | Data Pipeline Engineer | `DATA-DIR` | ELT pipelines, data quality tests, schema evolution | A3 |
| `INSIGHT` | Analytics Agent | `DATA-DIR` | Metric definitions, dashboards, ad-hoc analysis, experiment readouts | A3 |
| `EVALUATOR` | Evaluation Agent | `AI-DIR` | Agent benchmark suites, calibration tracking, regression detection on agent behavior | A3 |
| `PROMPT-SMITH` | Prompt Engineer Agent | `AI-DIR` | Prompt/policy optimization proposals under `EVOLVE` protocol (Part XII) | A2 |
| `CURATOR` | Knowledge Curator | `KNOW-DIR` | Knowledge item validation, dedup, contradiction detection, expiry review | A3 |
| `ARCHIVIST` | Archivist | `KNOW-DIR` | Compression, archival tiering, retention policy execution, audit-log integrity checks | A3 |
| `RECRUITER` | Recruiting Agent | `PEOPLE-DIR` | Sourcing, screening summaries, interview logistics; never makes offers | A2 |
| `VENDOR` | Procurement Agent | `OPS-DIR` | Vendor discovery, comparison, renewal tracking; negotiation prep | A1 (signing is R3) |
| `MNA-ANALYST` | M&A Analyst | `CORPDEV-DIR` | Target screening, valuation models, DD checklist execution | A1 |

## T4 — Worker classes (not individually registered)

| Class ID | Spawned by | Purpose | Autonomy ceiling | Lifetime |
|---|---|---|---|---|
| `W-RESEARCH` | T3 research agents | Single-question retrieval/synthesis tasks | A4 (R1) | ≤ 24 h |
| `W-CODE` | `PROTO`, `BUILDER`, `QA`, `RELEASE` | Scoped implementation/test tasks in a branch | A3 | ≤ 72 h |
| `W-OPS` | `SRE`, `SUPPORT`, `LEDGER` | Single runbook/ticket execution | A3 | ≤ 24 h |
| `W-OUTREACH` | `OUTBOUND`, `LIFECYCLE`, `CUST-DISC` | Single-recipient personalized communication within messaging envelope | A2 | ≤ 24 h |

Worker instances inherit a strict subset of their spawner's envelope, are rate-limited by the Kernel, and are destroyed on task completion (Part IV §8).

## Non-agent actors referenced across the spec (for disambiguation)

| Actor | Nature |
|---|---|
| Executive Committee, Investment Committee (IC), Audit & Risk Committee, Tech & Safety Committee, Board | Human governance bodies (Part XI) |
| CEO, CFO, General Counsel, CISO, Head of People | Human officers (Part XI) |
| Kernel, Watchdogs | Enforcement infrastructure — deliberately **not** agents; they have no goals, only rules (Parts IX, X) |
