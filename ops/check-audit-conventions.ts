/**
 * CI guard (issue #13, P0-12): the audit-conventions registry, the REAL
 * productive event writers, and docs/AUDIT_CONVENTIONS.md stay in lock-step.
 *
 * Drift + ownership guard for the event taxonomy. It uses a real TypeScript
 * `Program` + `TypeChecker` (not textual name matching) so it resolves writers by
 * SYMBOL IDENTITY. That means it cannot be fooled by a renamed import
 * (`import { appendEventTx as emit }`), a namespace import
 * (`import * as eventlog … eventlog.appendEventTx(…)`), an aliased constant, or
 * two files that happen to share a constant/helper name with different values.
 *
 * It proves:
 *   1. every event type EMITTED by a productive module is registered;
 *   2. every registered event type has at least one real productive writer;
 *   3. each registered type is emitted by EXACTLY its `ownerModule` — no second
 *      module may emit it;
 *   4. no duplicate registered types;
 *   5. a literal that never reaches a sink does not count as a writer;
 *   6. a dynamic / non-resolvable `event_type` at a REAL sink FAILS the check;
 *   7. docs/AUDIT_CONVENTIONS.md contains EXACTLY the registry's summary table
 *      AND the full machine-readable contracts section — so a type/enum/pattern/
 *      nullability/variant/invariant change with the same field names is caught.
 *
 * A "sink" is the exported `appendEvent` / `appendEventTx` of
 * `app/src/lib/eventlog.ts`, resolved by symbol (through any alias). An emission
 * is a call to a sink, or to a LOCAL FUNNEL helper (a function whose body calls a
 * sink forwarding a parameter's property as the event type — auth's
 * `logAuthEventTx`, venture's `logVentureEventTx`, dr's `fileInternal`), where the
 * event type resolves (by symbol/scope) to a string literal or a string constant.
 * Test fixtures (app/test/**) are never scanned. This is ADDITIONAL to — and never
 * weakens — the events single-writer guard (ops/check-single-writer.mjs).
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
// (this ops package declares no dependency of its own), same createRequire pattern
// the app modules use for ajv. Untyped (`any`) so this file needs no `typescript`
// type resolution when it is itself type-checked from the app test project.
const requireFromApp = createRequire(join(REPO_ROOT, "app", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts: any = requireFromApp("typescript");

const SINK_NAMES = new Set(["appendEvent", "appendEventTx"]);
const EVENTLOG_SUFFIX = "/lib/eventlog.ts";
const VROOT = "/repo/";

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

/**
 * Build an in-memory TypeScript Program over the given sources (mirrored under a
 * virtual /repo root, ESM via app/package.json) so imports resolve and symbols
 * bind across modules. A minimal `eventlog.ts` sink stub is injected when the
 * sources do not already include the real one (for fixtures).
 */
function buildProgram(sources: Array<{ file: string; text: string }>): { program: any; checker: any } {
  const files = new Map<string, string>();
  const rootNames: string[] = [];
  const hasEventlog = sources.some((s) => s.file.replace(/\\/g, "/").endsWith(EVENTLOG_SUFFIX.slice(1)));
  const all = [...sources];
  if (!hasEventlog) {
    all.push({
      file: "app/src/lib/eventlog.ts",
      text:
        "export async function appendEvent(client: any, input: any): Promise<any> { return input; }\n" +
        "export async function appendEventTx(client: any, input: any): Promise<any> { return input; }\n",
    });
  }
  for (const s of all) {
    const vpath = VROOT + s.file.replace(/\\/g, "/");
    files.set(vpath, s.text);
    rootNames.push(vpath);
  }
  // ESM scope for NodeNext module resolution.
  files.set(VROOT + "app/package.json", JSON.stringify({ type: "module" }));

  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    noLib: true,
    noEmit: true,
    allowJs: false,
    skipLibCheck: true,
    types: [],
  };
  const host = {
    getSourceFile: (fn: string, lv: any) =>
      files.has(fn) ? ts.createSourceFile(fn, files.get(fn)!, lv, true) : undefined,
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (fn: string) => files.has(fn),
    readFile: (fn: string) => files.get(fn),
    getCanonicalFileName: (fn: string) => fn,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram({ rootNames, options, host });
  return { program, checker: program.getTypeChecker() };
}

/** Map a virtual source-file name back to its repo-relative path. */
function realPath(fileName: string): string {
  return fileName.startsWith(VROOT) ? fileName.slice(VROOT.length) : fileName;
}

