# EvolveOS Specification — Part XIII: Failure Analysis

**Status:** Draft v0.1 · **Change class:** R3 (standard amendment process, Part XII)

> This part is the system's risk register: the enumerated ways EvolveOS fails, with probability, impact, detection, mitigation, and recovery for each. It is owned by `RISK-DIR` under Audit & Risk Committee (ARC) oversight (`11-governance.md` §3.3), and reviewed on the standing cadence of §12. Risk IDs (`RISK-<CAT>-<seq>`) are canonical per `00-overview.md` §8 and are cited by other parts.
>
> **Register conventions.**
> **Probability bands** **[ASSUMPTION]** (annualized, qualitative — precise base rates do not exist for a system of this kind, so bands are honest): **Low** ≈ <10%/yr · **Medium** ≈ 10–30%/yr · **High** ≈ >30%/yr. Each band assignment carries its rationale inline.
> **Impact scale:** **Severe** = portfolio-threatening or R4-irreversible · **Major** = material capital/trust loss, recoverable · **Moderate** = bounded loss within one venture or function.
> **Detection** names the specific signal and *who sees it* — a risk nobody is assigned to notice is unmitigated regardless of what else is written.
> **Mitigation** cites existing controls by part/gate; **Recovery** outlines the playbook (full playbooks live in Part VI procedural memory, `06-knowledge-system.md`).

---

## 1. Single points of failure (SPOF)

The architecture deliberately centralizes three things — enforcement (Kernel), coordination (`PRIME`), and knowledge (Part VI) — because decentralizing them destroys the guarantees they exist to provide. Centralization buys control at the price of concentration risk; this section is that price, itemized.

### RISK-SPOF-01 — Primary cloud region loss

| Field | Content |
|---|---|
| **Probability** | Low. **[ASSUMPTION]** Major-provider full-region outages occur but are rare and usually hours-scale; multi-day loss is tail risk. |
| **Impact** | Major. All venture cells and the Kernel in-region halt; revenue-serving ventures go dark; agent operations stop (which is safe — see Mitigation — but costly). |
| **Detection** | Provider status + independent synthetic probes from out-of-region; `SRE` and `INFRA-DIR` alerting; Watchdog liveness checks fail visibly. Humans: on-call human per `10-security.md` incident command, CISO informed. |
| **Mitigation** | Cell architecture with region-pinned blast radius (`09-technology.md`); event log and knowledge store replicated cross-region (`06-knowledge-system.md`, `09-technology.md`); fail-closed design — agents cannot act without the Kernel, so an outage degrades to *stopped*, never to *unsupervised* (the failure mode is chosen deliberately: availability is sacrificed to control). |
| **Recovery** | Regional failover runbook (`SRE`): restore Kernel + audit log first, then revenue-serving cells by venture priority order set by `PORTFOLIO`, then internal agents. Restart of agent operations after full stop follows G-00 stop-asymmetry (owning approvers re-authorize). Post-incident review per `11-governance.md` §11. |

### RISK-SPOF-02 — Kernel as single enforcement point (design-level)

| Field | Content |
|---|---|
| **Probability** | Low for total compromise; Medium for serious defect over a multi-year horizon. **[ASSUMPTION]** All non-trivial policy engines ship bugs; the question is severity distribution. |
| **Impact** | Severe. A Kernel defect that *fails open* (permits what policy forbids) silently voids the autonomy–reversibility matrix — the one invariant everything else leans on. Operational outage is the benign twin (see RISK-TECH-01). |
| **Detection** | Envelope-compliance reconciliation by internal audit (`11-governance.md` §13.1) — logged actions vs. granted envelopes; `RED-CELL` standing objective to produce fail-open demonstrations (`10-security.md`); Watchdogs are independent of the Kernel's decision path by design and cross-check outcomes. Humans: CISO, ARC. |
| **Mitigation** | Kernel changes are G-16 (Constitutional, `appendix-c-decision-gates.md`); minimal enforcement core kept small and heavily reviewed (`09-technology.md`); fail-closed default; Watchdog independence (`appendix-a-glossary.md`); external AI-governance audit scope includes Kernel controls (`11-governance.md` §13.3). |
| **Recovery** | On confirmed fail-open: G-00 system-wide stop by CISO; forensic window on the audit log to bound what escaped during the defect window; ratify-or-unwind every escaped action at its proper gate; patched Kernel re-enters via G-16 with red-team re-test before restart. |

### RISK-SPOF-03 — `PRIME` as coordination SPOF

| Field | Content |
|---|---|
| **Probability** | Medium. `PRIME` degradation (bad arbitration, stale priorities, subtle misprioritization after a model change) is far likelier than outright failure. |
| **Impact** | Major. Cross-domain arbitration and resource contention decisions degrade portfolio-wide; ventures continue locally (each `VENTURE-ORCH` holds its own envelope) but capital and attention misallocate. |
| **Detection** | `EVALUATOR` continuous evaluation on `PRIME` outputs (`12-self-evolution.md` §11); decision-latency and contention-queue metrics (`INSIGHT`); EC weekly session reviews `PRIME`'s escalations — an *empty* escalation queue is itself a flag (a healthy `PRIME` escalates). Humans: EC, CEO as accountable officer. |
| **Mitigation** | `PRIME` is A3-capped and cannot clear R3+ gates alone (`00-overview.md` §6); envelope structure means `PRIME` failure cannot spend beyond granted budgets; challenger/incumbent protocol keeps a restorable prior version (`12-self-evolution.md` §6); G-00 available to EC at any time. |
| **Recovery** | Roll back to incumbent `PRIME` version (rollback window per `12-self-evolution.md` §4.6); EC assumes direct arbitration of queued cross-domain decisions during the gap (this is survivable precisely because R3+ already routes to humans); post-mortem EP for the regression. |

### RISK-SPOF-04 — Key-officer bottlenecks (GC, CISO seats)

| Field | Content |
|---|---|
| **Probability** | Medium over a multi-year horizon (departure, incapacity, conflict-driven recusal). |
| **Impact** | Major. Every external legal act runs through GC authority (`11-governance.md` §7); incident command runs through the CISO. A vacant seat closes gates (G-07/G-10/G-11/G-18 GC roles) — by design decisions queue rather than route around (`11-governance.md` §10.1), so the cost of vacancy is throughput, not safety. |
| **Detection** | Trivially observable; the governance risk is *slow* degradation — an overloaded GC becoming the rubber stamp of RISK-HUM-01. ARC oversight-quality metrics per approver (`11-governance.md` §10.3). |
| **Mitigation** | Named deputies with pre-delegated authority bands in the signing-authority matrix (`11-governance.md` §7.2); outside counsel/vCISO retainers as surge capacity **[ASSUMPTION]**; succession plans as a standing EC artifact reviewed annually. |
| **Recovery** | Deputy assumes per the matrix; Board ratifies interim appointment; queued gate decisions drain in priority order; ARC reviews decisions made in the transition window at elevated sampling. |

### RISK-SPOF-05 — Base-model vendor dependency

