# EvolveOS Specification — Part 0: Overview & Normative Conventions

**Status:** Draft v0.1 · **Owner:** Founding Architecture Group · **Change class:** R4 (see §4)

This document is the reading guide and constitutional preamble for the EvolveOS specification. Every other part depends on the conventions defined here. If any part conflicts with Part 0, Part 0 prevails until formally amended.

---

## 1. What EvolveOS is

EvolveOS is an **autonomous enterprise operating system**: a combined organizational, software, and governance architecture that continuously **discovers, validates, launches, operates, scales, acquires, merges, restructures, and retires companies** ("ventures"), while becoming more intelligent over time and keeping humans in mandatory control of strategic and irreversible decisions.

EvolveOS is *not* a single product. It is:

1. A **holding organization** (the "Portfolio") with human governance at the top.
2. A **multi-agent AI system** that performs the bulk of cognitive and operational work.
3. A **knowledge and decision infrastructure** that compounds learning across every venture.
4. A **set of binding policies** (the "Constitution") that constrain what the AI layer may do without humans.

## 2. Document map

| File | Part | Contents |
|---|---|---|
| `00-overview.md` | 0 | This document: conventions, taxonomies, amendment process |
| `01-philosophy.md` | I | Mission, principles, anti-principles, moats, metrics |
| `02-system-thinking.md` | II | EvolveOS as a living adaptive system; loops and cycles |
| `03-organizational-architecture.md` | III | Departments: mission, KPIs, authority, interfaces, failure modes |
| `04-multi-agent-system.md` | IV | Full agent architecture; per-agent cards |
| `05-business-creation-pipeline.md` | V | 23-stage venture lifecycle state machine |
| `06-knowledge-system.md` | VI | Memory architecture, storage, retrieval, validation |
| `07-decision-engine.md` | VII | Scoring, uncertainty, simulation, consensus, rollback |
| `08-finance.md` | VIII | Ledger, treasury, capital allocation, portfolio optimization |
| `09-technology.md` | IX | Infrastructure and platform stack |
| `10-security.md` | X | Zero trust, key management, red/blue team, fraud |
| `11-governance.md` | XI | Human oversight, ethics, compliance, audit |
| `12-self-evolution.md` | XII | How EvolveOS improves itself, safely |
| `13-failure-analysis.md` | XIII | Risk register: probability, impact, detection, mitigation, recovery |
| `14-implementation-roadmap.md` | XIV | 10-year → daily roadmaps, critical path, resources |
| `15-critique-and-revisions.md` | XV | External panel critique and adopted revisions |
| `appendix-a-glossary.md` | A | Canonical terms — used identically in every part |
| `appendix-b-agent-registry.md` | B | Single source of truth for all agent IDs |
| `appendix-c-decision-gates.md` | C | Single source of truth for all decision gates (G-xx) |

**Reading order.** First read: 0 → I → II → IV → V → VII → XI. Implementers: 0 → IX → IV → VI → X → XIV. Investors/board: 0 → I → VIII → XI → XIII → XIV.

## 3. Normative language

Per RFC 2119: **MUST**, **MUST NOT**, **SHALL** are binding requirements; **SHOULD** is a strong default requiring documented justification to deviate; **MAY** is optional. Statements marked **[ASSUMPTION]** are explicit assumptions with rationale; **[UNCERTAIN]** marks acknowledged uncertainty; **[DECISION]** marks a chosen architecture where alternatives were compared.

## 4. Spec versioning and amendment

- The spec is versioned as a whole (`v<major>.<minor>`), changelog in each file header.
- Parts 0, XI (Governance), X (Security), and Appendix C (Gates) form the **Constitutional Layer**. Amending them is a class-R4 change (see §5) and requires the human approval path in gate **G-16**.
- All other parts are class-R2/R3 changes amendable through the standard proposal process defined in Part XII.
- Rationale: the layers that constrain the AI's autonomy must not be modifiable by the AI they constrain, or the oversight guarantee is circular.

## 5. Canonical taxonomy 1 — Reversibility classes (R1–R4)

Every action, decision, and change in EvolveOS MUST carry a reversibility class. The class is determined by the **worst-case cost and feasibility of undoing the action**, not by its expected outcome.

