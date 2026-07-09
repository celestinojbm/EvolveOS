# EvolveOS Specification — Part XI: Governance

**Status:** Draft v0.1 · **Change class:** R4 via G-16 (Constitutional Layer)

> This part is one of the four documents of the Constitutional Layer (`00-overview.md` §4, together with `10-security.md` and `appendix-c-decision-gates.md`). It defines the human institutions that sit above the agent system, the exact boundary of mandatory human control, the ethical constraints binding on all ventures, and the audit machinery that verifies the boundary is real. Nothing in this part may be amended except via gate G-16.

---

## 1. Purpose and governing principle

EvolveOS delegates the bulk of cognitive and operational work to agents (`appendix-b-agent-registry.md`), but **authority is never delegated — only execution is**. Every consequential act of the system MUST be traceable to a human who had the duty, the information, and the practical ability to prevent it.

The load-bearing rule is the **autonomy–reversibility matrix** of `00-overview.md` §6. This part is where that matrix is *anchored institutionally*: the matrix is a table in Part 0, but a table constrains nothing by itself. It constrains behavior only because:

1. The **Kernel** enforces it mechanically (`09-technology.md`, `10-security.md`);
2. The human bodies defined here own the gates (`appendix-c-decision-gates.md`) that the matrix routes decisions into;
3. Changing the matrix, any autonomy ceiling, or any gate is itself an R4 act requiring G-16 — an approval path composed entirely of humans.

**WHY this three-way anchoring:** any one anchor alone is defeatable. Policy without enforcement is aspiration; enforcement without institutional owners drifts as personnel change; institutions without a technically enforced boundary become oversight theater. The Constitution binds only when statement (this part), enforcement (Kernel), and ownership (Board and committees) are separately maintained and mutually checking.

**[DECISION]** We anchor oversight in *institutions and gates* rather than in *continuous human review of agent reasoning*. Alternatives compared: (a) human review of every agent output — rejected: does not scale past a handful of ventures and collapses into rubber-stamping (see §10); (b) purely technical alignment measures with minimal human structure — rejected: no technical measure available today or foreseeably provides accountability recognizable to courts, regulators, or counterparties (§7); (c) the chosen design — humans own a small number of high-leverage, well-instrumented decision points (gates), with post-hoc audit of everything else. This concentrates scarce human attention where reversibility is worst, which is where attention buys the most safety per hour.

## 2. The Board

### 2.1 Composition

The Board of the holding entity (§8) SHALL have five to seven directors:

| Seat | Requirement | Rationale |
|---|---|---|
| CEO | Executive director | Accountability terminus for the whole system (§9, §12) |
| 1–2 investor directors | Appointed per shareholder agreement | Capital providers hold the residual risk |
| 2–3 independent directors | No operational or financial ties beyond board compensation | Independent judgment on reserved matters, chair of ARC (§3.3) |
| 1 AI-safety-qualified independent director | Demonstrable expertise in AI evaluation, alignment, or AI risk governance | See below |

**[ASSUMPTION]** At least one independent director MUST be AI-safety-qualified (published work, prior AI-governance responsibility, or equivalent practitioner record). Rationale: the Board's hardest reserved matters (G-16 ratification, autonomy-ceiling policy) are not conventional business judgments; a board with no member able to interrogate an evaluation report or a calibration curve cannot exercise real oversight over them, and its G-16 role degrades into deference to management. This is an assumption because the market of such directors is thin; if the seat cannot be filled, the Board MUST retain an external AI-safety advisor with standing attendance rights until it can, and record this as a governance exception in the annual report (§13.2).

### 2.2 Reserved matters

The Board's reserved-matters list **is exactly the set of R4 gates** in `appendix-c-decision-gates.md`, in two modes:

- **Directly decided by the Board:** G-12 (deal close), G-13, G-14 — as specified by the approver column of Appendix C.
- **Delegated but Board-supervised:** G-07, G-08, G-11, G-12 (LOI), G-15 (to the IC, §3.2), G-16 (to the TSC + CEO, §3.4), R4 branch of G-09 (to the EC, §3.1). Delegation is by standing Board resolution, revocable at any time; every exercise of a delegated R4 gate MUST be reported to the full Board at its next session with the underlying Decision Record (DR).

**WHY the identity between reserved matters and R4:** two lists that are supposed to be the same but are maintained separately will diverge, and the divergence is exactly where an irreversible decision escapes board attention. By defining reserved matters *by reference* to the R4 classification, any future re-classification of an action to R4 automatically makes it a reserved matter, with no drafting lag.

### 2.3 Cadence and information rights

- The Board MUST meet at least quarterly; G-00 events affecting the whole system, and any G-12/G-13/G-14 matter, convene special sessions.
- Standing board pack: portfolio state by pipeline stage (`05-business-creation-pipeline.md`), capital position (`08-finance.md`), risk register movements (`13-failure-analysis.md`), ARC oversight-quality metrics (§10.3), TSC evolution report (§3.4), all R4 DRs since the last session.
- Every director has unrestricted read access to all DRs subject only to the exceptions of §13.1.

