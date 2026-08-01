-- ============================================================
-- MIGRATION 037 — Account Verification Attempts
-- Durable audit trail for bank/IBAN/UPI verification before payout.
-- ============================================================

ALTER TABLE IF EXISTS gateway_config
    ADD COLUMN IF NOT EXISTS paytm_subwallet_guid VARCHAR(120),
    ADD COLUMN IF NOT EXISTS cashfree_client_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS cashfree_client_secret_enc TEXT;

ALTER TABLE IF EXISTS gateway_config
    DROP CONSTRAINT IF EXISTS chk_gateway_config_gateway;

ALTER TABLE IF EXISTS gateway_config
    ADD CONSTRAINT chk_gateway_config_gateway
    CHECK (gateway IN ('stripe', 'paytm', 'cashfree'));

INSERT INTO gateway_config (tenant_id, gateway, environment, is_enabled)
VALUES ('default', 'cashfree', 'preproduction', false)
ON CONFLICT (tenant_id, gateway) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_verification_attempts (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            VARCHAR(80) NOT NULL DEFAULT 'default',
    account_id           UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    provider             VARCHAR(40) NOT NULL,
    environment          VARCHAR(20) NOT NULL DEFAULT 'preproduction',
    request_id           VARCHAR(80) NOT NULL,
    status               account_verification_status NOT NULL DEFAULT 'PENDING',
    status_reason        TEXT,
    rail_type            VARCHAR(20),
    bank_name            VARCHAR(255),
    branch_name          VARCHAR(255),
    account_holder_name  VARCHAR(255),
    holder_match_score   NUMERIC(5,4),
    provider_reference   VARCHAR(120),
    provider_response    JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by           VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_account_verification_attempts_account
    ON account_verification_attempts(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_verification_attempts_tenant_status
    ON account_verification_attempts(tenant_id, status, created_at DESC);
