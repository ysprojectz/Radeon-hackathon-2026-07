-- ============================================================
-- Claims Adjudication Engine — Migration 009
-- Enterprise reliability controls: idempotency + dead-letter queue
-- ============================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key     VARCHAR(128) NOT NULL,
    request_scope       VARCHAR(255) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    request_id          VARCHAR(64),
    claim_reference     VARCHAR(50),
    response_status_code INTEGER,
    response_payload    JSONB,
    error_payload       JSONB,
    completed_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_idempotency_scope UNIQUE (idempotency_key, request_scope)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at
    ON idempotency_keys(expires_at);

CREATE INDEX IF NOT EXISTS idx_idempotency_status
    ON idempotency_keys(status, updated_at DESC);


CREATE TABLE IF NOT EXISTS claim_dead_letters (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_reference     VARCHAR(50),
    request_id          VARCHAR(64),
    idempotency_key     VARCHAR(128),
    source_endpoint     VARCHAR(255) NOT NULL,
    source_channel      VARCHAR(50),
    failure_stage       VARCHAR(64) NOT NULL,
    error_type          VARCHAR(128) NOT NULL,
    error_message       TEXT NOT NULL,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    next_retry_at       TIMESTAMPTZ,
    last_retry_at       TIMESTAMPTZ,
    status              VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    actor_id            VARCHAR(255),
    payload_fingerprint VARCHAR(64),
    payload             JSONB,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letters_status
    ON claim_dead_letters(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dead_letters_claim_reference
    ON claim_dead_letters(claim_reference);

CREATE INDEX IF NOT EXISTS idx_dead_letters_next_retry
    ON claim_dead_letters(next_retry_at);
