/**
 * EvolveOS founding ratification + the derived `real_money` feature flag
 * (issue #11, P0-10). Per ADR-006, every spec dollar threshold is unratified
 * until the Founding Ratification Pack is SIGNED by every required human
 * signer. This module is the single owner of that evaluation:
 *
 *   - It reads the EXACT bytes of docs/RATIFICATION_PACK.md and hashes them
 *     (SHA-256 of the exact UTF-8 bytes — NOT the JSON canonicalization used for
 *     Decision Records). Any byte change — a threshold, a name, the non-scope,
 *     the manifest — changes the digest and invalidates every prior signature.
 *   - A signature is a single, self-signed, append-only human event bound to
 *     that digest + version. No delegated / automated / agent / env-var / seed /
 *     config-flag signature is ever valid.
 *   - `isRealMoneyEnabled` is PURELY DERIVED: it returns true only when the pack
 *     is ratification-ready AND every required signer has a valid signature
 *     event for the CURRENT digest/version/capacity. There is no mutable column,
 *     no environment override, no default-true, no admin bypass. A fresh DB
 *     always returns false.
 *
 * `real_money = true` records that ratification happened; it MOVES NO MONEY and
 * executes no spend (THR-SPEND-EXEC = $0; ADR-006/007; the gate system rejects
 * any requestedSpend != 0). ops/check-ratification-writer.mjs enforces the
 * single-writer discipline in CI.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { appendEventTx, acquireEventChainLock } from "./eventlog.js";

type Queryable = Client | PoolClient;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The productive pack — the ONLY document the productive path reads. */
export const RATIFICATION_PACK_PATH = join(REPO_ROOT, "docs", "RATIFICATION_PACK.md");
export const RATIFICATION_EVENT_TYPE = "ratification.signature_recorded";
export const RATIFICATION_OBJECT_TYPE = "founding-ratification-pack";

/** Capacities a required signer may hold. Anything else is a malformed pack. */
export const KNOWN_CAPACITIES: readonly string[] = Object.freeze([
  "founding_signatory",
  "portfolio_review_lead",
  "operator",
  "curator",
]);
const PLACEHOLDER = "UNASSIGNED";

const MANIFEST_START = "<!-- RATIFICATION_MANIFEST_START -->";
const MANIFEST_END = "<!-- RATIFICATION_MANIFEST_END -->";

export interface RequiredSigner {
  actor_id: string;
  name: string;
  capacity: string;
}

export interface RatificationManifest {
  pack_id: string;
  version: string;
  acknowledgement: string;
  acknowledgement_version: string;
  ratification_ready: boolean;
  thresholds_resolved: boolean;
  roles_assigned: boolean;
  required_signers: RequiredSigner[];
}

export interface RatificationPackSnapshot {
  /** The exact document text (source of the digest). */
  bytes: string;
  /** SHA-256 lowercase hex of the exact UTF-8 bytes of the document. */
  digest: string;
  manifest: RatificationManifest;
  packId: string;
  version: string;
}

export interface RatificationPackResult {
  snapshot: RatificationPackSnapshot | null;
  /** Structural errors (malformed document/manifest). Empty when structurally valid. */
  errors: string[];
}

/** Thrown by the signature protocol when the pack is malformed or not ready. */
export class RatificationPackInvalid extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`ratification pack is not signable: ${errors.join("; ")}`);
    this.name = "RatificationPackInvalid";
    this.errors = errors;
  }
}

// --- digest (exact bytes, NOT DR canonicalization) ---------------------------

/** SHA-256 (lowercase hex) of the exact UTF-8 bytes of the document. */
export function digestPackBytes(bytes: string): string {
  return createHash("sha256").update(Buffer.from(bytes, "utf8")).digest("hex");
}

