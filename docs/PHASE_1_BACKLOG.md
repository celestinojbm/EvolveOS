# Phase 1 Backlog — Manual Operating System

**Status:** v1.0 · 10 issues, dependency-ordered. Hard precondition: Phase 0 acceptance criteria met (`IMPLEMENTATION_ROADMAP.md`). GitHub issue numbers filled in after creation.

| # | Issue | Priority | GitHub |
|---|---|---|---|
| P1-1 | Operator dashboard: venture status, gate queue, recent events | P0 | [#14](https://github.com/celestinojbm/EvolveOS/issues/14) |
| P1-2 | Opportunity intake: brief form + template | P0 | [#15](https://github.com/celestinojbm/EvolveOS/issues/15) |
| P1-3 | Research workflow: artifacts + evidence packs | P0 | [#16](https://github.com/celestinojbm/EvolveOS/issues/16) |
| P1-4 | DR UI: create, browse, decision-brief view | P0 | [#17](https://github.com/celestinojbm/EvolveOS/issues/17) |
| P1-5 | Gate approval queue: approve/veto with recorded rationale | P0 | [#18](https://github.com/celestinojbm/EvolveOS/issues/18) |
| P1-6 | Knowledge base v0: KIs with provenance, human validation, search | P1 | [#19](https://github.com/celestinojbm/EvolveOS/issues/19) |
| P1-7 | Kill-criteria pre-registration UX | P1 | [#20](https://github.com/celestinojbm/EvolveOS/issues/20) |
| P1-8 | Weekly review support: batch view + minutes as events | P1 | [#21](https://github.com/celestinojbm/EvolveOS/issues/21) |
| P1-9 | Metrics v0: gate latency, DR completeness, zombie detection, failure metrics | P1 | [#22](https://github.com/celestinojbm/EvolveOS/issues/22) |
| P1-10 | Pathfinder run: one real opportunity through G-01→G-03 | P0 | [#23](https://github.com/celestinojbm/EvolveOS/issues/23) |

---

### P1-1 · Operator dashboard
**Labels:** `phase-1`, `console` · **Files:** `app/(console)/dashboard`
**Description.** One screen: venture card (stage, days-in-stage, next gate), pending gate queue, stop-flag status, last 20 events, open DR count, KI-validation queue depth. No charts, no polish — the weekly review runs off this screen.
**Acceptance.** All six widgets live against real data; loads < 1s on seeded DB.
**Dependencies.** Phase 0 complete.

### P1-2 · Opportunity intake
**Labels:** `phase-1`, `pipeline` · **Files:** `app/(console)/intake`, `docs/templates/opportunity-brief.md`
**Description.** Form capturing the opportunity brief (problem, signal + source provenance, hypothesis, why-now, proposed research kill criteria) → creates venture record in stage 1 + `opportunity_submitted` event; renders the G-01 submission view for the approver.
**Acceptance.** Submitted brief validates required fields; G-01 pass via P0-8 protocol advances stage; provenance links mandatory.
**Dependencies.** P1-1.

### P1-3 · Research workflow
**Labels:** `phase-1`, `pipeline` · **Files:** `app/(console)/research`
**Description.** Attach research artifacts (markdown + links) to the venture; group artifacts into an evidence pack; each artifact carries source list + author + review status (draft/reviewed). Evidence packs are what DRs cite (Part VI/VII discipline at manual scale).
**Acceptance.** A DR can reference only `reviewed` artifacts; artifact lifecycle fully evented.
**Dependencies.** P1-2.

### P1-4 · DR UI
**Labels:** `phase-1`, `decisions` · **Files:** `app/(console)/decisions`
**Description.** Create DRs through a guided form (options, predicted outcomes with explicit uncertainty ranges, evidence-pack citations, kill criteria, rollback plan); browse/filter; decision-brief rendering (P0-9) as the approver's default view.
**Acceptance.** A gate submission can be assembled entirely in-UI; schema-invalid drafts cannot be filed; brief view is ≤ 2 pages printed.
**Dependencies.** P1-3.

### P1-5 · Gate approval queue
**Labels:** `phase-1`, `gates`, `governance` · **Files:** `app/(console)/gates`
**Description.** Approver's queue: pending submissions with decision brief, top-3 risks acknowledgment checkboxes (Appendix C mechanic 2), approve/veto with mandatory written rationale; veto returns to operator with the no-gate-shopping resubmission rule (diff against rejected DR required). For R3 gates (G-05/G-06/G-17): record a second-factor confirmation (TOTP/WebAuthn) on the approval event (XV-2 at MVP scale).
**Acceptance.** Approval without risk acknowledgment impossible; veto requires rationale; resubmission requires diff; R3 approvals carry the second-factor attestation in the event.
**Dependencies.** P1-4.

### P1-6 · Knowledge base v0
**Labels:** `phase-1`, `knowledge` · **Files:** `app/(console)/knowledge`
**Description.** KI CRUD per `knowledge-item.schema.json`: claim, scope, confidence, provenance links, TTL by type (Part VI defaults), status (proposed → validated by human CURATOR → expired/superseded); full-text search; the validation queue feeds the dashboard widget.
**Acceptance.** Only humans can move proposed→validated; expiry job flags stale KIs; every DR that closes a venture stage proposes ≥ 1 KI (nudge, not block).
**Dependencies.** P1-3.

### P1-7 · Kill-criteria pre-registration UX
**Labels:** `phase-1`, `gates` · **Files:** part of gates/DR UI
**Description.** First-class kill-criteria object (metric, threshold, measured-by-when) attached at gate submission; at the next gate, the UI shows registered criteria vs. actuals side-by-side *before* the decision fields — the sunk-cost countermeasure made visible.
**Acceptance.** G-0n submission blocked without criteria for stage n+1 (P0-8 already enforces; this issue makes the comparison view); the G-03 verdict screen renders criteria-vs-actuals.
**Dependencies.** P1-5.

### P1-8 · Weekly review support
**Labels:** `phase-1`, `governance` · **Files:** `app/(console)/review`
**Description.** One view assembling: gate queue, decisions since last review, KI validation queue, stop-flag history, failure-metric status; minutes captured as a `weekly_review_held` event with attendees + notes. Two consecutive missed weeks triggers a dashboard banner (the oversight-theater tripwire).
**Acceptance.** Review can be run end-to-end from this screen in ≤ 30 min; missed-review banner fires in test.
**Dependencies.** P1-1, P1-5.

### P1-9 · Metrics v0
**Labels:** `phase-1`, `metrics` · **Files:** `app/lib/metrics.ts`
**Description.** Compute from events (no separate store): gate decision latency vs. SLA; DR completeness (all mandatory sections non-empty, citations resolve); zombie detection (days-in-stage > SLA with no open kill review); the five failure metrics from `MVP_SCOPE.md` §7 including decision-precedes-DR detection.
**Acceptance.** All metrics derivable from a seeded event log with known answers; failure metrics visible on dashboard + review screens.
**Dependencies.** P1-8.

### P1-10 · Pathfinder run: one real opportunity through G-01→G-03
**Labels:** `phase-1`, `pathfinder`, `dogfood` · **Files:** n/a (operational)
**Description.** The point of everything above: founders choose one real opportunity; operator runs intake → research (human-executed) → G-02 → validation (landing test/interviews, human-executed) → G-03 verdict against pre-registered criteria. Kill is a fully successful outcome. Deliverables: complete DR trail, ≥ 10 validated KIs, a retro documenting where the console helped vs. obstructed (feeds Phase 2 scope).
**Acceptance.** Phase 1 exit criteria (`IMPLEMENTATION_ROADMAP.md`) met; retro filed as an event + docs artifact.
**Dependencies.** P1-1…P1-9 (P1-6/P1-9 may land mid-run).
