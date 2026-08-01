-- ============================================================
-- Claims Adjudication Engine — Migration 010
-- Enterprise controls: tenant propagation, saga/event store,
-- compliance automation, and observability metadata
-- ============================================================

ALTER TABLE claims
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS trace_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

ALTER TABLE settlements
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'default';

ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'default';

ALTER TABLE hitl_reviews
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'default';

ALTER TABLE claim_dead_letters
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS trace_id VARCHAR(64);

ALTER TABLE idempotency_keys
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_claims_tenant_status_date
    ON claims(tenant_id, status, date_received DESC);

CREATE INDEX IF NOT EXISTS idx_claims_tenant_reference
    ON claims(tenant_id, claim_reference);

CREATE TABLE IF NOT EXISTS claim_processing_sagas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_reference VARCHAR(50) UNIQUE NOT NULL,
    tenant_id       VARCHAR(100) NOT NULL DEFAULT 'default',
    saga_status     VARCHAR(32) NOT NULL,
    current_step    VARCHAR(64) NOT NULL,
    trace_id        VARCHAR(64),
    source_channel  VARCHAR(50),
    last_error      TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_sagas_status
    ON claim_processing_sagas(tenant_id, saga_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS claim_processing_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_reference VARCHAR(50) NOT NULL,
    tenant_id       VARCHAR(100) NOT NULL DEFAULT 'default',
    event_sequence  INTEGER NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_payload   JSONB NOT NULL DEFAULT '{}',
    source_service  VARCHAR(64) NOT NULL,
    trace_id        VARCHAR(64),
    correlation_id  VARCHAR(64),
    event_hash      VARCHAR(64) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_processing_events_hash
    ON claim_processing_events(claim_reference, event_hash);

CREATE INDEX IF NOT EXISTS idx_claim_processing_events_lookup
    ON claim_processing_events(tenant_id, claim_reference, event_timestamp DESC);

CREATE TABLE IF NOT EXISTS compliance_updates (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market            VARCHAR(32) NOT NULL,
    regulatory_body   VARCHAR(255) NOT NULL,
    source            VARCHAR(500) NOT NULL,
    effective_date    DATE,
    clauses_hash      VARCHAR(64) NOT NULL,
    clause_count      INTEGER NOT NULL DEFAULT 0,
    uploaded_by       VARCHAR(255),
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes             TEXT,
    payload           JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_compliance_updates_market_date
    ON compliance_updates(market, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS compliance_verifications (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market            VARCHAR(32),
    verification_type VARCHAR(64) NOT NULL,
    result_status     VARCHAR(32) NOT NULL,
    details           JSONB NOT NULL DEFAULT '{}',
    verified_by       VARCHAR(255),
    verified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_verifications_market
    ON compliance_verifications(market, verified_at DESC);
