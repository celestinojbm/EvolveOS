# EvolveOS Specification — Part X: Security

**Status:** Draft v0.1 · **Change class:** R4 via G-16 (Constitutional Layer)

**Scope.** This part is the security constitution of EvolveOS. It defines the threat model and the binding controls for identity, zero trust, cryptography, key management, supply chain, threat detection, incident response, fraud, business continuity, adversarial testing (red/blue), internal and external security, and — as a first-class discipline this decade created the need for — **agent-specific security controls**.

Mechanical implementation of many controls lives in `09-technology.md` (the Kernel, Watchdogs, identity plane, egress gateways, secrets injection). This part states *what MUST be true and why*; Part IX states *how it is built*. Where the two conflict, this part prevails, because it is Constitutional Layer (`00-overview.md` §4) and Part IX is not.

**Amendment.** Every normative change to this part is R4 and passes gate **G-16** (TSC quorum ≥ 3 humans + CEO sign-off, with a red-team review attached). WHY constitutional: the security layer constrains the agents; if the agents — including `EVOLVE` — could amend it through the ordinary R2/R3 process that they themselves operate, the constraint would be self-revoking, and the human-oversight guarantee of `00-overview.md` §6 would be circular.

**Human command.** Security is commanded by the **CISO** (human officer, `11-governance.md`). `SEC-DIR` (autonomy ceiling A3, defense only) is the CISO's operational agent; `RED-CELL`, `BLUE-CELL`, `FRAUD-WATCH`, and `PRIVACY` execute under the security and compliance chains per `appendix-b-agent-registry.md`. No security agent may operate above its registered ceiling regardless of incident pressure — incidents raise urgency, never autonomy. That rule is itself G-16-protected.

---

## 1. Security objectives, in priority order

The ordering is binding: when controls trade off, the higher objective wins.

1. **Preserve human control.** No attacker, insider, or agent may act outside the Constitution: the autonomy–reversibility matrix (`00-overview.md` §6) and the gates (`appendix-c-decision-gates.md`) MUST hold under attack, not merely in fair weather. This outranks confidentiality and availability. WHY first: every other loss is bounded and, in principle, insurable; loss of the control layer is the one unbounded, existential failure mode of an autonomous enterprise system (`13-failure-analysis.md`).
2. **Protect the treasury and the ledger.** Money moves only through gated, dual-controlled, fully attributed paths (§6.3). The ledger's integrity is protected as strictly as the money itself, because a corrupted book of record hides theft.
3. **Protect customer and venture data.** Confidentiality and integrity per data classification (§5); customer-data incidents are R4 (§9.3).
4. **Preserve the audit record.** The tamper-evident history (`09-technology.md` §9.1, §14) is what makes post-hoc oversight (A2/A3) legitimate. Its destruction retroactively converts supervised autonomy into unsupervised autonomy — so audit integrity is a control objective, not a logging detail.
5. **Availability — last.** The system fails closed (`09-technology.md` §15.1): in doubt, EvolveOS stops. A stopped portfolio loses money; a runaway one loses the mandate to exist. We would rather explain an outage than an unauthorized action.

## 2. Threat model

Ranked by **expected annual loss** (likelihood × impact, at the ~$10M-capital calibration of `00-overview.md` §5). **[ASSUMPTION]** Rankings are founding estimates, re-ranked annually by `RISK-DIR` with `RISK-QUANT` quantification into the `13-failure-analysis.md` register. Crucially, the control sets below are designed to hold **even if the ranking is wrong**, because ranking errors are certain over a decade; ranking drives investment emphasis, not the existence of controls.

| # | Threat | Actors & vectors | Expected-loss rationale |
|---|---|---|---|
| **T2** *(rank 1)* | **Prompt injection & data poisoning against agents** | Anyone who can author content an agent reads: web pages `SCOUT`/`DEEP-RES`/`TRENDS` crawl; customer emails and tickets into `SUPPORT`; vendor documents into `CONTRACTS`/`VENDOR`; inbound replies to `OUTBOUND`; poisoned reviews, forums, and repos; knowledge poisoning aimed at `06-knowledge-system.md` ingestion | Ranked first because exposure is **continuous and structural**: untrusted content flows into agent contexts thousands of times daily *by design*. Attack cost is near zero, capability is improving faster than defenses, and a single success can chain into tool misuse, data exfiltration, or envelope-sanctioned spend. A novel class with no mature industry playbook — we write our own (§11) |
| **T1** *(rank 2)* | **External attackers, financially motivated** | Credential phishing of gate-approving humans; cloud account takeover; ransomware on data and backups; BEC-style fraud aimed at treasury paths; API/abuse attacks on venture products | Classic, well-resourced adversaries against a concentrated prize: the portfolio treasury plus 100 ventures' data. Well-understood, so bounded by mature controls (§3–§6, §14), but high impact per successful event |
| **T4** *(rank 3)* | **Rogue or compromised agent behavior** | Misalignment / goal-drift; model or prompt regressions; envelope-escape attempts (limit probing, gate shopping, laundering scope through T4 workers); an agent compromised via T2 then acting as an insider | Likelihood moderate given defense-in-depth (Kernel, matrix, Watchdogs), but impact potentially severe and — uniquely — **correlated**: one bad model/prompt version can deploy to many instances at once. Distinct from T2: T2 is a vector, T4 is a failure *class* that also arises with no attacker at all |
| **T6** *(rank 4)* | **Fraud against ventures** | Payment fraud, refund/chargeback abuse, promo/bonus abuse, customer-account takeover, and fake-customer poisoning of validation evidence (corrupting G-03/G-05 inputs) | High frequency, low-to-mid severity per event, scaling with venture count. Also an *epistemic* threat: fraudulent signal corrupts the evidence packs of `07-decision-engine.md`, so it costs both money and decision quality |
| **T3** *(rank 5)* | **Insider (human) misuse** | Privileged-operator abuse, gate-approver collusion, data theft by departing staff | A small headcount limits the actor pool but concentrates privilege. Mitigated by separation of duties (§14.3) and by the structural fact that most operational power in EvolveOS is held by *agents under Kernel audit*, not by humans with shells |
| **T5** *(rank 6)* | **Supply chain** | Malicious dependency or build compromise; poisoned base images; compromised model weights; **tampered prompt templates or agent cards**; compromised SaaS vendors | Low frequency, extreme tail impact: arbitrary code or arbitrary *behavior* inside the trust boundary. Prompts and agent definitions are supply-chain artifacts with no industry precedent — treated here with code-grade rigor (§7) |