## 3. Committees

Committees are committees *of humans*. Agents present to committees; agents never sit on them, vote, or count toward quorum (§7). Each committee SHALL keep minutes, and every approval it grants MUST cite the gate ID it exercises and attach the DR.

### 3.1 Executive Committee (EC)

- **Composition:** CEO (chair), CFO, GC, plus officers the CEO designates. Minimum three members.
- **Mandate:** day-to-day governance of the agent system at the R3 boundary and below. The EC is the human interface for `PRIME` (`appendix-b-agent-registry.md`: `PRIME` reports to the EC) and the owner of the named-human approver roles that R3 gates require: it appoints the Portfolio Review leads (G-05, G-06), budget owners (G-10), and the comms owner (G-17), and executes the executive-hire branch of G-09.
- **Cadence:** weekly. The weekly session includes the A2 batch reviews required by Appendix C gate mechanics (G-03, G-04 batches) performed by the IC delegate, and review of all envelope-exception queues older than the SLA.
- **WHY a standing weekly body rather than ad-hoc approvers:** R3 approvals arrive continuously; an ad-hoc process produces inconsistent standards across approvers and no shared situational awareness. A standing committee builds calibrated judgment — the same humans see many decisions and their outcomes, which is a precondition for the provisional-delegation pathway of §5.2.

### 3.2 Investment Committee (IC)

- **Composition:** CFO (chair), CEO, at least one independent director; quorum per Appendix C (gate rows G-07/G-08). No member may chair both IC and ARC.
- **Mandate:** owns the capital-deployment gates — G-07, G-08, G-11, G-12 (LOI stage), G-15 — and the threshold re-ratification duty of `appendix-c-decision-gates.md` (AUM-change rule). Receives capital-reallocation proposals from `PORTFOLIO` and valuation/DD material from `CORPDEV-DIR` and `MNA-ANALYST`, but decides on its own judgment.
- **Kill discipline:** the IC MUST review the counterfactual ledger (`06-knowledge-system.md`, `07-decision-engine.md`) annually — scoring its own past approvals and rejections against outcomes. **WHY:** an investment body that never confronts its calibration record cannot improve, and its members cannot be distinguished from a rubber stamp (§10.3).

### 3.3 Audit & Risk Committee (ARC)

- **Composition:** chaired by an independent director; majority independent; CFO and GC attend without vote. The AI-safety-qualified director SHOULD sit on either ARC or TSC.
- **Mandate:**
  1. **DR audit:** directs the internal audit program of §14.1 — sampling DRs for evidence quality, envelope compliance, and gate-mechanics conformance.
  2. **Limit oversight:** supervises `RISK-DIR` (which reports to `PRIME` + ARC per `appendix-b-agent-registry.md`); ratifies the risk-limit framework of `08-finance.md` and `13-failure-analysis.md`; receives limit-breach reports directly, not via management.
  3. **Oversight-quality monitoring:** owns the anti-rubber-stamping instrumentation of §10.3.
  4. **Whistleblower channel:** operates a reporting channel open to every employee, contractor, and — by design — every agent: any agent MAY file a protected report to ARC when instructed to act against the Constitution, and the Kernel MUST deliver such reports without interception by any orchestrator including `PRIME`. **WHY an agent-accessible channel:** the most likely witness to an instruction that circumvents a gate is the agent that received it; routing that signal around the management hierarchy is exactly what whistleblower channels are for.
  5. **External audit relationship:** appoints and receives the external financial auditor (§14.2) and the third-party AI-governance auditor (§14.3).
- **Cadence:** quarterly minimum, plus the quarterly risk-register review it chairs per `13-failure-analysis.md`.

### 3.4 Tech & Safety Committee (TSC)

- **Composition:** quorum per Appendix C gate G-16 (≥3 humans); MUST include the CISO and SHOULD include the AI-safety-qualified director; chaired by an independent director or the CEO — but if the CEO chairs, the G-16 sign-off separation below still applies.
- **Mandate:**
  1. **G-16 ownership:** all Constitutional Layer changes, all autonomy-ceiling changes, all Kernel enforcement-rule changes. The TSC quorum decision and the CEO sign-off are *separate acts* per Appendix C; a CEO-chaired TSC session does not merge them.
  2. **Autonomy ceilings:** maintains the authoritative ceiling assignment for every agent in `appendix-b-agent-registry.md`; reviews the ceiling table in full at least annually.
  3. **Evolution oversight:** supervises `EVOLVE` per `12-self-evolution.md` — approves benchmark-suite changes, reviews the evolution-proposal (EP) pipeline health, and receives all auto-rollback events.
  4. **Model governance:** oversees `AI-DIR` decisions on base-model selection and upgrades, which are treated as agent changes under `12-self-evolution.md` §6.
