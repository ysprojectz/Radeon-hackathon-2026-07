-- ============================================================
-- MIGRATION 018 — Account Module Hardening
-- Adds tenant isolation, masked account metadata, validation
-- constraints, and account audit events.
-- ============================================================

ALTER TABLE customer_accounts
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS account_number_last4 VARCHAR(4),
    ADD COLUMN IF NOT EXISTS account_fingerprint VARCHAR(64),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255);

WITH ranked_accounts AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, member_number
            ORDER BY created_at DESC, id DESC
        ) AS rn
    FROM customer_accounts
    WHERE is_primary = TRUE AND deleted_at IS NULL
)
UPDATE customer_accounts ca
SET is_primary = FALSE
FROM ranked_accounts ra
WHERE ca.id = ra.id AND ra.rn > 1;

UPDATE customer_accounts
SET
    verified_at = COALESCE(verified_at, NOW()),
    verified_by = COALESCE(verified_by, 'migration-018')
WHERE verification_status::text = 'VERIFIED'
  AND (verified_at IS NULL OR verified_by IS NULL);

CREATE INDEX IF NOT EXISTS idx_accounts_tenant_member
    ON customer_accounts(tenant_id, member_number, is_primary, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_tenant_claim
    ON customer_accounts(tenant_id, claim_reference)
    WHERE claim_reference IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_fingerprint
    ON customer_accounts(tenant_id, account_fingerprint)
    WHERE account_fingerprint IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_one_primary_per_member
    ON customer_accounts(tenant_id, member_number)
    WHERE is_primary = TRUE AND deleted_at IS NULL;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_ocr_confidence
        CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_payment_rail_present
        CHECK (
            iban IS NOT NULL
            OR account_number_enc IS NOT NULL
            OR upi_vpa IS NOT NULL
            OR routing_number IS NOT NULL
            OR sort_code IS NOT NULL
            OR bsb_number IS NOT NULL
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_gcc_requires_iban
        CHECK (
            market_region::text NOT IN ('UAE', 'KSA', 'BAHRAIN', 'OMAN', 'QATAR', 'KUWAIT')
            OR iban IS NOT NULL
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_india_requires_rail
        CHECK (
            market_region::text <> 'INDIA'
            OR ((account_number_enc IS NOT NULL AND ifsc_code IS NOT NULL) OR upi_vpa IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_iban_format
        CHECK (iban IS NULL OR iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_ifsc_format
        CHECK (ifsc_code IS NULL OR ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_swift_format
        CHECK (swift_bic IS NULL OR swift_bic ~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_upi_format
        CHECK (upi_vpa IS NULL OR upi_vpa ~ '^[A-Za-z0-9._-]{3,50}@[A-Za-z]{3,20}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE customer_accounts
        ADD CONSTRAINT chk_accounts_verified_metadata
        CHECK (
            verification_status::text <> 'VERIFIED'
            OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS customer_account_events (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id      VARCHAR(80) NOT NULL DEFAULT 'default',
    account_id     UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    event_type     VARCHAR(60) NOT NULL,
    actor          VARCHAR(255),
    payload        JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_events_account
    ON customer_account_events(account_id, created_at DESC);

DROP VIEW IF EXISTS v_account_summary;

CREATE OR REPLACE VIEW v_account_summary AS
SELECT
    ca.id,
    ca.tenant_id,
    ca.member_number,
    ca.claim_reference,
    ca.patient_name,
    ca.account_holder_name,
    ca.market_region,
    ca.account_type,
    ca.bank_name,
    CASE
        WHEN ca.iban IS NULL THEN NULL
        ELSE LEFT(ca.iban, 4) || repeat('*', GREATEST(length(ca.iban) - 8, 0)) || RIGHT(ca.iban, 4)
    END AS iban,
    ca.account_number_last4,
    ca.ifsc_code,
    CASE
        WHEN ca.upi_vpa IS NULL THEN NULL
        ELSE regexp_replace(ca.upi_vpa, '^(.{2}).*(@.*)$', '\1***\2')
    END AS upi_vpa,
    ca.swift_bic,
    ca.capture_source,
    ca.ocr_confidence,
    ca.is_primary,
    ca.verification_status,
    ca.verified_at,
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
FROM customer_accounts ca
WHERE ca.deleted_at IS NULL;
