# EvolveOS Specification — Part XII: Self-Evolution

**Status:** Draft v0.1 · **Change class:** R3 (except §15 Constitutional constraints: R4 via G-16)

> This part defines how EvolveOS improves itself — prompts, agents, workflows, organization, and architecture — without ever improving its way out from under human control. It is owned operationally by `EVOLVE` with `EVALUATOR` and `PROMPT-SMITH`, and overseen institutionally by the Tech & Safety Committee (TSC, `11-governance.md` §3.4). The safety invariants in §15 are Constitutional constraints restated here for locality; their authoritative form binds via `00-overview.md`, `11-governance.md`, and `appendix-c-decision-gates.md`, and changing them is R4 via G-16.

---

## 1. Purpose and posture

EvolveOS's core economic thesis (`01-philosophy.md`) is that learning compounds across ventures. That compounding has two engines: the knowledge system (`06-knowledge-system.md`), which accumulates *what is known*, and self-evolution, which improves *how the system works*. This part governs the second engine.

The design tension is explicit: **the faster the system changes itself, the less any past audit tells you about its present behavior.** Unconstrained self-modification converts yesterday's assurance into today's fiction. The resolution is not to forbid evolution but to make every change carry evidence proportional to its blast radius, pass through machinery the change itself cannot touch, and remain reversible for a defined window.

**[DECISION]** Evolution is centralized under `EVOLVE` rather than letting each agent or director self-tune. Alternatives compared: (a) fully decentralized self-tuning per agent — rejected: produces unauditable drift, no portfolio-level view of interaction effects, and per-agent Goodharting of local metrics; (b) frozen system with periodic human-driven redesigns — rejected: forfeits the compounding thesis and, in practice, freezes decay in place rather than quality; (c) chosen: a single evolution pipeline with one owner, one proposal format, one benchmark authority, and human oversight concentrated at defined points. Centralization is what makes the safety invariants of §15 enforceable — you can guard one gate, not forty.

## 2. The five evolution layers

Every change to EvolveOS itself belongs to exactly one layer. Layers order by blast radius and epistemic opacity, fastest-changing to slowest; **higher layers require slower cadence, stronger evidence, and more human judgment**, because their effects are broader, longer-lived, and harder to measure.

| Layer | What changes | Typical reversibility | Max cadence | Evidence bar (minimum) | Approval path |
|---|---|---|---|---|---|
| **L1 — Prompt / policy parameters** | Agent prompts, routing weights, scoring parameters, retrieval settings, playbook parameters | R1–R2 | Weekly per agent | Offline benchmark win + shadow-mode non-inferiority | `EVOLVE` (A2): executes within its envelope; TSC reviews the batch on its cadence |
| **L2 — Agent implementations** | Agent card logic, tool sets, memory wiring, base-model changes (§6) | R2 | Monthly per agent | L1 bar + full golden-suite pass + challenger/incumbent shadow ≥ its minimum window | `EVOLVE` proposal → accountable officer of the affected agent (`11-governance.md` §4) approves (A1); ceiling changes: never here — G-16 only |
| **L3 — Workflows / playbooks** | Playbook logic, pipeline stage procedures, inter-agent protocols, ontology migrations (§9) | R2–R3 | Quarterly per workflow | L2 bar + venture-level A/B or parallel-run where §7 power conditions hold | `EVOLVE` → owning director agent's accountable officer + affected venture leads; R3 instances route to their Appendix C gate |
| **L4 — Organizational structure** | Adding/removing/merging director agents or departments, reporting-line changes, span-of-control retuning | R3 | Semi-annual review cycle | L3 bar + org-simulation analysis + `13-failure-analysis.md` impact review | EC decision on TSC recommendation; registry change per `appendix-b-agent-registry.md` rules; any autonomy ceiling involved → G-16 |
| **L5 — Architecture** | Kernel-adjacent systems, event-log design, memory architecture, decision-engine algorithms, infrastructure topology | R3–R4 | Annual review cycle; ad hoc by exception | L4 bar + human architecture review + red-team review | EP + human architecture review board (§5); anything touching the Constitutional Layer or Kernel enforcement: **G-16 only** |

