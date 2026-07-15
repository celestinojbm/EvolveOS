/**
 * Founding Ratification Pack + derived `real_money` flag (issue #11, P0-10).
 *
 * Covers: pack validation (structure + readiness), the exact-byte digest,
 * fresh-state safety (a fresh DB is always false), the human-only signature
 * protocol (binding, idempotence, rejection of every non-conforming signature),
 * the purely-derived flag, concurrency, and the hard limit that a `true` flag
 * still moves no money (ADR-006 spend rejection is unchanged).
 *
 * The productive path always reads docs/RATIFICATION_PACK.md; these tests inject
 * a ratification-ready FIXTURE pack (unique pack id + test actors) via the
 * TEST-ONLY `packOverride` argument. That injection is not a production bypass:
 * the flag still requires real signature events in the append-only log bound to
 * the fixture's exact-byte digest.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  digestPackBytes,
  readRatificationPack,
  packReadinessReasons,
  recordRatificationSignature,
  isRealMoneyEnabled,
  snapshotRatificationPack,
  RatificationPackInvalid,
  RATIFICATION_EVENT_TYPE,
  RATIFICATION_OBJECT_TYPE,
  RATIFICATION_PACK_PATH,
} from "../src/lib/flags.js";
import { appendEvent, verifyChainInDb } from "../src/lib/eventlog.js";
import { passPipelineGate } from "../src/lib/gates.js";
import { setupActors, fileDR, ventureTo, type Actors } from "./helpers.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());

const DEFAULT_ACK =
  "I have read this fixture pack in full and I ratify it, as my own act and by my own hand; I acknowledge that altering any byte invalidates every prior signature.";

interface FixtureSigner {
  actor_id: string;
  name: string;
  capacity: string;
}

function manifestBlock(json: string): string {
  return `<!-- RATIFICATION_MANIFEST_START -->\n\`\`\`json\n${json}\n\`\`\`\n<!-- RATIFICATION_MANIFEST_END -->`;
}

function docShell(inner: string, trailer = ""): string {
  return (
    `# Test Founding Ratification Pack (fixture)\n\n` +
    `Prose body. Thresholds and roles are resolved for this fixture.\n\n` +
    `${inner}\n\nEnd of fixture.${trailer}\n`
  );
}

/** A ratification-ready fixture, unique per run+tag so signatures never collide. */
function buildReady(
  tag: string,
  over: {
    version?: string;
    signers?: FixtureSigner[];
    acknowledgement?: string;
    acknowledgement_version?: string;
    manifestOver?: Record<string, unknown>;
    trailer?: string;
  } = {},
): { packId: string; bytes: string; digest: string; signers: FixtureSigner[]; ack: string } {
  const packId = `TEST-FRP-${runId}-${tag}`;
  const signers =
    over.signers ??
    [
      { actor_id: `founder-${runId}-${tag}`, name: "Test Founder", capacity: "founding_signatory" },
      { actor_id: `lead-${runId}-${tag}`, name: "Test Review Lead", capacity: "portfolio_review_lead" },
    ];
  const ack = over.acknowledgement ?? DEFAULT_ACK;
  const manifest = {
    pack_id: packId,
    version: over.version ?? "1.0.0",
    proposed_date: "2026-07-15",
    document_status: "ratification-ready",
    acknowledgement_version: over.acknowledgement_version ?? "1.0.0",
    acknowledgement: ack,
    ratification_ready: true,
    thresholds_resolved: true,
    roles_assigned: true,
    required_signers: signers,
    ...over.manifestOver,
  };
  const bytes = docShell(manifestBlock(JSON.stringify(manifest, null, 2)), over.trailer);
  return { packId, bytes, digest: digestPackBytes(bytes), signers, ack };
}

// ---------------------------------------------------------------------------
// Pure tests — pack validation, readiness, digest. No database.
// ---------------------------------------------------------------------------

