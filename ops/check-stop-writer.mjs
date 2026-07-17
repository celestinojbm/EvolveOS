/**
 * CI guard (issue #12): the G-00 stop mechanism has a single owner —
 * app/src/lib/stop.ts.
 *
 * Across production source (app/src) and ops tooling, no file OTHER than stop.ts
 * may:
 *   1. write the `system_stop_state` projection directly;
 *   2. emit the `system.stop_engaged` / `system.stop_released` events;
 *   3. define its own stop guard / mutation (`assertSystemRunning`,
 *      `assertAgentInvocationAllowed`, `runGuardedAgentInvocation`,
 *      `engageSystemStop`, `releaseSystemStop`) — no second permissive flag read
 *      and no second agent-invocation boundary;
 *   4. reference the CHECK-ONLY `assertAgentInvocationAllowed` at all — the only
 *      productive boundary for a real invocation is `runGuardedAgentInvocation`
 *      (which holds the lock across the callback). Forbidding the check-only
 *      point read outside stop.ts prevents the TOCTOU `assertAgentInvocationAllowed(); invoke()` pattern;
 *   5. read the stop state from an environment variable (there is no env
 *      override — the DB projection is the only source of truth).
 *
 * Scans app/src `.ts` and `.tsx` plus ops `.mjs`. Other files may IMPORT and CALL
 * `assertSystemRunning` (e.g. gates.ts's central guard) — that is the whole
 * point. This is a STATIC guard: it prevents a second writer / boundary and the
 * check-then-invoke shape, but it does not (and does not claim to) prove that a
 * given call site holds the lock across its callback. Migrations create the
 * table; tests exercise it directly; docs describe it. None are scanned here.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const OWNER = "app/src/lib/stop.ts";
// The audit-conventions registry (issue #13) DECLARES the stop event type names
// as documentation/validation data — it is not a writer (no system_stop_state
// write, no appendEventTx, no guard definition) — so it may name the events. All
// the other checks below (state write, guard def, env override) still apply to
// it; only the bare event-NAME reference is exempt.
const AUDIT_REGISTRY = "app/src/lib/audit-conventions.ts";

const STATE_WRITE_RE =
  /insert\s+into\s+system_stop_state\b|update\s+system_stop_state\b|delete\s+from\s+system_stop_state\b|truncate\s+(table\s+)?system_stop_state\b/i;
const STOP_EVENT_RE = /system\.stop_engaged|system\.stop_released/;
// A DEFINITION (not an import or call) of a stop guard / mutation primitive.
const GUARD_DEF_RE =
  /(function\s+(assertSystemRunning|assertAgentInvocationAllowed|runGuardedAgentInvocation|engageSystemStop|releaseSystemStop)\b|(assertSystemRunning|assertAgentInvocationAllowed|runGuardedAgentInvocation|engageSystemStop|releaseSystemStop)\s*=\s*(async\s*)?\()/;
// The check-only boundary must not be referenced outside stop.ts (no TOCTOU
// check-then-invoke): the productive boundary is runGuardedAgentInvocation.
const CHECK_ONLY_REF_RE = /\bassertAgentInvocationAllowed\b/;
// An environment-variable stop override anywhere in production code.
const ENV_OVERRIDE_RE = /process\.env\.\w*(STOP|KILL|HALT|RUNNING)\w*/i;

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
  if (!p.endsWith(".ts") && !p.endsWith(".tsx")) continue;
  const rel = relative(repoRoot, p).replace(/\\/g, "/");
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (rel !== OWNER && STATE_WRITE_RE.test(line)) {
      offenders.push(`${at}: direct system_stop_state write outside stop.ts: ${line.trim()}`);
    }
    if (rel !== OWNER && rel !== AUDIT_REGISTRY && STOP_EVENT_RE.test(line)) {
      offenders.push(`${at}: stop/restart event referenced outside stop.ts: ${line.trim()}`);
    }
    if (rel !== OWNER && GUARD_DEF_RE.test(line)) {
      offenders.push(`${at}: stop guard/mutation re-defined outside stop.ts: ${line.trim()}`);
    }
    if (rel !== OWNER && CHECK_ONLY_REF_RE.test(line)) {
      offenders.push(`${at}: check-only assertAgentInvocationAllowed used outside stop.ts (use runGuardedAgentInvocation): ${line.trim()}`);
    }
    if (ENV_OVERRIDE_RE.test(line)) {
      offenders.push(`${at}: environment-variable stop override (there is no env override): ${line.trim()}`);
    }
  });
}

for await (const p of walk(join(repoRoot, "ops"))) {
  if (!p.endsWith(".mjs")) continue;
  const rel = relative(repoRoot, p).replace(/\\/g, "/");
  if (rel === "ops/check-stop-writer.mjs") continue;
  const text = await readFile(p, "utf8");
  text.split("\n").forEach((line, i) => {
    if (STATE_WRITE_RE.test(line) || STOP_EVENT_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}: stop-state/stop-event write in ops tooling: ${line.trim()}`);
    }
  });
}

if (offenders.length) {
  console.error("FAIL  G-00 stop-mechanism single-writer bypass detected:");
  for (const o of offenders) console.error(`        ${o}`);
  console.error("\ncheck-stop-writer: route the stop state, its events, and its guards through app/src/lib/stop.ts.");
  process.exit(1);
}
console.log("ok    G-00 stop mechanism has a single owner (stop.ts); no bypass, no env override");