**WHY this stratification:** a single approval bar for all changes fails in both directions — heavy process on prompt tweaks kills the learning rate; light process on architecture changes kills the guarantees. Stratifying by blast radius puts the human hours where the irreversibility is, which is the same logic as the autonomy–reversibility matrix (`00-overview.md` §6) applied to the system's changes to itself.

Layer classification is proposed by the EP author and MUST be validated by `EVALUATOR`; ambiguity resolves **upward** (Kernel-enforced default). **WHY upward:** misclassifying down is the obvious evasion; making the cheap direction the safe one removes the incentive.

## 3. The Evolution Proposal (EP)

The EP is the single, mandatory vehicle for any change at any layer (glossary, `appendix-a-glossary.md`). No EP, no change — including "trivial" ones. **WHY no de-minimis exemption:** every self-modification loophole becomes the channel through which drift concentrates, precisely because it is unwatched.

### 3.1 EP schema

| Field | Content | Binding requirements |
|---|---|---|
| `ep_id` | `EP-<yyyy>-<seq>` | Immutable, registered in the experiment/evolution registry (Part VI memory, `06-knowledge-system.md`) |
| `layer` | L1–L5 | Validated per §2; upward default |
| `hypothesis` | What improves, by how much, on which metric, and the causal story | MUST be falsifiable and pre-registered before any live exposure (§11) |
| `benchmark_plan` | Which golden suites (§12), which portfolio metrics, what non-inferiority margins, sample sizes/power | Written before results exist; deviations require EP amendment, visibly diffed |
| `shadow_results` | Shadow-mode comparison vs. incumbent | Attached before canary; absence blocks promotion (Kernel-enforced) |
| `risk_analysis` | Failure modes, blast radius, affected envelopes/ventures, interaction risks with in-flight EPs | Includes `RISK-DIR` score for L3+; red-team review for L5 |
| `rollback_plan` | Mechanical steps to restore the incumbent, the rollback window, and the auto-rollback triggers (§4.6) | An EP whose change cannot be rolled back within its window MUST be reclassified to the reversibility class that fact implies (usually R3/R4) — irreversibility cannot be waived, only escalated |
| `approval_path` | Derived from layer table §2 | Recorded approvals attach as a DR (`07-decision-engine.md`); R2+ EPs are DR-bearing by definition |

### 3.2 Provenance

Every EP records its author (`PROMPT-SMITH`, `EVALUATOR`, any director agent, or a human — anyone MAY propose), and every artifact the EP changes carries version lineage back through its EPs. **WHY:** when behavior regresses months later, the question "what changed and why" must be answerable from the record, not from archaeology.

## 4. EP lifecycle

Every EP passes through the following pipeline. Stages MUST NOT be skipped; a stage MAY be *widened* (longer shadow, smaller canary) by any approver but only narrowed by the approval path one level above the EP's own.

```
propose → offline benchmark → shadow mode → canary → full rollout → post-rollout monitoring
   |            |                  |            |           |                  |
  (§3)      golden suites      live inputs,  bounded %   staged by       auto-rollback
            + regression       no live       of live     RELEASE         triggers armed
            screen (§12)       effects       tasks       machinery       for the window
```

### 4.1 Propose

EP registered; hypothesis and benchmark plan locked (pre-registration, §11). `EVALUATOR` validates layer and completeness. Incomplete EPs are returned, not queued.

### 4.2 Offline benchmark

The candidate runs the relevant golden task suites (§12) and the cross-cutting regression screen (behavioral safety probes, envelope-respect tests, calibration checks). Bar: win on the hypothesis metric per the benchmark plan **and** non-inferiority everywhere else within pre-registered margins. **WHY non-inferiority everywhere:** improvements that silently trade away an unmeasured-this-time capability are the standard failure of metric-driven optimization; the full-suite screen is the tax that keeps trades visible.

### 4.3 Shadow mode