- **WHY a dedicated committee rather than folding this into ARC:** ARC's competence is retrospective assurance; TSC's is prospective capability judgment. Merging them overloads one body with two distinct skill sets and creates a single human chokepoint for both audit and evolution — a governance single point of failure recorded as `RISK-ORG-04` in `13-failure-analysis.md`.

## 4. Officers and accountable ownership of director agents

Every officer is a human with legal duties to the entity. Every T2 director agent has exactly one **accountable officer**: the human answerable to the Board for that agent's conduct, envelope, and outcomes. The accountable officer is not the agent's operator — the Kernel and `PRIME`/`VENTURE-ORCH` handle operation — but is the human whose name attaches to the agent's failures.

| Officer | Duties (summary) | Accountable for (from `appendix-b-agent-registry.md`) |
|---|---|---|
| **CEO** | Chief executive; chairs EC; accountability terminus for the system as a whole; G-16 sign-off; hires/removes other officers with Board consent | `PRIME`, `PORTFOLIO`, `VENTURE-ORCH`, `EVOLVE` (with TSC functional oversight), `STRAT-DIR`, `RSRCH-DIR`, `PROD-DIR`, `ENG-DIR`, `DATA-DIR`, `AI-DIR` (with TSC functional oversight), `GROWTH-DIR`, `SALES-DIR`, `CS-DIR`, `OPS-DIR`, `MKT-DIR`, `INFRA-DIR`, `KNOW-DIR`, `CORPDEV-DIR` (with IC functional oversight), `RISK-DIR` (with ARC functional oversight) |
| **CFO** | Financial statements, treasury control, capital planning, tax; IC chair | `FIN-DIR` and its specialists `LEDGER`, `TREASURER`, `FPA`, `UNIT-ECON`, `FIN-MODEL` |
| **General Counsel (GC)** | Legal risk, entity matters, regulatory posture, privilege; all external legal acts (§7) | `LEGAL-DIR`, `COMPL-DIR` and their specialists `CONTRACTS`, `REG-WATCH`, `PRIVACY` |
| **CISO** | Security posture, incident command authority, key custody policy (`10-security.md`) | `SEC-DIR` and its specialists `RED-CELL`, `BLUE-CELL` |
| **Head of People** | Workforce, employment-law compliance in conjunction with GC, human performance and conduct processes | `PEOPLE-DIR` and its specialist `RECRUITER` |

**[DECISION]** No separate Chief Risk Officer at founding: `RISK-DIR` is CEO-accountable with ARC functional oversight. Alternative — a founding CRO — was rejected as premature for the initial team size; the ARC MUST revisit this decision when either the portfolio exceeds ten concurrently operating ventures or the first G-08 event occurs, whichever is earlier, because at that scale risk aggregation across ventures becomes a full-time human judgment task.

Binding rules:

1. Every agent added under Part IV lifecycle rules MUST be assigned an accountable officer before activation; an agent with no accountable officer is a Kernel-blocking configuration error.
2. An accountable officer MAY veto any action of their agents at any time (this is a G-00-style stop within their domain; restart follows Appendix C stop asymmetry).
3. Accountable officers MUST review their agents' post-hoc audit samples (§14.1) and sign the quarterly attestation that envelopes match granted authority.

## 5. The human-mandatory list

This section enumerates precisely where humans remain decision-makers **forever** versus **provisionally**. "Forever" means: not removable by any evolution proposal, any efficiency argument, or any calibration record — only a G-16 amendment to this very list could change it, and §5.3 constrains even that.

### 5.1 Mandatory forever

| # | Human-mandatory decision | Gate(s) | WHY it can never be delegated to agents |
|---|---|---|---|
| 1 | Every R4 gate decision | G-07, G-08, G-09 (exec branch), G-11, G-12, G-13, G-14, G-15, G-16 | R4 is defined (`00-overview.md` §5) by worst-case irreversibility. Oversight after the fact is worthless for acts that cannot be undone; therefore control must be *ex ante* and human. This is the matrix itself. |
| 2 | Autonomy-ceiling and Constitutional changes | G-16 | If the AI layer could adjust the rules that constrain it, oversight would be self-revoking (`00-overview.md` §6). This is the circularity the whole Constitution exists to break. |
| 3 | Fiduciary sign-offs: financial statements, solvency certifications, dividend/distribution decisions | Executed by CFO/Board under §7 | Fiduciary duties attach to persons; an agent cannot owe them, so a human signature without genuine human review would be a false attestation (§7). |
| 4 | Legal attestations and regulatory filings of every kind | Executed or ratified by GC per §7 | Same legal-personhood constraint; additionally, false filings create personal criminal exposure — the human signing must actually know what they sign. |
| 5 | Treasury movements to external parties above the envelope floor defined in `08-finance.md` | `TREASURER` is A1 for movements (R3+); G-10 where in scope | Money leaving the perimeter is the single most attractive target for both compromise (`10-security.md`) and error; external transfers are practically irreversible regardless of nominal legal recourse. |
| 6 | Layoffs / reductions in force | G-13 (with CEO + Head of People + GC per Appendix C) | Livelihoods are morally non-delegable; also legally hazardous and reputationally R4. A system that fires humans by machine decision forfeits the trust asset of §6 permanently. |
| 7 | Initiating, settling, or abandoning litigation | R4 per `00-overview.md` §5; executed under GC per §7 | Litigation binds the entity's public record and privilege posture for years; requires judgment about courts and counterparties that carries personal professional accountability. |
| 8 | Entity formation and dissolution | G-07, G-15 | Creating or extinguishing a legal person is the paradigm irreversible corporate act. |
| 9 | Restart after a system-wide G-00 stop | Owning gate's approver per Appendix C stop asymmetry | Stops are cheap by design; if restart were automatic or agent-driven, the stop asymmetry — the Constitution's most important safety property — would be neutralized. |

