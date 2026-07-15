import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { appendEvent, canonicalize, verifyChainInDb } from "../src/lib/eventlog.js";
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
  DecisionBriefIntegrityError,
  DR_SCHEMA_VERSION,
  DECISION_BRIEF_WORD_LIMIT,
  type DecisionRecordInput,
} from "../src/lib/dr.js";
import { passPipelineGate } from "../src/lib/gates.js";
import { setupActors, type Actors } from "./helpers.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/evolveos";
const runId = process.env.TEST_RUN_ID ?? String(Date.now());
let yearSeed = 2600 + (Number(runId.replace(/\D/g, "").slice(-3)) % 300);
const freshDrYear = () => ++yearSeed;

/** Pinned SHA-256 of the golden document's canonical JSON (see the golden test). */
const GOLDEN_DIGEST = "97a35a73d40e966f200d30fef0164a145e1be5ad133c035c8dde7d41d099c46c";

/**
 * Unique DR id for RAW-inserted rows (corruption/self-amend tests). Those rows
 * are append-only — they persist across suite runs on a reused DB — so a fixed
 * `-1` suffix would collide with a prior run's rows. The random 6-digit seq is
 * far above anything the per-year counter mints.
 */
const freshRawId = () => `DR-${freshDrYear()}-${100000 + Math.floor(Math.random() * 900000)}`;

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
      {
        option_id: "opt-ship",
        summary: "Ship the MVP now.",
        predicted_outcome_distribution: {
          primary_metric: "activated_customers_at_90d",
          representation: "quantiles",
          quantiles: { p05: 4, p50: 22, p95: 85 },
          epistemic_share: 0.6,
        },
      },
      {
        option_id: "opt-defer",
        summary: "Defer one sprint.",
        predicted_outcome_distribution: {
          primary_metric: "activated_customers_at_90d",
          representation: "qualitative",
          epistemic_share: 0.4,
        },
      },
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

  it("R3: an option with NO predicted_outcome_distribution is rejected", () => {
    const c = validContent();
    delete (c.options![1] as { predicted_outcome_distribution?: unknown })
      .predicted_outcome_distribution;
    const r = validateDecisionRecord({ id: "DR-2600-8", ...c });
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) => e.path === "/options/1/predicted_outcome_distribution" && e.keyword === "required",
      ),
    ).toBe(true);
  });

  it("R3: an option with an EMPTY {} predicted_outcome_distribution is rejected", () => {
    const c = validContent();
    c.options![0].predicted_outcome_distribution = {};
    const r = validateDecisionRecord({ id: "DR-2600-9", ...c });
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) => e.path === "/options/0/predicted_outcome_distribution" && e.keyword === "required",
      ),
    ).toBe(true);
  });

  it("R2 options remain filable without a distribution (rule is R3/R4-only)", () => {
    const c = validContent({
      reversibility_class: "R2",
      options: [{ option_id: "solo", summary: "Only path considered." }],
      chosen_option: "solo",
    });
    const r = validateDecisionRecord({ id: "DR-2600-10", ...c });
    expect(r.ok).toBe(true);
  });

  it("R3: zero non-blank risks are rejected (the brief must surface top risks)", () => {
    const r = validateDecisionRecord({
      id: "DR-2600-11",
      ...validContent({ risks: ["   "] }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === "/risks" && e.keyword === "required")).toBe(true);
  });

  it("golden digest: the canonicalization is pinned — refactors cannot change it", () => {
    // SHA-256 over eventlog.canonicalize (key-sorted, no whitespace) of this
    // fixed document. If this test fails, the digest definition changed and
    // every recorded approval binding would silently break. Do NOT update the
    // constant without a deliberate, documented migration.
    const golden = {
      id: "DR-2027-0001",
      title: "Golden digest pin",
      proposer: "P",
      approver: "A",
      reversibility_class: "R1",
      decision: "Pin the canonicalization.",
      status: "approved",
    };
    expect(canonicalize(golden)).toBe(
      '{"approver":"A","decision":"Pin the canonicalization.","id":"DR-2027-0001",' +
        '"proposer":"P","reversibility_class":"R1","status":"approved","title":"Golden digest pin"}',
    );
    expect(digestDecisionRecordContent(golden as never)).toBe(GOLDEN_DIGEST);
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

  it("filing results are DEEP-frozen: the returned document cannot be mutated", async () => {
    const filed = await fileDecisionRecord(client, {
      document: validContent(),
      filedBy: "P",
      year: freshDrYear(),
    });
    expect(Object.isFrozen(filed.document)).toBe(true);
    expect(() => {
      (filed.document as { title: string }).title = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      filed.document.options!.push({ option_id: "opt-evil", summary: "injected" });
    }).toThrow(TypeError);
    expect(() => {
      (filed.document.options![0] as { summary: string }).summary = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      (filed.document.options![0].predicted_outcome_distribution as Record<string, unknown>).p = 1;
    }).toThrow(TypeError);
    expect(() => {
      filed.document.risks!.push("injected");
    }).toThrow(TypeError);
    expect(() => {
      (filed.document.dissent_record![0] as { argument: string }).argument = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      filed.document.kill_criteria!.push("injected");
    }).toThrow(TypeError);

    const amendment = await fileDecisionRecordAmendment(client, {
      amendsDrId: filed.id,
      document: validContent({ decision: "Amended." }),
      filedBy: "P",
      year: freshDrYear(),
    });
    expect(Object.isFrozen(amendment.document)).toBe(true);
    expect(() => {
      amendment.document.options!.push({ option_id: "opt-evil", summary: "injected" });
    }).toThrow(TypeError);
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
    // Delta, not an absolute count: rows are append-only and years can recur
    // across suite runs on a reused DB, so a prior run may already own rows in
    // this year band. Only THIS attempt must leave nothing behind.
    const countRows = async () => {
      const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM decision_records WHERE id LIKE $1",
        [`DR-${year}-%`],
      );
      return rows[0].n;
    };
    const before = await countRows();
    await expect(
      withInsertBlocked(client, "events", () =>
        fileDecisionRecord(client, { document: validContent(), filedBy: "P", year }),
      ),
    ).rejects.toThrow(/dr-injected/i);
    expect(await countRows()).toBe(before);
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

  it("TRUNCATE is rejected (FK guard, and the append-only trigger under CASCADE)", async () => {
    // Since the gate_passes.dr_id FK, a plain TRUNCATE is blocked even before
    // the trigger fires (a second, independent layer of protection).
    await expect(client.query("TRUNCATE decision_records")).rejects.toThrow(
      /append-only|restrict|foreign key/i,
    );
    // CASCADE clears the FK objection — and then the append-only trigger raises.
    await expect(client.query("TRUNCATE decision_records CASCADE")).rejects.toThrow(
      /append-only|restrict/i,
    );
  });

  it("getDecisionRecord returns a DEEP-frozen document: every mutation attempt throws", async () => {
    const rec = (await getDecisionRecord(client, filedId))!;
    const doc = rec.document;
    // Top level, arrays, objects nested in arrays, and the nested distribution.
    expect(() => {
      (doc as { title: string }).title = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      doc.options!.push({ option_id: "opt-evil", summary: "injected" });
    }).toThrow(TypeError);
    expect(() => {
      (doc.options![0] as { summary: string }).summary = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      (doc.options![0].predicted_outcome_distribution as Record<string, unknown>).epistemic_share = 1;
    }).toThrow(TypeError);
    expect(() => {
      doc.risks!.push("injected risk");
    }).toThrow(TypeError);
    expect(() => {
      (doc.dissent_record![0] as { argument: string }).argument = "tampered";
    }).toThrow(TypeError);

    // Nothing changed: a re-read returns identical canonical bytes and digest.
    const again = (await getDecisionRecord(client, filedId))!;
    expect(again.canonicalJson).toBe(rec.canonicalJson);
    expect(again.digest).toBe(rec.digest);
    expect(canonicalize(doc)).toBe(rec.canonicalJson);
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

  it("a self-referential amendment is rejected at the DB layer (no_self_amend specifically)", async () => {
    // Direct INSERT (a test may exercise the store directly) with amends_dr_id = id.
    const ev = await appendEvent(client, {
      id: `EV-selfamend-${runId}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: "P",
      event_type: "decision_record.amended",
    });
    const id = freshRawId();
    // Postgres fires table CHECKs in constraint-NAME order, so the document
    // must SATISFY all three doc-binding CHECKs (matching id, schema_version,
    // and amends_dr_id = id) — otherwise doc_amends_match, alphabetically
    // first, fires instead and no_self_amend is never actually exercised.
    const doc = JSON.stringify({ id, schema_version: DR_SCHEMA_VERSION, amends_dr_id: id });
    await expect(
      client.query(
        `INSERT INTO decision_records
           (id, canonical_json, document_json, content_digest, schema_version, amends_dr_id, file_event_id, filed_by)
         VALUES ($1,$2,$3,$4,$5,$1,$6,'P')`,
        [id, doc, doc, "0".repeat(64), DR_SCHEMA_VERSION, ev.id],
      ),
    ).rejects.toThrow(/decision_records_no_self_amend/);
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

  /** A fully valid, internally consistent document for a given row id. */
  function fullDoc(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...validContent(), id, schema_version: DR_SCHEMA_VERSION, amends_dr_id: null, ...over };
  }

  interface RawRowOpts {
    id: string;
    doc: Record<string, unknown>;
    digest?: string;
    documentJson?: string;
    schemaVersion?: string;
    amendsCol?: string | null;
    eventType?: string;
    eventObjectId?: string;
    eventActor?: string;
    eventPayload?: Record<string, unknown> | null;
  }

  /**
   * Append the filing event for a raw row. SELF-COMMITTING (appendEvent opens
   * its own transaction), so it must be called OUTSIDE any open transaction —
   * calling it inside one would commit that outer transaction mid-flight.
   */
  async function makeFilingEvent(opts: RawRowOpts): Promise<string> {
    const digest = opts.digest ?? digestDecisionRecordContent(opts.doc as never);
    const schemaVersion = opts.schemaVersion ?? DR_SCHEMA_VERSION;
    const amendsCol = opts.amendsCol ?? null;
    const ev = await appendEvent(client, {
      id: `EV-corrupt-${runId}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      actor_type: "human",
      actor_id: opts.eventActor ?? "P",
      event_type:
        opts.eventType ?? (amendsCol === null ? "decision_record.filed" : "decision_record.amended"),
      object_type: "decision-record",
      object_id: opts.eventObjectId ?? opts.id,
      payload:
        opts.eventPayload === undefined
          ? { content_digest: digest, schema_version: schemaVersion, amends_dr_id: amendsCol }
          : opts.eventPayload,
    });
    return ev.id;
  }

  /** Plain single INSERT of the row (safe inside an open transaction). */
  async function insertRowRaw(opts: RawRowOpts, eventId: string): Promise<void> {
    const canonical = canonicalize(opts.doc);
    await client.query(
      `INSERT INTO decision_records
         (id, canonical_json, document_json, content_digest, schema_version, amends_dr_id, file_event_id, filed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'P')`,
      [
        opts.id,
        canonical,
        opts.documentJson ?? canonical,
        opts.digest ?? digestDecisionRecordContent(opts.doc as never),
        opts.schemaVersion ?? DR_SCHEMA_VERSION,
        opts.amendsCol ?? null,
        eventId,
      ],
    );
  }

  /** Event + row, outside any transaction (tests-only direct insert). */
  async function insertRaw(opts: RawRowOpts): Promise<void> {
    const eventId = await makeFilingEvent(opts);
    await insertRowRaw(opts, eventId);
  }

  /**
   * Materialize a column↔document mismatch (normally unrepresentable thanks to
   * the DB CHECK) to prove the READ layer independently rejects it: the filing
   * event is committed FIRST (it self-commits), then a transaction drops the
   * named constraint, inserts the row, runs `fn`, and ROLLS BACK — restoring
   * the constraint and discarding the corrupt row. Nothing persists.
   */
  async function withDroppedConstraint(
    name: string,
    row: RawRowOpts,
    fn: () => Promise<void>,
  ): Promise<void> {
    const eventId = await makeFilingEvent(row); // BEFORE the txn — self-commits
    await client.query("BEGIN");
    try {
      await client.query(`ALTER TABLE decision_records DROP CONSTRAINT ${name}`);
      await insertRowRaw(row, eventId);
      await fn();
    } finally {
      await client.query("ROLLBACK");
    }
  }

  it("1. a stored digest that does not match the canonical bytes is rejected", async () => {
    const id = freshRawId();
    await insertRaw({ id, doc: fullDoc(id), digest: "0".repeat(64) }); // valid format, wrong value
    await expect(getDecisionRecord(client, id)).rejects.toThrow(/corrupt.*digest/i);
  });

  it("2. a document_json that does not match the canonical JSON is rejected", async () => {
    const id = freshRawId();
    await insertRaw({
      id,
      doc: fullDoc(id),
      // Satisfies the DB binding CHECKs (same id/schema_version) but differs.
      documentJson: JSON.stringify({ id, schema_version: DR_SCHEMA_VERSION, different: true }),
    });
    await expect(getDecisionRecord(client, id)).rejects.toThrow(/document_json does not match/i);
  });

  it("3. a stored document that no longer validates is rejected with its field errors", async () => {
    const id = freshRawId();
    // Internally consistent (bytes, digest, bindings, event) but schema-invalid:
    // `decision` is missing.
    await insertRaw({
      id,
      doc: {
        id,
        schema_version: DR_SCHEMA_VERSION,
        amends_dr_id: null,
        title: "Corrupt archived document",
        proposer: "P",
        reversibility_class: "R1",
        status: "proposed",
      },
    });
    await expect(getDecisionRecord(client, id)).rejects.toThrow(
      /no longer validates.*required property 'decision'/i,
    );
  });

  it("4. row.id ≠ document.id: unrepresentable by INSERT (DB CHECK) AND rejected on read", async () => {
    const rowId = freshRawId();
    const otherId = freshRawId();
    // (a) The DB backstop makes it unrepresentable by direct INSERT.
    await expect(insertRaw({ id: rowId, doc: fullDoc(otherId) })).rejects.toThrow(
      /decision_records_doc_id_match/,
    );
    // (b) Belt-and-suspenders: with the CHECK dropped (rolled back), the READ
    // layer still rejects the mismatch.
    await withDroppedConstraint(
      "decision_records_doc_id_match",
      { id: rowId, doc: fullDoc(otherId) },
      async () => {
        await expect(getDecisionRecord(client, rowId)).rejects.toThrow(/carries id/i);
      },
    );
  });

  it("5. column schema_version ≠ document: DB CHECK AND read both reject", async () => {
    const id = freshRawId();
    await expect(insertRaw({ id, doc: fullDoc(id), schemaVersion: "9.9.9" })).rejects.toThrow(
      /decision_records_doc_schema_version_match/,
    );
    await withDroppedConstraint(
      "decision_records_doc_schema_version_match",
      { id, doc: fullDoc(id), schemaVersion: "9.9.9" },
      async () => {
        await expect(getDecisionRecord(client, id)).rejects.toThrow(/schema_version/i);
      },
    );
  });

  it("6. column amends_dr_id ≠ document: DB CHECK AND read both reject", async () => {
    const year = freshDrYear();
    const target = await fileDecisionRecord(client, { document: validContent(), filedBy: "P", year });
    const id = freshRawId();
    // Document says null; column says it amends `target`. IS NOT DISTINCT FROM
    // in the CHECK makes this a real FALSE (a plain `=` would be NULL and pass).
    await expect(insertRaw({ id, doc: fullDoc(id), amendsCol: target.id })).rejects.toThrow(
      /decision_records_doc_amends_match/,
    );
    await withDroppedConstraint(
      "decision_records_doc_amends_match",
      { id, doc: fullDoc(id), amendsCol: target.id },
      async () => {
        await expect(getDecisionRecord(client, id)).rejects.toThrow(/amends_dr_id/i);
      },
    );
  });

  it("6b. document_json MISSING 'id' or 'schema_version' is rejected (NULL-safe CHECKs)", async () => {
    // With a plain `=` these CHECKs would evaluate to NULL (missing key ->> NULL)
    // and PASS; IS NOT DISTINCT FROM makes a one-sided NULL a real FALSE.
    const idA = freshRawId();
    await expect(
      insertRaw({
        id: idA,
        doc: fullDoc(idA),
        documentJson: JSON.stringify({ schema_version: DR_SCHEMA_VERSION }), // no 'id'
      }),
    ).rejects.toThrow(/decision_records_doc_id_match/);
    const idB = freshRawId();
    await expect(
      insertRaw({
        id: idB,
        doc: fullDoc(idB),
        documentJson: JSON.stringify({ id: idB }), // no 'schema_version'
      }),
    ).rejects.toThrow(/decision_records_doc_schema_version_match/);
  });

  it("7. file_event_id pointing at an event of another type is rejected", async () => {
    const id = freshRawId();
    await insertRaw({ id, doc: fullDoc(id), eventType: "unit.check" });
    await expect(getDecisionRecord(client, id)).rejects.toThrow(/filing event.*'unit\.check'/i);
  });

  it("8. a filing event whose object_id is a different DR is rejected", async () => {
    const id = freshRawId();
    await insertRaw({ id, doc: fullDoc(id), eventObjectId: "DR-9999-9" });
    await expect(getDecisionRecord(client, id)).rejects.toThrow(/not this record/i);
  });

  it("9. a filing event whose payload digest differs is rejected", async () => {
    const id = freshRawId();
    await insertRaw({
      id,
      doc: fullDoc(id),
      eventPayload: {
        content_digest: "f".repeat(64),
        schema_version: DR_SCHEMA_VERSION,
        amends_dr_id: null,
      },
    });
    await expect(getDecisionRecord(client, id)).rejects.toThrow(/payload digest/i);
  });

  it("gates reject corrupt records too (they load through getDecisionRecord)", async () => {
    const id = freshRawId();
    await insertRaw({ id, doc: fullDoc(id, { gate_id: "G-02", reversibility_class: "R2" }), eventType: "unit.check" });
    await expect(
      passPipelineGate(client, {
        gateId: "G-02",
        ventureId: "V-2099-1",
        decisionRecordId: id,
        approvalEventId: "EV-x",
        actor: "op",
      }),
    ).rejects.toThrow(/filing event/i);
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM gate_passes WHERE dr_id = $1",
      [id],
    );
    expect(rows[0].n).toBe(0);
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
    const content = validContent({
      risks: ["Risk A", "Risk B"],
      dissent_record: [
        { author: "FIN-MODEL", position: "opt-defer", argument: "VERBATIM-DISSENT-PHRASE stands." },
      ],
    });
    // An unequivocal marker INSIDE the chosen option's distribution: the
    // uncertainty assertions below cannot be satisfied by any other part of
    // the DR (kill criteria, decision text, etc.).
    content.options![0].predicted_outcome_distribution = {
      primary_metric: "UNIQUE-OPTION-METRIC",
      representation: "quantiles",
      quantiles: { p50: 42 },
      epistemic_share: 0.4,
    };
    const filed = await fileDecisionRecord(client, {
      document: content,
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

    // Ask carries reversibility + gate.
    expect(brief).toMatch(/reversibility \*\*R3\*\*, gate \*\*G-05\*\*/);
    expect(brief).toContain("`opt-ship`");
    expect(brief).toContain("✓");
    // Uncertainty comes from the OPTION ROW specifically: the marker metric,
    // its representation, its quantiles, and its epistemic share all appear
    // in the options-table line for opt-ship.
    const optionRow = brief.split("\n").find((l) => l.includes("`opt-ship`"))!;
    expect(optionRow).toContain("UNIQUE-OPTION-METRIC");
    expect(optionRow).toContain("(quantiles)");
    expect(optionRow).toContain("p50=42");
    expect(optionRow).toContain("epistemic share 0.4");

    // Risks state mitigation-or-absence flatly; dissent verbatim; kill +
    // rollback; drill-down id + digest.
    expect(brief).toContain("Mitigation: not separately recorded in the Phase 0 DR.");
    expect(brief).toContain("VERBATIM-DISSENT-PHRASE stands.");
    expect(brief).toContain("activation < 8% after 28 days");
    expect(brief).toContain("Disable the feature flag");
    expect(brief).toContain(`\`${filed.id}\``);
    expect(brief).toContain(`\`${filed.digest}\``);
  });

  it("brief binding: a tampered document with the original digest is rejected", async () => {
    const filed = await fileDecisionRecord(client, {
      document: validContent(),
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const rec = (await getDecisionRecord(client, filed.id))!;

    // Three tampered copies, each carrying the ORIGINAL digest/canonical JSON.
    const tamperDecision = JSON.parse(rec.canonicalJson);
    tamperDecision.decision = "a materially different decision";
    expect(() => renderDecisionBrief({ ...rec, document: tamperDecision })).toThrow(
      DecisionBriefIntegrityError,
    );

    const tamperOption = JSON.parse(rec.canonicalJson);
    tamperOption.options[0].summary = "a tampered option summary";
    expect(() => renderDecisionBrief({ ...rec, document: tamperOption })).toThrow(
      DecisionBriefIntegrityError,
    );

    const tamperDissent = JSON.parse(rec.canonicalJson);
    tamperDissent.dissent_record[0].argument = "dissent silently rewritten";
    expect(() => renderDecisionBrief({ ...rec, document: tamperDissent })).toThrow(
      DecisionBriefIntegrityError,
    );

    // The untampered record still renders.
    expect(renderDecisionBrief(rec)).toContain(rec.digest);
  });

  it("brief binding: fake digest / fake canonical / id mismatch / amends mismatch are rejected", async () => {
    const filed = await fileDecisionRecord(client, {
      document: validContent(),
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const rec = (await getDecisionRecord(client, filed.id))!;

    expect(() => renderDecisionBrief({ ...rec, digest: "0".repeat(64) })).toThrow(
      DecisionBriefIntegrityError,
    );
    expect(() =>
      renderDecisionBrief({ ...rec, canonicalJson: rec.canonicalJson.replace("Ship", "Sink") }),
    ).toThrow(DecisionBriefIntegrityError);
    expect(() => renderDecisionBrief({ ...rec, id: "DR-9999-1" })).toThrow(
      DecisionBriefIntegrityError,
    );
    expect(() => renderDecisionBrief({ ...rec, amendsDrId: "DR-9999-2" })).toThrow(
      DecisionBriefIntegrityError,
    );
  });

  it("a valid distribution with only unrecognized fields still renders (never '—')", async () => {
    const content = validContent();
    content.options![1].predicted_outcome_distribution = {
      confidence_interval: "10–20 activated customers",
      confidence_level: 0.8,
    };
    const filed = await fileDecisionRecord(client, {
      document: content,
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const brief = renderDecisionBrief((await getDecisionRecord(client, filed.id))!);
    const row = brief.split("\n").find((l) => l.includes("`opt-defer`"))!;
    // Deterministic canonical rendering of the unknown shape, in the option row.
    expect(row).toContain("confidence_interval");
    expect(row).toContain("10–20 activated customers");
    expect(row).toContain("0.8");
    // Uncertainty declares the recorded distribution instead of hiding it.
    expect(row).toContain("structured distribution");
    // Neither cell is the bare "—" placeholder.
    const cells = row.split("|").map((c) => c.trim());
    expect(cells).not.toContain("—");
  });

  it("R2 with an EMPTY {} distribution renders both cells as exactly '—' (not canonical '{}')", async () => {
    // {} is filable for R1/R2 (the non-empty rule is R3/R4-only). It carries no
    // information, so it renders as the absent-distribution placeholder — not
    // as canonical "{}" plus a misleading "structured distribution" note.
    const filed = await fileDecisionRecord(client, {
      document: validContent({
        reversibility_class: "R2",
        options: [{ option_id: "solo", summary: "Only path.", predicted_outcome_distribution: {} }],
        chosen_option: "solo",
      }),
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const brief = renderDecisionBrief((await getDecisionRecord(client, filed.id))!);
    const row = brief.split("\n").find((l) => l.includes("`solo`"))!;
    const cells = row.split("|").map((c) => c.trim());
    // | `solo` | ✓ | Only path. | — | — |  → outcome and uncertainty cells.
    expect(cells[4]).toBe("—");
    expect(cells[5]).toBe("—");
    expect(row).not.toContain("structured distribution");
  });

  it("blank recognized fields do not blank the cells: the canonical fallback still fires", async () => {
    const filed = await fileDecisionRecord(client, {
      document: validContent({
        options: [
          {
            option_id: "opt-a",
            summary: "A.",
            predicted_outcome_distribution: { primary_metric: "" }, // blank but "recognized"
          },
          {
            option_id: "opt-b",
            summary: "B.",
            predicted_outcome_distribution: { representation: "  " }, // whitespace-only
          },
        ],
        chosen_option: "opt-a",
      }),
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const brief = renderDecisionBrief((await getDecisionRecord(client, filed.id))!);
    const rowA = brief.split("\n").find((l) => l.includes("`opt-a`"))!;
    const rowB = brief.split("\n").find((l) => l.includes("`opt-b`"))!;
    // Blank recognized fields are treated as unrecognized: the outcome cell
    // shows the canonical JSON (never an empty cell or a bare "()" token), and
    // the uncertainty cell falls through to the explicit note.
    expect(rowA).toContain('{"primary_metric":""}');
    expect(rowA).toContain("structured distribution");
    expect(rowB).toContain('{"representation":"  "}');
    expect(rowB).toContain("structured distribution");
    for (const row of [rowA, rowB]) {
      const cells = row.split("|").map((c) => c.trim());
      expect(cells[4]).not.toBe("");
      expect(cells[5]).not.toBe("");
      expect(cells[4]).not.toBe("()");
    }
  });

  it("the brief renders from the VERIFIED snapshot clone, never the caller's object", async () => {
    const filed = await fileDecisionRecord(client, {
      document: validContent(),
      filedBy: actors.proposer,
      year: freshDrYear(),
    });
    const rec = (await getDecisionRecord(client, filed.id))!;
    const honest = JSON.parse(rec.canonicalJson) as Record<string, unknown>;
    // A booby-trapped document: `decision` returns the honest value on its
    // FIRST read (consumed by canonicalize during the integrity snapshot) and
    // tampered text on every later read. The snapshot's JSON clone strips the
    // getter, so rendering from the verified clone shows the honest text; a
    // regression that rendered from record.document would show the tampered
    // text NEXT TO the honest digest.
    let reads = 0;
    const trap = { ...honest };
    Object.defineProperty(trap, "decision", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? honest.decision : "TAMPERED-AFTER-SNAPSHOT";
      },
    });
    const brief = renderDecisionBrief({ ...rec, document: trap as never });
    expect(brief).toContain((honest.decision as string).trim());
    expect(brief).not.toContain("TAMPERED-AFTER-SNAPSHOT");
  });

  it("filing an R3 DR with an option lacking a distribution is rejected", async () => {
    const content = validContent();
    delete (content.options![0] as { predicted_outcome_distribution?: unknown })
      .predicted_outcome_distribution;
    await expect(
      fileDecisionRecord(client, { document: content, filedBy: actors.proposer, year: freshDrYear() }),
    ).rejects.toThrow(/predicted_outcome_distribution/i);
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
    // Each of the three shown risks states its mitigation absence explicitly.
    const absences = brief.match(/Mitigation: not separately recorded in the Phase 0 DR\./g) ?? [];
    expect(absences.length).toBe(3);
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
