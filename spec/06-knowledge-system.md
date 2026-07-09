# EvolveOS Specification — Part VI: Knowledge System

**Status:** Draft v0.1 · **Change class:** R3 (standard amendment process, Part XII)

Part VI defines the complete memory architecture of EvolveOS: what the system remembers, in what structures, with what guarantees, and how memory is validated, retrieved, expired, compressed, and archived. The knowledge system is the substrate of the portfolio learning rate (glossary; Part I): every venture the pipeline (`05-business-creation-pipeline.md`) runs — and especially every venture it kills — MUST leave the system smarter. Owning agents: `KNOW-DIR` (architecture operation, retrieval quality), `CURATOR` (validation, dedup, contradiction detection, expiry review), `ARCHIVIST` (compression, tiering, retention, audit-log integrity). Consumers: every agent in Appendix B; primary structured consumers are the decision engine (`07-decision-engine.md`) and the evolution loop (`12-self-evolution.md`).

---

## 1. Core architecture decision

**[DECISION]** The source of truth is an **append-only event log**. Everything the system experiences — tool calls, task contracts, DRs, gate decisions, experiment results, external observations, human approvals, incident timelines — is written as an immutable, ordered, hash-chained event. All other stores (knowledge graph, vector indexes, relational marts, caches) are **derived views**, rebuilt or incrementally updated from the log. Knowledge Items (KIs, §5) are themselves versioned records whose lifecycle events live in the log.

Alternatives compared:

| Criterion | (chosen) Event log + derived views | (a) Mutable database-of-record | (b) Pure vector-store memory | (c) Fine-tuning as memory |
|---|---|---|---|---|
| **Auditability** | Total: every state is a fold over signed events; regulators/auditors replay history | Weak: UPDATE destroys the prior state unless bolted-on history tables (which then *are* an event log, badly) | Very weak: embeddings are not evidence; no record of what was known when | None: knowledge is diffused into weights; cannot show what the system "knew" at decision time |
| **Reproducibility** | Any past decision context reconstructable: replay log to timestamp T, rebuild views | Point-in-time reconstruction unreliable | Index state at T unrecoverable after reindexing | Impossible without archived checkpoints per decision — cost-prohibitive |
| **Contradiction handling** | Contradictions coexist as events; `CURATOR` adjudicates explicitly, supersedence recorded (§11) | Later write silently overwrites earlier truth — contradictions are *destroyed*, not resolved | Contradictory chunks both retrieved; resolution pushed to inference time, unlogged | Contradictions blend into averaged weights; neither claim recoverable |
| **Derived-view evolution** | New view types (better graph schema, new embedding model) rebuilt from log at any time | Migration projects with data loss risk | Locked to embedding model unless raw text retained (then text store is the real record) | Retraining from scratch |
| **Model independence** | Full: log is model-agnostic; agents/models swap freely (Part XII) | Full | Partial (embedding coupling) | None — memory dies with the model |
| **Cost/latency** | Higher write-path and storage cost; reads served by views so query latency unaffected | Cheapest | Cheap | Expensive, slow update cycle |

WHY the decision is forced, not preferential: Part XI requires that any R3/R4 decision be auditable years later ("what did the system know, from which sources, when it decided X?"), and Part XII requires benchmarking new agent versions against *historical* decision contexts (shadow mode, glossary). Both requirements are unsatisfiable under (a), (b), or (c). Vector stores and fine-tuning remain in the architecture — but strictly as **derived, disposable acceleration layers** (§9, §14), never as the record. **[UNCERTAIN]** The write-amplification cost at portfolio scale is estimated, not measured; `INFRA-DIR` MUST benchmark log throughput in Phase 1 (Part XIV) — mitigation if needed is log partitioning per venture cell, not mutation.

### 1.1 Layered architecture

```
L0  EVENT LOG (append-only, hash-chained, partitioned by venture/portfolio scope)  ← source of truth
L1  KNOWLEDGE ITEMS (versioned claims with provenance; lifecycle events in L0)
L2  DERIVED VIEWS: knowledge graph · vector indexes · relational marts · DR store
L3  RETRIEVAL & ASSEMBLY: hybrid search, retrieval policies, working-memory builder
```

