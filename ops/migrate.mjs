/**
 * Minimal forward-only SQL migration runner (issue #5).
 *
 * Applies ops/migrations/*.sql in filename order inside a transaction each,
 * recording applied files in a `schema_migrations` bookkeeping table so re-runs
 * are idempotent. This is scaffolding, not an ORM: ADR-008 names Drizzle/Prisma
 * as the eventual choice, deferred until there is a real schema to model (the
 * event log, issue #6). Kept tiny and dependency-light (node-postgres only) so
 * it is easy to replace.
 *
 * Connection: DATABASE_URL, default a local dev Postgres (see
 * ops/docker-compose.yml). No real credentials are embedded — the default is a
 * throwaway local value.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "migrations");
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    const applied = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
    );

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`migrate: applied ${file}`);
        count += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }
    console.log(
      count === 0
        ? "migrate: database already up to date"
        : `migrate: applied ${count} migration(s)`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
