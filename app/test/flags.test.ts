/**
 * Founding Ratification Pack + derived `real_money` flag (issue #11, P0-10).
 *
 * The productive API (flags.ts) is loader-only: it always reads the canonical
 * docs/RATIFICATION_PACK.md and never accepts bytes/override. These tests drive
 * the INJECTABLE core (ratification-core.ts) directly with fixture snapshots —
 * the sanctioned test harness — plus a few assertions against the real
 * productive functions (fresh-DB false; the shipped pack is proposed/not-ready;
 * no public productive function takes pack bytes).
 *
 * Coverage: derived readiness (never self-declared), strict manifest validation,
 * exact-byte digest, manifest↔table consistency, the human-only + user-grounded
 * signature protocol and every rejection, malformed-event resistance, hardened
 * idempotence, concurrency, and the hard limit that a `true` flag moves no money.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  parseRatificationPackBytes,
  computeRatificationReadiness,
  deriveRequiredSigners,
  renderThresholdsTable,
  renderRolesTable,
  verifyRenderedTables,
  validateRatificationSignatureEvent,
  digestPackBytes,
  recordSignatureForSnapshot,
  evaluateRealMoneyForSnapshot,
  RatificationPackInvalid,
  RATIFICATION_EVENT_TYPE,
  RATIFICATION_OBJECT_TYPE,
  KNOWN_CAPACITIES,
  MANIFEST_START,
  MANIFEST_END,
  THRESHOLDS_START,
  THRESHOLDS_END,
  ROLES_START,
  ROLES_END,
  type RatificationManifest,
  type RatificationPackSnapshot,
} from "../src/lib/ratification-core.js";
import {
  readRatificationPack,
  isRealMoneyEnabled,
  snapshotRatificationPack,
  RATIFICATION_PACK_PATH,
} from "../src/lib/flags.js";
import { createUser, grantRole, revokeRole } from "../src/lib/auth.js";
import { appendEvent, verifyChainInDb } from "../src/lib/eventlog.js";
import { passPipelineGate } from "../src/lib/gates.js";
import { setupActors, fileDR, ventureTo, type Actors } from "./helpers.js";
import { readFileSync, readdirSync } from "node:fs";
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

interface SignerSpec {
  capacity: (typeof KNOWN_CAPACITIES)[number];
  actorId: string;
  name: string;
}

/** A default 2-signer set with unique ids per run+tag. */
function defaultSigners(tag: string): SignerSpec[] {
  return [
    { capacity: "founding_signatory", actorId: `usr-${runId}-${tag}-fs`, name: `Founder ${tag}` },
    { capacity: "portfolio_review_lead", actorId: `usr-${runId}-${tag}-lead`, name: `Lead ${tag}` },
  ];
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
    thresholds: over.thresholds ?? [
      { id: "THR-CAPITAL", concept: "Capital base", deployment_value: "$100", unit: "USD", status: "resolved" },
    ],
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

/** Build a full pack document whose §B/§C tables are rendered from the manifest. */
function buildDoc(manifest: RatificationManifest, trailer = ""): string {
  return (
    `# Fixture Founding Ratification Pack\n\nProse.\n\n` +
    `${THRESHOLDS_START}\n${renderThresholdsTable(manifest)}\n${THRESHOLDS_END}\n\n` +
    `${ROLES_START}\n${renderRolesTable(manifest)}\n${ROLES_END}\n\n` +
    `${MANIFEST_START}\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n${MANIFEST_END}\n\nEnd.${trailer}\n`
  );
}

function buildReady(
  tag: string,
  over: Partial<RatificationManifest> & { packId?: string; trailer?: string } = {},
): { snapshot: RatificationPackSnapshot; signers: SignerSpec[]; bytes: string } {
  const signers = defaultSigners(tag);
  const manifest = buildManifest(signers, over);
  const bytes = buildDoc(manifest, over.trailer);
  const { snapshot, errors } = parseRatificationPackBytes(bytes);
  if (!snapshot) throw new Error(`fixture invalid: ${JSON.stringify(errors)}`);
  return { snapshot, signers, bytes };
}

// ---------------------------------------------------------------------------
// Pure — strict manifest validation, derived readiness, digest, rendering.
// ---------------------------------------------------------------------------

describe("manifest — strict structural validation", () => {
  it("a well-formed ready fixture parses", () => {
    const { snapshot } = buildReady("ok");
    expect(snapshot.ready).toBe(true);
    expect(snapshot.requiredSigners.length).toBe(2);
  });

  it("an absent manifest is rejected", () => {
    const { snapshot, errors } = parseRatificationPackBytes("# nothing\n");
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "missing")).toBe(true);
  });

  it("duplicated manifest markers are rejected", () => {
    const { bytes } = buildReady("dupm");
    const { snapshot, errors } = parseRatificationPackBytes(bytes + "\n" + MANIFEST_START + "\n" + MANIFEST_END + "\n");
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "duplicated")).toBe(true);
  });

  it("two JSON fences inside the markers are rejected as ambiguous", () => {
    const manifest = buildManifest(defaultSigners("twofence"));
    const bad =
      `${MANIFEST_START}\n\`\`\`json\n${JSON.stringify(manifest)}\n\`\`\`\n` +
      `\`\`\`json\n{}\n\`\`\`\n${MANIFEST_END}\n`;
    const { snapshot, errors } = parseRatificationPackBytes(bad);
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "ambiguous")).toBe(true);
  });

  it("invalid JSON is rejected", () => {
    const bad = `${MANIFEST_START}\n\`\`\`json\n{ nope, }\n\`\`\`\n${MANIFEST_END}\n`;
    const { snapshot, errors } = parseRatificationPackBytes(bad);
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "json")).toBe(true);
  });

  it("an unknown top-level property is rejected", () => {
    const m = { ...buildManifest(defaultSigners("extra")), sneaky: true } as unknown as RatificationManifest;
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "additionalProperties")).toBe(true);
  });

  it("an unknown property inside a threshold is rejected", () => {
    const m = buildManifest(defaultSigners("thx"), {
      thresholds: [{ id: "T", concept: "c", deployment_value: "1", unit: "USD", status: "resolved", extra: 1 } as never],
    });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "additionalProperties" && e.path.startsWith("thresholds"))).toBe(true);
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

  it("an invalid pack id is rejected", () => {
    const m = buildManifest(defaultSigners("pid"), { packId: "PACK-1" as string });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.path === "pack_id" && e.keyword === "format")).toBe(true);
  });

  it("an invalid version is rejected", () => {
    const m = buildManifest(defaultSigners("ver"), { version: "1.0" });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.path === "version")).toBe(true);
  });

  it("a duplicate threshold id is rejected", () => {
    const m = buildManifest(defaultSigners("dupt"), {
      thresholds: [
        { id: "T", concept: "a", deployment_value: "1", unit: "USD", status: "resolved" },
        { id: "T", concept: "b", deployment_value: "2", unit: "USD", status: "resolved" },
      ],
    });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "unique")).toBe(true);
  });

  it("an unknown capacity is rejected", () => {
    const m = buildManifest(defaultSigners("cap"));
    (m.role_assignments[0] as unknown as Record<string, unknown>).capacity = "emperor";
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "enum" && e.path.includes("capacity"))).toBe(true);
  });

  it("document_status incompatible with computed readiness is rejected", () => {
    // Declares ready but a threshold is unresolved → computed not ready.
    const m = buildManifest(defaultSigners("docstat"), {
      thresholds: [{ id: "T", concept: "c", deployment_value: "UNRESOLVED", unit: "USD", status: "unresolved" }],
    });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.keyword === "inconsistent")).toBe(true);
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