Binding rules: (1) No agent MAY write to L2 directly; L2 is materialized only by `PIPELINE-ENG`-owned projection jobs from L0/L1 (write path integrity is Kernel-enforced). (2) Any L2 store MAY be dropped and rebuilt; the system MUST tolerate rebuild windows (degraded retrieval, never data loss). (3) Every L3 retrieval result carries provenance pointers back to L1/L0 (§10).

---

## 2. Memory taxonomy overview

| Memory type | Analogue | Primary structure | Owner | Section |
|---|---|---|---|---|
| Working memory | Short-term / attentional | Assembled context per task | task's agent + `KNOW-DIR` policy | §3 |
| Semantic memory | Facts about the world | Knowledge graph of KIs | `CURATOR` | §4 |
| Procedural memory | Skills | Playbook store | `KNOW-DIR` (benchmarks: `EVOLVE`) | §6 |
| Episodic memory | Experiences | Event log + project/venture memory | `ARCHIVIST` | §7 |
| Customer memory | Relationship record | Per-venture CRM-linked KIs, privacy-classed | `CS-DIR` data, `PRIVACY` policy | §8 |
| Market memory | Environment model | Market subgraph + time series marts | `CURATOR` + `DATA-DIR` | §9 |
| Failure memory | Scar tissue | Post-mortem KIs + counterfactual ledger | `CURATOR` | §10 |
| Decision history | Judgment record | DR store + counterfactual ledger | `KNOW-DIR` (schema: Part VII) | §10 |

---

## 3. Short-term / working memory

Working memory is **assembled per task, discarded after task completion** — nothing an agent "remembers" persists unless written to L0 as events or proposed as KIs. WHY: persistent private agent memory is unauditable and breeds divergence between what an agent believes and what the system can verify; forcing persistence through the log keeps the record singular.

**Context assembly (binding order):**
1. **Task contract** (glossary) — objective, constraints, envelope slice, acceptance criteria. Always first, never truncated.
2. **Retrieved KIs** — via the retrieval policy for the agent's tier (§14), with provenance and confidence attached inline.
3. **Episodic recency window** — the agent's own recent relevant events (its last actions on this venture/task lineage) from L0, most-recent-first.
4. **Standing policy extracts** — the Constitutional and envelope constraints applicable to the task (Kernel-supplied, non-negotiable inclusion).

**Token-budget policy [ASSUMPTION]** (defaults; `AI-DIR` owns per-model calibration, changes are R2 via Part XII):

| Agent tier | Context budget split (contract / KIs / episodic / policy) | Rationale |
|---|---|---|
| T1 orchestrators | 15% / 45% / 25% / 15% | Broad synthesis: knowledge-heavy, needs cross-venture KIs |
| T2 directors | 15% / 40% / 30% / 15% | Domain depth plus operating continuity |
| T3 specialists | 20% / 35% / 35% / 10% | Task precision; episodic continuity of in-flight work |
| T4 workers | 30% / 30% / 25% / 15% | Narrow tasks; contract dominates; minimal retrieval (cost control) |

Overflow rule: when retrieval exceeds budget, rank by (relevance × confidence × recency-adjusted-for-TTL) and truncate lowest; truncation events are logged so `KNOW-DIR` can detect systematic context starvation (a retrieval-quality metric, §16).

---

## 4. Semantic memory: the knowledge graph

Semantic memory is the graph of validated claims about the world, stored as KIs (nodes/edges reference KI ids) and materialized as a property graph (storage §13.2).

**Entity/relation ontology** (v0.1; extending the ontology is R2 via `KNOW-DIR` EP; entity types are deliberately few — WHY: ontology sprawl is the classic knowledge-graph death, and every type added multiplies curation cost):

