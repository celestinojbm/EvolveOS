-- 0006_decision_records.sql — immutable Decision Record store (issue #10, P0-9).
--
-- Part VII §2.2: DRs are immutable JSON documents identified `DR-<yyyy>-<seq>`,
-- stored append-only with content hashes chained into the audit log. The only
-- way to change or complete a filed decision is to file ANOTHER immutable DR
-- that references the original via `amends_dr_id` — the original bytes never
-- change.
--
-- Written ONLY by app/src/lib/dr.ts (ops/check-dr-writer.mjs enforces this in
-- CI). The canonical bytes and digest are computed by dr.ts using the SAME
-- canonicalization the gate system (issue #9) binds approvals to.

-- Per-year sequence for DR-yyyy-seq ids. Mirrors venture_counters: the upsert is
-- atomic, and dr.ts takes the event-chain advisory lock first, so id assignment
-- is race-free without a global sequence that could not restart per year.
CREATE TABLE IF NOT EXISTS decision_record_counters (
    year     INT PRIMARY KEY CHECK (year BETWEEN 1000 AND 9999),
    last_seq INT NOT NULL CHECK (last_seq > 0)
);

CREATE TABLE IF NOT EXISTS decision_records (
    id             TEXT PRIMARY KEY CHECK (id ~ '^DR-\d{4}-\d+$'),
    -- The EXACT canonical bytes hashed and bound by approvals/gates. Kept as
    -- TEXT so JSONB normalization can never silently change the hashed content.
    canonical_json TEXT NOT NULL CHECK (length(canonical_json) > 0),
    -- Queryable projection of the same document. NOT a substitute for the
    -- canonical bytes: dr.ts verifies canonicalize(document_json) = canonical_json.
    document_json  JSONB NOT NULL,
    content_digest TEXT NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
    schema_version TEXT NOT NULL CHECK (length(trim(schema_version)) > 0),
    -- An amendment references the DR it amends (must exist; cannot be itself).
    amends_dr_id   TEXT REFERENCES decision_records (id),
    -- The append-only event that filed this DR (1:1).
    file_event_id  TEXT NOT NULL UNIQUE REFERENCES events (id),
    filed_by       TEXT NOT NULL CHECK (length(trim(filed_by)) > 0),
    filed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT decision_records_no_self_amend CHECK (amends_dr_id IS NULL OR amends_dr_id <> id),
    -- Column <-> document binding backstops: the queryable projection can never
    -- disagree with the row identity/version/amendment-link even by direct
    -- INSERT (dr.ts re-checks the same bindings — plus the canonical bytes and
    -- the filing event — at read time). All three use IS NOT DISTINCT FROM:
    -- NULL-safe equality. A plain `=` evaluates to NULL when either side is
    -- NULL, and a NULL CHECK passes — so a document_json MISSING the key would
    -- silently satisfy the very constraint meant to reject it.
    CONSTRAINT decision_records_doc_id_match
        CHECK ((document_json->>'id') IS NOT DISTINCT FROM id),
    CONSTRAINT decision_records_doc_schema_version_match
        CHECK ((document_json->>'schema_version') IS NOT DISTINCT FROM schema_version),
    CONSTRAINT decision_records_doc_amends_match
        CHECK ((document_json->>'amends_dr_id') IS NOT DISTINCT FROM amends_dr_id)
);

CREATE INDEX IF NOT EXISTS decision_records_amends_idx ON decision_records (amends_dr_id);
CREATE INDEX IF NOT EXISTS decision_records_filed_at_idx ON decision_records (filed_at);

-- Close the issue-#9 seam: gate_passes.dr_id was only format-checked (DRs were
-- in-memory then). Now that DRs are filed rows, a gate pass must reference a
-- REAL filed DR even by direct INSERT. Wrapped in a catalog check because
-- ADD CONSTRAINT IF NOT EXISTS is not uniformly available — the migration
-- stays idempotent on a second run.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'gate_passes_dr_id_fk'
          AND conrelid = 'gate_passes'::regclass
    ) THEN
        ALTER TABLE gate_passes
            ADD CONSTRAINT gate_passes_dr_id_fk
            FOREIGN KEY (dr_id) REFERENCES decision_records (id);
    END IF;
END $$;

-- Append-only is enforced by the database, not by convention (same discipline
-- as the events table): the only permitted mutation is INSERT. UPDATE / DELETE /
-- TRUNCATE all raise. One function serves all three (it never references OLD).
CREATE OR REPLACE FUNCTION decision_records_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'decision_records is append-only; % is not permitted (amend by filing a new DR)', TG_OP
        USING ERRCODE = 'restrict_violation';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS decision_records_no_update ON decision_records;
DROP TRIGGER IF EXISTS decision_records_no_delete ON decision_records;
DROP TRIGGER IF EXISTS decision_records_no_truncate ON decision_records;

CREATE TRIGGER decision_records_no_update BEFORE UPDATE ON decision_records
    FOR EACH ROW EXECUTE FUNCTION decision_records_append_only();
CREATE TRIGGER decision_records_no_delete BEFORE DELETE ON decision_records
    FOR EACH ROW EXECUTE FUNCTION decision_records_append_only();
CREATE TRIGGER decision_records_no_truncate BEFORE TRUNCATE ON decision_records
    FOR EACH STATEMENT EXECUTE FUNCTION decision_records_append_only();
