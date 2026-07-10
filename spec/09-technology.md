# EvolveOS Specification — Part IX: Technology

**Status:** Draft v0.1 · **Change class:** R3 (standard amendment process, Part XII)

**Scope.** This part specifies the infrastructure and platform stack on which every EvolveOS agent, venture, and governance process runs. It owns:

- platform architecture (Platform + Cells),
- cloud, IaC, network, and identity design,
- the concrete specification of the **Kernel** and **Watchdogs** as enforcement infrastructure,
- distributed-systems and data-layer choices,
- observability, CI/CD, testing infrastructure,
- backups, disaster recovery, high availability, and scalability.

It defers policy *content* to the Constitutional Layer (`10-security.md`, `11-governance.md`) and agent behavioral design to `04-multi-agent-system.md`. Security integration points are stated here (§24); their normative depth lives in `10-security.md`.

**Ownership of numbers (per `00-overview.md` §9).** This part owns: infrastructure SLOs, availability targets, RPO/RTO tiers, and platform capacity design points. Dollar/authority thresholds remain owned by `appendix-c-decision-gates.md`; budget envelopes by `08-finance.md`.

**A ten-year note.** Every vendor and product named below is a build-phase choice, not a decade commitment. Where a choice is provisional it is marked as such — but per the binding rules of this spec, we still CHOOSE, because "evaluate later" is how platforms end up with three of everything. Replacement of any named vendor is an R2/R3 change through the standard amendment process; replacement of anything the Kernel depends on for enforcement is R4 via **G-16**, because it is load-bearing for the oversight guarantee.

---

## 1. Design principles (binding)

1. **The Kernel is non-bypassable.** There MUST NOT exist any network path, credential, or API by which an agent can reach a tool, data store, or external service without traversing Kernel policy enforcement. This is the single most important property of the entire stack; every subsequent section is shaped by it. WHY: the autonomy–reversibility matrix (`00-overview.md` §6) is only as real as its enforcement; an enforcement layer with side doors is a policy document, not a control.
2. **Blast radius is a first-class design input.** Any component failure, compromise, or runaway agent MUST be containable to one cell or one platform service without manual heroics. WHY: EvolveOS runs many ventures on shared cognition; without hard containment, one venture's incident is a portfolio incident.
3. **Everything is declared, nothing is hand-built.** All infrastructure MUST be expressed as code, reviewed, and applied through CI. Console mutations in staging/prod are prohibited outside break-glass (`10-security.md` §14). WHY: agents operate this stack; agents cannot safely operate undocumented state, and undeclared state cannot be policy-checked.
4. **Cost is metered honestly at the cell boundary.** Every venture's true infrastructure cost MUST be attributable to its cell without allocation guesswork, because `08-finance.md` unit economics and G-05/G-06/G-07 funding decisions depend on it. A platform that hides venture costs corrupts the capital-allocation loop.
5. **Boring where possible, novel only where the mission demands it.** The novel parts of EvolveOS are the agent layer and the Kernel. The data plane, networking, and delivery machinery SHOULD be the most conventional, widely-operated technology available. WHY: novelty budget is finite and already spent on the parts that have no precedent.
6. **Fail closed, degrade toward humans.** Where an enforcement or control component is unavailable, dependent actions queue rather than proceed (§15.1); where the agent layer is unavailable, operations degrade to the human manual set (`10-security.md` §12). The system's failure posture is always *less* autonomy, never more.

---

## 2. System architecture: Platform + Cells

**[DECISION] — Cell-based architecture.** EvolveOS is built as one shared **Platform** plus one isolated **Cell** per venture.

**Platform** (portfolio-scoped, singleton) comprises:

- the Kernel and Watchdogs (§9),
- the agent runtime (task-contract execution per `04-multi-agent-system.md`),
- the knowledge system (`06-knowledge-system.md`),
- the decision engine (`07-decision-engine.md`),
- the event backbone and task queues (§10, §12),
- the finance ledger (`08-finance.md`),
- observability (§13), CI/CD (§16), and the identity plane (§6).

**Cell** (per `Venture`, per Appendix A): an isolated infrastructure unit — its own cloud account/project, own VPC, own data stores, own IAM boundary, own secrets scope — hosting that venture's production workloads: product services, venture databases, venture-facing third-party integrations. Cells are provisioned, resized, and decommissioned by `INFRA-DIR` from a versioned cell template (§3.2).

### 2.1 Alternatives compared

| Criterion | **A. Cell-based (chosen)** | B. Shared multi-tenant monolith | C. Fully separate stacks per venture |
|---|---|---|---|
| Blast radius (security & reliability) | One venture. Cell compromise cannot reach another cell except through Kernel-mediated platform APIs | Portfolio-wide. One tenant-isolation bug = every venture's data | One venture, best-in-class |
| Clean venture exit (G-14) | **Cell transfers with the venture**: account, data, IAM, DNS move to the buyer; platform ties sever at a documented interface | Extraction project measured in months; data disentanglement risk kills deal value and timelines | Trivial |
| Honest cost metering | Native — the cell's cloud bill *is* the venture's infra cost | Allocation models: always disputed, always gamed | Native |
| Shared learning & platform leverage | Full — knowledge system, decision engine, agent runtime amortized across all ventures | Full | **None** — rebuilds the Kernel, knowledge, and observability N times; destroys the compounding-learning thesis of `01-philosophy.md` |
| Enforcement uniformity (Kernel) | One Kernel governs all agent action everywhere | One Kernel, but tenancy bugs can bypass logical isolation | N Kernels to keep consistent — the Constitutional Layer becomes unenforceable in practice |
| Operational cost at 100 ventures | Moderate: automation-heavy but templated | Lowest raw cost, highest correlated risk | Prohibitive: ~100× platform overhead |
| Compliance scoping (per-venture jurisdictions, G-11) | Per-cell scoping: a regulated venture's controls don't burden the rest | Whole platform inherits the strictest regime of any venture | Per-stack, clean |

Options B and C each fail a founding requirement:

- B fails blast-radius containment and clean exits. A single tenancy defect exposes the portfolio; a venture sale from a monolith is a months-long extraction that destroys deal timelines and value.
- C fails compounding knowledge and uniform constitutional enforcement. One hundred independent stacks means one hundred Kernels to keep byte-identical in behavior — in practice, none of them would be trustworthy.

A is the only architecture satisfying all four of: containment, sellable ventures, honest cost, and shared learning. Therefore, binding rules:

1. Every venture at gate **G-05** (MVP Commit) or later MUST run in its own cell. Pre-G-05 work (prototypes by `PROTO`, validation experiments by `VALIDATOR`) runs in pooled **sandbox cells** (§3.3) that are wiped on a fixed schedule.
2. A cell MUST be transferable. Cell templates MUST NOT create hard dependencies on platform internals other than the documented Platform Interface (§2.2). Severing that interface — replacing platform endpoints with stubs or the buyer's equivalents — is a scripted, tested procedure (the **exit drill**, run annually per cell class, §20).
3. Cross-cell communication is **prohibited**. Ventures interact only via the platform event backbone with explicit Kernel policy allowing each topic pairing. WHY: ad-hoc cell-to-cell links silently rebuild the monolith and destroy exit cleanliness.
4. Cell decommissioning at **G-15** (Shutdown) follows the data disposition plan of that gate: data archived or crypto-shredded per `10-security.md` §5.5, account closed, DNS released, costs terminated — a venture that is dead MUST stop costing money within one billing cycle.

### 2.2 The Platform Interface (binding contract)

Each cell consumes the platform through exactly five surfaces, each versioned and each enforced by the Kernel:

1. **Identity/token endpoint** — cell workloads and agent instances obtain SPIFFE identities and capability tokens (§6–§8).
2. **Event backbone** — named topics with schema registry (§10).
3. **Ledger API** — all money-relevant events post to the portfolio ledger owned by `LEDGER` under `FIN-DIR` (`08-finance.md`).
4. **Observability export** — OTLP endpoints for traces/metrics/logs (§13).
5. **Knowledge system API** — retrieval and knowledge-item submission per `06-knowledge-system.md`, mediated by `KNOW-DIR` policies.