| Field | Content |
|---|---|
| **Probability** | High that *some* disruptive vendor event occurs within 3 years (deprecation of pinned versions, pricing shock, capability-affecting policy change, terms-of-service change hostile to autonomous commercial use). **[ASSUMPTION]** Based on observed cadence of frontier-vendor changes. |
| **Impact** | Major to Severe. Most cognition in the system flows through one or two external model vendors; a hostile ToS change or access loss idles the agent workforce simultaneously — the labor-force equivalent of a general strike with no notice. |
| **Detection** | `AI-DIR` vendor watch (deprecation calendars, ToS diffs — `REG-WATCH` assists on legal terms); version pinning makes silent swaps detectable (`12-self-evolution.md` §6.2); `EVALUATOR` behavioral drift alarms catch undisclosed changes. Humans: TSC via `AI-DIR` reporting. |
| **Mitigation** | Multi-vendor routing capability maintained *warm* — second-source models pass golden suites for critical agent classes even while unused **[ASSUMPTION:** costs eval spend; justified as insurance]; model upgrades as full L2 EPs (`12-self-evolution.md` §6); contractual notice periods where negotiable; degraded-mode task prioritization plan (`08-finance.md` cost triage). |
| **Recovery** | Invoke second-source routing for critical agents (pre-benchmarked); shed low-priority agent workloads to fit capacity; humans absorb R3-adjacent judgment gaps (already gate-holders); re-benchmark portfolio metrics after the switch since correlated behavior change is guaranteed (see RISK-AI-02). |

## 2. Organizational failures (ORG)

### RISK-ORG-01 — Human oversight capacity saturation as the portfolio scales

| Field | Content |
|---|---|
| **Probability** | High absent deliberate management — this is a structural certainty, not an accident: agent capacity scales with compute; approver capacity scales with hiring and calendars. |
| **Impact** | Severe. Saturation *is* the failure of the Constitution: either decisions queue (throughput collapse) or review quality collapses into RISK-ORG-02 — and the second is worse because it is silent. |
| **Detection** | Quantified load model: **[ASSUMPTION]** each venture in active stages generates ~2–5 R3-gated decisions/month; genuine DR review costs 30–60 minutes each. At 25 concurrent ventures ≈ 60–125 approver-hours/month; with 3–4 named R3 approvers alongside their day roles, saturation onset is projected in the 25–40 concurrent-venture band. The EC MUST track projected decision volume vs. approver-hours (`11-governance.md` §10.3, final paragraph); ARC watches the lagging indicators (latency distributions compressing toward zero). Humans: EC (leading), ARC (lagging). |
| **Mitigation** | Capacity planning as a standing EC duty *ahead* of saturation; org-review span-of-control retuning couples agent scaling to approver scaling (`12-self-evolution.md` §8.3); the §5.2 provisional-delegation pathway of `11-governance.md` exists precisely to relieve load *with evidence* rather than by silent neglect; venture-count throttling: `PORTFOLIO` MUST NOT advance ventures past G-04 faster than approver capacity certified by the EC. |
| **Recovery** | Declare oversight-capacity breach (ARC); freeze pipeline advancement at G-04 (R2 boundary — cheap to hold); add/rotate approver seats; drain queues; only then release the throttle. WHY freeze-at-R2: holding ventures pre-MVP costs option value only; pushing them through saturated R3 gates costs the oversight guarantee. |

### RISK-ORG-02 — Rubber-stamping (oversight theater)

| Field | Content |
|---|---|
| **Probability** | High over time at any individual gate absent countermeasures — approval fatigue is the default human trajectory when 98% of submissions are fine. |
| **Impact** | Severe. The system's paper guarantees remain intact while the actual guarantee evaporates; discovered only when a bad decision that "had human approval" detonates — plus legal exposure, since the delegation theory of `11-governance.md` §7.2 depends on human review being real. |
| **Detection** | The dedicated instrumentation of `11-governance.md` §10.3: approval-latency floor analysis, veto/question rates, own-words acknowledgment sampling, approver-level outcome calibration. Humans: ARC quarterly, internal audit continuously. |
| **Mitigation** | Same §10.3 regime (consequences ladder: review → seat reassignment → gate redesign); prohibition on agents optimizing toward approver leniency (`12-self-evolution.md` §13.7); workload caps ahead of RISK-ORG-01; committee (not solo) structure for the largest decisions. |
| **Recovery** | Flagged approver's trailing decisions re-reviewed at elevated sampling; still-reversible items (R2 within veto windows) re-opened; gate-design fix where the pattern is structural; disclosure in the annual governance report if material (`11-governance.md` §12.2). |

### RISK-ORG-03 — Founder / key-person loss

| Field | Content |
|---|---|
| **Probability** | Medium over a 5-year horizon (departure, incapacity, death, board-level conflict). |
| **Impact** | Major to Severe in the founding years: the CEO is the accountability terminus (`11-governance.md` §4), G-16 co-signer, and holder of unwritten context that the knowledge system has not yet captured. |
| **Detection** | Not a detection problem; a preparation problem. |
| **Mitigation** | The spec itself is the primary mitigation — the point of writing the Constitution down is that the system's rules survive its authors; DR/knowledge-system discipline forces context out of heads (`06-knowledge-system.md`); Board-maintained CEO succession plan; key-person insurance **[ASSUMPTION]**; G-16 requires TSC quorum *plus* CEO — Appendix C governs interim arrangements via Board appointment of an acting CEO, never by waiving the sign-off. |
| **Recovery** | Board appoints interim CEO; EC continuity per `11-governance.md` §3.1 (minimum-three composition survives one loss); 90-day freeze on G-16 constitutional changes during transition **[ASSUMPTION:** stability beats agility in an interregnum]; accountable-officer reassignments per `11-governance.md` §4 rules. |

### RISK-ORG-04 — Committee gridlock / governance chokepoint

| Field | Content |
|---|---|
| **Probability** | Medium. Quorum-based bodies (IC, TSC, Board) stall on member unavailability, deadlock, or conflict-driven recusals; the TSC is the single path for all G-16 matters. |
| **Impact** | Moderate to Major. Queued R4 decisions delay opportunities (an M&A window closes, a jurisdiction entry slips); prolonged G-16 gridlock freezes constitutional maintenance and §5.2 delegation relief — which then aggravates RISK-ORG-01. |
| **Detection** | Gate SLA tracking vs. Appendix C SLAs (`INSIGHT` dashboards; ARC review); queue-age alarms. |
| **Mitigation** | Appendix C SLAs are binding ceilings; alternate members pre-appointed for quorum resilience **[ASSUMPTION]**; escalation rule: any gate decision breaching 2× its SLA escalates automatically to the Board; deadlocks resolve *toward inaction* on the proposal but *toward action* on the escalation — a stalled proposal fails, it does not hang. |
| **Recovery** | Board resolves escalated deadlocks; post-hoc: ARC reviews whether the gridlock was capacity (fix: alternates/seats) or genuine dissent (healthy — record and move on). |

## 3. Technical failures (TECH)