| Entity type | Key attributes | Example relations (→ target) |
|---|---|---|
| **Market** | definition, geography, size estimates (as KIs), maturity | `contains` → Market (segment); `governed_by` → Regulation; `served_by` → Product |
| **Company** | legal name, jurisdictions, size class, status | `competes_in` → Market; `offers` → Product; `partner_of`/`acquired` → Company |
| **Person (role-level)** | role, org, expertise class — **role-level, not dossier**: attributes limited to professional function; personal-data enrichment beyond role context requires **G-18** | `holds_role_at` → Company; `decision_maker_for` → Product/deal class |
| **Product** | category, pricing model, channel mix, lifecycle stage | `substitutes` → Product; `sold_via` → Channel; `depends_on` → Product/platform |
| **Channel** | type, cost dynamics, audience | `reaches` → Market; `benchmarked_by` → KI (channel economics) |
| **Regulation** | jurisdiction, scope, effective dates, obligations | `applies_to` → Market/Product/data class; `monitored_by` → `REG-WATCH` feed |
| **Playbook** | version, domain, parameters, benchmark record | `applies_to` → stage/Market; `supersedes` → Playbook |
| **Venture** | `V-<yyyy>-<seq>`, macro-state (Part V), envelope refs | `targets` → Market; `operates` → Product; `learned` → KI |
| **Decision** | `DR-<yyyy>-<seq>`, gate, outcome links | `chose`/`rejected` → option; `informed_by` → KI; `superseded_by` → Decision |
| **KI** (reified claim) | full schema §5 | `supports`/`contradicts` → KI; `derived_from` → provenance source |

Every edge is itself claim-like: edges carry confidence, provenance, and TTL exactly as node-claims do (an edge is a KI of type `relation`). WHY reify edges: "Company A competes with B" decays and can be wrong — it needs the same validation machinery as any other claim.

---

## 5. The Knowledge Item (KI) schema

The KI is the atomic unit of validated knowledge (glossary). Canonical serialization:

```json
{
  "id": "KI-2027-018342",
  "type": "market_fact | relation | benchmark | playbook_param | regulation | post_mortem_finding | customer_insight | counterfactual",
  "claim": "Mid-market EU logistics SaaS displays median CAC payback of 14 months via outbound-led motion.",
  "scope": {
    "entities": ["market:eu-logistics-saas", "channel:outbound"],
    "ventures": ["V-2027-004"],
    "jurisdictions": ["EU"],
    "valid_from": "2027-03-01"
  },
  "confidence": {
    "score": 0.72,
    "method": "curator_triangulation_v2",
    "last_assessed": "2027-06-14"
  },
  "provenance": [
    {"source_type": "experiment", "ref": "evt://V-2027-004/exp-0119", "quality": "primary"},
    {"source_type": "external_doc", "ref": "evidence-pack://EP-2027-2214/item-7", "quality": "secondary"},
    {"source_type": "interview", "ref": "evt://V-2027-004/int-0032", "quality": "primary"}
  ],
  "created": "2027-06-02T11:40:00Z",
  "created_by": "UNIT-ECON",
  "validated_by": {"agent": "CURATOR", "workflow": "triangulate-v2", "human": null},
  "expires": "2028-06-02T00:00:00Z",
  "supersedes": "KI-2026-009911",
  "superseded_by": null,
  "privacy_class": "PC-1",
  "embedding_refs": [
    {"index": "ki-main-v3", "model": "emb-2027a", "vector_id": "v-88213"}
  ]
}
```

Binding rules: `provenance` MUST be non-empty (a claim without provenance is not a KI; it is at best a hypothesis event in L0). `confidence` is a calibrated probability, not a vibe — `CURATOR`'s scoring methods are themselves benchmarked by `EVALUATOR` against later-verified outcomes. `supersedes`/`superseded_by` form the supersedence chain (§11). `privacy_class` per §8. `embedding_refs` are disposable pointers into L2 (§14). KIs are immutable once created; corrections create a new version that supersedes.

---

## 6. Procedural memory: playbooks

A playbook (glossary) is a versioned, parameterized, benchmarked procedure distilled from repeated successful execution. Schema (stored as KI-linked documents; lifecycle events in L0):

```json
{
  "playbook_id": "PB-VALIDATION-LANDING-v7",
  "domain": "validation",
  "applies_to": {"stages": ["Validation"], "market_classes": ["b2b-saas"]},
  "preconditions": ["ICP hypothesis exists", "pre-registered thresholds in G-02 DR"],
  "parameters": {"traffic_budget": {"default": 3000, "range": [1000, 8000], "unit": "USD"}},
  "steps": ["..."],
  "expected_outputs": ["conversion estimate with CI", "evidence pack"],
  "benchmark_record": {"runs": 41, "success_rate": 0.63, "vs_prior_version": "+9pp", "benchmark_ref": "evt://evolve/bench-2027-112"},
  "kill_conditions": ["traffic quality below floor", "instrumentation failure"],
  "version": 7, "supersedes": "PB-VALIDATION-LANDING-v6",
  "owner": "KNOW-DIR", "benchmarked_by": "EVOLVE"
}
```