Anything a cell needs beyond these five surfaces is either (a) inside the cell, or (b) a new platform capability added by amendment to this part. No exceptions; exceptions are how interfaces rot, and interface rot is what makes exits dirty.

---

## 3. Infrastructure as code

### 3.1 Tooling

**[DECISION]** IaC standard: **OpenTofu** (Terraform-compatible), with HCL modules, remote encrypted state per account, and mandatory plan-review in CI.

Reasoning:

- **WHY OpenTofu over Terraform:** license posture (MPL-2.0 fork vs BUSL) matters over a 10-year horizon, and matters specifically because EvolveOS may ship infrastructure tooling *inside sold cells* (G-14) where downstream licensing must be clean. Functional parity is sufficient today. **[UNCERTAIN]** The Terraform/OpenTofu ecosystem may re-converge or diverge sharply; this choice is R2-revisable, and modules MUST avoid vendor-specific extensions of either fork to keep it that way.
- **WHY not Pulumi/CDK (general-purpose-language IaC):** agents write and review most IaC changes. A constrained declarative language is easier to statically analyze, diff, and policy-check (§8 policy-as-code runs against every plan) than arbitrary imperative code. Expressiveness is a liability when the author population includes A2/A3 agents.

Repository and module structure (binding shape, names illustrative):

```
infra/
  modules/            # reviewed, versioned building blocks
    cell-template/    # the entire venture cell, one module, semver'd
    platform/…        # kernel, backbone, identity, observability, ledger
    guardrails/       # org-level SCPs — G-16 change control applies
  live/
    org-management/
    platform-security/
    platform-identity/
    platform-core-{sandbox,staging,prod}/
    cells/V-<yyyy>-<seq>/{staging,prod}/   # instantiations of cell-template ONLY
  policy/             # OPA checks run against every plan (deny rules: public
                      # buckets, long-lived keys, cross-cell peering, missing
                      # tags for cost attribution, single-AZ resources)
```

Rules:

1. `live/cells/*` MUST contain only instantiations of `cell-template` at a pinned version plus a bounded parameter set. Hand-written resources in a cell directory fail CI. WHY: 100 bespoke cells are unoperable; 100 instances of one template are a fleet.
2. All IaC changes are proposed as pull requests (typically by `W-CODE` workers under `INFRA-DIR` or `ENG-DIR`), policy-checked automatically, and applied only through the CI/CD system operated by `RELEASE` (§16).
3. IaC changes touching the Kernel, Watchdogs, or identity plane are R3 minimum and require a named human platform engineer's approval. Changes to Kernel *enforcement rules* (guardrail SCPs, PEP composition, audit anchoring) are R4 via **G-16**.
4. State files are C4-classified data (`10-security.md` §5.1): encrypted, access-logged, never readable by agents outside the plan/apply pipeline.

### 3.2 Account/project structure

One cloud **organization**, with accounts (AWS terminology; "projects" if the provider changes) as the hard isolation unit:

| Account group | Contents | Count |
|---|---|---|
| `org-management` | Org root, SCP/guardrail policies, billing. No workloads, ever. | 1 |
| `platform-security` | Kernel audit-log archive, security tooling, Watchdog runtime, break-glass credential store. Independent admin set (§9.2, `10-security.md` §14). | 1 |
| `platform-identity` | Identity plane: workload-identity control plane (SPIRE), human SSO federation. | 1 |
| `platform-core-{sandbox,staging,prod}` | Kernel, agent runtime, event backbone, knowledge system, decision engine, ledger, observability | 3 |
| `platform-backup` | Cross-region backup copies, outside the IAM reach of every other account (§19) | 1 |
| `cell-V-<yyyy>-<seq>-{staging,prod}` | One pair per venture at G-05+ | 2 × ventures |
| `sandbox-pool-N` | Pooled pre-G-05 sandbox cells, wiped weekly | ~5, elastic |

Binding guardrails (org-level service control policies), which MUST deny:

1. disabling or reconfiguring audit trails in any account;
2. public exposure of storage buckets in any cell by default (explicit, policy-reviewed exception path for genuinely public assets);
3. creation of long-lived access keys (§7.1);
4. cross-account role assumption other than the enumerated Platform Interface paths;
5. member-account root-user actions (root credentials vaulted, alarmed, break-glass only).

Guardrail changes are Kernel-enforcement changes → **G-16**. WHY at the org layer: guardrails are the one control that binds even a fully compromised member account.

### 3.3 Environment tiers

| Tier | Purpose | Data | Agent autonomy |
|---|---|---|---|
| **sandbox** | Prototypes, agent experimentation, `EVALUATOR` synthetic runs, destructive testing | Synthetic or irreversibly anonymized only. Real customer data in sandbox is a policy violation the Kernel blocks at the data-access layer | Up to each agent's ceiling; all actions R1 by construction (sandbox is wiped, no external egress except allowlisted research endpoints) |
| **staging** | Pre-production verification, `QA` release gates, DR rehearsal targets | Masked production-shaped data | A3 max; no external side effects |
| **prod** | Live ventures and platform | Real | Autonomy–reversibility matrix fully applies |

Rules:

1. Sandbox's "no real external side effects" property is what makes A4 agents like `SCOUT` and `W-RESEARCH` workers safe: their write surface is R1 by construction.
2. Tier is a **capability-token claim** (§8.1). A sandbox-issued token is not honored by any staging/prod enforcement point; there is no promotion of tokens, only promotion of artifacts (§16).
3. Promotion path is one-way and pipeline-only: sandbox → staging → prod, each hop through `RELEASE` with the §16 gates. No artifact reaches prod without a staging soak record.
4. Staging masking is a `PIPELINE-ENG`-owned, `PRIVACY`-audited transformation; unmasked C3 data (`10-security.md` §5.1) found in staging is a Sev-3 incident.

---

## 4. Cloud provider

**[DECISION] Primary cloud: AWS.** Reasoning:

1. **Isolation primitives.** The account boundary is the strongest, most battle-tested multi-tenant isolation unit in any public cloud, and the cell architecture leans on it entirely. Mature SCP guardrails and Nitro-based instance isolation are directly load-bearing for §2 and §3.2.
2. **Breadth for cells.** 100 ventures will collectively need a very long tail of managed services; AWS's catalog breadth minimizes "the platform must build it" events.
3. **KMS/HSM maturity** for the key hierarchy in `10-security.md` §6 (CloudHSM-backed roots, external key stores, envelope encryption as a first-class API).
4. **Talent and agent competence.** Human hires and — materially — current AI models are strongest at AWS operations; agent-operated infrastructure argues for the most-documented provider. **[ASSUMPTION]** Model competence tracks ecosystem documentation volume; true today, likely to persist, revisited by `AI-DIR` annually.

**[UNCERTAIN]** Over 10 years, AI-inference economics may make a different provider (or on-prem inference) decisive for cost. The stack therefore separates **inference procurement** (owned by `AI-DIR`, multi-vendor from day 1, §22.3) from **infrastructure hosting** (single-primary AWS). The two decisions are deliberately decoupled so neither drags the other.

**Portability posture: pragmatic single-primary with a maintained exit plan — NOT day-1 multi-cloud.** Binding form:

1. We MUST NOT build active-active multi-cloud. WHY:
   - it doubles the security-enforcement surface the Kernel must police (two IAM models, two network models — twice the ways to be wrong);
   - it halves the depth of team and agent expertise on either provider;
   - it forfeits the strongest isolation primitives by forcing lowest-common-denominator abstractions;
   - its availability benefit is negligible next to the dominant real risks, which are our own defects and agent misbehavior, not regional cloud failure;
   - the one real argument — vendor negotiation leverage and existential provider risk — is handled more cheaply by a credible exit plan than by live redundancy.
