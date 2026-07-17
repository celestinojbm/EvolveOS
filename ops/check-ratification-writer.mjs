/**
 * CI guard (issue #11): the founding ratification + `real_money` evaluation has
 * a single owner, and the human threshold/role tables cannot drift from the
 * machine-readable manifest.
 *
 * PART 1 — single writer / no productive bypass. Across production source
 * (app/src) and ops tooling, no file OTHER than the owners may:
 *   1. emit the `ratification.signature_recorded` event;
 *   2. define its own `real_money` / signature / digest primitive;
 *   3. hardcode `real_money = true` (the flag is purely derived);
 *   4. import the injectable ratification CORE (only flags.ts may — so no other
 *      production file can evaluate the flag from arbitrary bytes / an alternate
 *      loader);
 *   5. read the pack document directly (only flags.ts owns the canonical loader).
 *   Owners: app/src/lib/flags.ts (the wrapper) and app/src/lib/ratification-core.ts
 *   (the pure primitives). Migrations and tests are not scanned.
 *
 * PART 2 — manifest is the source of truth. The §B threshold table and §C role
 * table in docs/RATIFICATION_PACK.md are re-rendered from the embedded manifest
 * (via the compiled core) and compared to the delimited blocks in the document.
 * If someone edits only the manifest or only a table, this fails. (Requires a
 * prior `pnpm build`; CI builds before this step.)
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const WRAPPER = "app/src/lib/flags.ts";
const CORE = "app/src/lib/ratification-core.ts";
const OWNERS = new Set([WRAPPER, CORE]);
// The audit-conventions registry (issue #13) DECLARES the event type name as
// documentation/validation data — it is not a writer (it calls no appendEventTx,
// touches no DB) — so it may name the event type. The single-writer emission
// path stays owned by the modules above (proven by ops/check-audit-conventions).
const AUDIT_REGISTRY = "app/src/lib/audit-conventions.ts";

const RATIFICATION_EVENT_RE = /ratification\.signature_recorded/;
const FLAG_DEF_RE =
  /(function\s+(isRealMoneyEnabled|recordRatificationSignature|digestPackBytes|parseRatificationPackBytes|computeRatificationReadiness)\b|(isRealMoneyEnabled|recordRatificationSignature|digestPackBytes|parseRatificationPackBytes|computeRatificationReadiness)\s*=\s*(async\s*)?\()/;
const HARDCODE_RE = /real[_-]?money\s*[:=]\s*true\b/i;
const CORE_IMPORT_RE = /from\s+["'][^"']*ratification-core(\.js)?["']|import\s*\(\s*["'][^"']*ratification-core/;
const PACK_PATH_RE = /RATIFICATION_PACK\.md/;

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
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (!OWNERS.has(rel) && rel !== AUDIT_REGISTRY && RATIFICATION_EVENT_RE.test(line)) {
      offenders.push(`${at}: ratification signature event referenced outside the owners: ${line.trim()}`);
    }
    if (!OWNERS.has(rel) && FLAG_DEF_RE.test(line)) {
      offenders.push(`${at}: real_money / ratification primitive re-defined outside the owners: ${line.trim()}`);
    }
    if (!OWNERS.has(rel) && HARDCODE_RE.test(line)) {
      offenders.push(`${at}: real_money hardcoded true (the flag is derived, never forced): ${line.trim()}`);
    }
    // Only flags.ts may import the injectable core or reference the pack path.
    if (rel !== WRAPPER && rel !== CORE && CORE_IMPORT_RE.test(line)) {
      offenders.push(`${at}: injectable ratification core imported outside flags.ts: ${line.trim()}`);
    }
    if (!OWNERS.has(rel) && PACK_PATH_RE.test(line)) {
      offenders.push(`${at}: pack document referenced outside the ratification module (no alternate loader): ${line.trim()}`);
    }
  });
}

for await (const p of walk(join(repoRoot, "ops"))) {
  if (!p.endsWith(".mjs")) continue;
  const rel = relative(repoRoot, p).replace(/\\/g, "/");
  if (rel === "ops/check-ratification-writer.mjs") continue;
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    if (RATIFICATION_EVENT_RE.test(line) || HARDCODE_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: ratification/real_money write in ops tooling: ${line.trim()}`);
    }
  });
}

if (offenders.length) {
  console.error("FAIL  ratification / real_money single-writer bypass detected:");
  for (const o of offenders) console.error(`        ${o}`);
  console.error("\ncheck-ratification-writer: route ratification + real_money through app/src/lib/flags.ts (core in ratification-core.ts).");
  process.exit(1);
}

// PART 2 — the human tables must match the manifest (via the compiled core).
const distCore = join(repoRoot, "app", "dist", "lib", "ratification-core.js");
if (!existsSync(distCore)) {
  console.error("FAIL  cannot verify manifest↔tables: app/dist/lib/ratification-core.js missing — run `pnpm build` first.");
  process.exit(1);
}
const core = await import(pathToFileURL(distCore).href);
const packBytes = await readFile(join(repoRoot, "docs", "RATIFICATION_PACK.md"), "utf8");
const { snapshot, errors } = core.parseRatificationPackBytes(packBytes);
if (!snapshot) {
  console.error("FAIL  docs/RATIFICATION_PACK.md is not a valid pack:");
  for (const e of errors) console.error(`        ${e.path}: ${e.message}`);
  process.exit(1);
}
const problems = core.verifyRenderedTables(snapshot);
if (problems.length) {
  console.error("FAIL  the rendered tables diverge from the manifest:");
  for (const p of problems) console.error(`        ${p}`);
  console.error("\ncheck-ratification-writer: re-render §B/§C from the manifest so the tables and JSON agree.");
  process.exit(1);
}

console.log("ok    ratification single owner (flags.ts + core); no bypass; manifest↔tables consistent");