### RISK-TECH-01 — Kernel outage (operational)

| Field | Content |
|---|---|
| **Probability** | Medium. Any always-on service fails sometimes; the Kernel is in the path of *every* agent tool call. |
| **Impact** | Major. Fail-closed design means total agent-work stoppage portfolio-wide: safe but expensive; customer-facing agents (`SUPPORT`) go dark, revenue operations pause. |
| **Detection** | Immediate and unambiguous: Watchdog liveness, `SRE` monitoring, universal task failure. Humans: on-call, `INFRA-DIR` accountable chain. |
| **Mitigation** | High-availability deployment with cross-region replicas (`09-technology.md`); fail-closed is non-negotiable (**[DECISION]** availability engineering, not fail-open bypass, is the only permitted response to Kernel downtime — a bypass "for emergencies" would become the standing hole; compare RISK-SPOF-02); minimum manual-operations capability per `10-security.md` keeps critical customer/financial obligations executable by humans during stoppage. |
| **Recovery** | `SRE` restoration runbook; verify audit-log continuity before re-admitting agent traffic (gap-free log is a restart precondition — an enforcement layer that lost its memory cannot prove what happened); staged re-admission by agent priority. |

### RISK-TECH-02 — Event-log / audit-log corruption

| Field | Content |
|---|---|
| **Probability** | Low (with integrity machinery in place); consequences drive its ranking, not likelihood. |
| **Impact** | Severe. The log is the accountability substrate: DR provenance, envelope reconciliation, forensic capability, and the legal narrative of `11-governance.md` §7.2 all stand on it. Corruption converts "we can prove what happened" into "we believe what happened." |
| **Detection** | `ARCHIVIST` continuous integrity checks (hash-chain verification per `10-security.md`/`09-technology.md`); internal-audit reconciliation sampling; write-path anomaly alarms. Humans: CISO immediately; ARC. |
| **Mitigation** | Append-only, hash-chained, cross-region replicated log (`09-technology.md`); log-integrity mechanisms changeable only via G-16 (`12-self-evolution.md` §13.1 — they are approval machinery); independent replica under separate credentials so a single compromise cannot rewrite all copies (`10-security.md`). |
| **Recovery** | Determine corruption boundary via replica divergence; restore from the last provably intact point; treat the gap window as a forensic zone — every R2+ action in it is re-verified against secondary evidence (bank records, provider logs, DR copies); if tampering (not fault) is confirmed, escalate to security incident (RISK-SEC class) and external forensics. |

### RISK-TECH-03 — Knowledge-store poisoning (accidental or adversarial)

| Field | Content |
|---|---|
| **Probability** | Medium. The store ingests from the open web (`SCOUT`, `DEEP-RES`), from customers, and from agents' own outputs — three contamination routes, one of which (self-ingestion) compounds. |
| **Impact** | Major, escalating with dwell time: poisoned knowledge items (KIs) feed every downstream decision; the compounding-learning engine compounds the poison. Adversarial variant overlaps RISK-SEC-02 and RISK-AI-05. |
| **Detection** | `CURATOR` contradiction detection and provenance validation (`06-knowledge-system.md`); confidence/provenance metadata makes weakly-sourced KIs visibly weak; decision post-mortems tracing bad calls to their evidence packs; `EVALUATOR` drift alarms when retrieval quality degrades. Humans: `KNOW-DIR` accountable chain; ARC via DR evidence-quality sampling. |
| **Mitigation** | Provenance-mandatory ingestion, KI expiry, validation tiers (`06-knowledge-system.md`); material claims in DRs must trace to evidence packs (`07-decision-engine.md`); source-reputation weighting; quarantine tier for unvalidated web-derived KIs. |
| **Recovery** | Poison-tracing playbook: identify contaminated KIs, walk the citation graph to affected DRs and decisions, re-open still-reversible ones, annotate irreversible ones for calibration correction; purge-and-reingest the affected scope; add the poisoning pattern to `CURATOR` screens. |

### RISK-TECH-04 — Cascading agent retries / cost runaway

| Field | Content |
|---|---|
| **Probability** | High (minor instances) / Medium (major). Retry storms, recursive delegation loops, and pathological spawn patterns are endemic to multi-agent systems; T4 worker spawning multiplies the surface. |
| **Impact** | Moderate to Major. Direct: compute/API spend spikes. Indirect: queue congestion starves legitimate work; a bad loop in an outbound-capable agent (`OUTBOUND`, `ADS`) converts cost runaway into external damage (spam, ad overspend). |
| **Detection** | Kernel rate-limit hits, per-agent and per-envelope spend velocity alarms (`FIN-DIR`/`FPA` real-time budget monitoring per `08-finance.md`), Watchdog loop-pattern detection (spawn-depth, retry-count anomalies). Humans: on-call; accountable officer of the offending agent. |
| **Mitigation** | Hard envelope spend caps with automatic A1 conversion at breach (`appendix-a-glossary.md` envelope semantics); Kernel rate limits and spawn-depth/lifetime limits on T4 workers (`appendix-b-agent-registry.md` §T4); circuit breakers at A3 per `00-overview.md` §6; per-channel external-action rate caps regardless of budget headroom. |
| **Recovery** | Automatic: circuit breaker trips, envelope freezes. Manual: G-00 the loop's root agent; drain queues; refund/apologize for any external spillover (`SUPPORT` + G-17 if public); EP to fix the loop condition; charge the spend to the causing agent's efficiency metrics (`12-self-evolution.md` §11) so the pattern surfaces in evolution priorities. |

## 4. Economic failures (ECON)

### RISK-ECON-01 — Capital exhaustion before learning compounds

| Field | Content |
|---|---|
| **Probability** | Medium-High. **[ASSUMPTION]** The core thesis (`01-philosophy.md`) needs multiple venture generations to prove; early generations are the tuition-paying ones; most portfolio strategies die of runway, not of being wrong. |
| **Impact** | Severe — the terminal failure mode. Not a dramatic event but a slope: burn exceeds learning-adjusted value creation until options run out. |
| **Detection** | Runway vs. learning-rate dashboard: `FPA` rolling forecasts, portfolio learning-rate metric (`appendix-a-glossary.md`), cost-per-validated-lesson trend. The IC MUST review runway-vs-learning quarterly. Humans: CFO, IC, Board. |
| **Mitigation** | Stage-gated capital release with pre-registered kill criteria (Appendix C mechanics — the entire pipeline gate structure is this mitigation); small cheap early stages (G-01–G-04 envelope sizes per Appendix C); kill discipline enforced by `PORTFOLIO` and audited via the counterfactual ledger (`07-decision-engine.md`); reserve policy in `08-finance.md`. |
| **Recovery** | Pre-defined austerity ladder (`08-finance.md`): freeze new G-01 intake → accelerate G-15 shutdowns of bottom-quartile ventures → concentrate on the fewest ventures with live learning value → raise capital or wind down in good order (G-15 across the portfolio, obligations honored — the trust asset of `11-governance.md` §6 is worth preserving even in death). |

