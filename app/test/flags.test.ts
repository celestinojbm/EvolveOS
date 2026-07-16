/**
 * Founding Ratification Pack + derived `real_money` flag (issue #11, P0-10).
 *
 * The productive API (flags.ts) is loader-only: it always reads the canonical
 * docs/RATIFICATION_PACK.md and never accepts bytes/override. These tests drive
 * the INJECTABLE core (ratification-core.ts) with fixture snapshots — the
 * sanctioned harness — plus productive-path assertions (fresh-DB false, the
 * shipped pack is proposed/not-ready, drift fails the loader closed).
 *
 * Coverage: the constitutional threshold + capacity inventories, the
 * THR-SPEND-EXEC = 0 no-spend invariant, derived readiness, strict manifest
 * validation, constitutional-section validation, runtime manifest↔table binding,
 * session-bound + user-grounded signatures with historical validity, serialized
 * evaluation, deep-frozen snapshots, malformed-event resistance, idempotence, and
 * concurrency.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import {
  parseRatificationPackBytes,
  computeRatificationReadiness,
  deriveRequiredSigners,
  renderThresholdsTable,
  renderRolesTable,
  verifyRenderedTables,
  validateRatificationSignatureEvent,
  parseEventTimestamp,
  digestPackBytes,
  recordSignatureForSnapshot,
  evaluateRealMoneyForSnapshot,
  RatificationPackInvalid,
  REQUIRED_THRESHOLD_IDS,
  SPEND_EXEC_ID,
  RATIFICATION_EVENT_TYPE,
  RATIFICATION_OBJECT_TYPE,
  MANIFEST_START,
  MANIFEST_END,
  THRESHOLDS_START,
  THRESHOLDS_END,
  ROLES_START,
  ROLES_END,
  G00_START,
  G00_END,
  NONSCOPE_START,
  NONSCOPE_END,
  SIGNATURE_START,
  SIGNATURE_END,
  type RatificationManifest,
  type RatificationPackSnapshot,
  type Threshold,
} from "../src/lib/ratification-core.js";
import {
  readRatificationPack,
  isRealMoneyEnabled,
  recordRatificationSignature,
  snapshotRatificationPack,
  RATIFICATION_PACK_PATH,
} from "../src/lib/flags.js";
import { createUser, grantRole, revokeRole, startSession, endSession, hasActiveRole } from "../src/lib/auth.js";
import { appendEvent, verifyChainInDb } from "../src/lib/eventlog.js";
import { passPipelineGate } from "../src/lib/gates.js";
import { setupActors, fileDR, ventureTo, type Actors } from "./helpers.js";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());
const ACK =
  "I have read this fixture pack in full and I ratify it, as my own act and by my own hand; I acknowledge that altering any byte invalidates every prior signature.";

let packSeq = Number(runId.replace(/\D/g, "").slice(-6)) * 100;
function nextPackId(): string {
  packSeq += 1;
  return `FRP-2026-${packSeq}`;
}
let forgeSeq = 0;

interface SignerSpec {
  capacity: "founding_signatory" | "portfolio_review_lead" | "operator" | "curator";
  actorId: string;
  name: string;
}

/** The four constitutional capacities, unique per run+tag. */
function defaultSigners(tag: string): SignerSpec[] {
  return [
    { capacity: "founding_signatory", actorId: `usr-${runId}-${tag}-fs`, name: `Founder ${tag}` },
    { capacity: "portfolio_review_lead", actorId: `usr-${runId}-${tag}-lead`, name: `Lead ${tag}` },
    { capacity: "operator", actorId: `usr-${runId}-${tag}-op`, name: `Op ${tag}` },
    { capacity: "curator", actorId: `usr-${runId}-${tag}-cur`, name: `Curator ${tag}` },
  ];
}

function fullThresholds(unresolvedIds: string[] = []): Threshold[] {
  return REQUIRED_THRESHOLD_IDS.map((id) => {
    const unresolved = unresolvedIds.includes(id);
    return {
      id,
      concept: `${id} concept`,
      deployment_value: id === SPEND_EXEC_ID ? 0 : unresolved ? "UNRESOLVED" : "$100",
      unit: "USD",
      status: unresolved ? "unresolved" : "resolved",
    } as Threshold;
  });
}

function buildManifest(
  signers: SignerSpec[],
  over: Partial<RatificationManifest> & { packId?: string } = {},
): RatificationManifest {
  const ready = over.ratification_ready ?? true;
  return {
    pack_id: over.packId ?? nextPackId(),
    version: over.version ?? "1.0.0",
    proposed_date: "2026-07-15",
    document_status: over.document_status ?? (ready ? "ratification-ready" : "proposed"),
    adr_ref: "ADR-006",
    spec_ref: "Part 0 §5",
    acknowledgement: over.acknowledgement ?? ACK,
    acknowledgement_version: over.acknowledgement_version ?? "1.0.0",
    thresholds_resolved: over.thresholds_resolved ?? true,
    roles_assigned: over.roles_assigned ?? true,
    ratification_ready: ready,
    thresholds: over.thresholds ?? fullThresholds(),
    role_assignments:
      over.role_assignments ??
      signers.map((s) => ({
        capacity: s.capacity,
        actor_id: s.actorId,
        name: s.name,
        required_signer: true,
        status: "assigned" as const,
      })),
  };
}

const DEFAULT_G00 =
  "Who may invoke a stop: any single authorized human. A reason is optional to stop. " +
  "Restart is authorized only by the owning gate's approver, and requires a non-empty rationale, recorded. " +
  "Technical enforcement is deferred to issue #12.";
const DEFAULT_NONSCOPE =
  "No spend execution at all in v1. No external agent credentials. Nothing R4 is ever automated. " +
  "No technical G-00 stop mechanism here (issue #12).";
const DEFAULT_SIGNATURE =
  "By signing I accept the thresholds, the role assignments, the manual G-00 procedure, the MVP non-scope, " +
  "and the stated risks; and I acknowledge that altering any byte invalidates every prior signature.";

