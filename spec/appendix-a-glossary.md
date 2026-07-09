# Appendix A — Canonical Glossary

**Status:** Draft v0.1 · **Rule:** every term used in two or more parts is defined here, once. Parts cite these terms verbatim and MUST NOT redefine them.

| Term | Definition |
|---|---|
| **Accountable officer** | The single named human who answers for a director agent's conduct and outcomes (mapped in Part III §3 and Part XI). Every T1/T2 agent has exactly one; committees provide functional oversight but accountability is individual. |
| **Agent** | A software actor with a stable ID (Appendix B), a defined purpose, an autonomy ceiling (A0–A4), a policy envelope, and an audit trail. Agents are instances of versioned agent definitions ("agent cards", Part IV). |
| **Agent card** | The complete versioned specification of an agent: purpose, authority, memory, tools, autonomy, evaluation metrics, recovery behavior (Part IV). |
| **Autonomy ceiling** | The maximum autonomy level (A0–A4, Part 0 §6) an agent may operate at. Set only via gate G-16; never self-modifiable. |
| **Calibration score** | A measure of how well an agent's stated confidence matches observed outcome frequency (e.g., Brier score over its probabilistic predictions). Used to weight agents in consensus and to trigger retraining/retirement (Parts VII, XII). |
| **Capability token** | The per-task-contract authorization artifact carrying envelope claims; attenuable only downward when delegated. Authority rides in the token, never in natural-language instructions (Parts IX, X, IV). |
| **Cell** | An isolated infrastructure unit hosting one venture's production workloads (own network, data stores, IAM boundary). Blast-radius containment primitive (Parts IX, X). |
| **Constitution / Constitutional Layer** | Parts 0, X, XI, and Appendix C: the binding, human-controlled policies that constrain agent behavior. Amendable only via gate G-16. |
| **Continuity of control (minimum manual set)** | The drilled set of critical functions humans can operate if the agent layer is stopped (treasury, customer commitments, incident comms, legal deadlines) — Parts X, XIII. |
| **Counter-metric** | A paired metric monitored specifically to detect Goodhart-style gaming of a target metric; every optimized KPI SHOULD carry one (Parts I, II). |
| **Counterfactual ledger** | The record of decisions *not* taken (rejected options, kill decisions) with predicted outcomes, later scored against observed reality where possible (Parts VI, VII). |
| **Data class (C0–C4)** | Confidentiality taxonomy (how secret): C0 public → C4 critical (treasury, keys, constitutional state). Carried as a ceiling in capability tokens (Part X). Distinct from privacy classes and provenance labels. |
| **Decision brief** | The ≤2-page human-facing rendering of a DR at R3+/gate review: options, scores, uncertainty, top risks, verbatim dissent, rollback plan (Parts VII, XI). |
| **Decision Record (DR)** | Immutable artifact (`DR-<yyyy>-<seq>`) documenting an R2+ decision: options considered, evidence pack, scores, uncertainty, deciding agent(s)/human(s), gate cleared, rollback plan (Part VII schema). |
| **Domain veto** | A suspensive hold by `RISK-DIR`, `SEC-DIR`, `LEGAL-DIR`, `COMPL-DIR`, or `PRIVACY` on actions in their domain; blocks execution pending human resolution but does not itself kill work. Distinct from G-00 (Parts IV, VII, X). |
| **Envelope (policy/budget envelope)** | The pre-approved bounds — spend, tools, data classes, action types, rate limits — inside which an agent may act at its autonomy ceiling. Exceeding an envelope converts the action to A1 (queued for human approval) automatically. |
| **Envelope slice** | The strict subset of an envelope granted to a delegatee through a task contract; slices only shrink down the hierarchy (Part IV). |
| **Evidence pack** | The bundle of sources, data, analyses, and provenance attached to a claim or DR. Every material claim in a DR MUST trace to an evidence pack entry (Parts VI, VII). |
| **Evolution proposal (EP)** | A structured proposal to change a prompt, agent, workflow, org structure, or architecture, carrying benchmark results and a rollback plan (Part XII). |
| **Gate (G-xx)** | A named decision point with defined trigger, inputs, approver, reversibility class, and SLA. Defined only in Appendix C. |
| **Golden-task suite** | The versioned benchmark of held-out tasks with known-good outcomes used to regression-test an agent class; suite changes are human-reviewed (Parts IV, XII; retrieval analogue in Part VI). |
| **Human-mandatory list** | The Part XI enumeration of decisions humans make forever (all R4 gates, ceilings, fiduciary/legal acts) vs. provisionally (delegable only via G-16 with sunset-by-default). |
| **Kernel** | The non-bypassable enforcement layer (policy engine + identity + audit log) through which all agent tool calls pass (Parts IX, X). Distinct from the Constitution (policy content) — the kernel *enforces*, the Constitution *states*. |
| **Kill criteria** | Pre-registered, measurable conditions under which a venture, experiment, or agent is stopped. Written **before** the work starts to prevent sunk-cost drift (Parts V, VII). |
| **Knowledge item (KI)** | A versioned unit of validated knowledge with provenance, confidence, scope, and expiry metadata (Part VI). |
| **Learning rate (portfolio)** | Measured improvement per unit time/capital in the portfolio's predictive and operational performance: e.g., quarter-over-quarter improvement in validation-verdict precision, forecast error, CAC efficiency at equal spend (Parts I, XII). |
| **Macro-state** | The single Kernel-enforced lifecycle state a venture occupies at any time; some macro-states contain parallel stage blocks or concurrent operating tracks (Part V). |
| **Oversight theater** | Human approval that no longer constitutes review: detected via approval-latency floors, near-zero veto rates, and un-opened decision briefs; monitored by ARC (Parts I, III, XI). |
| **Playbook** | A versioned, parameterized procedure distilled from repeated successful execution (procedural memory, Part VI). Executable by agents; benchmarked by Part XII. |
| **Portfolio** | The set of all ventures plus shared capital, infrastructure, and knowledge, governed by the holding entity. |
| **Portfolio Review lead** | The named human officer (a founding executive seat, ratified in Part XI; initially the CEO or their delegate) who approves G-05/G-06 and chairs the weekly A2 batch review (Appendix C, Parts V, XIV). |
| **Privacy class (PC-0…PC-3)** | Personal-data sensitivity taxonomy (whose data): PC-0 public → PC-3 sensitive/regulated; governs retrieval scope and G-18 purpose-binding (Part VI). |
| **Provenance label (P0–P4)** | Source-trust taxonomy (how trusted): P0 constitutional → P4 external untrusted. Immutable under derivation; P4 in context triggers privilege stripping (Part X). |
| **Quarantine** | The suspension state for a suspected-compromised or misbehaving agent instance: frozen, tokens revoked, audit log replayed, clean replacement spawned (Parts IV, X). |
| **Reversibility class (R1–R4)** | Classification of an action by worst-case cost/feasibility of undoing it (Part 0 §5). |
| **Rollback window** | The bounded period after a rollout/replacement during which automatic reversion to the incumbent is guaranteed and monitored (Parts IV, XII). |
| **Shadow mode** | Running a new agent/prompt/workflow version on live inputs without letting its outputs take effect, to compare against the incumbent (Part XII). |
| **Stop asymmetry** | The constitutional principle that stopping requires one authorized human (G-00) while restarting requires the owning gate's full approver set — stopping must always be cheaper than starting (Appendix C, Parts II, XIII). |
| **Task contract** | The typed message by which one agent delegates work to another: objective, constraints, envelope slice, deadline, acceptance criteria, escalation path (Part IV protocol). |
| **Throttle rule** | The binding rule that venture intake/launch pauses when human review demand exceeds trained reviewer capacity — oversight capacity, not capital, paces the portfolio (Parts III, XIV). |
| **Value of information (VoI)** | The expected improvement in a decision from acquiring information before deciding; the basis for staged funding and experiment ROI ("learning credit") (Parts VII, VIII). |
| **Venture** | A company or product line managed by EvolveOS, identified as `V-<yyyy>-<seq>`, occupying one macro-state of the pipeline (Part V) at any time. |
| **Venture envelope** | The composite budget + policy envelope granted to a venture at its last cleared funding gate. |
| **Watchdog** | An independent monitoring process that detects envelope violations, anomalous behavior, or liveness failures in agents, and can trigger G-00 (emergency stop). Watchdogs are part of the Kernel, not the agent hierarchy. |
| **Zombie venture** | A venture with no stage transition and no active kill review beyond the Part V SLA; zombie count is a failure metric (Parts I, V). |
