-- ============================================================
-- MIGRATION 042 - Settlement Tax And Payout Details
-- Keeps adjudication tax tracking and net payout available after
-- claims are reloaded from the production database.
-- ============================================================

ALTER TABLE IF EXISTS settlements
    ADD COLUMN IF NOT EXISTS total_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_gst NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_tds NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS net_payout NUMERIC(14,2) NOT NULL DEFAULT 0;

UPDATE settlements
SET
    total_vat = COALESCE(total_vat, 0),
    total_gst = COALESCE(total_gst, 0),
    total_tds = COALESCE(total_tds, 0),
    net_payout = COALESCE(net_payout, 0);
