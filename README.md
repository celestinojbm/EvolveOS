# EvolveOS

**EvolveOS is an autonomous enterprise operating system** — a combined organizational, software, and governance architecture that continuously discovers, validates, launches, operates, scales, acquires, merges, restructures, and retires companies, becoming more intelligent over time while keeping humans in mandatory control of strategic and irreversible decisions.

This repository contains the founding specification: the blueprint for a company intended to be built over the next decade.

## The specification

Start with [`spec/00-overview.md`](spec/00-overview.md) — it defines the normative conventions (MUST/SHOULD), the three canonical taxonomies that hold the entire spec together, and the reading order.

| Part | Document |
|---|---|
| 0 | [Overview & Normative Conventions](spec/00-overview.md) |
| I | [Philosophy](spec/01-philosophy.md) |
| II | [System Thinking](spec/02-system-thinking.md) |
| III | [Organizational Architecture](spec/03-organizational-architecture.md) |
| IV | [Multi-Agent System](spec/04-multi-agent-system.md) |
| V | [Business Creation Pipeline](spec/05-business-creation-pipeline.md) |
| VI | [Knowledge System](spec/06-knowledge-system.md) |
| VII | [Decision Engine](spec/07-decision-engine.md) |
| VIII | [Finance](spec/08-finance.md) |
| IX | [Technology](spec/09-technology.md) |
| X | [Security](spec/10-security.md) |
| XI | [Governance](spec/11-governance.md) |
| XII | [Self-Evolution](spec/12-self-evolution.md) |
| XIII | [Failure Analysis](spec/13-failure-analysis.md) |
| XIV | [Implementation Roadmap](spec/14-implementation-roadmap.md) |
| XV | [Critique & Revisions](spec/15-critique-and-revisions.md) |
| A | [Glossary](spec/appendix-a-glossary.md) |
| B | [Agent Registry](spec/appendix-b-agent-registry.md) |
| C | [Decision Gates](spec/appendix-c-decision-gates.md) |

## The three load-bearing ideas

1. **Reversibility classes (R1–R4).** Every action is classified by the worst-case cost of undoing it. Human approval is mandatory at R3, and multi-human quorum at R4 — regardless of any agent's confidence score.
2. **Autonomy levels (A0–A4).** Every agent has an autonomy ceiling it cannot raise itself. The autonomy–reversibility matrix in Part 0 is the system's core safety invariant.
3. **Decision gates (G-00…G-18).** All approvals are named, thresholded, and auditable. No part of the system may invent an approval path; Appendix C owns them all.

## From spec to build

The specification is converted into an executable plan under [`docs/`](docs/):

| Document | Purpose |
|---|---|
| [Buildability Audit](docs/BUILDABILITY_AUDIT.md) | External-CTO audit: what is implementable now, what is deferred and why, gaps with dispositions, PR-readiness verdict |
| [MVP Scope](docs/MVP_SCOPE.md) | The real MVP: one pathfinder venture, human-gated, agents at A0/A1 producing documents only |
| [Implementation Roadmap](docs/IMPLEMENTATION_ROADMAP.md) | Build Phases 0–3 with objectives, acceptance criteria, and explicit "do NOT build yet" lists |
| [Phase 0 Backlog](docs/PHASE_0_BACKLOG.md) | Foundation — 12 issues ([#2–#13](https://github.com/celestinojbm/EvolveOS/issues)) |
| [Phase 1 Backlog](docs/PHASE_1_BACKLOG.md) | Manual Operating System — 10 issues ([#14–#23](https://github.com/celestinojbm/EvolveOS/issues)) |
| [Architecture Decisions](docs/ARCHITECTURE_DECISIONS.md) | Build ADRs (Minimal Kernel, Postgres-only, agents-as-tools, gates-as-data, …) with revisit triggers |
| [Consistency Checks](docs/CONSISTENCY_CHECKS.md) | What CI validates, how to run it locally, and how to extend it — Phase 0 issue [#2](https://github.com/celestinojbm/EvolveOS/issues/2) |
| [Machine-Readable Schemas](docs/SCHEMAS.md) | Canonical JSON for gates, taxonomies, agents + record schemas, generated from the spec — Phase 0 issue [#4](https://github.com/celestinojbm/EvolveOS/issues/4) |
| [Development](docs/DEVELOPMENT.md) | Monorepo scaffold — running the console skeleton, migrations, typegen, and tests — Phase 0 issue [#5](https://github.com/celestinojbm/EvolveOS/issues/5) |
| [Event Log](docs/EVENT_LOG.md) | Append-only `events` table + hash chain — table, hashing, verification, guarantees — Phase 0 issue [#6](https://github.com/celestinojbm/EvolveOS/issues/6) |
| [User / Role Model](docs/AUTH.md) | Roles (operator/approver/viewer) + proposer≠approver enforced at the data layer, all logged — Phase 0 issue [#7](https://github.com/celestinojbm/EvolveOS/issues/7) |
| [Venture State Machine](docs/VENTURE_STATE_MACHINE.md) | Single venture record + stages 1–12 as a gated linear machine with the 5–9 analysis checklist and kill path — Phase 0 issue [#8](https://github.com/celestinojbm/EvolveOS/issues/8) |
| [Gate System](docs/GATE_SYSTEM.md) | Gate pass protocol v0: registry as data, DR + approval evidence + kill criteria, exactly one `gate_passed` per pass — Phase 0 issue [#9](https://github.com/celestinojbm/EvolveOS/issues/9) |
| [Decision Records](docs/DECISION_RECORDS.md) | Create/validate/file (immutable) DRs with `DR-yyyy-seq` ids, linked amendments, one shared canonicalization/digest, and a deterministic ≤2-page brief — Phase 0 issue [#10](https://github.com/celestinojbm/EvolveOS/issues/10) |

**Continuous integration.** Every push and pull request runs `scripts/` spec-consistency checks (standard-library Python, no dependencies): expected files exist, gate citations stay within `G-00…G-18`, agent references resolve to Appendix B, canonical taxonomies are complete, internal links resolve, and no placeholders leak in. Run them locally with `python scripts/run_all_checks.py`. See [Consistency Checks](docs/CONSISTENCY_CHECKS.md).

**Build rule of thumb:** the spec describes the destination; the build follows the pathfinder rule (revision XV-12) — one venture, eight gates, seven agent roles, one database, humans approving everything that matters.

## Status

Draft v0.1 — founding specification complete (Parts 0–XV + appendices) and converted to an executable Phase 0–3 plan. The Constitutional Layer (Parts 0, X, XI, Appendix C) is amendable through gate G-16 — and, until the first venture reaches G-07, through the bounded human-only **founding amendment mode** (`spec/00-overview.md` §4.1, operationalized in [`docs/FOUNDING_RATIFICATION_PACK.md`](docs/FOUNDING_RATIFICATION_PACK.md)). Its thresholds await founding human ratification (see [ADR-006](docs/ARCHITECTURE_DECISIONS.md)).