describe("ratification pack — structural validation", () => {
  it("a ratification-ready fixture is structurally valid", () => {
    const { bytes, packId } = buildReady("valid");
    const { snapshot, errors } = readRatificationPack({ bytes });
    expect(errors).toEqual([]);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.packId).toBe(packId);
    expect(packReadinessReasons(snapshot!.manifest)).toEqual([]);
  });

  it("an absent manifest is rejected", () => {
    const { snapshot, errors } = readRatificationPack({ bytes: "# No manifest here\n" });
    expect(snapshot).toBeNull();
    expect(errors.join(" ")).toMatch(/manifest missing/i);
  });

  it("a duplicated manifest is rejected", () => {
    // Two START/END marker pairs in one document — ambiguous source of truth.
    const { bytes } = buildReady("dup");
    const secondBlock = manifestBlock(readyManifestJson("dup-second"));
    const doubled = bytes + "\n" + secondBlock + "\n";
    const { snapshot, errors } = readRatificationPack({ bytes: doubled });
    expect(snapshot).toBeNull();
    expect(errors.join(" ")).toMatch(/duplicated/i);
  });

  it("a manifest with invalid JSON is rejected", () => {
    const bytes = docShell(manifestBlock("{ not: valid json, }"));
    const { snapshot, errors } = readRatificationPack({ bytes });
    expect(snapshot).toBeNull();
    expect(errors.join(" ")).toMatch(/does not parse/i);
  });

  it("an empty pack id is rejected", () => {
    const bytes = docShell(
      manifestBlock(JSON.stringify({ ...JSON.parse(readyManifestJson("empty-id")), pack_id: "" })),
    );
    const { snapshot, errors } = readRatificationPack({ bytes });
    expect(snapshot).toBeNull();
    expect(errors.join(" ")).toMatch(/pack_id/i);
  });

  it("an empty version is rejected", () => {
    const bytes = docShell(
      manifestBlock(JSON.stringify({ ...JSON.parse(readyManifestJson("empty-ver")), version: "" })),
    );
    const { snapshot, errors } = readRatificationPack({ bytes });
    expect(snapshot).toBeNull();
    expect(errors.join(" ")).toMatch(/version/i);
  });

  it("an empty required_signers array is rejected", () => {
    const bytes = docShell(
      manifestBlock(
        JSON.stringify({ ...JSON.parse(readyManifestJson("empty-signers")), required_signers: [] }),
      ),
    );
    const { snapshot, errors } = readRatificationPack({ bytes });
    expect(snapshot).toBeNull();
    expect(errors.join(" ")).toMatch(/required_signers/i);
  });

  it("a duplicate signer (same capacity + actor_id) is rejected", () => {
    const dup = { actor_id: "x", name: "X", capacity: "operator" };
    const { bytes } = buildReady("dupsigner", { signers: [dup, { ...dup }] });
    const { snapshot, errors } = readRatificationPack({ bytes });
    expect(snapshot).toBeNull();
    expect(errors.join(" ")).toMatch(/duplicate/i);
  });

  it("an unknown capacity is rejected", () => {
    const { bytes } = buildReady("badcap", {
      signers: [{ actor_id: "x", name: "X", capacity: "emperor" }],
    });
    const { snapshot, errors } = readRatificationPack({ bytes });
    expect(snapshot).toBeNull();
    expect(errors.join(" ")).toMatch(/not a known capacity/i);
  });

  it("byte changes change the digest", () => {
    const a = buildReady("digest-a");
    const b = buildReady("digest-a", { trailer: " one more byte" });
    expect(a.digest).not.toBe(b.digest);
    // A pure re-read of the same bytes is stable.
    expect(digestPackBytes(a.bytes)).toBe(a.digest);
  });

  it("the digest is lowercase 64-hex of the exact UTF-8 bytes", () => {
    const { bytes, digest } = buildReady("hex");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digestPackBytes(bytes)).toBe(digest);
  });
});

/** JSON string of a ready manifest, for tests that then mutate one field. */
function readyManifestJson(tag: string): string {
  const { bytes } = buildReady(tag);
  const m = bytes.match(/```json\n([\s\S]*?)\n```/);
  return m![1];
}

