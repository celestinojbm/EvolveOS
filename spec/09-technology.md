# EvolveOS Specification — Part IX: Technology

**Status:** Draft v0.1 · **Change class:** R3 (standard amendment process, Part XII)

**Scope.** This part specifies the infrastructure and platform stack on which every EvolveOS agent, venture, and governance process runs. It owns: platform architecture, cloud/IaC/network/identity design, the concrete specification of the Kernel and Watchdogs as enforcement infrastructure, distributed-systems and data-layer choices, observability, CI/CD, backup/DR/HA, and scalability. It defers policy *content* to the Constitutional Layer (`10-security.md`, `11-governance.md`) and agent behavioral design to `04-multi-agent-system.md`. Security integration points are stated here; their depth lives in `10-security.md`.

**Ownership of numbers (per `00-overview.md` §9).** This part owns: infrastructure SLOs, availability targets, RPO/RTO tiers, and platform capacity design points. Dollar/authority thresholds remain owned by `appendix-c-decision-gates.md`; budget envelopes by `08-finance.md`.

**A ten-year note.** Every vendor and product named below is a build-phase choice, not a decade commitment. Where a choice is provisional it is marked as such — but per the binding rules of this spec, we still CHOOSE, because "evaluate later" is how platforms end up with three of everything. Replacement of any named vendor is an R2/R3 change through the standard amendment process; replacement of anything the Kernel depends on for enforcement is R4 via G-16, because it is load-bearing for the oversight guarantee.

---

## 1. Design principles (binding)

1. **The Kernel is non-bypassable.** There MUST NOT exist any network path, credential, or API by which an agent can reach a tool, data store, or external service without traversing Kernel policy enforcement. This is the single most important property of the entire stack; every subsequent section is shaped by it.
2. **Blast radius is a first-class design input.** Any component failure, compromise, or runaway agent MUST be containable to one cell or one platform service without manual heroics. WHY: EvolveOS runs many ventures on shared cognition; without hard containment, one venture's incident is a portfolio incident.
3. **Everything is declared, nothing is hand-built.** All infrastructure MUST be expressed as code, reviewed, and applied through CI. Console mutations in staging/prod are prohibited outside break-glass (`10-security.md` §14). WHY: agents operate this stack; agents cannot safely operate undocumented state.
4. **Cost is metered honestly at the cell boundary.** Every venture's true infrastructure cost MUST be attributable to its cell without allocation guesswork, because `08-finance.md` unit economics and G-05/G-06/G-07 funding decisions depend on it.
5. **Boring where possible, novel only where the mission demands it.** The novel parts of EvolveOS are the agent layer and the Kernel. The data plane, networking, and delivery machinery SHOULD be the most conventional, widely-operated technology available. WHY: novelty budget is finite and already spent.

---

## 2. System architecture: Platform + Cells

**[DECISION] — Cell-based architecture.** EvolveOS is built as one shared **Platform** plus one isolated **Cell** per venture.

- **Platform** (portfolio-scoped, singleton): the Kernel and Watchdogs, the agent runtime, the knowledge system (`06-knowledge-system.md`), the decision engine (`07-decision-engine.md`), the event backbone, the finance ledger (`08-finance.md`), observability, CI/CD, and the identity plane.
- **Cell** (per `Venture`, per Appendix A): an isolated infrastructure unit — its own cloud account/project, own VPC, own data stores, own IAM boundary, own secrets scope — hosting that venture's production workloads (product services, venture databases, venture-facing third-party integrations). Cells are provisioned, resized, and decommissioned by `INFRA-DIR` from a versioned cell template (§3.2).

### 2.1 Alternatives compared

| Criterion | **A. Cell-based (chosen)** | B. Shared multi-tenant monolith | C. Fully separate stacks per venture |
|---|---|---|---|
| Blast radius (security & reliability) | One venture. Cell compromise cannot reach another cell except through the Kernel-mediated platform APIs | Portfolio-wide. One tenant-isolation bug = every venture's data | One venture, best-in-class |
| Clean venture exit (G-14) | **Cell transfers with the venture**: account, data, IAM, DNS move to the buyer; platform ties are severed at a documented interface | Extraction project measured in months; data disentanglement risk kills deal value and timelines | Trivial |
| Honest cost metering | Native — the cell's cloud bill *is* the venture's infra cost | Allocation models, always disputed, always gamed | Native |
| Shared learning & platform leverage | Full — knowledge system, decision engine, agent runtime amortized across all ventures | Full | **None** — rebuilds the Kernel, knowledge, observability N times; destroys the compounding-learning thesis of `01-philosophy.md` |
| Enforcement uniformity (Kernel) | One Kernel governs all agent action everywhere | One Kernel, but tenancy bugs can bypass logical isolation | N Kernels to keep consistent — the Constitutional Layer becomes unenforceable in practice |
| Operational cost at 100 ventures | Moderate: automation-heavy but templated | Lowest raw cost, highest correlated risk | Prohibitive: ~100× platform overhead |
| Compliance scoping (per-venture jurisdictions, G-11) | Per-cell scoping: a regulated venture's controls don't burden the rest | Whole platform inherits the strictest regime of any venture | Per-stack, clean |

Options B and C each fail a founding requirement: B fails blast-radius containment and clean exits; C fails compounding knowledge and uniform constitutional enforcement. A is the only architecture satisfying all four of: containment, sellable ventures, honest cost, and shared learning. Therefore:

- Every venture at gate **G-05** (MVP Commit) or later MUST run in its own cell. Pre-G-05 work (prototypes by `PROTO`, validation experiments by `VALIDATOR`) runs in pooled **sandbox cells** (§3.3) that are wiped on a fixed schedule.
- A cell MUST be transferable: cell templates MUST NOT create hard dependencies on platform internals other than the documented Platform Interface (event backbone topics, Kernel token endpoints, observability export, ledger API). Severing that interface — replacing platform endpoints with stubs or the buyer's equivalents — is a scripted, tested procedure (`exit-drill`, run annually per cell class, see §20).
- Cross-cell communication is **prohibited**. Ventures interact only via the platform event backbone with explicit Kernel policy allowing each topic pairing. WHY: ad-hoc cell-to-cell links silently rebuild the monolith and destroy exit cleanliness.

