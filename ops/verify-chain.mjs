/**
 * Operator command (issue #6): verify the live event-log hash chain.
 *
 * Reads every row from `events` in order and re-checks the links and hashes.
 * Exits 0 if the chain is intact, 1 if a broken/tampered row is found.
 *
 * Requires a prior `pnpm build` (imports the compiled eventlog module) and a
 * reachable DATABASE_URL (defaults to the local dev Postgres).
 *
 * Usage:  pnpm build && pnpm verify:events
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const compiled = join(here, "..", "app", "dist", "lib", "eventlog.js");
if (!existsSync(compiled)) {
  console.error("verify-chain: app/dist not found — run `pnpm build` first.");
  process.exit(1);
}
const { verifyChainInDb } = await import(compiled);

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  const r = await verifyChainInDb(client);
  if (r.ok) {
    console.log(`ok    event chain intact (${r.length} event(s))`);
    process.exit(0);
  }
  console.error(`FAIL  event chain broken at index ${r.brokenAt} (${r.reason})`);
  process.exit(1);
} finally {
  await client.end();
}
