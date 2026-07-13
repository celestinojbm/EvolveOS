import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { appendEvent } from "../src/lib/eventlog.js";
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

async function countEvents(
  client: pg.Client,
  type: string,
  objectId: string,
): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE event_type = $1 AND object_id = $2",
    [type, objectId],
  );
  return rows[0].n;
}

/** Install a BEFORE INSERT trigger that always raises on `table`, run fn, drop it. */
async function withInsertBlocked<T>(
  client: pg.Client,
  table: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query(
    "CREATE OR REPLACE FUNCTION __test_block() RETURNS trigger AS " +
      "$$ BEGIN RAISE EXCEPTION 'test-injected failure'; END; $$ LANGUAGE plpgsql;",
  );
  await client.query(
    `CREATE TRIGGER __test_block_trg BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION __test_block()`,
  );
  try {
    return await fn();
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS __test_block_trg ON ${table}`);
  }
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

  // --- happy paths ---------------------------------------------------------

  it("grants a role, logs a role.granted event, and lists it", async () => {
    const g = await grantRole(client, { userId: alice, role: "operator", grantedBy: "admin" });
    expect(await eventType(client, g.eventId)).toBe("role.granted");
    expect(await getRoles(client, alice)).toContain("operator");
  });

  it("rejects an approval where approver == proposer (application layer)", async () => {
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

  it("enforces proposer != approver at the DATA layer (DB CHECK, real event_id)", async () => {
    // Use a real event_id so the row passes the event_id FK and it is the CHECK
    // constraint — not a missing FK — that rejects the self-approval.
    const ev = await appendEvent(client, {
      id: `EV-check-${runId}`,
      timestamp: "2027-03-01T00:00:00Z",
      actor_type: "system",
      actor_id: "test",
      event_type: "unit.check",
    });
    await expect(
      client.query(
        `INSERT INTO approvals (object_type, object_id, proposer_actor_id, approver_actor_id, event_id)
         VALUES ('decision-record', 'DR-2027-780', $1, $1, $2)`,
        [alice, ev.id],
      ),
    ).rejects.toThrow(/approvals_proposer_ne_approver|violates check/i);
  });

  it("revokes a role and drops it from the active set", async () => {
    await grantRole(client, { userId: carol, role: "viewer", grantedBy: "admin" });
    expect(await getRoles(client, carol)).toContain("viewer");
    const r = await revokeRole(client, { userId: carol, role: "viewer", revokedBy: "admin" });
    expect(r.revoked).toBe(true);
    expect(await getRoles(client, carol)).not.toContain("viewer");
    expect(await eventType(client, r.eventId!)).toBe("role.revoked");
  });

  it("logs session start/end events", async () => {
    const s = await startSession(client, { userId: alice });
    expect(await eventType(client, s.eventId)).toBe("auth.session_started");
    const e = await endSession(client, { sessionId: s.id, userId: alice });
    expect(e.ended).toBe(true);
    expect(await eventType(client, e.eventId!)).toBe("auth.session_ended");
  });

  // --- atomicity / failure paths ------------------------------------------

  it("createUser: if the event append fails, no user is persisted", async () => {
    const ghost = uid("ghost");
    await expect(
      withInsertBlocked(client, "events", () =>
        createUser(client, { id: ghost, displayName: "Ghost", createdBy: "admin" }),
      ),
    ).rejects.toThrow(/test-injected/i);
    const { rows } = await client.query("SELECT 1 FROM users WHERE id = $1", [ghost]);
    expect(rows.length).toBe(0);
  });

  it("grantRole: a duplicate active grant rolls back — no orphan role.granted", async () => {
    const dave = uid("dave");
    await createUser(client, { id: dave, displayName: "Dave" });
    await grantRole(client, { userId: dave, role: "viewer", grantedBy: "admin" });
    await expect(
      grantRole(client, { userId: dave, role: "viewer", grantedBy: "admin" }),
    ).rejects.toThrow();
    // Exactly one role.granted event for dave (the failed second grant left none).
    expect(await countEvents(client, "role.granted", dave)).toBe(1);
  });

  it("revokeRole: revoking a non-existent grant records no event", async () => {
    const erin = uid("erin");
    await createUser(client, { id: erin, displayName: "Erin" });
    const r = await revokeRole(client, { userId: erin, role: "operator", revokedBy: "admin" });
    expect(r.revoked).toBe(false);
    expect(r.eventId).toBeUndefined();
    expect(await countEvents(client, "role.revoked", erin)).toBe(0);
  });

  it("recordApproval: if the approvals INSERT fails, no orphan approval.recorded", async () => {
    const objId = `DR-block-${runId}`;
    await expect(
      withInsertBlocked(client, "approvals", () =>
        recordApproval(client, {
          objectType: "decision-record",
          objectId: objId,
          proposerActorId: alice,
          approverActorId: bob,
        }),
      ),
    ).rejects.toThrow(/test-injected/i);
    expect(await countEvents(client, "approval.recorded", objId)).toBe(0);
  });

  it("endSession: ending a non-existent or already-ended session records no event", async () => {
    // non-existent
    const r1 = await endSession(client, { sessionId: `no-such-${runId}`, userId: alice });
    expect(r1.ended).toBe(false);
    expect(r1.eventId).toBeUndefined();

    // already-ended: a second end is a no-op with no new event
    const s = await startSession(client, { userId: bob });
    await endSession(client, { sessionId: s.id, userId: bob });
    const r2 = await endSession(client, { sessionId: s.id, userId: bob });
    expect(r2.ended).toBe(false);
    expect(await countEvents(client, "auth.session_ended", s.id)).toBe(1);
  });

  it("event_id FKs reject a non-existent event reference", async () => {
    await expect(
      client.query(
        "INSERT INTO role_grants (user_id, role, granted_by, event_id) VALUES ($1, 'viewer', 'admin', $2)",
        [alice, `EV-missing-${runId}`],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