### 2.2 The Platform Interface (binding contract)

Each cell consumes the platform through exactly five surfaces, each versioned and each enforced by the Kernel:

1. **Identity/token endpoint** — cell workloads and agent instances obtain SPIFFE identities and capability tokens (§7–§8).
2. **Event backbone** — named topics with schema registry (§10).
3. **Ledger API** — all money-relevant events post to the portfolio ledger owned by `LEDGER` under `FIN-DIR` (`08-finance.md`).
4. **Observability export** — OTLP endpoints for traces/metrics/logs (§13).
5. **Knowledge system API** — retrieval and knowledge-item submission per `06-knowledge-system.md`, mediated by `KNOW-DIR` policies.

Anything a cell needs beyond these five surfaces is either (a) inside the cell, or (b) a new platform capability added by amendment to this part. No exceptions; exceptions are how interfaces rot.

---

## 3. Infrastructure as code

### 3.1 Tooling

**[DECISION]** IaC standard: **OpenTofu** (Terraform-compatible), with HCL modules, remote encrypted state per account, and mandatory plan-review in CI.

- WHY OpenTofu over Terraform: license posture (MPL-2.0 fork vs BUSL) matters for a 10-year horizon and for the possibility that EvolveOS itself ships infrastructure tooling inside sold cells; functional parity is sufficient today. **[UNCERTAIN]** The Terraform/OpenTofu ecosystem may re-converge or diverge sharply; this choice is R2-revisable and modules MUST avoid vendor-specific extensions of either fork.
- WHY not Pulumi/CDK (general-purpose-language IaC): agents write and review most IaC changes. A constrained declarative language is easier to statically analyze, diff, and policy-check (§8 policy-as-code runs against plans) than arbitrary imperative code. Expressiveness is a liability when your author population includes A2/A3 agents.
- All IaC changes are proposed by agents (typically `W-CODE` workers under `INFRA-DIR` or `ENG-DIR`) as pull requests, policy-checked automatically, and applied only through the CI/CD system operated by `RELEASE` (§16). IaC changes touching the Kernel, Watchdogs, or identity plane are R3 minimum and require a named human platform engineer's approval; changes to Kernel *enforcement rules* are R4 via **G-16**.

### 3.2 Account/project structure

One cloud **organization**, with accounts (AWS terminology; "projects" if the provider changes) as the hard isolation unit:

| Account group | Contents | Count |
|---|---|---|
| `org-management` | Org root, SCP/guardrail policies, billing. No workloads, ever. | 1 |
| `platform-security` | Kernel audit log archive, security tooling, Watchdog runtime, break-glass credentials. Independent admin set (see §9.4). | 1 |
| `platform-identity` | Identity plane: workload identity control plane, human SSO federation. | 1 |
| `platform-core-{sandbox,staging,prod}` | Kernel, agent runtime, event backbone, knowledge system, decision engine, ledger, observability | 3 |
| `cell-V-<yyyy>-<seq>-{staging,prod}` | One pair per venture at G-05+ | 2 × ventures |
| `sandbox-pool-N` | Pooled pre-G-05 sandbox cells, wiped weekly | ~5, elastic |

Binding rules: guardrail policies (service control policies) at the org level MUST deny (a) disabling of audit trails, (b) public exposure of storage buckets in any cell by default, (c) creation of long-lived access keys, (d) cross-account role assumption other than the enumerated Platform Interface paths. Guardrail changes are Kernel-enforcement changes → **G-16**.

### 3.3 Environment tiers

| Tier | Purpose | Data | Agent autonomy |
|---|---|---|---|
| **sandbox** | Prototypes, agent experimentation, `EVALUATOR` synthetic runs, destructive testing | Synthetic or irreversibly anonymized only. Real customer data in sandbox is a policy violation the Kernel blocks at the data-access layer | Up to each agent's ceiling; all actions R1 by construction (sandbox is wiped, no external egress except allowlisted research endpoints) |
| **staging** | Pre-production verification, `QA` release gates, DR rehearsal targets | Masked production-shaped data | A3 max; no external side effects |
| **prod** | Live ventures and platform | Real | Autonomy–reversibility matrix fully applies |

Sandbox's "no real external side effects" property is what makes A4 agents like `SCOUT` and `W-RESEARCH` safe: their write surface is R1 by construction. The Kernel enforces tier as a token claim (§8) — a sandbox-issued capability token is not honored by any staging/prod enforcement point.

---

## 4. Cloud provider

**[DECISION] Primary cloud: AWS.** Reasoning:

1. **Isolation primitives.** The account boundary is the strongest, most battle-tested multi-tenant isolation unit in any public cloud, and the cell architecture leans on it entirely. Nitro-based instance isolation and mature SCP guardrails are directly load-bearing for §2 and §3.2.
2. **Breadth for cells.** 100 ventures will collectively need a very long tail of managed services; AWS's catalog breadth minimizes "the platform must build it" events.
3. **KMS/HSM maturity** for the key hierarchy in `10-security.md` §6 (CloudHSM-backed roots, external key stores).
4. **Talent and agent competence.** Human hires and — materially — current AI models are strongest at AWS operations; agent-operated infrastructure argues for the most-documented provider. **[ASSUMPTION]** Model competence tracks ecosystem documentation volume; true today, likely to persist.

**[UNCERTAIN]** Over 10 years, AI-inference economics may make a different provider (or on-prem inference) decisive. The stack therefore separates **inference procurement** (owned by `AI-DIR`, multi-vendor from day 1, §22.3) from **infrastructure hosting** (single-primary AWS).

**Portability posture: pragmatic single-primary with a maintained exit plan — NOT day-1 multi-cloud.** Binding form:

