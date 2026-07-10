# Phase 0 Backlog — Foundation

**Status:** v1.0 · 12 issues, dependency-ordered. Priorities: P0 = blocks everything downstream; P1 = blocks phase exit; P2 = phase-scope but schedulable. GitHub issue numbers are filled in after creation.

| # | Issue | Priority | GitHub |
|---|---|---|---|
| P0-1 | Repo hygiene: CI with markdown link check + spec-consistency checks | P0 | [#2](https://github.com/celestinojbm/EvolveOS/issues/2) |
| P0-2 | Documentation structure + CONTRIBUTING conventions | P1 | [#3](https://github.com/celestinojbm/EvolveOS/issues/3) |
| P0-3 | Extract machine-readable schemas from spec (`schemas/`) | P0 | [#4](https://github.com/celestinojbm/EvolveOS/issues/4) |
| P0-4 | ADR-008 ratification + monorepo scaffolding | P0 | [#5](https://github.com/celestinojbm/EvolveOS/issues/5) |
| P0-5 | Event log: append-only DDL + hash chain | P0 | [#6](https://github.com/celestinojbm/EvolveOS/issues/6) |
| P0-6 | User/role model: operator, approver, viewer | P0 | [#7](https://github.com/celestinojbm/EvolveOS/issues/7) |
| P0-7 | Venture record + macro-state machine (stages 1–12) | P1 | [#8](https://github.com/celestinojbm/EvolveOS/issues/8) |
| P0-8 | Gate system v0: registry as data + transition validation | P0 | [#9](https://github.com/celestinojbm/EvolveOS/issues/9) |
| P0-9 | Decision Record tooling: create, validate, render brief | P1 | [#10](https://github.com/celestinojbm/EvolveOS/issues/10) |
| P0-10 | Founding Ratification Pack + real-money feature flag | P0 | [#11](https://github.com/celestinojbm/EvolveOS/issues/11) |
| P0-11 | G-00 manual stop mechanism | P1 | [#12](https://github.com/celestinojbm/EvolveOS/issues/12) |
| P0-12 | Audit-trail conventions + event-log verification tool | P2 | [#13](https://github.com/celestinojbm/EvolveOS/issues/13) |

---

### P0-1 · Repo hygiene: CI with markdown link check + spec-consistency checks
**Labels:** `phase-0`, `infra`, `ci` · **Files:** `.github/workflows/ci.yml`, `ops/checks/`
**Description.** Turn the manual consistency checks used during spec authoring into CI: (a) relative markdown links resolve across `spec/` and `docs/`; (b) every `G-\d+` cited anywhere resolves to G-00…G-18 in `appendix-c-decision-gates.md`; (c) every backticked agent ID resolves to `appendix-b-agent-registry.md`; (d) no blockquote splits a markdown table.
**Acceptance.** CI runs on every PR; seeded with one intentionally broken fixture test per check; current tree passes.
**Dependencies.** None (first issue).

### P0-2 · Documentation structure + CONTRIBUTING conventions
**Labels:** `phase-0`, `docs` · **Files:** `CONTRIBUTING.md`, `docs/README.md`
**Description.** Document the repo layout (`spec/` = normative, `docs/` = build, `schemas/` = machine-readable, `app/`, `agents/`, `ops/`), the spec amendment convention (additive `Revision (XV-n)` notes; Constitutional Layer only via G-16), commit conventions, and how backlog docs relate to GitHub issues.
**Acceptance.** A newcomer can locate normative vs. build docs and knows which files they must not edit casually.
**Dependencies.** P0-1.

### P0-3 · Extract machine-readable schemas from spec
**Labels:** `phase-0`, `schemas`, `spec-conformance` · **Files:** `schemas/event.schema.json`, `schemas/decision-record.schema.json`, `schemas/knowledge-item.schema.json`, `schemas/task-contract.schema.json`, `schemas/gates.yaml`
**Description.** The spec's schemas are prose-embedded (audit §6e). Extract: event envelope; DR (Part VII §2); KI (Part VI §5); task contract (Part IV §2); all 19 gates as data (ADR-005) with `implemented: true` only for G-00…G-06, G-17, G-18. CI validates `gates.yaml` field-by-field against Appendix C and validates fixture documents against each JSON Schema.
**Acceptance.** All schemas versioned (`$id` + semver); fixtures validate; the Appendix C diff check fails if either side changes unilaterally.
**Dependencies.** P0-1.

### P0-4 · ADR-008 ratification + monorepo scaffolding
**Labels:** `phase-0`, `infra` · **Files:** `app/`, `package.json`, `ops/`
**Description.** Confirm or amend ADR-008 (TS/Next.js + Postgres), then scaffold: app skeleton, migration tooling, local dev (docker-compose Postgres), typegen from JSON Schemas, test runner. No features.
**Acceptance.** `pnpm dev` runs; migrations apply to a clean DB; one generated type consumed by one test.
**Dependencies.** P0-3.

### P0-5 · Event log: append-only DDL + hash chain
**Labels:** `phase-0`, `kernel`, `data` · **Files:** `app/db/migrations/*events*`, `app/lib/eventlog.ts`
**Description.** L0 per Part VI §1 at ADR-002 scale: `events` table (id, ts, actor, type, venture_id, reversibility_class, payload JSONB, prev_hash, hash); INSERT-only enforced by trigger (UPDATE/DELETE raise); hash = H(prev_hash ‖ canonical(payload)); write API in one module — nothing else touches the table.
**Acceptance.** Trigger tests prove UPDATE/DELETE rejected; chain verification detects a tampered row in a fixture dump; every write path in the codebase goes through the module (lint rule or grep check in CI).
**Dependencies.** P0-4.

### P0-6 · User/role model
**Labels:** `phase-0`, `kernel`, `auth` · **Files:** `app/lib/auth.ts`, migrations
**Description.** Session auth; roles operator/approver/viewer; role grants recorded as events; proposer≠approver rule enforced at the data layer (an approval event whose actor equals the proposing actor is rejected).
**Acceptance.** Role-separation test passes; all auth events in the log.
**Dependencies.** P0-5.

### P0-7 · Venture record + macro-state machine (stages 1–12)
**Labels:** `phase-0`, `pipeline` · **Files:** `app/lib/venture.ts`, migrations
**Description.** Single venture record (`V-yyyy-seq`); linear stage enum for stages 1–12 with the stage 5–9 analysis block as a checklist inside one macro-state (audit §6f); kill-from-any-stage → `archived` with mandatory post-mortem artifact reference. State changes only via gate passes (P0-8) or kill.
**Acceptance.** Illegal transitions rejected; kill path requires post-mortem reference; all transitions are events.
**Dependencies.** P0-5.

### P0-8 · Gate system v0: registry as data + transition validation
**Labels:** `phase-0`, `kernel`, `gates` · **Files:** `app/lib/gates.ts`
**Description.** Load `schemas/gates.yaml`; implement the pass protocol for the 8 pre-entity gates: require (a) DR reference validating against schema, (b) pre-registered kill criteria for the next stage, (c) approval event by a user holding the approver role, (d) proposer≠approver. Appendix C mechanics 1–3, 5 enforced; A3 auto-approvals downgraded to A1 per audit §5.4.
**Acceptance.** Gate pass without any one requirement is rejected with a specific error; the full requirement set produces exactly one `gate_passed` event + state transition atomically.
**Dependencies.** P0-6, P0-7, P0-3.

### P0-9 · Decision Record tooling
**Labels:** `phase-0`, `decisions` · **Files:** `app/lib/dr.ts`, `docs/templates/dr-template.md`
**Description.** Create/validate DRs against `decision-record.schema.json`; immutable once filed (amendments = linked follow-up events, mirroring the log discipline); render a ≤2-page decision brief (markdown) from a DR; sequence-numbered IDs `DR-yyyy-seq`.
**Acceptance.** Invalid DR rejected with field-level errors; filed DR immutable; brief renders all mandatory sections (options, uncertainty, top risks, rollback plan).
**Dependencies.** P0-5, P0-3.

### P0-10 · Founding Ratification Pack + real-money feature flag
**Labels:** `phase-0`, `governance`, `constitutional` · **Files:** [`docs/FOUNDING_RATIFICATION_PACK.md`](FOUNDING_RATIFICATION_PACK.md) (draft template already in the repo — finalize and sign here), `app/lib/flags.ts`
**Description.** Per ADR-006: a signable document containing (a) pathfinder-scale threshold table (replacing Appendix C's $10M-scale amounts for this deployment, without amending the spec), (b) role assignments (Portfolio Review lead, operators, human CURATOR), (c) the manual G-00 procedure, (d) the MVP non-scope list as binding. Signature = named-human event per signer. `real_money` flag readable only true when all signature events exist.
**Acceptance.** Flag is false on a fresh DB; flips only via signature events; CI test covers the gate.
**Dependencies.** P0-6, P0-9.

### P0-11 · G-00 manual stop mechanism
**Labels:** `phase-0`, `kernel`, `safety` · **Files:** `app/lib/stop.ts`
**Description.** Stop flag settable by any authorized human (one click, reason optional — stop asymmetry: stopping must be the cheapest action in the system); while set, all agent-invocation and gate-pass paths refuse; restart requires approver role + logged rationale (owning-gate rule at MVP scale).
**Acceptance.** Stop halts both paths in tests; restart path enforces role + rationale; both are events.
**Dependencies.** P0-6.

### P0-12 · Audit-trail conventions + event-log verification tool
**Labels:** `phase-0`, `audit` · **Files:** `ops/verify-log.ts`, `docs/AUDIT_CONVENTIONS.md`
**Description.** Document the event taxonomy (types, required payload fields per type); ship a CLI that verifies the full hash chain and produces a human-readable audit extract for a date range or venture (the ARC-sampling primitive, years early and cheap).
**Acceptance.** CLI verifies a seeded DB and detects fixture tampering; conventions doc lists every event type used by P0-5…P0-11.
**Dependencies.** P0-5.
