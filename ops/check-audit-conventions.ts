/**
 * CI guard (issue #13, P0-12): the audit-conventions registry, the REAL
 * productive event writers, and docs/AUDIT_CONVENTIONS.md stay in lock-step.
 *
 * This is the drift + ownership guard for the event taxonomy. It proves, using
 * the TypeScript compiler API to analyse the AST of app/src (not fragile
 * regexes):
 *   1. every event type EMITTED by a productive module is registered;
 *   2. every registered event type has at least one real productive writer;
 *   3. each registered type is emitted by EXACTLY its `ownerModule` — no second
 *      module may emit it;
 *   4. no duplicate registered types;
 *   5. a literal that is NOT in an emission position does not count as a writer;
 *   6. a dynamic / non-resolvable `event_type` in a productive emission FAILS the
 *      check (ownership cannot be proven);
 *   7. docs/AUDIT_CONVENTIONS.md contains EXACTLY the registry's summary table
 *      AND the full machine-readable contracts section (types, enums, patterns,
 *      nullability, variants, invariants) — so a payload/actor/object/invariant
 *      change that keeps the same field names is still caught.
 *
 * An "emission" is a call to `appendEvent` / `appendEventTx`, or to a LOCAL
 * FUNNEL helper that forwards a caller-provided event type into one of those
 * sinks (auth's `logAuthEventTx`, venture's `logVentureEventTx`, dr's
 * `fileInternal`). The event type is resolved to a string literal, a
 * `*_EVENT_TYPE` module/imported constant, or an `as const` literal; a value the
 * analyser cannot resolve is reported as unresolved (fail). Test fixtures
 * (app/test/**) are never scanned. This is ADDITIONAL to — and never weakens —
 * the events single-writer guard (ops/check-single-writer.mjs).
 *
 * Run: `pnpm check:audit` (tsx, no build step).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  EVENT_CONVENTIONS,
  renderConventionsTable,
  renderConventionsContracts,
  CONVENTIONS_TABLE_START,
  CONVENTIONS_TABLE_END,
  CONVENTIONS_CONTRACTS_START,
  CONVENTIONS_CONTRACTS_END,
} from "../app/src/lib/audit-conventions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const SRC_DIR = join(REPO_ROOT, "app", "src");
const REGISTRY_FILE = "app/src/lib/audit-conventions.ts";
const DOC_FILE = join(REPO_ROOT, "docs", "AUDIT_CONVENTIONS.md");

// The TypeScript compiler API lives in app/node_modules — resolve it from there
// (this ops package has no dependency of its own), same createRequire pattern the
// app modules use for ajv. Untyped (`any`) so this file needs no `typescript`
// type resolution when it is itself type-checked from the app test project.
const requireFromApp = createRequire(join(REPO_ROOT, "app", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts: any = requireFromApp("typescript");

const SINKS = new Set(["appendEvent", "appendEventTx"]);

export interface EmitterAnalysis {
  /** event type -> set of repo-relative productive files that emit it. */
  emitters: Map<string, Set<string>>;
  /** productive emissions whose event type could not be statically resolved. */
  unresolved: Array<{ file: string; line: number; detail: string }>;
}

function unwrap(node: any): any {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node)) ||
      ts.isNonNullExpression(node))
  ) {
    node = node.expression;
  }
  return node;
}

function isFunctionLike(n: any): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n)
  );
}

/**
 * The nearest ENCLOSING function-like ancestor that declares a parameter named
 * `name` — walking ALL scopes, so a closure variable forwarded from an outer
 * function (e.g. dr.ts's `captured`, closed over inside an `inDrTx(async …)`
 * callback) is still recognized as a forwarded parameter. Null if none.
 */
function findDeclaringFunction(name: string, node: any): any | null {
  let n = node?.parent;
  while (n) {
    if (isFunctionLike(n)) {
      for (const p of n.parameters) {
        if (ts.isIdentifier(p.name) && p.name.text === name) return n;
      }
    }
    n = n.parent;
  }
  return null;
}

