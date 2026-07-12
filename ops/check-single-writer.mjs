/**
 * CI guard (issue #6 acceptance): prove every write to the `events` table goes
 * through app/src/lib/eventlog.ts. Fails if any other source file contains a
 * direct INSERT/UPDATE/DELETE against `events`.
 *
 * Scans application source (app/src/**\/*.ts, excluding the generated types and
 * the eventlog module itself) and the ops/*.mjs tooling. Test files are excluded
 * on purpose: the trigger tests deliberately attempt UPDATE/DELETE to prove the
 * database rejects them.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const ALLOWLIST = new Set([
  "app/src/lib/eventlog.ts", // the sole write path
]);
const SELF = new Set([
  "ops/check-single-writer.mjs",
  "ops/verify-chain.mjs", // read-only
]);

const WRITE_PATTERNS = [
  /insert\s+into\s+events\b/i,
  /update\s+events\b/i,
  /delete\s+from\s+events\b/i,
];

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

const targets = [];
for await (const p of walk(join(repoRoot, "app", "src"))) {
  if (p.endsWith(".ts")) targets.push(p);
}
for await (const p of walk(join(repoRoot, "ops"))) {
  if (p.endsWith(".mjs")) targets.push(p);
}

const offenders = [];
for (const p of targets) {
  const rel = relative(repoRoot, p);
  if (ALLOWLIST.has(rel) || SELF.has(rel)) continue;
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    if (WRITE_PATTERNS.some((re) => re.test(line))) {
      offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (offenders.length) {
  console.error("FAIL  direct writes to `events` outside app/src/lib/eventlog.ts:");
  for (const o of offenders) console.error(`        ${o}`);
  console.error("\ncheck-single-writer: route all event writes through appendEvent().");
  process.exit(1);
}
console.log("ok    every `events` write goes through app/src/lib/eventlog.ts");
