-- ============================================================
-- Claims Adjudication Engine — Migration 015
-- Add calculation-agent audit event emitted by the pipeline
-- ============================================================

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'CALCULATION_AGENT_VERIFICATION';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'DUPLICATE_CLAIM_DETECTED';