/** The nearest enclosing function-like ancestor of `node` (or the source file). */
function enclosingFunction(node: any): any {
  let n = node?.parent;
  while (n) {
    if (isFunctionLike(n)) return n;
    n = n.parent;
  }
  return node?.getSourceFile?.() ?? null;
}

/** The function-like node's name (declaration name, or `const NAME = () => …`). */
function functionName(fn: any): string | null {
  if (!fn) return null;
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if (fn.parent && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) {
    return fn.parent.name.text;
  }
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) return fn.name.text;
  return null;
}

/** Find the `key` property value expression in an object literal (or null). */
function objectProp(objLit: any, key: string): any | null {
  for (const p of objLit.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key) {
      return p.initializer;
    }
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) {
      return p.name; // identifier with the same name
    }
  }
  return null;
}

/** Resolve a call argument to an object literal: inline, or a local const binding. */
function resolveObjectLiteralArg(arg: any): any | null {
  const a = unwrap(arg);
  if (ts.isObjectLiteralExpression(a)) return a;
  if (ts.isIdentifier(a)) {
    // Search the enclosing function for `const <name> = { ... }`.
    const fn = enclosingFunction(a);
    let found: any = null;
    const visit = (n: any): void => {
      if (found) return;
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === a.text &&
        n.initializer &&
        ts.isObjectLiteralExpression(unwrap(n.initializer))
      ) {
        found = unwrap(n.initializer);
        return;
      }
      ts.forEachChild(n, visit);
    };
    if (fn) ts.forEachChild(fn, visit);
    return found;
  }
  return null;
}

type Classified =
  | { kind: "concrete"; value: string }
  | { kind: "forward" }
  | { kind: "unresolved" };

function classifyTypeValue(valueExpr: any, globalConsts: Map<string, string>): Classified {
  const v = unwrap(valueExpr);
  if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) {
    return { kind: "concrete", value: v.text };
  }
  if (ts.isIdentifier(v)) {
    if (findDeclaringFunction(v.text, v)) return { kind: "forward" };
    const c = globalConsts.get(v.text);
    if (c !== undefined) return { kind: "concrete", value: c };
    return { kind: "unresolved" };
  }
  if (ts.isPropertyAccessExpression(v)) {
    let root = v;
    while (ts.isPropertyAccessExpression(root.expression)) root = root.expression;
    if (ts.isIdentifier(root.expression) && findDeclaringFunction(root.expression.text, v)) {
      return { kind: "forward" };
    }
    return { kind: "unresolved" };
  }
  return { kind: "unresolved" };
}

/**
 * Analyse the given TypeScript sources (repo-relative file + text) for productive
 * event emissions and return the type→files map plus any unresolvable emissions.
 * Pure over its input, so tests can drive it with in-memory fixtures.
 */