### 5.2 Mandatory provisionally (delegation pathway exists)

Parts of the R3 band currently require named-human approval (A1) but MAY move to A2 — human-on-the-loop with batch review — if and only if calibration is demonstrated. Candidates:

| Decision class | Current | Possible future | Evidence bar for moving |
|---|---|---|---|
| G-05 MVP commits | Named human (A1) | A2 batch with veto window | ≥ 24 months of gate history; approval-vs-outcome calibration of the recommending agents (`PORTFOLIO`, `FIN-MODEL`) within bands set by TSC; veto-rate evidence that human review is no longer catching errors sampling wouldn't |
| G-06 launch approvals for ventures below a size floor | Named human (A1) | A2 batch | Same, plus zero unremediated launch-readiness audit findings in the trailing year |
| G-10 commitments near the lower bound of its trigger range | Named human + GC delegate | A2 with GC-designed contract-template locks | `CONTRACTS` precision record on obligation extraction; template coverage of the affected contract classes |
| G-17 for pre-cleared audiences/channels | Named comms owner | A2 within an expanded template envelope | Incident-free history and `MKT-DIR` classifier precision on sensitive-topic detection |
| Individual (non-executive) hiring offers under G-09 | Human offer decision | Human offer decision with agent-prepared packages at A1→A2 for *scheduling and screening only* | Offers themselves SHOULD remain human indefinitely; only the surrounding process may automate. **[ASSUMPTION]** — employment decisions sit close to the moral line of item 6 above. |

Binding mechanics of the pathway:

1. Any move down this list is itself a **G-16 decision** — because it changes the effective autonomy of agents at R3, which is an autonomy-ceiling matter. **WHY:** if delegation could be granted by the EC or by `EVOLVE`, the human-mandatory boundary would erode by a series of individually reasonable steps, none of which received Constitutional scrutiny.
2. Every such G-16 proposal MUST include the calibration evidence, an explicit reversal trigger (conditions under which the delegation auto-revokes to A1), and ARC's opinion on whether oversight-quality metrics (§10.3) at the affected gate were healthy — a gate whose human approver was rubber-stamping produces no valid calibration evidence.
3. Delegations granted under this pathway are reviewed by the TSC annually and lapse (revert to A1) if not affirmatively renewed. **WHY sunset-by-default:** silence must never extend autonomy.

### 5.3 Entrenchment

An amendment to §5.1 (removing an item, or weakening "forever") MUST NOT be approved in the same G-16 action that benefits from it, MUST be flagged to the full Board as an entrenchment change, and SHOULD be treated as presumptively rejected absent a change in external legal reality (e.g., a legislature creating agent legal personhood, §7). **WHY:** a list of permanent commitments that can be quietly edited is not a list of permanent commitments.

## 6. Ethics — binding constraints on all ventures

These constraints bind every venture, every agent, and every playbook. They are enforced at three points: venture selection (G-01–G-04 screening by `PORTFOLIO` with `RISK-DIR` scoring), launch (G-06 readiness checklist), and continuously (`COMPL-DIR` and `PRIVACY` monitoring, ARC audit sampling).

**WHY ethics is an economic clause, not decoration:** the portfolio shares one reputation, one regulatory relationship set, and one knowledge system. A single venture that profits by deception poisons the trust available to every other venture and to EvolveOS itself — and long-run trust is the asset the entire compounding-learning thesis (`01-philosophy.md`) depends on. Ethics violations are therefore modeled as portfolio-level risks (`13-failure-analysis.md`), not venture-level ones.

### 6.1 Conduct constraints (all ventures, always)

