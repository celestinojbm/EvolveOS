/**
 * CI guard (issue #13, P0-12): the audit-conventions registry, the productive
 * event writers, and docs/AUDIT_CONVENTIONS.md stay in lock-step.
 *
 * This is the drift guard for the event taxonomy. It proves, statically:
 *   1. every event type EMITTED by a productive module (app/src, excluding the
 *      registry itself and excluding tests) is registered in
 *      app/src/lib/audit-conventions.ts;
 *   2. every registered event type has at least one real productive writer
 *      (so the registry cannot list a type nothing emits);
 *   3. the registry has no duplicate event types;
 *   4. docs/AUDIT_CONVENTIONS.md contains EXACTLY the registry's table (the
 *      block between the AUDIT_CONVENTIONS_TABLE markers equals
 *      renderConventionsTable()), so the human doc can never silently diverge —
 *      adding a doc row for a non-existent type, dropping a row, or changing a
 *      payload contract without updating the doc all fail here.
 *
 * Writers are discovered from SOURCE, not from tests or from events emitted at
 * runtime: it scans `event_type:` / `eventType:` literals and the
 * `*_EVENT_TYPE = "..."` constants used in an emission position. Test fixtures
 * (app/test/**) are never scanned, so a test that emits `unit.test` does not
 * count as a productive writer. Adding a new productive literal without
 * registering it — or registering a type with no writer — fails CI.
 *
 * Run: `pnpm check:audit` (tsx, no build step).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVENT_TYPES,
  renderConventionsTable,
  CONVENTIONS_TABLE_START,
  CONVENTIONS_TABLE_END,
} from "../app/src/lib/audit-conventions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const SRC_DIR = join(REPO_ROOT, "app", "src");
const REGISTRY_FILE = "app/src/lib/audit-conventions.ts";
const DOC_FILE = join(REPO_ROOT, "docs", "AUDIT_CONVENTIONS.md");

// A literal in an emission position: `event_type: "x"` / `eventType: "x"`.
const LITERAL_RE = /(?:event_type|eventType)\s*:\s*["'`]([^"'`]+)["'`]/g;
// A `*_EVENT_TYPE` constant definition: `const STOP_EVENT_TYPE = "system.stop_engaged"`.
const CONST_DEF_RE = /(\w*EVENT_TYPE\w*)\s*=\s*["'`]([^"'`]+)["'`]/g;
// A `*_EVENT_TYPE` constant used in an emission position: `event_type: STOP_EVENT_TYPE`.
const CONST_USE_RE = /(?:event_type|eventType)\s*:\s*(\w+)\b/g;

async function* walk(dir: string): AsyncGenerator<string> {
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

/**
 * Scan a source tree for the event types PRODUCTIVELY emitted: direct
 * `event_type:` / `eventType:` string literals, plus `*_EVENT_TYPE` constants
 * that are used in an emission position (their string value is resolved). The
 * registry file itself and any file whose repo-relative path is in `exclude` are
 * skipped, so the declarative registry is never mistaken for a writer.
 */
export async function scanEmittedEventTypes(
  srcDir: string,
  exclude: ReadonlySet<string> = new Set([REGISTRY_FILE]),
): Promise<Set<string>> {
  const literals = new Set<string>();
  const constDefs = new Map<string, string>(); // NAME -> value
  const constUses = new Set<string>(); // NAMEs used in an emission position

  for await (const p of walk(srcDir)) {
    if (!p.endsWith(".ts") && !p.endsWith(".tsx")) continue;
    const rel = relative(REPO_ROOT, p).replace(/\\/g, "/");
    if (exclude.has(rel)) continue;
    const text = await readFile(p, "utf8");
    for (const m of text.matchAll(LITERAL_RE)) literals.add(m[1]);
    for (const m of text.matchAll(CONST_DEF_RE)) constDefs.set(m[1], m[2]);
    for (const m of text.matchAll(CONST_USE_RE)) constUses.add(m[1]);
  }

  const emitted = new Set<string>(literals);
  for (const name of constUses) {
    const value = constDefs.get(name);
    if (value) emitted.add(value);
  }
  return emitted;
}

