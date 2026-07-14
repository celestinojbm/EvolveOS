/**
 * CI guard (issue #9): the gate system cannot be bypassed in production code.
 *
 * Enforces:
 *   1. Only app/src/lib/gates.ts may reference the internal gated venture
 *      primitives (mintVentureAtG01Tx / advanceVentureForGateTx) — besides
 *      their definition in venture.ts. Tests may use them where indispensable;
 *      production source may not.
 *   2. Only app/src/lib/gates.ts may write the gate_passes projection.
 *
 * (Event writes are separately guarded by check-single-writer.mjs.)
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const GATES_MODULE = "app/src/lib/gates.ts";
const VENTURE_MODULE = "app/src/lib/venture.ts"; // definitions live here

const PRIMITIVE_RE = /\b(mintVentureAtG01Tx|advanceVentureForGateTx)\b/;
const GATE_PASS_WRITE_RE = /insert\s+into\s+gate_passes\b|update\s+gate_passes\b|delete\s+from\s+gate_passes\b/i;

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
  if (rel === GATES_MODULE) continue;
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    if (rel !== VENTURE_MODULE && PRIMITIVE_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: gated venture primitive used outside gates.ts: ${line.trim()}`);
    }
    if (GATE_PASS_WRITE_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: direct gate_passes write outside gates.ts: ${line.trim()}`);
    }
  });
}

// ops tooling must not write gate_passes either.
for await (const p of walk(join(repoRoot, "ops"))) {
  if (!p.endsWith(".mjs")) continue;
  const rel = relative(repoRoot, p).replace(/\\/g, "/");
  if (rel === "ops/check-gate-bypass.mjs") continue;
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    if (GATE_PASS_WRITE_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: direct gate_passes write in ops tooling: ${line.trim()}`);
    }
  });
}

if (offenders.length) {
  console.error("FAIL  gate-system bypass detected:");
  for (const o of offenders) console.error(`        ${o}`);
  console.error("\ncheck-gate-bypass: route gate passes through app/src/lib/gates.ts.");
  process.exit(1);
}
console.log("ok    gate passes have a single writer (gates.ts); no production bypass of the gated primitives");
