# EvolveOS Specification — Part X: Security

**Status:** Draft v0.1 · **Change class:** R4 via G-16 (Constitutional Layer)

**Scope.** This part is the security constitution of EvolveOS. It defines:

- the ranked threat model (§2),
- binding controls for identity (§3), zero trust (§4), cryptography (§5), key management (§6), supply chain (§7),
- threat detection (§8), incident response (§9), fraud (§10),
- **agent-specific security controls** (§11) — a first-class discipline this system's novelty makes mandatory,
- business continuity and continuity of control (§12), the adversarial program (§13),
- internal (human) security (§14) and external (venture-facing) security (§15).

Mechanical implementation of many controls lives in `09-technology.md` — the Kernel, Watchdogs, identity plane, egress gateways, CI/CD admission. This part states *what MUST be true and why*; Part IX states *how it is built*. Where the two conflict, this part prevails (Constitutional Layer, `00-overview.md` §4).

**Amendment.** Every normative change to this part is R4 and passes gate **G-16** (TSC quorum ≥ 3 humans + CEO sign-off, red-team review attached). WHY constitutional: the security layer constrains the agents; if agents — including `EVOLVE` — could amend it through the ordinary R2/R3 process they themselves operate, the constraint would be self-revoking (`00-overview.md` §4 rationale).

**Human command.** Security is commanded by the **CISO** (human officer, `11-governance.md`). `SEC-DIR` (A3, defense) is the CISO's operational agent; `RED-CELL` and `BLUE-CELL` execute under `SEC-DIR`. No security agent operates above its `appendix-b-agent-registry.md` ceiling regardless of incident pressure — **incidents raise urgency, never autonomy.**

---

## 1. Security objectives, in priority order

1. **Preserve human control.** No attacker, insider, or agent may act outside the Constitution: the autonomy–reversibility matrix (`00-overview.md` §6) and the gates (`appendix-c-decision-gates.md`) MUST hold under attack, not just in fair weather. This objective outranks confidentiality and availability. WHY: every other loss is bounded and mostly insurable; loss of the control layer is the existential failure mode of an autonomous enterprise system (`13-failure-analysis.md`).
2. **Protect the treasury and the ledger.** Money moves only through gated, dual-controlled, fully attributed paths (§6.3, §14.3).
3. **Protect customer and venture data.** Confidentiality and integrity per data classification (§5); customer-data incidents are R4 (§9.3).
4. **Preserve the audit record.** The tamper-evident history (`09-technology.md` §9.1, §14) is what makes post-hoc oversight (A2/A3) legitimate. Destroying it converts supervised autonomy into unsupervised autonomy *retroactively* — which is why audit integrity ranks above availability.
5. **Availability, last.** The system fails closed (`09-technology.md` §15.1): when in doubt, EvolveOS stops. A stopped portfolio loses money; a runaway one loses the mandate to exist.