- We MUST NOT build active-active multi-cloud. WHY: multi-cloud doubles the security-enforcement surface the Kernel must police, halves the depth of team expertise, forfeits the strongest isolation primitives by forcing lowest-common-denominator abstractions, and its availability benefit is negligible next to the dominant real risks (our own defects, agent misbehavior). The one real multi-cloud argument — vendor negotiation and existential provider risk — is handled more cheaply by an exit plan than by live redundancy.
- We MUST maintain a written, annually re-costed **cloud exit plan**: inventory of AWS-proprietary service usage per platform component with the designated substitute (e.g., Aurora Postgres → self-managed Postgres/other managed Postgres; MSK → self-managed Kafka; SQS → an AMQP broker), an estimated migration cost/time, and a hard cap: **no platform component may use a proprietary service with no identified substitute** without a documented waiver approved by `INFRA-DIR`'s human chain (an R3 decision recorded as a DR).
- Cells SHOULD be more conservative than the platform: cell templates use Postgres, object storage, container runtime, and queue abstractions with thin adapters, because a cell may be sold (G-14) to a buyer on another cloud.

---

## 5. Networking

1. **Cell isolation.** Each cell is its own VPC in its own account. No VPC peering between cells. Default security stance: no inbound from anywhere except the cell's own load balancer; no outbound except through the cell egress gateway (below).
2. **Platform connectivity.** Cells reach the five Platform Interface surfaces (§2.2) via AWS PrivateLink endpoints only — private, unidirectional, per-service. The platform does not get a network route *into* cells; platform-initiated actions on cells happen through the cell's own agent runtime pulling signed task contracts off the backbone. WHY: a compromised platform component should not have standing network reach into every venture's production.
3. **Egress control per agent tool — the network face of the Kernel.** All outbound traffic from agent runtime nodes (platform and cell) MUST traverse an **egress gateway** that enforces, per connection: (a) the calling workload's SPIFFE identity, (b) a destination allowlist derived from the agent's card (`04-multi-agent-system.md`) and current capability token, (c) TLS SNI/destination verification. There is no generic "internet access"; there are named tool destinations (e.g., `ADS` → ad-platform APIs; `SCOUT` → its research crawl allowlist; `TREASURER` → banking APIs, which additionally require the co-sign flow in `10-security.md` §6). Non-agent product workloads inside a cell get a per-cell destination allowlist maintained in the cell template. Egress denials are Kernel audit events and feed the anomaly baselines in `10-security.md` §8.
4. **No public IPs** on any compute in any account; ingress only via managed load balancers/CDN in cells that serve customers.
5. **DNS.** Per-cell public zones (transferable with the venture); platform zones separate. Internal service discovery is private DNS per VPC.

---

## 6. Identity

One **identity plane** for every actor — human or agent — specified here mechanically; attribution and policy semantics in `10-security.md` §3.

1. **Workload identity: SPIFFE.** Every workload — every agent instance, every T4 worker, every product service, the Kernel's own components — receives a SPIFFE ID and short-lived SVID (X.509, ≤ 1 h TTL, auto-rotated) from a SPIRE deployment rooted in `platform-identity`. ID scheme:
   `spiffe://evolveos.internal/<tier>/<agent-id>/<instance-uuid>` for agents (e.g., `spiffe://evolveos.internal/prod/BUILDER/…`), with venture-scoped instances carrying the venture: `…/prod/VENTURE-ORCH/V-2027-004/<uuid>`. Product services: `spiffe://evolveos.internal/cell/V-2027-004/<service>/<uuid>`.
   Node attestation uses cloud-instance identity documents; workload attestation uses the container runtime. **[DECISION]** SPIFFE/SPIRE over cloud-native IAM-only: cloud IAM cannot express agent-instance granularity or survive a cloud exit; SPIFFE is the portable identity layer, and cloud IAM roles are *derived from* SPIFFE identity at the token exchange (§7), not assigned directly to workloads.
2. **Human identity: SSO + MFA.** All human access federates through a single IdP (**[DECISION]** build-phase: Okta; provisional — commodity layer, R2-swappable) with phishing-resistant MFA (FIDO2 hardware keys) REQUIRED for any role that can approve gates, touch prod, or authorize spend. Password+TOTP is acceptable only for read-only portfolio dashboards.
3. **Unified directory.** One directory holds humans, agent definitions (from `appendix-b-agent-registry.md`), agent instances, and service identities, with the reporting/authority edges from Part XI and `04-multi-agent-system.md`. The directory is the single source the Kernel resolves against; shadow identity stores are prohibited. Gate approver sets (`appendix-c-decision-gates.md`) resolve to directory groups, so "IC quorum (≥3)" is machine-checkable.

---

## 7. Authentication

1. **Short-lived credentials only.** No static API keys, no long-lived cloud access keys, no service passwords, anywhere. Workloads authenticate with SVIDs; humans with SSO sessions (≤ 12 h) and step-up FIDO2 for sensitive actions; agents to external SaaS via the secrets manager's dynamic credentials (§18) brokered at call time by the Kernel. Org guardrails (§3.2) make long-lived key creation impossible rather than merely forbidden.
2. **Token exchange.** A workload presents its SVID to the Kernel token service and receives (a) scoped cloud-IAM session credentials when it needs cloud APIs, and (b) a **capability token** (below) for tool calls. Both are bound to the SVID (proof-of-possession) so a stolen token is useless off-box.

## 8. Authorization

