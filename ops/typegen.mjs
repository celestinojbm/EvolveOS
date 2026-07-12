/**
 * Generate TypeScript types from the canonical JSON Schemas (issue #5).
 *
 * Reads every schemas/*.schema.json and writes app/src/generated/<name>.ts,
 * plus an index.ts barrel. The generated dir is git-ignored: types are always
 * derived from the schemas, never hand-edited — the same "generated from the
 * source of truth" discipline as schemas/data/*.json (issue #4).
 *
 * Standard tooling only: json-schema-to-typescript. No network (the schemas
 * carry no external $refs).
 */
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const schemasDir = join(repoRoot, "schemas");
const outDir = join(repoRoot, "app", "src", "generated");

const BANNER =
  "/* AUTO-GENERATED from schemas/*.schema.json by ops/typegen.mjs. Do not edit by hand. */";

function pascalCase(name) {
  return name.replace(/(^|[-_])(\w)/g, (_m, _sep, c) => c.toUpperCase());
}

const files = (await readdir(schemasDir))
  .filter((f) => f.endsWith(".schema.json"))
  .sort();

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const barrel = [BANNER];
for (const file of files) {
  const stem = basename(file, ".schema.json"); // e.g. "decision-record"
  const typeName = pascalCase(stem); // e.g. "DecisionRecord"
  const schema = JSON.parse(await readFile(join(schemasDir, file), "utf8"));
  // Drop `title` and `$id` so the root interface name comes from the filename
  // (stable, predictable exports) rather than the prose title ("EvolveOS
  // Decision Record") or the URL-derived `$id`. json-schema-to-typescript
  // resolves the root name from title -> $id -> the passed name, in that order.
  delete schema.title;
  delete schema.$id;
  const ts = await compile(schema, typeName, {
    bannerComment: BANNER,
    additionalProperties: false,
    style: { singleQuote: false },
  });
  await writeFile(join(outDir, `${stem}.ts`), ts);
  barrel.push(`export * from "./${stem}.js";`);
}
await writeFile(join(outDir, "index.ts"), barrel.join("\n") + "\n");

console.log(`typegen: wrote ${files.length} type module(s) to app/src/generated/`);