describe("readiness — derived, never self-declared", () => {
  it("declared-true booleans with an unresolved threshold → invalid (inconsistent)", () => {
    const m = buildManifest(defaultSigners("lie1"), {
      thresholds: [{ id: "T", concept: "c", deployment_value: "UNRESOLVED", unit: "USD", status: "unresolved" }],
      thresholds_resolved: true,
      ratification_ready: true,
      document_status: "ratification-ready",
    });
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.path === "thresholds_resolved" && e.keyword === "inconsistent")).toBe(true);
  });

  it("declared-true booleans with an unassigned role → invalid (inconsistent)", () => {
    const m = buildManifest(defaultSigners("lie2"));
    m.role_assignments[0].status = "unassigned";
    m.role_assignments[0].actor_id = "UNASSIGNED";
    m.role_assignments[0].name = "UNASSIGNED";
    const { snapshot, errors } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).toBeNull();
    expect(errors.some((e) => e.path === "roles_assigned" && e.keyword === "inconsistent")).toBe(true);
  });

  it.each(["UNRESOLVED", "TBD", "TODO", "UNKNOWN", "   ", ""])(
    "a placeholder deployment_value (%s) makes thresholds unresolved",
    (val) => {
      const m = buildManifest(defaultSigners("ph"), {
        thresholds: [{ id: "T", concept: "c", deployment_value: val, unit: "USD", status: "resolved" }],
      });
      expect(computeRatificationReadiness(m).thresholds_resolved).toBe(false);
    },
  );

  it("a repeated required-signer actor id makes roles unassigned (distinct-human policy)", () => {
    const dupe: SignerSpec = { capacity: "operator", actorId: "same", name: "Same" };
    const m = buildManifest([dupe, { ...dupe, capacity: "curator" }]);
    expect(computeRatificationReadiness(m).roles_assigned).toBe(false);
  });

  it("required signers are derived from role_assignments (required_signer=true only)", () => {
    const signers = defaultSigners("derive");
    const m = buildManifest(signers);
    m.role_assignments.push({ capacity: "curator", actor_id: "opt", name: "Optional", required_signer: false, status: "assigned" });
    const derived = deriveRequiredSigners(m);
    expect(derived.map((s) => s.actor_id)).not.toContain("opt");
    expect(derived.length).toBe(2);
  });

  it("a fully complete pack is ready", () => {
    const m = buildManifest(defaultSigners("full"));
    const r = computeRatificationReadiness(m);
    expect(r.thresholds_resolved && r.roles_assigned && r.ratification_ready).toBe(true);
  });

  it("a consistent proposed pack is valid but not ready", () => {
    const m = buildManifest(defaultSigners("prop"), {
      thresholds: [{ id: "T", concept: "c", deployment_value: "UNRESOLVED", unit: "USD", status: "unresolved" }],
      thresholds_resolved: false,
      roles_assigned: true,
      ratification_ready: false,
      document_status: "proposed",
    });
    const { snapshot } = parseRatificationPackBytes(buildDoc(m));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.ready).toBe(false);
  });
});