2. We MUST maintain a written, annually re-costed **cloud exit plan**:
   - inventory of AWS-proprietary service usage per platform component, each with a designated substitute (e.g., Aurora Postgres → self-managed/other managed Postgres; MSK → self-managed Kafka; SQS → an AMQP broker; KMS/CloudHSM → external HSM + open-source KMS layer);
   - estimated migration cost and duration per component, summed to a portfolio exit cost the Investment Committee sees annually;
   - a hard cap: **no platform component may adopt a proprietary service with no identified substitute** without a documented waiver approved through `INFRA-DIR`'s human chain — an R3 decision recorded as a DR.
3. Cells SHOULD be more conservative than the platform: cell templates use Postgres, object storage, container runtime, and queue abstractions with thin adapters, because a cell may be sold (G-14) to a buyer on another cloud, and buyer-side portability is deal value.

---

## 5. Networking

1. **Cell isolation.**
   - Each cell is its own VPC in its own account, with a non-overlapping CIDR allocated from a central plan (so future connectivity decisions are never blocked by address collisions).
   - No VPC peering and no transit-gateway attachment between cells, ever. The org guardrails (§3.2) deny the API calls that would create them.
   - Default security stance inside a cell: no inbound from anywhere except the cell's own load balancer; no outbound except through the cell egress gateway (rule 3).
2. **Platform connectivity.**
   - Cells reach the five Platform Interface surfaces (§2.2) via AWS PrivateLink endpoints only — private, unidirectional, per-service.
   - The platform does not get a network route *into* cells. Platform-initiated actions on cells happen through the cell's own agent runtime pulling signed task contracts off the backbone. WHY: a compromised platform component must not have standing network reach into every venture's production; the pull model makes the cell the last authorizer of what runs inside it.
3. **Egress control per agent tool — the network face of the Kernel.** All outbound traffic from agent runtime nodes (platform and cell) MUST traverse an **egress gateway** that enforces, per connection:
   - (a) the calling workload's SPIFFE identity;
   - (b) a destination allowlist derived from the agent's card (`04-multi-agent-system.md`) and current capability token;
   - (c) TLS SNI/destination verification (no CONNECT-to-anywhere tunnels).
   There is no generic "internet access"; there are named tool destinations: `ADS` → ad-platform APIs; `SCOUT` → its research crawl allowlist; `OUTBOUND` → approved email/sequencing providers; `TREASURER` → banking APIs, which additionally require the co-sign flow in `10-security.md` §6.3. Non-agent product workloads inside a cell get a per-cell destination allowlist maintained in the cell template. Egress denials are Kernel audit events and feed the behavioral baselines in `10-security.md` §8.
4. **No public IPs** on any compute in any account; ingress only via managed load balancers/CDN in cells that serve customers; platform services have no public ingress at all (human access via SSO-fronted access proxy).
5. **DNS.** Per-cell public zones (transferable with the venture at G-14); platform zones separate and never delegated into cells. Internal service discovery is private DNS per VPC.
6. **Inter-region links** exist only for §19–§20 replication paths, are unidirectional toward `platform-backup` and the pilot-light region, and carry only encrypted replication traffic.

---

## 6. Identity

One **identity plane** for every actor — human or agent — specified here mechanically; attribution and policy semantics in `10-security.md` §3.

1. **Workload identity: SPIFFE.** Every workload — every agent instance, every T4 worker, every product service, the Kernel's own components — receives a SPIFFE ID and short-lived SVID (X.509, TTL ≤ 1 h, auto-rotated) from a SPIRE deployment rooted in `platform-identity`.
   - ID scheme for agents: `spiffe://evolveos.internal/<tier>/<agent-id>/<instance-uuid>` — e.g., `spiffe://evolveos.internal/prod/BUILDER/1f3a…`.
   - Venture-scoped instances carry the venture: `spiffe://evolveos.internal/prod/VENTURE-ORCH/V-2027-004/<uuid>`.
   - Product services: `spiffe://evolveos.internal/cell/V-2027-004/<service>/<uuid>`.
   - Watchdogs live in a **separate trust domain**: `spiffe://watchdog.evolveos.internal/…` (§9.2).
   - Node attestation uses cloud instance-identity documents; workload attestation uses the container runtime.
   - **[DECISION]** SPIFFE/SPIRE over cloud-native IAM alone: cloud IAM cannot express agent-instance granularity, cannot follow a sold cell out the door, and does not survive a cloud exit. SPIFFE is the portable identity layer; cloud IAM roles are *derived from* SPIFFE identity at token exchange (§7.2), never assigned directly to workloads.
2. **Human identity: SSO + MFA.** All human access federates through a single IdP (**[DECISION]** build-phase: Okta; provisional — commodity layer, R2-swappable) with phishing-resistant MFA (FIDO2 hardware keys) REQUIRED for any role that can approve gates, touch prod, or authorize spend. Password+TOTP is acceptable only for read-only portfolio dashboards.
3. **Unified directory.** One directory holds humans, agent definitions (from `appendix-b-agent-registry.md`), agent instances, and service identities, with the reporting/authority edges from `11-governance.md` and `04-multi-agent-system.md`.
   - The directory is the single source the Kernel resolves against; shadow identity stores are prohibited.
   - Gate approver sets (`appendix-c-decision-gates.md`) resolve to directory groups, so "IC quorum (≥3)" is machine-checkable at approval time, not a convention.
   - Separation-of-duties constraints (`10-security.md` §14.3) are encoded as directory set-disjointness the PDP checks mechanically.

---

## 7. Authentication

1. **Short-lived credentials only.** No static API keys, no long-lived cloud access keys, no service passwords, anywhere.
   - Workloads authenticate with SVIDs (mTLS).
   - Humans authenticate with SSO sessions (≤ 12 h) plus FIDO2 step-up for sensitive actions; approvals are signed under step-up (`10-security.md` §3.4).
   - Agents reach external SaaS via dynamic credentials from the secrets manager (§18), brokered at call time by the Kernel — the agent never authenticates directly to anything external.
   - Org guardrails (§3.2) make long-lived key creation impossible rather than merely forbidden.
2. **Token exchange.** A workload presents its SVID to the Kernel token service and receives:
   - (a) scoped cloud-IAM session credentials when it needs cloud APIs, and
   - (b) a **capability token** (§8) for tool calls.
   Both are sender-constrained (proof-of-possession bound to the SVID) so a stolen token is useless off-box.

## 8. Authorization

1. **Capability tokens carrying envelope claims.** Every agent tool call is authorized by a capability token minted by the Kernel per task contract. Minimum claim set:

```yaml
sub:        spiffe://evolveos.internal/prod/ADS/V-2027-004/9c41…
agent:      { id: ADS, card_version: 14 }
contract:   TC-2027-118234            # task-contract ID (Part IV)
venture:    V-2027-004
tier:       prod
authority:  { gate: G-06, dr: DR-2027-0611 }   # originating human authority
tools:      [ads.google.campaign_write, ads.meta.campaign_write, insight.read]
data_ceiling: C2                       # per 10-security.md §5.1
envelope:
  spend_usd_remaining: 1800            # slice of channel envelope, Part VIII
  rate: { tool_calls_per_min: 30 }
  actions: [campaign.create, campaign.pause, budget.set<=envelope]
provenance_mode: standard              # or 'stripped' per 10-security.md §11.2
exp:        2027-06-11T18:00:00Z       # ≤ task deadline, hard cap 24 h
```

   - Tokens are attenuable **downward only**: a T3 agent delegating to a T4 worker passes a strict sub-slice, never an escalation (registry rule, `appendix-b-agent-registry.md` T4 table). Attenuation is verified cryptographically and re-checked by the PDP.
   - **[DECISION]** Claims-in-token (Biscuit/macaroon-style attenuation semantics over a JWT-compatible encoding) rather than pure server-side lookup: the token is self-describing for audit and offline verification, but the PDP remains authoritative — the token is a *cache of authorization context*, not a bearer bypass. Revocation and live flags are checked server-side on every call (§9.1).
