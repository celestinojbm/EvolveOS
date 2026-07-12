# EvolveOS — Architecture Decision Records (Build)

**Status:** v1.0 · ADRs for the *build*, complementing (never overriding) the spec's `[DECISION]` blocks. Where an ADR narrows a spec decision for MVP scale, the re-entry trigger back to the spec's full design is stated. Format: Context → Decision → Consequences → Revisit trigger.

---

## ADR-001: Minimal Kernel — capability absence instead of capability enforcement

**Context.** The spec's Kernel (Part IX §8: workload identity, OPA-class policy, capability tokens, egress gateways) is a multi-quarter build that Part XIV sequences before any live agent. At pathfinder scale this starves the venture. The spec's own "manual-heavy mode" (Part XIV) permits humans to execute while agents draft.
**Decision.** Phases 0–2 use a Minimal Kernel: (1) app-level RBAC (operator/approver/viewer); (2) the append-only event log as the audit plane; (3) gate checks in one service boundary (no state transition without DR + kill criteria + approval event); (4) agents hold **zero external credentials** — the enforcement question is mooted by capability absence, which is strictly stronger than envelope enforcement for the actions that matter.
**Consequences.** No A2+ is grantable in Phases 0–2 (nothing enforces envelopes); the security surface shrinks to the console itself; Phase 3's first A2 grant requires real (if simple) envelope enforcement in the harness.
**Revisit trigger.** First A2 grant (Phase 3) → harness envelopes; agent surface beyond the harness, treasury work, or first customer data → begin the spec Kernel proper (and XV-9 formal model before treasury).

## ADR-002: Postgres-only persistence (no Kafka, no vector store, no graph DB)

**Context.** Part VI/IX call for an event backbone plus knowledge graph + vector + relational marts as derived views. MVP volume: ~10²–10³ events/day, hundreds of KIs.
**Decision.** One Postgres: `events` append-only table (hash-chained, trigger-enforced INSERT-only) as L0; derived views as SQL views/tables; KI search via Postgres full-text; provenance as JSONB.
**Consequences.** Zero infra ops; the L0/L2 discipline of Part VI §1 is preserved (views derivable from events), so migrating any view store later is a projection change, not a data-model change.
**Revisit trigger.** > ~10⁵ events/day, > ~5k KIs with retrieval-quality complaints, or a second venture cell.

## ADR-003: Agents are invoked tools, not resident processes

**Context.** Part IV models resident agents exchanging Kernel-mediated messages. Phase 2 needs seven drafting roles, not a society.
**Decision.** Each agent role = versioned prompt/config invoked synchronously by an operator through the harness; the invocation payload uses the Part IV task-contract JSON schema so Phase 3+ can move to queued/scheduled transport without rewriting contracts. No agent-to-agent calls.
**Consequences.** No orchestration bugs, trivially auditable (one invocation = one event); some multi-step research flows require the operator to chain calls manually.
**Revisit trigger.** Phase 3 scheduled jobs (transport change only); genuine multi-agent workflows earn their complexity only after acceptance-rate data justifies them.

## ADR-004: Monorepo

**Decision.** Single repository: `spec/`, `docs/`, `schemas/`, `app/` (console), `agents/` (role configs), `ops/` (CI, scripts). One PR can change a schema, its migration, and its consumer atomically; the spec-consistency CI sees everything.
**Revisit trigger.** A venture's production codebase (post-G-05) gets its own repo/cell — venture code never lives in the OS monorepo (clean exit per Part IX cell rationale).

## ADR-005: Gates as data

**Decision.** All 19 gates modeled in `schemas/gates.yaml` (ID, trigger, reversibility, approver role, SLA, inputs) mirroring Appendix C verbatim; the workflow engine implements only the 8 pre-entity gates; the other 11 exist as data with `implemented: false`. CI diffs `gates.yaml` against Appendix C so spec and code cannot drift silently.
**Consequences.** Adding a gate implementation is config + one workflow handler; Appendix C remains the single source of truth (the YAML is generated-from/checked-against, never hand-forked).
**Revisit trigger.** n/a — this is the permanent pattern.

## ADR-006: All spec dollar thresholds are unratified until the Founding Ratification Pack is signed