Rules: agents SHOULD execute the highest-benchmarked applicable playbook version and MUST log deviations with rationale (deviation + outcome pairs are the raw material for the next version). New versions ship only through the Part XII evolution protocol (shadow mode, benchmark, rollout); `EVOLVE` owns benchmarking, `KNOW-DIR` owns the store. WHY benchmarked versioning: an unbenchmarked "best practice" is folklore; the moat is knowing *with a success-rate number* which procedure works in which market class.

## 7. Project and venture memory

- **Project memory:** every task lineage (task contract tree) is reconstructable from L0 — who asked for what, what was done, what it cost, what it produced. Project summaries are compressed per §17 at lineage close.
- **Company/venture memory:** each venture `V-<yyyy>-<seq>` has a **namespace** spanning L0 partitions, its KI scope, its DR set, and its cell's operational telemetry. The venture namespace is the unit of: archival at Shutdown/Exit (Part V stages 22–23), knowledge disposition at Exit (what transfers vs. what the portfolio retains), and consolidation at Merger. **Merger namespace consolidation rule** (referenced by Part V §7): both namespaces are preserved intact in L0; a merged view is built on top; where the two ventures' KIs contradict, `CURATOR` adjudicates explicitly (§15) — silent merge is prohibited. Venture memory outlives the venture: archived namespaces remain queryable (tier rules §13.5) because dead ventures are the training set.

## 8. Customer memory

Customer memory is per-venture (cell-scoped; cross-venture sharing is **not** default — WHY: blast-radius and privacy: cross-venture customer data pooling is exactly the "data use outside approved classification/purpose" that **G-18** exists to gate).

**Privacy classes PC-0…PC-3** (assigned by `PRIVACY`, enforced by the Kernel on every retrieval). Namespace note: privacy classes (personal-data sensitivity, this part) are distinct from the confidentiality data classes C0–C4 and the provenance labels P0–P4 defined in Part X (`10-security.md`) — the three taxonomies answer different questions (whose data is it / how secret is it / how trusted is its source) and all three can attach to one item:

| Class | Content | Storage & retrieval rules |
|---|---|---|
| **PC-0 — Public** | Published info, public firmographics | Freely retrievable, portfolio-wide |
| **PC-1 — Business-confidential** | Contract terms, usage aggregates, win/loss | Portfolio-wide for aggregated/derived KIs; raw records venture-scoped |
| **PC-2 — Personal data** | Names, contact details, role-level person records, support transcripts | Venture-scoped; purpose-bound to collection purpose; any expansion of use → **G-18**; DSR deletion honored via crypto-erasure (§12) |
| **PC-3 — Sensitive personal / regulated** | Payment data, health-adjacent, minors, special categories | Venture cell only, encrypted with per-class keys (`10-security.md`), retrieval whitelist per agent, every access logged as an L0 event; any new use → **G-18**, no exceptions |

Cross-venture customer *learning* is achieved legitimately by promoting **aggregated, de-identified** insights to PC-1 KIs (`PRIVACY` reviews the aggregation before promotion). Customer memory content: relationship history, health scores (`ONBOARD`), support history (`SUPPORT`), voice-of-customer insights (`CS-DIR`), consent and preference records (authoritative, drives `W-OUTREACH` envelopes).

## 9. Market memory

Market memory = the Market/Company/Product/Channel/Regulation subgraph (§4) plus time-series marts (§13.4): sizing estimates, pricing observations, channel cost curves, competitor moves, regulatory changes. Producers: `SCOUT`, `TRENDS`, `DEEP-RES`, `COMP-INTEL`, `REG-WATCH`; validation by `CURATOR`. Two properties distinguish it: (i) it decays fastest (§16 TTLs) — a CAC benchmark is stale in months; (ii) it is the most cross-venture-leveraged memory: every pipeline stage 1–9 (Part V) reads it, and every venture writes back what contact with the market taught. Every archived venture's research dossier and competitive map are promoted into market memory rather than buried with the venture (Part V stage failure-handling clauses depend on this).

## 10. Failure memory and decision history

