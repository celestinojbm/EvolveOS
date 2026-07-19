/**
 * Seed helper for the audit-conventions CLI tests: builds a realistic multi-type
 * event chain through the REAL productive APIs (never a raw INSERT), so the CLI
 * verifies genuine Phase 0 events. Re-exports the auth primitives the tests use
 * from one place.
 */
import type pg from "pg";
import { engageSystemStop, releaseSystemStop } from "../src/lib/stop.js";
import { passStandingGate } from "../src/lib/gates.js";
import { handoffStage } from "../src/lib/venture.js";
import { startSession } from "../src/lib/auth.js";
import { setupActors, mintVenture, fileDR, approveDR, freshYear } from "./helpers.js";

export { createUser, grantRole, startSession, endSession } from "../src/lib/auth.js";

export interface SeededChain {
  /** The minted venture id. */
  ventureId: string;
  /** The exact timestamp of the `system.stop_engaged` event (for --from/--to boundary tests). */
  stopTs: string;
}

/**
 * Emit a rich, valid chain covering: user/role/session events, a DR filing +
 * approval, a G-01 gate pass (venture created), an intra-envelope handoff, a
 * standing G-17 gate pass that references the venture via `payload.venture_id`
 * (object-bound to a subject, not the venture), and a stop + restart. Returns the
 * venture id and the stop event's timestamp.
 */
export async function seedAuditChain(db: pg.Client): Promise<SeededChain> {
  const actors = await setupActors(db, "audit"); // proposer + approver (+ approver role)

  // G-01: mint a venture (gate_passed / venture_created), then the 2->3 handoff.
  const minted = await mintVenture(db, actors, { year: freshYear() });
  const ventureId = minted.ventureId!;
  await handoffStage(db, { ventureId, expectedFrom: "trend_analysis", actor: actors.approver });

  // A standing gate (G-17) that authorizes a subject but references the venture
  // through payload.venture_id — exercises the declared ventureReferencePath.
  const standing = await fileDR(db, actors, { gateId: "G-17" });
  const standingApproval = await approveDR(db, actors, standing);
  await passStandingGate(db, {
    gateId: "G-17",
    subjectType: "campaign",
    subjectId: `camp-${ventureId}`,
    ventureId,
    decisionRecordId: standing.drId,
    approvalEventId: standingApproval,
    actor: actors.approver,
  });

  // Stop + restart (the approver holds the approver role and an active session).
  const session = await startSession(db, { userId: actors.approver });
  const stop = await engageSystemStop(db, {
    actorId: actors.approver,
    sessionId: session.id,
    reason: "audit-seed halt",
  });
  const { rows } = await db.query<{ timestamp: string }>(
    "SELECT timestamp FROM events WHERE id = $1",
    [stop.eventId],
  );
  const stopTs = rows[0].timestamp;
  await releaseSystemStop(db, {
    actorId: actors.approver,
    sessionId: session.id,
    rationale: "audit-seed resume",
  });

  return { ventureId, stopTs };
}
