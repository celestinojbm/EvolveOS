# Development — console scaffold

**Status:** Phase 0 scaffold · Implements issue **[#5](https://github.com/celestinojbm/EvolveOS/issues/5)** (P0-4). This is the monorepo skeleton only — **no product features**. It exists so the stack ([ADR-008](ARCHITECTURE_DECISIONS.md)) is real, runnable, and type-safe before any feature lands.

## What is here

```text
package.json            # root scripts (dev/build/test/typegen/migrate/db:up/db:down); pnpm workspace
pnpm-workspace.yaml     # workspace = app/
tsconfig.base.json      # shared strict TS config
app/                    # @evolveos/app — minimal TypeScript service skeleton
  src/index.ts          # health entrypoint (GET /health); no features
  src/generated/        # TS types generated from schemas/*.schema.json (git-ignored)
  test/                 # vitest; one generated type consumed by a test
ops/
  typegen.mjs           # schemas/*.schema.json -> app/src/generated/*.ts
  migrate.mjs           # forward-only SQL migration runner (node-postgres)
  migrations/*.sql      # applied in filename order; recorded in schema_migrations
  docker-compose.yml    # local dev Postgres 16
```

## Prerequisites

- Node ≥ 20 and pnpm (`corepack enable` provides pnpm).
- Docker (for the local Postgres) **or** any Postgres 16 reachable via `DATABASE_URL`.

## Commands

```bash
pnpm install            # install workspace dependencies
pnpm typegen            # regenerate app/src/generated/*.ts from the JSON Schemas
pnpm build              # typecheck + compile app/ to app/dist
pnpm test               # typegen + typecheck + vitest (the generated type is consumed here)
pnpm dev                # run the skeleton service (GET http://localhost:3000/health)

pnpm db:up              # start local Postgres (docker compose)
pnpm migrate            # apply ops/migrations/*.sql to $DATABASE_URL (idempotent)
pnpm db:down            # stop and remove the local Postgres volume
```

`DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5432/evolveos` — a **throwaway local-dev value**, not a secret and never used in any deployed environment.

## Generated types

`app/src/generated/` is **derived from `schemas/*.schema.json`** and git-ignored — never hand-edit it. `pnpm typegen` (also run automatically before `build` and `test`) regenerates it, so the TypeScript types can never drift from the canonical schemas. This mirrors the generated-from-source discipline of `schemas/data/*.json` (issue #4).

## CI

`.github/workflows/app-ci.yml` runs on every push/PR: install → typegen → build → test → migrate (twice, to prove idempotency) against a Postgres service container. It is separate from `spec-consistency.yml`, which stays standard-library-Python only.

## Out of scope (deliberate)

No UI (Next.js enters in Phase 1), no event log (issue #6), no auth/roles (issue #7), no agents, no external integrations, no real credentials. See [ADR-008](ARCHITECTURE_DECISIONS.md) for the ratification and its scope clarifications.
