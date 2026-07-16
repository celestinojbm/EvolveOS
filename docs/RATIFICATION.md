# Founding Ratification & the `real_money` flag

Phase 0 issue [#11](https://github.com/celestinojbm/EvolveOS/issues/11) (P0-10). This is the concept-and-how-to guide for the single feature flag that gates real money: `real_money`. The flag is **purely derived** from human signatures on a constitutional document — there is no switch, no environment variable, and no admin bypass.

The artifacts:

| Artifact | What it is |
|---|---|
| [`RATIFICATION_PACK.md`](RATIFICATION_PACK.md) | The **operational pack** — the single, signable, machine-readable document the code reads and hashes. Its embedded JSON manifest is the source of truth; the §B threshold table and §C role table are **rendered from the manifest** and CI-checked for drift. |
| [`app/src/lib/ratification-core.ts`](../app/src/lib/ratification-core.ts) | The **pure core**: exact-byte digest, strict manifest parse/validate, derived readiness, table renderers, signature-evidence validation, and the injectable database evaluators. It has no productive file loader. |
| [`app/src/lib/flags.ts`](../app/src/lib/flags.ts) | The **only productive wrapper**: it always loads the canonical `RATIFICATION_PACK.md` and delegates to the core. Its public functions take no bytes/loader/override. Nothing outside these two files may import the core, emit the signature event, or evaluate `real_money` ([`ops/check-ratification-writer.mjs`](../ops/check-ratification-writer.mjs) enforces it in CI). |

The deeper constitutional context (founding amendment mode, MVP security deviations, re-entry triggers) lives in [`FOUNDING_RATIFICATION_PACK.md`](FOUNDING_RATIFICATION_PACK.md). That is prose; `RATIFICATION_PACK.md` is the source of truth the flag depends on.

## The manifest is the machine-readable source of truth

The manifest carries **structured** state, not just three booleans:

- `thresholds`: `{ id, concept, deployment_value, unit, status }` — each `resolved` or `unresolved`.
- `role_assignments`: `{ capacity, actor_id, name, required_signer, status }` — each `assigned` or `unassigned`.
- The **required signers are derived** from `role_assignments` where `required_signer: true`. There is no second signer list to diverge.
- `thresholds_resolved`, `roles_assigned`, `ratification_ready` are readable **declarations** — but the code **recomputes** them (`computeRatificationReadiness`) and rejects the pack if any declared value differs from the computed one. Flipping a boolean to `true` while a threshold is `UNRESOLVED` does not make the pack ready; it makes it **invalid**.

Readiness is computed, never trusted: every threshold present, unique, `resolved`, and free of placeholders (`UNRESOLVED`/`TBD`/`TODO`/`UNKNOWN`/empty); every required signer `assigned` with a valid actor id and name, a known capacity, and a **distinct** actor (one person may not cover multiple required-signing capacities); and a complete acknowledgement. The §B/§C Markdown tables are rendered from the manifest and `check:ratification` fails if either the manifest or a table is edited without the other.

## Three states

- **Proposed.** Thresholds are `UNRESOLVED` and/or signers are `UNASSIGNED`. Computed readiness is `false`; the declared booleans and `document_status: "proposed"` must agree with that. This is where `RATIFICATION_PACK.md` sits today. No signature can be recorded; `real_money` is `false`.
- **Ratification-ready.** A founder has resolved every threshold, assigned every role (each to a distinct registered human), and the computed readiness is `true` (so the declared booleans and `document_status: "ratification-ready"` must match). The pack can now be signed, but is not yet ratified.
- **Ratified.** Every required signer has recorded a valid, user-grounded signature bound to the pack's current exact-byte digest and version. Only now does `real_money` read `true`.

## The exact-byte digest

`pack_digest = SHA-256(exact UTF-8 bytes of RATIFICATION_PACK.md)`, lowercase hex. This is **not** the JSON canonicalization used for Decision Records — it is a hash of the whole Markdown file, byte for byte. Consequences:

- Signatures bind the **entire document**, not just the manifest. Editing a threshold, a name, a word of the non-scope, or the manifest changes the digest.
- **Any byte change invalidates every prior signature.** A signature carries the digest it was made against; once the file changes, no existing signature matches the new digest, so `real_money` falls back to `false` until every required signer signs the new bytes.
- The digest is never hardcoded. It is always recomputed from the file (in tests, the core parses fixture bytes directly — the productive wrapper never does).

## Recording a signature

A signature is a single, self-signed, append-only human event:

- Event type `ratification.signature_recorded`, object `founding-ratification-pack`, object id = the pack id.
- `actor_type = "human"`, `actor_id` = the signer themselves. **No delegated, automated, agent, env-var, seed, or config-flag signature is ever valid.**
- Payload: `pack_digest`, `pack_version`, `signer_actor_id`, `signer_capacity`, `acknowledgement_version`.

`recordRatificationSignature(client, input)` loads the **canonical** pack and verifies, before emitting anything: the pack id and digest the signer expects both match the current file; the pack is ratification-ready; the signer is a required signer with the given capacity; the acknowledgement text matches the pack's signature statement. Then, **inside the transaction** (after the advisory lock), it **grounds** the signer to a registered user: the `actor_id` must exist in `users`, the user's `display_name` must equal the manifest name, and operational capacities must hold the matching active role (`portfolio_review_lead` → `approver`; `operator` → `operator`). `founding_signatory` / `curator` require a registered user only (no dedicated role enum in issue #11 — a documented limit). It is idempotent — re-signing the same **full evidence** returns the existing event id — and two concurrent identical signatures collapse to one (serialized by the event-chain advisory lock).

## How the flag is evaluated

`isRealMoneyEnabled(client)` is a pure read that returns `true` only when **all** of the following hold:

1. `RATIFICATION_PACK.md` is structurally valid and internally consistent (one manifest, strict JSON, known capacities, distinct signers, declared booleans equal to computed readiness).
2. Computed readiness is `true` (no `UNRESOLVED` threshold, no `UNASSIGNED` role).
3. For the pack's **current** digest and version, every required signer has a valid signature event (`validateRatificationSignatureEvent`: correct event type/object, `actor_type = "human"`, exact `actor_id`, exact digest, exact version, exact capacity, exact acknowledgement version — every field type-checked before comparison).
4. Every required signer is **still grounded** — the user still exists, the name still matches, and the role is still active. A revoked role or a renamed/deleted user drops the flag back to `false`.

Any doubt → `false`. A fresh database is always `false`.

## Why there is no override

`real_money` records that a human ratification act happened; it is not a convenience toggle. An environment override, a default-true, an admin bypass, or a seeded signature would each let real money be enabled without the constitutional signatures — exactly the failure this flag exists to prevent. So there is none: no mutable `real_money` column, no env var, no admin path, no auto-signature in migrations. The only way to `true` is real human signatures on the real bytes.

## Why `true` still moves no money

Enabling `real_money` does **not** execute a payment. The pack's `THR-SPEND-EXEC` is `$0`: this deployment authorizes no spend execution at all in v1. The gate system independently rejects any `requestedSpend ≠ 0` (ADR-006, [`GATE_SYSTEM.md`](GATE_SYSTEM.md)), and that is unchanged by this flag. The flag is a **precondition** that records ratification; the actual money-moving mechanisms — payments, treasury, transfers — are out of scope here and are not built by issue #11.

## Boundary with issue #12

Issue #11 delivers only (1) the signable document, (2) the human signature protocol, (3) the derived `real_money` flag. It does **not** build the technical G-00 stop mechanism, a technical restart, or any spend execution — those are later work (the manual G-00 procedure in `RATIFICATION_PACK.md` §D is documentary only; there is no `stop.ts` and `gates.ts` is not blocked). The automatic G-00 mechanism is **issue #12**.

## Running it

```bash
pnpm build                # the check imports the compiled core to verify manifest↔tables
pnpm check:ratification   # CI guard: single owner; no bypass; manifest↔tables consistent
pnpm test                 # app/test/flags.test.ts — validation, readiness, signatures, grounding, concurrency
```

There are **no** real signatures in this repository. Signing is a human act performed against the real, resolved pack; the tests drive the pure core with an isolated ratification-ready fixture and test users only, and never expose a productive path that activates the flag from arbitrary bytes.
