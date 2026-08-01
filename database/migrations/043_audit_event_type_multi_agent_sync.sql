-- ============================================================
-- Claims Adjudication Engine — Migration 043
-- Sync audit_event_type enum with currently emitted pipeline events
-- (dual-agent consensus verification path)
-- ============================================================

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'MULTI_AGENT_CONSENSUS';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'SHADOW_AGENT_ERROR';