**Failure memory** stores post-mortems as first-class KIs (`type: post_mortem_finding`): root causes, the gate-by-gate prediction audit (what each gate's DR predicted vs. what happened), falsified assumptions, and pattern tags that `SCOUT`/`PORTFOLIO` screen new opportunities against (Part V stage 1 kill criteria cite failure-memory collisions).

WHY failure data is the moat — stated as a binding design premise: success data is abundant, public, and survivorship-biased; **calibrated failure data is scarce, private, and causally informative**. Nobody publishes their kill criteria, their pre-registered predictions, or their post-mortems with provenance. A portfolio that runs hundreds of pre-registered experiments per year (Part V §4: ~1,000 briefs → ~2 ventures) generates a proprietary base-rate dataset — *which validation signals predict PMF, which don't, per market class* — that no competitor can buy and no model can be prompted into. Every kill therefore has a mandatory knowledge-extraction step (Part V, every stage's failure handling), and post-mortem completeness is a gated metric at G-15 (Part V stage 23). Deleting failure memory is prohibited; it never expires, only compresses (§17).

**Decision history** is the DR store (schema owned by `07-decision-engine.md`): every R2+ decision as an immutable DR, linked into the graph (`Decision` entities, §4). Attached to it is the **counterfactual ledger** (glossary): rejected options, kill decisions, and passed deals, each with predicted outcomes, later scored against observed reality where possible. `EVALUATOR` computes agent and approver calibration scores from exactly this join (prediction events × outcome events), feeding consensus weights in Part VII and retraining/retirement triggers in Part XII.

---

## 11. Versioning and supersedence

- KIs are immutable; a correction or update creates a new KI with `supersedes` set; `CURATOR` sets `superseded_by` on the old KI (its only mutable field, and the mutation is itself an L0 event).
- **Supersedence chains** MUST be walkable in both directions; retrieval (§14) returns only chain heads by default, with the chain available on demand (WHY: an agent sometimes needs to know what the system *used to believe* — e.g., when auditing an old DR, the reconstruction uses the chain state at decision time).
- Supersedence is not deletion: superseded KIs retain provenance and remain citable by historical DRs.
- Conflicting heads (two unresolved contradicting KIs) are a first-class state: both carry a `contradicts` edge and a `CURATOR` triage ticket; retrieval returns **both**, flagged (§15). Silent last-write-wins is prohibited — this is the concrete payoff of the §1 decision.
- Playbooks version per §6 (benchmark-gated). Ontology versions per §4 (R2 EP). Embedding index versions per §14.3.

## 12. Audit logs

- L0 events are **hash-chained** (each event includes the hash of its predecessor per partition) with periodic **anchoring**: partition head hashes are cross-signed into the portfolio root chain **[ASSUMPTION]** hourly, making tampering detectable at ≤ 1h granularity. `ARCHIVIST` runs continuous integrity verification; a chain break is a security incident (G-00-eligible, `SEC-DIR` incident command).
- Write path: only the Kernel writes L0 (agents emit; Kernel signs, sequences, appends). No agent — including `ARCHIVIST` — has delete or rewrite capability; retention transitions (§13.5) move ciphertext between tiers without altering the chain.
- **Retention [ASSUMPTION]:** decision-relevant events (DRs, gate events, approvals, envelope changes): ≥ 10 years or longer per jurisdiction. Operational telemetry: 3 years full, then compressed summaries (with the §17 pointer guarantee). Financial events: per statutory requirement, jurisdiction-max. Personal data inside events: subject to DSR erasure via **crypto-erasure** — PC-2/PC-3 payloads are envelope-encrypted per data subject; erasure destroys the key, leaving the chain intact with an unreadable payload and an erasure event recorded. WHY crypto-erasure: it is the only construction that satisfies both immutability (audit) and erasure (privacy law) simultaneously.

## 13. Storage layer

### 13.1 Event log (L0)
Partitioned append-only log: one partition set per venture namespace plus portfolio-scope partitions. Ordering guarantee within partition; cross-partition causality via task-contract references. Technology selection is delegated to `09-technology.md`; Part VI binds the *contract*: append-only, hash-chained, replayable, partition-isolatable per cell.

