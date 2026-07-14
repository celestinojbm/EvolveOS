-- 0004_ventures.sql — single venture record + macro-state machine, stages 1-12
-- (issue #8, P0-7). Part V stages 1-12, simplified per BUILDABILITY_AUDIT §6(f):
-- a linear stage enum with the stage 5-9 analysis block as a checklist inside
-- the single macro-state 'analysis'. Stages 13+ (G-07 onward) are out of scope.
--
-- The ventures row is a queryable projection; the append-only event log is the
-- audit source of truth. app/src/lib/venture.ts is the writer: every creation,
-- stage advance, checklist completion, and kill is recorded as an event in the
-- SAME transaction as the row change (the issue-#7 atomicity discipline).
--
-- DB constraints are a backstop for impossible states; the transition logic
-- itself lives (auditable, in one declarative table) in venture.ts.

CREATE TABLE IF NOT EXISTS ventures (
    id                 TEXT PRIMARY KEY CHECK (id ~ '^V-\d{4}-\d+$'),
    name               TEXT NOT NULL,
    -- Linear macro-state enum. Stages: 1=opportunity_discovery, 2=trend_analysis,
    -- 3=research, 4=validation, 5-9=analysis (checklist), 10=prototype, 11=mvp,
    -- 12=pmf. 'archived' is the only terminal state (pre-entity kill target).
    state              TEXT NOT NULL DEFAULT 'opportunity_discovery' CHECK (state IN (
                           'opportunity_discovery', 'trend_analysis', 'research',
                           'validation', 'analysis', 'prototype', 'mvp', 'pmf',
                           'archived')),
    -- Stage 5-9 analysis block: {item: {completed_at, actor, evidence_ref}}.
    -- Keys are restricted to the five canonical items (jsonb minus the allowed
    -- keys must leave an empty object).
    analysis_checklist JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
                           analysis_checklist
                           - ARRAY['customer_discovery', 'competitive_analysis',
                                   'financial_modeling', 'risk_analysis',
                                   'legal_analysis']
                           = '{}'::jsonb),
    post_mortem_ref    TEXT,
    archived_reason    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at        TIMESTAMPTZ,
    -- Kill path backstop: archived REQUIRES the post-mortem artifact reference,
    -- a reason, and a timestamp; a live venture must carry none of them.
    CONSTRAINT ventures_archived_requires_postmortem CHECK (
        state <> 'archived'
        OR (post_mortem_ref IS NOT NULL AND length(post_mortem_ref) > 0
            AND archived_reason IS NOT NULL AND archived_at IS NOT NULL)),
    CONSTRAINT ventures_live_has_no_postmortem CHECK (
        state = 'archived'
        OR (post_mortem_ref IS NULL AND archived_reason IS NULL AND archived_at IS NULL))
);

-- Per-year sequence for V-yyyy-seq ids. Incremented under the event-chain
-- advisory lock inside createVenture's transaction, so id assignment is
-- race-free without a global Postgres sequence that could not restart per year.
CREATE TABLE IF NOT EXISTS venture_counters (
    year     INT PRIMARY KEY,
    last_seq INT NOT NULL
);
