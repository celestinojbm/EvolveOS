/**
 * EvolveOS console — Phase 0 skeleton entrypoint (issue #5).
 *
 * Deliberately minimal: a liveness endpoint and nothing else. There are no
 * product features in Phase 0 (see docs/ARCHITECTURE_DECISIONS.md ADR-008 and
 * the "No features" rule in issue #5). This exists so `pnpm dev` runs and the
 * monorepo has a real, typechecked entrypoint to grow from. The console UI
 * (Next.js) is introduced in Phase 1 when there is something to render.
 */
import { createServer, type Server } from "node:http";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3000);

export interface HealthStatus {
  status: "ok";
  service: "evolveos-console";
  phase: 0;
}

export function health(): HealthStatus {
  return { status: "ok", service: "evolveos-console", phase: 0 };
}

/** Build the skeleton server without binding a port (safe to import in tests). */
export function createHealthServer(): Server {
  return createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(health()));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

// Start listening only when run directly (`pnpm dev` / `pnpm start`), never on import.
if (argv[1] === fileURLToPath(import.meta.url)) {
  createHealthServer().listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`evolveos-console skeleton listening on http://localhost:${PORT} (GET /health)`);
  });
}