/** Extract the fenced table block between the two markers, trimmed (null if absent). */
export function extractDocTable(md: string): string | null {
  const s = md.indexOf(CONVENTIONS_TABLE_START);
  const e = md.indexOf(CONVENTIONS_TABLE_END);
  if (s === -1 || e === -1 || e < s) return null;
  return md.slice(s + CONVENTIONS_TABLE_START.length, e).trim();
}

/** The event-type strings named in the doc table's first column (`\`type\``). */
export function docTableEventTypes(table: string): string[] {
  const out: string[] = [];
  for (const line of table.split("\n")) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Compare the three sources and return every drift problem (empty = in sync).
 * Pure — takes the sets/strings so tests can drive it with fixtures.
 */
export function computeDrift(args: {
  registryTypes: readonly string[];
  emittedTypes: ReadonlySet<string>;
  docTable: string | null;
  expectedTable: string;
}): string[] {
  const problems: string[] = [];
  const registry = new Set(args.registryTypes);

  // 3. no duplicate registry types.
  if (registry.size !== args.registryTypes.length) {
    problems.push("the registry contains duplicate event types");
  }

  // 1. every emitted type is registered.
  for (const t of args.emittedTypes) {
    if (!registry.has(t)) {
      problems.push(`event type '${t}' is emitted by a productive module but is NOT in the registry`);
    }
  }
  // 2. every registered type has a writer.
  for (const t of args.registryTypes) {
    if (!args.emittedTypes.has(t)) {
      problems.push(`event type '${t}' is registered but has NO productive writer in app/src`);
    }
  }

  // 4. the doc table matches the registry exactly.
  if (args.docTable === null) {
    problems.push(
      `docs/AUDIT_CONVENTIONS.md is missing the ${CONVENTIONS_TABLE_START} / ${CONVENTIONS_TABLE_END} table markers`,
    );
  } else if (args.docTable !== args.expectedTable.trim()) {
    // Give a precise hint on which types differ, then flag the full-table drift.
    const docTypes = new Set(docTableEventTypes(args.docTable));
    for (const t of args.registryTypes) {
      if (!docTypes.has(t)) problems.push(`docs table is missing the '${t}' row`);
    }
    for (const t of docTypes) {
      if (!registry.has(t)) problems.push(`docs table has a '${t}' row that is not in the registry`);
    }
    problems.push(
      "docs/AUDIT_CONVENTIONS.md table does not match renderConventionsTable() — regenerate it (a payload/actor/object change must be mirrored in the doc)",
    );
  }

  return problems;
}

export async function runCheck(): Promise<string[]> {
  const emitted = await scanEmittedEventTypes(SRC_DIR);
  let md = "";
  try {
    md = await readFile(DOC_FILE, "utf8");
  } catch {
    return [`docs/AUDIT_CONVENTIONS.md could not be read at ${relative(REPO_ROOT, DOC_FILE)}`];
  }
  return computeDrift({
    registryTypes: EVENT_TYPES,
    emittedTypes: emitted,
    docTable: extractDocTable(md),
    expectedTable: renderConventionsTable(),
  });
}

// Run as a CLI (skip when imported by a test).
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  runCheck().then(
    (problems) => {
      if (problems.length) {
        process.stderr.write("FAIL  audit-conventions drift detected:\n");
        for (const p of problems) process.stderr.write(`        ${p}\n`);
        process.stderr.write(
          "\ncheck:audit — keep app/src/lib/audit-conventions.ts, the productive writers, and docs/AUDIT_CONVENTIONS.md in sync.\n",
        );
        process.exit(1);
      }
      process.stdout.write(
        `ok    ${EVENT_TYPES.length} event types: registry, productive writers, and docs agree\n`,
      );
      process.exit(0);
    },
    (err) => {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    },
  );
}