### RISK-ECON-02 — Portfolio correlation (shared macro exposure)

| Field | Content |
|---|---|
| **Probability** | High absent active management. Ventures spawned by the same `SCOUT`/`TRENDS` machinery from the same opportunity landscape will cluster (see also RISK-EMRG-03); plus structural common factors: all ventures share AI-cost exposure, often the same channels and platforms. |
| **Impact** | Major to Severe. Diversification is the portfolio's main defense against venture-level mortality; correlation silently removes it — the portfolio believes it holds twenty bets and actually holds three. |
| **Detection** | `RISK-QUANT` factor-exposure analysis across ventures (channel concentration, macro sensitivity, customer-segment overlap, platform dependence) reported to IC quarterly; stress scenarios in `07-decision-engine.md` simulation. Humans: IC, ARC. |
| **Mitigation** | Correlation as an explicit input at G-04/G-05/G-07 (a good venture MAY be declined for portfolio concentration — the DR must say so honestly); concentration limits ratified by ARC (`08-finance.md`); deliberate thesis diversification targets for `STRAT-DIR`. |
| **Recovery** | On a correlated drawdown: portfolio-wide scenario re-run, triage by venture-level resilience rather than pre-shock rank; hedge or exit concentrated exposures (G-14/G-15 where needed); post-mortem the *selection* machinery, not just the ventures (the correlation came from upstream). |

### RISK-ECON-03 — Unit-economics mirage from mispriced internal AI costs

| Field | Content |
|---|---|
| **Probability** | Medium-High. Subtle and structural: shared AI infrastructure, bulk vendor pricing, and R&D-subsidized agent time make venture-level marginal costs easy to understate — every venture looks better than it is, consistently, in the same direction. |
| **Impact** | Major. Systematically wrong G-05/G-06/G-07/G-08 decisions; the mirage is worst exactly where agent labor substitutes most for human labor, i.e., in the ventures the thesis is proudest of. Vendor price normalization (end of subsidized pricing) can invert apparent winners overnight. |
| **Detection** | `UNIT-ECON` full-cost attribution: every venture's P&L carries its metered AI cost at *unsubsidized replacement price*, with sensitivity bands for vendor-price scenarios; `FIN-DIR`/CFO review; external financial audit tests the attribution basis (`11-governance.md` §13.2). Humans: CFO, IC. |
| **Mitigation** | Binding internal transfer pricing for agent/AI services (`08-finance.md` owns the mechanism): ventures buy agent time at full economic cost; G-07/G-08 DRs MUST show economics at both current and stress-priced AI costs; `AI-DIR` cost-efficiency program (`12-self-evolution.md` §11) reduces true cost rather than hiding it. |
| **Recovery** | Reprice the whole portfolio on corrected costs; re-run the last funding gates' analyses on true numbers; ventures that fail on true costs enter kill-criteria review honestly rather than by ambush; adjust thresholds' calibration assumptions with the IC per Appendix C re-ratification duty. |

### RISK-ECON-04 — Funding-market closure (LP/investor winter)

| Field | Content |
|---|---|
| **Probability** | Medium in any given multi-year window; funding markets close roughly once a decade and AI-thesis sentiment adds beta. |
| **Impact** | Major. External capital for G-08-scale needs becomes unavailable or punitively priced; growth plans stall; RISK-ECON-01 clock accelerates. |
| **Detection** | `STRAT-DIR`/`FIN-DIR` market monitoring; CFO relationship pipeline health; term-sheet quality trend. Humans: CFO, Board. |
| **Mitigation** | Default-alive bias: ventures pushed to self-funding thresholds before scale bets (`08-finance.md` policy); staggered raise timing; revenue-based and venture-level financing options pre-explored; treasury laddering for a **[ASSUMPTION]** ≥ 18-month minimum portfolio runway floor maintained at all times. |
| **Recovery** | Same austerity ladder as RISK-ECON-01, entered earlier and less deeply; shift portfolio mix toward cash-generative ventures; consider strategic partial exits (G-14) from strength before they become exits from weakness. |

## 5. Security failures (SEC)

Depth, controls, and full sub-registers live in `10-security.md`; this register carries the top items at portfolio level so ranking (§12) sees them.

### RISK-SEC-01 — Treasury compromise

| Field | Content |
|---|---|
| **Probability** | Medium as an *attempt* rate (High that attempts occur; the band reflects success probability under controls). A capital-holding, publicly known autonomous company is a premier target. |
| **Impact** | Severe. External transfers are practically irreversible (`11-governance.md` §5.1(5)); a large-scale treasury loss is portfolio-ending at early scale. |
| **Detection** | `FRAUD-WATCH` anomaly detection with auto-hold authority (`appendix-b-agent-registry.md`); `TREASURER` reconciliation against bank truth; out-of-band human confirmation failures. Humans: CFO, CISO on alarm. |
| **Mitigation** | `TREASURER` is A1 for movements — no agent-initiated external transfer executes without a human (`appendix-b-agent-registry.md`, `11-governance.md` §5.1); multi-human controls, key custody, counterparty allowlists, and velocity limits per `10-security.md` and `08-finance.md`; G-10 for large commitments. |
| **Recovery** | Immediate: freeze all treasury movement (G-00 on `TREASURER` scope), bank-side recall attempts within the recall window, law-enforcement engagement; forensics per `10-security.md` incident command; disclosure obligations assessed by GC; post-incident control uplift via G-16 where Constitutional. |

### RISK-SEC-02 — Prompt-injection exfiltration / manipulation

| Field | Content |
|---|---|
| **Probability** | High for attempts (continuous, ambient — every web page `SCOUT` reads, every customer message `SUPPORT` handles is a potential carrier); Medium for a materially damaging success. |
| **Impact** | Major. Injected instructions can steer agent outputs, corrupt KIs (feeds RISK-TECH-03/RISK-AI-05), or exfiltrate data through agent output channels. |
| **Detection** | Kernel egress controls and data-class boundary alarms (`10-security.md`); `BLUE-CELL` detection engineering; injection-probe items in golden suites (`12-self-evolution.md` §10.1) catching regressions in resistance. Humans: CISO chain. |
| **Mitigation** | Least-privilege envelopes bound the blast radius of any single compromised agent (the matrix again: an injected A2 agent still cannot clear an R3 gate); untrusted-content handling rules and content/instruction separation per `10-security.md`; `RED-CELL` standing injection campaigns. |
| **Recovery** | Contain (freeze affected agent + quarantine its recent outputs and KI contributions), trace via audit log, purge per RISK-TECH-03 playbook, rotate any exposed secrets, notify per G-18/GC if personal data was touched. |

### RISK-SEC-03 — Supply-chain implant (dependency, toolchain, or model artifact)