describe("digest + rendered tables", () => {
  it("the digest is lowercase 64-hex of the exact bytes and byte-sensitive", () => {
    const { bytes } = buildReady("dg");
    const d = digestPackBytes(bytes);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(digestPackBytes(bytes + " ")).not.toBe(d);
  });

  it("verifyRenderedTables passes when the tables are rendered from the manifest", () => {
    const { snapshot } = buildReady("vr");
    expect(verifyRenderedTables(snapshot)).toEqual([]);
  });

  it("a Markdown table edited away from the manifest is detected", () => {
    const { snapshot } = buildReady("drift");
    const corrupted = snapshot.bytes.replace("$100", "$999");
    const reparsed = parseRatificationPackBytes(corrupted).snapshot!;
    // Manifest still says $100 but the rendered table now says $999.
    expect(verifyRenderedTables(reparsed).length).toBeGreaterThan(0);
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
    // No `packOverride`/`bytes?`/`loader` parameter leaked into the public API.
    expect(flagsSrc).not.toMatch(/packOverride/);
    expect(flagsSrc).not.toMatch(/bytes\?\s*:/);
    expect(flagsSrc).toMatch(/export async function isRealMoneyEnabled/);
    // Only flags.ts (the wrapper) may import the injectable core.
    const offenders = readdirSync(libDir)
      .filter((f) => f.endsWith(".ts") && f !== "flags.ts" && f !== "ratification-core.ts")
      .filter((f) => /from\s+["'][^"']*ratification-core/.test(readFileSync(join(libDir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Database — signature protocol, grounding, flag, malformed events, concurrency.
// ---------------------------------------------------------------------------

async function provision(client: pg.Client, signers: SignerSpec[]): Promise<void> {
  for (const s of signers) {
    await createUser(client, { id: s.actorId, displayName: s.name });
    if (s.capacity === "portfolio_review_lead") await grantRole(client, { userId: s.actorId, role: "approver", grantedBy: "admin" });
    if (s.capacity === "operator") await grantRole(client, { userId: s.actorId, role: "operator", grantedBy: "admin" });
  }
}

async function sign(
  client: pg.Client,
  snapshot: RatificationPackSnapshot,
  s: SignerSpec,
  over: Partial<{ packId: string; expectedDigest: string; signerCapacity: string; acknowledgement: string }> = {},
): Promise<{ eventId: string; idempotent: boolean }> {
  return recordSignatureForSnapshot(client, snapshot, {
    packId: over.packId ?? snapshot.packId,
    expectedDigest: over.expectedDigest ?? snapshot.digest,
    signerActorId: s.actorId,
    signerCapacity: over.signerCapacity ?? s.capacity,
    acknowledgement: over.acknowledgement ?? ACK,
  });
}

async function countPackEvents(client: pg.Client, packId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE event_type = $1 AND object_id = $2",
    [RATIFICATION_EVENT_TYPE, packId],
  );
  return rows[0].n;
}

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

  it("a valid signature emits one human, self-signed, digest-bound, grounded event", async () => {
    const { snapshot, signers } = buildReady("one");
    await provision(client, signers);
    const r = await sign(client, snapshot, signers[0]);
    expect(r.idempotent).toBe(false);
    const { rows } = await client.query("SELECT actor_type, actor_id, object_type, payload FROM events WHERE id = $1", [r.eventId]);
    expect(rows[0].actor_type).toBe("human");
    expect(rows[0].actor_id).toBe(signers[0].actorId);
    expect(rows[0].object_type).toBe(RATIFICATION_OBJECT_TYPE);
    expect(rows[0].payload.pack_digest).toBe(snapshot.digest);
    expect(rows[0].payload.signer_capacity).toBe(signers[0].capacity);
    expect(rows[0].payload.acknowledgement_version).toBe("1.0.0");
  });

  it("all required signers signed → true", async () => {
    const { snapshot, signers } = buildReady("all");
    await provision(client, signers);
    for (const s of signers) await sign(client, snapshot, s);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
  });

  it("one required signer missing → false", async () => {
    const { snapshot, signers } = buildReady("miss");
    await provision(client, signers);
    await sign(client, snapshot, signers[0]);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
  });

  it("a non-required actor is rejected", async () => {
    const { snapshot } = buildReady("nonreq");
    await expect(
      sign(client, snapshot, { capacity: "operator", actorId: `intruder-${runId}`, name: "X" }),
    ).rejects.toThrow(/not a required signer/i);
  });

  it("wrong capacity, stale digest, wrong pack id, bad acknowledgement are each rejected", async () => {
    const { snapshot, signers } = buildReady("rej");
    await provision(client, signers);
    await expect(sign(client, snapshot, signers[0], { signerCapacity: "curator" })).rejects.toThrow(/capacity mismatch/i);
    await expect(sign(client, snapshot, signers[0], { expectedDigest: "0".repeat(64) })).rejects.toThrow(/stale pack digest/i);
    await expect(sign(client, snapshot, signers[0], { packId: "FRP-2026-999999" })).rejects.toThrow(/pack id mismatch/i);
    await expect(sign(client, snapshot, signers[0], { acknowledgement: "nope" })).rejects.toThrow(/acknowledgement does not match/i);
  });

  it("a not-ready pack cannot be signed", async () => {
    const { snapshot } = buildReady("nr", {
      thresholds: [{ id: "T", concept: "c", deployment_value: "UNRESOLVED", unit: "USD", status: "unresolved" }],
      thresholds_resolved: false,
      ratification_ready: false,
      document_status: "proposed",
    });
    const signers = defaultSigners("nr");
    await provision(client, signers);
    await expect(sign(client, snapshot, signers[0])).rejects.toThrow(RatificationPackInvalid);
  });

  it("a failed signature leaves no partial event", async () => {
    const { snapshot, signers } = buildReady("nopart");
    await provision(client, signers);
    const before = await countPackEvents(client, snapshot.packId);
    await expect(sign(client, snapshot, signers[0], { expectedDigest: "0".repeat(64) })).rejects.toThrow();
    expect(await countPackEvents(client, snapshot.packId)).toBe(before);
  });

  it("re-signing the same full evidence is idempotent — one event", async () => {
    const { snapshot, signers } = buildReady("idem");
    await provision(client, signers);
    const a = await sign(client, snapshot, signers[0]);
    const b = await sign(client, snapshot, signers[0]);
    expect(b.idempotent).toBe(true);
    expect(b.eventId).toBe(a.eventId);
    expect(await countPackEvents(client, snapshot.packId)).toBe(1);
  });

  it("editing a byte after signing drops the flag to false", async () => {
    const { snapshot, signers } = buildReady("byte");
    await provision(client, signers);
    for (const s of signers) await sign(client, snapshot, s);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    const edited = parseRatificationPackBytes(snapshot.bytes + " ").snapshot!;
    expect(edited.packId).toBe(snapshot.packId);
    expect(await evaluateRealMoneyForSnapshot(client, edited)).toBe(false);
  });

  it("adding a required signer holds the flag false until all sign the new bytes", async () => {
    const tag = "grow";
    const packId = nextPackId();
    const s1: SignerSpec = { capacity: "founding_signatory", actorId: `usr-${runId}-${tag}-1`, name: "One" };
    const s2: SignerSpec = { capacity: "operator", actorId: `usr-${runId}-${tag}-2`, name: "Two" };
    await provision(client, [s1, s2]);
    const small = parseRatificationPackBytes(buildDoc(buildManifest([s1], { packId }))).snapshot!;
    await sign(client, small, s1);
    expect(await evaluateRealMoneyForSnapshot(client, small)).toBe(true);
    const big = parseRatificationPackBytes(buildDoc(buildManifest([s1, s2], { packId }))).snapshot!;
    expect(await evaluateRealMoneyForSnapshot(client, big)).toBe(false);
    await sign(client, big, s1);
    expect(await evaluateRealMoneyForSnapshot(client, big)).toBe(false);
    await sign(client, big, s2);
    expect(await evaluateRealMoneyForSnapshot(client, big)).toBe(true);
  });
});

describe("signer grounding to registered users + roles (Postgres)", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("an unregistered signer is rejected", async () => {
    const { snapshot, signers } = buildReady("noduser"); // not provisioned
    await expect(sign(client, snapshot, signers[0])).rejects.toThrow(/not a registered user/i);
  });

  it("a name mismatch with the registered user is rejected", async () => {
    const { snapshot, signers } = buildReady("namebad");
    // signers[0] is a founding_signatory (no role needed); register it with the WRONG name.
    await createUser(client, { id: signers[0].actorId, displayName: "Different Name" });
    await expect(sign(client, snapshot, signers[0])).rejects.toThrow(/name mismatch/i);
  });

  it("a portfolio_review_lead without the approver role is rejected", async () => {
    const { snapshot, signers } = buildReady("noappr");
    // Register the lead as a user but DO NOT grant approver.
    await createUser(client, { id: signers[1].actorId, displayName: signers[1].name });
    await expect(sign(client, snapshot, signers[1])).rejects.toThrow(/lacks the active 'approver' role/i);
  });

  it("an operator without the operator role is rejected", async () => {
    const tag = "noop";
    const op: SignerSpec = { capacity: "operator", actorId: `usr-${runId}-${tag}`, name: "Op" };
    const snapshot = parseRatificationPackBytes(buildDoc(buildManifest([op]))).snapshot!;
    await createUser(client, { id: op.actorId, displayName: op.name });
    await expect(sign(client, snapshot, op)).rejects.toThrow(/lacks the active 'operator' role/i);
  });

  it("revoking a role after signing drops the flag to false", async () => {
    const { snapshot, signers } = buildReady("revoke");
    await provision(client, signers);
    for (const s of signers) await sign(client, snapshot, s);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    // Revoke the lead's approver role — grounding now fails at evaluation.
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

  it("forged human events with wrong evidence are ignored, and the valid signature still counts", async () => {
    const tag = "forge";
    const signer: SignerSpec = { capacity: "founding_signatory", actorId: `usr-${runId}-${tag}`, name: "Solo" };
    const snapshot = parseRatificationPackBytes(buildDoc(buildManifest([signer]))).snapshot!;
    await createUser(client, { id: signer.actorId, displayName: signer.name });

    const base = {
      actor_type: "human" as const,
      actor_id: signer.actorId,
      event_type: RATIFICATION_EVENT_TYPE,
      object_type: RATIFICATION_OBJECT_TYPE,
      object_id: snapshot.packId,
    };
    const goodPayload = {
      pack_digest: snapshot.digest,
      pack_version: snapshot.version,
      signer_actor_id: signer.actorId,
      signer_capacity: signer.capacity,
      acknowledgement_version: "1.0.0",
    };
    // Six malformed variants — each must fail validateRatificationSignatureEvent.
    const variants: Array<Record<string, unknown>> = [
      { ...goodPayload, signer_actor_id: "someone-else" },
      { ...goodPayload, acknowledgement_version: "9.9.9" },
      { ...goodPayload, pack_version: "0.0.1" },
      { ...goodPayload, signer_capacity: "operator" },
      null as unknown as Record<string, unknown>,
      { ...goodPayload, pack_digest: 12345 },
    ];
    let n = 0;
    for (const payload of variants) {
      await appendEvent(client, { ...base, id: `EV-forge-${runId}-${n++}`, timestamp: new Date().toISOString(), payload });
    }
    // None of the forged events satisfies the flag.
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
    for (const payload of variants) {
      expect(validateRatificationSignatureEvent({ ...base, payload }, snapshot.requiredSigners[0], snapshot)).toBe(false);
    }
    // The real signature still records and flips the flag — forgery did not block it.
    const r = await sign(client, snapshot, signer);
    expect(r.idempotent).toBe(false);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
  });

  it("an agent-actor event with a correct-looking payload is ignored", async () => {
    const tag = "agent";
    const signer: SignerSpec = { capacity: "founding_signatory", actorId: `usr-${runId}-${tag}`, name: "AgentGhost" };
    const snapshot = parseRatificationPackBytes(buildDoc(buildManifest([signer]))).snapshot!;
    await createUser(client, { id: signer.actorId, displayName: signer.name });
    await appendEvent(client, {
      id: `EV-agent-${runId}`,
      timestamp: new Date().toISOString(),
      actor_type: "agent",
      actor_id: signer.actorId,
      event_type: RATIFICATION_EVENT_TYPE,
      object_type: RATIFICATION_OBJECT_TYPE,
      object_id: snapshot.packId,
      payload: {
        pack_digest: snapshot.digest,
        pack_version: snapshot.version,
        signer_actor_id: signer.actorId,
        signer_capacity: signer.capacity,
        acknowledgement_version: "1.0.0",
      },
    });
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(false);
    await sign(client, snapshot, signer);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
  });
});

describe("concurrency (Postgres)", () => {
  let a: pg.Client;
  let b: pg.Client;
  beforeAll(async () => {
    a = new pg.Client({ connectionString: DATABASE_URL });
    b = new pg.Client({ connectionString: DATABASE_URL });
    await a.connect();
    await b.connect();
  });
  afterAll(async () => {
    if (a) await a.end();
    if (b) await b.end();
  });

  it("two concurrent signatures by the same signer collapse to one event", async () => {
    const { snapshot, signers } = buildReady("cc-same");
    await provision(a, signers);
    const [r1, r2] = await Promise.all([sign(a, snapshot, signers[0]), sign(b, snapshot, signers[0])]);
    expect(r1.eventId).toBe(r2.eventId);
    expect(await countPackEvents(a, snapshot.packId)).toBe(1);
  });

  it("concurrent signatures by different signers both land; the chain stays intact", async () => {
    const { snapshot, signers } = buildReady("cc-diff");
    await provision(a, signers);
    await Promise.all([sign(a, snapshot, signers[0]), sign(b, snapshot, signers[1])]);
    expect(await countPackEvents(a, snapshot.packId)).toBe(2);
    expect(await evaluateRealMoneyForSnapshot(a, snapshot)).toBe(true);
    expect((await verifyChainInDb(a)).ok).toBe(true);
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
    await provision(client, signers);
    for (const s of signers) await sign(client, snapshot, s);
    const before = await countPackEvents(client, snapshot.packId);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    expect(await evaluateRealMoneyForSnapshot(client, snapshot)).toBe(true);
    expect(await countPackEvents(client, snapshot.packId)).toBe(before);
  });

  it("even with real_money true, a spend request is still rejected (ADR-006 unchanged)", async () => {
    const { snapshot, signers } = buildReady("spend");
    await provision(client, signers);
    for (const s of signers) await sign(client, snapshot, s);
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