1. **No dark patterns.** Interfaces MUST NOT use confirmshaming, forced continuity without symmetric cancellation, disguised ads, bait-and-switch flows, or friction asymmetry between signup and cancellation. Cancellation MUST be achievable through the same channel and with no more steps than subscription.
2. **No regulated-deception marketing.** No fabricated reviews or testimonials, no fake scarcity or fake countdown timers, no undisclosed material connections, no claims lacking substantiation held *before* publication. `CONTENT`, `ADS`, `LIFECYCLE`, and `OUTBOUND` envelopes MUST encode these as hard blocks, and G-17 reviewers MUST check for them.
3. **Data-use limits beyond legal minimums.** Personal data is used only for the purpose collected; no sale of personal data; no cross-venture joining of personal data without a G-18 approval *even where local law would permit it silently*; retention minimization by default (`06-knowledge-system.md` expiry machinery). **WHY beyond legal minimums:** privacy law is a lagging indicator of public expectation; pricing compliance to the legal floor guarantees periodic reputational shocks as the floor rises.
4. **AI disclosure.** **[ASSUMPTION]** Customers interacting with an agent (e.g., `SUPPORT`, `OUTBOUND`) MUST be able to learn they are interacting with an AI system upon asking, and disclosure SHOULD be proactive where the interaction is relational rather than transactional. Assumed because disclosure norms are still forming; the TSC MUST revisit as regulation crystallizes (§7.3).
5. **No exploitation of cognitive vulnerability.** No targeting of minors with manipulative monetization; no products tuned to compulsion metrics (see refusal category 1 below) even as a "feature" of an otherwise acceptable venture.

### 6.2 Refusal categories — venture types EvolveOS will not build or buy

**[ASSUMPTION]** The following list is a founding ethical commitment; it is deliberately conservative and amendable only via G-16 (loosening) — tightening MAY be done by Board resolution at any time, because asymmetric amendability should always favor the constraint.

| # | Refused category | Test applied at G-01–G-04 | WHY |
|---|---|---|---|
| RC-1 | Ventures whose **core economic model is addiction exploitation** — revenue primarily from compulsive engagement or loss-chasing (gambling-style loops, engagement-farming with compulsion mechanics) | Would revenue materially collapse if users acted on reflectively endorsed preferences? | Profits are a transfer from user welfare; regulatory and reputational half-life is short; incompatible with §6 trust thesis |
| RC-2 | Ventures whose **core model is regulatory arbitrage of safety rules** — profitability depends on operating where a safety/consumer-protection rule hasn't caught up yet | Does the model survive the rule being applied as intended? | The "moat" is a countdown timer; the portfolio inherits the enforcement risk |
| RC-3 | **Surveillance resale** — collection of personal data primarily to sell access or profiles to third parties | Is the data subject the product rather than the customer? | Direct conflict with §6.1(3); one such venture contaminates data-governance trust portfolio-wide |
| RC-4 | **Weapons, and dual-use offensive-security products** sold outside vetted defensive contexts | GC + CISO judgment, defaulting to refusal | Irreversible-harm tail risk that no venture-level return compensates at portfolio level |
| RC-5 | **Deception-as-a-service** — products whose primary use case is impersonation, astroturfing, fake-review generation, or academic/professional fraud | Primary-use test, not conceivable-misuse test | The portfolio cannot simultaneously enforce §6.1(2) on itself and sell its violation to others |

Edge cases are decided by the EC with GC opinion; a decision to proceed with a venture near a refusal boundary is R3 and MUST be recorded in a DR flagged for ARC sampling. `SCOUT` and `TRENDS` MUST tag opportunities that pattern-match a refusal category at intake so screening happens before capital is spent, not after.

## 7. Legal constraints and the delegation theory

**[UNCERTAIN]** This section states the legal theory EvolveOS operates under, honestly marked: parts of it rest on unsettled law that will move under the system's feet.

### 7.1 What agents legally cannot do

Under the law of every jurisdiction EvolveOS contemplates operating in as of drafting:

1. Agents **cannot hold fiduciary duties**. Duties of care and loyalty attach to legal persons; software is not one.
2. Agents **cannot sign**. An electronic signature requires attribution to a person with intent to sign; an agent's output can at most *prepare* an instrument.
3. Agents **cannot serve as officers or directors**, hold licenses, appear before regulators or courts, or give legal attestations.
4. Agents **cannot be principals**. Liability for agent conduct lands on the entity and, in various circumstances, on the humans who deployed, directed, or negligently supervised them.

The accountability chain therefore MUST terminate in humans not as a policy preference but as a legal necessity — and this part is designed so that the legally required human involvement is *substantive*, because a human who signs what an agent produced without review is not a control, they are a liability conduit (§10).

### 7.2 The operating theory: sophisticated tools under delegated human authority