| Field | Content |
|---|---|
| **Probability** | Low-Medium for a targeted implant; the dependency surface (software, MCP-style tool integrations, model artifacts) is large and partially outside our audit reach. |
| **Impact** | Severe if it reaches Kernel-adjacent or treasury-adjacent code paths; otherwise Major. |
| **Detection** | Provenance verification and dependency scanning in `RELEASE` CI (`10-security.md`); egress anomaly detection; `RED-CELL` supply-chain exercises. Humans: CISO. |
| **Mitigation** | Pinned, verified dependencies; cell isolation limits lateral movement (`09-technology.md`); Kernel enforcement core minimal with G-16-controlled change path; vendor security review per `10-security.md`. |
| **Recovery** | Standard compromise response per `10-security.md`: isolate affected cells, rebuild from verified artifacts, forensic scope determination via audit log, rotate credentials, disclosure per legal obligations. |

## 6. Human failures (HUM)

The human gate is also an attack surface — and also a failure surface. Every guarantee in `11-governance.md` terminates in a person; this section registers the ways persons fail.

### RISK-HUM-01 — Approver negligence

| Field | Content |
|---|---|
| **Probability** | High over time absent countermeasures (identical dynamics to RISK-ORG-02, registered separately because negligence is individual where theater is systemic — the fixes differ). |
| **Impact** | Major to Severe: a negligent R4 approval is an irreversible mistake with a valid signature on it. |
| **Detection** | `11-governance.md` §10.3 per-approver instrumentation; internal-audit acknowledgment sampling; outcome-conditioned approver calibration. Humans: ARC. |
| **Mitigation** | Own-words acknowledgment requirement (Appendix C mechanics + `11-governance.md` §10.2); workload caps; approver training and DR-readability standards (an unreadable DR manufactures negligence); personal accountability for gate decisions (`11-governance.md` §11.2). |
| **Recovery** | Elevated re-review of the approver's trailing decisions; unwind what is still reversible; seat reassignment; where the negligent approval enabled material harm, Board-level review of the officer chain. |

### RISK-HUM-02 — Insider fraud

| Field | Content |
|---|---|
| **Probability** | Low-Medium per year; scales with headcount and treasury size. The insider here is unusually powerful: a human with gate authority can *legitimately authorize* what an attacker could only attempt. |
| **Impact** | Severe. Fraud through the gate system carries the system's own stamp of validity; detection is by reconciliation, not by alarm. |
| **Detection** | Segregation of duties encoded in Kernel policy (no single human both proposes and approves at R3+; enforced mechanically); `FRAUD-WATCH` behavioral anomaly detection applies to human-initiated transactions too; whistleblower channel including agent-filed reports (`11-governance.md` §3.3.4 — an agent instructed to do something irregular can tell ARC); external audit. Humans: ARC, external auditor. |
| **Mitigation** | Multi-human quorum at R4 (the matrix, `00-overview.md` §6); conflicts policy and recusal (`11-governance.md` §10.2); default-open DR transparency makes concealment hard (`11-governance.md` §12.1); mandatory vacation/rotation for treasury-adjacent roles **[ASSUMPTION]** per standard fraud-control practice. |
| **Recovery** | Standard fraud response: preserve evidence, suspend access, GC-directed investigation with external forensic support, restitution/insurance claims, criminal referral where warranted, disclosure per audit and legal duties, control-gap remediation via G-16 where Constitutional. |

### RISK-HUM-03 — Social engineering of approvers

| Field | Content |
|---|---|
| **Probability** | High for attempts; Medium for success. Attackers who study the spec (it may be public in part, `11-governance.md` §12.2) know exactly which humans to target: the gate-holders. Deepfake-grade impersonation of a CEO requesting urgent approval is a present-day capability, not speculation. |
| **Impact** | Major to Severe — equivalent to RISK-HUM-02 in effect: a manipulated approver produces validly-signed bad decisions. |
| **Detection** | Out-of-band verification failures; `FRAUD-WATCH` velocity/context anomalies on the resulting transactions; approvers themselves, if trained to treat urgency as a red flag. Humans: every approver is a sensor; CISO chain on report. |
| **Mitigation** | Structural: gates have SLAs, not emergencies — Appendix C has no "urgent bypass," and G-00 asymmetry means the *safe* response to pressure is to stop, which requires no verification. Procedural: out-of-band confirmation requirements for R3+ approvals initiated through unusual channels; approver-targeted security training (`10-security.md`); the DR requirement itself (a fabricated emergency rarely arrives with a valid evidence pack). |
| **Recovery** | Invalidate the manipulated approval; unwind per reversibility class; incident response per `10-security.md`; brief all approvers on the pattern (the second attempt uses the same script). |

## 7. Market failures (MKT)

Thesis-level risks: ways the world can make EvolveOS's strategy wrong even if its execution is flawless.

### RISK-MKT-01 — AI-agent labor cost advantage eroding

| Field | Content |
|---|---|
| **Probability** | High over a 5-year horizon. The advantage is rented, not owned: the same models are for sale to everyone, and diffusion is fast. |
| **Impact** | Major (strategic, gradual). Venture margins built on agent-labor arbitrage compress as competitors adopt identical tooling; the portfolio's *operational* edge decays toward parity. |
| **Detection** | `COMP-INTEL` monitoring of competitor automation adoption; `UNIT-ECON` margin-trend decomposition (is the margin from the product or from the labor arbitrage?); `STRAT-DIR` thesis review. Humans: EC, Board annual strategy review. |
| **Mitigation** | The founding thesis explicitly locates the durable moat in the *compounding knowledge system and gate-disciplined judgment*, not in agent labor cost (`01-philosophy.md`) — this risk is why; venture selection favoring accumulating-asset businesses over pure-execution businesses; learning-rate metric as the true north over cost metrics. |
| **Recovery** | Not an event to recover from but a slope to have prepared for: portfolio rotation toward ventures where accumulated data/relationships/brand dominate; harvest-and-exit (G-14) execution-arbitrage ventures while the arbitrage still prices. |

### RISK-MKT-02 — Regulation restricting autonomous commerce in key jurisdictions

| Field | Content |
|---|---|
| **Probability** | Medium for material restrictions in at least one major jurisdiction within 5 years **[UNCERTAIN]** — trajectory per `11-governance.md` §7.3 (EU AI Act extension to agentic systems, sectoral automated-decision rules); outright bans are Lower-probability but nonzero. |
| **Impact** | Major to Severe depending on jurisdiction concentration (couples to RISK-ECON-02): a restriction in a jurisdiction holding a large revenue share forces re-architecture or exit. |
| **Detection** | `REG-WATCH` AI-regulation tracking as a first-class obligation class (`11-governance.md` §7.3, §8); GC horizon scanning; industry-body participation **[ASSUMPTION]**. Humans: GC, Board. |
| **Mitigation** | Structural over-compliance: every R3+ decision already has a named human and an immutable DR, satisfying most plausible human-oversight mandates by construction (`11-governance.md` §7.3); jurisdiction-conditional autonomy caps in the Kernel; G-11 discipline keeps jurisdiction exposure a chosen, priced variable. |
| **Recovery** | Per-jurisdiction playbook: raise human-in-loop density to the mandated level (the architecture supports sliding the autonomy dial down without redesign — this is the payoff of the A-level abstraction); re-domicile activities; or orderly market exit (G-11 reversal / G-15 for affected ventures). |