// --- manifest extraction + structural validation -----------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function extractManifestJson(bytes: string, errors: string[]): unknown | null {
  const starts = bytes.split(MANIFEST_START).length - 1;
  const ends = bytes.split(MANIFEST_END).length - 1;
  if (starts === 0) {
    errors.push("manifest missing (no RATIFICATION_MANIFEST_START marker)");
    return null;
  }
  if (starts > 1 || ends > 1) {
    errors.push("manifest duplicated (RATIFICATION_MANIFEST markers must appear exactly once)");
    return null;
  }
  if (ends === 0) {
    errors.push("manifest not terminated (no RATIFICATION_MANIFEST_END marker)");
    return null;
  }
  const between = bytes.slice(
    bytes.indexOf(MANIFEST_START) + MANIFEST_START.length,
    bytes.indexOf(MANIFEST_END),
  );
  const fence = between.match(/```json\s*([\s\S]*?)```/);
  if (!fence) {
    errors.push("manifest has no ```json fenced block");
    return null;
  }
  try {
    return JSON.parse(fence[1]);
  } catch (e) {
    errors.push(`manifest JSON does not parse: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function validateManifestShape(raw: unknown, errors: string[]): RatificationManifest | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("manifest is not a JSON object");
    return null;
  }
  const m = raw as Record<string, unknown>;
  if (!isNonEmptyString(m.pack_id) || m.pack_id === PLACEHOLDER) {
    errors.push("manifest.pack_id must be a non-empty, non-placeholder string");
  }
  if (!isNonEmptyString(m.version)) errors.push("manifest.version must be a non-empty string");
  if (!isNonEmptyString(m.acknowledgement)) {
    errors.push("manifest.acknowledgement must be a non-empty string");
  }
  if (!isNonEmptyString(m.acknowledgement_version)) {
    errors.push("manifest.acknowledgement_version must be a non-empty string");
  }
  if (typeof m.ratification_ready !== "boolean") {
    errors.push("manifest.ratification_ready must be a boolean");
  }
  if (typeof m.thresholds_resolved !== "boolean") {
    errors.push("manifest.thresholds_resolved must be a boolean");
  }
  if (typeof m.roles_assigned !== "boolean") {
    errors.push("manifest.roles_assigned must be a boolean");
  }
  if (!Array.isArray(m.required_signers) || m.required_signers.length === 0) {
    errors.push("manifest.required_signers must be a non-empty array");
  } else {
    const seen = new Set<string>();
    m.required_signers.forEach((s, i) => {
      if (s === null || typeof s !== "object" || Array.isArray(s)) {
        errors.push(`required_signers[${i}] is not an object`);
        return;
      }
      const sig = s as Record<string, unknown>;
      if (!isNonEmptyString(sig.actor_id)) errors.push(`required_signers[${i}].actor_id must be a non-empty string`);
      if (!isNonEmptyString(sig.name)) errors.push(`required_signers[${i}].name must be a non-empty string`);
      if (!isNonEmptyString(sig.capacity)) {
        errors.push(`required_signers[${i}].capacity must be a non-empty string`);
      } else if (!KNOWN_CAPACITIES.includes(sig.capacity)) {
        errors.push(`required_signers[${i}].capacity '${sig.capacity}' is not a known capacity`);
      }
      // Duplicate = same (capacity, actor_id) pair listed twice.
      const key = `${String(sig.capacity)} ${String(sig.actor_id)}`;
      if (seen.has(key)) errors.push(`required_signers[${i}] is a duplicate (${String(sig.capacity)}/${String(sig.actor_id)})`);
      seen.add(key);
    });
  }
  return errors.length ? null : (m as unknown as RatificationManifest);
}

/**
 * Read + structurally validate the pack. `input.bytes` injects a document for
 * tests; the productive path (no argument) reads docs/RATIFICATION_PACK.md.
 * Never throws for malformed input — returns `{ snapshot: null, errors }` — so
 * `isRealMoneyEnabled` can fail closed. Structural validity does NOT imply
 * ratification-readiness (see `packReadinessReasons`).
 */
export function readRatificationPack(input?: { bytes?: string }): RatificationPackResult {
  const errors: string[] = [];
  let bytes: string;
  try {
    bytes = input?.bytes ?? readFileSync(RATIFICATION_PACK_PATH, "utf8");
  } catch (e) {
    return { snapshot: null, errors: [`cannot read ratification pack: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const rawManifest = extractManifestJson(bytes, errors);
  if (rawManifest === null) return { snapshot: null, errors };
  const manifest = validateManifestShape(rawManifest, errors);
  if (manifest === null) return { snapshot: null, errors };
  return {
    snapshot: { bytes, digest: digestPackBytes(bytes), manifest, packId: manifest.pack_id, version: manifest.version },
    errors: [],
  };
}

/** Snapshot or throw `RatificationPackInvalid` (convenience for the writer path). */
export function snapshotRatificationPack(input?: { bytes?: string }): RatificationPackSnapshot {
  const { snapshot, errors } = readRatificationPack(input);
  if (!snapshot) throw new RatificationPackInvalid(errors);
  return snapshot;
}

/**
 * Reasons the pack is NOT ratification-ready (empty = ready). A structurally
 * valid pack can still be un-ready: unresolved thresholds, unassigned roles,
 * placeholder signers, or `ratification_ready`/`thresholds_resolved`/
 * `roles_assigned` not all true.
 */
export function packReadinessReasons(manifest: RatificationManifest): string[] {
  const reasons: string[] = [];
  if (manifest.ratification_ready !== true) reasons.push("ratification_ready is not true");
  if (manifest.thresholds_resolved !== true) reasons.push("thresholds_resolved is not true");
  if (manifest.roles_assigned !== true) reasons.push("roles_assigned is not true");
  const actorIds = new Set<string>();
  for (const s of manifest.required_signers) {
    if (s.actor_id === PLACEHOLDER || s.name === PLACEHOLDER) {
      reasons.push(`required signer for capacity '${s.capacity}' is UNASSIGNED`);
    }
    if (actorIds.has(s.actor_id)) reasons.push(`required signer actor_id '${s.actor_id}' is repeated`);
    actorIds.add(s.actor_id);
  }
  return reasons;
}

// --- signature protocol ------------------------------------------------------

export interface RecordSignatureInput {
  packId: string;
  /** The digest the signer believes they are signing (must equal the current pack). */
  expectedDigest: string;
  signerActorId: string;
  signerCapacity: string;
  /** The exact acknowledgement text the signer accepts (must equal the manifest's). */
  acknowledgement: string;
}

async function inFlagsTx<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await acquireEventChainLock(client); // advisory lock FIRST (issue #7 order)
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

function requireField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

/**
 * Record one human signature on the Founding Ratification Pack. Captures the
 * whole request before the first `await`, then loads the CURRENT pack and
 * verifies: pack id + digest match; the pack is ratification-ready; the signer
 * appears exactly once in `required_signers` with the given capacity; the
 * acknowledgement matches the manifest. Emits exactly one append-only
 * `ratification.signature_recorded` event (`actor_type: human`, `actor_id` = the
 * signer). Idempotent: a re-signature of the same (signer, capacity, digest)
 * returns the existing event id; two concurrent signatures collapse to one
 * (serialized by the event-chain advisory lock). A signature for an older
 * digest never counts for a newer pack.
 *
 * `packOverride` is TEST-ONLY dependency injection; the productive path never
 * passes it and always reads docs/RATIFICATION_PACK.md. Even with an override,
 * this is not a bypass: the flag still requires real signature events in the
 * append-only log for the exact digest.
 */
export async function recordRatificationSignature(
  client: Queryable,
  input: RecordSignatureInput,
  packOverride?: { bytes?: string },
): Promise<{ eventId: string; idempotent: boolean }> {
  const req = Object.freeze({
    packId: requireField(input.packId, "packId"),
    expectedDigest: requireField(input.expectedDigest, "expectedDigest"),
    signerActorId: requireField(input.signerActorId, "signerActorId"),
    signerCapacity: requireField(input.signerCapacity, "signerCapacity"),
    acknowledgement: requireField(input.acknowledgement, "acknowledgement"),
  });

  const { snapshot, errors } = readRatificationPack(packOverride);
  if (!snapshot) throw new RatificationPackInvalid(errors);
  const readiness = packReadinessReasons(snapshot.manifest);
  if (readiness.length) throw new RatificationPackInvalid(readiness);

  if (req.packId !== snapshot.packId) {
    throw new Error(`pack id mismatch: signing '${req.packId}', current pack is '${snapshot.packId}'`);
  }
  if (req.expectedDigest !== snapshot.digest) {
    throw new Error(
      `stale pack digest: signer expects ${req.expectedDigest.slice(0, 12)}…, current pack is ${snapshot.digest.slice(0, 12)}…`,
    );
  }
  const matches = snapshot.manifest.required_signers.filter((s) => s.actor_id === req.signerActorId);
  if (matches.length === 0) {
    throw new Error(`'${req.signerActorId}' is not a required signer of pack ${req.packId}`);
  }
  if (matches.length > 1) {
    throw new Error(`'${req.signerActorId}' appears more than once in required_signers`);
  }
  if (matches[0].capacity !== req.signerCapacity) {
    throw new Error(
      `capacity mismatch: '${req.signerActorId}' is required as '${matches[0].capacity}', signed as '${req.signerCapacity}'`,
    );
  }
  if (req.acknowledgement !== snapshot.manifest.acknowledgement) {
    throw new Error("acknowledgement does not match the pack's required signature statement");
  }

  return inFlagsTx(client, async () => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM events
        WHERE event_type = $1 AND object_type = $2 AND object_id = $3
          AND actor_type = 'human' AND actor_id = $4
          AND payload->>'pack_digest' = $5 AND payload->>'signer_capacity' = $6
        LIMIT 1`,
      [
        RATIFICATION_EVENT_TYPE,
        RATIFICATION_OBJECT_TYPE,
        req.packId,
        req.signerActorId,
        snapshot.digest,
        req.signerCapacity,
      ],
    );
    if (existing.rows.length) return { eventId: existing.rows[0].id, idempotent: true };

    const ev = await appendEventTx(client, {
      id: `EV-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: req.signerActorId,
      event_type: RATIFICATION_EVENT_TYPE,
      object_type: RATIFICATION_OBJECT_TYPE,
      object_id: req.packId,
      payload: {
        pack_digest: snapshot.digest,
        pack_version: snapshot.version,
        signer_actor_id: req.signerActorId,
        signer_capacity: req.signerCapacity,
        acknowledgement_version: snapshot.manifest.acknowledgement_version,
      },
    });
    return { eventId: ev.id, idempotent: false };
  });
}