### 13.2 Knowledge graph (L2)
Property-graph materialization of §4, rebuilt/updated by projection from KI lifecycle events. Query interface: graph pattern queries (typed traversals) exposed to agents through the retrieval service (§14) — agents do not hold raw graph credentials (Kernel mediation, privacy-class filtering at query time). Rebuild-from-log is a tested runbook (`PIPELINE-ENG`), exercised **[ASSUMPTION]** quarterly — an untested rebuild is a fictional guarantee.

### 13.3 Vector storage (L2)
- **Embedding strategy:** embed the KI `claim` + scope labels (not raw documents) for the primary KI index; raw evidence documents are chunked and embedded in separate per-corpus indexes (research corpora, interview transcripts, contracts) with chunk→document→provenance pointers.
- **Chunking [ASSUMPTION]:** semantic chunking at 200–500 token targets with structural boundaries (sections, Q&A turns) preferred over fixed windows; every chunk carries its source ref — a chunk without provenance is unretrievable by policy.
- **Reindexing on model change:** embedding model changes are Part XII EPs. New model → build a parallel index (`embedding_refs` supports multiple), run shadow retrieval comparison (`EVALUATOR` scores retrieval quality on the benchmark set §16), cut over, then delete the old index. WHY parallel-then-cutover: embeddings from different models are not comparable; mixed-index retrieval silently degrades.

### 13.4 Relational storage (L2)
Analytic marts projected from L0 for finance and analytics: ledger mart (`LEDGER`/`FIN-DIR` — the accounting *books of record* remain the double-entry system defined in `08-finance.md`, itself an L0 event consumer), cohort/unit-economics marts (`UNIT-ECON`, `INSIGHT`), funnel marts for the Part V throughput model, experiment-results marts (`DATA-DIR` methodology). Schema evolution by `PIPELINE-ENG` with data-quality tests; marts are droppable/rebuildable like all L2.

### 13.5 Archival strategy
| Tier | Criteria (any) | Media/latency | Examples |
|---|---|---|---|
| **Hot** | Active ventures; KIs unexpired; events < 90 days **[ASSUMPTION]** | Online, ms | Operating venture namespaces, current market memory |
| **Warm** | Archived ventures < 2 years; superseded KIs; events 90d–3y | Online, seconds | Recently killed ventures (still heavily queried by pipeline stages 1–4) |
| **Cold** | Ventures archived > 2 years; compressed telemetry; exited-venture retained namespaces | Object storage, minutes–hours | Prototype code archives (Part V stage 10), old evidence corpora |

Tiering is executed by `ARCHIVIST` per policy; **failure memory and DR/counterfactual stores never leave hot/warm** regardless of age (they are the highest-value-per-byte data in the system). Retrieval from cold is asynchronous and logged; a spike in cold retrievals for a topic is a signal to `CURATOR` to re-promote and re-validate that knowledge.

---

## 14. Search and retrieval

### 14.1 Hybrid retrieval
Every retrieval request fans out across three channels and fuses results:
1. **Lexical** (exact/BM25 over claims, DRs, documents) — WHY: identifiers, names, legal terms, and numbers are where pure vector search fails worst.
2. **Vector** (per §13.3 indexes) — semantic similarity, cross-lingual reach.
3. **Graph** (typed traversal from entity anchors: "everything within 2 hops of market:X with confidence ≥ 0.6") — WHY: relational questions ("who competes with the companies that sell via this channel?") are graph queries, not similarity queries.

Fusion ranks by (channel-normalized relevance × confidence × TTL-adjusted freshness), deduplicates by supersedence chain (heads only, §11), applies privacy-class filters (§8) and scope filters, and **always attaches provenance and confidence inline** — an agent never receives a naked claim. Contradiction flags are surfaced, never suppressed (§11).

### 14.2 Retrieval policy per agent tier **[ASSUMPTION]** (defaults; `KNOW-DIR` tunes via R2 changes)

| Tier | Default scope | Depth | Notes |
|---|---|---|---|
| T1 | Portfolio-wide, all PC-0/PC-1 | High (broad fan-out, 2-hop graph) | Orchestration needs cross-venture pattern access |
| T2 | Own domain portfolio-wide + own venture full | Medium-high | Domain directors get deep domain slices |
| T3 | Own venture + domain-relevant portfolio KIs | Medium | Specialists get precision, not breadth |
| T4 | Task-scoped whitelist inherited from spawner's contract | Low, capped | Workers retrieve only what the contract scopes — cost and exfiltration control |