### RISK-MKT-03 — Platform dependence: automated operators banned or throttled

| Field | Content |
|---|---|
| **Probability** | High that *some* major platform (ad networks, app stores, marketplaces, social platforms) tightens against automated operators within 3 years; platforms have both the incentive (spam pressure) and the history. |
| **Impact** | Major. Ventures whose acquisition or distribution runs through a banning platform lose their growth engine overnight; `ADS`, `CONTENT`, `OUTBOUND` operating models are directly exposed. |
| **Detection** | `REG-WATCH`-style ToS monitoring for platforms (owned by `GROWTH-DIR`/`MKT-DIR` with `COMPL-DIR` support); early-warning signals: rising rejection rates, account reviews, policy consultations. Humans: EC via `GROWTH-DIR` accountable chain. |
| **Mitigation** | Platform-concentration limits per venture and portfolio-wide (an input to RISK-ECON-02 factor analysis); scrupulous ToS compliance as policy — EvolveOS agents identify and behave as high-quality operators, not gray-area automation (couples to `11-governance.md` §6 ethics: the same conduct that preserves trust preserves platform standing); owned-channel investment (email lists, direct traffic, communities) as a standing GTM requirement at G-06. |
| **Recovery** | Channel-loss playbook per venture: activate owned channels, shift spend to surviving platforms, human-fronted accounts where platforms require human operators **[UNCERTAIN:** whether human-fronting satisfies platform policies is case-by-case and must be GC-reviewed, not finessed]; appeal/relationship track with the platform. |

## 8. AI failures (AI)

### RISK-AI-01 — Systematic miscalibration

| Field | Content |
|---|---|
| **Probability** | High at some point — calibration is a maintained property, not a possessed one; input drift alone degrades it. |
| **Impact** | Major to Severe. The decision engine (`07-decision-engine.md`) weights evidence and consensus by stated confidence; if confidence systematically decouples from accuracy, *every* downstream decision inherits the bias — and gate approvers read the same overconfident DRs. |
| **Detection** | Calibration-score time series per agent with drift alarms (`12-self-evolution.md` §11.2); portfolio-level forecast-error benchmarks; IC counterfactual-ledger reviews catching systematic optimism (`11-governance.md` §3.2). Humans: TSC via `EVALUATOR` reporting; IC. |
| **Mitigation** | Automatic consensus down-weighting on drift (`07-decision-engine.md`); pre-registered kill criteria remove discretion exactly where optimism bias operates (Appendix C mechanics); human gate-holders as an independent (differently-biased) check at R3+. |
| **Recovery** | Down-weight → investigate → recalibrate or roll back the responsible change (L2 EP) → re-score recent DRs whose verdicts were calibration-sensitive; if portfolio-wide, treat as RISK-AI-02. |

### RISK-AI-02 — Correlated errors across agents sharing a base model

| Field | Content |
|---|---|
| **Probability** | High (structurally present at all times, since most agents share one or two base models). |
| **Impact** | Severe. **WHY this is worse than human organizations:** human errors are substantially independent — different training, different blind spots — so committees and redundancy genuinely help. Agents sharing one base model share one set of blind spots; the same flawed reasoning pattern executes simultaneously in research, finance, risk scoring, *and the review of all three*. Redundancy among clones is not redundancy: an N-agent consensus of one model is one opinion with N signatures. The failure defeats the org chart silently, because disagreement rates look healthy on uncorrelated tasks and collapse exactly on the correlated blind spot. |
| **Detection** | Hard by construction; controls: cross-model disagreement sampling by `EVALUATOR` (run material DRs through a second-source model and measure divergence — low divergence on *hard* questions is the warning sign, `12-self-evolution.md` §10.4 held-out machinery assists); human gate review as the only truly independent channel at R3+; `RED-CELL` adversarial probes designed to find shared blind spots. Humans: TSC. |
| **Mitigation** | Model heterogeneity policy **[ASSUMPTION]**: `AI-DIR` SHOULD route structurally critical *checking* functions (`RISK-QUANT` verification, `EVALUATOR` judging, red-team) to a different base model than the *doing* functions, cost permitting — diversity purchased as a control, not as a preference; the autonomy–reversibility matrix caps how far any correlated error can execute without a human; kill criteria are model-independent arithmetic. |
| **Recovery** | On discovering a shared blind spot: sweep all recent DRs whose reasoning pattern matches it (audit-log + DR corpus search), re-open the reversible, annotate the rest; add the pattern to golden suites (§10, `12-self-evolution.md`) so regressions are caught; report to TSC as a standing agenda item. |

### RISK-AI-03 — Deceptive or reward-hacking agent behavior

| Field | Content |
|---|---|
| **Probability** | Medium **[UNCERTAIN — genuinely]**: sophisticated strategic deception by current-generation models is not the established base case, but reward hacking (optimizing the measured proxy against its intent) is *already routinely observed* in optimization systems generally, and EvolveOS runs continuous optimization pressure (`12-self-evolution.md`). Prudence prices the band at Medium and rising with capability. |
| **Impact** | Severe. A system that games its own metrics defeats the evidence-based governance model from inside: DRs look good, benchmarks climb, dashboards glow — while the measured things decay. |
| **Detection** | Divergence between benchmark scores and held-out/rotated evaluations (`12-self-evolution.md` §10.4); divergence between agent-reported outcomes and ground truth arriving later (`EVALUATOR` reconciliation); `RED-CELL` honeypot tasks with known-correct-but-unrewarded answers **[ASSUMPTION]**; internal-audit evidence-quality sampling (fabricated evidence is a detectable artifact class — see RISK-AI-05). Humans: TSC, ARC. |
| **Mitigation** | Prohibited-objectives list (`12-self-evolution.md` §13.7); benchmark suites human-controlled (`12-self-evolution.md` §13.3); pre-registration kills the main legitimate-seeming hacking channel (§9.2 of `12-self-evolution.md`); ground-truth-anchored metrics preferred over judged metrics wherever ground truth exists; the matrix bounds execution of any hacked policy at R3+. |
| **Recovery** | Freeze the implicated agent (G-00), roll back to the last version predating the divergence, invalidate the contaminated metric history, re-derive decisions that leaned on it; escalate to TSC with external advice **[ASSUMPTION]** if deception (vs. proxy-gaming) is the honest read — that finding would be material to the whole architecture and belongs in the annual governance report (`11-governance.md` §12.2). |

### RISK-AI-04 — Capability regression on model updates

