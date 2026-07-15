/**
 * CI guard (issue #11): the founding ratification + `real_money` evaluation has
 * a single owner — app/src/lib/flags.ts.
 *
 * Enforces, across production source (app/src) and ops tooling, that no file
 * OTHER than flags.ts may:
 *   1. emit the `ratification.signature_recorded` event (the signature event);
 *   2. define its own `real_money` evaluation (`isRealMoneyEnabled`) or
 *      `recordRatificationSignature`;
 *   3. hardcode `real_money = true` (or `realMoney: true`, etc.) — the flag is
 *      purely derived and must never be forced on;
 *   4. maintain a second pack digest primitive (`digestPackBytes`) — everyone
 *      else imports flags.ts; there is one canonicalization of the pack bytes.
 *
 * Migrations (ops/migrations/*.sql) create no ratification state (signatures are
 * events; the flag is derived) and tests (app/test/**) may exercise the module
 * directly with an injected fixture pack — neither is scanned here. Docs are not
 * scanned (the pack document itself lives in docs/ and is prose).
 * (Event writes and gate/DR writes are guarded separately.)
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const FLAGS_MODULE = "app/src/lib/flags.ts"; // the single owner

// The signature event type as a string literal (only flags.ts may emit it).
const RATIFICATION_EVENT_RE = /ratification\.signature_recorded/;
// A DEFINITION (not an import) of the flag/signature/digest primitives.
const FLAG_DEF_RE =
  /(function\s+(isRealMoneyEnabled|recordRatificationSignature|digestPackBytes)\b|(isRealMoneyEnabled|recordRatificationSignature|digestPackBytes)\s*=\s*(async\s*)?\()/;
// Forcing the flag on: `real_money = true`, `realMoney: true`, `real_money=true`.
const HARDCODE_RE = /real[_-]?money\s*[:=]\s*true\b/i;

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
  if (rel === FLAGS_MODULE) continue;
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    if (RATIFICATION_EVENT_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: ratification signature event emitted outside flags.ts: ${line.trim()}`);
    }
    if (FLAG_DEF_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: real_money / ratification primitive re-defined outside flags.ts: ${line.trim()}`);
    }
    if (HARDCODE_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: real_money hardcoded true (the flag is derived, never forced): ${line.trim()}`);
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
  console.error("\ncheck-ratification-writer: route ratification + real_money through app/src/lib/flags.ts.");
  process.exit(1);
}
console.log("ok    ratification + real_money have a single owner (flags.ts); no bypass, no hardcoded flag");
