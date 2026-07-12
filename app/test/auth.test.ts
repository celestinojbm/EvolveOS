import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  createUser,
  grantRole,
  revokeRole,
  getRoles,
  recordApproval,
  startSession,
  endSession,
} from "../src/lib/auth.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());
const uid = (name: string) => `u-${runId}-${name}`;

async function eventType(client: pg.Client, eventId: string): Promise<string | null> {
  const { rows } = await client.query<{ event_type: string }>(
    "SELECT event_type FROM events WHERE id = $1",
    [eventId],
  );
  return rows.length ? rows[0].event_type : null;
}

describe("user/role model (Postgres)", () => {
  let client: pg.Client;
  const alice = uid("alice"); // proposer
  const bob = uid("bob"); // approver
  const carol = uid("carol"); // no roles

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await createUser(client, { id: alice, displayName: "Alice" });
    await createUser(client, { id: bob, displayName: "Bob" });
    await createUser(client, { id: carol, displayName: "Carol" });
    await grantRole(client, { userId: bob, role: "approver", grantedBy: "admin" });
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  it("grants a role, logs a role.granted event, and lists it", async () => {
    const g = await grantRole(client, { userId: alice, role: "operator", grantedBy: "admin" });
    expect(await eventType(client, g.eventId)).toBe("role.granted");
    expect(await getRoles(client, alice)).toContain("operator");
  });

  it("rejects an approval where approver == proposer (role separation)", async () => {
    await expect(
      recordApproval(client, {
        objectType: "decision-record",
        objectId: "DR-2027-777",
        proposerActorId: bob,
        approverActorId: bob,
      }),
    ).rejects.toThrow(/role separation/i);
  });

  it("records an approval when proposer != approver and logs the event", async () => {
    const r = await recordApproval(client, {
      objectType: "decision-record",
      objectId: "DR-2027-778",
      proposerActorId: alice,
      approverActorId: bob,
    });
    expect(await eventType(client, r.eventId)).toBe("approval.recorded");
  });

  it("rejects an approver who lacks the 'approver' role", async () => {
    await expect(
      recordApproval(client, {
        objectType: "decision-record",
        objectId: "DR-2027-779",
        proposerActorId: alice,
        approverActorId: carol,
      }),
    ).rejects.toThrow(/lacks the 'approver' role/i);
  });

  it("enforces proposer != approver at the DATA layer (DB CHECK)", async () => {
    await expect(
      client.query(
        `INSERT INTO approvals (object_type, object_id, proposer_actor_id, approver_actor_id, event_id)
         VALUES ('decision-record', 'DR-2027-780', $1, $1, 'EV-manual')`,
        [alice],
      ),
    ).rejects.toThrow(/approvals_proposer_ne_approver|check/i);
  });

  it("revokes a role and drops it from the active set", async () => {
    await grantRole(client, { userId: carol, role: "viewer", grantedBy: "admin" });
    expect(await getRoles(client, carol)).toContain("viewer");
    const r = await revokeRole(client, { userId: carol, role: "viewer", revokedBy: "admin" });
    expect(r.revoked).toBe(true);
    expect(await getRoles(client, carol)).not.toContain("viewer");
    expect(await eventType(client, r.eventId)).toBe("role.revoked");
  });

  it("logs session start/end events", async () => {
    const s = await startSession(client, { userId: alice });
    expect(await eventType(client, s.eventId)).toBe("auth.session_started");
    const e = await endSession(client, { sessionId: s.id, userId: alice });
    expect(e.ended).toBe(true);
    expect(await eventType(client, e.eventId)).toBe("auth.session_ended");
  });
});
