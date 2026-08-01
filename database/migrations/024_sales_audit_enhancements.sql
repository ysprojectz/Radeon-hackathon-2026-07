-- ============================================================
-- Sales Audit and Reconciliation Enhancements
-- Migration 024
-- ============================================================

-- Track changes to policy_sales for audit trail
CREATE TABLE IF NOT EXISTS policy_sales_audit (
    id                  BIGSERIAL PRIMARY KEY,
    policy_sale_id      UUID NOT NULL,
    changed_by          VARCHAR(255),
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    operation           VARCHAR(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values          JSONB,
    new_values          JSONB,
    change_reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_audit_sale ON policy_sales_audit(policy_sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_audit_changed ON policy_sales_audit(changed_at);

-- Track sales KPIs snapshots for reporting performance
CREATE TABLE IF NOT EXISTS sales_kpi_snapshots (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_date       DATE NOT NULL,
    channel             VARCHAR(20) NOT NULL,
    total_policies      INTEGER NOT NULL DEFAULT 0,
    total_premium       NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_commission    NUMERIC(14,2) NOT NULL DEFAULT 0,
    avg_commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
    policies_bound      INTEGER NOT NULL DEFAULT 0,
    policies_quoted     INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(snapshot_date, channel)
);

ALTER TABLE sales_kpi_snapshots
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_kpi_snapshot_date ON sales_kpi_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshot_channel ON sales_kpi_snapshots(channel);

-- Add check constraint for premium amounts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_premium_non_negative'
    ) THEN
        ALTER TABLE policy_sales
            ADD CONSTRAINT check_premium_non_negative
            CHECK (premium_amount >= 0);
    END IF;
END $$;

-- Add check constraint for sale_date not in future
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_sale_date_not_future'
    ) THEN
        ALTER TABLE policy_sales
            ADD CONSTRAINT check_sale_date_not_future
            CHECK (sale_date <= CURRENT_DATE);
    END IF;
END $$;

-- Comments
COMMENT ON TABLE policy_sales_audit IS 'Audit trail for all changes to policy_sales records';
COMMENT ON TABLE sales_kpi_snapshots IS 'Daily snapshots of sales KPIs by channel for reporting';
COMMENT ON COLUMN policy_sales_audit.operation IS 'Type of operation performed';
COMMENT ON COLUMN policy_sales_audit.old_values IS 'JSON representation of old values';
COMMENT ON COLUMN policy_sales_audit.new_values IS 'JSON representation of new values';

-- Trigger function for audit logging
CREATE OR REPLACE FUNCTION audit_policy_sales_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO policy_sales_audit (policy_sale_id, operation, old_values, change_reason)
        VALUES (OLD.id, 'DELETE', row_to_json(OLD), current_setting('audit.change_reason', true));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO policy_sales_audit (policy_sale_id, operation, old_values, new_values, change_reason)
        VALUES (NEW.id, 'UPDATE', row_to_json(OLD), row_to_json(NEW), current_setting('audit.change_reason', true));
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO policy_sales_audit (policy_sale_id, operation, new_values, change_reason)
        VALUES (NEW.id, 'INSERT', row_to_json(NEW), current_setting('audit.change_reason', true));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_policy_sales ON policy_sales;
CREATE TRIGGER trg_audit_policy_sales
    AFTER INSERT OR UPDATE OR DELETE ON policy_sales
    FOR EACH ROW EXECUTE FUNCTION audit_policy_sales_changes();

-- Function to capture KPI snapshots
CREATE OR REPLACE FUNCTION capture_sales_kpi_snapshot(
    p_snapshot_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    channel VARCHAR(20),
    total_policies INTEGER,
    total_premium NUMERIC(14,2),
    total_commission NUMERIC(14,2),
    avg_commission_pct NUMERIC(5,2)
) AS $$
BEGIN
    RETURN QUERY
    INSERT INTO sales_kpi_snapshots (snapshot_date, channel, total_policies, total_premium, 
                                      total_commission, avg_commission_pct, policies_bound, policies_quoted)
    SELECT 
        p_snapshot_date,
        ps.channel,
        COUNT(*)::INTEGER as total_policies,
        COALESCE(SUM(ps.premium_amount), 0) as total_premium,
        COALESCE(SUM(ps.commission_amount), 0) as total_commission,
        CASE 
            WHEN SUM(ps.premium_amount) > 0 
            THEN (SUM(ps.commission_amount) / NULLIF(SUM(ps.premium_amount), 0) * 100)::NUMERIC(5,2)
            ELSE 0 
        END as avg_commission_pct,
        COUNT(*) FILTER (WHERE ps.status = 'BOUND')::INTEGER,
        COUNT(*) FILTER (WHERE ps.status = 'QUOTED')::INTEGER
    FROM policy_sales ps
    WHERE ps.sale_date >= date_trunc('month', p_snapshot_date - interval '1 month')
      AND ps.sale_date < date_trunc('month', p_snapshot_date + interval '1 month')
    GROUP BY ps.channel
    ON CONFLICT (snapshot_date, channel) 
    DO UPDATE SET
        total_policies = EXCLUDED.total_policies,
        total_premium = EXCLUDED.total_premium,
        total_commission = EXCLUDED.total_commission,
        avg_commission_pct = EXCLUDED.avg_commission_pct,
        policies_bound = EXCLUDED.policies_bound,
        policies_quoted = EXCLUDED.policies_quoted,
        updated_at = NOW()
    RETURNING 
        channel, total_policies, total_premium, total_commission, avg_commission_pct;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION capture_sales_kpi_snapshot IS 'Capture daily KPI snapshot for sales reporting';

-- Grant permissions
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claims_reader') THEN
        GRANT SELECT ON sales_kpi_snapshots TO claims_reader;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claims_admin') THEN
        GRANT SELECT, INSERT, UPDATE ON policy_sales_audit TO claims_admin;
    END IF;
END $$;
