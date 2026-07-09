# EvolveOS — Buildability Audit

**Status:** v1.0 · **Role assumed:** external CTO · **Scope:** `spec/` as of PR #1 (`67b06de`) · **Verdict:** buildable, in a deliberately narrow order — see §8.

This audit answers one question: **what in the specification can actually be engineered now, what can't, and in what order should a small team build it?** It does not re-litigate the spec's design decisions; where it disagrees, it says so and records a disposition.

---

## 1. Verified state

| Check | Result |
|---|---|
| Branch `claude/evolveos-system-specification-z5quen` | clean, up to date with origin |
| Spec files | 19/19 present (Parts 0–XV + Appendices A/B/C), ~6,700 lines |
| PR #1 | open, **draft**, mergeable state `clean`, 14 commits, +6,744/−1 |
| Gate citations | all resolve to G-00…G-18 (re-verified this audit) |
| Agent citations | all resolve to Appendix B registry (re-verified) |
| Part XV | present; 16 revisions (XV-1…XV-16) back-propagated as notes |

No mismatch with the prior handoff. Residual known blemishes (non-blocking, inherited from the additive-notes amendment convention): Part XI §3.4's original CEO-chair sentence stands un-struck (overridden by the XV-4 note), and Part XIV's horizon tables were not re-derived after XV-12 (the note pre-authorizes the slip).

## 2. Immediately implementable (concrete enough to code this quarter)

These sections contain real schemas, state machines, or data definitions that translate directly to DDL/JSON Schema/code:

| Spec asset | Where | Build artifact |
|---|---|---|
| Append-only event log (hash-chained, L0) | Part VI §1 | Postgres DDL + append-only trigger + hash chain |
| Decision Record schema | Part VII §2 | JSON Schema + DR create/validate tooling |
| Knowledge Item schema | Part VI §5 | JSON Schema + KI store |
| Gate registry + mechanics (subset) | Appendix C | Gate registry as data (YAML) + workflow engine v0 |
| Reversibility/autonomy taxonomies | Part 0 §5–6 | Enum types + the autonomy–reversibility check as one pure function |
| Pipeline macro-states (stages 1–12 only) | Part V | Venture state machine (single venture) |
| Task-contract / message envelope | Part IV §2 | JSON Schema (used by Phase 2 agent harness) |
| Privacy classes PC-0…PC-3 | Part VI §8 | Column-level classification + retrieval checks |

## 3. Too abstract to build now (and why)

| Item | Where | Why not now | Becomes buildable when |
|---|---|---|---|
| Calibration-weighted consensus | Part VII §9 | Requires outcome-labeled prediction history; none exists. Weights would be noise. | ≥ ~100 scored DRs (est. year 1–2) |
| Counterfactual proxy scoring | Part VII §11 | Needs killed options with observable proxies over time | After first ~10 kills |
| Portfolio optimization / correlation limits | Part VIII §10 | There is no portfolio; n=1 | ≥ 3 concurrent ventures |
| Self-evolution EP pipeline | Part XII | Nothing to evolve; no benchmarks, no incumbents | After Phase 2 agents have golden-task suites |
| 60 of the 68 agents | Appendix B / Part IV | MVP needs ~7 agent roles as invoked tools, not resident processes | Per capability wave (Part XIV §3) |
| Cell-per-venture infrastructure | Part IX §2 | One venture, no customers yet; cells solve a blast-radius problem we don't have | First production launch with customer data (pre-G-06) |
| Formal Kernel model (TLA+, XV-9) | Part IX / XV | Correct requirement, wrong moment; binds only **before treasury automation** (Phase 3+) | Phase 3 |

## 4. Blocked on capital / humans / legal / compliance / infrastructure

- **All committee machinery** (IC/TSC/ARC quorums ≥3): unstaffable until external independent seats exist (XV-7 acknowledges). Until then, gates G-07+ simply cannot be exercised — which is fine, because the MVP never reaches them.
- **Gates G-07…G-15** (entity formation, funding tranches, hiring plans, M&A, exit, shutdown): require lawyers, bank accounts, and capital events. Out of MVP scope by construction.
- **Treasury (Part VIII §4)**: requires banking rails, split-knowledge keys, and human co-signing hardware. Nothing here is buildable before a legal entity and a CFO function exist.
- **Full Kernel (Part IX §8: SPIFFE, OPA, capability tokens, egress gateways)**: a multi-quarter platform build. The spec itself sequences it first (Part XIV D-graph), which is correct for the *portfolio* system but would starve the pathfinder venture of a year. Resolution: **ADR-001 Minimal Kernel** (see §6, gap (a)).
- **Compliance registers per jurisdiction (Part XI §7, XV-11)**: activates at G-06/G-11; until a launch is imminent, a checklist template is enough.

## 5. Dangerous to automate early / must stay manual in v1

**Dangerous (do not automate in Phases 0–2, even if easy):**
1. Any **external communication** (email, outreach, ads, social) — `W-OUTREACH`/`ADS`/`LIFECYCLE` capabilities. One prompt-injected or hallucinated message creates R3 brand/legal exposure with zero enforcement infrastructure in place.
2. Any **payment or spend execution** — including "small" SaaS purchases by agents.
3. Any **A2+ execution** before an enforcement layer exists: A2 without Kernel-enforced envelopes is A3 in practice (nothing actually stops the agent).
4. **Auto-approval of G-01/G-02**: Appendix C grants `PORTFOLIO` A3 auto-approval, but the calibration data justifying auto-approval doesn't exist. Downgraded to A1 in the MVP (human clicks, agent recommends).
5. **Knowledge auto-validation**: unvalidated LLM output entering the KI store as "validated knowledge" poisons the moat at its root. `CURATOR` is a human role in v1.
6. **Anything touching customer PII** (PC-2/PC-3).