interface SectionOpts {
  g00?: string | null;
  nonscope?: string | null;
  signature?: string | null;
  duplicate?: "g00" | "nonscope" | "signature";
}

function section(start: string, end: string, body: string | null | undefined, def: string): string {
  if (body === null) return ""; // omit entirely
  return `${start}\n${body ?? def}\n${end}`;
}

function buildDoc(manifest: RatificationManifest, opts: { trailer?: string; sections?: SectionOpts } = {}): string {
  const s = opts.sections ?? {};
  let g00 = section(G00_START, G00_END, s.g00, DEFAULT_G00);
  let nonscope = section(NONSCOPE_START, NONSCOPE_END, s.nonscope, DEFAULT_NONSCOPE);
  let signature = section(SIGNATURE_START, SIGNATURE_END, s.signature, DEFAULT_SIGNATURE);
  if (s.duplicate === "g00") g00 += "\n" + g00;
  if (s.duplicate === "nonscope") nonscope += "\n" + nonscope;
  if (s.duplicate === "signature") signature += "\n" + signature;
  return (
    `# Fixture Founding Ratification Pack\n\nProse.\n\n` +
    `${THRESHOLDS_START}\n${renderThresholdsTable(manifest)}\n${THRESHOLDS_END}\n\n` +
    `${ROLES_START}\n${renderRolesTable(manifest)}\n${ROLES_END}\n\n` +
    `${g00}\n\n${nonscope}\n\n${signature}\n\n` +
    `${MANIFEST_START}\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n${MANIFEST_END}\n\nEnd.${opts.trailer ?? ""}\n`
  );
}

function parseOrThrow(manifest: RatificationManifest, opts?: { trailer?: string; sections?: SectionOpts }): RatificationPackSnapshot {
  const { snapshot, errors } = parseRatificationPackBytes(buildDoc(manifest, opts));
  if (!snapshot) throw new Error(`fixture invalid: ${JSON.stringify(errors)}`);
  return snapshot;
}

function buildReady(tag: string, over: Partial<RatificationManifest> & { packId?: string; trailer?: string } = {}) {
  const signers = defaultSigners(tag);
  const snapshot = parseOrThrow(buildManifest(signers, over), { trailer: over.trailer });
  return { snapshot, signers };
}

// ---------------------------------------------------------------------------
// Pure — inventories, strict validation, readiness, sections, digest, tables.
// ---------------------------------------------------------------------------

describe("threshold inventory + no-spend invariant", () => {
  it.each(REQUIRED_THRESHOLD_IDS)("removing required threshold %s makes the pack invalid", (id) => {
    const m = buildManifest(defaultSigners("thrm"), { thresholds: fullThresholds().filter((t) => t.id !== id) });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.path === `thresholds.${id}` && e.keyword === "required")).toBe(true);
  });

  it("keeping only one resolved threshold is invalid (inventory incomplete)", () => {
    const m = buildManifest(defaultSigners("one"), {
      thresholds: [{ id: SPEND_EXEC_ID, concept: "c", deployment_value: 0, unit: "USD", status: "resolved" }],
    });
    expect(parseRatificationPackBytes(buildDoc(m)).snapshot).toBeNull();
  });

  it("a duplicated required threshold is invalid", () => {
    const dup = [...fullThresholds(), { id: "THR-R1", concept: "again", deployment_value: "$1", unit: "USD", status: "resolved" } as Threshold];
    const m = buildManifest(defaultSigners("dupthr"), { thresholds: dup });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "unique")).toBe(true);
  });

  it("an extra unresolved threshold keeps the pack not-ready", () => {
    const extra = [...fullThresholds(), { id: "THR-EXTRA", concept: "x", deployment_value: "UNRESOLVED", unit: "USD", status: "unresolved" } as Threshold];
    const m = buildManifest(defaultSigners("xthr"), { thresholds: extra, thresholds_resolved: false, ratification_ready: false, document_status: "proposed" });
    const { snapshot } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.ready).toBe(false);
  });

  it("THR-SPEND-EXEC = 0 (USD, resolved) is valid", () => {
    expect(buildReady("se0").snapshot.ready).toBe(true);
  });

  it.each([1, "$0", "0", 100])("THR-SPEND-EXEC = %s (non-zero/non-canonical) is invalid", (val) => {
    const thresholds = fullThresholds().map((t) => (t.id === SPEND_EXEC_ID ? { ...t, deployment_value: val as string | number } : t));
    const m = buildManifest(defaultSigners("se"), { thresholds });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "invariant")).toBe(true);
  });

  it("THR-SPEND-EXEC with the wrong unit is invalid", () => {
    const thresholds = fullThresholds().map((t) => (t.id === SPEND_EXEC_ID ? { ...t, unit: "EUR" } : t));
    const m = buildManifest(defaultSigners("seu"), { thresholds });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "invariant")).toBe(true);
  });
});

describe("capacity inventory", () => {
  it.each(["founding_signatory", "portfolio_review_lead", "operator", "curator"] as const)(
    "removing the %s makes the pack invalid",
    (cap) => {
      const signers = defaultSigners("cap").filter((s) => s.capacity !== cap);
      const { snapshot, errors } = parseRatificationPackBytes(buildDoc(buildManifest(signers)));
      expect(snapshot).toBeNull();
      expect(errors.some((e) => e.path === `role_assignments.${cap}` && e.keyword === "required")).toBe(true);
    },
  );

  it("an obligatory capacity marked required_signer:false is invalid", () => {
    const m = buildManifest(defaultSigners("rsfalse"));
    m.role_assignments[2].required_signer = false; // the operator
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "required_signer")).toBe(true);
  });

  it("a duplicated singular capacity is invalid", () => {
    const s = defaultSigners("dupcap");
    const extraFounder: SignerSpec = { capacity: "founding_signatory", actorId: `usr-${runId}-dupcap-fs2`, name: "Founder 2" };
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(buildManifest([...s, extraFounder])));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.path === "role_assignments.founding_signatory" && e.keyword === "unique")).toBe(true);
  });

  it("several distinct operators are valid", () => {
    const s = defaultSigners("multiop");
    const op2: SignerSpec = { capacity: "operator", actorId: `usr-${runId}-multiop-op2`, name: "Op 2" };
    expect(parseOrThrow(buildManifest([...s, op2])).requiredSigners.length).toBe(5);
  });

  it("an included assignment that is unassigned keeps the pack not-ready", () => {
    const m = buildManifest(defaultSigners("unass"));
    m.role_assignments[3].status = "unassigned";
    m.role_assignments[3].actor_id = "UNASSIGNED";
    m.role_assignments[3].name = "UNASSIGNED";
    m.roles_assigned = false;
    m.ratification_ready = false;
    m.document_status = "proposed";
    const { snapshot } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.ready).toBe(false);
  });

  it("a repeated required-signer actor id makes roles unassigned (distinct-human policy)", () => {
    const m = buildManifest(defaultSigners("dupactor"));
    m.role_assignments[2].actor_id = m.role_assignments[3].actor_id; // operator == curator id
    expect(computeRatificationReadiness(m).roles_assigned).toBe(false);
  });
});