2. **Policy-as-code, deny-by-default.** All authorization policy is expressed in a policy language evaluated by the Kernel on **every** agent tool call.
   - **[DECISION]** Build-phase engine: **OPA/Rego** — mature, auditable, testable like code, with a large enough corpus that agents are competent in it. Policy bundles are versioned in git, unit-tested, and deployed through `RELEASE`.
   - **[UNCERTAIN]** Cedar's analyzability (formal verification of policy properties) may justify migration once policy volume grows; the policy *model* here is engine-neutral, so this is an R3 swap.
   - Illustrative policy shape (not normative syntax):

```rego
default allow := false

allow {
  token_valid; not revoked; not scope_stopped        # G-00 flags
  input.tool == token.tools[_]
  action_reversibility(input) <= max_r_for_autonomy(token)
  envelope_remaining(token) >= projected_cost(input)
  data_class(input) <= token.data_ceiling
  provenance_rules_satisfied(input, token)           # 10-security.md §11.2
}

queue_A1 { all_above_except_envelope_or_matrix }     # convert, don't fail
```

3. **Policy inputs on each decision:** token claims; the tool adapter's declared reversibility classifier output (R1–R4, computable per `00-overview.md` §5 dollar/duration bounds); current envelope-meter readings; the autonomy–reversibility matrix; live flags (G-00 stops, quarantines per `10-security.md` §11.6, degraded-mode state per `10-security.md` §12.3). The decision is **allow / deny / convert-to-A1** — conversion queues the action at the owning gate per `appendix-c-decision-gates.md` mechanics rule 3, so envelope breaches become approvals-pending, not errors.
4. **Humans go through the same PDP** for production-affecting actions. Gate approvals are recorded as directory-verified, step-up-signed events on the DR; the Kernel will not execute an R3+ action without resolving its gate-approval reference to a valid signature by the gate's approver set.

---

## 9. The Kernel and the Watchdogs (enforcement infrastructure — not agents)

Per `appendix-b-agent-registry.md`, the Kernel and Watchdogs have **no goals, only rules**. They contain no LLM in any enforcement path. WHY: the layer that constrains model-driven behavior must not itself be model-driven, or prompt-level attacks against agents become attacks against enforcement itself (`10-security.md` §2, threat T2).

### 9.1 Kernel components

| Component | Function |
|---|---|
| **PDP** (policy decision point) | Evaluates §8 policy on every tool call. Stateless, horizontally scaled; p99 decision latency budget 15 ms (§15). |
| **PEPs** (policy enforcement points) | The only doors (below). |
| **Envelope accountant** | Real-time meters per envelope: spend, tool-call rate, data volume, action counts, token consumption (§22.3). |
| **Token service** | §7.2 exchange; revocation list propagated to all PEPs ≤ 5 s. |
| **Audit stream** | Tamper-evident record of everything (below). |

**The three PEPs:**

1. The **tool-call proxy** — every agent tool invocation (external API call, DB query, message send, browser action, shell exec) is a request to this proxy, which validates the capability token with the PDP, executes the call using credentials *the agent never holds* (§18.2), applies response scrubbing and output filtering (`10-security.md` §11.4), and records request/response digests to the audit stream.
2. The **egress gateway** (§5.3) — the network-layer twin of the proxy; anything that somehow speaks raw network still cannot leave except through identity-checked, allowlisted egress.
3. The **data-access layer** — enforces data-class ceilings and provenance rules on knowledge-system reads and cell-DB access.

Agent runtime containers have **no network route except to PEPs** — non-bypassability is a network fact, not a convention.

**Anatomy of one tool call (normative sequence):**

1. Agent instance decides to call tool `X` with arguments `A` under contract `TC`.
2. Runtime sends `{token, X, A}` to the tool-call proxy over mTLS (SVID-authenticated).
3. Proxy asks the PDP: token validity, revocation, live flags, allowlist, reversibility classification of `(X, A)`, matrix check, envelope projection, data ceiling, provenance mode.
4. PDP returns **allow** → proxy fetches/derives the credential for `X` from the secrets manager (§18), executes, scrubs the response, debits the envelope accountant, returns the result to the agent.
5. PDP returns **convert-to-A1** → the action is written to the owning gate's queue with full context; the agent receives a structured "queued" result and MUST plan around the pending state (Part IV behavior).
6. PDP returns **deny** → structured denial to the agent; denial recorded; repeated denials feed anomaly baselines (`10-security.md` §8.2).
7. Every step (including denials and queues) emits audit events with the contract's `trace_id` (§13.2).

**Envelope accountant semantics:**

- Spend meters are strongly consistent: spend decrements serialize per envelope, so parallel workers cannot double-spend a venture envelope. WHY strong consistency for money only: it is the one meter where eventual consistency converts directly into unauthorized spend.
- Rate/volume meters are eventually consistent (≤ 5 s lag acceptable) — breakers in `10-security.md` §11.7 provide the fast backstop.
- Spend commitments reconcile against `LEDGER` postings; drift beyond tolerance is a Watchdog trip condition.

**Audit stream:**

- Every PDP decision (including denies), every PEP execution digest, every token issuance/revocation, every envelope-meter event → append-only topic on the event backbone.
- Continuous anchoring: hourly Merkle roots written to (a) object storage under compliance-mode object lock in `platform-security` and (b) an external timestamping service. Tamper-evidence therefore does not depend on any single account's integrity.
- `ARCHIVIST` runs continuous integrity verification against the anchors — it verifies the log; it **cannot write** to it (read-only credential set).
- Retention and access per §14 and `10-security.md`.

**The Kernel is configured, not commanded.** No agent — including `PRIME` and `EVOLVE` — has any API to alter Kernel policy at runtime. Policy changes ship as reviewed, signed bundles through `RELEASE` (§8.2, §16.3); changes to enforcement semantics are R4 via **G-16**.

> **Revision (XV-9):** The Kernel's core enforcement invariants — envelope slices form a strictly shrink-only lattice; over-envelope/over-matrix actions convert to A1 (never execute, never fail silently); exactly one macro-state per venture; G-00 stop/restart per the amended stop asymmetry; separation-of-duties set-disjointness — MUST be specified in a machine-checkable formal model (TLA+/Alloy-class), with model-checking runs in CI on every change to enforcement semantics. A G-16 enforcement-rule change without an updated, passing model is invalid. This is additionally a precondition of dependency D5 (Part XIV §11): no treasury automation before the model passes. See Part XV (`15-critique-and-revisions.md`) §4.

### 9.2 Watchdogs

Watchdogs are independent monitor processes (Appendix A definition) with these binding properties:

1. **Separate everything.** Watchdogs run in the `platform-security` account on infrastructure the platform-core admins cannot modify, with their own SPIFFE trust domain (`spiffe://watchdog.evolveos.internal/…`), their own credentials, and their own alerting path (direct to humans — phone/paging provider — not through platform observability). WHY: a compromise of the platform-core account must not blind or silence the Watchdogs; independence is the entire point.
2. **Read + trip only.** A Watchdog can read the audit stream, envelope meters, and liveness signals. Its only write capabilities are: (a) trigger **G-00**, and (b) page humans. It cannot fix, restart, or reconfigure anything — remediation belongs to `SRE`, `BLUE-CELL`, and humans. WHY: a component with both trip and repair powers becomes an operator, and operators need oversight; the Watchdog's simplicity *is* its trustworthiness. It must be small enough to be reviewed exhaustively by humans.
3. **The G-00 trip wire, mechanically:**
   - Watchdog trips at a scope: single agent instance, agent class, venture cell, or whole system.
   - The Kernel PDP flips the scope's flag to deny-all-except-safeing within ≤ 5 s; in-flight capability tokens in scope are revoked.
   - The paged human receives the triggering evidence bundle simultaneously.
   - Restart follows the stop asymmetry of `appendix-c-decision-gates.md`: one human (or Watchdog) stops; the owning gate's full approver set restarts.
4. **Trip conditions** (initial set; extending it is a G-16 change because trip conditions are enforcement rules):
   - envelope-meter tamper signals or accountant/ledger reconciliation drift;
   - audit-stream gaps, sequence anomalies, or anchor mismatches;
   - agent-instance liveness anomalies (zombie instances, instances acting outside any live contract);
   - spend-velocity breakouts beyond class ceilings;
   - behavioral-baseline critical alerts escalated per `10-security.md` §8.2;
   - Kernel PDP/PEP integrity check failures.
