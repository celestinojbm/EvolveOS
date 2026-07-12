import { defineConfig } from "vitest/config";

// The database-backed tests share a single Postgres, so run test files serially
// (not in parallel workers) — otherwise appends from different files interleave
// in the event log and break per-file chain assumptions.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
