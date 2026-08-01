-- ============================================================
-- MIGRATION 017 — Customer Account Module
-- Stores bank / payment account details captured from claim
-- documents (OCR), manual entry, or advance processing.
-- Supports multi-market payment rails:
--   GCC/UAE/KSA  → IBAN
--   India        → Account number + IFSC + UPI/VPA
--   Global       → SWIFT/BIC
-- Gateway integration: Stripe Connect, PayTM Payout API
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE account_type AS ENUM (
    'SAVINGS', 'CURRENT', 'CHECKING', 'NRE', 'NRO', 'WALLET', 'UPI', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capture_source AS ENUM (
    'OCR_AUTO',           -- extracted automatically from PDF
    'OCR_REVIEWED',       -- OCR extraction reviewed and confirmed by adjuster
    'MANUAL',             -- entered manually by adjuster/admin
    'ADVANCE_PROCESSING', -- captured during advance/cashless flow
    'PATIENT_PORTAL'      -- submitted by patient via portal
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_verification_status AS ENUM (
    'UNVERIFIED',   -- just captured, not validated
    'PENDING',      -- verification in progress (e.g. micro-deposit)
    'VERIFIED',     -- confirmed valid
    'FAILED',       -- verification attempt failed
    'BLOCKED'       -- flagged / blocked by compliance
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gateway_sync_status AS ENUM (
    'NOT_SYNCED',
    'SYNCING',
    'SYNCED',
    'SYNC_FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Main table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_accounts (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- ── Identity linkage ─────────────────────────────────────────────────
    member_number           VARCHAR(50) NOT NULL,           -- FK soft-ref to members
    claim_reference         VARCHAR(50),                    -- source claim (nullable — can be manual)
    patient_name            VARCHAR(255) NOT NULL,
    market_region           market_region NOT NULL DEFAULT 'UAE',

    -- ── Account details ───────────────────────────────────────────────────
    account_holder_name     VARCHAR(255) NOT NULL,
    account_type            account_type NOT NULL DEFAULT 'SAVINGS',
    bank_name               VARCHAR(255),

    -- GCC / International
    iban                    VARCHAR(34),                    -- ISO 13616 — up to 34 chars
    swift_bic               VARCHAR(11),                    -- 8 or 11 char BIC

    -- India-specific
    account_number_enc      VARCHAR(512),                   -- AES-256 encrypted at app layer
    ifsc_code               VARCHAR(11),                    -- 11-char IFSC
    upi_vpa                 VARCHAR(255),                   -- UPI Virtual Payment Address
    upi_provider            VARCHAR(50),                    -- @okicici, @paytm, @ybl, etc.

    -- Other markets
    routing_number          VARCHAR(20),                    -- USA ABA / ACH
    sort_code               VARCHAR(10),                    -- UK 6-digit
    bsb_number              VARCHAR(10),                    -- Australia
    branch_address          TEXT,

    -- ── Confidence & provenance ───────────────────────────────────────────
    capture_source          capture_source NOT NULL DEFAULT 'OCR_AUTO',
    ocr_confidence          NUMERIC(5,4),                   -- 0.0000 – 1.0000
    raw_ocr_text            TEXT,                           -- original OCR snippet for audit
    is_primary              BOOLEAN NOT NULL DEFAULT TRUE,  -- preferred account for member

    -- ── Verification ─────────────────────────────────────────────────────
    verification_status     account_verification_status NOT NULL DEFAULT 'UNVERIFIED',
    verified_at             TIMESTAMPTZ,
    verified_by             VARCHAR(255),                   -- user who verified

    -- ── Payment gateway integration ───────────────────────────────────────
    -- Stripe
    stripe_customer_id      VARCHAR(100),                   -- cus_xxx
    stripe_bank_account_id  VARCHAR(100),                   -- ba_xxx
    stripe_sync_status      gateway_sync_status NOT NULL DEFAULT 'NOT_SYNCED',
    stripe_synced_at        TIMESTAMPTZ,
    stripe_sync_error       TEXT,

    -- PayTM
    paytm_customer_id       VARCHAR(100),
    paytm_vpa               VARCHAR(255),
    paytm_sync_status       gateway_sync_status NOT NULL DEFAULT 'NOT_SYNCED',
    paytm_synced_at         TIMESTAMPTZ,
    paytm_sync_error        TEXT,

    -- ── Audit ─────────────────────────────────────────────────────────────
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              VARCHAR(255),
    notes                   TEXT
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_accounts_member
    ON customer_accounts(member_number, is_primary, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounts_claim
    ON customer_accounts(claim_reference)
    WHERE claim_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_market
    ON customer_accounts(market_region, verification_status);

CREATE INDEX IF NOT EXISTS idx_accounts_iban
    ON customer_accounts(iban)
    WHERE iban IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_ifsc
    ON customer_accounts(ifsc_code)
    WHERE ifsc_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_upi
    ON customer_accounts(upi_vpa)
    WHERE upi_vpa IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_stripe_customer
    ON customer_accounts(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_paytm_customer
    ON customer_accounts(paytm_customer_id)
    WHERE paytm_customer_id IS NOT NULL;

-- ── Auto-update updated_at ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_account_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON customer_accounts;
CREATE TRIGGER trg_accounts_updated_at
    BEFORE UPDATE ON customer_accounts
    FOR EACH ROW EXECUTE FUNCTION update_account_updated_at();

-- ── View: accounts with gateway summary ───────────────────────────────────────

CREATE OR REPLACE VIEW v_account_summary AS
SELECT
    ca.id,
    ca.member_number,
    ca.claim_reference,
    ca.patient_name,
    ca.account_holder_name,
    ca.market_region,
    ca.account_type,
    ca.bank_name,
    ca.iban,
    ca.ifsc_code,
    ca.upi_vpa,
    ca.swift_bic,
    ca.capture_source,
    ca.ocr_confidence,
    ca.is_primary,
    ca.verification_status,
    ca.verified_at,
    -- gateway summary
    CASE
        WHEN ca.stripe_sync_status = 'SYNCED' AND ca.paytm_sync_status = 'SYNCED' THEN 'FULLY_SYNCED'
        WHEN ca.stripe_sync_status = 'SYNCED' OR ca.paytm_sync_status = 'SYNCED'  THEN 'PARTIAL_SYNC'
        WHEN ca.stripe_sync_status = 'SYNC_FAILED' OR ca.paytm_sync_status = 'SYNC_FAILED' THEN 'SYNC_FAILED'
        ELSE 'NOT_SYNCED'
    END AS gateway_summary,
    ca.stripe_sync_status,
    ca.paytm_sync_status,
    ca.created_at,
    ca.updated_at
FROM customer_accounts ca;