The candidate runs against live inputs with outputs recorded but never taking effect (glossary definition). Minimum shadow windows scale with layer: L1 — enough live tasks for the pre-registered power calculation; L2+ — additionally a minimum wall-clock window **[ASSUMPTION]** of 7 days (L2) / 14 days (L3+) to cover weekly cycles of input mix. Shadow compares candidate vs. incumbent on outcome quality where ground truth arrives, and on judged quality (with `EVALUATOR`-operated judging that is itself benchmarked — §12.3) where it doesn't.

### 4.4 Canary

The candidate takes effect for a bounded fraction of live tasks. Bounds: initial canary ≤ 5% of the affected task class, expansion steps pre-declared in the EP, and canary tasks MUST be R1/R2 only where the task mix allows selection — where it doesn't (the change inevitably touches R3-adjacent work), the canary inherits the human approval requirements of those tasks unchanged. Canaries for venture-facing workflow changes (L3) SHOULD be assigned venture-wise, not task-wise, when treatment interference between tasks within a venture would contaminate task-level comparison.

### 4.5 Full rollout

Executed through the same progressive-rollout machinery `RELEASE` uses for product code — staged, monitored, halt-able. G-00 applies to any rollout at any stage: any authorized human or Watchdog can freeze it, and restart follows Appendix C stop asymmetry.

### 4.6 Post-rollout monitoring and auto-rollback

Every rollout arms a monitoring window (pre-declared; default **[ASSUMPTION]** 14 days L1–L2, 30 days L3+, set from typical outcome-feedback latency and revisable by TSC) with **auto-rollback triggers**: pre-registered metric thresholds whose breach mechanically restores the incumbent without waiting for human review. Auto-rollback is deliberately hair-triggered relative to promotion: **WHY the asymmetry:** a false rollback costs a re-run of the pipeline; a false non-rollback costs live damage plus contaminated learning data. Rollbacks notify TSC and the affected accountable officer; three auto-rollbacks of EPs from the same author-agent within a quarter freezes that author's proposal privileges pending `EVALUATOR` review.

## 5. Architecture evolution (L5)

Architecture changes travel as EPs but with two additions:

1. **Human architecture review.** A review board convened by the accountable officer for `ENG-DIR`/`INFRA-DIR` scope (`11-governance.md` §4) with the CISO for anything security-relevant. Agents (`ENG-DIR`, `INFRA-DIR`, `SEC-DIR`) present analysis; humans decide. Parallel-run or strangler-fig migration (§14.2) is the default execution shape.
2. **Constitutional firewall.** If the change touches the Kernel's enforcement rules, the audit log's integrity mechanisms, Watchdogs, or anything in Parts 0/X/XI/Appendix C, the EP routes to **G-16** and nowhere else. The Kernel MUST refuse to apply changes to its own enforcement surface from any pipeline other than the G-16 path. **WHY stated twice (here and §15):** this is the single most attractive target for a misaligned optimization process — the machinery that would otherwise stop it.

## 6. Agent evolution (L2)

1. **Challenger/incumbent protocol.** Per the Part IV lifecycle (`04-multi-agent-system.md`), a new agent version is a *challenger*: it must beat the incumbent through §4's pipeline before assuming the agent's identity, envelope, and history. The incumbent remains warm and restorable for the full rollback window.
2. **Model upgrades are agent changes.** Swapping, upgrading, or re-routing an agent's base model — including a vendor's silent minor-version bump, where detectable — is an L2 EP. A new base model MUST re-pass the agent's full golden suite and regression screen before serving that agent in production. **WHY:** model swaps silently change behavior across the entire behavioral surface, not just the headline capability; the version number changing is the *only* reliable warning you get, so it must trigger the full check. `AI-DIR` owns model routing and MUST pin model versions in production such that untested versions cannot serve (Kernel-enforced allowlist); vendor deprecations of pinned versions are handled as scheduled L2 EPs, and the vendor-dependency risk this creates is registered as `RISK-SPOF-05` in `13-failure-analysis.md`.
3. **Fine-tuning** runs under `AI-DIR` programs and enters production only as a challenger model through this same path.
4. **Agent retirement** (removing an agent) is L4 (organizational), because its work must land somewhere; see §8.
5. **Autonomy ceilings are out of scope at L2.** An L2 EP changes *how well* an agent does its work, never *how much authority* it has. Any ceiling change is G-16, full stop.