describe("ratification pack — readiness (structurally valid but not ready)", () => {
  it("an UNASSIGNED signer is not ratification-ready", () => {
    const { bytes } = buildReady("unassigned", {
      signers: [{ actor_id: "UNASSIGNED", name: "UNASSIGNED", capacity: "founding_signatory" }],
    });
    const { snapshot, errors } = readRatificationPack({ bytes });
    expect(errors).toEqual([]);
    expect(packReadinessReasons(snapshot!.manifest).join(" ")).toMatch(/UNASSIGNED/);
  });

  it("thresholds_resolved:false is not ratification-ready", () => {
    const { bytes } = buildReady("thr", { manifestOver: { thresholds_resolved: false } });
    const { snapshot } = readRatificationPack({ bytes });
    expect(packReadinessReasons(snapshot!.manifest).join(" ")).toMatch(/thresholds_resolved/);
  });

  it("roles_assigned:false is not ratification-ready", () => {
    const { bytes } = buildReady("roles", { manifestOver: { roles_assigned: false } });
    const { snapshot } = readRatificationPack({ bytes });
    expect(packReadinessReasons(snapshot!.manifest).join(" ")).toMatch(/roles_assigned/);
  });

  it("ratification_ready:false is not ready even with resolved thresholds/roles", () => {
    const { bytes } = buildReady("notready", { manifestOver: { ratification_ready: false } });
    const { snapshot } = readRatificationPack({ bytes });
    expect(packReadinessReasons(snapshot!.manifest).join(" ")).toMatch(/ratification_ready/);
  });

  it("the productive docs/RATIFICATION_PACK.md is structurally valid but NOT ready", () => {
    const { snapshot, errors } = readRatificationPack(); // reads the real file
    expect(errors).toEqual([]);
    expect(snapshot).not.toBeNull();
    // Its thresholds are UNRESOLVED and its signers are UNASSIGNED by design.
    expect(packReadinessReasons(snapshot!.manifest).length).toBeGreaterThan(0);
    expect(snapshot!.packId).toBe("FRP-2026-001");
  });

  it("snapshotRatificationPack throws RatificationPackInvalid on a malformed pack", () => {
    expect(() => snapshotRatificationPack({ bytes: "# no manifest\n" })).toThrow(
      RatificationPackInvalid,
    );
  });

  it("RATIFICATION_PACK_PATH points at docs/RATIFICATION_PACK.md", () => {
    expect(RATIFICATION_PACK_PATH).toMatch(/docs\/RATIFICATION_PACK\.md$/);
  });
});

// ---------------------------------------------------------------------------
// Database tests — fresh state, signatures, the derived flag, concurrency.
// ---------------------------------------------------------------------------

async function countPackEvents(client: pg.Client, packId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE event_type = $1 AND object_id = $2",
    [RATIFICATION_EVENT_TYPE, packId],
  );
  return rows[0].n;
}

async function sign(
  client: pg.Client,
  pack: { packId: string; bytes: string; digest: string; ack: string },
  signer: FixtureSigner,
  over?: Partial<{ packId: string; expectedDigest: string; signerCapacity: string; acknowledgement: string }>,
): Promise<{ eventId: string; idempotent: boolean }> {
  return recordRatificationSignature(
    client,
    {
      packId: over?.packId ?? pack.packId,
      expectedDigest: over?.expectedDigest ?? pack.digest,
      signerActorId: signer.actor_id,
      signerCapacity: over?.signerCapacity ?? signer.capacity,
      acknowledgement: over?.acknowledgement ?? pack.ack,
    },
    { bytes: pack.bytes },
  );
}

