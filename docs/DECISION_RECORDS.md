# Decision Record tooling — create, validate, file, amend, render

**Status:** Phase 0 · Implements issue **[#10](https://github.com/celestinojbm/EvolveOS/issues/10)** (P0-9). Part VII §2 (the DR) and §8.2 (the decision brief). [`app/src/lib/dr.ts`](../app/src/lib/dr.ts) is the **single owner of DR content canonicalization and the DR store** — nothing else computes a DR digest or writes `decision_records` ([`ops/check-dr-writer.mjs`](../ops/check-dr-writer.mjs), `pnpm check:dr`).

## One canonicalization, shared with the gate system

The canonical bytes and digest are the ones established in issue #9 and are **binding**:

```
digest = SHA-256_lowercase_hex( canonicalize(document) )
```

where `canonicalize` is [`eventlog.ts`](../app/src/lib/eventlog.ts)'s deterministic key-sorted JSON. `dr.ts` is the canonical owner of `digestDecisionRecordContent` / `snapshotDecisionRecordContent`; **`gates.ts` imports them** and never re-implements canonicalization, so a gate pass binds to exactly the bytes `dr.ts` filed. A golden test pins the digest so the refactor cannot silently change it.

## Schema reconciliation (Part VII §2.2 vs the reduced P0 schema)

The issue-#3 schema was a reduced form and could not represent the mandatory Decision Brief sections. [`schemas/decision-record.schema.json`](../schemas/decision-record.schema.json) is **extended minimally and additively** (version bumped `0.1.0 → 1.0.0`), aligned to Part VII field names, staying within the standard-library validator's keyword subset (no `$ref`/`oneOf`/`anyOf`). Added, all **optional** so issue-#9 minimal DRs and the generated-type test stay valid:

| Field | Meaning |
|---|---|
| `schema_version` | stamped by the store at filing |
| `options[]` (`option_id`, `summary`, `predicted_outcome_distribution`, `evidence_refs`, `risk_note`) | the options considered; a stable id + summary + (optional) outcome/uncertainty per option |
| `chosen_option` | references an `option_id` |
| `dissent_record[]` (`author`, `position`, `argument`, `reference`, `shown_to_humans`) | verbatim dissent |
| `amends_dr_id` | set when this DR amends another |

`kill_criteria`/`risks` stay `string[]` and `rollback_plan` stays a string (the P0 forms issue #9 binds to) — **not** re-modelled, so the gate system is untouched. The full production schema (Monte-Carlo distributions, calibration fields, financial models) is **out of scope** for P0-9. Appendix A and Part VII are **unchanged**.

## Filed vs approved (they are different acts)

- **Filed** — the DR content is persisted immutably and given a `DR-yyyy-seq` id. `status: "approved"` inside the content is just content.
- **Approved** — a human `approval.recorded` event (issue #7) bound to the filed **digest**.

Filing a DR with `status: approved` does **not** substitute for the human approval event. The Phase 0 order is:

1. Build and **file** the final DR → obtain its `id` + stored `digest`.
2. Record `approval.recorded` against that digest (issue-#7 `recordApproval`, digest format-validated).
3. **Pass the gate by `decisionRecordId`** — the gate loads the filed DR, re-derives the digest, checks the approval binds to it, and executes.

Without approval evidence there is no pass; the gate still requires `approvalEventId`.

## The store (`ops/migrations/0006_decision_records.sql`)

- `decision_record_counters(year, last_seq)` — per-year sequence for `DR-yyyy-seq`, minted under the event-chain advisory lock (mirrors `venture_counters`); concurrent filings get unique, gap-free ids. CHECKs: `year` in 1000–9999, `last_seq > 0`.
- `decision_records` — `id` (format-checked), `canonical_json` (**the exact hashed bytes**, TEXT), `document_json` (JSONB projection), `content_digest` (SHA-256-hex checked), `schema_version`, `amends_dr_id` (nullable self-FK, `<> id` CHECK), `file_event_id` (UNIQUE FK to `events`), `filed_by`, `filed_at`.
- **Column↔document binding CHECKs**: `document_json->>'id' = id`, `document_json->>'schema_version' = schema_version`, and `document_json->>'amends_dr_id' IS NOT DISTINCT FROM amends_dr_id` (NULL-safe on purpose — a plain `=` evaluates to NULL on a one-sided NULL and a NULL CHECK *passes*). A projection that disagrees with the row identity/version/amendment-link is unrepresentable even by direct INSERT.
- **`gate_passes.dr_id` FK** → `decision_records(id)`, added idempotently via a `pg_constraint` catalog check in a `DO` block (`ADD CONSTRAINT IF NOT EXISTS` is not uniformly available). This closes the issue-#9 seam: a gate pass cannot cite an unfiled DR even by direct INSERT.
- **Append-only**: `BEFORE UPDATE/DELETE/TRUNCATE` triggers raise (the same discipline as `events`); a plain `TRUNCATE` is additionally blocked by the incoming FK. JSONB is a projection, **never** the canonical representation — reads verify `canonicalize(document_json) = canonical_json`.

## Immutability and amendments

A filed DR **never changes**. The only way to revise or complete one is to file **another** immutable DR that sets `amends_dr_id` to the original and is recorded with a `decision_record.amended` event (a plain filing emits `decision_record.filed`). The original bytes are byte-identical before and after — tests assert it, and assert `UPDATE`/`DELETE`/`TRUNCATE` are all rejected. There is no JSON-patch/overwrite API.

## `dr.ts` API

| Function | Purpose |
|---|---|
| `validateDecisionRecord(document)` | JSON Schema + Part VII semantics → `{ ok, errors: [{ path, keyword, message }] }` (field-level, not one opaque string) |
| `snapshotDecisionRecordContent(document)` | deep clone → canonical JSON → validate → digest (the primitive **reused by `gates.ts`**) |
| `digestDecisionRecordContent(document)` | the canonical SHA-256-hex digest |
| `fileDecisionRecord({ document, filedBy, year? })` | mint id, stamp `schema_version`, validate, emit one `decision_record.filed`, insert — atomic; request captured before the first `await`, advisory lock first |
| `fileDecisionRecordAmendment({ amendsDrId, document, filedBy, year? })` | a new linked DR + `decision_record.amended` |
| `getDecisionRecord(id)` | the **trust boundary** — full re-verification before anything is returned (below); returns a **deep-frozen** document or throws on corruption |
| `getAmendmentsOf(id)` | the amendment chain |
| `renderDecisionBrief(record)` | deterministic ≤2-page markdown brief (§8.2) |

**Field-level validation** (beyond the schema): unique `option_id`s; `chosen_option` must resolve; **R3/R4 ⇒ ≥2 options, each with a non-empty `predicted_outcome_distribution`** (an option with no distribution — or an empty `{}` — carries no predictive information; the field stays structurally optional so R1/R2 DRs remain filable without it), **and ≥1 non-blank risk** (the §8.2 brief must surface top risks — a material decision can never render "No risks recorded"); **R2+ ⇒ non-blank kill criteria and rollback plan** (Part VII §2.2 — this is why a standing G-17/G-18 DR, being R3, now carries kill criteria even though the gate registry does not itself demand them); no whitespace-only required strings; an amendment cannot reference itself. **Gate-specific** requirements (which gate, `status: approved`, reversibility-vs-gate, kill-mandatory-per-registry) remain in `gates.ts`; the gate registry is **not** duplicated in `dr.ts`.

## Reading is a trust boundary

`getDecisionRecord` returns a row only after **all** of:

1. `content_digest` is a well-formed SHA-256 hex string **and** equals a fresh recomputation over the stored canonical bytes;
2. the canonical bytes round-trip (they really are canonical) and the JSONB projection canonicalizes to exactly the same string;
3. the parsed document **still passes `validateDecisionRecord`** (schema + Part VII semantics) — an archived document that no longer validates is corruption, and the error carries the field-level errors;
4. column↔document bindings hold: `document.id === row.id`, `document.schema_version === row.schema_version`, `document.amends_dr_id ?? null === row.amends_dr_id`;
5. the **filing event semantically represents this filing** — it exists, its type is `decision_record.filed` (or `.amended` when `amends_dr_id` is set), its `object_type`/`object_id`/`actor_id` match the row, and its payload's `content_digest`/`schema_version`/`amends_dr_id` match the row. A mere FK to *some* event is not evidence.

Any mismatch throws a specific corruption error — corruption is rejected, never returned. Tests materialize each corruption (schema-invalid document, every column↔document mismatch, wrong-type / wrong-object / wrong-digest filing events) by direct insert and assert both the DB backstop and the read layer reject them; gate passes reject the same rows because they load through `getDecisionRecord`.

The returned document is **deep-frozen** (a recursive `deepFreeze`: objects, arrays, objects nested in arrays, and `predicted_outcome_distribution` included) — `document.title = …`, `options.push(…)`, `options[0].summary = …`, and `dissent_record[0].argument = …` all throw under ESM strict mode, and tests confirm the canonical bytes and digest are unchanged after the attempts.

## Integration with the gate system (issue #9)

The public gate functions (`passG01CreateVenture`, `passPipelineGate`, `passStandingGate`, `passGate`) now take a **`decisionRecordId`**, never a caller-supplied document. Inside the serialized gate transaction: **load** the filed DR, **verify** canonical bytes + digest, apply the **gate** semantics, check the **approval** digest equals the stored digest, then execute. All issue-#9 guarantees are unchanged: exactly one `gate_passed`, one transaction, single write authority, approval binding, canonical reversibility, `proposer ≠ approver`, a live approver-role check, **no** `venture.created`, **no** `venture.stage_advanced`.

## The decision brief (Part VII §8.2)

`renderDecisionBrief(record)` produces deterministic markdown in the exact order: **1** the ask (one sentence + reversibility + gate + envelope delta when present), **2** options table (chosen marked, uncertainty shown, no invented scores — and always real for R3/R4, whose options cannot be filed without a distribution), **3** top three risks, each stating its mitigation **or its absence flatly** — the Phase 0 DR keeps `risks: string[]` with no separate mitigation field, so every shown risk carries the explicit line *"Mitigation: not separately recorded in the Phase 0 DR."* (declared honestly, never invented; the rest are pointed to, not hidden), **4** dissent **verbatim**, **5** kill criteria + rollback, **6** drill-down (id + digest + evidence + amend link). See [`docs/templates/dr-template.md`](templates/dr-template.md) for the shape and a rendered example.

**Two-page limit.** Markdown has no stable pagination, so the limit is an operational **word budget** (`DECISION_BRIEF_WORD_LIMIT = 900`, ≈ two pages). Mandatory content is **never** truncated to fit — overflow throws `DecisionBriefTooLong { words, limit }` so the caller compresses the DR itself. Dissent and risks are never dropped to make the budget.

## What it guarantees / does NOT

**Guarantees:** invalid DRs are rejected with field-level errors; a filed DR is immutable (DB-enforced) and can only be revised by a linked amendment; one canonicalization/digest shared with the gate system (no second definition); reads are a full trust boundary (digest, canonical bytes, JSONB, re-validation, column↔document bindings, and the filing event itself) that rejects corruption instead of returning dubious bytes, and returns deep-frozen documents; a gate pass cannot cite an unfiled DR even at the DB layer (`gate_passes.dr_id` FK); R3/R4 DRs always carry per-option uncertainty and ≥1 risk; the brief renders every mandatory section deterministically — each shown risk stating mitigation or its absence — and refuses to ship over-length rather than truncate.

**Does NOT (out of scope for P0-9):** the full production DR schema (Monte-Carlo/calibration/scoring); resubmission-diff validation (a rejected DR vs a new one — still deferred); DR authenticity beyond the content hash (actor identity is recorded, not verified — see [AUTH](AUTH.md)); any dashboard/UI/API, agents, or external side effects.

## Running it

```bash
pnpm migrate        # applies 0006_decision_records.sql
pnpm check:dr       # CI guard: single DR-store writer / one canonicalization
pnpm test           # vitest: schema/field errors, filing/ids/atomicity, immutability,
                    #         amendments, corruption-on-read, gate integration, brief
pnpm verify:events
```