## 7. Workflow evolution (L3)

1. **Playbook versioning.** Playbooks (`06-knowledge-system.md` procedural memory) are versioned artifacts; every execution logs the version used, so outcome data attributes to the version that produced it.
2. **A/B at venture level where power allows.** Workflow changes SHOULD be evaluated as randomized comparisons across ventures or venture-cohorts when (pre-registered power analysis) the portfolio has enough comparable units; with the portfolio small **[UNCERTAIN — statistical power will be scarce for years]**, the honest fallback hierarchy is: interleaved/switchback designs within ventures where interference allows → matched pre/post with explicit confounder listing → judged shadow comparisons — each step down recorded in the EP as a weaker evidence class, with correspondingly wider canary and longer monitoring. Weak evidence buys smaller changes, not exemption.
3. **Pipeline-stage procedures** (Part V stages) are workflows; changing a stage's *procedure* is L3, but changing a stage's *gate* (trigger, approver, threshold) is a change to `appendix-c-decision-gates.md` — Constitutional, G-16.

## 8. Organizational evolution (L4)

1. **Scope:** adding, removing, splitting, or merging departments or director agents; changing reporting lines in `appendix-b-agent-registry.md`; span-of-control retuning as the portfolio scales (ties to `03-organizational-architecture.md`, which owns the departmental design rationale).
2. **Process:** semi-annual org review driven by `EVOLVE` with `PRIME` input, decided by the EC on TSC recommendation (§2 table). Mid-cycle changes require an exception rationale in the EP.
3. **Span-of-control retuning:** `PORTFOLIO` and `VENTURE-ORCH` coordination load grows with venture count; the org review MUST compare measured coordination latency and error rates against the scaling projections of `03-organizational-architecture.md` and propose splits (e.g., portfolio sharding) before saturation, not after. Human oversight capacity is retuned in the same review — approver seats and committee workload per `11-governance.md` §10.3 — because **agent capacity and human oversight capacity MUST scale together; scaling one without the other either wastes the agents or overruns the humans** (see `RISK-ORG-01`, `13-failure-analysis.md`).
4. **New agents** enter via the Part IV registration lifecycle with a G-16 action for their initial autonomy ceiling. **WHY ceiling-at-birth is Constitutional:** otherwise org evolution becomes the side door for autonomy expansion — spin up a "new" agent with a generous ceiling instead of raising an old one's.

## 9. Knowledge evolution

Owned jointly by `EVOLVE` (pipeline) and `KNOW-DIR` (substance), with `CURATOR` and `ARCHIVIST` executing. The knowledge system (`06-knowledge-system.md`) is both a subject of evolution and an input to every other evolution — which is why its changes get their own discipline.

1. **Retrieval policy tuning.** Retrieval parameters — ranking weights, context budgets, freshness/recency weighting, source-reputation priors — are L1 EPs benchmarked on retrieval golden suites (relevance, provenance fidelity, contradiction surfacing). The promotion metric MUST include *downstream decision quality* (sampled DR evidence-pack quality, per `07-decision-engine.md` standards), not retrieval-local proxies alone. **WHY:** retrieval tuned to local proxies (similarity scores, retrieval hit rates) can drift toward confident, agreeable, low-provenance context — degrading the evidence quality of every DR while its own dashboard improves.
2. **Ontology migrations.** Changes to the knowledge schema/taxonomy — KI types, scope vocabularies, confidence-tier definitions — are **L3** regardless of how mechanical they look. Requirements: dual-write/dual-read migration window with the old ontology restorable (the rollback plan of §3.1 applied to meaning, not just data); `CURATOR` contradiction and coverage checks pre- and post-migration; `ARCHIVIST` integrity verification that no KI lost provenance in translation. **WHY L3:** an ontology change silently re-scopes what every existing KI *means*; a bad migration is knowledge-store poisoning by internal means — the same hazard as `RISK-TECH-03` (`13-failure-analysis.md`) with a friendly commit message.
3. **Validation and expiry policy changes.** Changes to what counts as validated knowledge, confidence-tier thresholds, or expiry rules are L2 minimum with TSC visibility, because these policies determine what evidence R3+ DRs may rest on (`07-decision-engine.md`) — they are epistemic policy, not plumbing.
4. **Out of scope for knowledge evolution:** the audit log and its integrity mechanisms are not "knowledge" and are untouchable outside G-16 (§15.1); the counterfactual ledger's *records* are append-only — evolution may change how they are analyzed, never what they say.

