# Founding Ratification & the `real_money` flag

Phase 0 issue [#11](https://github.com/celestinojbm/EvolveOS/issues/11) (P0-10). This is the concept-and-how-to guide for the single feature flag that gates real money: `real_money`. The flag is **purely derived** from human signatures on a constitutional document — there is no switch, no environment variable, and no admin bypass.

The two artifacts:

| Artifact | What it is |
|---|---|
| [`RATIFICATION_PACK.md`](RATIFICATION_PACK.md) | The **operational pack** — the single, signable, machine-readable document the code reads and hashes. It carries a threshold table, role assignments, the manual G-00 procedure, the MVP non-scope, the signature statement, and one embedded JSON manifest. |
| [`app/src/lib/flags.ts`](../app/src/lib/flags.ts) | The **single owner** of the evaluation: it parses the pack, computes the exact-byte digest, records signatures as append-only events, and derives `real_money`. Nothing else may do any of this ([`ops/check-ratification-writer.mjs`](../ops/check-ratification-writer.mjs) enforces it in CI). |

The deeper constitutional context (founding amendment mode, MVP security deviations, re-entry triggers) lives in [`FOUNDING_RATIFICATION_PACK.md`](FOUNDING_RATIFICATION_PACK.md). That is prose; `RATIFICATION_PACK.md` is the source of truth the flag depends on.

## Three states

- **Proposed.** The document exists but its thresholds are `UNRESOLVED` and/or its signers are `UNASSIGNED`. The manifest says `ratification_ready: false`. This is where `RATIFICATION_PACK.md` sits today. No signature can be recorded; `real_money` is `false`.
- **Ratification-ready.** A founder has resolved every threshold, assigned every role, removed every `UNASSIGNED` placeholder, and set `ratification_ready`, `thresholds_resolved`, and `roles_assigned` all to `true`. The pack can now be signed, but is not yet ratified.
- **Ratified.** Every required signer has recorded a valid signature bound to the pack's current exact-byte digest and version. Only now does `real_money` read `true`.

## The exact-byte digest

`pack_digest = SHA-256(exact UTF-8 bytes of RATIFICATION_PACK.md)`, lowercase hex. This is **not** the JSON canonicalization used for Decision Records — it is a hash of the whole Markdown file, byte for byte. Consequences:

- Signatures bind the **entire document**, not just the manifest. Editing a threshold, a name, a word of the non-scope, or the manifest changes the digest.
- **Any byte change invalidates every prior signature.** A signature carries the digest it was made against; once the file changes, no existing signature matches the new digest, so `real_money` falls back to `false` until every required signer signs the new bytes.
- The digest is never hardcoded. It is always recomputed from the file (or, in tests, from injected fixture bytes).

## Recording a signature

A signature is a single, self-signed, append-only human event:

- Event type `ratification.signature_recorded`, object `founding-ratification-pack`, object id = the pack id.
- `actor_type = "human"`, `actor_id` = the signer themselves. **No delegated, automated, agent, env-var, seed, or config-flag signature is ever valid.**
- Payload: `pack_digest`, `pack_version`, `signer_actor_id`, `signer_capacity`, `acknowledgement_version`.

`recordRatificationSignature(client, input)` reloads the **current** pack and verifies, before emitting anything: the pack id and digest the signer expects both match the current file; the pack is ratification-ready; the signer appears exactly once in `required_signers` with the given capacity; the acknowledgement text matches the pack's signature statement. It is idempotent — re-signing the same `(signer, capacity, digest)` returns the existing event id — and two concurrent identical signatures collapse to one (serialized by the event-chain advisory lock).

## How the flag is evaluated

`isRealMoneyEnabled(client)` is a pure read that returns `true` only when **all** of the following hold:

1. `RATIFICATION_PACK.md` is structurally valid (one manifest, strict JSON, known capacities, unique signers).
2. It is ratification-ready (no `UNRESOLVED` / `UNASSIGNED`; the three readiness booleans are `true`).
3. For the pack's **current** digest and version, every required signer has a valid signature event — correct event type/object, `actor_type = "human"`, exact `actor_id`, exact digest, exact version, exact capacity.

Any doubt → `false`. A fresh database is always `false`.

## Why there is no override

`real_money` records that a human ratification act happened; it is not a convenience toggle. An environment override, a default-true, an admin bypass, or a seeded signature would each let real money be enabled without the constitutional signatures — exactly the failure this flag exists to prevent. So there is none: no mutable `real_money` column, no env var, no admin path, no auto-signature in migrations. The only way to `true` is real human signatures on the real bytes.

## Why `true` still moves no money

Enabling `real_money` does **not** execute a payment. The pack's `THR-SPEND-EXEC` is `$0`: this deployment authorizes no spend execution at all in v1. The gate system independently rejects any `requestedSpend ≠ 0` (ADR-006, [`GATE_SYSTEM.md`](GATE_SYSTEM.md)), and that is unchanged by this flag. The flag is a **precondition** that records ratification; the actual money-moving mechanisms — payments, treasury, transfers — are out of scope here and are not built by issue #11.

## Boundary with issue #12

Issue #11 delivers only (1) the signable document, (2) the human signature protocol, (3) the derived `real_money` flag. It does **not** build the technical G-00 stop mechanism, a technical restart, or any spend execution — those are later work (the manual G-00 procedure in `RATIFICATION_PACK.md` §D is documentary only; there is no `stop.ts` and `gates.ts` is not blocked). The automatic G-00 mechanism is **issue #12**.

## Running it

```bash
pnpm check:ratification   # CI guard: only flags.ts owns ratification + real_money
pnpm test                 # app/test/flags.test.ts — validation, signatures, flag, concurrency
```

There are **no** real signatures in this repository. Signing is a human act performed against the real, resolved pack; the tests exercise the protocol with an isolated ratification-ready fixture and test actors only.
