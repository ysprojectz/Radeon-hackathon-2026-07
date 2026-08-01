-- Migration 017: Add nhcx_reference and actor_id to advance_claims
-- These columns are written by the India cashless registration endpoint
-- when it submits to NHCX and records the acting user.
-- Uses ADD COLUMN IF NOT EXISTS so it is safe to re-run.

ALTER TABLE advance_claims
    ADD COLUMN IF NOT EXISTS nhcx_reference  VARCHAR(120),
    ADD COLUMN IF NOT EXISTS actor_id        VARCHAR(255);

-- Index for NHCX reference lookups (e.g. status polling)
CREATE INDEX IF NOT EXISTS idx_advance_claims_nhcx
    ON advance_claims(nhcx_reference)
    WHERE nhcx_reference IS NOT NULL;

-- Backfill actor_id from the parent claims row where available
-- UPDATE advance_claims ac
-- SET    actor_id = c.actor_id
-- FROM   claims c
-- WHERE  ac.claim_reference = c.claim_reference
--   AND  ac.actor_id IS NULL
--   AND  c.actor_id IS NOT NULL;