describe("constitutional sections", () => {
  it.each([
    ["g00", "G-00"],
    ["nonscope", "non-scope"],
    ["signature", "signature statement"],
  ] as const)("a missing %s block is invalid", (key: "g00" | "nonscope" | "signature", _label: string) => {
    const snap = parseRatificationPackBytes(buildDoc(buildManifest(defaultSigners("miss")), { sections: { [key]: null } }));
    expect(snap.snapshot).toBeNull();
    expect(snap.errors.some((e) => e.path.startsWith("section."))).toBe(true);
  });

  it("a duplicated section block is invalid", () => {
    const snap = parseRatificationPackBytes(buildDoc(buildManifest(defaultSigners("dupsec")), { sections: { duplicate: "g00" } }));
    expect(snap.snapshot).toBeNull();
    expect(snap.errors.some((e) => e.keyword === "cardinality")).toBe(true);
  });

  it("an empty section block is invalid", () => {
    const snap = parseRatificationPackBytes(buildDoc(buildManifest(defaultSigners("empsec")), { sections: { g00: "" } }));
    expect(snap.snapshot).toBeNull();
    expect(snap.errors.some((e) => e.keyword === "empty")).toBe(true);
  });

  it("a G-00 block missing a mandatory clause is invalid", () => {
    const noRestart = "Who may invoke a stop: any single authorized human. A reason is optional to stop. Technical enforcement is issue #12.";
    const snap = parseRatificationPackBytes(buildDoc(buildManifest(defaultSigners("clause")), { sections: { g00: noRestart } }));
    expect(snap.snapshot).toBeNull();
    expect(snap.errors.some((e) => e.keyword === "clause")).toBe(true);
  });

  it("a non-scope block missing the no-spend clause is invalid", () => {
    const noSpend = "No external agent credentials. Nothing R4 is ever automated. No technical G-00 stop mechanism here.";
    const snap = parseRatificationPackBytes(buildDoc(buildManifest(defaultSigners("ns")), { sections: { nonscope: noSpend } }));
    expect(snap.snapshot).toBeNull();
    expect(snap.errors.some((e) => e.keyword === "clause")).toBe(true);
  });
});

describe("manifest — strict structural validation", () => {
  it("an absent manifest is rejected", () => {
    const { snapshot, errors } = parseRatificationPackBytes("# nothing\n");
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "missing")).toBe(true);
  });

  it("two JSON fences inside the markers are rejected as ambiguous", () => {
    const m = buildManifest(defaultSigners("2fence"));
    const bad =
      buildDoc(m).replace(
        `${MANIFEST_START}\n\`\`\`json\n${JSON.stringify(m, null, 2)}\n\`\`\`\n${MANIFEST_END}`,
        `${MANIFEST_START}\n\`\`\`json\n${JSON.stringify(m)}\n\`\`\`\n\`\`\`json\n{}\n\`\`\`\n${MANIFEST_END}`,
      );
    const { snapshot, errors } = parseRatificationPackBytes(bad);
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "ambiguous")).toBe(true);
  });

  it("an unknown top-level property is rejected", () => {
    const m = { ...buildManifest(defaultSigners("extra")), sneaky: true } as unknown as RatificationManifest;
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "additionalProperties")).toBe(true);
  });

  it("an unknown property inside a role assignment is rejected", () => {
    const m = buildManifest(defaultSigners("rx"));
    (m.role_assignments[0] as unknown as Record<string, unknown>).extra = 1;
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "additionalProperties" && e.path.startsWith("role_assignments"))).toBe(true);
  });

  it("a whitespace-only string is rejected", () => {
    const m = buildManifest(defaultSigners("ws"));
    m.role_assignments[0].name = "   ";
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.path.startsWith("role_assignments[0].name"))).toBe(true);
  });

  it("an invalid pack id and version are rejected", () => {
    const bad1 = parseRatificationPackBytes(buildDoc(buildManifest(defaultSigners("pid"), { packId: "PACK-1" })));
    expect(bad1.errors.some((e) => e.path === "pack_id")).toBe(true);
    const bad2 = parseRatificationPackBytes(buildDoc(buildManifest(defaultSigners("ver"), { version: "1.0" })));
    expect(bad2.errors.some((e) => e.path === "version")).toBe(true);
  });

  it("document_status incompatible with computed readiness is rejected", () => {
    const m = buildManifest(defaultSigners("docstat"), { thresholds: fullThresholds(["THR-CAPITAL"]) });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "inconsistent")).toBe(true);
  });

  it("declared-true booleans with an unresolved threshold → invalid (inconsistent)", () => {
    const m = buildManifest(defaultSigners("lie"), {
      thresholds: fullThresholds(["THR-CAPITAL"]),
      thresholds_resolved: true,
      ratification_ready: true,
      document_status: "ratification-ready",
    });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.path === "thresholds_resolved" && e.keyword === "inconsistent")).toBe(true);
  });

  it("structured errors always carry path + keyword + message", () => {
    const { errors } = parseRatificationPackBytes("# no manifest\n");
    for (const e of errors) {
      expect(typeof e.path).toBe("string");
      expect(typeof e.keyword).toBe("string");
      expect(typeof e.message).toBe("string");
    }
  });
});