5. **Watchdog liveness is itself watched:** a heartbeat lattice among ≥ 3 Watchdog instances across AZs; missing heartbeats page humans directly through the independent alerting path. A silent Watchdog layer is a Sev-1 (`10-security.md` §9.1).

---

## 10. Distributed systems: event backbone and delivery semantics

**[DECISION] Hybrid: durable event log (Kafka-class) as the backbone + task queues for T4 dispatch.** Alternatives compared:

| | **Event log + queues (chosen)** | Point-to-point REST | Queue-only |
|---|---|---|---|
| Replayability / audit | Native — the log *is* the historical record; audit stream, knowledge ingestion, and DR rebuilds replay it | None; audit must be bolted on | Consumed = gone; replay requires a separate archive |
| Fan-out (ledger + knowledge + observability + `FRAUD-WATCH` all consume payment events) | One write, N independent consumers with own offsets | N synchronous calls, N failure modes | Per-consumer queues, N writes |
| Backpressure under agent bursts | Log absorbs bursts; consumers proceed at own pace | Cascading timeouts | Acceptable |
| Work distribution to ephemeral workers | Weak alone — hence the hybrid | Poor | **Native** — visibility timeouts, per-message ack, DLQ |
| Ordering where money moves | Per-key ordering (partition by envelope/account ID) | None guaranteed | FIFO variants limited in throughput |

Build-phase implementation: **AWS MSK (Kafka)** for the log; **SQS** for task queues. Both are on the §4 exit-plan substitution list (self-managed Kafka; AMQP broker).

**Topic taxonomy (schema-registry-enforced, envelope header mandatory):**

| Namespace | Contents | Retention |
|---|---|---|
| `platform.audit.*` | Kernel audit stream (§9.1) | Infinite (tiered to object store) |
| `platform.money.*` | Ledger postings, envelope debits, payment events | Infinite |
| `platform.contracts.*` | Task-contract lifecycle events | 3 years |
| `platform.knowledge.*` | KI submissions/validations per `06-knowledge-system.md` | Per Part VI |
| `cell.V-<yyyy>-<seq>.*` | Venture domain events; namespaced, ACL'd to that cell + platform consumers | Per class |
| `platform.gates.*` | Gate queue events, approvals, conversions | Infinite |

Every message carries the Part IV envelope header: task-contract ID, `trace_id`, agent instance, venture, reversibility class, provenance labels (`10-security.md` §11.1).

**Exactly-once where money moves (binding).** True exactly-once delivery is a distributed-systems fiction; we engineer exactly-once *effects*:

1. **Idempotency keys.** Every state-changing operation on the ledger, treasury interfaces, payment providers, and envelope accountant MUST carry a caller-generated idempotency key, derived deterministically from `(task-contract ID, operation sequence)`. Receivers MUST deduplicate on it for ≥ 30 days. WHY derivation rather than random keys: a retried worker regenerates the *same* key without coordination.
2. **Outbox pattern.** Any service that both writes its database and emits an event MUST write the event to an outbox table in the same transaction; a relay publishes from the outbox. Dual-writes are prohibited and CI-linted for. WHY: the failure mode "DB committed but event lost" is precisely how ledgers and reality diverge.
3. Consumers of `platform.money.*` MUST be idempotent and MUST NOT auto-advance past a poison message: park to DLQ and page (§12.3).
4. Synchronous request/response (gRPC/REST) is permitted only for reads and for the Kernel PDP path (which must be synchronous); all writes with cross-service effects go through the log or queues.

---

## 11. Storage and databases

Per-workload standards. Introducing anything not listed requires an `INFRA-DIR`-approved DR — database sprawl is a 10-year tax paid monthly:

| Workload | Standard | Placement | Notes |
|---|---|---|---|
| OLTP (venture product data) | **PostgreSQL** (Aurora Postgres build-phase; plain Postgres in the exit plan and in cell templates for portability) | Per cell | One cluster per cell minimum; cross-cell DB access is impossible by network design (§5.1) |
| Platform OLTP (agent state, task contracts, gate queue, directory) | PostgreSQL | Platform-core | The task-contract store is the agent runtime's source of truth |
| Event log | Kafka-class (§10) | Platform-core; per-cell topics namespaced | Money/audit topics: infinite retention via tiered storage |
| Object storage | S3-class | Per account | Audit anchors under compliance-mode object lock (§9.1); cell buckets transfer at exit |
| Knowledge graph | Property graph DB per `06-knowledge-system.md` (**[DECISION]** build-phase Neo4j; detailed ownership in Part VI) | Platform-core | Single portfolio-wide graph — this is the compounding asset |
| Vector stores | **pgvector** within Postgres for cell-local embeddings; dedicated vector service for the portfolio corpus per `06-knowledge-system.md` | Split | Part VI owns retrieval architecture; Part IX owns hosting |
| Analytics warehouse | **[DECISION]** Snowflake-class managed warehouse (provisional; commodity layer), fed by ELT from cells, operated by `PIPELINE-ENG` under `DATA-DIR` | Platform-core | Cell → warehouse flows pass the data-access PEP: masked/classified per `10-security.md` §5.4 before leaving the cell |
| Ledger | Append-only double-entry store per `08-finance.md`: Postgres projection over event-log sourcing; the log is authoritative | Platform-core | Never per-cell: one book of record for the portfolio |
| Caches | Redis-class, ephemeral only | Per need | MUST be reconstructable; durable state in caches is a defect |

Binding rules:

1. Every store is encrypted per `10-security.md` §5.3 under the §6-branch keys of `10-security.md`.
2. Every schema carries data-class annotations (`10-security.md` §5.1); unannotated columns fail migration CI.
3. Schema evolution goes through `PIPELINE-ENG`-owned migration tooling with backward-compatibility checks against the schema registry.

## 12. Messaging and queues (T4 dispatch)

1. **Dispatch flow.** T2/T3 agents dispatch T4 workers (`W-RESEARCH`, `W-CODE`, `W-OPS`, `W-OUTREACH`) by:
   - writing a task contract to the contract store,
   - enqueueing a dispatch message to the worker-class queue.
   The worker runtime pulls, requests a capability token (attenuated per §8.1), executes, reports results onto the backbone, and is destroyed per the `04-multi-agent-system.md` §8 lifecycle.
2. **Queue mechanics:**

| Queue class | Visibility timeout | Max deliveries | Notes |
|---|---|---|---|
| `q.w-research.<tier>` | task deadline + 10% | 3 | Bulk-batch friendly (§22.3) |
| `q.w-code.<tier>` | task deadline + 10% | 3 | Results land as PRs, never direct pushes |
| `q.w-ops.<tier>` | runbook SLA + 10% | 3 | `SRE`/`SUPPORT`/`LEDGER` spawned |
| `q.w-outreach.<tier>` | 24 h | 2 | Lower retry ceiling: duplicate outreach to a human recipient is a real-world side effect, so we retry less and queue-to-human sooner |

