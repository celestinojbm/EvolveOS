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
 *
 * ONE canonical resolver (`analyzeCall`) classifies BOTH sink calls and funnel
 * calls, and it is ALSO what funnel discovery uses — there is no second,
 * weaker algorithm for locating `event_type`. Every call whose callee resolves
 * to a real sink (appendEvent/appendEventTx — renamed, namespace, or local-const
 * aliases) or a real funnel yields exactly one outcome:
 *
 *   concrete { eventType } | forward { reference } | unresolved { detail }
 *
 * A `forward` carries its procedence — the forwarded parameter's declaring
 * function symbol, its parameter INDEX (never assumed to be 1), and the property
 * PATH from that parameter to the event type — so a funnel discovered from a
 * spread/computed-key definition can still have its concrete callsites analysed.
 * Anything the analyzer cannot resolve statically (a builder/dynamic argument, a
 * dynamic spread, a missing/duplicated/computed-unprovable/dynamic key, a
 * `.bind`/`.call`/`.apply` around a sink, an unresolvable forward) becomes
 * `unresolved` — never a silent drop and never a partially-registered funnel.
 */
export function analyzeEmitters(sources: Array<{ file: string; text: string }>): EmitterAnalysis {
  const emitters = new Map<string, Set<string>>();
  const unresolved: EmitterAnalysis["unresolved"] = [];
  const { program, checker } = buildProgram(sources);

  const inputPaths = new Set(sources.map((s) => VROOT + s.file.replace(/\\/g, "/")));
  const sourceFiles = program.getSourceFiles().filter((sf: any) => inputPaths.has(sf.fileName));

  interface ForwardReference {
    functionSymbol: any;
    parameterIndex: number;
    propertyPath: string[];
  }
  type Emission =
    | { kind: "concrete"; eventType: string }
    | { kind: "forward"; reference: ForwardReference }
    | { kind: "unresolved"; detail: string };
  interface Selector {
    argumentIndex: number;
    propertyPath: string[];
  }
  const SINK_SELECTOR: Selector = { argumentIndex: 1, propertyPath: ["event_type"] };

  const aliased = (sym: any): any => {
    if (!sym) return sym;
    return sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  };

  /** Does `node` resolve to eventlog's appendEvent(Tx) (through any alias)? */
  const resolvesToSink = (node: any, seen: Set<any>): boolean => {
    const raw = checker.getSymbolAtLocation(node);
    if (!raw) return false;
    const sym = aliased(raw);
    if (!sym || seen.has(sym)) return false;
    seen.add(sym);
    if (SINK_NAMES.has(sym.getName())) {
      const decls = sym.getDeclarations?.() ?? [];
      if (decls.some((d: any) => d.getSourceFile().fileName.endsWith(EVENTLOG_SUFFIX))) return true;
    }
    const decl = sym.valueDeclaration;
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
      const init = unwrap(decl.initializer);
      if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) return resolvesToSink(init, seen);
    }
    return false;
  };
  const isSinkCallee = (node: any): boolean => resolvesToSink(node, new Set());

  const resolveStringConst = (id: any): string | null => {
    const sym = aliased(checker.getSymbolAtLocation(id));
    const decl = sym?.valueDeclaration ?? sym?.getDeclarations?.()?.[0];
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
      const init = unwrap(decl.initializer);
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    }
    return null;
  };

  const functionSymbol = (fn: any): any | undefined => {
    if (!fn) return undefined;
    if (ts.isFunctionDeclaration(fn) && fn.name) return checker.getSymbolAtLocation(fn.name);
    if (ts.isMethodDeclaration(fn) && fn.name) return checker.getSymbolAtLocation(fn.name);
    if (fn.parent && ts.isVariableDeclaration(fn.parent) && fn.parent.name) return checker.getSymbolAtLocation(fn.parent.name);
    return undefined;
  };

  /** Build a forward reference from a parameter identifier + a property suffix. */
  const makeForwardRef = (paramId: any, suffix: string[]): Emission => {
    const sym = checker.getSymbolAtLocation(paramId);
    const decl = sym?.valueDeclaration;
    if (!decl || !ts.isParameter(decl)) return { kind: "unresolved", detail: "forward root is not a parameter" };
    const fn = decl.parent;
    const parameterIndex = fn.parameters.indexOf(decl);
    const fnSym = functionSymbol(fn);
    if (!fnSym || parameterIndex < 0) return { kind: "unresolved", detail: "forwarded parameter's function is not resolvable" };
    return { kind: "forward", reference: { functionSymbol: fnSym, parameterIndex, propertyPath: suffix } };
  };

  const staticPropName = (prop: any): string | null => {
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const name = prop.name;
      if (ts.isIdentifier(name)) return name.text;
      if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
    }
    return null;
  };

  const resolveComputedKeyText = (expr: any): string | null => {
    const e = unwrap(expr);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isIdentifier(e)) return resolveStringConst(e);
    return null;
  };

  /** Classify the terminal value expression of the resolved event-type slot. */
  const classifyValue = (valueExpr: any): Emission => {
    const v = unwrap(valueExpr);
    if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) return { kind: "concrete", eventType: v.text };
    if (ts.isIdentifier(v)) {
      const sym = checker.getSymbolAtLocation(v);
      if (sym?.valueDeclaration && ts.isParameter(sym.valueDeclaration)) return makeForwardRef(v, []);
      const c = resolveStringConst(v);
      return c !== null ? { kind: "concrete", eventType: c } : { kind: "unresolved", detail: "event_type is a non-constant identifier" };
    }
    if (ts.isPropertyAccessExpression(v)) {
      const suffix: string[] = [];
      let cur: any = v;
      while (ts.isPropertyAccessExpression(cur)) {
        suffix.unshift(cur.name.text);
        cur = cur.expression;
      }
      if (ts.isIdentifier(cur)) {
        const sym = checker.getSymbolAtLocation(cur);
        if (sym?.valueDeclaration && ts.isParameter(sym.valueDeclaration)) return makeForwardRef(cur, suffix);
      }
      return { kind: "unresolved", detail: "event_type is a non-parameter property access" };
    }
    return { kind: "unresolved", detail: "event_type is a computed/dynamic expression" };
  };

  type ObjResult = { kind: "object"; node: any } | { kind: "forward"; param: any } | { kind: "unresolved"; detail: string };
  const resolveToObjectLiteral = (expr: any): ObjResult => {
    const a = unwrap(expr);
    if (ts.isObjectLiteralExpression(a)) return { kind: "object", node: a };
    if (ts.isIdentifier(a)) {
      const sym = aliased(checker.getSymbolAtLocation(a));
      const decl = sym?.valueDeclaration;
      if (decl && ts.isParameter(decl)) return { kind: "forward", param: a };
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        const init = unwrap(decl.initializer);
        if (ts.isObjectLiteralExpression(init)) return { kind: "object", node: init };
        return { kind: "unresolved", detail: "argument const is not a static object literal" };
      }
      return { kind: "unresolved", detail: "argument identifier does not resolve to a static object literal" };
    }
    if (ts.isCallExpression(a)) return { kind: "unresolved", detail: "argument is a builder/function call" };
    return { kind: "unresolved", detail: "argument is not a static object literal" };
  };

  type NodeResult = { kind: "node"; node: any } | { kind: "absent" } | { kind: "unresolved"; detail: string };
  /** The winning value node for `key` in an object literal (static spreads merged). */
  const resolveKeyNode = (objNode: any, key: string, depth: number): NodeResult => {
    if (depth > 16) return { kind: "unresolved", detail: "object/spread nesting too deep" };
    let winner: any | undefined;
    let directCount = 0;
    for (const prop of objNode.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const r = resolveToObjectLiteral(prop.expression);
        if (r.kind !== "object") return { kind: "unresolved", detail: "dynamic or non-static spread — key cannot be determined" };
        const sub = resolveKeyNode(r.node, key, depth + 1);
        if (sub.kind === "unresolved") return sub;
        if (sub.kind === "node") winner = sub.node; // spread contributes; own props override later
        continue;
      }
      if ((ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && prop.name && ts.isComputedPropertyName(prop.name)) {
        const proven = resolveComputedKeyText(prop.name.expression);
        if (proven === null) return { kind: "unresolved", detail: "computed property key cannot be statically proven" };
        if (proven !== key) continue;
        winner = ts.isShorthandPropertyAssignment(prop) ? prop.name : prop.initializer;
        directCount++;
        continue;
      }
      if (staticPropName(prop) === key) {
        winner = ts.isShorthandPropertyAssignment(prop) ? prop.name : prop.initializer;
        directCount++;
      }
    }
    if (directCount > 1) return { kind: "unresolved", detail: `multiple direct definitions of ${key}` };
    return winner === undefined ? { kind: "absent" } : { kind: "node", node: winner };
  };

  /** Descend a property path through nested object literals to the terminal node. */
  const resolvePath = (objNode: any, path: string[], depth: number): NodeResult => {
    if (path.length === 0) return { kind: "unresolved", detail: "empty property path" };
    const [head, ...rest] = path;
    const r = resolveKeyNode(objNode, head, depth);
    if (r.kind !== "node") return r;
    if (rest.length === 0) return r;
    const sub = resolveToObjectLiteral(r.node);
    if (sub.kind === "object") return resolvePath(sub.node, rest, depth + 1);
    if (sub.kind === "forward") return { kind: "unresolved", detail: "intermediate path segment is a forwarded parameter" };
    return sub;
  };

  /** THE canonical classifier — every sink/funnel call goes through here. */
  const analyzeCall = (call: any, selector: Selector): Emission => {
    const arg = call.arguments[selector.argumentIndex];
    if (arg === undefined) return { kind: "unresolved", detail: `no argument at index ${selector.argumentIndex}` };
    const obj = resolveToObjectLiteral(arg);
    if (obj.kind === "forward") return makeForwardRef(obj.param, selector.propertyPath);
    if (obj.kind === "unresolved") return obj;
    const r = resolvePath(obj.node, selector.propertyPath, 0);
    if (r.kind === "absent") return { kind: "unresolved", detail: `${selector.propertyPath.join(".")} is absent` };
    if (r.kind === "unresolved") return r;
    return classifyValue(r.node);
  };

  // Pass A: funnel discovery via the SAME canonical resolver. A sink call that
  // resolves to a forward registers its declaring function as a funnel, keyed by
  // symbol, with the parameter index + property path to re-resolve callsites.
  const funnels = new Map<any, Selector>();
  for (const sf of sourceFiles) {
    const visit = (n: any): void => {
      if (ts.isCallExpression(n) && isSinkCallee(n.expression)) {
        const res = analyzeCall(n, SINK_SELECTOR);
        if (res.kind === "forward") {
          funnels.set(res.reference.functionSymbol, {
            argumentIndex: res.reference.parameterIndex,
            propertyPath: res.reference.propertyPath,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
  }

  // Pass B: emission call sites — every sink/funnel call is classified.
  for (const sf of sourceFiles) {
    const file = realPath(sf.fileName);
    const record = (res: Emission, node: any): void => {
      if (res.kind === "concrete") {
        if (!emitters.has(res.eventType)) emitters.set(res.eventType, new Set());
        emitters.get(res.eventType)!.add(file);
      } else if (res.kind === "unresolved") {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        unresolved.push({ file, line, detail: res.detail });
      }
      // forward: a funnel-defining / wrapper relay — not a concrete emission here.
    };
    const visit = (n: any): void => {
      if (ts.isCallExpression(n)) {
        if (ts.isPropertyAccessExpression(n.expression) && ["bind", "call", "apply"].includes(n.expression.name.text) && resolvesToSink(n.expression.expression, new Set())) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          unresolved.push({ file, line, detail: `unsupported ${n.expression.name.text}() indirection around a sink` });
        } else if (isSinkCallee(n.expression)) {
          record(analyzeCall(n, SINK_SELECTOR), n);
        } else {
          const calleeSym = aliased(checker.getSymbolAtLocation(n.expression));
          const funnelSel = calleeSym && funnels.get(calleeSym);
          if (funnelSel) record(analyzeCall(n, funnelSel), n);
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
