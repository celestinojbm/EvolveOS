/**
 * CI guard (issue #10): the Decision Record store has a single writer.
 *
 * Enforces, across production source (app/src) and ops tooling:
 *   1. Only app/src/lib/dr.ts may INSERT / UPDATE / DELETE / TRUNCATE the
 *      `decision_records` table.
 *   2. Only app/src/lib/dr.ts may write the `decision_record_counters` table.
 *   3. Only app/src/lib/dr.ts may DEFINE the canonical DR digest / snapshot
 *      primitives (`digestDecisionRecordContent`, `snapshotDecisionRecordContent`)
 *      — no file may re-implement DR canonicalization; everyone else imports.
 *
 * Migrations (ops/migrations/*.sql) create the tables; tests (app/test/**) may
 * exercise the store directly. Neither is scanned here.
 * (Event writes and gate_passes writes are guarded separately.)
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const DR_MODULE = "app/src/lib/dr.ts"; // the single writer / canonicalization owner

const DR_WRITE_RE =
  /insert\s+into\s+decision_records\b|update\s+decision_records\b|delete\s+from\s+decision_records\b|truncate\s+(table\s+)?decision_records\b/i;
const COUNTER_WRITE_RE =
  /insert\s+into\s+decision_record_counters\b|update\s+decision_record_counters\b|delete\s+from\s+decision_record_counters\b/i;
// A DEFINITION (not an import) of the canonical primitives.
const DIGEST_DEF_RE =
  /(function\s+(digestDecisionRecordContent|snapshotDecisionRecordContent)\b|(digestDecisionRecordContent|snapshotDecisionRecordContent)\s*=\s*(async\s*)?\()/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "generated") continue;
      yield* walk(p);
    } else {
      yield p;
    }
  }
}

const offenders = [];

for await (const p of walk(join(repoRoot, "app", "src"))) {
  if (!p.endsWith(".ts")) continue;
  const rel = relative(repoRoot, p).replace(/\\/g, "/");
  if (rel === DR_MODULE) continue;
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    if (DR_WRITE_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: direct decision_records write outside dr.ts: ${line.trim()}`);
    }
    if (COUNTER_WRITE_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: direct decision_record_counters write outside dr.ts: ${line.trim()}`);
    }
    if (DIGEST_DEF_RE.test(line)) {
      offenders.push(
        `${rel}:${i + 1}: DR canonicalization primitive re-defined outside dr.ts: ${line.trim()}`,
      );
    }
  });
}

for await (const p of walk(join(repoRoot, "ops"))) {
  if (!p.endsWith(".mjs")) continue;
  const rel = relative(repoRoot, p).replace(/\\/g, "/");
  if (rel === "ops/check-dr-writer.mjs") continue;
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    if (DR_WRITE_RE.test(line) || COUNTER_WRITE_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: direct decision-record store write in ops tooling: ${line.trim()}`);
    }
  });
}

if (offenders.length) {
  console.error("FAIL  decision-record store bypass detected:");
  for (const o of offenders) console.error(`        ${o}`);
  console.error("\ncheck-dr-writer: route DR filing/canonicalization through app/src/lib/dr.ts.");
  process.exit(1);
}
console.log("ok    decision records have a single writer (dr.ts); one canonicalization/digest");
