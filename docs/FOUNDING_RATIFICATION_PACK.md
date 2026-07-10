# Founding Ratification Pack

**Status:** DRAFT — not yet signed. This document becomes effective only when the founder signature events described in §7 exist in the append-only event log. Until then it is a template and carries no authority.

**Purpose.** This Pack operationalizes the **founding amendment mode** authorized by the Constitutional Layer (`spec/00-overview.md` §4.1). It is the single human-signed instrument that (a) ratifies the constitutional core, (b) names who may exercise founding-stage authority, (c) records the pathfinder-scale numbers that supersede the unratified `[ASSUMPTION]` thresholds, (d) authorizes the temporary MVP-scale deviations, and (e) fixes the re-entry triggers that end each temporary allowance. It exists because the constitution's normal amendment path (gate G-16) needs a Tech & Safety Committee that cannot be seated until the first G-07 — see `spec/00-overview.md` §4.1 for the constitutional authorization and its hard limits.

Related build decision: [ADR-006](ARCHITECTURE_DECISIONS.md) (real-money flag stays off until this Pack is signed). Scope of the first venture: [MVP Scope](MVP_SCOPE.md). Phase 0 delivery item: [Phase 0 Backlog](PHASE_0_BACKLOG.md) P0-10.

---

## 1. Founding Amendment Mode

Mirrors and does not exceed `spec/00-overview.md` §4.1. If this section and the constitutional clause ever diverge, the constitutional clause prevails.

| Property | Rule |
|---|---|
| **Who may act** | Only the named founding signatories in §7, by explicit human signature. No agent or automated process may invoke it. |
| **Duration** | From founding until the **first G-07** (entity formation). Auto-terminates then; cannot be re-entered. |
| **May amend (provisionally)** | Pathfinder-scale dollar thresholds; role / accountable-officer assignments; the authorized MVP-scale security substitutions (§5); the list of founding signatories; textual corrections to the Constitutional Layer. |
| **MUST NOT do** | Weaken the autonomy–reversibility matrix; raise any agent's autonomy ceiling; enable real money before this Pack is signed; bypass G-00; weaken the human-mandatory decision set; grant any agent external credentials in Phases 0–2; amend the founding amendment mode itself. |
| **Evidence required** | A human signature event in the append-only log (hardware-key-signed, or via the §5 MVP second-factor substitution) plus a Decision Record marked `provisional-founding` recording signer, change, rationale, and an attestation that no entrenched guardrail is touched. |
| **After termination** | Only G-16 applies. Every `provisional-founding` amendment still in force goes on the first Tech & Safety Committee's mandatory agenda to be ratified via G-16 or reverted. |

**Fail-closed properties:** human-only, single-window, self-non-extending, strictly narrower than G-16. If any condition is ambiguous, the mode does **not** authorize the action.

---

## 2. Ratification statement (to be affirmed by each signer)

> I have read `spec/00-overview.md` (§4–§9), Appendix C, Appendix B (autonomy ceilings), Part XI (§4–§5), the Buildability Audit, and MVP Scope. On merge of the founding specification I ratify the Constitutional Layer (Parts 0, X, XI, Appendix C) with the understanding recorded in §3 and §4, subject to the deviations in §5 and the triggers in §6. I understand that the autonomy–reversibility matrix is a policy, not an enforced control, during Phases 0–2, and that MVP safety rests on capability absence ([ADR-007](ARCHITECTURE_DECISIONS.md)), which must not be relaxed before Phase-3 envelope enforcement and the XV-9 formal model exist.

---

## 3. What is ratified (binding; amendable only via G-16, or the founding mode until first G-07)

1. The reversibility taxonomy **R1–R4** on a worst-case-cost basis. The dollar bounds are **not** ratified as constitutional numbers — they are `[ASSUMPTION]`, superseded for this deployment by the pathfinder-scale table in §4.
2. The autonomy ladder **A0–A4** and the **autonomy–reversibility matrix**.
3. The **anti-circularity rule**: no agent, orchestrator, or self-evolution process may raise its own autonomy ceiling.
4. The **gate structure G-00…G-18** and their human approver bodies.
5. The **agent autonomy ceilings** in Appendix B (not the agent roster, which is revisable).
6. The **human-mandatory-forever decision set** and its entrenchment clause (Part XI §5).
7. **G-00** emergency stop and **G-16** as the standing amendment path; the **founding amendment mode** (§1) as the temporary bootstrap path.
8. **Kill-criteria pre-registration invalidity** (a gate pass without pre-registered kill criteria is void).

## 4. What is NOT ratified / pathfinder-scale values

- **Zero spending is authorized** by ratifying. The real-money flag stays off until this Pack's signature events exist ([ADR-006](ARCHITECTURE_DECISIONS.md)).
- No legal entity, funding, hiring, M&A, exit, or external agent action (gates G-07…G-15 are unreachable in the MVP).
- No autonomy above A1 in Phases 0–2.
- The committee machinery (IC / TSC / ARC / Board) is dormant until the first G-07.

