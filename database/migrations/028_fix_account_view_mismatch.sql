-- ============================================================
-- MIGRATION 028 — Fix View Mismatch for Accounts List
-- Re-creates the v_account_summary view to include the 
-- latest fields and ensure it doesn't block the accounts list.
-- ============================================================

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
    -- gateway summary logic
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