**Context.** Appendix C amounts assume $10M capital [ASSUMPTION] that does not exist; the spec requires IC ratification.
**Decision.** The build treats every threshold as `pending_ratification`. Phase 0 ships a Ratification Pack: scaled threshold table (pathfinder scale), role assignments (who is Portfolio Review lead, operator, CURATOR), and the manual G-00 procedure. Founders sign; signatures are events; CI keeps the real-money feature flag off until those events exist.
**Consequences.** Zero agent-adjacent spend possible before human ratification — the constitutional bootstrap problem (audit §6c) is closed at the enforcement layer, not by policy prose.
**Revisit trigger.** Any capital event > 2× current scale → re-ratification (per Part 0 §5).

## ADR-007: No external side effects from any agent until Phase 3 — and then only R1/R2

**Decision.** Structural, not policy: the harness exposes no tools that send email, post, pay, or write to any external system. Web access is read-only fetch with provenance labeling (P4). Phase 3 adds scheduled *internal* jobs only; first external side effect of any kind requires its own ADR + ratified envelope + the Part X §11 injection-test pass.
**Consequences.** The MVP's worst-case agent failure is a bad draft, never a bad action.
**Revisit trigger.** Explicit founder decision post-Phase 3, gated as R3.

## ADR-008: Console stack — TypeScript/Next.js + Postgres [ASSUMPTION, cheap to change]

**Context.** Any mainstream stack works; the cost of debating exceeds the cost of choosing.
**Decision.** Next.js (single deployable, server actions for the harness), Postgres (ADR-002), Drizzle-or-Prisma migrations, hosted anywhere with a managed Postgres. Auth: lightweight session auth with the three roles (an IdP is overkill for ≤ 5 users).
**Consequences.** Fast iteration, one language across console/harness/schemas (JSON Schema + TS types generated).
**Revisit trigger.** First hire whose expertise argues otherwise, or Phase 3 job-runner needs that Next.js can't host cleanly (then: small worker service, same repo).
**Ratification (issue #5, P0-4).** Confirmed with two scope clarifications, recorded here so the scaffold matches the decision:
- **TypeScript + Postgres + generated types + pnpm monorepo — confirmed and scaffolded** (`app/`, `ops/`, root `package.json`). TS types are generated from `schemas/*.schema.json` via `ops/typegen.mjs` (`pnpm typegen`), matching the "one language across console/harness/schemas" consequence above.
- **Next.js — confirmed as the UI framework but deferred to Phase 1.** Phase 0 has no UI and no features (issue #5 "No features"), so introducing Next.js now would scaffold a UI with nothing to render. The Phase 0 `app/` is a minimal TypeScript service skeleton (a health entrypoint); Next.js enters when the console UI is first built (Phase 1 backlog). This is a sequencing clarification, not a reversal.
- **Migrations — a minimal forward-only SQL runner now (`ops/migrate.mjs`); the Drizzle/Prisma choice is deferred** to the first real schema (the event log, issue #6). No ORM is committed to before there is a table worth modeling.

## ADR-009: Event-log persistence — raw SQL + node-postgres, no ORM (yet)

**Context.** Issue #5 deferred the ORM choice to the first real schema. That schema is the L0 event log (issue #6): a single append-only table with one write path and a hash chain — a security-sensitive integrity structure, not a CRUD domain model.
**Decision.** Persist the event log with **raw SQL migrations + node-postgres (`pg`)**, no ORM. Record-level type safety comes from the TS types generated off `schemas/event.schema.json` (ADR-008), not from an ORM. Evaluated: **minimal SQL runner (chosen)** — simplest, the SQL (table, triggers, hash-chain semantics) is fully visible and auditable in one migration + one module, exactly what an integrity log needs; **Drizzle** — reasonable, but adds a dependency and a second schema definition to keep in sync with `event.schema.json` for one table, with no joins to earn its keep yet; **Prisma** — rejected: heavy engine/codegen and it hides the SQL, the opposite of what an auditable append-only log wants.
**Consequences.** Zero ORM to learn or track; the append-only guarantee lives in the database (triggers) and the hash logic in one small module (`app/src/lib/eventlog.ts`). The trade-off is hand-written queries — acceptable at this scale (one table, one writer).
**Revisit trigger.** When the schema grows to several related tables with joins and migrations become error-prone by hand → adopt **Drizzle** (SQL-first, migration-friendly), still not Prisma. Revisit before, not after, the second or third domain table.
