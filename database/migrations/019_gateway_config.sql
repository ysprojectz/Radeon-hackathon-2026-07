-- ============================================================
-- MIGRATION 019 — Payment Gateway Configuration & Payouts
-- Adds encrypted gateway credential storage and a payout
-- transaction ledger for Stripe and PayTM.
-- ============================================================

-- ── Gateway configuration (one row per tenant × gateway) ─────────────────────
CREATE TABLE IF NOT EXISTS gateway_config (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(80)  NOT NULL DEFAULT 'default',
    gateway         VARCHAR(20)  NOT NULL,          -- 'stripe' | 'paytm'
    environment     VARCHAR(20)  NOT NULL DEFAULT 'sandbox', -- 'sandbox' | 'preproduction' | 'production'
    is_enabled      BOOLEAN      NOT NULL DEFAULT false,

    -- Stripe fields (all nullable; only populated when gateway='stripe')
    stripe_publishable_key_enc  TEXT,  -- pk_test_*** / pk_live_***  (Fernet-encrypted)
    stripe_secret_key_enc       TEXT,  -- sk_test_*** / sk_live_***  (Fernet-encrypted)
    stripe_webhook_secret_enc   TEXT,  -- whsec_***                  (Fernet-encrypted)
    stripe_account_id           VARCHAR(120),  -- acct_*** (not secret)

    -- PayTM fields
    paytm_merchant_id           VARCHAR(80),   -- MID (not secret)
    paytm_merchant_key_enc      TEXT,          -- Fernet-encrypted
    paytm_website               VARCHAR(80)  DEFAULT 'WEBSTAGING',
    paytm_industry_type         VARCHAR(40)  DEFAULT 'Retail',
    paytm_channel_id            VARCHAR(20)  DEFAULT 'WEB',

    -- Connection-test metadata
    last_tested_at   TIMESTAMPTZ,
    last_test_status VARCHAR(10),   -- 'ok' | 'failed'
    last_test_error  TEXT,

    -- Audit
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by   VARCHAR(255),
    updated_by   VARCHAR(255),

    CONSTRAINT uq_gateway_config_tenant_gw UNIQUE (tenant_id, gateway),
    CONSTRAINT chk_gateway_config_gateway  CHECK (gateway IN ('stripe', 'paytm')),
    CONSTRAINT chk_gateway_config_env      CHECK (environment IN ('sandbox', 'preproduction', 'production')),
    CONSTRAINT chk_gateway_config_test_status
        CHECK (last_test_status IS NULL OR last_test_status IN ('ok', 'failed'))
);

-- ── Payout transaction ledger ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gateway_payouts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(80)  NOT NULL DEFAULT 'default',
    account_id      UUID         NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
    claim_reference VARCHAR(50),

    gateway         VARCHAR(20)  NOT NULL,
    environment     VARCHAR(20)  NOT NULL DEFAULT 'sandbox',

    -- Amount (stored in minor units — fils/paise/cents)
    amount_minor    BIGINT       NOT NULL CHECK (amount_minor > 0),
    currency        VARCHAR(3)   NOT NULL DEFAULT 'AED',

    -- Gateway response
    gateway_txn_id   VARCHAR(200),  -- Stripe transfer_id / PayTM ORDER_ID
    gateway_ref      VARCHAR(200),  -- Stripe balance_transaction / PayTM TXNID
    gateway_response JSONB         NOT NULL DEFAULT '{}',

    -- Status lifecycle
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    failure_reason  TEXT,

    initiated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    processing_at   TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,

    initiated_by    VARCHAR(255),
    metadata        JSONB        NOT NULL DEFAULT '{}',

    CONSTRAINT chk_payout_gateway  CHECK (gateway IN ('stripe', 'paytm')),
    CONSTRAINT chk_payout_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_payout_status   CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED'))
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_gateway_config_tenant
    ON gateway_config(tenant_id, gateway);

CREATE INDEX IF NOT EXISTS idx_gateway_payouts_account
    ON gateway_payouts(account_id, initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gateway_payouts_tenant_status
    ON gateway_payouts(tenant_id, status, initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gateway_payouts_claim
    ON gateway_payouts(tenant_id, claim_reference)
    WHERE claim_reference IS NOT NULL;

-- ── Generic updated_at trigger function (idempotent) ─────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── updated_at triggers ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_gateway_config_updated_at ON gateway_config;
CREATE TRIGGER trg_gateway_config_updated_at
    BEFORE UPDATE ON gateway_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Seed default rows (disabled, unconfigured) ────────────────────────────────
INSERT INTO gateway_config (tenant_id, gateway, environment, is_enabled)
VALUES
    ('default', 'stripe', 'preproduction', false),
    ('default', 'paytm',  'preproduction', false)
ON CONFLICT (tenant_id, gateway) DO NOTHING;