**Manual in v1 (by design, per the autonomy–reversibility matrix):** every gate approval; all spend; all legal artifacts; hiring; publishing; KI validation; venture kill decisions.

## 6. Contradictions, ambiguities, and gaps that would block engineering

| # | Gap / contradiction | Severity | Disposition |
|---|---|---|---|
| (a) | **No "minimal Kernel" defined.** The spec's only Kernel is the full PDP/PEP/workload-identity build; Part XIV's D1 sequences it before any live agent. Taken literally, nothing ships for ~2 quarters. | Blocking | **ADR-001**: Phase 0–2 Kernel = app-level RBAC + append-only event log + gate checks in one service boundary; agents get **no credentials to external systems at all** (stronger than envelopes: capability = zero). Full Kernel is the Phase 3 exit criterion. Spec conformance note: this *is* "manual-heavy mode" (Part XIV glossary), not a deviation. |
| (b) | **Part IV assumes Kernel-mediated resident agents**; Phase 2 runs agents as human-invoked tools with no inter-agent messaging. | Medium | Conformant under manual-heavy mode; the task-contract JSON is still used as the invocation format so Phase 3 is a transport change, not a rewrite. |
| (c) | **All dollar thresholds are unratified [ASSUMPTION]s** calibrated to $10M that doesn't exist yet. Gate envelopes (Appendix C) presuppose IC ratification. | Blocking for any spend | **Founding Ratification Pack** (Phase 0 issue): the founding humans sign a scaled-down threshold table (personal-project scale) recorded as the first entries in the event log. Until signed: zero agent-adjacent spend. |
| (d) | Residual XV blemishes: XI §3.4 un-struck sentence; XIV horizons not re-derived; XIV header not annotated for mixed class. | Cosmetic | Documented here; fix in a future spec-maintenance PR, not this one (this PR adds no further spec edits per the no-more-theory directive). |
| (e) | **Schemas are prose-embedded JSON**, not versioned machine-readable files; nothing can validate against "Part VII §2". | Blocking for tooling | Phase 0 issue: extract to `schemas/*.schema.json` + `schemas/gates.yaml`; CI validates spec↔schema drift. |
| (f) | **"Venture" vs "macro-state"**: glossary now says macro-state; Part V's Mermaid uses orthogonal regions. For n=1 venture this is over-modeled. | Low | MVP models stages 1–12 as a linear enum + a parallel "analysis block" checklist; the orthogonal-region machinery waits for stages 13–17. |
| (g) | **G-00 has no defined v1 mechanism** (spec's version presumes Watchdogs). | Medium | Phase 0 issue: a manual stop flag that halts all agent invocation paths; one human, immediate, logged. Stop asymmetry preserved. |

## 7. Overengineering risk register (defer, don't delete)

| Item | Risk if built now | Defer until (trigger) |
|---|---|---|
| Kafka-class event backbone | Ops burden for ~10² events/day; Postgres table does this | > ~10⁵ events/day or > 1 venture cell |
| SPIFFE/OPA/capability tokens | Weeks of infra for agents that hold zero credentials anyway | Phase 3 (first A2 grant) |
| 19-gate engine | 8 gates are exercisable pre-entity (G-00…G-06, G-17, G-18) | Model all 19 as *data* now; implement workflow for 8 |
| 68-agent registry runtime | 7 roles suffice; the rest is config debt | Keep registry as reference data; instantiate per wave |
| Token-budget metering | Premature optimization; a monthly spend cap on the API key achieves XV-5's intent | First A2 agent |
| Knowledge graph + vector + marts | Three stores for hundreds of documents | Postgres full-text + JSONB provenance until > ~5k KIs |
| Cell-per-venture | One venture | Pre-G-06 launch |

## 8. Verdict and PR #1 recommendation

**The specification is coherent and buildable** provided the build follows the narrowing this audit defines: one venture (pathfinder rule XV-12), eight gates, seven agent roles at A0/A1, one Postgres database, and a Minimal Kernel that substitutes *capability absence* for *capability enforcement*.

**PR #1 should remain in draft** until one specific human act occurs — not further work by the agent side:

- All four readiness criteria are met: the spec is internally coherent (re-verified §1), the MVP is defined (`MVP_SCOPE.md`), the Phase 0/1 backlog exists as real issues, and no blocking contradiction remains un-dispositioned (§6 all have owners).
- **But** the spec's own constitutional logic requires that its binding layer be *ratified by the humans it binds* (Part 0 §4; Appendix C thresholds are explicitly "pending ratification"). Merging the Constitution to `main` on the strength of AI self-review alone would be the exact "oversight theater" the spec prohibits (Part XI). The founding reading act is small: Part 0 + Appendix C + this audit (~30–40 min).
- **Flip to ready when:** the repository owner has read those three documents and either approved or requested changes. Nothing else is pending.

## 9. What was deliberately NOT done in this PR

No further spec expansion; no spec rewrites for §6(d) blemishes; no code scaffolding (that's issue #Phase-0-11, after stack ratification in ADR-008); no issue creation for Phases 2–3 (their shape depends on Phase 1 learnings — creating them now would be the planning-theater version of overengineering).