export function analyzeEmitters(sources: Array<{ file: string; text: string }>): EmitterAnalysis {
  const emitters = new Map<string, Set<string>>();
  const unresolved: EmitterAnalysis["unresolved"] = [];

  const parsed = sources.map((s) => ({
    ...s,
    sf: ts.createSourceFile(s.file, s.text, ts.ScriptTarget.Latest, /*setParentNodes*/ true),
  }));

  // Pass A: module-level string constants (NAME = "literal"), across all files.
  const globalConsts = new Map<string, string>();
  for (const { sf } of parsed) {
    const visit = (n: any): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const init = unwrap(n.initializer);
        if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
          globalConsts.set(n.name.text, init.text);
        }
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
  }

  // Pass B: detect funnel helpers — functions that call a SINK forwarding a
  // parameter's property as the event type. Records the forwarded property key.
  const funnels = new Map<string, string>(); // funnelName -> forwarded key
  for (const { sf } of parsed) {
    const visit = (n: any): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && SINKS.has(n.expression.text)) {
        const objArg = n.arguments.map(resolveObjectLiteralArg).find(Boolean);
        if (objArg) {
          const et = objectProp(objArg, "event_type");
          if (et) {
            const v = unwrap(et);
            // event_type: <param>.<prop>  → the function that DECLARES <param>
            // is a funnel forwarding property <prop> (works across closures).
            if (ts.isPropertyAccessExpression(v)) {
              let root = v;
              while (ts.isPropertyAccessExpression(root.expression)) root = root.expression;
              if (ts.isIdentifier(root.expression)) {
                const declFn = findDeclaringFunction(root.expression.text, v);
                const name = functionName(declFn);
                if (name && ts.isIdentifier(v.name)) funnels.set(name, v.name.text);
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
  }

  // Pass C: emission call sites — calls to a SINK or a FUNNEL with a resolvable
  // event type. A param-forwarded value is a funnel definition (skip); anything
  // else non-resolvable is an ownership-breaking unresolved emission.
  for (const { file, text, sf } of parsed) {
    const visit = (n: any): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const callee = n.expression.text;
        const isSink = SINKS.has(callee);
        const isFunnel = funnels.has(callee);
        if (isSink || isFunnel) {
          const key = isSink ? "event_type" : funnels.get(callee)!;
          const objArg = n.arguments.map(resolveObjectLiteralArg).find(Boolean);
          if (objArg) {
            const valExpr = objectProp(objArg, key);
            if (valExpr) {
              const c = classifyTypeValue(valExpr, globalConsts);
              if (c.kind === "concrete") {
                if (!emitters.has(c.value)) emitters.set(c.value, new Set());
                emitters.get(c.value)!.add(file);
              } else if (c.kind === "unresolved") {
                const line = text.slice(0, valExpr.getStart(sf)).split("\n").length;
                unresolved.push({
                  file,
                  line,
                  detail: `${callee}(...) emits a non-resolvable ${key} — ownership cannot be verified`,
                });
              }
              // kind === "forward": a funnel-defining call, not a concrete emission.
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
  }

  return { emitters, unresolved };
}

// --- doc extraction ----------------------------------------------------------

function extractBetween(md: string, start: string, end: string): string | null {
  const s = md.indexOf(start);
  const e = md.indexOf(end);
  if (s === -1 || e === -1 || e < s) return null;
  return md.slice(s + start.length, e).trim();
}

export function extractDocTable(md: string): string | null {
  return extractBetween(md, CONVENTIONS_TABLE_START, CONVENTIONS_TABLE_END);
}

export function extractDocContracts(md: string): string | null {
  return extractBetween(md, CONVENTIONS_CONTRACTS_START, CONVENTIONS_CONTRACTS_END);
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

// --- drift computation (owner-aware) -----------------------------------------

export interface DriftInputs {
  /** registered conventions: their type and declared owner module. */
  registry: ReadonlyArray<{ eventType: string; ownerModule: string }>;
  emitters: Map<string, Set<string>>;
  unresolved: EmitterAnalysis["unresolved"];
  docTable: string | null;
  expectedTable: string;
  docContracts: string | null;
  expectedContracts: string;
}

/** Compare registry, real emitters (with owners), and docs; return every problem. */
export function computeDrift(args: DriftInputs): string[] {
  const problems: string[] = [];
  const registryTypes = args.registry.map((r) => r.eventType);
  const ownerOf = new Map(args.registry.map((r) => [r.eventType, r.ownerModule]));
  const registered = new Set(registryTypes);

  // (4) no duplicate registry types.
  if (registered.size !== registryTypes.length) {
    problems.push("the registry contains duplicate event types");
  }

  // (6) a non-resolvable productive emission breaks ownership verification.
  for (const u of args.unresolved) {
    problems.push(`${u.file}:${u.line}: ${u.detail}`);
  }

  // (1) every emitted type is registered.
  for (const t of args.emitters.keys()) {
    if (!registered.has(t)) {
      problems.push(`event type '${t}' is emitted by a productive module but is NOT in the registry`);
    }
  }

  // (2)+(3) every registered type is emitted by EXACTLY its owner module.
  for (const t of registryTypes) {
    const files = args.emitters.get(t);
    const owner = ownerOf.get(t)!;
    if (!files || files.size === 0) {
      problems.push(`event type '${t}' is registered but has NO productive writer in app/src`);
      continue;
    }
    for (const f of files) {
      if (f !== owner) {
        problems.push(
          `event type '${t}' is emitted by '${f}' but its registered owner is '${owner}' — only the owner module may emit it`,
        );
      }
    }
  }

  // (7a) the summary table must match the registry exactly.
  if (args.docTable === null) {
    problems.push(
      `docs/AUDIT_CONVENTIONS.md is missing the ${CONVENTIONS_TABLE_START} / ${CONVENTIONS_TABLE_END} table markers`,
    );
  } else if (args.docTable !== args.expectedTable.trim()) {
    const docTypes = new Set(docTableEventTypes(args.docTable));
    for (const t of registryTypes) {
      if (!docTypes.has(t)) problems.push(`docs table is missing the '${t}' row`);
    }
    for (const t of docTypes) {
      if (!registered.has(t)) problems.push(`docs table has a '${t}' row that is not in the registry`);
    }
    problems.push("docs/AUDIT_CONVENTIONS.md summary table does not match renderConventionsTable() — regenerate it");
  }

  // (7b) the full contracts section must match the registry exactly (types,
  // enums, patterns, nullability, variants, invariants — not just names).
  if (args.docContracts === null) {
    problems.push(
      `docs/AUDIT_CONVENTIONS.md is missing the ${CONVENTIONS_CONTRACTS_START} / ${CONVENTIONS_CONTRACTS_END} contracts markers`,
    );
  } else if (args.docContracts !== args.expectedContracts.trim()) {
    problems.push(
      "docs/AUDIT_CONVENTIONS.md full contracts section does not match renderConventionsContracts() — a type/enum/pattern/nullability/required/variant/invariant change must be mirrored in the doc (regenerate it)",
    );
  }

  return problems;
}

// --- real run ----------------------------------------------------------------

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

/** Read the productive app/src sources (excluding the declarative registry). */
export async function readProductiveSources(): Promise<Array<{ file: string; text: string }>> {
  const out: Array<{ file: string; text: string }> = [];
  for await (const p of walk(SRC_DIR)) {
    if (!p.endsWith(".ts") && !p.endsWith(".tsx")) continue;
    const rel = relative(REPO_ROOT, p).replace(/\\/g, "/");
    if (rel === REGISTRY_FILE) continue; // the registry declares types; it is not a writer
    out.push({ file: rel, text: await readFile(p, "utf8") });
  }
  return out;
}

export async function runCheck(): Promise<string[]> {
  const sources = await readProductiveSources();
  const { emitters, unresolved } = analyzeEmitters(sources);
  let md = "";
  try {
    md = await readFile(DOC_FILE, "utf8");
  } catch {
    return [`docs/AUDIT_CONVENTIONS.md could not be read at ${relative(REPO_ROOT, DOC_FILE)}`];
  }
  return computeDrift({
    registry: EVENT_CONVENTIONS.map((c) => ({ eventType: c.eventType, ownerModule: c.ownerModule })),
    emitters,
    unresolved,
    docTable: extractDocTable(md),
    expectedTable: renderConventionsTable(),
    docContracts: extractDocContracts(md),
    expectedContracts: renderConventionsContracts(),
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
          "\ncheck:audit — keep app/src/lib/audit-conventions.ts, the productive writers (one owner per type), and docs/AUDIT_CONVENTIONS.md (summary table + full contracts) in sync.\n",
        );
        process.exit(1);
      }
      process.stdout.write(
        `ok    ${EVENT_CONVENTIONS.length} event types: registry, single-owner productive writers, and docs (table + contracts) agree\n`,
      );
      process.exit(0);
    },
    (err) => {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    },
  );
}
