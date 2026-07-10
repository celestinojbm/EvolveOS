# EvolveOS — Implementation Roadmap (Build Phases 0–3)

**Status:** v1.0 · Translates the spec (esp. Parts V, IX, XIV) into four build phases at pathfinder scale. Each phase has an explicit **"do NOT build yet"** list — deferrals are design decisions, recorded in `ARCHITECTURE_DECISIONS.md` with re-entry triggers.

Relationship to spec Part XIV: these phases refine XIV's Phase 0/M1–M5 milestones for a pathfinder-scale start (no $10M assumption). XIV's later milestones (M6+) activate only after the MVP proves the loop.

---

## Phase 0 — Foundation

**Objective:** the constitutional and data skeleton: everything the MVP's trust model depends on, and nothing else. Exit = a database that cannot lie (append-only, hash-chained), gates as data, roles enforced, thresholds ratified by humans.

**Deliverables:** repo hygiene + CI (consistency checks as code); machine-readable schemas extracted from the spec (`schemas/`); Founding Ratification Pack signed; event log DDL with append-only enforcement; DR tooling; gate registry + transition validation; user/role model; audit-trail conventions; venture/macro-state model; G-00 manual stop; app scaffolding.

**Backlog:** `PHASE_0_BACKLOG.md` (12 issues). **Dependencies:** none external; ADR-008 stack decision first. **Duration estimate:** 2–3 person-weeks.

**Risks:** gold-plating the Kernel (mitigation: ADR-001 — capability absence, not enforcement machinery); ratification treated as paperwork (mitigation: CI blocks the "real-money" feature flag until signature events exist).

**Acceptance criteria:**
- `INSERT`-only event log demonstrated (UPDATE/DELETE rejected at DB level); hash chain verifies end-to-end.
- A gate transition without DR + kill criteria is rejected by the service layer (test proves it).
- Ratification Pack signed by the founding humans, recorded as events.
- CI green: markdown links, JSON-schema validation, spec-consistency greps.

**Do NOT build yet:** any UI beyond scaffold; agents; Kafka/queues; vector stores; OPA/SPIFFE; token metering; multi-venture anything.

## Phase 1 — Manual Operating System

**Objective:** humans run the full front-pipeline through the console with zero agents. If the process doesn't work manually, agents will only automate the dysfunction.

**Deliverables:** operator dashboard; opportunity intake; research workflow with evidence packs; DR UI + decision briefs; gate approval queue (approve/veto with rationale, 2FA-recorded for R3); knowledge base v0 with human validation; kill-criteria pre-registration enforcement in UI; weekly-review support; metrics v0 (gate latency, DR completeness, zombie detection); **first real opportunity run through G-01→G-03**.

**Backlog:** `PHASE_1_BACKLOG.md` (10 issues). **Dependencies:** Phase 0 complete (hard). **Duration estimate:** 3–4 person-weeks build + the live run (calendar-dependent).

**Risks:** ceremony fatigue (keep artifacts ≤ 2 pages); building dashboard polish instead of running the venture (time-box).

**Acceptance criteria:**
- One real opportunity brief has passed (or been killed at) G-03 with complete, schema-valid DRs and ≥ 10 validated KIs.
- All MVP failure metrics (`MVP_SCOPE.md` §7) instrumented and reporting.
- Weekly review has run ≥ 3 consecutive times with minutes as events.

**Do NOT build yet:** agent invocation of any kind; automation of intake triage; notifications beyond a daily digest; public-facing anything.

## Phase 2 — Assisted Multi-Agent Layer

**Objective:** the seven A0/A1 agent roles (`MVP_SCOPE.md` §1.6) as invoked tools inside the proven manual workflow. Agents draft; humans decide. No agent output takes effect unreviewed; no agent holds external credentials.

**Deliverables:** agent harness (task-contract JSON as invocation format per spec Part IV §2 — transport-ready for Phase 3); the 7 role prompts/configs versioned in-repo; draft-artifact review flow (accept/edit/reject, all recorded as events); provenance labeling of agent inputs (P4 web content marked); acceptance-rate metrics per role; red-team prompt-injection test set run against each role before enablement (spec Part X §11, lite).

**Dependencies:** Phase 1 acceptance met, including the live run — agent usefulness is measured against a manual baseline that must exist first. **Duration estimate:** 3–4 person-weeks.

**Risks:** fabricated evidence (mandatory provenance links + human review); silent scope creep toward A2 ("just let it file the DR") — mitigated structurally: the harness has no write path to gate transitions.

**Acceptance criteria:**
- ≥ 50% draft acceptance rate on ≥ 20 real artifacts across roles; every accepted artifact provenance-complete.
- Prompt-injection suite: zero successful external side-effect attempts (there are no credentials to steal — verify the invariant holds end-to-end).
- A second opportunity run (or the continuing first) measurably faster at equal DR quality (gate latency ↓, completeness =).

**Do NOT build yet:** scheduled/autonomous runs; agent-to-agent messaging; consensus/calibration machinery; agent memory beyond the shared KI store; any A2 grant.

## Phase 3 — Controlled Automation (R1/R2 only)

**Objective:** first supervised autonomy where reversibility is proven: scheduled jobs, evaluations, alerts, reports, simulations — all R1/R2, all with rollback, per the autonomy–reversibility matrix (A2/A3 only over R1/R2 actions).

**Deliverables:** scheduled agent jobs (nightly signal scan, KI-expiry review, metrics digest) with per-job spend caps; evaluation harness (golden-task suites per role — the Part XII seed); alerting (gate SLA breaches, zombie venture, stop-flag, failure metrics); weekly auto-generated review pack; simple Monte Carlo simulation for G-04+ financial models (Part VII, lite); rollback mechanics for every automated write ("rollback" = compensating events — the log stays append-only); **Minimal Kernel upgrade**: real envelopes (spend/rate caps) enforced in the harness, first A2 grant to exactly one role (candidate: `TRENDS` nightly scan); the XV-9 formal-model work item opens here (binding before any treasury/live-rail work ever starts).

**Dependencies:** Phase 2 acceptance; ratified envelope table for the A2 grant (human signature event). **Duration estimate:** 4–6 person-weeks.

**Risks:** cost runaway from scheduled LLM jobs (hard monthly cap + per-job caps + G-00 flag checked before every run); alert fatigue (every alert must be actionable or it gets deleted).

**Acceptance criteria:**
- 30 days of scheduled operation: zero unhandled envelope breaches, zero actions above R2, all automated writes compensable and one rollback actually exercised in a drill.
- Golden-task suites exist for all 7 roles and run in CI; regression blocks role-prompt changes (Part XII EP-lite).
- G-00 drill passed: stop flag halts all scheduled jobs mid-cycle; restart per gate rules.

**Do NOT build yet (Phase 4+ material, outside this roadmap):** anything R3+ automated; external comms automation; treasury; multi-venture; entity gates G-07+; self-evolution beyond golden-task regression; cells; the full spec Kernel (SPIFFE/OPA) unless the A2 surface outgrows the harness's ability to contain it.

---

## Cross-phase rules

1. **Phase gates are themselves gated:** advancing a phase requires its acceptance criteria checked in the weekly review and recorded as a DR. Dogfooding starts with the build itself.
2. **The venture outranks the console:** if console work and venture work compete for a week's capacity, the venture wins — the console exists to serve the run, not vice versa.
3. **Every deferral has a trigger** (audit §7); triggers are reviewed monthly so deferrals don't fossilize into forgotten requirements.