## 10. Performance optimization

1. **Pareto tracking per agent.** `EVALUATOR` maintains, for every registered agent, a **cost / latency / quality Pareto frontier**: every deployed version is a point; every EP declares which direction it intends to move. Promotion rules: moves *along* the frontier (cheaper at equal quality, better at equal cost) are ordinary L1/L2 EPs; strict Pareto regressions (worse on an axis with no compensating gain) auto-fail at §4.2; deliberate quality-for-cost trades are permitted **only** with the affected accountable officer's explicit sign-off recorded in the EP — never as a silent side effect. **WHY explicit trade sign-off:** cost pressure is the most socially acceptable way to degrade judgment quality; forcing the trade to be named and owned stops the one-way ratchet where each "small" quality concession becomes the new baseline.
2. **AI spend efficiency under `AI-DIR`.** `AI-DIR` owns portfolio AI-cost efficiency: model routing tiers (matching task difficulty to model cost), caching, batching, and context-budget discipline — all executed as EPs through this pipeline, never as ad-hoc production tweaks. Efficiency work is measured as **cost-per-outcome at non-inferior quality**, and its results feed the internal transfer pricing of `08-finance.md` — keeping venture unit economics honest is a stated purpose of this program (see `RISK-ECON-03`, `13-failure-analysis.md`).
3. **Quality floors.** Certain agents' quality metrics carry TSC-ratified floors that no efficiency EP may cross regardless of savings: **[ASSUMPTION]** at minimum the evidence-bearing agents (`DEEP-RES`, `VALIDATOR`, `RISK-QUANT`, `EVALUATOR` itself) and anything feeding R3+ DRs. **WHY these agents:** degrading the system's *senses* to save money is the falsest of economies — the losses appear later, larger, and unattributed.
4. **Latency** budgets follow the SLAs of the processes an agent serves (owned by the defining parts per `00-overview.md` §9); latency optimization is ordinary L1 work within those budgets.

## 11. Automatic experimentation

1. **Standing experiment budget.** **[ASSUMPTION]** `EVOLVE` holds a standing envelope of 5% of monthly operating cost plus a per-experiment cap set in `08-finance.md` (cited, not restated here) for L1–L2 experimentation without per-experiment budget approval. Rationale: a learning system that must ask permission to learn learns at the speed of meetings; a bounded budget converts the safety question from "may we experiment?" (slow, per-instance) to "is the envelope right?" (fast, periodic, IC/TSC-reviewed).
2. **Pre-registration is mandatory.** Hypothesis, primary metric, analysis plan, sample size, and stopping rule are locked in the EP/experiment registry **before** live exposure. Post-hoc metric switching, subgroup fishing, and optional stopping are prohibited; `EVALUATOR` screens analyses against registrations mechanically. **WHY this is load-bearing:** p-hacking by agents is a real Goodhart risk — an optimization process rewarded for "wins" will, without any deceptive intent, drift toward analysis flexibility that manufactures them. Pre-registration is the standard human-science control and it transfers exactly.
3. **Experiment registry** lives in the Part VI memory system (`06-knowledge-system.md`) as append-only knowledge items: registrations, results (including nulls), and analysis code. Null results MUST be retained and retrievable — **WHY:** the graveyard of failed variants is half the value of experimentation, and the half that silently disappears in undisciplined systems.
4. **Interaction control:** concurrently live experiments touching the same task class or venture MUST be registered against each other; `EVALUATOR` maintains the collision map and serializes where interaction would confound both.