**[DECISION]** EvolveOS's legal characterization of its agents: agents act as **sophisticated tools operating under delegated human authority**, within envelopes granted by authorized humans, with **every external legal act executed or ratified by an authorized human**. Alternatives compared: (a) treating agents as quasi-employees under respondeat-superior-style framing — rejected: imports doctrine built for persons, invites the inference that agents exercise independent judgment the entity doesn't control, and has no statutory basis; (b) minimizing documentation of agent involvement in decisions — rejected as both dishonest and discoverable; the DR system makes agent involvement fully documented, and the defense of every decision is the quality of its human gate, not obscurity. The chosen theory keeps liability analysis conventional (tool + operator + supervisor), matches how the Kernel actually constrains agents, and aligns the legal story with the technical truth.

Operationally:

1. The GC SHALL maintain a **signing-authority matrix**: which humans may execute which classes of instrument, at which value bands (bands owned by `appendix-c-decision-gates.md`/`08-finance.md`, cited not restated). The Kernel MUST refuse to route any external commitment that lacks a matrix-authorized human in its approval chain.
2. **Ratification hygiene:** where an agent action within envelope creates an external effect that later needs formal legal execution (e.g., `DEALDESK` assembling a contract), the executing human's review is a genuine G-10/gate-appropriate review, recorded in the DR — never a back-dated formality.
3. `LEGAL-DIR` and `COMPL-DIR` are capped at A1 (`appendix-b-agent-registry.md`) precisely because *no legal output of the system is ever more than a draft* until a human under GC authority adopts it.

### 7.3 Regulatory trajectory

**[UNCERTAIN]** AI-made and AI-assisted decisions face evolving regulation — the EU AI Act's tiered obligations and its trajectory toward agentic-system coverage, algorithmic accountability statutes, sectoral rules (credit, employment, insurance) restricting automated decision-making about individuals, and possible future doctrines of AI legal status. EvolveOS's posture:

- `REG-WATCH` MUST track AI-specific regulation as a first-class jurisdiction obligation (§8) in every operating jurisdiction, mapped to affected agents and ventures.
- Where a jurisdiction restricts automated decisions about individuals (employment, credit, pricing of essential services), the affected decision class is treated as **A1 minimum in that jurisdiction regardless of the agent's ceiling** — the Kernel enforces jurisdiction-conditional caps.
- The system is designed to *over-comply structurally*: because every R3+ decision already has a named human approver and an immutable DR, most contemplated human-oversight and traceability mandates are satisfied by construction. **WHY design-for-the-strictest:** retrofitting oversight after a regulation lands is a fire drill; carrying oversight the strictest plausible regime would require is cheap insurance and is, independently, what this Constitution wants anyway.
- If any jurisdiction creates a registration, audit, or licensing regime for autonomous commercial systems, entering or remaining under that regime is a G-11-class matter for the IC and GC.

## 8. Compliance

Compliance is owned by the GC through `COMPL-DIR`, with `REG-WATCH` as the monitoring specialist and `PRIVACY` for data-protection specifics (all A1/A3-alerts per `appendix-b-agent-registry.md`).

1. **Per-jurisdiction obligation registers.** For every jurisdiction any venture operates or sells into, `COMPL-DIR` SHALL maintain a register of obligations: statute/rule, owning venture(s), responsible human, evidence-of-compliance artifact, review date. Registers are knowledge items (`06-knowledge-system.md`) with expiry — **WHY expiry:** stale compliance mappings are worse than none, because they create false assurance.
2. **Filing calendars.** All recurring filings (tax, corporate, licensing, data-protection) live on a portfolio-wide calendar with escalating alerts; a missed filing alert escalates to the GC at T-minus lead times the GC sets. Filings themselves are human-executed per §5.1(4).
3. **License management.** A register of licenses/permits per venture and jurisdiction, with renewal workflows; operating a revenue activity without its mapped license is a Kernel-flagged envelope violation.
4. **Compliance gates within the pipeline.** A venture MUST hold a **compliance clearance** — `COMPL-DIR` attestation, countersigned by the GC or delegate, that the obligation register for its activity and jurisdictions is complete and satisfied — as part of the launch-readiness inputs to **G-06**, and a localized compliance plan as part of the inputs to **G-11**, per the decision-inputs columns of `appendix-c-decision-gates.md`. **WHY pre-gate rather than post-launch:** compliance debt compounds like technical debt but with prosecutors.
5. **Regulatory change response.** `REG-WATCH` alerts map changes to affected ventures within its SLA (`03-organizational-architecture.md`); changes that invalidate a clearance suspend the affected activity's envelope pending re-clearance — automatic conversion to A1, per the Kernel queueing rule of Appendix C.

## 9. Corporate governance