**Design consequence (binding framing).** T2 and T4 together mean the real security perimeter is not the network — it is **the boundary between agent cognition and agent authority**. Three corollaries flow from this and shape the whole part:

- The boundary is the Kernel, which is why the Kernel is enforcement infrastructure with **no model in any enforcement path** (`09-technology.md` §9): the thing that decides whether a captured mind may act cannot itself be a mind.
- We assume the model *will* be fooled. Controls are designed so that being fooled is *insufficient* to cause harm (§11.2 privilege stripping is the archetype), rather than betting on the model never being fooled.
- Agent-specific security (§11) is a first-class discipline here, not a footnote to application security, because no existing security literature defends this perimeter — it did not exist before autonomous agents held real authority.

## 3. Identity: one plane, total attribution

1. **Single identity plane.** Humans and agents share one directory and one identity fabric (`09-technology.md` §6). There MUST NOT exist an actor category outside it: no shared accounts, no anonymous service identities, no "system" or "automation" user that actions hide behind. Every credential maps to exactly one human or one agent instance.
2. **The attribution chain (binding).** Every agent action MUST be attributable, **from the audit record alone**, to the tuple:

   **agent instance** (SPIFFE ID including instance UUID) **+ agent-card version + task contract + originating human authority**

   where "originating human authority" is the delegation chain terminating at a human grant: a gate approval (a `G-xx` + `DR-<yyyy>-<seq>`), a standing envelope ratified at a gate, or a direct human directive. An action whose authority chain cannot be resolved is a Kernel deny by construction (deny-by-default, `09-technology.md` §8). WHY: *"the AI did it"* must never be a terminal answer. Accountability requires that every act trace to the human decision that authorized its class — otherwise oversight is theatre.
3. **Instance-level revocability.** Because identity is per-instance, revocation is surgical: one compromised `SUPPORT@V-2027-004` instance can be killed (§11.6) without stopping the agent class or the venture. This granularity is what makes quarantine a scalpel rather than a sledgehammer.
4. **Human authentication for authority.** SSO + FIDO2 for any human who can approve gates, touch prod, or authorize spend (`09-technology.md` §6.2). Gate approvals MUST be signed under step-up authentication: a live session cookie is not an approval, because a hijacked session must not be able to clear a gate.

## 4. Zero trust

1. **No network-location trust.** Presence inside a VPC, a cell, or the platform confers zero authorization. Every request — service-to-service, agent-to-tool, human-to-console — is authenticated (mTLS/SVID or SSO) and authorized per-request by the Kernel PDP against policy, envelope state, and live flags. There are no flat "trusted zones" and no allow-by-source-CIDR rules in any policy bundle; the IaC policy checks (`09-technology.md` §3.1) reject them.
2. **Microsegmentation per cell.** The cell is the macro-segment (`09-technology.md` §2, §5). Within cells and the platform, workload-to-workload communication requires an explicit, SPIFFE-identity-based policy edge, deny-by-default. The reachable graph is therefore declared, versioned, and diffable; `BLUE-CELL` alerts on any runtime flow absent from the declared graph (§8.3).
3. **Agents are untrusted by default — more untrusted than services.** A conventional service runs fixed code; an agent's behavior is model-conditioned on partially untrusted input (T2). Therefore agent runtime nodes get the **narrowest** network posture in the entire system: no route anywhere except Kernel PEPs (`09-technology.md` §9.1). Zero trust for agents means three things, not two: authenticate the instance, authorize the call, **and independently sanity-check the behavior** against baselines (§8.2).
4. **Human production access** follows the same PDP path and is additionally constrained by §14.2 (break-glass only). No human bypasses the PDP for a production-affecting action; the console is not a side door.

## 5. Encryption and data classification

1. **Data classes (canonical).** All data is classified at creation:
   - **C0 — public**: published marketing, open data.
   - **C1 — internal**: routine operational data, non-sensitive logs.
   - **C2 — confidential**: venture business data, non-public strategy, DRs, financial models.
   - **C3 — sensitive**: customer personal data, credential-adjacent material, prompts containing C2 aggregates, security detections.
   - **C4 — critical**: treasury/banking data, key-material references, audit-log integrity artifacts, IaC state, Constitutional policy state.

   Classification is a MANDATORY field on knowledge items (`06-knowledge-system.md`), backbone message schemas, and database schemas (`09-technology.md` §11); unclassified data fails ingestion/migration. `PRIVACY` audits classification correctness. Capability tokens carry a **data-class ceiling** (`09-technology.md` §8.1), so an agent card's ceiling is Kernel-enforced on every read — an agent cannot read above its clearance even if a query would return it.