1. **Capability tokens carrying envelope claims.** Every agent tool call is authorized by a capability token minted by the Kernel per task contract. Claims (minimum): agent ID + instance UUID; task-contract ID; venture scope; environment tier; originating human authority reference (gate ID + DR where applicable); tool allowlist slice; data-class ceiling; **envelope slice** — spend limit, rate limits, action-type list, expiry (≤ task deadline, hard cap 24 h). Tokens are attenuable downward only: a T3 agent delegating to a T4 worker passes a strict sub-slice, never an escalation (registry rule, `appendix-b-agent-registry.md` T4 table). **[DECISION]** Claims-in-token (Biscuit/macaroon-style attenuation semantics over a JWT-compatible encoding) rather than pure server-side lookup: the token is self-describing for audit and offline verification, but the Kernel PDP remains authoritative — the token is a *cache of authorization context*, not a bearer bypass; revocation is checked server-side on every call (§9).
2. **Policy-as-code, deny-by-default.** All authorization policy is expressed in a policy language evaluated by the Kernel on **every** agent tool call. **[DECISION]** Build-phase engine: **OPA/Rego** (mature, auditable, testable, huge corpus for agent competence), with policy bundles versioned in git, tested like code, and deployed through `RELEASE`. **[UNCERTAIN]** Cedar's analyzability (formal verification of policy properties) may justify migration once policy volume grows; the policy *model* below is engine-neutral so this is an R3 swap.
3. **Policy inputs on each decision:** token claims; the tool's declared reversibility classifier output (R1–R4, computed per `00-overview.md` §5 rules — dollar/duration bounds make this computable); current envelope meter readings; the autonomy–reversibility matrix; live flags (G-00 stops, quarantines per `10-security.md` §11). The decision is allow / deny / **convert-to-A1** (queue at the owning gate, per `appendix-c-decision-gates.md` mechanics rule 3).
4. Humans are authorized through the same PDP for production-affecting actions. Gate approvals are recorded as directory-verified signatures on the DR; the Kernel will not execute an R3+ action without resolving its gate approval reference.

---

## 9. The Kernel and the Watchdogs (enforcement infrastructure — not agents)

Per `appendix-b-agent-registry.md`, the Kernel and Watchdogs have **no goals, only rules**. They contain no LLM in any enforcement path. WHY: the layer that constrains model-driven behavior must not itself be model-driven, or prompt-level attacks against agents become attacks against enforcement.

### 9.1 Kernel components

| Component | Function |
|---|---|
| **PDP** (policy decision point) | Evaluates §8 policy on every tool call. Stateless, horizontally scaled, p99 decision latency budget 15 ms (§15 SLO). |
| **PEPs** (policy enforcement points) | The only doors: (a) the **tool-call proxy** — every agent tool invocation (API call, DB query, message send, browser action, shell exec) is a request to this proxy, which validates the capability token with the PDP, executes the call with credentials *the agent never holds* (§18), and records the result; (b) the **egress gateway** (§5.3); (c) the **data-access layer** enforcing data-class ceilings on knowledge-system and cell-DB reads. Agent runtime containers have no network route except to PEPs — non-bypassability is a network fact, not a convention. |
| **Envelope accountant** | Real-time meters per envelope: spend (committed at call time, reconciled against `LEDGER`), tool-call rate, data-volume, action counts. Meter breach ⇒ PDP returns convert-to-A1. Meters are strongly consistent for spend (a venture cannot double-spend its envelope through parallelism — spend decrements are serialized per envelope), eventually consistent (≤ 5 s) for rate stats. |
| **Token service** | §7.2 exchange; revocation list, propagation to all PEPs ≤ 5 s. |
| **Audit stream** | Every PDP decision (including denies), every PEP execution with request/response digests, every token issuance/revocation, every envelope-meter event → append-only log on the event backbone, continuously anchored: hourly Merkle roots written to (a) object storage with compliance-mode object lock in `platform-security` and (b) an external timestamping service. Tamper-evidence, retention, and access rules in §14 and `10-security.md`. `ARCHIVIST` runs continuous integrity verification against the anchors — it verifies the log; it cannot write to it. |

The Kernel is configured, not commanded: no agent — including `PRIME` and `EVOLVE` — has any API to alter Kernel policy at runtime. Policy changes ship as reviewed bundles (§8.2); changes to enforcement semantics are R4 via **G-16**.

### 9.2 Watchdogs

Watchdogs are independent monitor processes (Appendix A definition) with these binding properties:

