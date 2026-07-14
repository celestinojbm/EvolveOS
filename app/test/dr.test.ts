import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { appendEvent, verifyChainInDb } from "../src/lib/eventlog.js";
import {
  validateDecisionRecord,
  fileDecisionRecord,
  fileDecisionRecordAmendment,
  getDecisionRecord,
  getAmendmentsOf,
  digestDecisionRecordContent,
  renderDecisionBrief,
  DecisionRecordInvalid,
  DecisionBriefTooLong,
  DR_SCHEMA_VERSION,
  DECISION_BRIEF_WORD_LIMIT,
  type DecisionRecordInput,
} from "../src/lib/dr.js";
import { setupActors, type Actors } from "./helpers.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());
let yearSeed = 2600 + (Number(runId.replace(/\D/g, "").slice(-3)) % 300);
const freshDrYear = () => ++yearSeed;

/** A schema- and Part-VII-valid DR content object (no id — filing mints it). */
function validContent(over: Partial<DecisionRecordInput> = {}): DecisionRecordInput {
  return {
    title: "Adopt the staged rollout for venture V-2600-001",
    proposer: "PROPOSER",
    approver: "APPROVER",
    gate_id: "G-05",
    reversibility_class: "R3",
    decision: "Ship the MVP behind a concierge fallback.",
    rationale: "Landing tests and interviews both cleared the pre-registered thresholds.",
    evidence_links: ["evidence/landing-test", "evidence/interviews"],
    risks: ["Conversion may not hold at scale", "Fulfillment is manual for now"],
    kill_criteria: ["activation < 8% after 28 days"],
    rollback_plan: "Disable the feature flag; refund any pilot customers.",
    options: [
      { option_id: "opt-ship", summary: "Ship the MVP now." },
      { option_id: "opt-defer", summary: "Defer one sprint." },
    ],
    chosen_option: "opt-ship",
    dissent_record: [
      { author: "FIN-MODEL", position: "opt-defer", argument: "Payback looks optimistic." },
    ],
    status: "approved",
    ...over,
  };
}