describe("readiness, derivation, digest, tables", () => {
  it.each(["UNRESOLVED", "TBD", "TODO", "UNKNOWN", "   ", ""])(
    "a placeholder deployment_value (%s) makes thresholds unresolved",
    (val) => {
      const thresholds = fullThresholds().map((t) => (t.id === "THR-R1" ? { ...t, deployment_value: val } : t));
      expect(computeRatificationReadiness(buildManifest(defaultSigners("ph"), { thresholds })).thresholds_resolved).toBe(false);
    },
  );

  it("required signers are derived from role_assignments (required_signer=true only)", () => {
    const m = buildManifest(defaultSigners("derive"));
    m.role_assignments.push({ capacity: "operator", actor_id: "opt", name: "Optional", required_signer: false, status: "assigned" });
    // required_signer:false on a constitutional capacity is invalid, so this is a pure derivation check only.
    expect(deriveRequiredSigners(m).map((s) => s.actor_id)).not.toContain("opt");
  });

  it("a complete pack is ready; a byte change flips the digest", () => {
    const { snapshot } = buildReady("full");
    expect(snapshot.ready).toBe(true);
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digestPackBytes(snapshot.bytes + " ")).not.toBe(snapshot.digest);
  });

  it("a table edited away from the manifest is detected (and fails the parser)", () => {
    const { snapshot } = buildReady("drift");
    const corrupted = snapshot.bytes.replace("| `THR-CAPITAL`", "| `THR-CAPITAL-X`");
    expect(verifyRenderedTables({ ...snapshot, bytes: corrupted })).not.toEqual([]);
    // The parser folds the table binding in: drift → invalid.
    const reparsed = parseRatificationPackBytes(corrupted);
    expect(reparsed.snapshot).toBeNull();
    expect(reparsed.errors.some((e) => e.keyword === "drift")).toBe(true);
  });

  it("the parsed snapshot is deeply frozen", () => {
    const { snapshot } = buildReady("frozen");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.manifest)).toBe(true);
    expect(Object.isFrozen(snapshot.manifest.thresholds)).toBe(true);
    expect(Object.isFrozen(snapshot.requiredSigners)).toBe(true);
    expect(() => (snapshot.manifest.thresholds as Threshold[]).push({} as Threshold)).toThrow();
    expect(() => ((snapshot.requiredSigners[0] as { actor_id: string }).actor_id = "x")).toThrow();
    expect(() => ((snapshot as { ready: boolean }).ready = false)).toThrow();
  });
});