3. **Dead-letter handling (binding).**
   - After max deliveries, the message parks in the class DLQ with full context (contract, token claims digest, failure history).
   - DLQ triage is an `SRE` runbook: classify → transient (requeue), poison (quarantine message, open defect), policy-denied (route to the owning gate queue — never back to the worker; retrying a denial is envelope-probing, a `10-security.md` §8.2 anomaly signal), or defect (route to owning director's queue).
   - DLQ depth and item age are SLO metrics (§15).
   - Any `platform.money.*`-related DLQ item pages a human immediately (§15.3).

## 13. Observability

1. **OpenTelemetry everywhere.** Traces, metrics, and logs in OTel format from every platform service, every cell service, every agent runtime, and every Kernel PEP. Build-phase backend: **[DECISION]** Grafana LGTM-class stack (Tempo/Mimir/Loki + Grafana), self-hosted in platform-core — a provisional commodity choice. OTel is the real, non-negotiable standard; the backend is R2-swappable precisely because ingestion is OTLP at every boundary.
2. **The `trace_id` is the message-envelope `trace_id` from `04-multi-agent-system.md`.**
   - Minted when a goal enters the system: a human directive, a `SCOUT` finding clearing G-01, a scheduled trigger.
   - Propagated through every task contract, sub-delegation, tool call, Kernel decision, queue hop, and cell-side effect.
   - One trace therefore reconstructs an entire causal chain from directive to side effect — the operational counterpart of the DR's decision chain.
3. **Agent-decision traces.** Agent reasoning steps (model calls, retrievals, tool selections) are spans with structured attributes:
   - agent card version, model + version, token counts,
   - retrieved knowledge-item IDs (so knowledge-quality incidents are traceable to consumers, Part VI),
   - envelope-meter snapshots at decision time,
   - provenance-mode flags (`10-security.md` §11.2).
   Every span tree culminating in an R2+ action MUST link to its `DR-<yyyy>-<seq>`; the DR (Part VII schema) stores the `trace_id` reciprocally. WHY: when a decision looks wrong six months later, a replayable trace is the difference between a post-mortem and a shrug — and it is the raw material `EVALUATOR` mines for regression suites (§17.2).
4. **Metrics standards:** RED metrics per service; envelope-meter gauges per agent instance and class; per-cell cost telemetry streamed to `UNIT-ECON`'s instrumentation (`08-finance.md`); model cost/latency metrics to `AI-DIR` (§22.3); DLQ depth/age (§12.3).
5. **Cell-boundary safety:** observability data crossing the cell boundary is metadata-safe by construction — payload fields tagged C3+ by the data classifier are digested, not exported (`10-security.md` §5.4).

## 14. Logging: retention and immutability tiers

| Tier | Contents | Retention | Immutability |
|---|---|---|---|
| **L1 — Constitutional audit** | Kernel audit stream, gate decisions and DR events, treasury/ledger events, G-00 events | ≥ 10 years **[ASSUMPTION]** — matches entity/financial record obligations; GC confirms per jurisdiction, with overlays added at each G-11 expansion | Append-only + object-lock compliance mode + external anchoring (§9.1). Deletion before retention expiry is impossible for anyone, by construction — including administrators |
| **L2 — Security & operational** | Auth events, egress logs, infra logs, agent runtime logs | 400 days hot/warm, 3 years archive | Write-once archive; deletion only via `ARCHIVIST` retention jobs, themselves logged in L1 |
| **L3 — Debug/verbose** | Verbose service logs, sampled traces | 30–90 days | None required |
| **Privacy carve-out** | Personal data inside any log tier | Per `PRIVACY` classification: pseudonymize at ingest; DSR erasure via crypto-shredding of per-subject keys (`10-security.md` §5.5), which preserves L1 structural integrity while destroying the personal content | — |

## 15. Monitoring, SLOs, paging

1. **Platform SLOs** (owned here; **[ASSUMPTION]** initial values, ratified by the first-year error-budget review):

| Service | SLO |
|---|---|
| Kernel PDP+PEP path | 99.95% availability; p99 added latency ≤ 25 ms per tool call |
| Kernel fail mode | **Fail-closed.** Kernel unavailable ⇒ agent actions queue; they do not proceed. WHY: fail-open converts every Kernel outage into an oversight outage; we accept availability pain to keep the guarantee absolute |
| Event backbone | 99.95% publish availability; `platform.money.*` end-to-end p99 ≤ 5 s |
| Identity/token service | 99.95% |
| Knowledge system reads | 99.9% (agents degrade to cached context on miss, flagged in the trace) |
| Ledger API | 99.9%; posting is queue-backed, so backbone durability covers availability gaps |
| Cells (template default) | 99.9% customer-facing; a venture may fund a higher SLO from its own envelope, priced into `08-finance.md` unit economics |

2. **Error budgets.** Each SLO carries a quarterly budget. Budget exhaustion freezes feature rollouts for that service — `RELEASE` enforces the freeze automatically — until `INFRA-DIR` and the human platform lead approve a burn-down plan. WHY automatic: an error-budget policy that requires a meeting to enforce is a suggestion.
3. **Paging policy — what pages humans vs `SRE`:**
   - `SRE` (A3) is first responder for all platform and cell alerts within its runbook library.
   - Humans are paged **directly and in parallel** — not after `SRE` fails — for:
     - any Watchdog trip / G-00 event;
     - Kernel or Watchdog degradation;
     - audit-stream anchor mismatch;
     - `platform.money.*` DLQ items;
     - suspected security incidents (auto-handoff to the `10-security.md` §9 severity ladder);
     - any alert whose runbook remediation would itself be R3+.
   - Everything else pages a human only on `SRE` escalation or runbook exhaustion.
   - WHY this split: `SRE` remediation authority is A3 and therefore R2-bounded. Anything whose fix is R3+ needs a human in the loop from the first minute, not after an agent has tried things and narrowed the options.

---

## 16. CI/CD

Operated by `RELEASE` (A3) under `ENG-DIR`; pipeline definitions are code, reviewed like code.

1. **Trunk-based development.** Short-lived branches (≤ 72 h, deliberately matching the `W-CODE` worker lifetime), merged to trunk behind feature flags. WHY: agents generate high PR volume; long-lived branches multiply integration states beyond what review — human or agent — can hold in mind.
2. **Pipeline stages (normative order):**
   1. static checks: lint, SAST, secrets scan, IaC policy checks (§3.1);
   2. unit + contract tests (§17.1);
   3. build on hosted ephemeral builders; sign; attach provenance;
   4. integration tests in ephemeral environments;
   5. staging deploy + soak; `QA` release gate; affected `EVALUATOR` suites (§17.2) for any agent-touching change;
   6. canary: ≤ 5% traffic, or one designated canary cell for platform-wide changes;
   7. automated canary analysis against SLO and behavioral guardrail metrics;
   8. progressive rollout by cohort;
   9. on guardrail breach at any stage: automatic rollback by `RELEASE` (A3 — rollback is the pre-approved safe action) + incident filing.
3. **Human approval in-pipeline** is REQUIRED (R3 classification) for deploys touching: money paths, the Kernel or Watchdogs, the identity plane, or Constitutional policy bundles. The pipeline blocks on a named human's step-up-signed approval; it does not proceed on timeout.
4. **Provenance attestation, SLSA-style.** Every artifact — container image, policy bundle, IaC plan, **prompt/agent-card bundle** (`10-security.md` §7.2) — is built on hosted ephemeral builders and signed, with provenance recording source commit, builder identity, and dependency digests. Deploy-time admission control verifies signature + provenance; **unsigned artifacts do not run, in any tier**. Target: SLSA Build L3 for platform components. **[ASSUMPTION]** Sigstore-class tooling (cosign) remains the ecosystem standard; R2-swappable if not.
5. **Authorship and review provenance.** Agent-authored changes (the majority) carry the authoring agent's identity and task contract in commit trailers and PR metadata; the reviewing entity — human, or `QA` for changes classified R1/R2 under the matrix — is recorded in provenance. **No self-review:** author identity MUST NOT equal approver identity, enforced mechanically in the pipeline, mirroring the human separation-of-duties rule in `10-security.md` §14.3.

## 17. Testing

1. **Pyramid per service:**
   - unit tests (fast, exhaustive at the logic layer);
   - contract tests — schema-registry-verified, MANDATORY for every backbone topic and every Platform Interface surface (§2.2), because the platform/cell boundary is only as stable as its contracts;
   - integration tests in ephemeral environments;
   - a deliberately thin E2E layer (E2E suites rot fastest and localize failures worst).
   `QA` (A3) owns synthesis and maintenance; coverage and quality gates block merge.
2. **Agent-behavior regression suites — `EVALUATOR`-owned, first-class release gates:**
   - **golden-task suites** per agent card: fixed scenarios with expected action classes and tolerances;
   - **envelope-compliance suites**: verify the agent *requests conversion to A1* when hitting limits rather than probing alternate paths (probing is a `10-security.md` §8.2 signal even in tests);
   - **adversarial suites**: a curated prompt-injection and poisoning corpus per `10-security.md` §11, permanently growing via `RED-CELL` findings (`10-security.md` §13.1);
   - **calibration tracking**: stated-confidence vs. outcome scoring feeding Part VII consensus weights.
   Any change to a model version, prompt, agent card, or policy bundle MUST pass the affected suites before rollout; regressions block per `EVOLVE`'s protocol in `12-self-evolution.md`.
3. **Synthetic environments before prod.** New or modified agents run in sandbox against synthetic venture environments:
   - seeded fake markets and replayed historical event-log traffic (shadow mode, Appendix A);
   - **simulated counterparties**: a synthetic banking API, a synthetic ad platform with modeled response curves and spend, synthetic customer personas (cooperative, confused, abusive, and adversarial-injection variants) for `SUPPORT`/`OUTBOUND`/`CUST-DISC` testing.
   - Graduation to staging requires meeting the agent card's evaluation metrics in synthetic; graduation to prod follows the Part XII rollout protocol (shadow → canary cohort → fleet).
   - WHY synthetic counterparties: an agent must be tested against an environment that pushes back — including injected adversarial content — while no R2+ surface exists at all. This is the only place A-ceiling behavior can be tested to destruction.

## 18. Secrets

1. **Central manager, dynamic by default.** One secrets manager (**[DECISION]** build-phase: HashiCorp Vault — dynamic-secrets engine breadth is decisive; provisional, but R3-swappable rather than R2 given its position under the Kernel). Rules:
   - all third-party credentials are dynamic and short-lived wherever the provider allows (DB creds, cloud creds, brokered OAuth);
   - static third-party secrets that cannot be dynamic get a named owner, a rotation SLA per `10-security.md` §6.2, and automated rotation;
   - secret access is workload-identity-gated and fully audited into L1/L2.
2. **No secrets in agent context windows — ever (binding).** Agents never see, hold, or transmit secret material.
   - The tool-call proxy (§9.1) injects credentials server-side after policy approval: the agent requests *"call the Stripe API, operation X"*; the proxy attaches the credential; the response is scrubbed of any echoed secret material before returning to the agent.
   - WHY: an agent's context window is the single most exposed surface in EvolveOS — it ingests untrusted web and customer content daily, and prompt injection is a demonstrated, near-zero-cost exfiltration channel (`10-security.md` §2, threat T2). A secret that enters a context window must be presumed exfiltratable; therefore none may enter.
   - Enforcement: secret-pattern detectors run on all proxy responses and on every agent output path (`10-security.md` §11.4). This rule is a Kernel enforcement rule and therefore **G-16**-protected.
3. **Scoping:** secrets scopes mirror the account structure. Per-cell scopes transfer with the venture at exit — with mandatory rotate-on-transfer — and platform scopes never mount into cells.

## 19. Backups

**[ASSUMPTION]** RPO/RTO tiers below are initial calibrations, ratified or adjusted by the first annual game day (§20).

| Data class | RPO | RTO | Method |
|---|---|---|---|
| Ledger + Kernel audit (L1) | ~0 (dual-region synchronous-ack replication of log segments + anchors) | 4 h | Log replay + anchored snapshots |
| Platform OLTP (contracts, directory, gate queue) | 5 min | 4 h | PITR + cross-region snapshot copy |
| Knowledge graph + portfolio vectors | 1 h | 12 h | Snapshots + event-log rebuild path (Part VI ingestion is replayable by design) |
| Cell OLTP (prod) | 5 min | 8 h | PITR per cell; snapshots copied cross-region into `platform-backup`, **outside the cell's IAM boundary** |
| Object storage | Versioning + cross-region replication | 24 h | — |
| Warehouse | 24 h | 72 h | Rebuildable from sources; the low tier is deliberate — don't gold-plate derived data |
| Sandbox | None | None | Wiped weekly by design |

Binding rules:

1. Backups are encrypted under keys from the dedicated backup branch of the key hierarchy (`10-security.md` §6.1) — disjoint from primary-data keys, so one compromised branch never yields both live data and backups.
2. Backup destinations (`platform-backup`) accept writes from source accounts but grant them no delete/modify rights; destruction requires break-glass in `platform-backup` itself. WHY: backup destruction is the ransomware playbook's first move.
3. **Restore-tested, or fictional:** every backup class has a monthly automated restore verification run by `SRE` (restore to an isolated environment, integrity checks, timing measurement against RTO). An untested backup is treated as no backup; a failed verification is a Sev-3 with a fix SLA.

## 20. Disaster recovery

1. **Platform: pilot-light cross-region.**
   - The second region carries: continuously replicated L1 data, replicated snapshots per §19, and pre-provisioned but scaled-to-zero IaC for the Kernel, identity plane, backbone, and ledger.
   - Regional failover is a **human-declared** event (R3; named platform lead through `INFRA-DIR`'s human chain), target platform-core RTO 24 h.
   - WHY pilot-light and not active-active: the Kernel's fail-closed stance (§15.1) makes a platform outage *safe by default* — agents stop; nothing unsupervised happens; ventures' cells keep serving customers independently. We therefore buy cheap recovery rather than expensive continuity, and spend the savings on the agent layer.
2. **Cells: restore-from-backup.**
   - Cell templates are region-portable IaC; DR for a cell = re-provision + restore (RTO 8–24 h per §19).
   - Ventures with contractual availability needs above this MAY fund warm standby from their own envelope — priced into their unit economics per `08-finance.md`, never silently subsidized by the platform.
3. **Annual game days (binding).** At least annually:
   - full platform regional-failover exercise;
   - restore-from-zero of one randomly selected production cell;
   - one **cell exit drill** (§2.1): sever the Platform Interface and prove the cell runs standalone — this rehearses G-14 readiness, not just DR;
   - one **continuity-of-control drill**: operate the minimum manual set with the agent layer stopped, per `10-security.md` §12.2.
   - Findings feed the risk register in `13-failure-analysis.md` and, where they reveal enforcement gaps, the G-16 track.

## 21. High availability

1. All platform services and cell templates: **multi-AZ (≥ 3 AZs)**, with zero single-AZ dependencies verified by IaC policy checks (§3.1) — not by hope.
2. Kernel PDP/PEPs, token service, and Watchdogs run ≥ 3 instances across AZs; the Watchdog heartbeat lattice (§9.2) spans AZs so an AZ loss cannot silence monitoring.
3. Stateful platform services use synchronous multi-AZ replication (Postgres) or quorum replication (Kafka ISR ≥ 2).
4. **[ASSUMPTION]** Availability targets are the SLO table in §15.1. They are targets for error-budget management, not contractual promises — except where a venture signs customer SLAs, which is a venture-envelope decision priced per `08-finance.md`.

## 22. Scalability

### 22.1 The scale unit is the cell

1. Venture growth scales *within* its cell — its own autoscaling groups, its own DB scaling — and never contends with other ventures except at the five Platform Interface surfaces.
2. Adding ventures scales *horizontally* by stamping cells from the template.
3. Cell provisioning by `INFRA-DIR` MUST be fully automated: template instantiation ≤ 4 h from G-05 clearance, with no human infrastructure work in the loop. Humans approve the gate; nobody hand-applies the Terraform.

### 22.2 The 100-venture design point

The platform is sized and load-tested for **100 concurrent active ventures**. **[ASSUMPTION]** This is the ~10-year roadmap ceiling per `14-implementation-roadmap.md`, re-ratified with each roadmap revision. Derived planning envelope — **[ASSUMPTION]** planning numbers, not measurements:

| Dimension | Design point | Headroom rule |
|---|---|---|
| Concurrent agent instances | 2,000–5,000 (T4-dominated) | quarterly load test at 2× current portfolio |
| Kernel PDP decisions | 5–10k/s sustained | 10× burst headroom (agent work is bursty by nature) |
| Backbone throughput | ~50k events/s sustained | partition scaling plan documented |
| Directory identities | ~10⁴ live, ~10⁶ historical instances | — |
| Gate queue human throughput | see below | — |

Watched bottlenecks, each with a named mitigation path owned by `INFRA-DIR`:

1. **PDP latency** under policy-volume growth → policy-bundle partitioning by venture scope; per-PEP decision caching with ≤ 5 s revocation staleness bound (never cached: money, R3+, stripped-provenance decisions).
2. **Knowledge-graph write contention** → mitigation architecture owned by Part VI; Part IX provides the hosting headroom.
3. **Gate-queue human throughput — the governance bottleneck.** If weekly A2 batch review (Appendix C mechanics rule 4) exceeds human reviewer capacity, the remedy is more delegated human reviewers per `11-governance.md` — **never looser gates, never higher agent ceilings**. Scalability pressure is not a permitted argument at G-16. WHY stated here: capacity planning is exactly where that argument will first be made, so the refusal is pre-registered where the pressure will appear.

### 22.3 AI inference cost and capacity — owned by `AI-DIR`

1. **Model routing.** A routing layer — Kernel-adjacent but strictly a cost/capability optimizer, **not** an enforcement component — maps each task class to a model tier per the agent card's stated requirements:
   - frontier models: T1/T2 judgment, R3+ analysis, DR evidence synthesis;
   - mid-tier models: T3 routine work;
   - small/fast models: T4 bulk tasks, classification, extraction.
   Routing tables are `AI-DIR`-owned configuration, benchmarked continuously by `EVALUATOR`; a routing change that degrades any safety-relevant eval is auto-reverted by the same guardrail machinery as §16.2 step 9.
2. **Multi-vendor from day 1** for inference — unlike infrastructure hosting (§4): ≥ 2 qualified providers per tier, contract terms tracked by `VENDOR`, provider-failover runbooks tested quarterly. WHY the asymmetry with §4: model quality and price shift monthly, provider capacity crunches correlate, and switching cost at the API layer stays low only if it is never allowed to grow — whereas cloud switching cost is inherently high and buys little when hedged by the exit plan.

> **Revision (XV-6):** For every agent class serving T1/T2 agents, and for `EVALUATOR`, `RISK-QUANT`, and `RED-CELL`, a second qualified vendor MUST hold a current golden-suite pass (warm, re-validated at every suite version change), and quarterly failover drills MUST execute an actual routing cutover for a sampled subset of these classes, with results reported to the TSC (a failed drill is a Sev-3 with fix SLA). The RISK-AI-02 heterogeneity mitigation is upgraded to MUST: `EVALUATOR` judging and `RISK-QUANT` verification run on a different base model than the dominant doing-model unless the TSC grants a documented, annually-renewed waiver. See Part XV (`15-critique-and-revisions.md`) §4.
3. **Cost controls:**
   - prompt/context caching wherever supported (agent cards are cache-stable by design: static preamble, volatile context appended);
   - batch-tier submission for all non-latency-sensitive work — `SCOUT` scans, `EVALUATOR` suites, embedding jobs — with a target of ≥ 40% of total tokens on batch pricing **[ASSUMPTION]**;
   - **per-agent-class token budgets as envelope dimensions**: an agent that exhausts its token budget converts to A1 like any other envelope breach. Cognition is metered like money, because it is money;
   - portfolio inference spend reported through `08-finance.md` with per-venture attribution via capability-token tagging — AI cost is part of every venture's honest unit economics (§1.4).
4. **[UNCERTAIN]** Self-hosted inference (open-weight models on owned accelerators) may become economic for T4 bulk classes; `AI-DIR` re-evaluates semi-annually with a build-vs-buy DR. Any fine-tuned weights EvolveOS produces are supply-chain artifacts under `10-security.md` §7.2 — hashed, signed, provenance-recorded.

---

## 23. Build vs buy

| Layer | Verdict | Justification |
|---|---|---|
| Kernel (PDP/PEP composition, envelope accountant, capability tokens, audit anchoring) | **BUILD** (on OPA, Envoy-class proxy, SPIRE as components) | This is EvolveOS's constitutional enforcement — no product implements envelope accounting over agent tool calls with gate-conversion semantics. Buy the pieces; build the composition |
| Watchdogs | **BUILD** | Small and simple by design (§9.2); the independence requirements rule out shared tooling, and the code must be small enough for exhaustive human review |
| Agent runtime / orchestration | **BUILD**, borrowing open-source components where convenient | Task contracts, envelope attenuation, and lifecycle rules (Part IV) are proprietary semantics; today's agent frameworks churn too fast to be foundations. **[UNCERTAIN]** Revisit as the ecosystem matures — adopt, don't fight, a genuine standard if one emerges |
| Workload identity | **ADOPT** (SPIFFE/SPIRE) | Standard, audited, portable across clouds and into sold cells |
| Policy engine | **ADOPT** (OPA) | §8.2; building a policy language is a decade-long mistake with no differentiation |
| Secrets management | **BUY** (Vault) | §18.1; dynamic-secrets engine breadth is the decisive feature |
| Event backbone / queues | **BUY** managed (MSK/SQS) | Commodity; exit-plan substitutes named in §4.2 |
| Databases (Postgres, graph, vector, warehouse) | **BUY** managed | Commodity substrate; Part VI owns knowledge-layer specifics |
| Observability | **ADOPT** standard (OTel) + self-host backend | The standard is the commitment; the backend is swappable because ingestion is OTLP everywhere |
| CI/CD + provenance | **BUY** hosted CI + **ADOPT** Sigstore-class signing | Commodity with strong ecosystems; the provenance *policy* (what may run where) is ours |
| SIEM / detection | **BUY** the platform, **BUILD** agent-behavioral analytics on the audit stream | No commercial SIEM understands envelope semantics or agent baselines (`10-security.md` §8.2); commodity log correlation is a solved purchase |
| Ledger | **BUILD** core (per `08-finance.md`) on Postgres + backbone; **BUY** statutory-accounting integrations | The ledger's event-sourced integration with envelopes and gates is proprietary; statutory outputs flow to bought accounting software |
| Fraud detection | **BUY** payment-processor tooling per venture + **BUILD** `FRAUD-WATCH` cross-venture correlation | Processor tools see one venture; the portfolio-level pattern is exactly the gap (`10-security.md` §10.1) |
| Human IdP / SSO | **BUY** (Okta, provisional) | Commodity; the deep integration is with our directory, not the IdP |
| Model inference | **BUY** multi-vendor (§22.3) | Frontier capability is not buildable in-house at this scale; optionality is the control we own |

The recurring pattern, stated once: **buy commodity substrate; build everything that encodes the Constitution.** Any proposal to buy a product that would sit *inside* the enforcement path (Kernel, Watchdogs) MUST be treated as a G-16 matter — vendor lock-in on enforcement is a governance risk, not a procurement decision.

---

## 24. Security integration points (index into `10-security.md`)

Stated here for architectural completeness; normative depth is Part X's:

| Integration point (this part) | Normative home |
|---|---|
| Identity plane, attribution chain (§6) | `10-security.md` §3 |
| Zero-trust posture, microsegmentation (§5, §8) | `10-security.md` §4 |
| Encryption and key hierarchy for every store (§11, §19) | `10-security.md` §5–§6 |
| Supply-chain requirements consumed by CI/CD (§16.4) | `10-security.md` §7 |
| Detection feeds: audit stream, egress logs, envelope meters (§9, §5.3) | `10-security.md` §8 |
| Incident-response hooks on paging (§15.3) | `10-security.md` §9 |
| Agent-specific controls enforced at PEPs: provenance modes, output filtering, quarantine flags (§8.1, §9.1) | `10-security.md` §11 |
| Break-glass and separation of duties (§3.2 guardrails, §16.5) | `10-security.md` §14 |
| Cell SDLC baseline, pre-launch pen test at G-06 (§16, §17) | `10-security.md` §15 |
| Continuity of control, degraded-mode ladder (§15.1, §20.3) | `10-security.md` §12 |