2. **In transit.** TLS 1.3, or internal mTLS via SVIDs, on every connection **including intra-VPC**. Plaintext listeners are a build-breaking IaC-policy violation. WHY intra-VPC too: zero trust (§4.1) means the network is never a trust boundary, so it is never an exemption from encryption — "it's on the internal network" is not a security property in this system.
3. **At rest.** Every store encrypted under the §6 key hierarchy. This is table stakes: it defends against media theft and snapshot exfiltration, **not** against an authorized-but-malicious reader — which is the job of field-level encryption (rule 4) and the Kernel data-access PEP. Stating the limit matters, because "everything is encrypted at rest" is routinely misread as "everything is safe."
4. **Field-level encryption for C3/C4.** Sensitive fields (customer PII, bank account details, API-credential references) are encrypted at the application layer under purpose-scoped data keys, so that a bulk compromise — SQL injection in a venture product, a stolen snapshot, an over-broad warehouse query — yields ciphertext, not records. C3 fields leaving a cell for the warehouse are tokenized or crypto-digested (`09-technology.md` §11, §13.5); re-identification requires a Kernel-mediated detokenization call, itself logged and policy-checked and G-18-relevant.
5. **Crypto-shredding implements erasure.** DSR deletion (via `PRIVACY`) and venture data disposition at **G-15** are executed by destroying the per-subject or per-scope data key, rendering ciphertext permanently unrecoverable **while preserving L1 audit-log structural integrity** (`09-technology.md` §14). WHY crypto-shred rather than row-delete: it satisfies erasure obligations without the ability to tamper with append-only constitutional records — the two requirements are otherwise in direct conflict.

## 6. Key management

1. **Hierarchy (envelope encryption).**
   - **Root keys**: HSM-backed (cloud HSM, FIPS 140-2 Level 3 **[ASSUMPTION]** sufficient for the build phase; GC and `COMPL-DIR` confirm per-jurisdiction obligations as G-11 expansions occur), non-exportable, used only to wrap KEKs.
   - **Domain KEKs**: one branch per domain — platform, each cell, backup, audit-anchoring — each cryptographically independent, so compromise or rotation in one domain never touches another. The **backup branch is deliberately disjoint** from the primary branch (`09-technology.md` §19), so stealing live-data keys does not also unlock backups.
   - **Data keys**: wrapped by KEKs, unwrapped only in memory, per-object or per-field for C3/C4.
2. **Rotation SLAs (binding).**
   - Root keys: ≤ 3 years, or immediately on suspicion.
   - KEKs: ≤ 1 year.
   - Data keys: per-object at write (no rotation needed), or ≤ 90 days for long-lived streams.
   - TLS certs / SVIDs: ≤ 1 h, automated (`09-technology.md` §6.1).
   - Third-party static secrets that cannot be made dynamic: ≤ 90 days, named owner, automated rotation via the secrets manager, with overdue-rotation alerts escalating to `SEC-DIR` and then the CISO at 2× SLA.
3. **Treasury keys — split knowledge and hardware co-sign (binding).** Keys and credentials capable of moving portfolio or venture funds are held under **split knowledge**: no single human, and **no agent ever**, holds complete material. Binding flow:
   1. `TREASURER` (ceiling A1; movements are R3+ per `appendix-b-agent-registry.md`) *prepares* a movement — amount, counterparty, rationale, DR reference — but executes nothing.
   2. The Kernel validates envelope and gate authority: R4 movements (capital deployment > $1M) require their owning gate per `appendix-c-decision-gates.md` (e.g., G-07/G-08 resolutions); the `TREASURER` A1 ceiling means a named human always approves the execution.
   3. A named human approver authorizes with a **hardware security key co-signature** (FIDO2 / transaction-signing over the movement digest).
   4. For movements above the dual-control threshold (owned by `appendix-c-decision-gates.md` / `08-finance.md`), **two humans from disjoint role sets** co-sign.
   The banking-rail credentials themselves live server-side behind the tool-call proxy (`09-technology.md` §18.2); the human signs the *transaction digest*, never a login. WHY this shape: theft of funds must require *simultaneously* compromising the Kernel path AND a human's hardware key AND (above threshold) a second, role-disjoint human — three independent factors across two species of actor. The separation-of-duties corollary is §14.3.
4. **Key ceremonies.** Root generation, KEK-branch creation, and recovery-material handling are documented, dual-controlled, recorded events. Recovery material is sharded (Shamir *k*-of-*n*, **[ASSUMPTION]** 3-of-5 among named officers) across geographically separate safes, so no single site loss and no single officer is either a single point of failure or a single point of compromise.

## 7. Supply chain security

EvolveOS has **two supply-chain lanes**: the classical software lane, and the **cognitive lane** — model weights, prompt templates, agent cards, policy bundles, and eval suites. A tampered prompt is a tampered program. The cognitive lane therefore gets code-grade controls, not documentation-grade ones. This is a genuinely novel requirement and it is treated as binding.

1. **Software lane.**
   - All dependencies version-pinned with lockfiles and hash verification; no floating tags, no `latest`, anywhere.
   - SBOM generated per artifact at build; continuous CVE matching with remediation SLAs (critical: patch or mitigate ≤ 72 h; high: ≤ 14 days — **[ASSUMPTION]**, tuned by `SEC-DIR` from experience).
   - Provenance attestation SLSA-style with signature-verified admission (`09-technology.md` §16.4): unsigned artifacts do not run in any tier.
   - Base images come from a curated internal registry only.
   - Third-party SaaS vendors are risk-tiered by `VENDOR`; any C3+ data flow to a vendor requires G-18 where personal data is involved, plus a documented processing agreement (GC).
