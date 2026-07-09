# EvolveOS MVP — "One Pathfinder Venture, Human-Gated"

**Status:** v1.0 · **Constraint honored:** the pathfinder rule (spec Part XV, revision XV-12): one venture goes through each gate manual-heavy before any second venture may clear the same gate. The MVP is that first pass, instrumented.

The MVP is **not** a miniature of the full system. It is the smallest thing that (1) runs one real opportunity through the pipeline's front half with real human gates, and (2) leaves behind the two assets the whole thesis depends on: a complete decision trail (DRs) and validated knowledge (KIs).

---

## 1. Scope

**Product: the EvolveOS Console** — one web application + one Postgres database + a set of invocable agent tools, implementing:

1. **Venture record** (exactly one): macro-state machine over pipeline stages 1–12 (Opportunity Discovery → PMF search). Stages 13+ are out of scope.
2. **Gate workflow** for the 8 pre-entity gates: G-00 (stop), G-01…G-06 (pipeline), G-17 (public comms), G-18 (data use). Gates are data (`schemas/gates.yaml`); passing a gate requires: a DR, pre-registered kill criteria (Kernel-check: blocked without them), and a named human approval recorded as an event.
3. **Append-only event log**: every state change, approval, artifact, and agent invocation is an event (hash-chained). No UPDATE/DELETE on the log, enforced by trigger.
4. **Decision Records**: create, validate against schema, render as decision briefs, browse. Every R2+ decision gets one.
5. **Knowledge base v0**: KIs with provenance, confidence, scope, TTL; human validation step (`CURATOR` role is a human); full-text search.
6. **Agent tools (A0/A1 only)**: seven invoked-on-demand roles producing *documents into the workflow*, never external actions — research (`DEEP-RES`), market/trend analysis (`TRENDS`), competitive analysis (`COMP-INTEL`), risk analysis (`RISK-QUANT`-lite), finance analysis (`FIN-MODEL`), legal/compliance checklist (`REG-WATCH`-lite), product planning + QA review (`PROD-DIR`/`QA`-lite). Agents hold **zero external credentials**: web research runs through the harness with read-only fetch; output lands as draft artifacts pending human review.
7. **Roles**: operator (runs workflows, invokes agents), approver (clears gates — the Portfolio Review lead), viewer. One person may hold multiple roles but **the same person cannot be operator and approver on the same gate decision** (proposer/approver separation, spec Part III).

## 2. Explicit non-scope (do not build, do not "just add")

- No entity formation, funding, hiring, M&A, exit, shutdown (gates G-07…G-15 unreachable by construction).
- No treasury, payments, or any money movement; no agent-adjacent spend before the Founding Ratification Pack is signed.
- No autonomous execution: nothing above A1. No scheduled agent runs (that's Phase 3).
- No external communications by agents (no email, outreach, ads, posting). G-17 exists in the workflow but its artifact is executed by a human by hand.
- No multi-venture, no portfolio views, no capital allocation.
- No self-evolution, no calibration weighting, no consensus machinery (a single agent per question + human judgment).
- No cells, no Kafka, no SPIFFE/OPA, no vector store, no knowledge graph (Postgres only).
- No customer PII (PC-2/PC-3 data classes are banned from the system in v1 — validation interviews are recorded as anonymized notes).

## 3. Initial users and use case

- **Users:** the founding team (2–5 people). Roles above. No external users.
- **Initial use case:** take **one real business opportunity** (chosen by the founders) from a written opportunity brief through G-01 → research → G-02 → validation (landing test / interviews executed by humans, designed with agent support) → G-03 verdict → analysis block → G-04, and — only if the founders choose to proceed with real capital — G-05. A **kill at G-03 is an equally successful MVP outcome**: the deliverable is the trail, not the venture.

## 4. Main flow

```
Operator writes opportunity brief → G-01 (approver clears; kill criteria for research pre-registered)
→ Operator invokes research/trend/competitive agents → drafts reviewed → accepted artifacts become evidence pack
→ G-02 (DR + approver) → validation plan (agent-assisted design, human execution)
→ Validation results in → G-03 verdict DR (go / kill vs pre-registered criteria)
→ [if go] parallel analysis checklist (customer discovery, competitive, financial model, risk, legal)
→ G-04 (DR + approver) → prototype (human-built, agent-assisted)
→ G-05 decision with real capital = first R3 moment; hardware-key/2FA sign-off recorded
[at any point] G-00: any authorized human sets the stop flag → all agent invocation disabled until restart per gate rules
```

## 5. Minimal components

**Technical** (choices recorded in ADR-008; all cheap to change):
- Monorepo; TypeScript/Next.js console; Postgres (`events` append-only + derived views for ventures/DRs/KIs/gates); simple session auth with the 3 roles; agent harness = server-side functions calling LLM APIs, writing artifacts to the DB; CI = lint, schema validation, spec-consistency checks.

**Organizational:**
- Named humans: Portfolio Review lead (approver), operator(s), one human `CURATOR`.
- **Weekly review** (30 min, standing): gate queue, open DRs, KI validation queue, stop-flag status. Two consecutive skipped reviews = failure metric (below).
- The **Founding Ratification Pack** signed before any real-money step: scaled threshold table, role assignments, the manual G-00 procedure.

## 6. Success metrics

| Metric | Target |
|---|---|
| One venture through ≥ 3 gates (G-01…G-03) with complete DRs | 100% of gate passes have DR + pre-registered kill criteria |
| Decision latency | ≤ gate SLAs (Appendix C) for 90% of decisions |
| Evidence traceability | Every material claim in every DR links to an evidence-pack artifact |
| KI production | ≥ 20 human-validated KIs from the run (including failure KIs if killed) |
| Agent usefulness (leading indicator) | ≥ 50% of agent draft artifacts accepted with minor edits, measured at review |
| Zero ungated external actions | 0 events of external side effects not traceable to a human execution |

## 7. Failure metrics (any one triggers a retro; two trigger a stop-and-redesign)

- Any gate bypass (state advanced without DR/approval event) — should be impossible; occurrence = enforcement bug of the highest priority.
- DRs written after the fact to justify decisions already made (detectable: decision event precedes DR creation).
- Two consecutive skipped weekly reviews (oversight theater, the spec's named failure mode).
- Agent output used in an R3 decision without recorded human review.
- The console becomes the bottleneck: operators route around it with docs/spreadsheets for > 20% of artifacts.

## 8. Main risks

1. **Process theater at n=1**: gates feel like ceremony for a team of 3 → mitigate by keeping every gate artifact ≤ 2 pages and SLAs in hours, not days.
2. **Building the console instead of the venture**: cap console investment (Phase 0+1 ≤ ~6 person-weeks); the venture is the product.
3. **LLM-fabricated evidence entering DRs** → human review gate on every artifact + provenance links mandatory.
4. **Threshold ratification skipped** ("we'll sign it later") → hard rule: no real-money step before signature events exist.
5. **Scope creep toward Phase 2/3** — the non-scope list above is the contract.

## 9. Mandatory human decisions (unchanged from spec; restated for v1)

Money (all spend), legal (all artifacts), hiring (all), external communications (all), gate approvals (all 8), venture kill/continue, KI validation, stop/restart (G-00), and any change to thresholds, roles, or this scope document.