**Pathfinder-scale threshold table** (supersedes the §5 `[ASSUMPTION]` $10M-scale numbers for this deployment; set by founding signature; re-ratified at 2× scale):

| Class | Pathfinder-scale bound (to be set at signing) |
|---|---|
| R1 | — |
| R2 | — |
| R3 | — |
| R4 | — |

Until this table is signed, every threshold is treated as `pending_ratification` and no agent-adjacent spend is possible.

---

## 5. Authorized MVP deviations (temporary; each with a re-entry trigger)

Each row is a conscious, recorded deviation from a ratified constitutional requirement, allowed only at MVP scale and only until its trigger fires. Recording them here is what keeps the shipped system conformant-by-exception rather than silently non-conformant.

| Deviation | Ratified requirement it relaxes | Re-entry trigger |
|---|---|---|
| **TOTP / WebAuthn second factor** instead of hardware-security-key co-signature on approvals | Revision XV-2 (hardware key + out-of-band for all R4) | First reachable R4 gate, or first real treasury movement |
| **Single-human operational restart** after a scoped stop | Revision XV-1 (three-human emergency-restart quorum for infrastructure scope) | First infrastructure-scope stop beyond a single console, or first external agent capability |
| **Temporary accountable-officer concentration** (one human owns PRIME / PORTFOLIO / EVOLVE and the director set) | Part XI §4 one-officer-per-director model at scale | More than 10 concurrent ventures, or first G-08 (scale funding) |

---

## 6. Re-entry triggers (what each future first event activates)

When any trigger below fires, the corresponding temporary allowance ends and the full constitutional requirement takes effect (via G-16 if the founding mode has terminated).

| Trigger (first occurrence) | Activates / ends |
|---|---|
| First real spend | Real-money flag on only if this Pack is signed; unit-economics metering; treasury controls begin |
| First external agent capability | Ends capability-absence safety ([ADR-007](ARCHITECTURE_DECISIONS.md)); requires envelope enforcement + the XV-9 formal Kernel model before the grant |
| First G-07 (entity formation) | Ends the founding amendment mode; seats IC / TSC / Board; G-16 becomes the sole amendment path |
| First GC / legal counsel seated | Legal sign-off on the delegation theory and DR-privilege posture becomes a standing input |
| First IC / TSC seated | Committee quorums for R4 gates become live; provisional founding amendments go to mandatory review |
| First real treasury | Split-knowledge / hardware-key controls and treasury movement authorities take full effect |
| First hire | Human HR / employment obligations and the hiring gate (G-09) take effect |
| First legal entity | Corporate governance, fiduciary duties, and D&O requirements attach to named humans |

---

## 7. Founder signing checklist

Sign only after every box is checked. Each signature is recorded as a human signature event; this document references those events, it does not store credentials.

- [ ] I have read `spec/00-overview.md` §4–§9, Appendix C, Part XI §4–§5, the Buildability Audit, and MVP Scope.
- [ ] I understand ratifying authorizes **zero spending** and no external action.
- [ ] I understand the autonomy–reversibility matrix is a policy, not an enforced control, in Phases 0–2, and that capability absence ([ADR-007](ARCHITECTURE_DECISIONS.md)) is the real MVP safeguard and must not be relaxed early.
- [ ] I accept the accountable-officer concentration in §5, or I have reassigned PRIME / PORTFOLIO / EVOLVE to distinct officers.
- [ ] I have named ≥ 2 humans per R3 approver seat, or I accept pipeline halt on a single approver's absence.
- [ ] I have set the pathfinder-scale threshold table in §4.
- [ ] I confirm the §5 deviations and §6 triggers are acceptable.
- [ ] I confirm a realistic path to recruit the external independents and the AI-safety-qualified director that the first G-07 requires (Part XI, Revision XV-7).

**Signatories** (name / role / signature event id):

| Name | Role | Signature event |
|---|---|---|
| — | — | (unsigned) |
| — | — | (unsigned) |

---

## 8. Consciously-accepted risks

- **False security:** for Phases 0–2 the matrix has no Kernel enforcement; safety is capability absence, a revisable ADR. Any first external-capability grant is its own gated decision.
- **Governance thinness:** proposer≠approver is enforced by actor-id inequality; at 2–5 founders true independence does not yet exist. Keep operator and approver as different people wherever headcount allows.
- **Recruiting dependency:** the venture-formation engine is hard-gated on scarce independents; if they cannot be seated, the machine stays at single-console scale (fails closed).
- **Founder exposure:** non-delegable fiduciary / legal attestations attach to named humans once an entity exists; D&O insurability for an AI-operated business is itself uncertain.

## 9. Blocking conditions (progress halts if any is unmet)

- No real-money step before this Pack's signature events exist.
- No autonomy above A1, and no external agent credentials, in Phases 0–2.
- No R4 action automated, ever.
- No first G-07 before the required independents (and an AI-safety-qualified director) are actually seated.
- No crossing of a re-entry trigger's boundary before that trigger's full requirement is in force (e.g., no external agent capability before envelope enforcement + the XV-9 model exist).