// --- the derived flag --------------------------------------------------------

/**
 * The `real_money` feature flag — PURELY DERIVED. True only when the current
 * pack is structurally valid AND ratification-ready AND every required signer
 * has a valid, self-signed signature event bound to the CURRENT digest,
 * version, and capacity. Fails closed on any doubt. No mutable column, no
 * environment override, no default-true, no bypass. A fresh DB → false.
 *
 * `packOverride` is TEST-ONLY injection; the productive path reads
 * docs/RATIFICATION_PACK.md. Even with an override the flag still requires the
 * matching signature events in the append-only log.
 */
export async function isRealMoneyEnabled(
  client: Queryable,
  packOverride?: { bytes?: string },
): Promise<boolean> {
  const { snapshot, errors } = readRatificationPack(packOverride);
  if (!snapshot || errors.length) return false;
  if (packReadinessReasons(snapshot.manifest).length) return false;

  const { rows } = await client.query<{ actor_id: string; payload: Record<string, unknown> | null }>(
    `SELECT actor_id, payload FROM events
       WHERE event_type = $1 AND object_type = $2 AND object_id = $3 AND actor_type = 'human'`,
    [RATIFICATION_EVENT_TYPE, RATIFICATION_OBJECT_TYPE, snapshot.packId],
  );

  for (const signer of snapshot.manifest.required_signers) {
    const signed = rows.some(
      (r) =>
        r.actor_id === signer.actor_id &&
        r.payload?.pack_digest === snapshot.digest &&
        r.payload?.pack_version === snapshot.version &&
        r.payload?.signer_capacity === signer.capacity,
    );
    if (!signed) return false;
  }
  return true;
}