/**
 * Analyse the given TypeScript sources for productive event emissions, resolving
 * every callee/constant/parameter by SYMBOL identity, and return the type→files
 * map plus any unresolvable emissions. Pure over its input, so tests can drive it
 * with in-memory fixtures.
 */
export function analyzeEmitters(sources: Array<{ file: string; text: string }>): EmitterAnalysis {
  const emitters = new Map<string, Set<string>>();
  const unresolved: EmitterAnalysis["unresolved"] = [];
  const { program, checker } = buildProgram(sources);

  const inputPaths = new Set(sources.map((s) => VROOT + s.file.replace(/\\/g, "/")));
  const sourceFiles = program.getSourceFiles().filter((sf: any) => inputPaths.has(sf.fileName));

  const aliased = (sym: any): any => {
    if (!sym) return sym;
    return sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  };

  /** Is `callee` a reference (through any alias) to eventlog's appendEvent(Tx)? */
  const isSinkCallee = (callee: any): boolean => {
    const sym = aliased(checker.getSymbolAtLocation(callee));
    if (!sym || !SINK_NAMES.has(sym.getName())) return false;
    const decls = sym.getDeclarations?.() ?? [];
    return decls.some((d: any) => d.getSourceFile().fileName.endsWith(EVENTLOG_SUFFIX));
  };

  /** Resolve an identifier (through any alias/scope) to a string-constant value. */
  const resolveStringConst = (id: any): string | null => {
    const sym = aliased(checker.getSymbolAtLocation(id));
    const decl = sym?.valueDeclaration ?? sym?.getDeclarations?.()?.[0];
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
      const init = unwrap(decl.initializer);
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    }
    return null;
  };

  /** The function that DECLARES the parameter `id` resolves to (or null). */
  const paramDeclaringFunction = (id: any): any | null => {
    const sym = checker.getSymbolAtLocation(id);
    const decl = sym?.valueDeclaration;
    if (decl && ts.isParameter(decl)) return decl.parent;
    return null;
  };

  const functionSymbol = (fn: any): any | undefined => {
    if (!fn) return undefined;
    if (ts.isFunctionDeclaration(fn) && fn.name) return checker.getSymbolAtLocation(fn.name);
    if (ts.isMethodDeclaration(fn) && fn.name) return checker.getSymbolAtLocation(fn.name);
    if (fn.parent && ts.isVariableDeclaration(fn.parent) && fn.parent.name) {
      return checker.getSymbolAtLocation(fn.parent.name);
    }
    return undefined;
  };

  const objectProp = (objLit: any, key: string): any | null => {
    for (const p of objLit.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key) return p.initializer;
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return p.name;
    }
    return null;
  };

  /** Resolve a call argument to an object literal: inline, or a const binding. */
  const resolveObjectLiteralArg = (arg: any): any | null => {
    const a = unwrap(arg);
    if (ts.isObjectLiteralExpression(a)) return a;
    if (ts.isIdentifier(a)) {
      const sym = aliased(checker.getSymbolAtLocation(a));
      const decl = sym?.valueDeclaration;
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        const init = unwrap(decl.initializer);
        if (ts.isObjectLiteralExpression(init)) return init;
      }
    }
    return null;
  };

  type Classified = { kind: "concrete"; value: string } | { kind: "forward" } | { kind: "unresolved" };
  const classify = (valueExpr: any): Classified => {
    const v = unwrap(valueExpr);
    if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) return { kind: "concrete", value: v.text };
    if (ts.isIdentifier(v)) {
      if (paramDeclaringFunction(v)) return { kind: "forward" };
      const c = resolveStringConst(v);
      return c !== null ? { kind: "concrete", value: c } : { kind: "unresolved" };
    }
    if (ts.isPropertyAccessExpression(v)) {
      let root = v;
      while (ts.isPropertyAccessExpression(root.expression)) root = root.expression;
      if (ts.isIdentifier(root.expression) && paramDeclaringFunction(root.expression)) return { kind: "forward" };
      return { kind: "unresolved" };
    }
    return { kind: "unresolved" };
  };

  // Pass A: detect funnel helpers by SYMBOL — a function whose body calls a sink
  // forwarding one of its parameters' properties as the event type.
  const funnels = new Map<any, string>(); // functionSymbol -> forwarded key
  for (const sf of sourceFiles) {
    const visit = (n: any): void => {
      if (ts.isCallExpression(n) && isSinkCallee(n.expression)) {
        const objArg = n.arguments.map(resolveObjectLiteralArg).find(Boolean) ?? n.arguments.map(unwrap).find((a: any) => ts.isObjectLiteralExpression(a));
        if (objArg) {
          const et = objectProp(objArg, "event_type");
          if (et) {
            const v = unwrap(et);
            if (ts.isPropertyAccessExpression(v)) {
              let root = v;
              while (ts.isPropertyAccessExpression(root.expression)) root = root.expression;
              if (ts.isIdentifier(root.expression)) {
                const fn = paramDeclaringFunction(root.expression);
                const sym = functionSymbol(fn);
                if (sym && ts.isIdentifier(v.name)) funnels.set(sym, v.name.text);
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
  }

  // Pass B: emission call sites — calls to a sink or a funnel (by symbol) with a
  // resolvable event type. Param-forwarded values are funnel definitions (skip);
  // anything else non-resolvable at a real sink/funnel is an ownership-breaking
  // unresolved emission.
  for (const sf of sourceFiles) {
    const file = realPath(sf.fileName);
    const visit = (n: any): void => {
      if (ts.isCallExpression(n)) {
        const sink = isSinkCallee(n.expression);
        const calleeSym = aliased(checker.getSymbolAtLocation(n.expression));
        const funnelKey = calleeSym && funnels.get(calleeSym);
        if (sink || funnelKey) {
          const key = sink ? "event_type" : funnelKey!;
          const objArg = n.arguments.map(resolveObjectLiteralArg).find(Boolean) ?? n.arguments.map(unwrap).find((a: any) => ts.isObjectLiteralExpression(a));
          if (objArg) {
            const valExpr = objectProp(objArg, key);
            if (valExpr) {
              const c = classify(valExpr);
              if (c.kind === "concrete") {
                if (!emitters.has(c.value)) emitters.set(c.value, new Set());
                emitters.get(c.value)!.add(file);
              } else if (c.kind === "unresolved") {
                const line = sf.getLineAndCharacterOfPosition(valExpr.getStart(sf)).line + 1;
                unresolved.push({ file, line, detail: `a real sink/funnel emits a non-resolvable ${key} — ownership cannot be verified` });
              }
              // "forward": a funnel-defining call, not a concrete emission.
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

  if (registered.size !== registryTypes.length) {
    problems.push("the registry contains duplicate event types");
  }
  for (const u of args.unresolved) {
    problems.push(`${u.file}:${u.line}: ${u.detail}`);
  }
  for (const t of args.emitters.keys()) {
    if (!registered.has(t)) {
      problems.push(`event type '${t}' is emitted by a productive module but is NOT in the registry`);
    }
  }
  for (const t of registryTypes) {
    const files = args.emitters.get(t);
    const owner = ownerOf.get(t)!;
    if (!files || files.size === 0) {
      problems.push(`event type '${t}' is registered but has NO productive writer in app/src`);
      continue;
    }
    for (const f of files) {
      if (f !== owner) {
        problems.push(`event type '${t}' is emitted by '${f}' but its registered owner is '${owner}' — only the owner module may emit it`);
      }
    }
  }

  if (args.docTable === null) {
    problems.push(`docs/AUDIT_CONVENTIONS.md is missing the ${CONVENTIONS_TABLE_START} / ${CONVENTIONS_TABLE_END} table markers`);
  } else if (args.docTable !== args.expectedTable.trim()) {
    const docTypes = new Set(docTableEventTypes(args.docTable));
    for (const t of registryTypes) if (!docTypes.has(t)) problems.push(`docs table is missing the '${t}' row`);
    for (const t of docTypes) if (!registered.has(t)) problems.push(`docs table has a '${t}' row that is not in the registry`);
    problems.push("docs/AUDIT_CONVENTIONS.md summary table does not match renderConventionsTable() — regenerate it");
  }

  if (args.docContracts === null) {
    problems.push(`docs/AUDIT_CONVENTIONS.md is missing the ${CONVENTIONS_CONTRACTS_START} / ${CONVENTIONS_CONTRACTS_END} contracts markers`);
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
          "\ncheck:audit — keep app/src/lib/audit-conventions.ts, the productive writers (one owner per type, resolved by symbol), and docs/AUDIT_CONVENTIONS.md (summary table + full contracts) in sync.\n",
        );
        process.exit(1);
      }
      process.stdout.write(
        `ok    ${EVENT_CONVENTIONS.length} event types: registry, single-owner productive writers (symbol-resolved), and docs (table + contracts) agree\n`,
      );
      process.exit(0);
    },
    (err) => {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    },
  );
}
