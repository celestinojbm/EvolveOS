# Event log (L0) — append-only + hash chain

**Status:** Phase 0 · Implements issue **[#6](https://github.com/celestinojbm/EvolveOS/issues/6)** (P0-5). The first operational piece of the Kernel's audit plane: a single append-only `events` table where each row is hash-linked to the one before it. Part VI §1 (L0 event log) at [ADR-002](ARCHITECTURE_DECISIONS.md) scale — one Postgres table, no event bus, no queue, no worker.

Persistence choice (raw SQL + `pg`, no ORM) is [ADR-009](ARCHITECTURE_DECISIONS.md).

## The table

`ops/migrations/0002_events.sql` creates `events`:

| Column | Type | Notes |
|---|---|---|
| `seq` | `bigint` identity, PK | Insertion order = chain order |
| `id` | `text` unique | Caller-supplied logical id (e.g. a ULID) |
| `timestamp` | `text` | ISO-8601 string, caller-supplied (stored verbatim so the hash is reproducible) |
| `actor_type` | `text` | One of `human, agent, kernel, watchdog, system` (CHECK) |
| `actor_id` | `text` | Who acted |
| `event_type` | `text` | What happened |
| `object_type`, `object_id` | `text` | What it was about (a venture is `object_type='venture'`) |
| `payload` | `jsonb` | Event-specific data (a reversibility class, when relevant, lives here) |
| `previous_hash` | `text` | The prior row's `hash`; `null` for the genesis event |
| `hash` | `text` unique | This row's hash (see below) |
| `trace_id` | `text` | Optional correlation id |

The columns mirror [`schemas/event.schema.json`](../schemas/event.schema.json) (the canonical record shape from issue #4) plus `seq`. See "Relationship to the schema" below for the two deliberate reconciliations.

## Event format and hashing

The **canonical record** is exactly the `event.schema.json` fields. The hash covers the *whole* record (not just the payload):

```
hash = sha256( canonicalize({ id, timestamp, actor_type, actor_id, event_type,
                              object_type, object_id, payload, previous_hash, trace_id }) )
```

`canonicalize` is deterministic JSON: object keys sorted recursively, arrays preserved, no insignificant whitespace. Because `previous_hash` is inside the hashed object, each hash depends on **both the full current event and the previous hash** — tampering with any field (actor, type, timestamp, object reference, or payload) changes the hash and breaks the chain.

This is a deliberate strengthening of the issue's `H(prev_hash ‖ canonical(payload))` sketch, which would only detect payload tampering.

## The single write path

`app/src/lib/eventlog.ts` is the **only** code that inserts into `events`:

- `appendEvent(client, input)` — reads the current head, links `previous_hash`, computes `hash`, inserts. Runs in a transaction with a `pg_advisory_xact_lock` so concurrent appends can't fork the chain. `id` and `timestamp` are caller-supplied, so the function is deterministic (no `Date.now()`/random inside).
- `verifyChainRecords(events[])` — pure verification of an ordered dump: checks each link and re-computes each hash. Returns `{ ok, brokenAt?, reason? }`.
- `verifyChainInDb(client)` — reads the whole table in `seq` order and verifies it (also checks `seq` is strictly increasing).

The operator CLI [`ops/verify-log.ts`](../ops/verify-log.ts) (issue [#13](https://github.com/celestinojbm/EvolveOS/issues/13)) builds on these: `pnpm verify:events` re-verifies the whole chain **and** every event-type convention, and `pnpm audit:log -- extract …` produces a human audit extract for a date range or venture. It reuses `computeHash`/`canonicalize` from here (no second hashing authority) and the taxonomy in [`docs/AUDIT_CONVENTIONS.md`](AUDIT_CONVENTIONS.md).

`ops/check-single-writer.mjs` (CI) fails the build if any source file outside `eventlog.ts` contains a direct `INSERT/UPDATE/DELETE` on `events`.

## Append-only enforcement

Enforced by the **database**, not by convention. `0002_events.sql` installs `BEFORE UPDATE`, `BEFORE DELETE`, and `BEFORE TRUNCATE` triggers that `RAISE EXCEPTION 'events is append-only; … is not permitted'`. The only permitted mutation is `INSERT`.

## What it guarantees / what it does NOT

**Guarantees:**
- No in-place edit or delete of a stored event (DB triggers reject `UPDATE`/`DELETE`/`TRUNCATE`).
- Any single-row tampering is detectable: a changed field fails hash re-computation; a rewritten link fails the `previous_hash` check.
- Deterministic, reproducible hashes across processes.

**Does NOT guarantee (out of scope for Phase 0, documented honestly):**
- It does not stop someone with **superuser/DDL access** who disables the triggers and rewrites the entire chain tail from a tampered point. Detecting a full re-forge needs an **external trusted anchor** (e.g. periodically publishing the head hash somewhere append-only elsewhere) — a later issue.
- It is not distributed, not an event bus, and not ordered across multiple writers beyond the single-Postgres `seq`.
- It does not authenticate actors (auth/roles are a later issue); `actor_*` are recorded, not verified here.

## Running it

```bash
pnpm migrate          # apply ops/migrations/*.sql (creates events + triggers) to $DATABASE_URL
pnpm test             # vitest: hashing/tamper (pure) + append/triggers (Postgres)
pnpm check:eventlog   # CI guard: no event writes outside eventlog.ts
pnpm verify:events    # verify the live chain + conventions in $DATABASE_URL (exit 1 if broken); runs via tsx, no build needed
```

`DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5432/evolveos` (start it with `pnpm db:up`) — a throwaway local-dev value, not a secret.

## Known limitations (deliberate)

- Single Postgres, single writer, single process ordering (`seq`). No cross-node consensus — by design (ADR-002).
- No external anchor yet (see "does NOT guarantee"), so full-tail re-forge under DB-admin compromise is out of scope for Phase 0.
- `venture_id` / `reversibility_class` are represented through the schema's existing fields rather than dedicated columns (see below), pending any decision to extend `event.schema.json`.

## Relationship to the schema (two reconciliations)

The early issue sketch listed `venture_id` and `reversibility_class` columns and `hash = H(prev_hash ‖ payload)`. To avoid amending the constitutional `event.schema.json` (`additionalProperties: false`, created in issue #4):

1. A **venture** is referenced via `object_type='venture'` + `object_id`; a **reversibility class**, when relevant, travels in `payload`. Both are inside the hashed record, so both are integrity-protected. Promoting them to first-class columns would require extending `event.schema.json` through the generated-data flow — intentionally left out of this change.
2. The **hash covers the full record**, not just the payload (stronger tamper detection, as described above).