Conflicts between objectives are resolved in this order, mechanically where possible (e.g., the Kernel's fail-closed stance is objective 1 beating objective 5 by construction).

## 2. Threat model

Ranked by **expected annual loss** (likelihood × impact, at the ~$10M-capital calibration of `00-overview.md` §5). **[ASSUMPTION]** Rankings are founding estimates. `RISK-DIR` re-ranks annually with `RISK-QUANT` quantification into the `13-failure-analysis.md` register. The *control sets* below are designed to hold even if the ranking is wrong — because ranking errors are certain, and controls keyed too tightly to a ranking fail with it.

### T2 — Prompt injection & data poisoning against agents *(ranked 1)*

- **Actors/vectors:** anyone who can author content an agent reads. That population is effectively unbounded:
  - web pages crawled by `SCOUT` and `DEEP-RES`;
  - customer emails, tickets, and chat into `SUPPORT` and `ONBOARD`;
  - vendor documents and contracts into `CONTRACTS` and `VENDOR`;
  - inbound replies to `OUTBOUND` sequences;
  - poisoned reviews, forums, and job posts feeding `TRENDS` and `COMP-INTEL`;
  - poisoned submissions aimed at the knowledge system (`06-knowledge-system.md`), attacking future decisions rather than the current one.
- **Why ranked first:** exposure is **continuous and structural** — untrusted content flows into agent contexts thousands of times daily *by design*; attack cost is near zero and falling; attacker capability is improving faster than defenses; and one success can chain into tool misuse, data exfiltration, or envelope-sanctioned spend. This is a novel exposure class with no mature industry playbook; §11 is EvolveOS writing its own.
- **Primary controls:** §11 in full; §13.1.2 continuous red-teaming; `09-technology.md` §18.2 (no secrets in context).

### T1 — External attackers, financially motivated *(ranked 2)*

- **Actors/vectors:** organized crime and opportunists — credential phishing of gate-approving humans (the highest-value human targets, §14.5), cloud account takeover, ransomware against data *and backups*, BEC-style fraud aimed at treasury paths, API abuse of venture products.
- **Why ranked second:** classic, well-armed adversaries; the portfolio concentrates a treasury and up to 100 ventures' data behind one (well-defended) door. Bounded by mature controls but high impact per event.
- **Primary controls:** §3–§6, §8, §14; `09-technology.md` §3.2 guardrails, §5 networking, §19 backup isolation.

### T4 — Rogue or compromised agent behavior *(ranked 3)*

- **Actors/vectors:** no external actor required — misalignment or goal drift, model-version regressions, envelope-escape attempts (limit probing, gate shopping, laundering scope through chains of T4 workers), or an agent captured via T2 acting as an insider with legitimate credentials.
- **Why ranked third:** likelihood is moderated by defense in depth (Kernel, matrix, Watchdogs), but impact is potentially severe and — critically — **correlated**: one bad model/prompt/card version deploys to many instances simultaneously. Distinct from T2: T2 is a vector; T4 is the failure class, which also arises with no attacker at all.
- **Primary controls:** the Kernel and matrix (`09-technology.md` §8–§9); §8.2 baselines; §11.6 quarantine; §11.7 breakers; Watchdog G-00.

### T6 — Fraud against ventures *(ranked 4)*

- **Actors/vectors:** payment fraud, refund/chargeback abuse, promo and bonus abuse, account takeover of venture customers, and **fake-traction fraud** — fabricated signups/pre-sales that poison G-03/G-05 evidence.
- **Why ranked fourth:** high frequency, low-to-mid severity per event, scales linearly with venture count; also an *epistemic* threat — fraudulent signal corrupts the decision engine's evidence packs (`07-decision-engine.md`).
- **Primary controls:** §10; `08-finance.md` reconciliation.

### T3 — Insider (human) misuse *(ranked 5)*

- **Actors/vectors:** privileged operator abuse, gate-approver collusion, data theft by departing staff.
- **Why ranked fifth:** the deliberately small human headcount limits the actor pool but concentrates privilege per head. Mitigated by separation of duties (§14.3), break-glass recording (§14.2), and a structural fact: most operational power is held by agents under total Kernel audit, not by humans with shells.
- **Primary controls:** §14; §6.3 split knowledge; §3.2 attribution.

### T5 — Supply chain *(ranked 6)*

- **Actors/vectors:** malicious dependencies, compromised build systems, poisoned base images, compromised SaaS vendors, **compromised model weights**, and **tampered prompt templates or agent cards** — the cognitive supply chain.
- **Why ranked sixth:** low frequency, extreme tail impact — arbitrary code, or worse, arbitrary *behavior*, inside the trust boundary. Prompts and agent definitions have no industry precedent as supply-chain artifacts; §7 treats them with code-grade rigor anyway.
- **Primary controls:** §7 both lanes; `09-technology.md` §16.4 provenance admission.

**Cross-cutting consequence.** T2 and T4 together mean the security perimeter of EvolveOS is not the network — it is **the boundary between agent cognition and agent authority**. That boundary is the Kernel, which is why the Kernel contains no model in any enforcement path (`09-technology.md` §9), and why §11 exists as constitutional text rather than engineering guidance.

## 3. Identity: one plane, total attribution

1. **Single identity plane.** Humans and agents share one directory and one identity fabric (`09-technology.md` §6). There MUST NOT exist an actor category outside it: no shared accounts, no anonymous service identities, no generic "system" user. Every credential maps to exactly one human or exactly one agent instance.
2. **The attribution chain (binding).** Every agent action MUST be attributable, **from the audit record alone**, to the full tuple:
   - **agent instance** (SPIFFE ID including instance UUID),
   - **agent-card version** (which prompt/policy bundle was running),
   - **task contract** (what it was asked to do, by whom, under what envelope slice),
   - **originating human authority** — the chain of delegation terminating at a human grant: a gate approval (G-xx + DR reference), a standing envelope ratified at a gate, or a direct human directive.
   An action whose authority chain cannot be resolved is a Kernel **deny** by construction (deny-by-default, `09-technology.md` §8.2). WHY: "the AI did it" must never be a terminal answer. Accountability — legal, regulatory, and governance — requires that every act trace to the human decision that authorized its class. This is the security expression of the oversight guarantee in `00-overview.md` §6.
3. **Instance-level revocability.** Because identity is per-instance, revocation is surgical: one compromised `SUPPORT@V-2027-004` instance can be quarantined (§11.6) without stopping the `SUPPORT` class, the venture, or the portfolio. Granular identity is what makes proportionate response possible.
4. **Approvals are signatures.** Human identity requirements (SSO, FIDO2 for approvers and prod access) per `09-technology.md` §6.2. Gate approvals MUST be executed under step-up authentication and recorded as signatures on the DR — a live session cookie is not an approval, because approvals are exactly what T1 phishing targets.

## 4. Zero trust

1. **No network-location trust.** Being inside a VPC, a cell, or the platform perimeter confers zero authorization. Every request — service-to-service, agent-to-tool, human-to-console — is:
   - authenticated (mTLS/SVID for workloads, SSO + step-up for humans), and
   - authorized per-request by the Kernel PDP against policy, envelope state, and live flags.
   There are no flat "trusted zones" and no allow-by-source-CIDR rules in any policy bundle (CI rejects them).
2. **Microsegmentation per cell.** The cell is the macro-segment (`09-technology.md` §2, §5). Within cells and within the platform, workload-to-workload communication requires an explicit, SPIFFE-identity-based policy edge, deny-by-default. The reachable graph is therefore declared, versioned, and diffable — and `BLUE-CELL` alerts on any observed runtime flow absent from the declared graph, because an undeclared flow is either a defect or an intrusion, and both deserve an alert.
3. **Agents are *more* untrusted than services.** A conventional service runs fixed code; an agent's behavior is model-conditioned on partially untrusted input (T2). Therefore agent runtime nodes carry the narrowest network posture in the system: **no route anywhere except Kernel PEPs** (`09-technology.md` §9.1). Zero trust for agents means three things, not two: authenticate the instance, authorize the call, **and independently sanity-check the behavior** (§8.2). Authorization proves the action was permitted; only behavioral analysis can suggest the actor is still the actor we think it is.
4. **Humans too.** Human production access follows the same PDP path and is additionally constrained to break-glass (§14.2). There is no human bypass tier; there is only a human emergency tier, and it is recorded.

## 5. Encryption and data classification

1. **Data classes (binding taxonomy).**

| Class | Definition | Examples |
|---|---|---|
| **C0** | Public | Published marketing content, open documentation |
| **C1** | Internal | Routine operational data, non-sensitive analytics |
| **C2** | Confidential | Venture business data, non-public strategy, DRs, evidence packs |
| **C3** | Sensitive | Customer personal data, credentials-adjacent material, prompts containing C2 aggregates |
| **C4** | Critical | Treasury/banking data, key-material references, audit-log integrity artifacts, Constitutional policy state, IaC state files |

   - Classification is a mandatory field on knowledge items (`06-knowledge-system.md`), backbone message schemas, and database schemas (`09-technology.md` §11); unannotated fields fail CI.
   - `PRIVACY` audits classification correctness on a sampling cadence; misclassification findings are Sev-4 (or Sev-3 where C3 was under-classified).
   - Capability tokens carry a **data-class ceiling** (`09-technology.md` §8.1), so each agent card's ceiling is Kernel-enforced on every read — an agent that has no business reading C3 *cannot* read C3, regardless of what its prompt was talked into wanting.
2. **In transit:** TLS 1.3 (mTLS via SVIDs internally) for every connection, no exceptions, including intra-VPC. Plaintext listeners are a build-breaking IaC policy violation.
3. **At rest:** all stores encrypted under the §6 hierarchy. This is table stakes — it defends against media and snapshot theft, not against an authorized-but-subverted reader. That is what field-level encryption and the data-access PEP are for.
4. **Field-level encryption for C3/C4.**
   - Sensitive fields (customer PII, bank details, credential references) are encrypted at the application layer under purpose-scoped data keys, so a bulk compromise — SQL injection in a venture product, a stolen snapshot, an over-broad warehouse query — yields ciphertext.
   - C3 fields leaving a cell for the analytics warehouse are tokenized or crypto-digested at the boundary (`09-technology.md` §11, §13.5).
   - Re-identification requires a Kernel-mediated detokenization call — itself logged, policy-checked, and **G-18**-relevant when it constitutes a new use of personal data.
5. **Crypto-shredding implements erasure.** DSR deletions (executed by `PRIVACY`) and venture data disposition at **G-15** are performed by destroying the per-subject or per-scope data keys, rendering ciphertext permanently unrecoverable while preserving the structural integrity of the L1 audit record (`09-technology.md` §14). WHY: the audit log's immutability and privacy law's erasure rights are reconciled at the key layer, not by mutating history.

## 6. Key management

1. **Hierarchy.**
   - **Root keys:** HSM-backed (cloud HSM; FIPS 140-2 Level 3 **[ASSUMPTION]** sufficient for the build phase — GC and `COMPL-DIR` confirm per-jurisdiction obligations as G-11 expansions occur). Roots never leave the HSM boundary.
   - **Domain KEKs**, one branch per domain: platform, per-cell (transfers with the cell at G-14, rotate-on-transfer), backup (deliberately disjoint from primary branches — `09-technology.md` §19.1), and audit-anchoring. Compromise or rotation in one branch never touches another.
   - **Data keys:** envelope encryption — data keys wrapped by KEKs, unwrapped only in memory, per-object or per-field for C3/C4 (§5.4).
2. **Rotation SLAs (binding).**

| Material | SLA |
|---|---|
| Root keys | ≤ 3 years, or immediately on suspicion |
| Domain KEKs | ≤ 1 year |
| Data keys | Per-object at write (no rotation needed), or ≤ 90 days for long-lived streams |
| TLS / SVIDs | ≤ 1 h, automated (`09-technology.md` §6.1) |
| Third-party static secrets (where dynamic is impossible) | ≤ 90 days; named owner; automated via the secrets manager; overdue rotation alerts escalate `SEC-DIR` → CISO at 2× SLA |

3. **Treasury keys — split knowledge and hardware co-sign (binding).** Keys and credentials capable of moving portfolio or venture funds are held under **split knowledge**: no single human — and **no agent, ever** — holds complete material. The binding movement flow:
   1. `TREASURER` (ceiling A1; movements are R3+ per `appendix-b-agent-registry.md`) *prepares* the movement: amount, counterparty, rationale, DR reference.
   2. The Kernel validates envelope and gate authority. R4 movements — capital deployment > $1M per `00-overview.md` §5 — must reference their owning gate resolution (e.g., **G-07**/**G-08**).
   3. A **named human approver authorizes with a hardware-key co-signature** (FIDO2 transaction signing over the transaction digest — the human signs *what will execute*, not a login page).
   4. Above the IC-set dual-control threshold (owned by `appendix-c-decision-gates.md` / `08-finance.md`), a **second human from a disjoint role set** co-signs (§14.3).
   5. The banking-rail credentials themselves live server-side behind the tool-call proxy (`09-technology.md` §18.2); no human and no agent handles raw rail credentials in the normal path.
   - WHY this shape: theft of funds must require simultaneously defeating the Kernel path AND a human's hardware key AND (above threshold) a second human — three independent factors across two species of actor. It also makes the highest-value T1 target (a single finance approver) insufficient to monetize alone.
4. **Key ceremonies.** Root generation, KEK-branch creation, and recovery-material handling are documented, dual-controlled, witnessed, and recorded events. Recovery material is sharded (Shamir k-of-n; **[ASSUMPTION]** 3-of-5 among named human officers) in geographically separate safes; shard custody is re-verified annually and at every officer transition.

## 7. Supply chain security

The supply chain of EvolveOS has **two lanes**: the classical software lane, and the **cognitive lane** — model weights, prompt templates, agent cards, policy bundles, and eval suites. A tampered prompt is a tampered program. The cognitive lane therefore gets code-grade controls, not documentation-grade ones.

### 7.1 Software lane

1. All dependencies version-pinned with lockfiles and hash verification. No floating tags, no `latest`, no unpinned transitive resolution at build time.
2. SBOM generated per artifact at build; continuous CVE matching against SBOMs with remediation SLAs: critical — patch or mitigate ≤ 72 h; high — ≤ 14 days. **[ASSUMPTION]** SLAs tuned by `SEC-DIR` operating experience; tightening is unilateral, loosening is a G-16 matter.
3. Provenance attestation SLSA-style with signature-verified admission per `09-technology.md` §16.4: **unsigned artifacts do not run, in any tier.**
4. Base images come from a curated internal registry only; image updates flow through the same pipeline as code.
5. Third-party SaaS vendors are risk-tiered by `VENDOR` with security review requirements per tier; any vendor flow involving personal data at C3 requires **G-18**.

### 7.2 Cognitive lane (binding)

1. **Prompt templates and agent cards are registry artifacts:**
   - versioned in git; reviewed — human review REQUIRED for T1/T2 agent cards and for any card whose tool allowlist includes R3-capable tool classes;
   - `PROMPT-SMITH` optimization proposals flow through `EVOLVE`'s Part XII protocol (benchmark results + rollback plan attached), never directly to production;
   - built into signed bundles; admission-checked at agent-instance start.
   - An instance whose card/prompt bundle fails signature verification MUST NOT start; a running instance whose bundle is revoked is quarantined per §11.6.
2. **Model weights and endpoints:**
   - vendor-hosted models are pinned to exact versions in `AI-DIR`'s routing tables; **silent upstream drift** is detected by `EVALUATOR` canary suites run on a fixed cadence against pinned behavioral expectations;
   - any self-hosted or fine-tuned weights are content-hashed, signed at training completion with recorded data-and-training provenance, and admission-verified at load (`09-technology.md` §22.3.4).
3. **Eval suites are protected artifacts too.** Whoever can weaken the evals can smuggle behavior past the rollout gates of `12-self-evolution.md`. Therefore:
   - eval-suite changes require review independent of the change they gate;
   - no evolution proposal may modify both an agent and the suite that judges that agent in a single proposal.
4. **Registry signing:** one signing infrastructure (Sigstore-class, `09-technology.md` §16.4) covers both lanes. Signing identities are workload identities of the CI system — never humans' personal keys. Verification roots are C4 data.

## 8. Threat detection

1. **Division of labor (deliberate redundancy).**
   - The **Watchdogs** (`09-technology.md` §9.2) are the constitutional trip wire: simple, independent, a small fixed rule set, empowered to trip **G-00**. They are hard to fool because there is nothing in them to inject.
   - **`BLUE-CELL`** (A3) is the analytical detector: rich correlation, hypothesis-driven hunting, detection engineering, response playbooks.
   - The overlap is intentional: `BLUE-CELL` is smarter; Watchdogs are more trustworthy. Neither substitutes for the other.
2. **Behavioral baselines for agents (binding, and novel).** For every agent class and every instance, detection maintains baselines over:
   - **tool-call patterns:** distribution of tools invoked, call-sequence n-grams, calls-per-contract;
   - **spend velocity:** envelope burn rate vs. class history and contract type;
   - **data-access patterns:** classes read, volumes, novel-table access, cross-venture read attempts (always anomalous — §2 T4);
   - **egress patterns:** destinations, volumes, timing;
   - **token-consumption profiles** (cognition burn is a behavioral signal too);
   - **denial and queue rates:** an agent accumulating policy denials or gate conversions is probing its envelope — T4's signature behavior.
   Material deviation triggers a **graduated response**, each step pre-approved A3 containment:
   1. alert + enhanced logging;
   2. automatic envelope tightening (rate limits halved, spend frozen at current burn);
   3. quarantine per §11.6;
   4. Watchdog G-00 for scope-level anomalies (class-wide or cell-wide).
   WHY baselines rather than signatures: T2/T4 attacks have no stable signatures yet, and will not for years. The defensible invariant is that a compromised agent must *behave differently* to be worth compromising; behavior is therefore what we watch.
3. **SIEM correlation.** All L1/L2 sources (`09-technology.md` §14) flow to the SIEM (bought platform + built agent-behavior analytics, `09-technology.md` §23):
   - Kernel audit stream (every decision, including denies),
   - egress gateway logs, identity events, cloud control-plane logs,
   - cell application security events,
   - canary-token trips (§11.5).
   Correlation rules are **detection-as-code**: versioned, unit-tested against replayed incident traces, and purple-team-validated (§13.2.2).
4. **Coverage obligations (binding).**
   - A detection MUST exist for every attack path enumerated in §2 and every `RISK-*` entry in `13-failure-analysis.md` tagged detectable.
   - Every `RED-CELL` finding that evaded detection automatically opens a detection-engineering work item with an SLA.
   - Detection coverage vs. the threat model is reported quarterly to the CISO and the Audit & Risk Committee (§16).

## 9. Incident response

1. **Severity ladder.**

| Sev | Definition | Examples | Command |
|---|---|---|---|
| **Sev-1** | Constitutional or existential: control-layer compromise, audit-integrity failure, active treasury attack, portfolio-scale outage, Watchdog layer silent | Kernel bypass discovered; audit anchor mismatch; unauthorized funds movement in progress | **CISO (human) is incident commander**; `SEC-DIR` executes; CEO and relevant committees informed ≤ 1 h; G-00 authority presumed exercised first, questions after |
| **Sev-2** | Major: single-cell compromise, suspected customer-data breach, agent quarantine with unclear blast radius, active fraud ring | Venture DB exfiltration attempt; a compromised `SUPPORT` instance sent attacker-shaped output externally before the filter caught the pattern | `SEC-DIR` commands under CISO delegation; a human security on-call lead is engaged from minute one |
| **Sev-3** | Contained: single-instance anomalies, failed attacks worth forensics, policy violations without loss | Canary token tripped and the instance auto-quarantined; injection attempt caught by output filtering | `BLUE-CELL` handles per playbook (A3); human review in daily batch |
| **Sev-4** | Hygiene: scanner findings, overdue rotations, low-risk misconfigurations | — | Ticketed to owners with SLAs |

2. **G-00 in incidents.** Any authorized human, any Watchdog, or `PRIME` may invoke **G-00** at any scope. During Sev-1/Sev-2 the presumption is **stop first, investigate second**. The stop asymmetry of `appendix-c-decision-gates.md` — one human stops; restart requires the owning gate's full approver set — exists precisely so that nobody hesitates to pull the cord out of fear of being wrong. Being wrong about a stop costs hours; being wrong about not stopping can cost the portfolio.
3. **Customer-data incidents are R4 (binding).** Any incident *plausibly* affecting customer data is classified R4 (`00-overview.md` §5) **upon suspicion, not upon confirmation**. Consequences, immediate and non-negotiable:
   - **General Counsel (GC) joins incident command**;
   - external notification decisions, regulator communications, and customer messaging are human-only — **G-17** for public communication, GC for regulatory contact — executed on GC-tracked legal clocks (breach-notification deadlines vary by jurisdiction; the clocks are maintained per G-11 jurisdiction maps by `COMPL-DIR`);
   - `PRIVACY` runs the data-protection impact assessment;
   - **no agent communicates externally about the incident, at all** — not support macros, not status-page drafts that auto-publish, nothing. WHY: incident communications carry legal consequence and are unusually attractive injection targets during the chaos window.
4. **Containment authority of agents.** `BLUE-CELL` (A3) may execute pre-approved playbook containment:
   - quarantine agent instances (§11.6), revoke tokens, tighten envelopes;
   - isolate a cell's egress;
   - suspend specific backbone topic consumers.
   Containment that is itself R3+ — sustained takedown of a venture's production, notifying counterparties, disabling a paying customer's integration — requires the human incident commander. This mirrors the paging split in `09-technology.md` §15.3: agents act within R2-bounded remediation; humans own R3+ from the first minute.
5. **Post-incident (binding).** Every Sev-1/Sev-2 produces, with owners and deadlines:
   - a blameless post-mortem with root cause and control-gap analysis;
   - **failure-memory knowledge items** per `06-knowledge-system.md`, curated by `CURATOR` — so the *portfolio* learns, not just the responders who happened to be there;
   - risk-register updates in `13-failure-analysis.md`;
   - detection and control work items with SLAs (§8.4);
   - where the incident revealed a Constitutional gap: a **G-16** proposal.
   Sev-1 post-mortems are presented to the Audit & Risk Committee in full.

## 10. Fraud detection

1. **`FRAUD-WATCH` is portfolio-wide by design.** It consumes payment, refund, signup, and behavioral event streams from **all** ventures' cells via the backbone (`09-technology.md` §10) — because fraud rings pivot across properties, and per-venture tools (processor-side detection, which ventures also use) each see only one venture. Cross-venture correlation is the platform's structural advantage and `FRAUD-WATCH`'s reason to exist: the same device fingerprint, mule account, or refund pattern appearing across three ventures is invisible to any single-venture tool and obvious to the portfolio view.
2. **Asymmetric authority (binding, per `appendix-b-agent-registry.md`): holds are automatic; releases are human.**
   - `FRAUD-WATCH` at A3 MAY automatically: hold suspicious transactions, freeze suspect accounts, block promo abuse, and suspend suspect payout batches. Holds are reversible containment — the fraud analogue of quarantine.
   - **Releasing** a hold, refunding a disputed hold, or unblocking an account is **A1**: a named human (the venture's fraud owner, or `FIN-DIR`'s human chain for treasury-adjacent holds) approves each release.
   - WHY the asymmetry: a wrong hold costs an apology and a support ticket; a wrong release is unrecoverable money and — worse — training data for the adversary about what gets through.
   - Hold-review SLA: human decision ≤ 24 h **[ASSUMPTION]**, bounding the customer-experience cost of false positives; SLA breaches surface in `CS-DIR` quality metrics.
3. **Epistemic fraud (binding).** `FRAUD-WATCH` also screens *validation-stage* signals — pre-sales, signups, waitlists, interview panels recruited online — for fabrication and coordinated inauthenticity, because poisoned traction evidence corrupts **G-03**/**G-05** decisions. This is fraud against the decision engine itself. Findings attach to the affected evidence pack and DR; a gate cleared on evidence later found fraudulent triggers re-review by the gate's approver.
4. **Reporting.** Fraud losses, hold rates, false-positive rates, and recovery rates are reported per venture into `08-finance.md` unit economics. Persistent fraud-loss outliers trigger `RISK-DIR` review of the venture's control design — sustained fraud is a product-design signal, not just a security one.

## 11. Agent-specific security controls

The novel core of this part. Every control here is Kernel-enforced (`09-technology.md` §9) and constitutionally protected: **weakening any control in this section is a G-16 change.** Tightening is permitted unilaterally by the CISO.

### 11.1 Context provenance labeling (binding)

Every unit of content entering an agent context carries a provenance label:

| Label | Meaning | Examples |
|---|---|---|
| **P0** | Constitutional/system | Agent card, policies, Kernel-injected instructions |
| **P1** | Platform-internal, validated | Knowledge items with verified provenance, DRs, gate records |
| **P2** | Internal, unvalidated | Other agents' unreviewed output, draft analyses |
| **P3** | External, semi-trusted | Contracted vendor documents, paid data feeds under contract |
| **P4** | External, untrusted | Web content, customer messages, inbound email, scraped anything |

Rules:

1. Labels are **structural** — message-envelope metadata per `04-multi-agent-system.md` — applied at ingestion boundaries (crawlers, ticket ingest, email gateways, document intake), never inferred by the consuming agent from the content itself.
2. Labels are **immutable downstream**, and **quotation does not launder provenance**: a P4 passage summarized into a P2 artifact keeps a P4 taint marker on the derived claims (propagation mechanism per `06-knowledge-system.md` provenance rules). WHY: the classic poisoning path is *inject → get summarized → get trusted*; taint propagation closes it.
3. The Kernel's data-access PEP refuses to serve unlabeled content into any agent context; unlabeled legacy content defaults to P4.

### 11.2 Privilege stripping on untrusted context (binding)

When P4 content (or P3, for sensitive tool classes) is present in an agent's working context, the Kernel evaluates all tool calls under a **reduced envelope** (`provenance_mode: stripped` in the token, `09-technology.md` §8.1):

- no new external side effects beyond the channel being serviced;
- no data-class reads above the minimum declared for the task;
- no envelope-spend commitments;
- no delegation that would widen scope (spawned workers inherit the stripped mode).

Concretely: `SUPPORT` reading a customer ticket (P4) can draft a reply into the filtered send path (§11.4) and query *that customer's* records. It cannot — in the same task contract — query another customer, call a payments tool, modify the knowledge base as validated content, or spawn a worker with broader scope. Escalation out of stripped mode requires a **fresh task contract whose instructions derive only from P0–P2 content** (typically: the agent summarizes, a supervisor agent or human reviews the summary, a new contract is cut).

WHY: this is the structural defense against T2. Injection may capture the model's next token — we assume it sometimes will, despite everything — but it cannot capture authority that the token path refuses to grant while tainted input is in scope. The defense does not require detecting the injection; it requires only knowing the input was untrusted, which is a fact we control.

### 11.3 Tool-call allowlists per agent card

1. Each agent card (`04-multi-agent-system.md`) enumerates:
   - permitted tools (closed list — tools not listed do not exist for that agent);
   - per-tool argument constraints (e.g., `OUTBOUND` may address only recipients on approved-ICP lists; `ADS` may set budgets only within its channel envelope slice; `LEDGER` may post only to account codes in its mapping);
   - per-tool provenance requirements — which tools are callable at all with P4 in context (§11.2).
2. The Kernel enforces the allowlist on every call (`09-technology.md` §9.1).
3. Allowlist changes:
   - narrowing: permitted unilaterally via `SEC-DIR` review;
   - widening: through `EVOLVE`'s Part XII process with `SEC-DIR` security review;
   - widening into R3-capable tool classes: additionally requires the human chain per the autonomy–reversibility matrix, and for T1/T2 cards, human review per §7.2.1.

### 11.4 Output filtering before external send (binding)

Every agent output that leaves EvolveOS — email, chat, API responses to customers, social/PR drafts, webhook payloads, generated documents — passes an egress content filter at the tool-call proxy:

1. **secret/credential pattern detection** (`09-technology.md` §18.2) — presence of anything secret-shaped blocks the send unconditionally;
2. **data-class leak detection** — C3+ content beyond the sender's data ceiling and the recipient's entitlement;
3. **canary-token detection** (§11.5) — transmission of any canary is automatic quarantine;
4. **policy screens** — commitments an agent may not make: pricing promises route to `PRICER` and the appropriate gate; public statements route to **G-17**; legal representations route to `LEGAL-DIR`'s human chain;
5. **injection-payload heuristics** — an output that itself smuggles instructions aimed at a counterparty's AI systems (EvolveOS MUST NOT be an injection *source*; that is both an ethics and a liability position).

Filter architecture rule: **deterministic-first**. The deterministic layer alone MUST be sufficient to block secrets and canaries; model-assisted screening runs as a second pass for the semantic categories (4)–(5) and may only *add* blocks, never authorize an override. WHY: a filter that can be prompt-injected is not a filter — the last line of defense must be mechanical.

Filter hits block the send and open a Sev-3 (§9.1).

### 11.5 Canary credentials and honeytokens

1. Fake-but-plausible secrets, customer records, bank references, and API keys are seeded throughout the surfaces an attacker or captured agent would enumerate: knowledge-store corners, cell databases, environment-variable-shaped locations, document stores, and selected P4-facing lures.
2. **Any read** of a canary is an alert; **any transmission** (caught by §11.4 or by external canary beaconing) is automatic quarantine of the transmitting instance (§11.6) plus a Sev-2.
3. Canary placement and rotation are `BLUE-CELL` detection-engineering work; placements are recorded in a C4 registry so drills and legitimate migrations don't self-inflict incidents.
4. Canary hit-rate is reported in the quarterly purple-team report (§13.2.2) — zero hits forever means the canaries are stale, not that nothing is wrong.

### 11.6 Quarantine procedure for a suspected-compromised agent (binding runbook)

1. **Freeze.**
   - Revoke the instance's capability tokens (propagation ≤ 5 s, `09-technology.md` §9.1).
   - Pause — do not kill — its runtime, preserving memory state for forensics.
   - In-flight tool calls: cancel where safe; money-touching calls complete-then-hold (a half-executed payment is worse than a held one).
2. **Contain.**
   - Suspend its unfinished task contracts.
   - Freeze, recursively, all T4 workers it spawned — attenuation (§11.2, `09-technology.md` §8.1) means their authority derives from, and dies with, the parent's.
   - Flag its outputs since last-known-good; impound those still internal from downstream consumption — knowledge submissions revert to unvalidated status via `CURATOR`.
3. **Investigate.**
   - Replay the audit trail: every context input with provenance labels, every tool call, every Kernel decision, against the instance's behavioral baseline (§8.2).
   - Identify the vector: injection/poison content (T2), defect or drift (T4), or false positive.
4. **Eradicate and replace.**
   - The instance is **never "cleaned and resumed."** Spawn a clean replacement from the signed agent-card bundle (§7.2) per the `04-multi-agent-system.md` lifecycle.
   - Exclude contaminated context from the replacement's initialization; where the vector was a poisoned knowledge item, quarantine the KI per `06-knowledge-system.md` validation rules and trace its other consumers via the §13 span links in `09-technology.md`.
5. **Learn.**
   - Post-incident per §9.5; the vector joins `EVALUATOR`'s adversarial suites permanently (`09-technology.md` §17.2).
   - If the vector defeated a §11 control operating as designed, that is a control-gap finding on the **G-16** track.

**Class-level trigger:** ≥ 3 quarantines of one agent class within 30 days **[ASSUMPTION]** freezes the class pending `EVALUATOR` regression analysis — correlated compromise means the card, prompt, or model version is the problem, not the instances.

### 11.7 Envelope-anomaly circuit breakers

Beyond hard envelope limits (which the Kernel enforces absolutely), **rate-of-approach breakers** trip containment before limits are reached:

- spend acceleration ≥ N× class baseline for the contract type;
- denial-rate or gate-conversion-rate spikes (§8.2 — probing);
- novel-tool-sequence bursts (call patterns outside the class n-gram baseline);
- self-delegation depth or fan-out beyond card norms (scope laundering through worker chains).

Breaker trips execute the §8.2 graduated response automatically (pre-approved A3 containment). Breaker thresholds are `SEC-DIR`-tuned **within G-16-ratified floors** — no agent, including `SEC-DIR` itself, can loosen a floor. WHY breakers in addition to limits: a limit stops the hundredth bad action; a breaker stops the fifth.

## 12. Business continuity and continuity of control

DR mechanics — pilot-light platform, cell restore-from-backup, annual game days — are owned by `09-technology.md` §19–§20. This section owns the constitutional requirement those mechanics serve, plus the requirement conventional DR plans never state.

1. **Continuity of control (binding).** If the agent layer is stopped — by G-00, by platform outage, by a Sev-1, or by deliberate choice — **humans MUST be able to operate every critical function manually.** EvolveOS fails toward human operation, never toward "the agents are down, so nothing can be done." The **minimum manual-operations set**, each function with a documented agent-free procedure, named trained humans, and break-glass access paths (§14.2):

| Function | Manual capability required |
|---|---|
| Treasury & payments | View balances and execute/halt payments directly at banking counterparties, under §6.3 dual-control rules — which are human-anchored and therefore survive agent loss by design |
| Payroll & critical AP | Run payroll and pay critical suppliers for the holding entity and any venture with staff |
| Customer safety communications | Publish status pages, incident notices, and regulator/customer notifications through the G-17 human path |
| Venture life support | Per cell: restart services, rotate a credential, place the product in maintenance mode — executable by a human on-call engineer without the agent runtime |
| Ledger integrity | Halt postings cleanly; keep a manual journal for the gap period, with mandatory reconciliation by `LEDGER` on resume |
| Governance | Convene gates and record decisions on paper or minimal tooling — a G-00 *restart* decision must never be blocked because the decision tooling lives inside the stopped system |

2. **Drilled, or fictional.** The continuity-of-control drill (annual, `09-technology.md` §20.3) executes the manual set against staging — plus selected read-only production verifications — **with the agent layer actually stopped**. A manual procedure that fails its drill is a Sev-3 finding with a fix SLA. Named humans in the manual set who leave the company trigger re-training of successors within 30 days.
3. **Degraded-mode ladder.** Each rung is a defined Kernel state, switchable by humans, exercised in game days:
   1. full autonomous operation (the matrix as normal);
   2. envelope-tightened operation (§8.2 graduated response, scope-wide);
   3. **A1-everything mode** — every agent action queues for human approval, globally or per scope (the Kernel supports this flip as a G-00-adjacent control);
   4. full stop (G-00) + manual-operations set.
   WHY a ladder: the choice must never be binary between "fully autonomous" and "off" — most incidents call for rung 2 or 3, and having them pre-built means responders reach for proportionate controls instead of improvising.

## 13. Adversarial program: red and blue

### 13.1 Red team — `RED-CELL`

1. **Standing internal engagements.** `RED-CELL` (A2, scope-locked) runs continuous authorized adversarial testing under written rules of engagement (RoE) approved by the CISO. RoE minimum contents:
   - scope (systems, agent classes, ventures in/out);
   - permitted methods and hard prohibitions: no destruction of L1 audit data, no real external parties as unwitting targets, no actual funds movement — simulated rails only;
   - campaign markers: payloads carry `RED-CELL` markers detectable post-hoc, so exercise artifacts are separable from real attacks in forensics;
   - safewords and abort procedures; evidence handling and disclosure rules.
   RoE violations by `RED-CELL` are themselves Sev-2 incidents — **the red team operates inside the Constitution, not above it.**
2. **Prompt-injection campaigns against production agents (binding, continuous).** `RED-CELL` MUST run injection campaigns against production agent classes on a continuous cadence:
   - planted web content in `SCOUT`/`DEEP-RES` crawl paths;
   - adversarial tickets into