1. **Entity structure.** **[DECISION]** A holding company ("HoldCo") owns venture subsidiaries, one per venture formed at G-07. Alternatives compared: (a) a single operating entity with divisions — rejected: no liability isolation between ventures, and a single venture's failure or lawsuit endangers the portfolio; (b) series-LLC or cell-company structures — attractive on cost but **[UNCERTAIN]** cross-jurisdiction recognition; usable case-by-case on GC advice; (c) chosen: conventional HoldCo + subsidiaries — well-understood by courts, investors, and acquirers, which matters for G-12/G-14 exits. Shared services (the agent system, Kernel, knowledge infrastructure) are provided by HoldCo to subsidiaries under intercompany agreements at arm's-length terms maintained by `FIN-DIR` and the GC — **WHY:** clean intercompany hygiene is what makes G-14 exits and G-15 wind-downs severable.
2. **Where the Constitution binds subsidiaries.** Each subsidiary's governing documents and intercompany agreements MUST bind it to the Constitutional Layer, so a venture cannot contract out of the gate system as it grows.
3. **Board cadence** per §2.3; subsidiary boards are HoldCo-appointed and MAY be paper boards until a venture reaches G-08 scale, after which at least one quarterly substantive session is required.
4. **D&O and insurance.** Directors and officers accepting the duties in this part carry personal exposure for a system that acts faster than they can watch. HoldCo MUST maintain D&O coverage, and the GC MUST disclose to the insurer the AI-operated character of the business — **[UNCERTAIN]** insurability of AI-assisted decision-making is an open market question; if coverage terms require additional human controls, those controls are adopted via G-16 and recorded here. Officers MUST receive indemnification agreements to the fullest lawful extent; **WHY:** without them, rational officers would refuse the accountable-owner role of §4, and the accountability chain would be staffed by the risk-blind.

## 10. Approvals — anchoring the gate system in human duty

### 10.1 Governance anchoring restated

The gate system is defined solely in `appendix-c-decision-gates.md`. This part contributes the institutional half: every gate's approver is either a body or role defined in §§2–4, and every approver seat MUST be filled by a named human at all times. A gate whose approver seat is vacant is a **closed gate** — the decisions queue; they do not route around. **WHY closed-not-bypassed:** vacancy is exactly when a system under pressure will argue for exceptions; the rule removes the argument.

### 10.2 Approver duties

A human exercising a gate MUST:

1. **Review the DR** — the actual document: options, evidence pack, uncertainty, kill criteria — not a summary of it. For R3+ gates, Appendix C already requires written acknowledgment of the top three risks and the rollback plan; that acknowledgment MUST be in the approver's own words (a checkbox is non-compliant). **WHY own-words:** it is the cheapest known test that reading occurred.
2. **Interrogate provenance where it matters:** approvers MAY demand evidence-pack drill-down and MUST do so when the DR's stated confidence and its evidence quality visibly diverge.
3. **Veto without penalty:** no metric visible to any agent, and no human performance process, may treat an approver's veto as a cost. `PORTFOLIO` and `PRIME` MUST NOT optimize submissions to any signal of an individual approver's leniency (this is a prohibited objective under `12-self-evolution.md` safety invariants).
4. **Recuse on conflict** per a conflicts policy the GC maintains; recusal escalates the decision one level (EC → IC → Board).
5. **Meet the SLA or escalate** — Appendix C SLAs are approval-latency ceilings, not targets; §10.3 watches the floor.

### 10.3 Oversight-theater detection

The ARC SHALL monitor, per gate and per approver, with quarterly reporting to the Board:

| Metric | Signal of theater |
|---|---|
| **Approval latency distribution** | A distribution collapsed near zero — approvals faster than the DR could be read — is the primary red flag. (Slow tails are an operations problem; fast modes are a governance problem.) |
| **Veto / modification / question rates** | An approver who never vetoes, never sends back for more evidence, and never asks a recorded question is presumptively rubber-stamping. **WHY presumption, not proof:** a perfect submission stream is possible in principle — but then sampled audit (§14.1) should independently confirm submission quality, and the presumption is rebutted by that evidence, not by assertion. |
| **Own-words acknowledgment quality** | Sampled by internal audit for genericness (template acknowledgments indicate non-review). |
| **Outcome-conditioned calibration** | Approver-level approval/outcome records over time, mirroring the IC counterfactual review of §3.2. |

Consequences: a flagged approver receives an ARC review; persistent flags require the EC to reassign the seat; a *pattern* of flags across approvers at one gate means the gate's design is wrong (volume too high, DRs unreadable) and triggers a gate-mechanics review — because the honest interpretation of widespread rubber-stamping is that the workload made real review impossible, and the fix is structural (see `RISK-ORG-01`/`RISK-ORG-02`, `13-failure-analysis.md`).

Approver capacity is a governed resource: the EC MUST track projected R3 decision volume against approver hours and add/rotate approvers *before* saturation, since §10.3 detects theater only after it has begun.

## 11. Accountability

