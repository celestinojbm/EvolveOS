# Appendix A — Canonical Glossary

**Status:** Draft v0.1 · **Rule:** every term used in two or more parts is defined here, once. Parts cite these terms verbatim and MUST NOT redefine them.

| Term | Definition |
|---|---|
| **Agent** | A software actor with a stable ID (Appendix B), a defined purpose, an autonomy ceiling (A0–A4), a policy envelope, and an audit trail. Agents are instances of versioned agent definitions ("agent cards", Part IV). |
| **Agent card** | The complete versioned specification of an agent: purpose, authority, memory, tools, autonomy, evaluation metrics, recovery behavior (Part IV). |
| **Autonomy ceiling** | The maximum autonomy level (A0–A4, Part 0 §6) an agent may operate at. Set only via gate G-16; never self-modifiable. |
| **Calibration score** | A measure of how well an agent's stated confidence matches observed outcome frequency (e.g., Brier score over its probabilistic predictions). Used to weight agents in consensus and to trigger retraining/retirement (Parts VII, XII). |
| **Cell** | An isolated infrastructure unit hosting one venture's production workloads (own network, data stores, IAM boundary). Blast-radius containment primitive (Parts IX, X). |
| **Constitution / Constitutional Layer** | Parts 0, X, XI, and Appendix C: the binding, human-controlled policies that constrain agent behavior. Amendable only via gate G-16. |
| **Counterfactual ledger** | The record of decisions *not* taken (rejected options, kill decisions) with predicted outcomes, later scored against observed reality where possible (Parts VI, VII). |
| **Decision Record (DR)** | Immutable artifact (`DR-<yyyy>-<seq>`) documenting an R2+ decision: options considered, evidence pack, scores, uncertainty, deciding agent(s)/human(s), gate cleared, rollback plan (Part VII schema). |
| **Envelope (policy/budget envelope)** | The pre-approved bounds — spend, tools, data classes, action types, rate limits — inside which an agent may act at its autonomy ceiling. Exceeding an envelope converts the action to A1 (queued for human approval) automatically. |
| **Evidence pack** | The bundle of sources, data, analyses, and provenance attached to a claim or DR. Every material claim in a DR MUST trace to an evidence pack entry (Parts VI, VII). |
| **Evolution proposal (EP)** | A structured proposal to change a prompt, agent, workflow, org structure, or architecture, carrying benchmark results and a rollback plan (Part XII). |
| **Gate (G-xx)** | A named decision point with defined trigger, inputs, approver, reversibility class, and SLA. Defined only in Appendix C. |
| **Kernel** | The non-bypassable enforcement layer (policy engine + identity + audit log) through which all agent tool calls pass (Parts IX, X). Distinct from the Constitution (policy content) — the kernel *enforces*, the Constitution *states*. |
| **Kill criteria** | Pre-registered, measurable conditions under which a venture, experiment, or agent is stopped. Written **before** the work starts to prevent sunk-cost drift (Parts V, VII). |
| **Knowledge item (KI)** | A versioned unit of validated knowledge with provenance, confidence, scope, and expiry metadata (Part VI). |
| **Learning rate (portfolio)** | Measured improvement per unit time/capital in the portfolio's predictive and operational performance: e.g., quarter-over-quarter improvement in validation-verdict precision, forecast error, CAC efficiency at equal spend (Parts I, XII). |
| **Portfolio** | The set of all ventures plus shared capital, infrastructure, and knowledge, governed by the holding entity. |
| **Playbook** | A versioned, parameterized procedure distilled from repeated successful execution (procedural memory, Part VI). Executable by agents; benchmarked by Part XII. |
| **Reversibility class (R1–R4)** | Classification of an action by worst-case cost/feasibility of undoing it (Part 0 §5). |
| **Shadow mode** | Running a new agent/prompt/workflow version on live inputs without letting its outputs take effect, to compare against the incumbent (Part XII). |
| **Task contract** | The typed message by which one agent delegates work to another: objective, constraints, envelope slice, deadline, acceptance criteria, escalation path (Part IV protocol). |
| **Venture** | A company or product line managed by EvolveOS, identified as `V-<yyyy>-<seq>`, occupying one pipeline stage (Part V) at any time. |
| **Venture envelope** | The composite budget + policy envelope granted to a venture at its last cleared funding gate. |
| **Watchdog** | An independent monitoring process that detects envelope violations, anomalous behavior, or liveness failures in agents, and can trigger G-00 (emergency stop). Watchdogs are part of the Kernel, not the agent hierarchy. |