describe("real_money flag — fresh state and the derived evaluation (Postgres)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("a fresh DB (productive pack, no signatures) → real_money is false", async () => {
    expect(await isRealMoneyEnabled(client)).toBe(false);
  });

  it("a ratification-ready fixture with zero signatures → false", async () => {
    const p = buildReady("zero");
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(false);
  });

  it("a valid signature emits exactly one human, self-signed, digest-bound event", async () => {
    const p = buildReady("one");
    const before = await countPackEvents(client, p.packId);
    const r = await sign(client, p, p.signers[0]);
    expect(r.idempotent).toBe(false);
    expect(await countPackEvents(client, p.packId)).toBe(before + 1);

    const { rows } = await client.query(
      "SELECT actor_type, actor_id, object_type, payload FROM events WHERE id = $1",
      [r.eventId],
    );
    const ev = rows[0];
    expect(ev.actor_type).toBe("human");
    expect(ev.actor_id).toBe(p.signers[0].actor_id);
    expect(ev.object_type).toBe(RATIFICATION_OBJECT_TYPE);
    expect(ev.payload.pack_digest).toBe(p.digest);
    expect(ev.payload.pack_version).toBe("1.0.0");
    expect(ev.payload.signer_actor_id).toBe(p.signers[0].actor_id);
    expect(ev.payload.signer_capacity).toBe(p.signers[0].capacity);
    expect(ev.payload.acknowledgement_version).toBe("1.0.0");
  });

  it("all required signers signed the current bytes → true", async () => {
    const p = buildReady("all");
    for (const s of p.signers) await sign(client, p, s);
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(true);
  });

  it("with one required signer missing → false", async () => {
    const p = buildReady("missing");
    await sign(client, p, p.signers[0]); // only the first signs
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(false);
  });

  it("a signature by a non-required actor is rejected", async () => {
    const p = buildReady("nonreq");
    await expect(
      sign(client, p, { actor_id: `intruder-${runId}`, name: "Intruder", capacity: "operator" }),
    ).rejects.toThrow(/not a required signer/i);
  });

  it("a signature with the wrong capacity is rejected", async () => {
    const p = buildReady("wrongcap");
    await expect(
      sign(client, p, p.signers[0], { signerCapacity: "curator" }),
    ).rejects.toThrow(/capacity mismatch/i);
  });

  it("a signature against a stale digest is rejected", async () => {
    const p = buildReady("stale");
    await expect(
      sign(client, p, p.signers[0], { expectedDigest: "0".repeat(64) }),
    ).rejects.toThrow(/stale pack digest/i);
  });

  it("a signature with the wrong pack id is rejected", async () => {
    const p = buildReady("wrongid");
    await expect(
      sign(client, p, p.signers[0], { packId: "SOME-OTHER-PACK" }),
    ).rejects.toThrow(/pack id mismatch/i);
  });

  it("a signature with a mismatched acknowledgement is rejected", async () => {
    const p = buildReady("wrongack");
    await expect(
      sign(client, p, p.signers[0], { acknowledgement: "I agree, whatever." }),
    ).rejects.toThrow(/acknowledgement does not match/i);
  });

  it("a non-ready pack cannot be signed", async () => {
    const p = buildReady("nonready-sign", { manifestOver: { ratification_ready: false } });
    await expect(sign(client, p, p.signers[0])).rejects.toThrow(RatificationPackInvalid);
  });

  it("a failed signature leaves no partial event", async () => {
    const p = buildReady("nopartial");
    const before = await countPackEvents(client, p.packId);
    await expect(sign(client, p, p.signers[0], { expectedDigest: "0".repeat(64) })).rejects.toThrow();
    expect(await countPackEvents(client, p.packId)).toBe(before);
  });
});

describe("real_money flag — signature binding and idempotence (Postgres)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("re-signing the same (signer, capacity, digest) is idempotent — one event", async () => {
    const p = buildReady("idem");
    const first = await sign(client, p, p.signers[0]);
    const second = await sign(client, p, p.signers[0]);
    expect(second.idempotent).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(await countPackEvents(client, p.packId)).toBe(1);
  });

  it("editing a byte after signing drops the flag back to false", async () => {
    const p = buildReady("bytechange");
    for (const s of p.signers) await sign(client, p, s);
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(true);
    // A single trailing byte changes the digest; prior signatures no longer count.
    const edited = p.bytes + " ";
    expect(await isRealMoneyEnabled(client, { bytes: edited })).toBe(false);
  });

  it("a signature for an older digest never counts for a newer version", async () => {
    const tag = "reversion";
    const packId = `TEST-FRP-${runId}-${tag}`;
    const signers = [
      { actor_id: `f-${runId}-${tag}`, name: "F", capacity: "founding_signatory" },
    ];
    const v1 = buildReadyExplicit(packId, signers, "1.0.0");
    const v2 = buildReadyExplicit(packId, signers, "2.0.0");
    await sign(client, v1, signers[0]); // signs v1 bytes/digest/version
    // v2 has a different digest AND version; the v1 signature does not satisfy it.
    expect(await isRealMoneyEnabled(client, { bytes: v2.bytes })).toBe(false);
    // v1 itself is still fully satisfied.
    expect(await isRealMoneyEnabled(client, { bytes: v1.bytes })).toBe(true);
  });

  it("adding a required signer holds the flag false until all sign the new bytes", async () => {
    const tag = "grow";
    const packId = `TEST-FRP-${runId}-${tag}`;
    const s1 = { actor_id: `a-${runId}-${tag}`, name: "A", capacity: "founding_signatory" };
    const s2 = { actor_id: `b-${runId}-${tag}`, name: "B", capacity: "operator" };
    const small = buildReadyExplicit(packId, [s1], "1.0.0");
    await sign(client, small, s1);
    expect(await isRealMoneyEnabled(client, { bytes: small.bytes })).toBe(true);

    const big = buildReadyExplicit(packId, [s1, s2], "1.0.0");
    // New bytes → new digest; the flag is false until every signer signs them.
    expect(await isRealMoneyEnabled(client, { bytes: big.bytes })).toBe(false);
    await sign(client, big, s1);
    expect(await isRealMoneyEnabled(client, { bytes: big.bytes })).toBe(false);
    await sign(client, big, s2);
    expect(await isRealMoneyEnabled(client, { bytes: big.bytes })).toBe(true);
  });

  it("an agent event with a correct-looking payload does not count as a signature", async () => {
    // A single-signer fixture, so one legitimate signature would flip it true.
    const tag = "agentghost";
    const packId = `TEST-FRP-${runId}-${tag}`;
    const signer = { actor_id: `h-${runId}-${tag}`, name: "H", capacity: "founding_signatory" };
    const p = buildReadyExplicit(packId, [signer], "1.0.0");

    // Forge a well-formed AGENT event (through the legitimate single writer) whose
    // payload mimics a signature. The flag counts only human, self-signed events,
    // so this must be ignored and the flag stays false.
    await appendEvent(client, {
      id: `EV-agentghost-${runId}`,
      timestamp: new Date().toISOString(),
      actor_type: "agent",
      actor_id: signer.actor_id,
      event_type: RATIFICATION_EVENT_TYPE,
      object_type: RATIFICATION_OBJECT_TYPE,
      object_id: packId,
      payload: {
        pack_digest: p.digest,
        pack_version: "1.0.0",
        signer_actor_id: signer.actor_id,
        signer_capacity: signer.capacity,
        acknowledgement_version: "1.0.0",
      },
    });
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(false);

    // The real human signature does flip it true — proving the fixture is otherwise ready.
    await sign(client, p, signer);
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(true);
  });
});