async function withInsertBlocked<T>(
  client: pg.Client,
  table: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query(
    "CREATE OR REPLACE FUNCTION __dr_block() RETURNS trigger AS " +
      "$$ BEGIN RAISE EXCEPTION 'dr-injected failure'; END; $$ LANGUAGE plpgsql;",
  );
  await client.query(
    `CREATE TRIGGER __dr_block_trg BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION __dr_block()`,
  );
  try {
    return await fn();
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS __dr_block_trg ON ${table}`);
  }
}

describe("decision records — schema + field-level validation", () => {
  it("a valid document validates with no errors", () => {
    const r = validateDecisionRecord({ id: "DR-2600-1", ...validContent() });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("an invalid document reports structured field errors (path + keyword + message)", () => {
    const r = validateDecisionRecord({
      id: "DR-2600-2",
      title: "bad",
      proposer: "P",
      reversibility_class: "R9", // not in enum
      status: "approved",
      stray_field: true, // additionalProperties false
    });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    for (const e of r.errors) {
      expect(typeof e.path).toBe("string");
      expect(typeof e.keyword).toBe("string");
      expect(typeof e.message).toBe("string");
    }
    // Missing required `decision`, a bad enum, and a rejected extra property.
    expect(r.errors.some((e) => e.keyword === "required")).toBe(true);
    expect(r.errors.some((e) => e.keyword === "enum")).toBe(true);
    expect(r.errors.some((e) => e.keyword === "additionalProperties")).toBe(true);
  });

  it("duplicate option ids are rejected", () => {
    const r = validateDecisionRecord({
      id: "DR-2600-3",
      ...validContent({
        options: [
          { option_id: "dup", summary: "one" },
          { option_id: "dup", summary: "two" },
        ],
        chosen_option: "dup",
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.keyword === "unique")).toBe(true);
  });

  it("a chosen_option that matches no option is rejected", () => {
    const r = validateDecisionRecord({
      id: "DR-2600-4",
      ...validContent({ chosen_option: "opt-nope" }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === "/chosen_option" && e.keyword === "reference")).toBe(true);
  });

  it("R3/R4 decisions require at least two options", () => {
    const r = validateDecisionRecord({
      id: "DR-2600-5",
      ...validContent({
        reversibility_class: "R3",
        options: [{ option_id: "only", summary: "one" }],
        chosen_option: "only",
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === "/options" && e.keyword === "min_options")).toBe(true);
  });

  it("R2+ decisions require kill criteria and a rollback plan", () => {
    const r = validateDecisionRecord({
      id: "DR-2600-6",
      ...validContent({ reversibility_class: "R2", kill_criteria: [], rollback_plan: "   " }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === "/kill_criteria")).toBe(true);
    expect(r.errors.some((e) => e.path === "/rollback_plan")).toBe(true);
  });

  it("whitespace-only required strings are rejected", () => {
    const r = validateDecisionRecord({ id: "DR-2600-7", ...validContent({ proposer: "   " }) });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === "/proposer" && e.keyword === "non_blank")).toBe(true);
  });
});

describe("decision records — filing, ids, atomicity (Postgres)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("files a valid DR: DR-yyyy-seq id, one filed event, stored digest matches canonical JSON", async () => {
    const year = freshDrYear();
    const r = await fileDecisionRecord(client, {
      document: validContent(),
      filedBy: "PROPOSER",
      year,
    });
    expect(r.id).toMatch(new RegExp(`^DR-${year}-\\d+$`));
    expect(r.document.id).toBe(r.id);
    expect(r.document.schema_version).toBe(DR_SCHEMA_VERSION);

    const { rows: evs } = await client.query<{ event_type: string; n: number }>(
      "SELECT event_type, count(*)::int AS n FROM events WHERE object_id = $1 GROUP BY event_type",
      [r.id],
    );
    expect(evs).toEqual([{ event_type: "decision_record.filed", n: 1 }]);

    const { rows } = await client.query<{ canonical_json: string; content_digest: string }>(
      "SELECT canonical_json, content_digest FROM decision_records WHERE id = $1",
      [r.id],
    );
    expect(rows[0].content_digest).toBe(r.digest);
    expect(digestDecisionRecordContent(JSON.parse(rows[0].canonical_json))).toBe(r.digest);
  });

  it("rejects an invalid DR at filing with DecisionRecordInvalid (field errors)", async () => {
    await expect(
      fileDecisionRecord(client, {
        document: validContent({ reversibility_class: "R3", options: [{ option_id: "a", summary: "x" }], chosen_option: "a" }),
        filedBy: "PROPOSER",
        year: freshDrYear(),
      }),
    ).rejects.toThrow(DecisionRecordInvalid);
  });

  it("concurrent filings in the same year get unique sequential ids", async () => {
    const clients = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const c = new pg.Client({ connectionString: DATABASE_URL });
        await c.connect();
        return c;
      }),
    );
    try {
      const year = freshDrYear();
      const results = await Promise.all(
        clients.map((c) => fileDecisionRecord(c, { document: validContent(), filedBy: "PROPOSER", year })),
      );
      const ids = results.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length); // all unique
      const seqs = ids.map((id) => Number(id.split("-")[2])).sort((a, b) => a - b);
      expect(new Set(seqs).size).toBe(4); // unique seqs
      expect(seqs[3] - seqs[0]).toBe(3); // four consecutive seqs, no gaps
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("row-insert failure rolls back the event AND the counter (no gap, no orphan)", async () => {
    const year = freshDrYear();
    const first = await fileDecisionRecord(client, { document: validContent(), filedBy: "P", year });
    const s1 = Number(first.id.split("-")[2]);
    await expect(
      withInsertBlocked(client, "decision_records", () =>
        fileDecisionRecord(client, { document: validContent(), filedBy: "P", year }),
      ),
    ).rejects.toThrow(/dr-injected/i);
    // The failed attempt's counter increment rolled back: the next seq is s1+1
    // (a contiguous step), not s1+2 (which would mean the failed attempt leaked).
    const next = await fileDecisionRecord(client, { document: validContent(), filedBy: "P", year });
    expect(Number(next.id.split("-")[2])).toBe(s1 + 1);
  });

  it("event-append failure leaves no decision_records row", async () => {
    const year = freshDrYear();
    await expect(
      withInsertBlocked(client, "events", () =>
        fileDecisionRecord(client, { document: validContent(), filedBy: "P", year }),
      ),
    ).rejects.toThrow(/dr-injected/i);
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM decision_records WHERE id LIKE $1",
      [`DR-${year}-%`],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("decision records — immutability (Postgres)", () => {
  let client: pg.Client;
  let filedId: string;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    const r = await fileDecisionRecord(client, { document: validContent(), filedBy: "P", year: freshDrYear() });
    filedId = r.id;
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("UPDATE is rejected by the append-only trigger", async () => {
    await expect(
      client.query("UPDATE decision_records SET filed_by = 'x' WHERE id = $1", [filedId]),
    ).rejects.toThrow(/append-only|restrict/i);
  });

  it("DELETE is rejected by the append-only trigger", async () => {
    await expect(
      client.query("DELETE FROM decision_records WHERE id = $1", [filedId]),
    ).rejects.toThrow(/append-only|restrict/i);
  });

  it("TRUNCATE is rejected by the append-only trigger", async () => {
    await expect(client.query("TRUNCATE decision_records")).rejects.toThrow(/append-only|restrict/i);
  });

  it("getDecisionRecord returns a frozen document (no in-place overwrite)", async () => {
    const rec = (await getDecisionRecord(client, filedId))!;
    expect(Object.isFrozen(rec.document)).toBe(true);
  });
});

describe("decision records — amendments (Postgres)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("an amendment is a new immutable DR linked to the original; the original is unchanged", async () => {
    const year = freshDrYear();
    const original = await fileDecisionRecord(client, { document: validContent(), filedBy: "P", year });
    const beforeCanon = (await getDecisionRecord(client, original.id))!.canonicalJson;

    const amendment = await fileDecisionRecordAmendment(client, {
      amendsDrId: original.id,
      document: validContent({ decision: "Amended: extend the pilot to a second cohort." }),
      filedBy: "P",
      year,
    });
    expect(amendment.id).not.toBe(original.id);
    expect(amendment.amendsDrId).toBe(original.id);
    expect(amendment.document.amends_dr_id).toBe(original.id);

    // decision_record.amended event.
    const { rows: evs } = await client.query<{ event_type: string }>(
      "SELECT event_type FROM events WHERE object_id = $1", [amendment.id]);
    expect(evs.map((e) => e.event_type)).toContain("decision_record.amended");

    // Original byte-identical after the amendment.
    const afterCanon = (await getDecisionRecord(client, original.id))!.canonicalJson;
    expect(afterCanon).toBe(beforeCanon);
    expect((await getDecisionRecord(client, original.id))!.amendsDrId).toBeNull();

    // Amendment chain is queryable.
    const chain = await getAmendmentsOf(client, original.id);
    expect(chain.map((c) => c.id)).toContain(amendment.id);
  });

  it("amending a non-existent DR is rejected", async () => {
    await expect(
      fileDecisionRecordAmendment(client, {
        amendsDrId: `DR-${freshDrYear()}-999`,
        document: validContent(),
        filedBy: "P",
      }),
    ).rejects.toThrow(/non-existent decision record/i);
  });

  it("a self-referential amendment is rejected at the DB layer", async () => {
    // Direct INSERT (a test may exercise the store directly) with amends_dr_id = id.
    const ev = await appendEvent(client, {
      id: `EV-selfamend-${runId}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: "P",
      event_type: "decision_record.filed",
    });
    const id = `DR-${freshDrYear()}-1`;
    const doc = JSON.stringify({ id });
    await expect(
      client.query(
        `INSERT INTO decision_records
           (id, canonical_json, document_json, content_digest, schema_version, amends_dr_id, file_event_id, filed_by)
         VALUES ($1,$2,$3,$4,$5,$1,$6,'P')`,
        [id, doc, doc, "0".repeat(64), DR_SCHEMA_VERSION, ev.id],
      ),
    ).rejects.toThrow(/no_self_amend|check/i);
  });
});