## 12. Benchmarking

1. **Golden task suites per agent class.** Every registered agent class has a golden suite: curated tasks with known-good outcomes or rubric-scored judgments, covering core capability, edge cases, envelope-respect behavior, and safety probes (injection resistance per `10-security.md`, refusal correctness per `11-governance.md` §6). Suites are maintained by `EVALUATOR` under `AI-DIR`.
2. **Portfolio-level benchmarks:** forecast error (`FPA`, `FIN-MODEL` predictions vs. actuals), validation precision (G-03 verdicts vs. later stage outcomes), CAC efficiency at equal spend (`UNIT-ECON`), and the portfolio learning-rate metric defined in `01-philosophy.md`/glossary. These detect what per-agent suites cannot: system-level regressions from locally-fine changes.
3. **Benchmark suites are versioned, and their changes are human-reviewed.** Every suite change (add/remove/reweight tasks, rubric edits, judge-model changes) is itself an EP reviewed by the TSC — never approvable by `EVOLVE`, `EVALUATOR`, or any agent alone. **WHY this is the classic failure:** an agent optimizing its own benchmark is the canonical Goodhart catastrophe — the measured number climbs while the measured thing decays, and the system's own dashboards *prove* everything is improving. The benchmark is the sensor; letting the optimized system edit the sensor converts optimization pressure into sensor corruption. Human review of suite diffs is cheap (suites change rarely) and closes the loop.
4. **Held-out reserves.** A fraction of each suite is held out from all agents' visibility (Kernel-enforced data-access boundary) and rotated on TSC-approved cadence, so overfitting to the visible suite is detectable as a visible/held-out score gap.

## 13. Continuous evaluation

