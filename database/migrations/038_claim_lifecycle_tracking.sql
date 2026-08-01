-- ============================================================
-- MIGRATION 038 — Claim Lifecycle Tracking
-- First-class operational lifecycle state for claim processing.
-- Additive and idempotent: no destructive enum or table changes.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE IF EXISTS claims
    ADD COLUMN IF NOT EXISTS current_stage VARCHAR(64),
    ADD COLUMN IF NOT EXISTS current_stage_status VARCHAR(32),
    ADD COLUMN IF NOT EXISTS current_stage_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lifecycle_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lifecycle_blocker TEXT,
    ADD COLUMN IF NOT EXISTS next_action TEXT;

CREATE TABLE IF NOT EXISTS claim_lifecycle_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_reference VARCHAR(50) NOT NULL,
    tenant_id       VARCHAR(100) NOT NULL DEFAULT 'default',
    stage           VARCHAR(64) NOT NULL,
    state           VARCHAR(32) NOT NULL,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_ms     INTEGER,
    owner_role      VARCHAR(64),
    actor_type      VARCHAR(32),
    actor_id        VARCHAR(255),
    reason          TEXT,
    severity        VARCHAR(24),
    source_service  VARCHAR(64),
    trace_id        VARCHAR(64),
    payload         JSONB NOT NULL DEFAULT '{}',
    event_hash      VARCHAR(64) NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_lifecycle_events_claim_time
    ON claim_lifecycle_events(claim_reference, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claim_lifecycle_events_tenant_stage_state
    ON claim_lifecycle_events(tenant_id, stage, state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claim_lifecycle_events_trace
    ON claim_lifecycle_events(tenant_id, trace_id, created_at DESC)
    WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_claims_lifecycle_current
    ON claims(tenant_id, current_stage, current_stage_status, lifecycle_updated_at DESC)
    WHERE current_stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_claims_lifecycle_region
    ON claims(market_region, current_stage_status, lifecycle_updated_at DESC)
    WHERE current_stage_status IS NOT NULL;
