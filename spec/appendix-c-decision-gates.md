# Appendix C — Canonical Decision Gates

**Status:** Draft v0.1 · **Rule:** this file is the single source of truth for gates and for the dollar/authority thresholds attached to them. Every approval mentioned anywhere in the spec cites a gate ID from this table. Gates are part of the Constitutional Layer: adding, removing, or re-thresholding a gate is itself a G-16 action.

**[ASSUMPTION]** Thresholds calibrated to ~$10M initial deployable capital (Part XIV). The Investment Committee MUST re-ratify all thresholds when AUM changes by more than 2×, because fixed dollar limits become either paralyzing or meaningless as scale changes.

**Approver key.** Human bodies/officers per Part XI: EC = Executive Committee; IC = Investment Committee; ARC = Audit & Risk Committee; TSC = Tech & Safety Committee; GC = General Counsel. Agent approvers act only up to the autonomy–reversibility matrix (Part 0 §6).

## Standing gates

| Gate | Name | Trigger | Reversibility | Decision inputs (minimum) | Approver | SLA |
|---|---|---|---|---|---|---|
| **G-00** | Emergency Stop | Any authorized human, any Watchdog, or `PRIME` invokes halt on an agent, venture, or the whole system | Control action (always available) | Triggering evidence | Any single authorized human (uni-directional: stopping never needs quorum; **re-starting** needs the owning gate's approver) | Immediate |
| **G-16** | Constitutional Change | Any modification to Parts 0/X/XI/Appendix C, any autonomy-ceiling change, any change to Kernel enforcement rules | R4 | Evolution proposal (EP), impact analysis, rollback plan, red-team review | TSC quorum (≥3 humans) + CEO sign-off | ≤ 14 days |
| **G-17** | Public Communication | Brand/PR statements, public launches announcements, social posts beyond pre-approved templates, press interaction | R3 | Draft, audience, risk note | Named human comms owner (A1) | ≤ 24 h |
| **G-18** | Data Use Expansion | Any use of personal or customer data outside its approved classification/purpose; new data acquisition sources | R3 | Privacy review by `PRIVACY`, legal note | GC or delegated privacy officer | ≤ 5 days |

## Pipeline gates (Part V state machine)

| Gate | Name | Transition (Part V stages) | Reversibility | Decision inputs (minimum) | Approver | Envelope granted on pass |
|---|---|---|---|---|---|---|
| **G-01** | Opportunity Intake | Discovery → Trend Analysis/Research | R1 | Opportunity brief with source provenance | `PORTFOLIO` (A3, auto) | Research budget ≤ $2k |
| **G-02** | Research Commit | Research → Validation | R1/R2 | Research dossier, initial market sizing | `PORTFOLIO` (A3 ≤ $10k; above queues A2) | Validation budget ≤ $10k |
| **G-03** | Validation Verdict | Validation → Customer Discovery (or Kill) | R2 | Validation results vs. pre-registered kill criteria, DR | `PORTFOLIO` (A2) with weekly human IC-delegate review of the batch | Discovery budget ≤ $15k |
| **G-04** | Prototype Commit | Customer Discovery/Competitive/Modeling/Risk/Legal analyses → Prototype | R2 | Full analysis pack (Stages 5–9 outputs), DR | `PORTFOLIO` (A2) | Prototype budget ≤ $25k |
| **G-05** | MVP Commit | Prototype → MVP | **R3** | Prototype evidence, updated model, kill criteria for MVP | **Named human: Portfolio Review lead** (A1), weekly cadence | MVP budget ≤ $150k |
| **G-06** | Launch / GTM | MVP → PMF search (public launch, paid acquisition beyond tests) | **R3** | Launch readiness checklist (QA, security, legal, support), GTM plan | **Named human: Portfolio Review lead** + G-17 for public comms | GTM budget ≤ $100k/quarter |
| **G-07** | Venture Formation & Seed | PMF evidence → separate legal entity + seed allocation | **R4** | PMF evidence pack, 18-month plan, entity structure memo (GC), DR | **IC quorum (≥3) + GC** | Seed ≤ $1M; entity formed |
| **G-08** | Scale Funding | Internal series (growth capital tranche) | **R4** | Cohort economics, capacity plan, updated valuation | **IC quorum + CFO** | Tranche per IC resolution |
| **G-09** | Hiring | Hiring plan (R3); each individual offer (R3); executive hires (R4) | R3/R4 | Role case, comp banding, budget check | Plan/offers: **Head of People + hiring manager (human)**; exec: **EC** | Headcount per plan |
| **G-10** | Major Commitment | Any single contract/partnership > $100k total value or > 12 months term | **R3** | `CONTRACTS` review, counterparty risk check | **Named human budget owner + GC delegate** | Per contract |
| **G-11** | New Jurisdiction | Internationalization: operating/selling into a new legal jurisdiction | **R4** | Regulatory map (`REG-WATCH`), tax/entity memo, localized compliance plan | **IC + GC** | Per expansion plan |
| **G-12** | Acquisition | LOI issuance; separately, deal close | **R4** | Valuation (`MNA-ANALYST`), DD pack, integration plan, financing plan | LOI: **IC quorum**; Close: **Board majority** | Per resolution |
| **G-13** | Merger / Restructuring | Merging ventures, spin-outs, material reorg, any layoff/RIF | **R4** | Rationale DR, people impact plan, legal memo | **Board majority**; layoffs additionally require CEO + Head of People + GC | Per resolution |
| **G-14** | Exit | Sale of a venture, IPO process start | **R4** | Banker/valuation analysis, tax memo, board deck | **Board majority** | Per resolution |
| **G-15** | Shutdown | Venture wind-down and dissolution | **R4** | Post-mortem draft, customer/creditor obligations plan, data disposition plan | **IC quorum**; entity dissolution adds **GC** | Wind-down budget |

## Gate mechanics (binding)

1. **Pre-registration.** Kill criteria and success metrics for the next stage are registered at the gate, before capital is released. A gate pass without pre-registered kill criteria is invalid (Kernel-enforced).
2. **Evidence.** Every gate decision attaches a DR; R3+ gates require the human approver to acknowledge the top three risks and the rollback plan in writing (recorded in the DR).
3. **Queueing.** Actions exceeding an envelope do not fail; they queue at the appropriate gate. The Kernel enforces this conversion (A→A1) automatically.
4. **Batching.** A2 gates (G-03, G-04) are reviewed by humans in weekly batch: the human sees the full decision list and MAY veto retroactively within 7 days for anything still R2.
5. **No gate shopping.** A rejected gate submission may be resubmitted only with materially new evidence, flagged as a resubmission with a diff against the rejected DR.
6. **Stop asymmetry.** G-00 stops require one human; restarts require the owning gate's full approver set. Stopping must always be cheaper than starting.