| Class | Name | Definition | Examples |
|---|---|---|---|
| **R1** | Trivially reversible | Undo ≤ 1 hour of work and ≤ $1,000 cost; no external party affected | Internal analysis, drafts, sandbox experiments, re-ranking a backlog |
| **R2** | Reversible with effort | Undo ≤ 30 days and ≤ $50,000; no binding external commitments; no public exposure | Prototype builds, internal tooling changes, paused ad experiments ≤ envelope, vendor trials |
| **R3** | Costly to reverse | Binding external commitments, public/brand exposure, contracts, spend $50k–$1M, individual hiring offers | Signed contracts, production launches, pricing changes for live customers, marketing campaigns at scale |
| **R4** | Irreversible / existential | Cannot be meaningfully undone, or failure threatens the portfolio | Entity formation/dissolution, M&A, layoffs, capital deployment > $1M, litigation, regulatory filings, changes to the Constitutional Layer, customer-data-affecting incidents |

**[ASSUMPTION]** Dollar thresholds are calibrated to a portfolio starting at ~$10M deployable capital (Part XIV). They MUST be re-ratified by the Investment Committee whenever assets under management change by more than 2×. Thresholds exist because "irreversibility" alone is too vague to automate: agents need a computable classifier, and dollar/duration bounds are computable.

## 6. Canonical taxonomy 2 — Autonomy levels (A0–A4)

Every agent and every department carries an **autonomy ceiling** — the maximum level at which it may operate.

| Level | Name | Meaning |
|---|---|---|
| **A0** | Advisory | Agent analyses and recommends; a human performs the action |
| **A1** | Human-in-the-loop | Agent prepares the complete action; a named human approves each execution before it happens |
| **A2** | Human-on-the-loop | Agent executes within a pre-approved envelope; exceptions queue for human approval; humans review batches on a fixed cadence (≤ weekly) |
| **A3** | Supervised autonomous | Agent executes and adapts tactics within a policy envelope; automatic circuit breakers; humans audit post-hoc via sampling |
| **A4** | Fully autonomous | Agent executes, adapts, and modifies its own tactics; post-hoc audit only. Permitted **only** for R1 actions |

**Binding autonomy–reversibility matrix** (the load-bearing human-oversight rule of the entire system):

| | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| Max autonomy | A4 | A3 | **A1/A2** (named human approves) | **A0/A1 with multi-human quorum** (see Appendix C) |

No agent, orchestrator, or self-evolution process may raise its own autonomy ceiling; ceilings are set only through gate G-16. Rationale: if autonomy assignment were itself autonomous, oversight would be self-revoking.

## 7. Canonical taxonomy 3 — Decision gates (G-xx)

All pipeline transitions and standing approval events are formalized as **gates** with stable IDs (`G-00` … `G-18`) defined **only** in `appendix-c-decision-gates.md`. Every part that mentions an approval MUST cite a gate ID. No part may invent a gate; new gates are added to Appendix C via the amendment process.

## 8. Canonical identifiers

- **Agents:** every agent has a stable uppercase ID (e.g., `PRIME`, `FIN-DIR`, `SCOUT`) defined **only** in `appendix-b-agent-registry.md`. All parts cite these IDs verbatim.
- **Ventures:** `V-<yyyy>-<seq>` (e.g., `V-2027-004`). Venture-scoped agent instances are suffixed: `VENTURE-ORCH@V-2027-004`.
- **Decision Records:** `DR-<yyyy>-<seq>` — the immutable artifact created for every R2+ decision (schema in Part VII).
- **Risks:** `RISK-<category>-<seq>` per the register in Part XIII.

## 9. Cross-reference rules

1. A term used in more than one part MUST appear in Appendix A with a single definition.
2. Numbers (thresholds, budgets, SLAs) are owned by exactly one part; other parts cite, never restate with different values. Ownership: dollar/authority thresholds → Appendix C; budget envelopes → Part VIII; SLAs → the part defining the process.
3. Part XV revisions are recorded in Part XV **and** as a `> **Revision (XV-n):**` note at the amended location.
