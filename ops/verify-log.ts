/**
 * EvolveOS event-log audit CLI (issue #13, P0-12) — `verify` and `extract`.
 *
 * The operator tool over the L0 append-only `events` table (Part VI §1): it
 * re-verifies the whole hash chain AND every event-type convention, and produces
 * a human-readable audit extract for a date range or a venture. It is READ-ONLY
 * and FAIL-CLOSED: there are no bypass flags (no --skip-hash, no
 * --skip-conventions, no --trust-filtered-range, no --repair), and an unknown
 * event type is a violation, not a warning.
 *
 * Hashing authority: this CLI does NOT re-implement SHA-256 or canonicalization.
 * It imports `computeHash` / `canonicalize` from app/src/lib/eventlog.ts (the
 * sole authority) and the conventions from app/src/lib/audit-conventions.ts. It
 * runs, ergonomically, straight from the repo root via tsx (no build step):
 *
 *   pnpm audit:log -- verify
 *   pnpm audit:log -- extract --from 2026-01-01T00:00:00Z --to 2026-02-01T00:00:00Z
 *   pnpm audit:log -- extract --venture V-2026-1
 *   pnpm verify:events                # alias of `verify`
 *
 * Snapshot: `verify` reads inside a `REPEATABLE READ READ ONLY` transaction, so
 * it observes a single coherent snapshot — an uncommitted concurrent append is
 * invisible and the chain is never read half-before / half-after a commit. It
 * takes NO advisory lock, so it never blocks writers.
 *
 * Exit codes:  0 = valid and completed;  1 = an integrity or convention
 * violation was found (verify), or the extract could not be trusted because the
 * whole chain is invalid;  2 = invalid arguments / connection / operational
 * error. Normal output → stdout; diagnostics and errors → stderr.
 */
import pg from "pg";
import { computeHash, canonicalize, type EventRecord } from "../app/src/lib/eventlog.js";
import {
  validateEventConvention,
  ventureIdsReferenced,
  isValidEventTimestamp,
  type AuditEventRecord,
  type ConventionError,
} from "../app/src/lib/audit-conventions.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";

/** A stored event row as read from the DB; `seq` is kept as a string (BigInt). */
interface RawRow {
  seq: string;
  id: string;
  timestamp: string;
  actor_type: string;
  actor_id: string;
  event_type: string;
  object_type: string | null;
  object_id: string | null;
  payload: Record<string, unknown> | null;
  previous_hash: string | null;
  hash: string;
  trace_id: string | null;
}