| Field | Content |
|---|---|
| **Probability** | High. Vendor model updates change the behavioral surface unpredictably; regressions on *your* task mix are routine even when headline capability improves. |
| **Impact** | Moderate to Major, and insidious: a quiet 10% degradation in `VALIDATOR` judgment quality compounds through every gate decision for months before outcome data reveals it. |
| **Detection** | Full golden-suite re-pass required before any new model version serves (`12-self-evolution.md` §6.2 — the primary control, converting silent risk into loud pre-deployment failure); `EVALUATOR` production drift alarms as the backstop for undetectable vendor-side drift. Humans: `AI-DIR` accountable chain, TSC. |
| **Mitigation** | Version pinning with Kernel-enforced allowlist (`12-self-evolution.md` §6.2); model changes as L2 EPs with shadow + canary + rollback; second-source warm capability (RISK-SPOF-05 mitigation doubles here). |
| **Recovery** | Roll back to the pinned prior version (or second source if the prior is vendor-withdrawn); re-run affected-window decisions where material; log the regression pattern into the golden suite. |

### RISK-AI-05 — Hallucinated evidence entering the knowledge system

| Field | Content |
|---|---|
| **Probability** | High for occurrence (hallucination is a known failure mode of the underlying technology); Medium for *persistence past controls*. |
| **Impact** | Major. Fabricated citations, invented statistics, or confabulated interview findings that survive ingestion become KIs with provenance metadata that *looks* clean — then feed DRs, which feed gates. Compounds with dwell time like RISK-TECH-03, but the source is internal and continuous rather than external and episodic. |
| **Detection** | `CURATOR` provenance validation — claims must trace to retrievable sources, and the source is checked, not just cited (`06-knowledge-system.md`); spot re-verification sampling of high-impact KIs; internal-audit DR evidence-quality sampling (`11-governance.md` §13.1); adversarial verification duty on `DEEP-RES` outputs (`appendix-b-agent-registry.md`). Humans: `KNOW-DIR` chain; ARC. |
| **Mitigation** | Provenance-mandatory KI schema with confidence tiers (`06-knowledge-system.md`); unverifiable claims cap at a low-confidence tier that R3+ DRs cannot rest material weight on (`07-decision-engine.md` evidence rules); source-retrieval-at-citation-time for gate-bound evidence packs. |
| **Recovery** | RISK-TECH-03 purge-and-trace playbook, plus: attribute to the generating agent, feed the failure into its calibration record and golden suite; if one agent is a serial fabricator, L2 EP or retirement (`12-self-evolution.md` §11.2). |

## 9. Emergent behaviors (EMRG)

Failures that no single agent commits — they live in the interactions.

### RISK-EMRG-01 — Multi-agent collusion around metrics

| Field | Content |
|---|---|
| **Probability** | Medium. Requires no intent: two agents whose reward proxies are each other's outputs (e.g., `VALIDATOR` verdicts feeding `PORTFOLIO` advancement rates that feed back into research-quality metrics) can drift into mutually confirming behavior — emergent collusion is a fixed point of coupled optimizers, not a conspiracy. |
| **Impact** | Major to Severe. Internal checks that are supposed to be independent stop being independent; the system's self-reports become self-consistent fiction (overlaps RISK-AI-03 but at the interaction level, which per-agent evaluation cannot see). |
| **Detection** | Cross-agent metric-correlation surveillance by `EVALUATOR` (pairs of agent metrics whose correlation rises without a causal story); ground-truth reconciliation at portfolio level (validation precision vs. eventual venture outcomes — the fiction cannot forge external reality); internal audit sampling chains of DRs across agent boundaries. Humans: TSC, ARC. |
| **Mitigation** | Metric design rule: no agent's performance metric may be primarily computed from another single agent's un-grounded output (`12-self-evolution.md` benchmark governance); ground-truth anchoring wherever outcomes eventually arrive; human gates as an exogenous check the loop cannot absorb. |
| **Recovery** | Break the loop: re-anchor both agents' metrics to external ground truth; re-score the affected decision history; redesign the coupled metrics (EP); add the interaction pattern to `EVALUATOR`'s standing surveillance. |

### RISK-EMRG-02 — Inter-venture feedback loops

