-- ============================================================
-- MIGRATION 036 — Payment Gateway Pre-production Environment
-- Allows Stripe test-mode and PayTM staging credentials to be
-- configured separately from generic sandbox and production.
-- ============================================================

ALTER TABLE IF EXISTS gateway_config
    ALTER COLUMN environment TYPE VARCHAR(20);

ALTER TABLE IF EXISTS gateway_payouts
    ALTER COLUMN environment TYPE VARCHAR(20);

ALTER TABLE IF EXISTS gateway_config
    DROP CONSTRAINT IF EXISTS chk_gateway_config_env;

ALTER TABLE IF EXISTS gateway_config
    ADD CONSTRAINT chk_gateway_config_env
    CHECK (environment IN ('sandbox', 'preproduction', 'production'));