/** One integrity or convention finding, anchored to a specific event. */
interface Finding {
  seq: string;
  eventId: string;
  eventType: string;
  category: string;
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

interface VerifyReport {
  ok: boolean;
  total: number;
  firstSeq: string | null;
  lastSeq: string | null;
  headHash: string | null;
  findings: Finding[];
  rows: RawRow[];
}

/** The record eventlog.ts hashes — exactly the schema fields, no `seq`. */
function toEventRecord(row: RawRow): EventRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    actor_type: row.actor_type as EventRecord["actor_type"],
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

function toAuditRecord(row: RawRow): AuditEventRecord {
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

/**
 * Read the whole chain inside a REPEATABLE READ READ ONLY snapshot and verify it:
 * strict seq order (decimal BigInt, gaps allowed), each `previous_hash` link,
 * each recomputed `hash`, and every base-record + event-type convention. Collects
 * ALL findings (never stops at the first) so the summary is complete. Performs no
 * writes; ends the transaction cleanly.
 */
async function readAndVerify(client: pg.Client): Promise<VerifyReport> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let rows: RawRow[];
  try {
    const res = await client.query<RawRow>(
      // ORDER BY events.seq (the BIGINT column) — NOT the `seq::text` output
      // alias, which would sort lexicographically ("10" < "2").
      `SELECT seq::text AS seq, id, timestamp, actor_type, actor_id, event_type,
              object_type, object_id, payload, previous_hash, hash, trace_id
         FROM events ORDER BY events.seq ASC`,
    );
    rows = res.rows;
  } finally {
    // A read-only snapshot transaction — COMMIT writes nothing.
    await client.query("COMMIT");
  }

  const findings: Finding[] = [];
  const add = (row: RawRow, c: Omit<Finding, "seq" | "eventId" | "eventType">): void => {
    findings.push({ seq: row.seq, eventId: row.id, eventType: row.event_type, ...c });
  };

  let prevHash: string | null = null;
  let prevSeq: bigint | null = null;
  for (const row of rows) {
    // Strict, decimal, monotonically-increasing seq (BigInt — never a JS Number;
    // gaps from aborted transactions are allowed, a reorder/repeat is not).
    const seq = BigInt(row.seq);
    if (prevSeq !== null && seq <= prevSeq) {
      add(row, {
        category: "order",
        path: "seq",
        message: "events.seq is not strictly increasing (reordered or duplicated row)",
        expected: `> ${prevSeq.toString()}`,
        actual: row.seq,
      });
    }
    prevSeq = seq;

    // previous_hash must link to the actual prior row's stored hash.
    if ((row.previous_hash ?? null) !== prevHash) {
      add(row, {
        category: "previous_hash_mismatch",
        path: "previous_hash",
        message: "previous_hash does not equal the prior event's hash (broken link)",
        expected: prevHash ?? "null",
        actual: row.previous_hash ?? "null",
      });
    }

    // Recompute the hash from the content (the stored hash is ignored in compute).
    const recomputed = computeHash(toEventRecord(row));
    if (recomputed !== row.hash) {
      add(row, {
        category: "hash_mismatch",
        path: "hash",
        message: "stored hash does not match a recomputation of the event content (tampering)",
        expected: recomputed,
        actual: row.hash,
      });
    }

    // Base-record + event-type contract (a valid hash can still be non-conforming).
    for (const e of validateEventConvention(toAuditRecord(row))) {
      add(row, {
        category: e.category,
        path: e.path,
        message: e.message,
        expected: e.expected,
        actual: e.actual,
      });
    }

    // The chain continues from the ACTUAL stored hash, so every row is checked
    // against its real predecessor even after a break.
    prevHash = row.hash;
  }

  return {
    ok: findings.length === 0,
    total: rows.length,
    firstSeq: rows.length ? rows[0].seq : null,
    lastSeq: rows.length ? rows[rows.length - 1].seq : null,
    headHash: rows.length ? rows[rows.length - 1].hash : null,
    findings,
    rows,
  };
}

// --- safe rendering of untrusted event data ----------------------------------

/**
 * Escape control characters so untrusted event text (actor ids, payload strings)
 * can never inject terminal escape sequences, forge log lines, or hide content.
 * C0 controls, DEL, and the C1 range become visible `\xHH` / `\uHHHH`. No ANSI
 * colour is ever emitted by this tool.
 */
function escapeUntrusted(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      out += code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function renderFinding(f: Finding): string {
  const parts = [
    `seq=${f.seq}`,
    `event=${escapeUntrusted(f.eventId)}`,
    `type=${escapeUntrusted(f.eventType)}`,
    `category=${f.category}`,
    `path=${f.path}`,
    `message=${escapeUntrusted(f.message)}`,
  ];
  if (f.expected !== undefined) parts.push(`expected=${escapeUntrusted(f.expected)}`);
  if (f.actual !== undefined) parts.push(`actual=${escapeUntrusted(f.actual)}`);
  return "  - " + parts.join("  ");
}

function renderEvent(row: RawRow): string {
  const payload = row.payload === null ? "null" : canonicalize(row.payload);
  return [
    `seq ${row.seq}`,
    `  timestamp     ${escapeUntrusted(row.timestamp)}`,
    `  event_type    ${escapeUntrusted(row.event_type)}`,
    `  actor         ${escapeUntrusted(row.actor_type)} / ${escapeUntrusted(row.actor_id)}`,
    `  object        ${escapeUntrusted(row.object_type ?? "null")} / ${escapeUntrusted(row.object_id ?? "null")}`,
    `  trace_id      ${escapeUntrusted(row.trace_id ?? "null")}`,
    `  payload       ${escapeUntrusted(payload)}`,
    `  previous_hash ${escapeUntrusted(row.previous_hash ?? "null")}`,
    `  hash          ${escapeUntrusted(row.hash)}`,
  ].join("\n");
}

// --- argument parsing ---------------------------------------------------------

class ArgError extends Error {}

interface ExtractFilters {
  from: { raw: string; ms: number } | null;
  to: { raw: string; ms: number } | null;
  venture: string | null;
  jsonl: boolean;
}

/** Parse `--flag value` pairs strictly; unknown flags / bad dates are ArgErrors. */
function parseExtractArgs(argv: string[]): ExtractFilters {
  const filters: ExtractFilters = { from: null, to: null, venture: null, jsonl: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--jsonl") {
      filters.jsonl = true;
      continue;
    }
    if (arg === "--from" || arg === "--to" || arg === "--venture") {
      const value = argv[++i];
      if (value === undefined) throw new ArgError(`${arg} requires a value`);
      if (arg === "--venture") {
        if (!value.trim()) throw new ArgError("--venture requires a non-empty venture id");
        filters.venture = value;
      } else {
        if (!isValidEventTimestamp(value)) {
          throw new ArgError(`${arg} must be a strict RFC3339 instant (e.g. 2026-01-01T00:00:00Z), got '${value}'`);
        }
        const ms = new Date(value).getTime();
        if (arg === "--from") filters.from = { raw: value, ms };
        else filters.to = { raw: value, ms };
      }
      continue;
    }
    throw new ArgError(`unknown argument '${arg}'`);
  }
  if (filters.from && filters.to && filters.from.ms >= filters.to.ms) {
    throw new ArgError(`--from (${filters.from.raw}) must be strictly before --to (${filters.to.raw})`);
  }
  return filters;
}

function describeFilters(f: ExtractFilters): string {
  const parts: string[] = [];
  parts.push(f.from ? `from >= ${f.from.raw} (inclusive)` : "from = (unbounded)");
  parts.push(f.to ? `to < ${f.to.raw} (exclusive)` : "to = (unbounded)");
  parts.push(f.venture ? `venture = ${escapeUntrusted(f.venture)}` : "venture = (any)");
  return parts.join(", ");
}

/** Does the event fall inside the requested filters? (verification is separate.) */
function matchesFilters(row: RawRow, f: ExtractFilters): boolean {
  if (f.from || f.to) {
    // A verified chain guarantees a valid timestamp; parse defensively anyway.
    const ms = new Date(row.timestamp).getTime();
    if (!Number.isFinite(ms)) return false;
    if (f.from && ms < f.from.ms) return false;
    if (f.to && ms >= f.to.ms) return false;
  }
  if (f.venture) {
    if (!ventureIdsReferenced(toAuditRecord(row)).has(f.venture)) return false;
  }
  return true;
}

// --- subcommands --------------------------------------------------------------

async function cmdVerify(client: pg.Client): Promise<number> {
  const report = await readAndVerify(client);
  if (report.ok) {
    process.stdout.write(
      `ok    event chain intact and conventions satisfied (${report.total} event(s))\n`,
    );
    if (report.total > 0) {
      process.stdout.write(`      first seq ${report.firstSeq}, last seq ${report.lastSeq}\n`);
      process.stdout.write(`      head hash ${report.headHash}\n`);
    } else {
      process.stdout.write("      empty log — zero events is a valid chain\n");
    }
    return 0;
  }
  process.stderr.write(
    `FAIL  ${report.findings.length} problem(s) across ${report.total} event(s):\n`,
  );
  for (const f of report.findings) process.stderr.write(renderFinding(f) + "\n");
  return 1;
}

async function cmdExtract(client: pg.Client, argv: string[]): Promise<number> {
  const filters = parseExtractArgs(argv);
  // Verify the WHOLE chain and ALL conventions FIRST. An extract over a globally
  // invalid chain is never trustworthy — even if the tampering lies outside the
  // requested range/venture — so this fails closed and prints NO events.
  const report = await readAndVerify(client);
  if (!report.ok) {
    process.stderr.write(
      `FAIL  refusing to extract: the event chain is invalid (${report.findings.length} problem(s) across ${report.total} event(s)).\n`,
    );
    process.stderr.write("      an extract is only trustworthy over a fully valid chain.\n");
    for (const f of report.findings) process.stderr.write(renderFinding(f) + "\n");
    return 1;
  }

  const selected = report.rows.filter((r) => matchesFilters(r, filters));

  if (filters.jsonl) {
    // Optional machine format; the human format below is always available too.
    for (const r of selected) {
      process.stdout.write(
        JSON.stringify({
          seq: r.seq,
          id: r.id,
          timestamp: r.timestamp,
          event_type: r.event_type,
          actor_type: r.actor_type,
          actor_id: r.actor_id,
          object_type: r.object_type,
          object_id: r.object_id,
          trace_id: r.trace_id,
          payload: r.payload,
          previous_hash: r.previous_hash,
          hash: r.hash,
        }) + "\n",
      );
    }
    return 0;
  }

  const out: string[] = [];
  out.push("EvolveOS audit extract");
  out.push(`verification   OK — chain intact and conventions satisfied`);
  out.push(`chain total    ${report.total} event(s)`);
  out.push(`chain range    first seq ${report.firstSeq ?? "-"}, last seq ${report.lastSeq ?? "-"}`);
  out.push(`head hash      ${report.headHash ?? "-"}`);
  out.push(`filters        ${describeFilters(filters)}`);
  out.push(`selected       ${selected.length} event(s)`);
  out.push("");
  if (selected.length === 0) {
    out.push("0 events matched the requested filters.");
  } else {
    for (const r of selected) {
      out.push(renderEvent(r));
      out.push("");
    }
  }
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

// --- entry point --------------------------------------------------------------

function usage(): string {
  return [
    "usage: verify-log <command> [options]",
    "",
    "commands:",
    "  verify                          re-verify the whole hash chain and all conventions",
    "  extract [--from T] [--to T] [--venture ID] [--jsonl]",
    "                                  verify the whole chain, then print a human audit",
    "                                  extract of the matching events (from inclusive, to",
    "                                  exclusive, venture exact; combined as AND)",
    "",
    "exit codes: 0 = valid/complete, 1 = integrity/convention violation, 2 = usage/operational error",
  ].join("\n");
}

async function main(): Promise<number> {
  // `pnpm audit:log -- verify` forwards a literal `--` separator (pnpm 10.x);
  // drop a single leading `--` so the documented `-- <command>` form works.
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "--") rawArgs.shift();
  const [command, ...rest] = rawArgs;
  if (!command || command === "--help" || command === "-h") {
    process.stderr.write(usage() + "\n");
    return command ? 0 : 2;
  }
  if (command !== "verify" && command !== "extract") {
    process.stderr.write(`error: unknown command '${command}'\n\n${usage()}\n`);
    return 2;
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
  } catch (err) {
    // Never leak the full DATABASE_URL (it may embed credentials).
    process.stderr.write(`error: could not connect to the database: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  try {
    if (command === "verify") return await cmdVerify(client);
    return await cmdExtract(client, rest);
  } catch (err) {
    if (err instanceof ArgError) {
      process.stderr.write(`error: ${err.message}\n\n${usage()}\n`);
      return 2;
    }
    // A real DB/operational error — surface it honestly, do not mask as success.
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  },
);