describe("parseEventTimestamp (safe timestamp parsing)", () => {
  it.each(["not-a-date", "", "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-07-16", "16/07/2026", "2026-07-16 00:00:00"])(
    "rejects the malformed/ambiguous value %s",
    (v) => expect(parseEventTimestamp(v)).toBeNull(),
  );

  it("rejects non-string inputs", () => {
    expect(parseEventTimestamp(123)).toBeNull();
    expect(parseEventTimestamp({})).toBeNull();
    expect(parseEventTimestamp(null)).toBeNull();
    expect(parseEventTimestamp(undefined)).toBeNull();
  });

  it("accepts a strict ISO instant", () => {
    expect(parseEventTimestamp("2026-07-16T00:00:00.000Z")).toBeInstanceOf(Date);
    expect(parseEventTimestamp("2026-07-16T00:00:00+02:00")).toBeInstanceOf(Date);
  });

  it("a malformed timestamp makes signature evidence structurally invalid (no throw)", () => {
    const { snapshot } = buildReady("tsval");
    const signer = snapshot.requiredSigners[0];
    const base = {
      event_type: RATIFICATION_EVENT_TYPE,
      actor_type: "human",
      actor_id: signer.actor_id,
      object_type: RATIFICATION_OBJECT_TYPE,
      object_id: snapshot.packId,
      payload: {
        pack_digest: snapshot.digest,
        pack_version: snapshot.version,
        signer_actor_id: signer.actor_id,
        signer_capacity: signer.capacity,
        acknowledgement_version: "1.0.0",
        session_id: "s",
      },
    };
    expect(validateRatificationSignatureEvent({ ...base, timestamp: "not-a-date" }, signer, snapshot)).toBe(false);
    expect(validateRatificationSignatureEvent({ ...base, timestamp: 123 }, signer, snapshot)).toBe(false);
    expect(validateRatificationSignatureEvent({ ...base, timestamp: "2026-07-16T00:00:00.000Z" }, signer, snapshot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Productive API surface (loader-only; no bytes/override).
// ---------------------------------------------------------------------------

describe("productive API — canonical loader only", () => {
  it("the shipped docs/RATIFICATION_PACK.md is valid but NOT ready", () => {
    const { snapshot, errors } = readRatificationPack();
    expect(errors).toEqual([]);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.ready).toBe(false);
    expect(snapshot!.packId).toBe("FRP-2026-001");
  });

  it("snapshotRatificationPack returns the canonical snapshot", () => {
    expect(snapshotRatificationPack().packId).toBe("FRP-2026-001");
    expect(RATIFICATION_PACK_PATH).toMatch(/docs\/RATIFICATION_PACK\.md$/);
  });

  it("no public productive function accepts pack bytes/override, and only flags.ts imports the core", () => {
    const libDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "lib");
    const flagsSrc = readFileSync(join(libDir, "flags.ts"), "utf8");
    expect(flagsSrc).not.toMatch(/packOverride/);
    expect(flagsSrc).not.toMatch(/bytes\?\s*:/);
    expect(flagsSrc).toMatch(/export async function isRealMoneyEnabled/);
    const offenders = readdirSync(libDir)
      .filter((f) => f.endsWith(".ts") && f !== "flags.ts" && f !== "ratification-core.ts")
      .filter((f) => /from\s+["'][^"']*ratification-core/.test(readFileSync(join(libDir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Database helpers.
// ---------------------------------------------------------------------------

async function provision(client: pg.Client, signers: SignerSpec[]): Promise<Record<string, string>> {
  const sessions: Record<string, string> = {};
  for (const s of signers) {
    await createUser(client, { id: s.actorId, displayName: s.name });
    if (s.capacity === "portfolio_review_lead") await grantRole(client, { userId: s.actorId, role: "approver", grantedBy: "admin" });
    if (s.capacity === "operator") await grantRole(client, { userId: s.actorId, role: "operator", grantedBy: "admin" });
    sessions[s.actorId] = (await startSession(client, { userId: s.actorId })).id;
  }
  return sessions;
}

async function sign(
  client: pg.Client,
  snapshot: RatificationPackSnapshot,
  s: SignerSpec,
  sessionId: string,
  over: Partial<{ packId: string; expectedDigest: string; signerCapacity: string; acknowledgement: string; sessionId: string }> = {},
): Promise<{ eventId: string; idempotent: boolean }> {
  return recordSignatureForSnapshot(client, snapshot, {
    packId: over.packId ?? snapshot.packId,
    expectedDigest: over.expectedDigest ?? snapshot.digest,
    signerActorId: s.actorId,
    signerCapacity: over.signerCapacity ?? s.capacity,
    acknowledgement: over.acknowledgement ?? ACK,
    sessionId: over.sessionId ?? sessionId,
  });
}

async function signAll(client: pg.Client, snapshot: RatificationPackSnapshot, signers: SignerSpec[], sessions: Record<string, string>): Promise<void> {
  for (const s of signers) await sign(client, snapshot, s, sessions[s.actorId]);
}

async function countPackEvents(client: pg.Client, packId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE event_type = $1 AND object_id = $2",
    [RATIFICATION_EVENT_TYPE, packId],
  );
  return rows[0].n;
}

async function forge(
  client: pg.Client,
  snapshot: RatificationPackSnapshot,
  s: SignerSpec,
  payload: Record<string, unknown>,
  timestamp = new Date().toISOString(),
): Promise<void> {
  await appendEvent(client, {
    id: `EV-forge-${runId}-${forgeSeq++}`,
    timestamp,
    actor_type: "human",
    actor_id: s.actorId,
    event_type: RATIFICATION_EVENT_TYPE,
    object_type: RATIFICATION_OBJECT_TYPE,
    object_id: snapshot.packId,
    payload,
  });
}

/** The event-chain advisory lock key — mirrors APPEND_LOCK_KEY in eventlog.ts. */
const EVENT_CHAIN_LOCK_KEY = 4207001;

/** Deterministically wait (no arbitrary sleep) until `pid` has a pending advisory lock. */
async function waitForLockWaiter(observer: pg.Client, pid: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { rows } = await observer.query(
      "SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted AND locktype = 'advisory' LIMIT 1",
      [pid],
    );
    if (rows.length) return;
  }
  throw new Error(`no pending advisory lock appeared for pid ${pid}`);
}

function goodPayload(snapshot: RatificationPackSnapshot, s: SignerSpec, sessionId: string): Record<string, unknown> {
  return {
    pack_digest: snapshot.digest,
    pack_version: snapshot.version,
    signer_actor_id: s.actorId,
    signer_capacity: s.capacity,
    acknowledgement_version: "1.0.0",
    session_id: sessionId,
  };
}

// ---------------------------------------------------------------------------
// Database — signature protocol, flag, sessions, grounding, concurrency.
// ---------------------------------------------------------------------------

describe("signature protocol + derived flag (Postgres)", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("a fresh DB with the shipped (not-ready) pack → real_money is false", async () => {
    expect(await isRealMoneyEnabled(client)).toBe(false);
  });

  it("a ready fixture with zero signatures → false", async () => {
    const { snapshot } = buildReady("zero");
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
  });

  it("a valid signature emits one human, self-signed, digest-bound, session-bound event", async () => {
    const { snapshot, signers } = buildReady("one");
    const sessions = await provision(client, signers);
    const r = await sign(client, snapshot, signers[0], sessions[signers[0].actorId]);
    expect(r.idempotent).toBe(false);
    const { rows } = await client.query("SELECT actor_type, object_type, payload FROM events WHERE id = $1", [r.eventId]);
    expect(rows[0].actor_type).toBe("human");
    expect(rows[0].object_type).toBe(RATIFICATION_OBJECT_TYPE);
    expect(rows[0].payload.pack_digest).toBe(snapshot.digest);
    expect(rows[0].payload.session_id).toBe(sessions[signers[0].actorId]);
  });

  it("all required signers signed → true; one missing → false", async () => {
    const { snapshot, signers } = buildReady("all");
    const sessions = await provision(client, signers);
    for (const s of signers.slice(0, 3)) await sign(client, snapshot, s, sessions[s.actorId]);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
    await sign(client, snapshot, signers[3], sessions[signers[3].actorId]);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
  });

  it("a non-required actor, wrong capacity, stale digest, wrong pack id, bad ack are each rejected", async () => {
    const { snapshot, signers } = buildReady("rej");
    const sessions = await provision(client, signers);
    const intruder: SignerSpec = { capacity: "operator", actorId: `intruder-${runId}`, name: "X" };
    await createUser(client, { id: intruder.actorId, displayName: intruder.name });
    const isess = (await startSession(client, { userId: intruder.actorId })).id;
    await expect(sign(client, snapshot, intruder, isess)).rejects.toThrow(/not a required signer/i);
    await expect(sign(client, snapshot, signers[0], sessions[signers[0].actorId], { signerCapacity: "curator" })).rejects.toThrow(/capacity mismatch/i);
    await expect(sign(client, snapshot, signers[0], sessions[signers[0].actorId], { expectedDigest: "0".repeat(64) })).rejects.toThrow(/stale pack digest/i);
    await expect(sign(client, snapshot, signers[0], sessions[signers[0].actorId], { packId: "FRP-2026-999999" })).rejects.toThrow(/pack id mismatch/i);
    await expect(sign(client, snapshot, signers[0], sessions[signers[0].actorId], { acknowledgement: "nope" })).rejects.toThrow(/acknowledgement does not match/i);
  });

  it("a not-ready pack cannot be signed", async () => {
    const signers = defaultSigners("nrsign");
    const snapshot = parseOrThrow(
      buildManifest(signers, { thresholds: fullThresholds(["THR-CAPITAL"]), thresholds_resolved: false, ratification_ready: false, document_status: "proposed" }),
    );
    const sessions = await provision(client, signers);
    await expect(sign(client, snapshot, signers[0], sessions[signers[0].actorId])).rejects.toThrow(RatificationPackInvalid);
  });

  it("a failed signature leaves no partial event", async () => {
    const { snapshot, signers } = buildReady("nopart");
    const sessions = await provision(client, signers);
    const before = await countPackEvents(client, snapshot.packId);
    await expect(sign(client, snapshot, signers[0], sessions[signers[0].actorId], { expectedDigest: "0".repeat(64) })).rejects.toThrow();
    expect(await countPackEvents(client, snapshot.packId)).toBe(before);
  });

  it("re-signing the same full evidence is idempotent — one event per signer", async () => {
    const { snapshot, signers } = buildReady("idem");
    const sessions = await provision(client, signers);
    const a = await sign(client, snapshot, signers[0], sessions[signers[0].actorId]);
    const b = await sign(client, snapshot, signers[0], sessions[signers[0].actorId]);
    expect(b.idempotent).toBe(true);
    expect(b.eventId).toBe(a.eventId);
    expect(await countPackEvents(client, snapshot.packId)).toBe(1);
  });

  it("editing a byte after signing drops the flag to false", async () => {
    const { snapshot, signers } = buildReady("byte");
    const sessions = await provision(client, signers);
    await signAll(client, snapshot, signers, sessions);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    const edited = parseRatificationPackBytes(snapshot.bytes + " ").snapshot!;
    expect(edited.packId).toBe(snapshot.packId);
    expect(await evaluateRealMoneyForSnapshot(client, edited)).toBe(false);
  });

  it("adding a required signer holds the flag false until all sign the new bytes", async () => {
    const tag = "grow";
    const packId = nextPackId();
    const base = defaultSigners(tag);
    const op2: SignerSpec = { capacity: "operator", actorId: `usr-${runId}-${tag}-op2`, name: "Op2" };
    const sessions = await provision(client, [...base, op2]);
    const small = parseOrThrow(buildManifest(base, { packId }));
    await signAll(client, small, base, sessions);
    expect(await evaluateRealMoneyForSnapshot(client, small)).toBe(true);
    const big = parseOrThrow(buildManifest([...base, op2], { packId }));
    expect(await evaluateRealMoneyForSnapshot(client, big)).toBe(false);
    for (const s of base) await sign(client, big, s, sessions[s.actorId]);
    expect(await evaluateRealMoneyForSnapshot(client, big)).toBe(false);
    await sign(client, big, op2, sessions[op2.actorId]);
    expect(await evaluateRealMoneyForSnapshot(client, big)).toBe(true);
  });
});

describe("session-bound signatures (Postgres)", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("a nonexistent, ended, or other-user session is rejected at record time", async () => {
    const { snapshot, signers } = buildReady("sess");
    const sessions = await provision(client, signers);
    const s0 = signers[0];
    await expect(sign(client, snapshot, s0, "no-such-session")).rejects.toThrow(/does not exist/i);
    const ended = (await startSession(client, { userId: s0.actorId })).id;
    await endSession(client, { sessionId: ended, userId: s0.actorId });
    await expect(sign(client, snapshot, s0, ended)).rejects.toThrow(/already ended/i);
    await expect(sign(client, snapshot, s0, sessions[signers[1].actorId])).rejects.toThrow(/belongs to a different user/i);
  });

  it("a forged event without a session id, or a non-string session id, does not count", async () => {
    const { snapshot, signers } = buildReady("sessforge");
    const sessions = await provision(client, signers);
    for (const s of signers.slice(1)) await sign(client, snapshot, s, sessions[s.actorId]);
    const s0 = signers[0];
    const { session_id: _omit, ...noSession } = goodPayload(snapshot, s0, sessions[s0.actorId]);
    await forge(client, snapshot, s0, noSession);
    await forge(client, snapshot, s0, { ...goodPayload(snapshot, s0, sessions[s0.actorId]), session_id: 123 });
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
    await sign(client, snapshot, s0, sessions[s0.actorId]);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
  });

  it("a signature whose session started AFTER the event, or ended BEFORE it, does not count", async () => {
    const { snapshot, signers } = buildReady("sesswin");
    const sessions = await provision(client, signers);
    for (const s of signers.slice(1)) await sign(client, snapshot, s, sessions[s.actorId]);
    const s0 = signers[0];
    // Session exists now; forge an event dated far in the PAST (before started_at).
    await forge(client, snapshot, s0, goodPayload(snapshot, s0, sessions[s0.actorId]), "2000-01-01T00:00:00.000Z");
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
    // End the session, then forge an event dated in the FUTURE (after ended_at).
    await endSession(client, { sessionId: sessions[s0.actorId], userId: s0.actorId });
    await forge(client, snapshot, s0, goodPayload(snapshot, s0, sessions[s0.actorId]), "2100-01-01T00:00:00.000Z");
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
  });

  it("closing a session AFTER signing does not invalidate the historic signature", async () => {
    const { snapshot, signers } = buildReady("sessclose");
    const sessions = await provision(client, signers);
    await signAll(client, snapshot, signers, sessions);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    await endSession(client, { sessionId: sessions[signers[0].actorId], userId: signers[0].actorId });
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
  });

  it("an event with a malformed timestamp does not count, does not block, and never throws", async () => {
    const { snapshot, signers } = buildReady("badts");
    const sessions = await provision(client, signers);
    for (const s of signers.slice(1)) await sign(client, snapshot, s, sessions[s.actorId]);
    const s0 = signers[0];
    // events.timestamp is TEXT — a garbage instant is storable but must be ignored.
    await forge(client, snapshot, s0, goodPayload(snapshot, s0, sessions[s0.actorId]), "not-a-date");
    await expect(evaluateRealMoneyForSnapshot(client, snapshot)).resolves.toBe(false); // no throw
    await sign(client, snapshot, s0, sessions[s0.actorId]);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
  });

  it("idempotency ignores forged events with invalid sessions and never blocks the real signature", async () => {
    const { snapshot, signers } = buildReady("idemsess");
    const sessions = await provision(client, signers);
    for (const s of signers.slice(1)) await sign(client, snapshot, s, sessions[s.actorId]);
    const s0 = signers[0];
    const sid = sessions[s0.actorId];
    // Four structurally-correct events for s0, each with an INVALID session/time.
    await forge(client, snapshot, s0, { ...goodPayload(snapshot, s0, sid), session_id: `nope-${runId}` }); // nonexistent
    await forge(client, snapshot, s0, { ...goodPayload(snapshot, s0, sid), session_id: sessions[signers[1].actorId] }); // other user's
    await forge(client, snapshot, s0, goodPayload(snapshot, s0, sid), "2000-01-01T00:00:00.000Z"); // before started_at
    await forge(client, snapshot, s0, goodPayload(snapshot, s0, sid), "not-a-date"); // invalid timestamp
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
    // The real signature is a NEW event (forged ones did not make it look idempotent).
    const r1 = await sign(client, snapshot, s0, sid);
    expect(r1.idempotent).toBe(false);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    // Re-signing the same valid evidence is now idempotent.
    const r2 = await sign(client, snapshot, s0, sid);
    expect(r2.idempotent).toBe(true);
    expect(r2.eventId).toBe(r1.eventId);
  });
});

describe("user grounding (Postgres)", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("an unregistered signer, a name mismatch, and a missing role are each rejected", async () => {
    const { snapshot, signers } = buildReady("grnd");
    const s0 = signers[0]; // founding_signatory (no role needed)
    // Unregistered:
    await expect(sign(client, snapshot, s0, "irrelevant")).rejects.toThrow(/not a registered user/i);
    // Name mismatch:
    await createUser(client, { id: s0.actorId, displayName: "Wrong Name" });
    const sess0 = (await startSession(client, { userId: s0.actorId })).id;
    await expect(sign(client, snapshot, s0, sess0)).rejects.toThrow(/name mismatch/i);
    // Lead without approver role:
    const lead = signers[1];
    await createUser(client, { id: lead.actorId, displayName: lead.name });
    const sessL = (await startSession(client, { userId: lead.actorId })).id;
    await expect(sign(client, snapshot, lead, sessL)).rejects.toThrow(/lacks the active 'approver' role/i);
  });

  it("revoking a role after signing drops the flag to false", async () => {
    const { snapshot, signers } = buildReady("revoke");
    const sessions = await provision(client, signers);
    await signAll(client, snapshot, signers, sessions);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    await revokeRole(client, { userId: signers[1].actorId, role: "approver", revokedBy: "admin" });
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
  });
});

describe("malformed / forged events never count or block (Postgres)", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("wrong-evidence human events and an agent event are ignored; the valid signature still counts", async () => {
    const { snapshot, signers } = buildReady("forge");
    const sessions = await provision(client, signers);
    for (const s of signers.slice(1)) await sign(client, snapshot, s, sessions[s.actorId]);
    const s0 = signers[0];
    const sid = sessions[s0.actorId];
    const good = goodPayload(snapshot, s0, sid);
    await forge(client, snapshot, s0, { ...good, signer_actor_id: "someone-else" });
    await forge(client, snapshot, s0, { ...good, acknowledgement_version: "9.9.9" });
    await forge(client, snapshot, s0, { ...good, pack_version: "0.0.1" });
    await forge(client, snapshot, s0, { ...good, signer_capacity: "operator" });
    await forge(client, snapshot, s0, null as unknown as Record<string, unknown>);
    await forge(client, snapshot, s0, { ...good, pack_digest: 12345 });
    // An agent-actor event with an otherwise-correct payload.
    await appendEvent(client, {
      id: `EV-agent-${runId}`,
      timestamp: new Date().toISOString(),
      actor_type: "agent",
      actor_id: s0.actorId,
      event_type: RATIFICATION_EVENT_TYPE,
      object_type: RATIFICATION_OBJECT_TYPE,
      object_id: snapshot.packId,
      payload: good,
    });
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
    for (const payload of [{ ...good, signer_actor_id: "x" }, { ...good, pack_digest: 1 }, {}]) {
      expect(validateRatificationSignatureEvent({ actor_type: "human", actor_id: s0.actorId, event_type: RATIFICATION_EVENT_TYPE, object_type: RATIFICATION_OBJECT_TYPE, object_id: snapshot.packId, payload }, snapshot.requiredSigners.find((x) => x.actor_id === s0.actorId)!, snapshot)).toBe(false);
    }
    await sign(client, snapshot, s0, sid);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
  });
});

describe("productive loader — drift fails closed (Postgres)", () => {
  let client: pg.Client;
  let original: string;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    original = readFileSync(RATIFICATION_PACK_PATH, "utf8");
  });
  afterEach(() => {
    writeFileSync(RATIFICATION_PACK_PATH, original, "utf8"); // always restore the canonical pack
  });
  afterAll(async () => {
    writeFileSync(RATIFICATION_PACK_PATH, original, "utf8");
    if (client) await client.end();
  });

  it("a table-only edit makes the productive loader invalid, unsignable, flag false", async () => {
    const drift = original.replace("| `THR-CAPITAL`", "| `THR-CAPITAL-DRIFT`");
    expect(drift).not.toBe(original);
    writeFileSync(RATIFICATION_PACK_PATH, drift, "utf8");
    expect(readRatificationPack().snapshot).toBeNull();
    expect(await isRealMoneyEnabled(client)).toBe(false);
    await expect(
      recordRatificationSignature(client, { packId: "FRP-2026-001", expectedDigest: "x", signerActorId: "a", signerCapacity: "curator", acknowledgement: "a", sessionId: "s" }),
    ).rejects.toThrow(RatificationPackInvalid);
  });

  it("a manifest-only edit makes the productive loader invalid", async () => {
    // Change the manifest's THR-CAPITAL concept without touching the rendered table.
    const drift = original.replace(
      '"id": "THR-CAPITAL", "concept": "Deployable capital base (~$10,000,000 [ASSUMPTION])"',
      '"id": "THR-CAPITAL", "concept": "Tampered concept"',
    );
    expect(drift).not.toBe(original);
    writeFileSync(RATIFICATION_PACK_PATH, drift, "utf8");
    expect(readRatificationPack().snapshot).toBeNull();
    expect(await isRealMoneyEnabled(client)).toBe(false);
  });
});

describe("concurrency + serialized evaluation (Postgres)", () => {
  let a: pg.Client;
  let b: pg.Client;
  let c3: pg.Client; // an observer, used only to watch pg_locks deterministically
  beforeAll(async () => {
    a = new pg.Client({ connectionString: DATABASE_URL });
    b = new pg.Client({ connectionString: DATABASE_URL });
    c3 = new pg.Client({ connectionString: DATABASE_URL });
    await a.connect();
    await b.connect();
    await c3.connect();
  });
  afterAll(async () => {
    if (a) await a.end();
    if (b) await b.end();
    if (c3) await c3.end();
  });

  it("two concurrent signatures by the same signer collapse to one event", async () => {
    const { snapshot, signers } = buildReady("cc-same");
    const sessions = await provision(a, signers);
    const [r1, r2] = await Promise.all([
      sign(a, snapshot, signers[0], sessions[signers[0].actorId]),
      sign(b, snapshot, signers[0], sessions[signers[0].actorId]),
    ]);
    expect(r1.eventId).toBe(r2.eventId);
    expect(await countPackEvents(a, snapshot.packId)).toBe(1);
  });

  it("concurrent signatures by different signers both land; the chain stays intact", async () => {
    const { snapshot, signers } = buildReady("cc-diff");
    const sessions = await provision(a, signers);
    await Promise.all([
      sign(a, snapshot, signers[0], sessions[signers[0].actorId]),
      sign(b, snapshot, signers[1], sessions[signers[1].actorId]),
    ]);
    expect(await countPackEvents(a, snapshot.packId)).toBe(2);
    expect((await verifyChainInDb(a)).ok).toBe(true);
  });

  it("evaluation waiting on the lock observes a revocation that committed first → false", async () => {
    const { snapshot, signers } = buildReady("race-wait");
    const sessions = await provision(a, signers);
    await signAll(a, snapshot, signers, sessions);
    expect(await evaluateRealMoneyForSnapshot(a, snapshot)).toBe(true);
    const op = signers.find((s) => s.capacity === "operator")!;
    const aPid = (await a.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;

    // B takes the event-chain advisory lock and stages the revocation (uncommitted).
    await b.query("BEGIN");
    await b.query("SELECT pg_advisory_xact_lock($1)", [EVENT_CHAIN_LOCK_KEY]);
    await b.query("UPDATE role_grants SET revoked_at = now() WHERE user_id = $1 AND role = 'operator' AND revoked_at IS NULL", [op.actorId]);

    // A begins evaluating; it BEGINs and blocks acquiring the SAME lock.
    const evalP = evaluateRealMoneyForSnapshot(a, snapshot);
    await waitForLockWaiter(c3, aPid); // deterministic: A is now blocked on the lock
    await b.query("COMMIT"); // the revocation commits and releases the lock

    // A acquires the lock AFTER the revoke committed, so (READ COMMITTED) it sees it.
    expect(await evalP).toBe(false);
  });

  it("while evaluation holds the lock a revoke waits; the in-flight read sees prior state; a later eval sees the revoke", async () => {
    const { snapshot, signers } = buildReady("race-hold");
    const sessions = await provision(a, signers);
    await signAll(a, snapshot, signers, sessions);
    const op = signers.find((s) => s.capacity === "operator")!;
    const bPid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;

    // A holds the event-chain lock, mimicking an in-flight evaluation.
    await a.query("BEGIN");
    await a.query("SELECT pg_advisory_xact_lock($1)", [EVENT_CHAIN_LOCK_KEY]);

    // B tries to revoke via the real path; it blocks acquiring the same lock.
    const revokeP = revokeRole(b, { userId: op.actorId, role: "operator", revokedBy: "admin" });
    await waitForLockWaiter(c3, bPid);

    // The read in flight (under A's lock) still sees the prior, un-revoked state.
    expect(await hasActiveRole(a, op.actorId, "operator")).toBe(true);
    await a.query("COMMIT"); // release the lock
    await revokeP; // B's revocation now completes

    // A subsequent evaluation reflects the committed revoke.
    expect(await evaluateRealMoneyForSnapshot(a, snapshot)).toBe(false);
  });
});

describe("hard limit: a true flag executes no money (Postgres)", () => {
  let client: pg.Client;
  let actors: Actors;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "flags-limit");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("evaluating the flag performs no writes", async () => {
    const { snapshot, signers } = buildReady("pure");
    const sessions = await provision(client, signers);
    await signAll(client, snapshot, signers, sessions);
    const before = await countPackEvents(client, snapshot.packId);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    expect(await countPackEvents(client, snapshot.packId)).toBe(before);
  });

  it("even with real_money true, a spend request is still rejected (ADR-006 unchanged)", async () => {
    const { snapshot, signers } = buildReady("spend");
    const sessions = await provision(client, signers);
    await signAll(client, snapshot, signers, sessions);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);

    const vid = await ventureTo(client, actors, "research");
    const filed = await fileDR(client, actors, { gateId: "G-02" });
    await expect(
      passPipelineGate(client, {
        gateId: "G-02",
        ventureId: vid,
        decisionRecordId: filed.drId,
        approvalEventId: "EV-x",
        actor: actors.approver,
        requestedSpend: 500,
      }),
    ).rejects.toThrow(/requires manual queue \(A1\)/i);
  });
});