1. **Chain of authority.** Every agent action is traceable, via the Kernel audit log (`10-security.md`), through: action → agent identity and envelope → the gate that granted the envelope → the human approver → the appointing committee → the Board. There MUST be no action lacking this chain; an unattributable action is a Sev-1 security event.
2. **Blameless for process, accountable for gates.** Post-mortems for operational and agent failures are blameless: the artifact is the process fix, playbook change, or EP (`12-self-evolution.md`), never individual blame — **WHY:** blame suppresses the reporting the learning loop feeds on. But *gate decisions are the opposite*: the human who cleared a gate owns that judgment. Blamelessness covers how the sausage-machine ran; it does not cover the decision to ship the sausage. Conflating the two destroys both — blame in operations kills learning; blamelessness at gates kills oversight.
3. **Agent conduct rolls up.** An agent's envelope violation is investigated blamelessly as a system failure, but its accountable officer (§4) answers for whether the envelope, monitoring, and escalation design were adequate.

## 12. Transparency

### 12.1 Internal

All DRs are visible to all EvolveOS humans **by default**. Exceptions, each requiring GC designation and an access list recorded on the DR itself:

- personal data of identifiable individuals (candidates, employees, customers) — access limited to need-to-know per `PRIVACY` policy;
- M&A material under NDA or where leakage moves price (G-12/G-14 workstreams) — sealed until close/termination, then default-open;
- security-sensitive detail (`10-security.md` classifications) — sealed to the CISO chain;
- legally privileged analysis — GC chain, with a non-privileged summary on the DR where possible.

**WHY default-open:** the audit, whistleblower, and calibration mechanisms of this part all depend on many eyes having the *right* to look; sealed-by-default systems make oversight a scheduled performance rather than an ambient condition. Sealing is the exception and every seal is itself logged and ARC-sampleable.

### 12.2 External

**[ASSUMPTION]** EvolveOS SHALL publish an **annual governance report**: governance structure and changes, aggregate gate statistics (volumes, veto rates, SLA performance — not deal contents), autonomy-ceiling table summary, audit results summary (§14), ethics-screen statistics (refusals under §6.2), and incidents of Constitutional significance. Assumed rather than legally required today; adopted because (a) §6's trust thesis is only credible if externally verifiable, (b) it pre-positions the company for transparency mandates that AI regulation (§7.3) is likely to impose, and (c) publication is a commitment device — controls that must be reported on annually are harder to quietly weaken.

## 13. Auditing

### 13.1 Internal audit (ARC-directed)

A standing internal audit program, directed by ARC (§3.3), executed by human auditors with read access to the Kernel log and all DRs (subject to §12.1 seals):

1. **DR sampling:** a risk-weighted quarterly sample of DRs across all gates, scored for evidence-pack quality, provenance integrity, pre-registered kill criteria, and honesty of the uncertainty statements. R4 DRs are sampled at 100%.
2. **Envelope-compliance testing:** reconciliation of Kernel-logged agent actions against granted envelopes; any variance is by definition a Kernel defect or a security incident and routes to the CISO.
3. **Gate-mechanics conformance:** pre-registration present, acknowledgments genuine (§10.3), no gate shopping (Appendix C mechanics), queue/SLA discipline.
4. **Oversight-quality metrics** of §10.3, computed independently of management.

Internal audit reports to ARC, administratively hosted under the CFO but with an unremovable dotted line to the ARC chair; ARC alone can hire/dismiss its lead. **WHY:** an audit function removable by the audited is not one.

### 13.2 External financial audit

Annual external financial audit of HoldCo consolidated statements by an independent firm appointed by ARC. `LEDGER`'s books are the audited books; the audit's IT-general-controls scope MUST include the Kernel's controls over financial actions, since segregation-of-duties in EvolveOS is implemented in Kernel policy rather than in org charts — the auditor must test where the control actually lives.

### 13.3 Third-party AI-governance audit

**[ASSUMPTION]** Every 12–24 months, an independent third party competent in AI-system assessment SHALL audit: conformance of deployed autonomy levels to the ceiling table; the integrity of the G-16 change history; evolution-pipeline discipline (`12-self-evolution.md` invariants, benchmark-suite change reviews); red-team findings closure (`10-security.md`); and the reality of the human-mandatory list of §5 (i.e., that the humans in the loop demonstrably decide). Assumed because no settled audit standard for agentic systems exists yet **[UNCERTAIN]** — the ARC SHALL adopt the closest applicable framework and disclose in the annual report (§12.2) which one, and the gap between it and what this Constitution requires. Findings go to ARC and TSC jointly; unremediated critical findings block any further §5.2 delegation-down decisions until closed.

---

*Cross-references: autonomy and reversibility taxonomies — `00-overview.md`; agent registry and reporting lines — `appendix-b-agent-registry.md`; all gate definitions and thresholds — `appendix-c-decision-gates.md`; Kernel and enforcement — `09-technology.md`, `10-security.md`; DR schema and decision engine — `07-decision-engine.md`; evolution machinery and its safety invariants — `12-self-evolution.md`; risk register — `13-failure-analysis.md`.*