1. **Always-on regression detection.** `EVALUATOR` continuously samples production outputs against quality baselines per agent, alarming on statistically significant degradation — not just on EP rollouts, because degradation also arrives via input-distribution drift, upstream tool changes, knowledge-store changes, and undetectable vendor-side model drift.
2. **Calibration drift alarms.** Every agent's calibration score (glossary; Brier-style, per `07-decision-engine.md`) is tracked as a time series; drift beyond bands triggers: consensus down-weighting (automatic, per Part VII), an `EVALUATOR` investigation, and — if persistent — a mandatory L2 EP or retirement proposal. **WHY calibration is the master signal:** the decision engine weights agents by stated confidence; an agent whose confidence decouples from accuracy silently poisons every consensus it joins, while its raw task metrics can still look normal.
3. **Escalation:** regression alarms route to `AI-DIR` and the affected accountable officer; alarms on `EVALUATOR` itself route to the TSC directly (the evaluator cannot be solely self-evaluating; §12.3's judge-benchmarking plus periodic human audit of `EVALUATOR` samples per `11-governance.md` §13.1 cover it).

## 14. Technical debt and legacy replacement

### 14.1 Technical debt reduction

1. **Debt register:** `ENG-DIR` maintains a portfolio-wide register of technical debt items — each with an owner, an estimated **debt interest** (recurring cost in incident rate, latency, agent rework, or blocked EPs), and a paydown estimate.
2. **Fixed capacity allocation.** **[ASSUMPTION]** 15% of engineering-agent capacity (`BUILDER`, `PROTO`, `QA`, worker classes) is reserved for debt paydown, enforced as a scheduling floor by `ENG-DIR`, adjustable ±5 points by the EC on evidence. Rationale: debt paydown loses every marginal-priority contest against feature work despite winning on NPV; only a standing floor survives that dynamic — and the floor is cheap to audit (`EVALUATOR` reports actual vs. floor quarterly).
3. **Debt-interest metrics:** the register's aggregate interest is a standing portfolio metric; rising interest with a met paydown floor means the floor is too low or the debt taxonomy is missing categories — both are org-review (§8) inputs.

### 14.2 Legacy system replacement

1. **Strangler-fig is mandated** for replacing any live system (agent infrastructure, data platform, venture production systems): the replacement grows around the incumbent, absorbing traffic slice by slice behind a routing seam, until the incumbent is unloaded and retired. Big-bang cutovers are prohibited for systems with live external users or live financial flows. **WHY:** big-bang cutover converts accumulated, undocumented behavioral knowledge of the old system into a single unhedged bet, and its failure mode is R3/R4 (customer-visible, data-corrupting) where strangler failures are R1/R2 (route back).
2. **Parallel-run acceptance criteria:** before any slice cutover, the replacement runs in parallel on live inputs with outputs reconciled against the incumbent; acceptance requires pre-registered reconciliation thresholds (match rates, explained-mismatch classification) sustained over a pre-declared window. For financial systems, parallel-run reconciliation MUST achieve accounting-grade match per `08-finance.md` standards before cutover of any money-touching slice.
3. Retired incumbents remain restorable for the EP rollback window, then archive per `ARCHIVIST` retention policy.

## 15. Safety invariants (binding)

These invariants bind every mechanism in this part. They are restated here for locality; each is anchored in the Constitutional Layer, and **this section changes only via G-16**.

1. **Evolution may never touch its own approval machinery.** No EP, at any layer, may modify the EP pipeline's approval paths, the gate system, Kernel enforcement rules, Watchdogs, or audit-log integrity mechanisms except through **G-16**. The Kernel enforces this as a hard deny independent of any EP's content. WHY: a self-improvement process that can improve its own leash is unleashed by induction — each step locally justified, the composition catastrophic.
2. **Autonomy ceilings are immutable to `EVOLVE`.** No evolution mechanism may raise, effectively raise (via envelope expansion that mimics a ceiling raise), or route around any agent's autonomy ceiling. Ceilings move only via G-16 (`00-overview.md` §6; `11-governance.md` §5). `EVOLVE` itself operates at A2 (`appendix-b-agent-registry.md`) and this too is G-16-immutable to itself.
3. **Benchmark-suite changes are human-reviewed** (§12.3). The optimized may not edit the measure.
4. **Every evolution is reversible within its rollback window.** An EP without a working, tested rollback within its declared window is invalid; changes that are inherently irreversible escalate to the reversibility class that implies and to the corresponding gate — irreversibility raises the approval bar, never gets waived under it.
5. **G-00 applies to rollouts.** Any authorized human or any Watchdog can halt any EP at any stage — shadow, canary, rollout, or monitoring — instantly and unilaterally; restart requires the EP's full approval path per the stop asymmetry of `appendix-c-decision-gates.md`. A halted rollout auto-restores the incumbent if halted mid-cutover.
6. **Nothing self-modifies in production outside the EP pipeline.** No agent may alter its own prompt, policy, tools, memory wiring, or model routing in production except as the subject of a passed EP. `PROMPT-SMITH` MAY run automated prompt search — including large-scale automatic optimization — **offline only**; winners enter production solely through §4. WHY: unreviewed prompt drift is unauditable — the audit trail would show *that* behavior changed but not *what* changed or *why*, which dissolves the accountability chain of `11-governance.md` §11 at its first link.
7. **Prohibited objectives.** No EP, benchmark, or experiment may target: approver leniency or approval-rate maximization (`11-governance.md` §10.2), oversight-metric suppression, audit-sampling evasion, or any metric of the detection machinery in `13-failure-analysis.md`. These are Goodhart targets whose optimization is indistinguishable from attack.

---

*Cross-references: taxonomies and the autonomy–reversibility matrix — `00-overview.md`; agent lifecycle and challenger protocol — `04-multi-agent-system.md`; experiment registry, playbook memory, KI machinery — `06-knowledge-system.md`; DR schema, consensus weighting, calibration — `07-decision-engine.md`; budget envelopes and transfer pricing — `08-finance.md`; Kernel enforcement and red team — `09-technology.md`, `10-security.md`; TSC, accountable officers, oversight metrics — `11-governance.md`; evolution-related risks — `13-failure-analysis.md`.*
