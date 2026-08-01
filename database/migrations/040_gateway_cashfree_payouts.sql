-- ============================================================
-- MIGRATION 040 — Cashfree Payout Ledger Compatibility
-- Allows the payout ledger to track Cashfree sandbox/pre-production
-- checkout closure alongside Stripe and PayTM.
-- ============================================================

ALTER TABLE IF EXISTS gateway_payouts
    DROP CONSTRAINT IF EXISTS chk_payout_gateway;

ALTER TABLE IF EXISTS gateway_payouts
    ADD CONSTRAINT chk_payout_gateway
    CHECK (gateway IN ('stripe', 'paytm', 'cashfree'));