/** Explicit-id fixture (shared pack id across versions/signer-sets). */
function buildReadyExplicit(
  packId: string,
  signers: FixtureSigner[],
  version: string,
): { packId: string; bytes: string; digest: string; ack: string; signers: FixtureSigner[] } {
  const manifest = {
    pack_id: packId,
    version,
    proposed_date: "2026-07-15",
    document_status: "ratification-ready",
    acknowledgement_version: "1.0.0",
    acknowledgement: DEFAULT_ACK,
    ratification_ready: true,
    thresholds_resolved: true,
    roles_assigned: true,
    required_signers: signers,
  };
  const bytes = docShell(manifestBlock(JSON.stringify(manifest, null, 2)), ` v=${version}`);
  return { packId, bytes, digest: digestPackBytes(bytes), ack: DEFAULT_ACK, signers };
}

describe("real_money flag — concurrency (Postgres)", () => {
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
    const p = buildReady("concurrent-same");
    const [r1, r2] = await Promise.all([sign(a, p, p.signers[0]), sign(b, p, p.signers[0])]);
    expect(r1.eventId).toBe(r2.eventId);
    expect(await countPackEvents(a, p.packId)).toBe(1);
  });

  it("concurrent signatures by different signers are both valid; the chain stays intact", async () => {
    const p = buildReady("concurrent-diff");
    await Promise.all([sign(a, p, p.signers[0]), sign(b, p, p.signers[1])]);
    expect(await countPackEvents(a, p.packId)).toBe(2);
    expect(await isRealMoneyEnabled(a, { bytes: p.bytes })).toBe(true);
    expect((await verifyChainInDb(a)).ok).toBe(true);
  });
});

describe("real_money flag — hard limit: true executes no money (Postgres)", () => {
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

  it("evaluating the flag performs no writes (pure read)", async () => {
    const p = buildReady("pure");
    for (const s of p.signers) await sign(client, p, s);
    const before = await countPackEvents(client, p.packId);
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(true);
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(true);
    expect(await countPackEvents(client, p.packId)).toBe(before); // no new events
  });

  it("even with real_money true, a spend request is still rejected (ADR-006 unchanged)", async () => {
    const p = buildReady("spend");
    for (const s of p.signers) await sign(client, p, s);
    expect(await isRealMoneyEnabled(client, { bytes: p.bytes })).toBe(true);

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
