-- 0004_ventures.sql — single venture record + macro-state machine, stages 1-12
-- (issue #8, P0-7). Part V stages 1-12, simplified per BUILDABILITY_AUDIT §6(f):
-- a linear stage enum with the stage 5-9 analysis block as a checklist inside
-- the single macro-state 'analysis'. Stages 13+ (G-07 onward) are out of scope.
--
-- Venture birth (Part V §1.2): venture ids are MINTED AT G-01 PASS; pre-G-01
-- opportunity briefs are knowledge items, not ventures. So stage 1 (Opportunity
-- Discovery) has no row here, and every row is born in 'trend_analysis'
-- carrying the opportunity-brief reference and the G-01 authorization it was
-- minted from.
--
-- The ventures row is a queryable projection; the append-only event log is the
-- audit source of truth. app/src/lib/venture.ts is the writer: every creation,
-- stage advance, handoff, checklist completion, and kill is recorded as an
-- event in the SAME transaction as the row change (the issue-#7 atomicity
-- discipline).
--
-- DB constraints are a backstop for impossible states; the transition logic
-- itself lives (auditable, in one declarative table) in venture.ts.

-- Backstop helper: every filed analysis-checklist entry must carry a non-empty
-- artifact reference (G-04 consumes real outputs, not bare checkmarks).
CREATE OR REPLACE FUNCTION analysis_items_have_evidence(checklist JSONB)
RETURNS boolean
IMMUTABLE
LANGUAGE sql
AS $$
    SELECT coalesce(
        (SELECT bool_and(coalesce(trim(value ->> 'evidence_ref'), '') <> '')
           FROM jsonb_each(checklist)),
        true);
$$;

CREATE TABLE IF NOT EXISTS ventures (
    id                 TEXT PRIMARY KEY CHECK (id ~ '^V-\d{4}-\d+$'),
    name               TEXT NOT NULL,
    -- Linear macro-state enum. Stages: 2=trend_analysis (birth state, G-01),
    -- 3=research, 4=validation, 5-9=analysis (checklist), 10=prototype, 11=mvp,
    -- 12=pmf. 'archived' is the only terminal state (pre-entity kill target).
    -- Stage 1 (Opportunity Discovery) is pre-venture and never persisted here.
    state              TEXT NOT NULL CHECK (state IN (
                           'trend_analysis', 'research', 'validation', 'analysis',
                           'prototype', 'mvp', 'pmf', 'archived')),
    -- Birth references (Part V §1.2): the pre-G-01 opportunity brief / KI this
    -- venture was minted from, and the G-01 authorization (DR) that minted it.
    opportunity_ref    TEXT NOT NULL CHECK (length(trim(opportunity_ref)) > 0),
    entry_dr_ref       TEXT NOT NULL CHECK (length(trim(entry_dr_ref)) > 0),
    -- Stage 5-9 analysis block: {item: {completed_at, actor, evidence_ref}}.
    -- Keys are restricted to the five canonical items, and every entry must
    -- carry a non-empty artifact reference.
    analysis_checklist JSONB NOT NULL DEFAULT '{}'::jsonb
                       CHECK (
                           analysis_checklist
                           - ARRAY['customer_discovery', 'competitive_analysis',
                                   'financial_modeling', 'risk_analysis',
                                   'legal_analysis']
                           = '{}'::jsonb)
                       CHECK (analysis_items_have_evidence(analysis_checklist)),
    post_mortem_ref    TEXT,
    archived_reason    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at        TIMESTAMPTZ,
    -- Kill path backstop: archived REQUIRES the post-mortem artifact reference,
    -- a reason, and a timestamp; a live venture must carry none of them.
    CONSTRAINT ventures_archived_requires_postmortem CHECK (
        state <> 'archived'
        OR (post_mortem_ref IS NOT NULL AND length(trim(post_mortem_ref)) > 0
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