PC-2/PC-3 access is orthogonal to tier: whitelist per agent per purpose (§8), Kernel-enforced.

### 14.3 Interfaces
- **Decision engine (Part VII):** gate evaluations issue *evidence-pack queries* — retrieval with a completeness contract (the DR schema requires that every material claim resolve to KI/provenance refs). The retrieval service returns a machine-checkable evidence pack; missing-evidence gaps are listed explicitly so the DR shows what was *not* known.
- **Evolution loop (Part XII):** `EVOLVE`/`EVALUATOR` consume the prediction×outcome joins (§10), playbook benchmark records (§6), and retrieval-quality metrics (§16) as standing datasets; shadow-mode runs read historical contexts reconstructed from L0 (the §1 reproducibility guarantee is what makes Part XII benchmarking honest).

## 15. Knowledge validation (`CURATOR` workflows)

1. **Intake triage:** new candidate KIs (agent-proposed) are queued; `CURATOR` (A3) checks schema completeness, provenance non-emptiness, scope sanity, and duplicate/supersedence candidates.
2. **Source triangulation:** confidence scoring by source-count, source-independence (shared upstream sources are collapsed — two articles citing one press release are one source), source-quality priors (primary experiment > primary document > secondary), and internal consistency with high-confidence neighbors. Method versions are benchmarked (`EVALUATOR`) against later-verified truth; the scoring method id is recorded in the KI (§5 `confidence.method`).
3. **Contradiction detection:** on KI admission, `CURATOR` queries for semantic-neighborhood and graph-neighborhood claims with incompatible content; detected contradictions create `contradicts` edges + triage tickets. Resolution outcomes: supersede (one claim wins), scope-split (both true in different scopes — the most common real outcome), or hold-both-flagged (insufficient evidence; retrieval shows both).
4. **Escalation:** contradictions involving Constitutional constraints, active R3/R4 DRs, or regulatory claims escalate to `KNOW-DIR` and the affected director; regulatory contradictions additionally alert `REG-WATCH`/`COMPL-DIR`.
5. **Expiry review (§16)** and **poisoning review (§17.2)** run as standing workflows.
Throughput guard: `CURATOR` validation latency is a portfolio SLA (owned here: **[ASSUMPTION]** P50 ≤ 24h, P95 ≤ 5 days for standard KIs); a growing validation queue is an early-warning metric — unvalidated knowledge silently rots decision quality.

## 16. Knowledge expiration

Every KI carries `expires` (§5), defaulted by type and overridable with justification. Expiry ≠ deletion: expired KIs drop out of default retrieval and enter `CURATOR` re-validation queues (re-validate, supersede, or archive).

**Default TTL table [ASSUMPTION]** (owned by Part VI; tuning is R2):

| Knowledge type | Default TTL | WHY |
|---|---|---|
| Channel economics (CAC, CPMs, conversion benchmarks) | 90 days | Auction dynamics and algorithm changes move monthly |
| Competitor state (pricing, positioning, headcount signals) | 120 days | Competitive moves quarterly |
| Market sizing / growth estimates | 12 months | Re-estimated annually by credible sources |
| Customer insights (needs, WTP) per segment | 12–18 months | Needs drift with tooling and macro cycles |
| Regulatory obligations | until amended (event-driven expiry via `REG-WATCH` triggers, not clock) | Law changes by event, not decay |
| Jurisdiction/entity/tax structure knowledge | 24 months + event triggers | Slow-moving, high reuse (Part V stage 19) |
| Playbook benchmark records | until superseded by newer benchmark ≥ n runs | Evidence-based, not time-based |
| Physical/technical constants, formal methods | none (no expiry) | Physics doesn't decay |
| Post-mortem findings / failure patterns | none (no expiry; periodic re-contextualization review at 24 months) | The moat (§10); but applicability scopes need re-checking |
| Internal operational baselines (costs, SLOs) | 6 months | Drift with scale and vendor changes |

Retrieval applies **TTL-adjusted freshness** continuously (a KI at 80% of TTL ranks below an equivalent fresher claim) rather than cliff-expiring — WHY: staleness is gradual; a cliff creates a day-before/day-after inconsistency in decisions.

## 17. Knowledge compression

