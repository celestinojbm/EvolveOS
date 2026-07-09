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

## Status

Draft v0.1 — founding specification under active development. The Constitutional Layer (Parts 0, X, XI, Appendix C) is amendable only through gate G-16.
