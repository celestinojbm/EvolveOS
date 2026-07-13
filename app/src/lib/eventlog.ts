/**
 * EvolveOS L0 event log — the single write path to the append-only `events`
 * table (issue #6, P0-5). Nothing else may INSERT into `events`
 * (ops/check-single-writer.mjs enforces this in CI).
 *
 * Design (small and auditable on purpose):
 *   - The record shape is exactly schemas/event.schema.json.
 *   - hash = sha256(canonicalize(record without `hash`)). `previous_hash` is
 *     part of that canonical object, so the hash depends on BOTH the current
 *     event (every field) and the previous hash. Tampering with any field
 *     breaks the chain.
 *   - Deterministic: no Date.now()/random here. The caller supplies `id` and
 *     `timestamp`; the same inputs always produce the same hash.
 *   - Append-only in the DB (triggers), serialized here by a transaction-scoped
 *     advisory lock so concurrent appends can't fork the chain.
 */
import { createHash } from "node:crypto";
import type { Client, PoolClient } from "pg";

/** A DB client that can run parameterized queries (pg Client or PoolClient). */
type Queryable = Client | PoolClient;

/** Fields the caller provides; `id` and `timestamp` are caller-owned (determinism). */
export interface AppendInput {
  id: string;
  timestamp: string;
  actor_type: "human" | "agent" | "kernel" | "watchdog" | "system";
  actor_id: string;
  event_type: string;
  object_type?: string | null;
  object_id?: string | null;
  payload?: Record<string, unknown> | null;
  trace_id?: string | null;
}

/** The canonical event record — mirrors schemas/event.schema.json. */
export interface EventRecord {
  id: string;
  timestamp: string;
  actor_type: AppendInput["actor_type"];
  actor_id: string;
  event_type: string;
  object_type: string | null;
  object_id: string | null;
  payload: Record<string, unknown> | null;
  previous_hash: string | null;
  hash: string;
  trace_id: string | null;
}

/** A stored row: the record plus its insertion-order sequence. */
export interface StoredEvent extends EventRecord {
  seq: number;
}

// Arbitrary constant so all appenders take the same advisory lock (serializes writes).
const APPEND_LOCK_KEY = 4207001;

/**
 * Deterministic JSON: object keys sorted recursively, arrays preserved, no
 * insignificant whitespace. `undefined` object members are dropped. This is the
 * exact byte string that gets hashed, so it must be stable across processes.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = sortValue(v);
  }
  return out;
}

/** Compute the hash of a record from its content (the stored `hash` is ignored). */
export function computeHash(record: Omit<EventRecord, "hash">): string {
  const canonical = canonicalize({
    id: record.id,
    timestamp: record.timestamp,
    actor_type: record.actor_type,
    actor_id: record.actor_id,
    event_type: record.event_type,
    object_type: record.object_type ?? null,
    object_id: record.object_id ?? null,
    payload: record.payload ?? null,
    previous_hash: record.previous_hash ?? null,
    trace_id: record.trace_id ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Append one event as the new chain head, inside an ALREADY-OPEN transaction
 * (no BEGIN/COMMIT here). This is the composable primitive: a caller that must
 * change a projection AND record its event atomically opens one transaction,
 * mutates its table, calls this, and commits — so the event and the mutation
 * commit or roll back together. On the caller's ROLLBACK the inserted event row
 * is undone too (no orphan event), and the advisory lock (transaction-scoped)
 * is released. This and `appendEvent` are the ONLY functions that write `events`.
 */
export async function appendEventTx(client: Queryable, input: AppendInput): Promise<StoredEvent> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [APPEND_LOCK_KEY]);
  const head = await client.query<{ hash: string }>(
    "SELECT hash FROM events ORDER BY seq DESC LIMIT 1",
  );
  const previous_hash = head.rows.length ? head.rows[0].hash : null;

  const base: Omit<EventRecord, "hash"> = {
    id: input.id,
    timestamp: input.timestamp,
    actor_type: input.actor_type,
    actor_id: input.actor_id,
    event_type: input.event_type,
    object_type: input.object_type ?? null,
    object_id: input.object_id ?? null,
    payload: input.payload ?? null,
    previous_hash,
    trace_id: input.trace_id ?? null,
  };
  const hash = computeHash(base);

  const inserted = await client.query<{ seq: string }>(
    `INSERT INTO events
       (id, timestamp, actor_type, actor_id, event_type,
        object_type, object_id, payload, previous_hash, hash, trace_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING seq`,
    [
      base.id, base.timestamp, base.actor_type, base.actor_id, base.event_type,
      base.object_type, base.object_id,
      base.payload === null ? null : JSON.stringify(base.payload),
      base.previous_hash, hash, base.trace_id,
    ],
  );
  return { ...base, hash, seq: Number(inserted.rows[0].seq) };
}

/**
 * Append one event as the new chain head, in its own transaction. Convenience
 * wrapper over `appendEventTx` for standalone appends (no projection to keep in
 * sync). The advisory lock keeps the previous_hash it reads still the head when
 * it inserts.
 */
export async function appendEvent(client: Queryable, input: AppendInput): Promise<StoredEvent> {
  await client.query("BEGIN");
  try {
    const result = await appendEventTx(client, input);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

export interface VerifyResult {
  ok: boolean;
  length: number;
  /** 0-based index of the first bad row, when ok is false. */
  brokenAt?: number;
  reason?: "previous_hash_mismatch" | "hash_mismatch" | "order_gap";
}

/**
 * Verify a chain given as an ordered array of records (a "dump"). Pure and
 * deterministic — no DB. Detects: a wrong previous_hash link, and any row whose
 * stored hash does not match a re-computation of its content (i.e. tampering).
 */
export function verifyChainRecords(events: EventRecord[]): VerifyResult {
  let prev: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if ((e.previous_hash ?? null) !== prev) {
      return { ok: false, length: events.length, brokenAt: i, reason: "previous_hash_mismatch" };
    }
    if (computeHash(e) !== e.hash) {
      return { ok: false, length: events.length, brokenAt: i, reason: "hash_mismatch" };
    }
    prev = e.hash;
  }
  return { ok: true, length: events.length };
}

/** Read the whole chain in order and verify it. Returns the same VerifyResult. */
export async function verifyChainInDb(client: Queryable): Promise<VerifyResult> {
  const { rows } = await client.query<StoredEvent>(
    `SELECT seq, id, timestamp, actor_type, actor_id, event_type,
            object_type, object_id, payload, previous_hash, hash, trace_id
       FROM events ORDER BY seq ASC`,
  );
  // Guard against a gap/reorder in seq that a pure record check can't see.
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i].seq) <= Number(rows[i - 1].seq)) {
      return { ok: false, length: rows.length, brokenAt: i, reason: "order_gap" };
    }
  }
  return verifyChainRecords(rows.map(toRecord));
}

function toRecord(row: StoredEvent): EventRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    event_type: row.event_type,
    object_type: row.object_type ?? null,
    object_id: row.object_id ?? null,
    payload: (row.payload ?? null) as Record<string, unknown> | null,
    previous_hash: row.previous_hash ?? null,
    hash: row.hash,
    trace_id: row.trace_id ?? null,
  };
}