1. **Separate everything.** Watchdogs run in the `platform-security` account on infrastructure the platform-core admins cannot modify, with their own SPIFFE trust domain (`spiffe://watchdog.evolveos.internal/…`), their own credentials, their own alerting path (direct to humans, not through platform observability). WHY: a compromise of the platform-core account must not blind or silence the Watchdogs.
2. **Read + trip only.** A Watchdog can read the audit stream, envelope meters, and liveness signals; its only write capabilities are (a) trigger **G-00** and (b) page humans. It cannot fix, restart, or reconfigure anything — remediation belongs to `SRE`, `BLUE-CELL`, and humans. WHY: a component with both trip and repair powers becomes an operator, and operators need oversight; the Watchdog's simplicity *is* its trustworthiness.
3. **The G-00 trip wire.** When a Watchdog trips, the Kernel PDP flips the corresponding scope flag (single agent instance, agent class, venture cell, or the whole system) to deny-all-except-safeing within ≤ 5 s, in-flight capability tokens for that scope are revoked, and the paged human receives the triggering evidence. Restart follows the stop asymmetry of `appendix-c-decision-gates.md` (owning gate's full approver set). Trip conditions include: envelope-meter tamper signals, audit-stream gaps or anchor mismatches, agent-instance liveness anomalies, spend-velocity breakouts, and the behavioral baselines of `10-security.md` §8.
4. **Watchdog liveness is itself watched**: a heartbeat lattice among ≥ 3 Watchdog instances across AZs; missing heartbeats page humans directly. A silent Watchdog layer is treated as a Sev-1 (`10-security.md` §9).

---

## 10. Distributed systems: event backbone and delivery semantics

**[DECISION] Hybrid: durable event log (Kafka-class) as the backbone + task queues for T4 dispatch.** Compared:

| | **Event log + queues (chosen)** | Point-to-point REST | Queue-only |
|---|---|---|---|
| Replayability / audit | Native — the log *is* the historical record; audit stream and knowledge ingestion replay it | None; audit must be bolted on | Consumed = gone; replay requires separate archive |
| Fan-out (ledger + knowledge + observability + `FRAUD-WATCH` all consume payment events) | One write, N independent consumers with own offsets | N synchronous calls, N failure modes | Per-consumer queues, N writes |
| Backpressure & agent bursts | Log absorbs bursts; consumers proceed at own pace | Cascading timeouts | OK |
| Work distribution to ephemeral workers | Weak alone — hence the hybrid | Poor | **Native** — visibility timeouts, per-message ack, DLQ |
| Ordering where money moves | Per-key ordering (partition by envelope/account ID) | None guaranteed | FIFO variants limited |

Build-phase implementation: **AWS MSK (Kafka)** for the log; **SQS** for task queues (both on the §4 exit-plan substitution list). Schema registry with enforced compatibility rules; every message carries the Part IV envelope header (task-contract ID, `trace_id`, agent instance, venture, reversibility class).

**Exactly-once where money moves (binding).** True exactly-once delivery is a distributed-systems fiction; we engineer exactly-once *effects*:

1. **Idempotency keys.** Every state-changing operation on the ledger, treasury interfaces, payment providers, and envelope accountant MUST carry a caller-generated idempotency key (derived from task-contract ID + operation sequence). Receivers MUST deduplicate on it for ≥ 30 days.
2. **Outbox pattern.** Any service that both writes its database and emits an event MUST write the event to an outbox table in the same transaction; a relay publishes from the outbox. No dual-writes. WHY: the failure mode "DB committed but event lost" is precisely how ledgers and reality diverge.
3. Consumers of money-relevant topics MUST be idempotent and MUST NOT auto-advance past a poison message (park to DLQ, page — §12).
4. Synchronous request/response (gRPC/REST) is permitted only for reads and for the Kernel PDP path (which must be synchronous); all writes with cross-service effects go through the log or queues.

---

## 11. Storage and databases

Per-workload standards; anything not listed requires an `INFRA-DIR`-approved DR to introduce (database sprawl is a 10-year tax):

| Workload | Standard | Placement | Notes |
|---|---|---|---|
| OLTP (venture product data) | **PostgreSQL** (Aurora Postgres build-phase; plain Postgres in the exit plan and in cell templates for portability) | Per cell | One cluster per cell minimum; no cross-cell DB access, ever |
| Platform OLTP (agent state, task contracts, gate queue, directory) | PostgreSQL | Platform-core | Task-contract store is the agent runtime's source of truth |
| Event log | Kafka-class (§10) | Platform-core; per-cell topics namespaced `cell.V-<yyyy>-<seq>.*` | Money/audit topics: infinite retention via tiered storage to object store |
| Object storage | S3-class | Per account | Audit anchors in compliance-mode object lock (§9.1); cell buckets transfer on exit |
| Knowledge graph | Property graph DB per `06-knowledge-system.md` (**[DECISION]** build-phase Neo4j; owned and detailed by Part VI) | Platform-core | Single portfolio-wide graph — this is the compounding asset |
| Vector stores | **pgvector** within Postgres for cell-local embeddings; dedicated vector service for the portfolio corpus per `06-knowledge-system.md` | Split | Part VI owns retrieval architecture; Part IX owns hosting |
| Analytics warehouse | **[DECISION]** Snowflake-class managed warehouse (provisional; commodity layer) fed by ELT from cells, operated by `PIPELINE-ENG` under `DATA-DIR` | Platform-core | Cell → warehouse flows pass the data-access PEP: masked/classified per `10-security.md` §5 before leaving the cell |
| Ledger | Append-only double-entry store per `08-finance.md` (Postgres + event-log sourcing; the log is authoritative) | Platform-core | Never per-cell: one book of record for the portfolio |
| Caches | Redis-class, ephemeral only | Per need | MUST be reconstructable; nothing durable in caches |

---

## 12. Messaging and queues (T4 dispatch)

1. T2/T3 agents dispatch T4 workers (`W-RESEARCH`, `W-CODE`, `W-OPS`, `W-OUTREACH`) by writing a task contract to the contract store and enqueueing a dispatch message. The worker runtime pulls, requests a capability token (attenuated per §8.1), executes, reports, and is destroyed (`04-multi-agent-system.md` §8 lifecycle).
2. Queue mechanics: per-worker-class queues per tier; visibility timeout = task deadline + 10%; max 3 delivery attempts.
3. **Dead-letter handling (binding).** After max attempts, the message parks in the class DLQ with full context. DLQ triage is an `SRE` runbook: classify (transient / poison / policy-denied / defect), requeue or route to owner. Policy-denied items route to the owning gate queue, not back to the worker (retrying a denial is envelope-probing — a `10-security.md` §8 anomaly signal). DLQ depth and age are SLO metrics (§15); any money-topic DLQ item pages a human immediately.

---

## 13. Observability

1. **OpenTelemetry everywhere.** Traces, metrics, logs in OTel format from every platform service, every cell service, every agent runtime, and every Kernel PEP. Build-phase backend: **[DECISION]** Grafana LGTM-class stack (Tempo/Mimir/Loki + Grafana), self-hosted in platform-core — provisional commodity choice; OTel is the real, non-negotiable standard so the backend is R2-swappable.
2. **The `trace_id` is the message-envelope `trace_id` from `04-multi-agent-system.md`.** It is minted when a goal enters the system (human directive, `SCOUT` finding, scheduled trigger) and propagates through every task contract, sub-delegation, tool call, Kernel decision, queue hop, and cell-side effect. One trace therefore reconstructs an entire causal chain from directive to side effect — the operational counterpart of the DR's decision chain.
3. **Agent-decision traces.** Agent reasoning steps (model calls, retrievals, tool selections) are spans with structured attributes: agent card version, model + version, token counts, retrieved KI ids, envelope meter snapshots. Every span tree that culminates in an R2+ action MUST link to its `DR-<yyyy>-<seq>`; the DR (Part VII schema) stores the `trace_id` reciprocally. WHY: when a decision looks wrong six months later, the replayable trace is the difference between a post-mortem and a shrug — and it is what `EVALUATOR` mines for regression suites (§17).
4. Metrics standards: RED metrics per service, envelope-meter gauges per agent, per-cell cost telemetry streaming to `UNIT-ECON`'s instrumentation (`08-finance.md`), model-cost metrics to `AI-DIR` (§22.3).
5. Observability data crossing the cell boundary is metadata-safe by construction: payload fields tagged sensitive by the data classifier are digested, not exported (`10-security.md` §5).

## 14. Logging: retention and immutability tiers

| Tier | Contents | Retention | Immutability |
|---|---|---|---|
| **L1 — Constitutional audit** | Kernel audit stream, gate decisions/DR events, treasury/ledger events, G-00 events | ≥ 10 years **[ASSUMPTION]** — matches entity/financial record obligations; GC to confirm per jurisdiction (G-11 adds jurisdictional overlays) | Append-only + object-lock compliance mode + external anchoring (§9.1). Deletion impossible before retention expiry, by anyone, by construction |
| **L2 — Security & operational** | Auth events, egress logs, infra logs, agent runtime logs | 400 days hot/warm, 3 years archive | Write-once archive; deletion via `ARCHIVIST` retention jobs only, logged in L1 |
| **L3 — Debug/verbose** | Verbose service logs, sampled traces | 30–90 days | None required |
| **Privacy carve-out** | Personal data inside logs | Per `PRIVACY` classification: pseudonymize at ingest; DSR erasure implemented by crypto-shredding per-subject keys, preserving L1 integrity | — |

## 15. Monitoring, SLOs, paging

1. **Platform SLOs (owned here; [ASSUMPTION] initial values, ratified via first-year error-budget review):**

| Service | SLO |
|---|---|
| Kernel PDP+PEP path | 99.95% availability; p99 added latency ≤ 25 ms |
| Kernel fail mode | **Fail-closed.** Kernel unavailable ⇒ agent actions queue, they do not proceed. WHY: the alternative — fail-open — converts every Kernel outage into an oversight outage; we accept availability pain to keep the guarantee absolute |
| Event backbone | 99.95% publish availability; money-topic end-to-end p99 ≤ 5 s |
| Identity/token service | 99.95% |
| Knowledge system reads | 99.9% (agents degrade to cached context on miss) |
| Ledger API | 99.9%; posting is queue-backed so backbone durability covers gaps |
| Cells (template default) | 99.9% customer-facing; per-venture SLOs may be raised with the cost priced into `08-finance.md` unit economics |

2. **Error budgets.** Each SLO carries a quarterly budget; exhaustion freezes feature rollouts for that service (`RELEASE` enforces the freeze automatically) until `INFRA-DIR` and the human platform lead approve a burn-down plan.
3. **Paging policy — what pages humans vs `SRE`:** `SRE` (A3) is the first responder for all platform and cell alerts within its runbook library. Humans are paged **directly and in parallel** (not after `SRE` fails) for: any Watchdog trip / G-00; Kernel or Watchdog degradation; audit-stream anchor mismatch; money-topic DLQ items; suspected security incidents (auto-handoff to `10-security.md` §9 severity ladder); any alert where the runbook's action would itself be R3+. Everything else pages a human only on `SRE` escalation or runbook exhaustion. WHY this split: `SRE` remediation authority is A3 and therefore R2-bounded — anything whose fix is R3+ needs a human in the loop from the first minute, not after an agent has tried things.

---

## 16. CI/CD

Operated by `RELEASE` (A3) under `ENG-DIR`; pipeline definitions are code, reviewed like code.

1. **Trunk-based development.** Short-lived branches (≤ 72 h, matching `W-CODE` lifetime), merge to trunk behind feature flags. WHY: agents generate high PR volume; long-lived branches multiply integration states beyond what review — human or agent — can hold.
2. **Progressive delivery + auto-rollback.** Every prod deploy: staging soak with `QA` gate → canary (≤ 5% traffic or one cell for platform changes) → automated analysis against SLO and behavioral guardrail metrics → progressive rollout. Guardrail breach ⇒ `RELEASE` rolls back automatically (A3 — rollback is the pre-approved safe action) and files the incident. Deploys touching money paths or the Kernel additionally require a named human approval in-pipeline (they are R3 by classification).
3. **Provenance attestation, SLSA-style.** Every artifact (container image, policy bundle, IaC plan, **prompt/agent-card bundle** — see `10-security.md` §7) is built on hosted ephemeral builders, signed, with provenance recording source commit, builder, and dependencies. Deploy-time admission control verifies signature + provenance; unsigned artifacts do not run, in any tier. Target SLSA Build L3 for platform components. **[ASSUMPTION]** Sigstore-class tooling (cosign) remains the ecosystem standard.
4. Agent-authored changes (the majority) carry the authoring agent's identity and task contract in the commit trailer and PR metadata; the reviewing entity (human, or `QA` for R1/R2-classified changes per the matrix) is recorded in provenance. No self-review: the author identity MUST NOT equal the approver identity — enforced in the pipeline, mirroring the human separation-of-duties rule in `10-security.md` §14.

## 17. Testing

1. **Pyramid per service:** unit → contract (schema-registry-verified, mandatory for every backbone topic and Platform Interface surface) → integration → a thin E2E layer. `QA` (A3) owns synthesis and maintenance; coverage/quality gates block merge.
2. **Agent-behavior regression suites** — `EVALUATOR`-owned, first-class release gates: golden-task suites per agent card (fixed scenarios with expected action classes), envelope-compliance suites (verifying the agent *attempts* conversion-to-A1 rather than probing when hitting limits), adversarial suites (curated prompt-injection corpus per `10-security.md` §11, maintained with `RED-CELL` contributions), and calibration tracking. Any change to a model version, prompt, agent card, or policy bundle MUST pass the affected suites before rollout; regressions block per `EVOLVE`'s protocol (`12-self-evolution.md`).
3. **Synthetic environments before prod.** New/modified agents run in sandbox against synthetic venture environments: seeded fake markets, simulated counterparties (a synthetic banking API, a synthetic ad platform with modeled response curves, synthetic customer personas for `SUPPORT`/`OUTBOUND` testing), and replayed historical event-log traffic (shadow mode, Appendix A). Graduation to staging requires meeting the agent card's evaluation metrics in synthetic; graduation to prod follows Part XII rollout protocol. WHY synthetic counterparties: an agent must be tested against an environment that pushes back — including injected adversarial content — without any R2+ surface existing at all.

## 18. Secrets

1. **Central manager, dynamic by default.** One secrets manager (**[DECISION]** build-phase: HashiCorp Vault — dynamic-secrets engine breadth is decisive; provisional, R3-swappable given its role under the Kernel). All third-party credentials are dynamic and short-lived wherever the provider allows (DB creds, cloud creds, brokered OAuth); static third-party secrets that cannot be dynamic get owner, rotation SLA per `10-security.md` §6, and automated rotation.
2. **No secrets in agent context windows — ever (binding).** Agents never see, hold, or transmit secret material. The tool-call proxy (§9.1) injects credentials server-side after policy approval: the agent says *"call the Stripe API with operation X"*; the proxy attaches the credential; the response is scrubbed of any echoed secret material before returning to the agent. WHY: an agent's context window is the single most exposed surface in EvolveOS — it ingests untrusted web and customer content daily, and prompt injection is a demonstrated, cheap exfiltration channel (`10-security.md` §2, threat 2). A secret that enters a context window must be presumed exfiltratable; therefore none may enter. This rule is Kernel-enforced (secret-pattern detectors on proxy responses and on all agent output paths) and is a **G-16**-protected enforcement rule.
3. Secrets scopes mirror the account structure: per-cell scopes transfer with the venture at exit (rotate-on-transfer mandatory); platform scopes never mount into cells.

## 19. Backups

**[ASSUMPTION]** RPO/RTO tiers below are initial calibrations; ratified/adjusted by the first annual game day (§20).

| Data class | RPO | RTO | Method |
|---|---|---|---|
| Ledger + Kernel audit (L1) | ~0 (dual-region synchronous-ack replication of log segments + anchors) | 4 h | Log replay + anchored snapshots |
| Platform OLTP (contracts, directory, gate queue) | 5 min | 4 h | PITR + cross-region snapshot copy |
| Knowledge graph + portfolio vectors | 1 h | 12 h | Snapshots + event-log rebuild path (Part VI ingestion is replayable by design) |
| Cell OLTP (prod) | 5 min | 8 h | PITR per cell, snapshots copied cross-region to a backup account **outside** the cell's IAM boundary |
| Object storage | Versioning + cross-region replication | 24 h | — |
| Warehouse | 24 h | 72 h | Rebuildable from sources; low tier is deliberate |
| Sandbox | None | None | Wiped weekly by design |

Backups MUST be: encrypted under keys from a separate key hierarchy branch (`10-security.md` §6), written to accounts whose deletion requires break-glass (backup destruction is the ransomware target), and **restore-tested** — every backup class has a monthly automated restore verification run by `SRE`; an untested backup is treated as no backup.

## 20. Disaster recovery

- **Platform: pilot-light cross-region.** Second region carries: continuously replicated L1 data, replicated snapshots, pre-provisioned (scaled-to-zero) IaC for Kernel, identity, backbone, and ledger. Regional failover is a human-declared event (R3, named platform lead + `INFRA-DIR` human chain) with a target RTO of 24 h for the platform core. WHY pilot-light and not active-active: the Kernel's fail-closed stance (§15) makes a platform outage safe-by-default (agents stop; nothing unsupervised happens), so we buy cheap recovery rather than expensive continuity.
- **Cells: restore-from-backup.** Cell templates are region-portable IaC; DR for a cell = re-provision + restore (RTO 8–24 h per §19). Ventures with contractual availability needs above this MAY fund warm standby out of their own envelope — priced into their unit economics, never subsidized silently by the platform.
- **Annual game days (binding).** At least annually: full platform regional failover exercise; restore-from-zero of one randomly selected production cell; one **cell exit drill** (§2.1 — sever Platform Interface, prove the cell runs standalone); and one **continuity-of-control drill** (operate the minimum manual set with the agent layer stopped — defined in `10-security.md` §12). Findings feed the failure register (`13-failure-analysis.md`).

## 21. High availability

- All platform services and cell templates: **multi-AZ (≥ 3 AZs)** with zero-single-AZ-dependency verified in the IaC policy checks.
- Kernel PDP/PEPs, token service, and Watchdogs run ≥ 3 instances across AZs; the Watchdog heartbeat lattice (§9.2) spans AZs.
- **[ASSUMPTION]** Availability targets are the SLO table in §15; they are targets for error-budget management, not contractual promises, except where a venture signs customer SLAs (those are venture-envelope decisions priced per `08-finance.md`).

## 22. Scalability

### 22.1 The scale unit is the cell
Venture growth scales *within* its cell (its own autoscaling, its own DB scaling) and never contends with other ventures except at the five Platform Interface surfaces. Adding ventures scales *horizontally* by stamping cells. Cell provisioning by `INFRA-DIR` MUST be fully automated: template instantiation ≤ 4 h from G-05 clearance, with no human infrastructure work in the loop (humans approve the gate, not the Terraform).

### 22.2 The 100-venture design point
The platform is sized and load-tested for **100 concurrent active ventures** **[ASSUMPTION]** (~10-year roadmap ceiling per `14-implementation-roadmap.md`; re-ratified with the roadmap). Derived envelope for platform components — **[ASSUMPTION]** planning numbers, not measurements: ~2,000–5,000 concurrent agent instances (T4-dominated), Kernel PDP sustained load ~5–10k decisions/s with 10× burst headroom, backbone ~50k events/s sustained, directory ~10⁴ identities. Bottlenecks watched by `INFRA-DIR` with quarterly load tests at 2× current portfolio: PDP latency (mitigation: policy-bundle partitioning by venture scope), knowledge-graph write contention (mitigation path owned by Part VI), gate-queue human throughput — the *governance* bottleneck: if weekly A2 batch review (Appendix C mechanics rule 4) exceeds human review capacity, the answer is more delegated human reviewers per `11-governance.md`, never looser gates.

### 22.3 AI inference cost and capacity — owned by `AI-DIR`
1. **Model routing.** A routing layer (Kernel-adjacent, but a cost/capability optimizer — not an enforcement component) maps each task class to a model tier per the agent card's requirements: frontier models for T1/T2 judgment and R3+ analysis; mid-tier for T3 routine work; small/fast models for T4 bulk tasks and classification. Routing tables are `AI-DIR`-owned configuration, benchmarked continuously by `EVALUATOR`; a routing change that degrades a safety-relevant eval is auto-reverted by the same guardrail machinery as §16.2.
2. **Multi-vendor from day 1** for inference (unlike infrastructure hosting, §4): ≥ 2 qualified providers per tier, contract terms tracked by `VENDOR`, with provider failover runbooks. WHY the asymmetry with §4: model quality/price shifts monthly, providers have correlated capacity crunches, and switching cost at the API layer is low if never allowed to grow — whereas cloud switching cost is inherently high.
3. **Cost controls:** prompt/context caching wherever supported; batch-tier submission for all non-latency-sensitive work (`SCOUT` scans, `EVALUATOR` suites, embedding jobs — target ≥ 40% of tokens on batch pricing **[ASSUMPTION]**); per-agent-class token budgets as envelope dimensions (an agent that blows its token budget converts to A1 like any other envelope breach — cognition is metered like money); portfolio inference spend reported in `08-finance.md` with per-venture attribution via capability-token tagging.
4. **[UNCERTAIN]** Self-hosted inference (open-weight models on owned accelerators) may become economic for T4 bulk classes; `AI-DIR` re-evaluates semi-annually with a build-vs-buy DR. Fine-tuned model weights, if any, are supply-chain artifacts under `10-security.md` §7.

---

## 23. Build vs buy

| Layer | Verdict | Justification |
|---|---|---|
| Kernel (PDP/PEP composition, envelope accountant, capability tokens, audit anchoring) | **BUILD** (on OPA, Envoy-class proxy, SPIRE as components) | This is EvolveOS's constitutional enforcement — no product implements envelope accounting over agent tool calls with gate conversion semantics. Buying the pieces, building the composition |
| Watchdogs | **BUILD** | Small, simple by design (§9.2); independence requirements rule out shared tooling |
| Agent runtime/orchestration | **BUILD** on open-source agent frameworks where convenient | Task contracts, envelope attenuation, and lifecycle rules (Part IV) are proprietary semantics; frameworks churn too fast to be foundations **[UNCERTAIN]** — revisit as the ecosystem matures |
| Workload identity | **BUY/ADOPT** (SPIRE) | Standard, audited, portable |
| Policy engine | **ADOPT** (OPA) | §8.2; building a policy language is a decade-long mistake |
| Secrets | **BUY** (Vault) | §18; dynamic-secrets breadth |
| Event backbone / queues | **BUY** (MSK/SQS) | Commodity; exit-plan substitutes named §4 |
| Databases (Postgres, graph, vector, warehouse) | **BUY/managed** | Commodity; Part VI owns knowledge-layer specifics |
| Observability | **ADOPT** (OTel) + self-host backend | Standard is the commitment; backend is swappable |
| CI/CD + provenance | **BUY** (hosted CI) + **ADOPT** (Sigstore-class) | Commodity with strong ecosystems; provenance verification config is ours |
| SIEM / detection pipeline | **BUY** platform, **BUILD** agent-behavioral analytics on the audit stream | No commercial SIEM understands envelope semantics or agent baselines (`10-security.md` §8); commodity log correlation is a solved purchase |
| Ledger | **BUILD** core (per `08-finance.md`) on Postgres/backbone, **BUY** accounting-package integrations | The ledger's event-sourced integration with envelopes and gates is proprietary; statutory accounting outputs flow to bought software |
| Fraud detection | **BUY** payment-processor tooling + **BUILD** `FRAUD-WATCH` cross-venture correlation | Processor tools see one venture; the portfolio-level pattern is the buy-side gap (`10-security.md` §10) |
| Human IdP / SSO | **BUY** (Okta, provisional) | Commodity; deep integration is with the directory, not the IdP |
| Model inference | **BUY** (multi-vendor, §22.3) | Frontier capability is not buildable; optionality is the control |

The recurring pattern, stated once: **buy commodity substrate, build everything that encodes the Constitution.** Any proposal to buy a product that would sit *inside* the enforcement path (Kernel, Watchdogs) MUST be treated as a G-16 matter, because vendor lock-in on enforcement is a governance risk, not a procurement one.

---

## 24. Security integration points (index into `10-security.md`)

Stated here for architectural completeness; normative depth is Part X's:

- Identity plane attribution chain → `10-security.md` §3; Zero-trust posture and microsegmentation → §4; Encryption/key hierarchy for every store in §11/§19 → §5–§6; Supply-chain requirements consumed by §16.3 → §7; Detection feeds from the audit stream, egress logs, envelope meters → §8; Incident-response hooks on paging (§15.3) → §9; Agent-specific controls enforced by Kernel PEPs (provenance labeling, output filtering, quarantine) → §11; Break-glass and separation-of-duties enforced in §3.2 guardrails and §16.4 → §14; Cell SDLC and pre-launch pen-test obligations at G-06 → §15.