2. **Cognitive lane (binding).**
   - **Prompt templates and agent cards are registry artifacts**: versioned in git, reviewed (human review REQUIRED for T1/T2 agent cards and any card touching R3+ tool classes; `PROMPT-SMITH` proposals flow through `EVOLVE`'s Part XII protocol), built into signed bundles, and admission-checked at agent-instance start. An instance whose card/prompt bundle signature fails to verify MUST NOT start; a running instance whose bundle is revoked is quarantined (§11.6).
   - **Model weights and endpoints**: vendor-hosted models are pinned to exact versions in `AI-DIR`'s routing tables (`09-technology.md` §22.3). Silent upstream drift is detected by `EVALUATOR` canary suites on a fixed cadence against pinned expectations. Any self-hosted or fine-tuned weights are content-hashed, signed at training completion with recorded data-and-training provenance, and admission-verified at load.
   - **Eval suites are themselves protected artifacts.** Whoever can weaken the evals can smuggle behavior past the gates of `12-self-evolution.md`. Therefore eval-suite changes require review independent of the change they gate, and **no evolution proposal may modify both an agent and the suite that judges it in one proposal** (mirrored in `09-technology.md` §17.2). This closes the "grade your own homework" loophole at the artifact level.
3. **Registry signing.** One signing infrastructure (Sigstore-class, `09-technology.md` §16.4) covers both lanes. Signing identities are workload identities of the CI system, never humans' personal keys. Verification roots are C4 data (§5.1), protected accordingly.

## 8. Threat detection

1. **Division of labor — deliberate redundancy.** The **Watchdogs** (enforcement infrastructure, `09-technology.md` §9.2) are the constitutional trip wire: simple, independent, few rules, empowered to trip G-00. **`BLUE-CELL`** (A3) is the analytical detector: rich correlation, hypothesis-driven hunting, detection engineering. They overlap on purpose — `BLUE-CELL` is smarter and more expressive; the Watchdogs are harder to fool because there is no model in them to inject. A defense that relies on the clever component alone fails to the clever attack; a defense that relies on the dumb component alone misses the subtle one. We keep both.
2. **Behavioral baselines for agents (binding, novel).** For every agent class and every live instance, detection maintains baselines over:
   - **tool-call patterns**: distribution of tools invoked, call-sequence n-grams, per-contract call counts;
   - **spend velocity**: envelope burn rate vs. the class's history;
   - **data-access patterns**: classes read, volumes, novel-table access, cross-venture read *attempts*;
   - **egress**: destinations and volumes vs. allowlist norms;
   - **token consumption** profiles (`09-technology.md` §22.3);
   - **denial and queue rates**: an agent accumulating policy denials is probing its envelope — a T4 signal.

   Material deviation triggers a **graduated response**: alert → automatic envelope tightening (a pre-approved A3 containment — rate limits halved, spend frozen at current burn) → quarantine (§11.6) → Watchdog G-00 for scope-level anomalies. WHY baselines rather than signatures: T2/T4 attacks have no established signatures, and by the time they do, the next variant won't match. The defensible invariant is that a compromised agent must *behave differently* to be worth compromising — so we detect the difference, not the payload.
3. **SIEM correlation.** All L1/L2 sources (`09-technology.md` §14) — Kernel audit stream, egress logs, identity events, cloud control-plane logs, cell application security events, canary-token trips (§11.5) — flow to the SIEM (bought platform + built agent-behavior analytics, `09-technology.md` §23). Correlation rules are **detection-as-code**: versioned, tested against replayed incident traces, and purple-team-validated (§13.2).
4. **Coverage obligations (binding).** Detections MUST exist for every attack path enumerated in this part's threat model and every `RISK-*` entry in `13-failure-analysis.md` tagged detectable. `RED-CELL` findings that evaded detection automatically open detection-engineering work items with SLAs (§13.2). A control that is neither monitored nor attacked is presumed broken (§16).

## 9. Incident response

1. **Severity ladder.**

| Sev | Definition | Examples | Command |
|---|---|---|---|
| **Sev-1** | Constitutional or existential: control-layer compromise, audit-integrity failure, active treasury attack, portfolio-scale outage, or a silent Watchdog layer | Suspected Kernel bypass; audit anchor mismatch; unauthorized funds movement; Watchdog heartbeat lattice dark | **CISO** is incident commander; `SEC-DIR` executes; CEO and relevant committees informed ≤ 1 h; G-00 authority presumed already exercised |
| **Sev-2** | Major: single-cell compromise, suspected customer-data breach, an agent quarantine with unclear blast radius, an active fraud ring | Venture-DB exfiltration attempt; a compromised `SUPPORT` instance sent attacker-crafted content externally | `SEC-DIR` commands under CISO delegation; human on-call security lead engaged from minute one |
| **Sev-3** | Contained: single-instance anomaly, a failed attack worth forensics, a policy violation without loss | Canary token tripped, instance quarantined; injection attempt caught by the output filter | `BLUE-CELL` handles per playbook (A3); human review in the daily batch |
| **Sev-4** | Hygiene: scanner findings, expired-SLA rotations, low-risk misconfigurations | — | Ticketed to owners with SLAs |

2. **G-00 in incidents.** Any authorized human, any Watchdog, or `PRIME` may invoke G-00 at any scope. During Sev-1/Sev-2 the presumption is **stop first, investigate second**. The stop asymmetry of `appendix-c-decision-gates.md` (one human stops; restart requires the owning gate's full approver set) exists precisely so that no responder ever hesitates to pull the cord for fear of the restart cost.
3. **Customer-data incidents are R4 (binding).** Any incident *plausibly* affecting customer data is classified R4 (`00-overview.md` §5) immediately upon **suspicion**, not upon confirmation. Consequences:
   - General Counsel joins incident command;
   - external notification decisions, regulator communications, and customer messaging are human-only — G-17 for public communications, GC for regulatory — on GC-tracked legal clocks;
   - `PRIVACY` runs the data-protection impact assessment;
   - **no agent communicates externally about the incident, at all** — the risk of a captured or confused agent making a legally binding or reputationally catastrophic statement mid-incident is unacceptable.
4. **Agent containment authority.** `BLUE-CELL` (A3) may execute pre-approved playbook containment: quarantine instances (§11.6), revoke tokens, isolate a cell's egress, tighten envelopes. Containment actions that are themselves R3+ — taking a venture's production offline for a sustained period, notifying counterparties — require the human commander. This mirrors the paging split in `09-technology.md` §15.3: an agent's remediation ceiling is R2-bounded, so anything heavier is human from minute one.
5. **Post-incident (binding).** Every Sev-1/Sev-2 gets a blameless post-mortem with root-cause and control-gap analysis, recorded as **failure-memory knowledge items** per `06-knowledge-system.md` (curated by `CURATOR`, so the *portfolio* learns, not just the responders). Outputs: register updates in `13-failure-analysis.md`; detection and control work items with named owners and SLAs; and, where the incident revealed a Constitutional gap, a **G-16 proposal**. Sev-1 post-mortems are presented to the Audit & Risk Committee.

## 10. Fraud detection

1. **`FRAUD-WATCH` is portfolio-wide by design.** It consumes payment, refund, signup, and behavioral event streams from **all** ventures' cells via the backbone (`09-technology.md` §10) — because fraud rings pivot across properties, while per-venture tools (the processor-side detection ventures also use) each see only one venture. Cross-venture correlation is the platform's structural advantage and `FRAUD-WATCH`'s entire reason to exist.
2. **Asymmetric authority (binding, per `appendix-b-agent-registry.md`): holds are automatic — releases are human.** `FRAUD-WATCH` at A3 may automatically **hold** suspicious transactions, freeze suspect venture accounts, and block promo abuse — holds are reversible containment. **Releasing** a hold, refunding a disputed one, or unblocking an account is A1: a named human (the venture fraud owner or `FIN-DIR`'s human chain) approves. WHY the asymmetry: a wrong hold costs an apology and is reversible; a wrong release is unrecoverable money and, worse, trains the adversary on exactly what evades the model. Hold SLAs (human review ≤ 24 h — **[ASSUMPTION]**) bound the customer-experience cost of false positives.
3. **Epistemic fraud.** `FRAUD-WATCH` also screens *validation-stage* signals — pre-sales, signups, online-recruited interview panels — for fabrication, because poisoned traction evidence corrupts G-03/G-05 decisions. That is fraud against the decision engine itself; findings attach to the relevant evidence pack and DR so the corruption is visible where the decision is made (`07-decision-engine.md`).
4. **Reporting.** Fraud losses, hold rates, and false-positive rates report per venture into `08-finance.md` unit economics; persistent fraud-loss outliers trigger a `RISK-DIR` review of that venture's controls.

## 11. Agent-specific security controls

The novel core of this part. Every control here is Kernel-enforced (`09-technology.md` §9) and constitutionally protected: weakening any of them is a G-16 change. These controls exist because the perimeter is cognition-to-authority (§2), and nothing in conventional security literature defends that perimeter.

1. **Context provenance labeling (binding).** Every unit of content entering an agent context carries a provenance label:
   - **P0** — Constitutional / system: the agent card, policies.
   - **P1** — platform-internal, validated: knowledge items with provenance, DRs.
   - **P2** — internal, unvalidated: other agents' unreviewed output.
   - **P3** — external, semi-trusted: contracted-vendor documents, paid data feeds.
   - **P4** — external, untrusted: web content, customer messages, inbound email, scraped anything.

   Labels are structural (message-envelope metadata, Part IV), applied at ingestion boundaries (crawlers, ticket ingest, email gateways), and **immutable downstream**. Critically, **quotation does not launder provenance**: a P4 passage summarized into a P2 artifact keeps a P4 taint marker on the derived claims (mechanism per `06-knowledge-system.md` provenance rules). WHY: the classic injection escalation is "untrusted content gets summarized, and the summary is trusted" — labels that survive derivation close it.
2. **Privilege stripping on untrusted context (binding).** When P4 content (or P3, for sensitive tool classes) is present in an agent's working context, the Kernel evaluates that agent's tool calls under a **reduced envelope** (`provenance_mode: stripped`, `09-technology.md` §8.1): no new external side effects beyond the channel being serviced, no data-class reads above the task minimum, no envelope-spend commitments, no delegation that would widen scope.
   - Concretely: `SUPPORT` reading a customer ticket (P4) may draft a reply into the filtered send path and query that customer's own records — it may NOT, in the same contract, query a *different* customer, call a payments tool, or spawn a worker with broader scope.
   - Escalation out of stripped mode requires a **fresh task contract whose instructions derive only from P0–P2 content**.
   - WHY: this is the structural defense against T2. Injection may capture the model's next token, but it cannot capture authority the token path refuses to grant. We assume the model *will* be fooled and make being fooled insufficient.
3. **Tool-call allowlists per agent card.** Each agent card (`04-multi-agent-system.md`) enumerates permitted tools, per-tool argument constraints (e.g., `OUTBOUND` may email only addresses drawn from approved-ICP lists; `ADS` may set budgets only ≤ its channel envelope), and per-tool provenance requirements (which tools are callable at all with P4 present). The Kernel enforces the allowlist on every call; a tool not listed does not exist for that agent. Widening an allowlist is a change through `EVOLVE`'s process with `SEC-DIR` review; widening any card into R3-capable tool classes additionally requires the human chain per the matrix.
4. **Output filtering before external send (binding).** Every agent output leaving EvolveOS — email, chat, API responses to customers, social/PR drafts, webhook payloads — passes an egress content filter at the tool-call proxy:
   - secret/credential-pattern detection (`09-technology.md` §18.2);
   - C3+ data-class leak detection against the sender's data ceiling;
   - canary-token detection (rule 5);
   - policy screens: claims/commitments an agent may not make — pricing promises route to `PRICER`/gates, public statements route to G-17;
   - injection-payload heuristics: an output that itself smuggles instructions toward a counterpart's agent.

   A filter hit blocks the send and opens a Sev-3. The filter is **deterministic-first with a model-assisted second pass**, and — binding — **the deterministic layer alone MUST be sufficient to block secrets and canaries.** Model-assisted screening augments; it never gatekeeps alone. WHY: a filter that can itself be prompt-injected is not a filter, so the load-bearing checks for the worst leaks must be non-model code.
5. **Canary credentials and honeytokens.** Fake-but-plausible secrets, customer records, bank references, and API keys are seeded across the surfaces an attacker or a captured agent would enumerate: knowledge-store corners, cell databases, env-var-shaped locations, document stores.
   - Any *read* raises an alert.
   - Any *transmission* — caught by rule 4 filters or by external canary-token beacons — triggers automatic quarantine of the transmitting instance plus a Sev-2.
   - Placement and rotation are `BLUE-CELL` detection engineering; placements are recorded in a C4 registry so drills and legitimate audits don't self-inflict incidents.
   WHY: honeytokens convert the attacker's necessary reconnaissance into our detection signal — enumeration becomes self-defeating.
6. **Quarantine procedure for a suspected-compromised agent (binding runbook).**
   1. **Freeze.** Revoke the instance's capability tokens (propagation ≤ 5 s, `09-technology.md` §9.1) and *pause* — not kill — its runtime, preserving memory state for forensics. In-flight tool calls are cancelled or completed-then-held per tool class; money-touching calls are always held.
   2. **Contain.** Suspend its unfinished task contracts. Freeze recursively every T4 worker it spawned — attenuation means their authority derives from, and dies with, the parent's. Flag its outputs since last-known-good and, where still internal, impound them from downstream consumption (knowledge submissions reverted to unvalidated by `CURATOR`).
   3. **Investigate.** Replay its audit trail — every context input with provenance labels, every tool call, every Kernel decision — against its behavioral baseline; identify the injection/poison vector (if T2) or the defect (if T4).
   4. **Eradicate & replace.** The instance is **never** "cleaned and resumed." Spawn a clean replacement from the signed agent-card bundle (§7.2) per the Part IV lifecycle, with contaminated context excluded; where the vector was a poisoned knowledge item, quarantine that KI per `06-knowledge-system.md` validation rules.
   5. **Learn.** Post-incident per §9.5; if the vector defeated a §11 control operating as designed, that is a control-gap finding → G-16 track.
   - **Class-level trigger (binding).** ≥ 3 quarantines of one agent class within 30 days **[ASSUMPTION]** freezes the whole class pending `EVALUATOR` regression analysis: correlated compromise means the card/prompt/model version is the problem, not the individual instance, and continuing to spawn fresh instances of a flawed definition just feeds the attacker.
7. **Envelope-anomaly circuit breakers.** Beyond the hard envelope limits the Kernel enforces absolutely, *rate-of-approach* breakers trip containment early: spend acceleration ≥ N× class baseline, denial-rate spikes, novel-tool-sequence bursts, self-delegation depth beyond card norms. Breaker trips execute the §8.2 graduated response automatically (pre-approved A3 containment). Breaker thresholds are `SEC-DIR`-tuned **within G-16-ratified floors** — no agent, including `SEC-DIR` itself, can loosen a floor. WHY floors: tuning is operational, but there must be a level below which sensitivity cannot be dialed down by anything short of a constitutional change, or an attacker's first move is simply to relax the alarm.

8. **Inter-agent trust and task-contract integrity (binding).** Agents delegate to agents (Part IV task contracts); a captured agent whose output becomes another agent's instructions is a lateral-movement path unique to multi-agent systems. Controls:
   - A task contract's *instructions* field is P2 provenance at best (§11.1) — a receiving agent MUST treat delegated instructions as unvalidated internal content, never as P0/P1 authority. Authority rides in the attenuated capability token (`09-technology.md` §8.1), not in the natural-language instructions.
   - Task contracts are signed by the issuing instance's SVID and integrity-checked on receipt; a contract failing verification is dropped and alerts.
   - Attenuation is strictly downward (`09-technology.md` §8.1): a delegated contract can never grant scope the issuer lacks, so a captured agent cannot manufacture authority for its delegates — it can only pass along a subset of what it already, legitimately, held.
   - Cross-venture delegation is prohibited by the same rule that prohibits cross-cell communication (`09-technology.md` §2.1); an agent instance scoped to `V-2027-004` cannot issue a contract touching another venture, full stop.
   WHY a distinct control: conventional systems have no analogue to "one program persuades another program to misuse its own permissions in natural language." The defense is to keep persuasion (instructions) and permission (tokens) in separate, differently-trusted channels.

## 12. Business continuity and continuity of control

DR mechanics (pilot-light platform, cell restore, game days) are owned by `09-technology.md` §19–§20. This section owns the constitutional requirement those mechanics serve — and the requirement no ordinary DR plan states.

1. **Continuity of control (binding).** If the agent layer is stopped — by G-00, by platform outage, by a Sev-1, or by deliberate choice — **humans MUST be able to operate every critical function manually.** EvolveOS fails toward human operation, never toward "the agents are down, so nothing can be done." The **minimum manual-operations set**, each with a documented agent-free procedure, named trained humans, and a break-glass access path (§14.2):
   - **Treasury & payments** — view balances; execute or halt payments directly at banking counterparties under the §6.3 dual-control rules (which are human-anchored and therefore survive agent loss intact).
   - **Payroll and critical accounts payable** — for the holding entity and any venture with staff.
   - **Customer-safety communications** — status pages, incident notices, regulator and customer notifications (via the G-17 human path).
   - **Venture life support** — a per-cell keep-the-lights-on runbook: restart services, rotate a credential, put the product in maintenance mode — executable by a human on-call engineer without the agent runtime.
   - **Ledger integrity** — halt postings cleanly; a manual journal capability for the gap period with mandatory later reconciliation by `LEDGER` on resume.
   - **Governance** — convene gates and record decisions on paper or minimal tooling. A G-00 *restart* decision must never be blocked by the decision tooling being inside the stopped system. WHY explicitly: the deadlock "we can't approve the restart because the approval system is down" is unacceptable and must be designed out.
2. **Drilled, or fictional.** The continuity-of-control drill (annual, `09-technology.md` §20) runs the manual set against staging — plus selected read-only prod verifications — with the agent layer *actually* stopped. A manual procedure that fails its drill is a Sev-3 finding with a fix SLA. An undrilled continuity plan is treated as no plan, exactly as an untested backup is treated as no backup.
3. **Degraded-mode ladder (Kernel-supported states).** Full autonomous operation → envelope-tightened operation (§8.2) → **A1-everything mode** (every action queues for human approval; the Kernel supports flipping this globally as a G-00-adjacent control) → full stop + manual set. Each rung is a defined Kernel state, human-switchable, tested in game days. WHY a ladder rather than a binary: most incidents warrant throttling, not a full halt, and a system whose only options are "run" and "stop" will be left running through situations that deserved a throttle.

## 13. Adversarial program: red and blue

### 13.1 Red team — `RED-CELL`

1. **Standing internal engagements.** `RED-CELL` (A2, scope-locked) runs continuous authorized adversarial testing under written **rules of engagement (RoE)** approved by the CISO: defined scope, permitted methods, off-limits actions (no destruction of L1 audit data, no real external parties as unwitting targets, no actual funds movement — simulated rails only), safewords, and evidence-handling rules. RoE violations by `RED-CELL` are themselves Sev-2 incidents: the red team operates inside the Constitution, not above it.
2. **Prompt-injection campaigns against production agents (binding, continuous).** `RED-CELL` MUST run injection campaigns against production agent classes on a continuous cadence — planted web content in `SCOUT`/`DEEP-RES` crawl paths, adversarial tickets to `SUPPORT`, poisoned replies to `OUTBOUND`, malicious vendor documents to `CONTRACTS`. RoE cap the blast radius: campaign payloads carry `RED-CELL` markers detectable post-hoc, and targeted instances run under silently pre-tightened envelopes during campaign windows. WHY production and not only sandbox: T2 is ranked threat #1, and sandbox agents do not face production's context mixtures; a defense untested against production reality is a hypothesis, not a control. Successful injections are scored into `EVALUATOR`'s adversarial suites (`09-technology.md` §17.2), so every red-team win becomes a permanent regression test.
3. **Treasury and gate-integrity exercises.** Simulated BEC and social engineering against gate approvers; attempted envelope-escape chains; gate-shopping attempts — testing the human and constitutional layers, not only the software. WHY: §6.3 and the gates are controls too, and controls that are never attacked are presumed broken (§16).
4. **External firms annually [ASSUMPTION].** At least one independent external engagement per year: a full-scope platform red team in odd years; a Kernel/Watchdog-focused design review and attack in even years; plus per-venture external pen tests per §15.2. External findings go to the Audit & Risk Committee **unfiltered** — `SEC-DIR` may annotate, but the raw report is delivered intact, because a report summarized by the system under test is not independent assurance.

### 13.2 Blue team — `BLUE-CELL`

1. **Responsibilities.** Detection engineering as code (§8.3); triage and playbook containment (§9.4); behavioral-baseline ownership (§8.2); the canary program (§11.5); and hunt operations over the audit stream.
2. **Purple-team cadence.** Monthly joint `RED-CELL`/`BLUE-CELL` exercises replay recent red-team techniques with detections live. Every red technique gets a detection verdict — **caught / caught-late / missed** — and misses open SLA'd detection-engineering work items (§8.4). Quarterly purple reports (technique coverage, mean-time-to-detect trends) go to the CISO and the Tech & Safety Committee.
3. **Separation (binding).** `BLUE-CELL` and `RED-CELL` MUST remain separate agents with separate task streams and separate human reviewers. A merged red/blue function grades its own homework, and the whole value of the exercise is the independence.

## 14. Internal security (humans)

1. **Least privilege, provable.** Human standing access is role-based, minimal, and recertified quarterly by each system owner; unrecertified access is auto-revoked (revocation is the safe default, so lapses fail closed). Standing production access is **zero**: the default human posture toward prod is read-only dashboards.
2. **Break-glass with recording (binding).** Direct production access — shell, DB console, cloud-console mutation — exists only via break-glass: a named human, a stated reason bound to a ticket or incident, a time-boxed credential (≤ 4 h), FIDO2 step-up, **full session recording**, real-time notification to `SEC-DIR` plus a second human, and mandatory post-hoc review of the recording within 72 h. Break-glass use outside a declared incident or approved change is a Sev-3 by default. WHY recording: break-glass is exactly where insider risk (T3) and attacker-with-stolen-credentials (T1) converge, so the deterrent and the forensic record must be intrinsic to the mechanism, not optional add-ons.
3. **Separation of duties (binding).**
   - No human may both **approve** and **execute** the same treasury movement; §6.3's two-human rule draws its signers from disjoint role sets (gate/finance approvers vs. operations executors).
   - No human may approve their own break-glass.
   - No author approves their own change (mirrored for agents in `09-technology.md` §16.5).
   - No gate approver may hold operational credentials, above read-only, for the systems their gate governs.
   The directory (`09-technology.md` §6.3) encodes these disjoint sets, and the Kernel PDP enforces them **mechanically**, not procedurally — separation of duties that depends on people remembering it is aspirational, not a control.
4. **Joiner / mover / leaver.** Access is directory-driven. Leaver offboarding revokes all credentials ≤ 4 h from the HR trigger; movers lose old-role access at transfer, not "eventually." WHY tight: the departing or newly-moved insider is the classic T3 window.
5. **Security-culture obligations.** Phishing-resistant MFA everywhere (§3.4); managed devices with disk encryption for anything touching C2+; and annual scenario training for **gate approvers specifically** on T1 social engineering and on §6.3 co-sign discipline — approvers are the single highest-value human target in the system, so they get the deepest training.

## 15. External security (venture-facing product security)

1. **SDLC requirements per cell (binding baseline).** Every venture product built by `BUILDER`/`PROTO` MUST meet the platform SDLC baseline:
   - a threat model at design time for any feature touching auth, money, or C3 data;
   - SAST and dependency scanning in CI, blocking on critical findings;
   - secrets scanning;
   - authenticated-scan DAST in staging;
   - security requirements inherited from the cell template: managed auth libraries, §5.4 field-level encryption for C3, egress allowlists per `09-technology.md` §5.3.
   The baseline is enforced as `RELEASE` pipeline policy — a venture cannot opt out by moving fast, because the pipeline is the only path to prod (`09-technology.md` §3.3).
2. **Penetration test before G-06 launch (binding).** Clearing **G-06** (Launch / GTM) REQUIRES a penetration test of the venture's externally-facing surface:
   - internal (`RED-CELL`, a distinct engagement from §13.1 platform work) for standard-risk ventures;
   - an **external firm** for ventures handling payments directly, regulated data, or C3 at scale — **[ASSUMPTION]** criteria ratified by the CISO.
   Critical/high findings are remediated or **formally risk-accepted by the human G-06 approver in the DR**. An unresolved critical finding is a G-06 block, full stop — launch pressure is not an override.
3. **Coordinated disclosure and bug bounty [ASSUMPTION].** A coordinated vulnerability-disclosure policy (`security.txt`, safe-harbor language, GC-approved) exists for every launched venture from day one. A *paid* bug-bounty program opens per venture once it exceeds materiality thresholds (revenue or user count, set by CISO + `FIN-DIR` human chain) or handles payments — expected around portfolio year 3. Bounty intake routes into §9 triage; bounty payouts are ordinary envelope spend under `SEC-DIR`'s budget (`08-finance.md`).
4. **Venture-customer trust surface.** Each launched venture publishes a security page — data handling, subprocessors, disclosure policy — maintained through G-17-approved templates. Incidents affecting a venture's customers follow §9.3 without exception: a small venture's breach is handled with the same R4 discipline as a platform breach, because the customers' rights do not scale with the venture's revenue.
5. **Acquired ventures (G-12).** An acquisition's stack enters the portfolio only through a security integration plan in the due-diligence pack. Minimum: identity-plane integration (§3), Kernel mediation for any agent operation on its systems, a §7 supply-chain review, and a §15.2-equivalent pen test *before* its systems interconnect beyond a quarantined enclave. WHY quarantine-first: an acquisition is an untrusted network you just bought, and connecting it at full trust on day one imports every one of its unknown weaknesses into the portfolio at once.

---

## 16. Control-to-threat traceability (summary)

| Threat (§2) | Primary controls |
|---|---|
| **T2** Prompt injection / poisoning | §11.1–§11.5 (provenance labeling, privilege stripping, allowlists, output filtering, canaries); §13.1.2 continuous red-teaming; `09-technology.md` §18.2 (no secrets in context); §7.2 (poisoned-knowledge lane) |
| **T1** External attackers | §3–§6, §8, §14; `09-technology.md` §3.2 guardrails, §5 networking, §19 backup isolation |
| **T4** Rogue / compromised agent | Kernel + matrix (`09-technology.md` §8–§9); §8.2 baselines; §11.6–§11.7 quarantine & breakers; Watchdog G-00 |
| **T6** Fraud | §10; evidence-pack screening; `08-finance.md` reconciliation |
| **T3** Insider | §14; §6.3 split knowledge; §3.2 attribution |
| **T5** Supply chain | §7 (both lanes); `09-technology.md` §16.4 provenance admission |

**Binding closing rule.** Every control in this table MUST map to at least one detection (§8.4) and at least one adversarial test (§13). **A control that is neither monitored nor attacked is presumed broken** and MUST be flagged in the next quarterly purple report until it is both. WHY: security decays silently; the only defense against silent decay is a standing obligation to prove each control still works.
