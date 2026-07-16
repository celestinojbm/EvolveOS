/**
 * EvolveOS founding ratification + the derived `real_money` feature flag
 * (issue #11, P0-10). This is the ONLY productive wrapper around the ratification
 * core (app/src/lib/ratification-core.ts) and the single owner of the
 * `real_money` evaluation.
 *
 * Hard rules this module upholds:
 *   - The productive path ALWAYS reads the canonical docs/RATIFICATION_PACK.md.
 *     No public function accepts bytes, a loader, or an override — there is no
 *     productive API that can activate the flag from arbitrary bytes. The
 *     injectable evaluators live in the core (`recordSignatureForSnapshot`,
 *     `evaluateRealMoneyForSnapshot`); this file only ever passes them the
 *     CANONICAL snapshot. Tests drive the core directly. No other production file
 *     may import the core (ops/check-ratification-writer.mjs enforces that).
 *   - The digest is the SHA-256 of the pack's EXACT UTF-8 bytes (not the DR JSON
 *     canonicalization). Any byte change invalidates every prior signature.
 *   - A signature is a single, self-signed, append-only HUMAN event bound to the
 *     digest + version and GROUNDED to a registered user (name + operational
 *     role). No delegated / automated / agent / env-var / seed / config-flag
 *     signature is ever valid.
 *   - `isRealMoneyEnabled` is PURELY DERIVED and fails closed. No mutable column,
 *     no env override, no default-true, no bypass. A fresh DB → false.
 *
 * `real_money = true` records that ratification happened; it MOVES NO MONEY and
 * executes no spend (THR-SPEND-EXEC = $0; ADR-006/007; the gate system rejects
 * any requestedSpend != 0).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client, PoolClient } from "pg";
import {
  parseRatificationPackBytes,
  recordSignatureForSnapshot,
  evaluateRealMoneyForSnapshot,
  RatificationPackInvalid,
  type RatificationPackResult,
  type RatificationPackSnapshot,
  type RecordSignatureInput,
} from "./ratification-core.js";

type Queryable = Client | PoolClient;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The productive pack — the ONLY document the productive path reads. */
export const RATIFICATION_PACK_PATH = join(REPO_ROOT, "docs", "RATIFICATION_PACK.md");

export {
  RATIFICATION_EVENT_TYPE,
  RATIFICATION_OBJECT_TYPE,
  RatificationPackInvalid,
} from "./ratification-core.js";
export type {
  RatificationManifest,
  RatificationPackSnapshot,
  RequiredSigner,
  RatificationError,
  RecordSignatureInput,
} from "./ratification-core.js";

/**
 * Read + fully validate the canonical pack. Never throws — returns
 * `{ snapshot: null, errors }` for a malformed/inconsistent pack so callers can
 * fail closed. Takes NO argument: the productive path is always the canonical
 * file.
 */
export function readRatificationPack(): RatificationPackResult {
  let bytes: string;
  try {
    bytes = readFileSync(RATIFICATION_PACK_PATH, "utf8");
  } catch (e) {
    return {
      snapshot: null,
      errors: [{ path: "file", keyword: "read", message: `cannot read ratification pack: ${e instanceof Error ? e.message : String(e)}` }],
    };
  }
  return parseRatificationPackBytes(bytes);
}

/** Snapshot the canonical pack or throw `RatificationPackInvalid`. */
export function snapshotRatificationPack(): RatificationPackSnapshot {
  const { snapshot, errors } = readRatificationPack();
  if (!snapshot) throw new RatificationPackInvalid(errors);
  return snapshot;
}

/**
 * Record one human signature on the CANONICAL Founding Ratification Pack. NO
 * override argument — the current pack is always the canonical file. Delegates
 * the verification + append to the core, bound to the canonical snapshot.
 */
export async function recordRatificationSignature(
  client: Queryable,
  input: RecordSignatureInput,
): Promise<{ eventId: string; idempotent: boolean }> {
  const { snapshot, errors } = readRatificationPack();
  if (!snapshot) throw new RatificationPackInvalid(errors);
  return recordSignatureForSnapshot(client, snapshot, input);
}

/**
 * The `real_money` feature flag — PURELY DERIVED. NO override argument. Reads the
 * canonical pack and delegates to the core evaluator. Fails closed: a malformed
 * or not-ready pack → false; a fresh DB → false.
 */
export async function isRealMoneyEnabled(client: Queryable): Promise<boolean> {
  const { snapshot } = readRatificationPack();
  if (!snapshot) return false;
  return evaluateRealMoneyForSnapshot(client, snapshot);
}
