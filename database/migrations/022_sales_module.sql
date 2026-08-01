-- ============================================================
-- Sales Module Migration 022
-- Creates tables for tracking policy sales, agents, commissions, quotes,
-- and marketing attribution.
-- ============================================================

-- ============================================================
-- SALES AGENTS / BROKERS
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_agents (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email                       VARCHAR(255) UNIQUE NOT NULL,
    full_name                   VARCHAR(255) NOT NULL,
    phone                       VARCHAR(50),
    license_number              VARCHAR(100),
    agency_name                 VARCHAR(255),
    market_region               market_region NOT NULL DEFAULT 'UAE',
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_agents_email ON sales_agents(email);
CREATE INDEX IF NOT EXISTS idx_sales_agents_region ON sales_agents(market_region);
CREATE INDEX IF NOT EXISTS idx_sales_agents_active ON sales_agents(is_active) WHERE is_active = TRUE;


-- ============================================================
-- QUOTES (Pre-sale estimates)
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_reference             VARCHAR(50) UNIQUE NOT NULL,
    member_id                   UUID REFERENCES members(id) ON DELETE SET NULL,
    policy_id                   UUID REFERENCES policies(id) ON DELETE SET NULL,
    premium_quoted              NUMERIC(14,2) NOT NULL,
    effective_date_proposed     DATE,
    expiry_date                 DATE,
    status                      VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED')),
    sent_at                     TIMESTAMPTZ,
    accepted_at                 TIMESTAMPTZ,
    converted_to_sale_id        UUID,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_member ON quotes(member_id);
CREATE INDEX IF NOT EXISTS idx_quotes_policy ON quotes(policy_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_reference ON quotes(quote_reference);


-- ============================================================
-- POLICY SALES (Core sales tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS policy_sales (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id                   UUID NOT NULL REFERENCES policies(id) ON DELETE RESTRICT,
    agent_id                    UUID REFERENCES sales_agents(id) ON DELETE SET NULL,
    member_id                   UUID REFERENCES members(id) ON DELETE SET NULL,
    sale_date                   DATE NOT NULL,
    effective_date              DATE NOT NULL,
    channel                     VARCHAR(20) NOT NULL DEFAULT 'DIRECT' CHECK (channel IN ('DIRECT', 'BROKER', 'TPA', 'ONLINE', 'REFERRAL', 'WALK_IN')),
    premium_amount              NUMERIC(14,2) NOT NULL,
    commission_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
    commission_pct              NUMERIC(5,2) NOT NULL DEFAULT 0,
    status                      VARCHAR(20) NOT NULL DEFAULT 'BOUND' CHECK (status IN ('QUOTED', 'BOUND', 'CANCELLED', 'LAPSED', 'EXPIRED')),
    quote_id                    UUID REFERENCES quotes(id) ON DELETE SET NULL,
    binder_number               VARCHAR(100),
    signed_at                   TIMESTAMPTZ,
    tenant_id                   VARCHAR(100) NOT NULL DEFAULT 'default',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT policy_sales_unique_policy UNIQUE(policy_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_sales_policy ON policy_sales(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_sales_agent ON policy_sales(agent_id);
CREATE INDEX IF NOT EXISTS idx_policy_sales_member ON policy_sales(member_id);
CREATE INDEX IF NOT EXISTS idx_policy_sales_sale_date ON policy_sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_policy_sales_tenant_status ON policy_sales(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_policy_sales_channel ON policy_sales(channel);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotes_converted_to_sale_id_fkey'
    ) THEN
        ALTER TABLE quotes
            ADD CONSTRAINT quotes_converted_to_sale_id_fkey
            FOREIGN KEY (converted_to_sale_id) REFERENCES policy_sales(id) ON DELETE SET NULL;
    END IF;
END $$;


-- ============================================================
-- COMMISSIONS (Payment tracking for agents)
-- ============================================================
CREATE TABLE IF NOT EXISTS commissions (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_sale_id              UUID NOT NULL REFERENCES policy_sales(id) ON DELETE CASCADE,
    agent_id                    UUID NOT NULL REFERENCES sales_agents(id) ON DELETE RESTRICT,
    amount                      NUMERIC(14,2) NOT NULL,
    currency                    currency NOT NULL DEFAULT 'AED',
    paid_at                     TIMESTAMPTZ,
    payment_reference           VARCHAR(255),
    status                      VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'ADJUSTED', 'DISPUTED')),
    notes                       TEXT,
    tenant_id                   VARCHAR(100) NOT NULL DEFAULT 'default',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT commissions_amount_non_negative CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_commissions_agent ON commissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_commissions_policy_sale ON commissions(policy_sale_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_paid_at ON commissions(paid_at) WHERE paid_at IS NOT NULL;


-- ============================================================
-- SALES ATTRIBUTION (Marketing channel tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_attribution (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_sale_id              UUID NOT NULL REFERENCES policy_sales(id) ON DELETE CASCADE,
    source                      VARCHAR(50) NOT NULL CHECK (source IN ('GOOGLE_ADS', 'FACEBOOK_ADS', 'REFERRAL', 'WALK_IN', 'WEB_DIRECT', 'EMAIL_CAMPAIGN', 'AFFILIATE', 'PARTNER')),
    campaign_id                 VARCHAR(255),
    utm_source                  VARCHAR(100),
    utm_medium                  VARCHAR(100),
    utm_campaign                VARCHAR(100),
    utm_content                 VARCHAR(255),
    utm_term                    VARCHAR(255),
    attribution_data            JSONB NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_attr_policy ON sales_attribution(policy_sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_attr_source ON sales_attribution(source);
CREATE INDEX IF NOT EXISTS idx_sales_attr_campaign ON sales_attribution(campaign_id);


-- ============================================================
-- AUDIT LOGGING FOR SALES TABLES
-- ============================================================
-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_sales_agents_updated_at ON sales_agents;
CREATE TRIGGER update_sales_agents_updated_at BEFORE UPDATE ON sales_agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quotes_updated_at ON quotes;
CREATE TRIGGER update_quotes_updated_at BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_policy_sales_updated_at ON policy_sales;
CREATE TRIGGER update_policy_sales_updated_at BEFORE UPDATE ON policy_sales
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_commissions_updated_at ON commissions;
CREATE TRIGGER update_commissions_updated_at BEFORE UPDATE ON commissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_policy_sale_auto_create ON policies;
DROP FUNCTION IF EXISTS auto_create_policy_sale();

-- ============================================================
-- COMMENTS ON TABLES
-- ============================================================
COMMENT ON TABLE sales_agents IS 'Sales agents and brokers who sell policies';
COMMENT ON TABLE quotes IS 'Pre-sale premium quotes (leads) before conversion to bound policies';
COMMENT ON TABLE policy_sales IS 'Core sales tracking - who sold what policy, when, through which channel';
COMMENT ON TABLE commissions IS 'Commission payments to agents for policy sales';
COMMENT ON TABLE sales_attribution IS 'Marketing attribution for policy sales (channel, campaign tracking)';

COMMENT ON COLUMN policy_sales.channel IS 'Sales channel: DIRECT (internal), BROKER (external agent), TPA (third-party administrator), ONLINE (digital), REFERRAL, WALK_IN';
COMMENT ON COLUMN policy_sales.commission_pct IS 'Commission percentage applied to premium_amount';
COMMENT ON COLUMN policy_sales.premium_amount IS 'Annual premium amount for this policy';
COMMENT ON COLUMN commissions.amount IS 'Commission amount to be paid to agent';
COMMENT ON COLUMN policy_sales.binder_number IS 'Insurance binder/reference number issued to policyholder';