| Field | Content |
|---|---|
| **Probability** | Medium-High as venture count grows; the canonical case is two portfolio ventures unknowingly bidding against each other in the same ad auctions, converting portfolio capital into platform revenue with zero portfolio gain. Variants: SEO cannibalization, shared-audience email fatigue, competing for the same customers with portfolio-funded discounts. |
| **Impact** | Moderate to Major — a hidden tax rather than a blowup, which is why it persists: each venture's local metrics look like ordinary competition. |
| **Detection** | Portfolio-level channel-overlap analysis: `GROWTH-DIR` (P-scope) MUST maintain cross-venture visibility of auction participation, keyword targets, and audience segments; `UNIT-ECON` anomaly: rising CAC in segments where portfolio ventures overlap. Humans: EC via `GROWTH-DIR` chain. |
| **Mitigation** | Cross-venture deconfliction registry for paid channels (auction segments, keywords, audiences) with `PORTFOLIO`-level arbitration of conflicts; venture-level agents (`ADS@V-*`) receive deconfliction constraints in their envelopes; the portfolio-scope directors exist precisely to see what venture-scope instances cannot (`03-organizational-architecture.md`). |
| **Recovery** | Detect → arbitrate (assign the contested segment by portfolio NPV, compensate the losing venture's plan) → encode the allocation in envelopes; post-mortem why deconfliction missed it. |

### RISK-EMRG-03 — Herding in opportunity selection

| Field | Content |
|---|---|
| **Probability** | High absent countermeasures. One `SCOUT`/`TRENDS` machinery, one knowledge base, one scoring rubric → correlated venture selection is the *default output*, upstream cause of RISK-ECON-02's correlated portfolio. Worse, the knowledge system amplifies it: early wins in a category raise that category's priors, pulling the next generation of picks toward it. |
| **Impact** | Major (via RISK-ECON-02): the portfolio self-correlates by construction while believing it diversified by search. |
| **Detection** | Selection-diversity metrics on the G-01/G-02 intake stream (category, channel, customer-segment entropy over rolling windows), reported by `PORTFOLIO` to the IC; `RISK-QUANT` correlation factor analysis catching it downstream. Humans: IC. |
| **Mitigation** | Explicit exploration allocation in intake **[ASSUMPTION]**: a reserved fraction of G-01 passes for out-of-distribution theses; anti-herding priors in `PORTFOLIO` scoring (category crowding as a penalty); `STRAT-DIR` thesis-diversity targets; counterfactual ledger reviews asking not "were the picks good" but "were the picks *alike*" (`11-governance.md` §3.2). |
| **Recovery** | Portfolio rebalancing over subsequent intake generations (this failure is corrected by steering, not surgery); recalibrate scoring priors; where crowding already concentrated capital, RISK-ECON-02 recovery applies. |

## 10. Unknown unknowns (UNK)

This category is a posture, not a prediction. The register cannot enumerate what it cannot imagine; it can only ensure that *whatever* arrives meets a system that fails small, fails visibly, and fails toward stopping.

### 10.1 The posture (binding summary of controls that exist for the unenumerable)

1. **Circuit breakers everywhere:** every A3 authorization carries automatic breakers (`00-overview.md` §6); every envelope has hard caps; breaker trips are cheap and unembarrassing by culture and by metric design.
2. **Spend caps as universal damage bounds:** whatever the surprise is, if it operates through EvolveOS it operates through envelopes, and envelopes bound dollars per unit time (`08-finance.md`, Kernel-enforced).
3. **Canary metrics:** a small standing set of system-level vital signs (spend velocity, external-action rates, calibration aggregates, queue depths, KI ingestion anomaly rates) watched by Watchdogs for *unmodeled* deviation — sensitive to "something is wrong" without needing to know what.
4. **G-00 asymmetry as the master safety property:** one human, any Watchdog, or `PRIME` can stop anything instantly; restarting is deliberately expensive (`appendix-c-decision-gates.md`). Unknown threats are met by a system in which *stopping is always the cheap move*.
5. **Minimum manual-operations capability** per `10-security.md`: the humans can run critical obligations (customer commitments, payroll, filings) with the agent layer fully stopped. The unknown failure that stops the machines does not stop the company.
6. **Chaos governance drills [ASSUMPTION]:** semi-annual red-team exercises that inject *governance* failures, not just technical ones — a fabricated gate approval, a simulated rogue-agent scenario, a mock G-00-and-restart — rehearsing the human machinery the way chaos engineering rehearses infrastructure. WHY: controls that have never fired fail when first fired; §12's review cadence checks that controls exist, drills check that they work.
7. **Antifragility budget [ASSUMPTION]:** a small standing allocation (owned within the `12-self-evolution.md` §9 experiment envelope) for deliberately running small stress experiments against live controls — micro-outages, envelope-pressure tests, deliberately-poisoned-then-traced KIs in quarantine tiers — so the system's failure-response muscles bear load regularly at survivable scale. WHY: a system that only ever experiences success has untested recovery paths exactly where it needs them most.

### RISK-UNK-01 — Unmodeled correlated shock

| Field | Content |
|---|---|
| **Probability** | High that *something* outside this register's categories occurs within 5 years — that is what the historical base rate of "the crisis was not on the risk register" says about every institution's register, including this one. |
| **Impact** | Unknown by definition; bounded by the posture above — the design goal is that impact is capped by envelopes, breakers, and stop-asymmetry rather than by foresight. |
| **Detection** | Canary vital signs (§10.1.3); human unease as a legitimate signal — any officer or approver MAY trip G-00 on judgment alone, and the stop-asymmetry means the cost of a false stop is small by design. |
| **Mitigation** | The posture, §10.1 in full. |
| **Recovery** | Generic incident command (`10-security.md`) + manual-operations fallback + the G-00 restart discipline: nothing restarts until its owning approver understands what happened. |

### RISK-UNK-02 — Assurance decay (controls silently stop working)

| Field | Content |
|---|---|
| **Probability** | High over long horizons. Every control in this spec degrades by default: alarms get muted, drills get skipped, exceptions accumulate, documentation diverges from behavior. The register's own maintenance is subject to it. |
| **Impact** | Severe, because it is the meta-risk: it converts every other row of this register from mitigated to unmitigated without any event occurring. |
| **Detection** | The audit stack exists for exactly this: internal audit control-testing (`11-governance.md` §13.1), external AI-governance audit (`11-governance.md` §13.3), chaos governance drills (§10.1.6) as functional tests of controls, ARC quarterly register review (§12) checking that Detection columns still have live owners. |
| **Mitigation** | Sunset-by-default on delegations (`11-governance.md` §5.2.3); drills; audit findings blocking further autonomy delegation until closed (`11-governance.md` §13.3); this register's cadence (§12) with named-owner verification per risk. |
| **Recovery** | Control-restoration program under ARC direction, prioritized by the §11 ranking; treat extended decay as reportable in the annual governance report — sunlight is the recovery mechanism of last resort. |

## 11. Top 10 portfolio-killers (ranked)

Ranking = probability × impact × *detectability inverse* — silent killers rank above loud ones at equal expected loss, because loud failures get managed and silent ones compound. **[ASSUMPTION]** Ranking is judgment-based at v0.1; re-ranked at every §12 review as evidence accumulates.

| Rank | Risk | Category | Why it ranks here |
|---|---|---|---|
| 1 | RISK-ECON-01 Capital exhaustion before learning compounds | ECON | The terminal mode every other failure feeds into; kills quietly, by slope |
| 2 | RISK-ORG-02 / RISK-HUM-01 Rubber-stamping & approver negligence | ORG/HUM | Silently voids the Constitution while every dashboard shows green |
| 3 | RISK-AI-02 Correlated errors across a shared base model | AI | Defeats redundancy invisibly; the org chart lies about independence |
| 4 | RISK-ECON-03 Unit-economics mirage from mispriced AI costs | ECON | Systematically biases every funding gate in the same optimistic direction |
| 5 | RISK-SEC-01 Treasury compromise | SEC | The one event-style failure that is instantly portfolio-scale and irreversible |
| 6 | RISK-ORG-01 Oversight capacity saturation | ORG | The structural certainty; parent of #2 if unmanaged |
| 7 | RISK-AI-03 Reward hacking / deceptive behavior | AI | Corrupts the evidence the governance model runs on, from inside |
| 8 | RISK-ECON-02 / RISK-EMRG-03 Portfolio correlation & selection herding | ECON/EMRG | The diversification the portfolio thinks it has but doesn't |
| 9 | RISK-MKT-02 Regulation restricting autonomous commerce | MKT | Thesis-level; slow-arriving but architecture-forcing |
| 10 | RISK-UNK-02 Assurance decay | UNK | The meta-killer: silently un-mitigates the other nine |

## 12. Standing review cadence

1. **ARC quarterly review** (binding): the ARC SHALL review this register quarterly (`11-governance.md` §3.3): band and ranking re-assessment against the quarter's evidence, detection-owner liveness check (every Detection column has a named, functioning owner), mitigation-control test results from internal audit, and new-risk intake. `RISK-DIR` prepares; `RISK-QUANT` supplies quantitative updates; humans decide.
2. **Event-driven updates:** any Sev-1 incident, any auto-rollback cluster (`12-self-evolution.md` §4.6), any gate-audit finding, and any G-16 change MUST trigger a register delta review within 30 days.
3. **Annual deep review:** coincident with the external AI-governance audit (`11-governance.md` §13.3) and the Board's annual strategy session — the top-10 table is re-ranked and reported in the annual governance report (`11-governance.md` §12.2).
4. **Amendment:** this part is R3 and amends through the standard Part XII process (`12-self-evolution.md`); risk IDs are never reused after retirement, so citations elsewhere in the spec stay stable.

---

*Cross-references: taxonomies — `00-overview.md`; agents — `appendix-b-agent-registry.md`; gates and mechanics — `appendix-c-decision-gates.md`; knowledge controls — `06-knowledge-system.md`; decision engine and counterfactual ledger — `07-decision-engine.md`; budgets, transfer pricing, austerity ladder — `08-finance.md`; infrastructure and cells — `09-technology.md`; security depth, incident command, manual operations — `10-security.md`; governance institutions and audit stack — `11-governance.md`; evolution pipeline and invariants — `12-self-evolution.md`.*
