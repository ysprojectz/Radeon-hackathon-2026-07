-- ============================================================
-- MIGRATION 041 — Account Cashfree Sync Status
-- Adds Cashfree as a first-class account gateway provider so
-- bank verification and payout closure can show the same state
-- model as Stripe and PayTM.
-- ============================================================

ALTER TABLE IF EXISTS customer_accounts
    ADD COLUMN IF NOT EXISTS cashfree_customer_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS cashfree_account_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS cashfree_sync_status gateway_sync_status NOT NULL DEFAULT 'NOT_SYNCED',
    ADD COLUMN IF NOT EXISTS cashfree_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cashfree_sync_error TEXT;

UPDATE customer_accounts
SET cashfree_sync_status = 'NOT_SYNCED'
WHERE cashfree_sync_status IS NULL;

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
    ca.iban,
    ca.account_number_last4,
    ca.ifsc_code,
    ca.upi_vpa,
    ca.swift_bic,
    ca.capture_source,
    ca.ocr_confidence,
    ca.is_primary,
    ca.verification_status,
    ca.verified_at,
    CASE
        WHEN ca.stripe_sync_status = 'SYNCED'
             AND ca.paytm_sync_status = 'SYNCED'
             AND ca.cashfree_sync_status = 'SYNCED'
            THEN 'FULLY_SYNCED'
        WHEN ca.stripe_sync_status = 'SYNCED'
             OR ca.paytm_sync_status = 'SYNCED'
             OR ca.cashfree_sync_status = 'SYNCED'
            THEN 'PARTIAL_SYNC'
        WHEN ca.stripe_sync_status = 'SYNC_FAILED'
             OR ca.paytm_sync_status = 'SYNC_FAILED'
             OR ca.cashfree_sync_status = 'SYNC_FAILED'
            THEN 'SYNC_FAILED'
        ELSE 'NOT_SYNCED'
    END AS gateway_summary,
    ca.stripe_sync_status,
    ca.paytm_sync_status,
    ca.cashfree_sync_status,
    ca.created_at,
    ca.updated_at
FROM customer_accounts ca;