describe("decision records — corruption is rejected on read (Postgres)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  async function insertRaw(id: string, canonicalJson: string, digest: string, documentJson: string) {
    const ev = await appendEvent(client, {
      id: `EV-corrupt-${runId}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: "P",
      event_type: "decision_record.filed",
    });
    await client.query(
      `INSERT INTO decision_records
         (id, canonical_json, document_json, content_digest, schema_version, file_event_id, filed_by)
       VALUES ($1,$2,$3,$4,$5,$6,'P')`,
      [id, canonicalJson, documentJson, digest, DR_SCHEMA_VERSION, ev.id],
    );
  }

  it("a stored digest that does not match the canonical bytes is rejected", async () => {
    const id = `DR-${freshDrYear()}-1`;
    const canon = JSON.stringify({ id, ok: true });
    await insertRaw(id, canon, "0".repeat(64), canon); // digest is valid-format but wrong
    await expect(getDecisionRecord(client, id)).rejects.toThrow(/corrupt/i);
  });

  it("a document_json that does not match the canonical JSON is rejected", async () => {
    const id = `DR-${freshDrYear()}-1`;
    const canon = JSON.stringify({ a: 1, id });
    const digest = digestDecisionRecordContent({ a: 1, id } as never);
    await insertRaw(id, canon, digest, JSON.stringify({ different: true })); // JSONB ≠ canonical
    await expect(getDecisionRecord(client, id)).rejects.toThrow(/corrupt/i);
  });
});

describe("decision records — brief renderer (Part VII §8.2)", () => {
  let client: pg.Client;
  let actors: Actors;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    actors = await setupActors(client, "drb");
  });
  afterAll(async () => {
    if (client) await client.end();
  });

  it("renders the six mandatory sections in order, deterministically", async () => {
    const filed = await fileDecisionRecord(client, {
      document: validContent({
        risks: ["Risk A", "Risk B"],
        dissent_record: [
          { author: "FIN-MODEL", position: "opt-defer", argument: "VERBATIM-DISSENT-PHRASE stands." },
        ],
      }),
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const rec = (await getDecisionRecord(client, filed.id))!;
    const brief = renderDecisionBrief(rec);
    const brief2 = renderDecisionBrief(rec);
    expect(brief).toBe(brief2); // deterministic

    // Section order.
    const idx = [
      "## 1. The ask",
      "## 2. Options",
      "## 3. Top three risks",
      "## 4. Dissent (verbatim)",
      "## 5. Kill criteria and rollback",
      "## 6. Drill-down",
    ].map((h) => brief.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));

    // Ask carries reversibility + gate. Options list the chosen option + uncertainty.
    expect(brief).toMatch(/reversibility \*\*R3\*\*, gate \*\*G-05\*\*/);
    expect(brief).toContain("`opt-ship`");
    expect(brief).toContain("✓");
    expect(brief).toMatch(/epistemic share|activation|quantiles|qualitative|discovery|primary/i);

    // Dissent verbatim, kill + rollback, drill-down id + digest.
    expect(brief).toContain("VERBATIM-DISSENT-PHRASE stands.");
    expect(brief).toContain("activation < 8% after 28 days");
    expect(brief).toContain("Disable the feature flag");
    expect(brief).toContain(`\`${filed.id}\``);
    expect(brief).toContain(`\`${filed.digest}\``);
  });

  it("surfaces at most three risks, pointing to the rest (never hiding them)", async () => {
    const filed = await fileDecisionRecord(client, {
      document: validContent({ risks: ["R-one", "R-two", "R-three", "R-four", "R-five"] }),
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const brief = renderDecisionBrief((await getDecisionRecord(client, filed.id))!);
    expect(brief).toContain("R-one");
    expect(brief).toContain("R-three");
    expect(brief).toContain("…and 2 more");
    expect(brief).not.toContain("R-five");
  });

  it("an amendment brief shows the amends link", async () => {
    const year = freshDrYear();
    const original = await fileDecisionRecord(client, { document: validContent(), filedBy: actors.proposer, year });
    const amendment = await fileDecisionRecordAmendment(client, {
      amendsDrId: original.id,
      document: validContent({ decision: "Amended decision." }),
      filedBy: actors.proposer,
      year,
    });
    const brief = renderDecisionBrief((await getDecisionRecord(client, amendment.id))!);
    expect(brief).toContain(`Amends: \`${original.id}\``);
  });

  it("overflow throws DecisionBriefTooLong rather than truncating dissent", async () => {
    const hugeDissent = Array.from({ length: DECISION_BRIEF_WORD_LIMIT + 200 }, (_v, i) => `w${i}`).join(" ");
    const filed = await fileDecisionRecord(client, {
      document: validContent({
        dissent_record: [{ author: "FIN-MODEL", argument: hugeDissent }],
      }),
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const rec = (await getDecisionRecord(client, filed.id))!;
    try {
      renderDecisionBrief(rec);
      throw new Error("expected DecisionBriefTooLong");
    } catch (err) {
      expect(err).toBeInstanceOf(DecisionBriefTooLong);
      expect((err as DecisionBriefTooLong).words).toBeGreaterThan(DECISION_BRIEF_WORD_LIMIT);
      expect((err as DecisionBriefTooLong).limit).toBe(DECISION_BRIEF_WORD_LIMIT);
    }
  });

  it("the event-log hash chain is intact after DR activity", async () => {
    const r = await verifyChainInDb(client);
    expect(r.ok).toBe(true);
  });
});