### 17.1 Progressive summarization
`ARCHIVIST` compresses aging material through summary levels: L-raw (full evidence) → L1 summary (per-document/episode) → L2 synthesis (per-project/venture/topic) → L3 digest (portfolio-level pattern). Binding rules: (1) every summary node carries **pointers back to the exact raw evidence spans it summarizes** — provenance is never destroyed, only the *default retrieval depth* changes; (2) summaries are themselves KIs with `derived_from` provenance and confidence ≤ min(confidence of inputs); (3) any agent MAY dereference a summary to raw evidence (cold-tier latency applies, §13.5); (4) DR evidence packs pin their raw evidence against compression re-tiering below warm for the DR retention period (§12) — an audit MUST NOT hit "summarized away".

### 17.2 Failure modes and mitigations

| Failure mode | Symptom | Mitigation |
|---|---|---|
| **Stale knowledge** | Decisions cite expired-adjacent KIs; forecast errors correlate with KI age | TTLs + freshness-decayed ranking (§16); staleness share of retrieved KIs per DR is a tracked metric; `CURATOR` expiry queue SLA |
| **Knowledge poisoning** (bad external data, adversarial content, compromised agent writing false KIs) | Contradiction spikes; single-source high-confidence claims; anomalous KI-write patterns | Provenance mandatory + source-independence collapsing (§15); confidence caps for single-source claims (**[ASSUMPTION]** ≤ 0.5 until triangulated); `FRAUD-WATCH`-style anomaly detection on KI-write behavior by `EVALUATOR`; L0 immutability makes poisoning *attributable and reversible by supersedence*; `RED-CELL` runs periodic poisoning exercises against the intake path |
| **Retrieval misses** (relevant knowledge exists, isn't surfaced) | Post-hoc audits find KIs that would have changed a DR | Hybrid 3-channel retrieval (§14.1); benchmark retrieval suite maintained by `EVALUATOR` (recall@k on golden query set, refreshed from real DR audits); "missed-KI" post-mortem line item in every venture post-mortem — every miss becomes a benchmark case |
| **Context starvation** (token budget truncates load-bearing KIs) | Truncation-event correlation with task failures | §3 truncation logging; budget policy tuning by `AI-DIR`; task contracts MAY request elevated budgets with cost accounting |
| **Ontology rot** | Curation queue growth; entity-type misuse | Small closed ontology (§4); extensions gated as R2 EPs with curation-cost analysis |
| **Summary drift** (compression alters meaning) | L2/L3 syntheses contradict their raw evidence | Pointer-back rule (§17.1); `CURATOR` spot-audits summaries against raw spans at a sampled rate (**[ASSUMPTION]** 5%) |

### Retrieval-quality metrics (standing, `KNOW-DIR`-owned, reported to `EVOLVE`)
- Recall@k and precision@k on the golden query benchmark (refreshed quarterly from DR audits) — **[ASSUMPTION]** targets recall@20 ≥ 0.9, precision@5 ≥ 0.7.
- Evidence-pack completeness rate at R3/R4 gates (share of DR claims resolving to KI refs) — target ≥ 95%.
- Stale-KI share of retrieved context in DRs — target ≤ 10%.
- Contradiction-surfacing rate (contradictions shown vs. known-present in retrieved neighborhoods) — target 100% (correctness property, not a tuning target).
- Validation queue latency (§15 SLA) and truncation-event rate (§3).
- Downstream: correlation of retrieval-quality scores with gate-decision calibration (Part VII) — the metric that proves the knowledge system is earning its cost.

---

## 18. Cross-references

- DR schema, evidence-pack contract, consensus and calibration usage: `07-decision-engine.md`.
- Ledger/books of record and financial marts: `08-finance.md`.
- Storage/platform technology selection, log infrastructure: `09-technology.md`.
- Key management, encryption classes, Kernel write-path enforcement: `10-security.md`.
- Audit obligations, retention law mapping, DSR process: `11-governance.md` with `PRIVACY`/`COMPL-DIR`.
- Playbook benchmarking, embedding-model EPs, shadow mode reconstruction: `12-self-evolution.md`.
- Pipeline knowledge obligations (post-mortems, stage KIs, integration ingestion): `05-business-creation-pipeline.md`.
- Knowledge-system risk entries: `13-failure-analysis.md`.
