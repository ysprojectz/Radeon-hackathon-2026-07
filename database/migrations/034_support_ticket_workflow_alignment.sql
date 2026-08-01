-- Align support tickets with claims-operations workflow needs.

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS claim_reference TEXT,
    ADD COLUMN IF NOT EXISTS page_route TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS market_region TEXT NOT NULL DEFAULT 'UAE',
    ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS resolution_notes TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS resolved_by TEXT,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_support_tickets_claim_reference
    ON support_tickets(claim_reference);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status
    ON support_tickets(tenant_id, status, updated_at DESC);
