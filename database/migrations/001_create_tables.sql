-- ============================================================
-- Claims Adjudication Engine — Database Migration 001
-- Creates all core tables for GCC + India markets
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
    CREATE TYPE claim_status AS ENUM (
        'RECEIVED', 'INTAKE_PROCESSING', 'INTAKE_COMPLETE', 'INTAKE_FAILED',
        'POLICY_RETRIEVAL', 'ADJUDICATING', 'ADJUDICATED',
        'HITL_PENDING', 'HITL_IN_REVIEW', 'SETTLED', 'APPEALED', 'DENIED', 'ERROR'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE claim_type AS ENUM (
        'INPATIENT', 'OUTPATIENT', 'DAYCARE', 'EMERGENCY',
        'MATERNITY', 'DENTAL', 'OPTICAL', 'PHARMACY'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE market_region AS ENUM ('UAE', 'KSA', 'BAHRAIN', 'OMAN', 'QATAR', 'KUWAIT', 'INDIA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE currency AS ENUM ('AED', 'SAR', 'INR', 'BHD', 'OMR', 'QAR', 'KWD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE network_tier AS ENUM ('NETWORK', 'NON_NETWORK', 'CENTRES_OF_EXCELLENCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE policy_tier AS ENUM ('BASIC', 'ENHANCED_SILVER', 'ENHANCED_GOLD', 'PREMIER', 'THIQA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE clause_type AS ENUM (
        'BENEFIT', 'EXCLUSION', 'LIMITATION', 'DEFINITION', 'GENERAL_PROVISION',
        'COPAY_COINSURANCE', 'DEDUCTIBLE', 'PREAUTHORIZATION', 'SUB_LIMIT',
        'WAITING_PERIOD', 'COORDINATION_OF_BENEFITS', 'ROOM_RENT'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE audit_event_type AS ENUM (
        'CLAIM_RECEIVED', 'CLAIM_STATUS_CHANGE', 'OCR_COMPLETED',
        'NLP_EXTRACTION_COMPLETED', 'POLICY_RETRIEVED', 'CLAUSES_IDENTIFIED',
        'REASONING_COMPLETED', 'RULES_EVALUATED', 'SETTLEMENT_CALCULATED',
        'CONFIDENCE_SCORED', 'HITL_ROUTED', 'HITL_DECISION_MADE',
        'SETTLEMENT_APPROVED', 'SETTLEMENT_OVERRIDDEN', 'REPORT_GENERATED',
        'NOTIFICATION_SENT', 'APPEAL_RECEIVED', 'ERROR_OCCURRED',
        'REGULATORY_VIOLATION_DETECTED', 'REASONING_SKIPPED',
        'DUAL_AGENT_VALIDATION', 'PROVIDER_SWITCHED', 'LLM_SKIPPED',
        'PDF_UPLOADED', 'DOCUMENT_VALIDATION_GATE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE hitl_status AS ENUM ('PENDING', 'ASSIGNED', 'IN_REVIEW', 'COMPLETED', 'ESCALATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE hitl_decision AS ENUM ('APPROVE_AI', 'OVERRIDE_AMOUNT', 'DENY_CLAIM', 'ESCALATE', 'REQUEST_INFO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE hitl_trigger AS ENUM (
        'LOW_CONFIDENCE', 'MEDIUM_CONFIDENCE', 'HIGH_VALUE',
        'POLICY_AMBIGUITY', 'FRAUD_RISK', 'NEW_CODE', 'APPEAL', 'OCR_LOW_CONFIDENCE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'ADMIN', 'ADJUSTER', 'SENIOR_ADJUSTER', 'MEDICAL_DIRECTOR',
        'COMPLIANCE_OFFICER', 'API_CONSUMER'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email          VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name      VARCHAR(255) NOT NULL,
    role           user_role NOT NULL,
    market_region  market_region NOT NULL DEFAULT 'UAE',
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- POLICIES
-- ============================================================

CREATE TABLE IF NOT EXISTS policies (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_number               VARCHAR(50) UNIQUE NOT NULL,
    policy_name                 VARCHAR(255) NOT NULL,
    carrier_name                VARCHAR(255) NOT NULL,
    tier                        policy_tier NOT NULL,
    market_region               market_region NOT NULL,
    currency                    currency NOT NULL,
    effective_date              DATE NOT NULL,
    termination_date            DATE,

    -- Benefit limits
    annual_limit                NUMERIC(14,2) NOT NULL,
    individual_deductible       NUMERIC(10,2) NOT NULL DEFAULT 0,
    family_deductible           NUMERIC(10,2) NOT NULL DEFAULT 0,
    oop_max_individual          NUMERIC(10,2) NOT NULL DEFAULT 0,
    oop_max_family              NUMERIC(10,2) NOT NULL DEFAULT 0,

    -- Copay structure (GCC)
    outpatient_copay_pct        INTEGER NOT NULL DEFAULT 20,
    outpatient_copay_max        NUMERIC(10,2) NOT NULL DEFAULT 0,
    inpatient_copay_flat        NUMERIC(10,2) NOT NULL DEFAULT 0,
    inpatient_copay_annual_max  NUMERIC(10,2) NOT NULL DEFAULT 0,
    pharmacy_copay_pct          INTEGER NOT NULL DEFAULT 30,
    diagnostic_copay_pct        INTEGER NOT NULL DEFAULT 20,

    -- Room rent (India)
    room_rent_limit_type        VARCHAR(20) NOT NULL DEFAULT 'ANY',
    room_rent_daily_limit       NUMERIC(10,2) NOT NULL DEFAULT 0,

    -- Waiting periods
    ped_waiting_period_months       INTEGER NOT NULL DEFAULT 6,
    maternity_waiting_period_months INTEGER NOT NULL DEFAULT 24,

    -- Network
    network_name                VARCHAR(100) NOT NULL DEFAULT 'STANDARD',
    requires_preauth_inpatient  BOOLEAN NOT NULL DEFAULT TRUE,
    requires_preauth_daycare    BOOLEAN NOT NULL DEFAULT TRUE,

    -- Metadata
    document_hash               VARCHAR(64),
    page_count                  INTEGER,
    status                      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    version                     INTEGER NOT NULL DEFAULT 1,
    benefit_summary             JSONB,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_market ON policies(market_region);
CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);

-- ============================================================
-- POLICY CLAUSES
-- ============================================================

CREATE TABLE IF NOT EXISTS policy_clauses (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id                   UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    clause_type                 clause_type NOT NULL,
    section_reference           VARCHAR(100) NOT NULL,
    title                       VARCHAR(500) NOT NULL,
    full_text                   TEXT NOT NULL,
    structured_data             JSONB NOT NULL DEFAULT '{}',
    applicable_claim_types      JSONB,
    applicable_procedure_codes  JSONB,
    applicable_diagnosis_codes  JSONB,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clauses_policy_type ON policy_clauses(policy_id, clause_type);

-- ============================================================
-- MEMBERS
-- ============================================================

CREATE TABLE IF NOT EXISTS members (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_number               VARCHAR(50) UNIQUE NOT NULL,
    emirates_id                 VARCHAR(20),
    aadhaar_hash                VARCHAR(64),

    first_name                  VARCHAR(100) NOT NULL,
    last_name                   VARCHAR(100) NOT NULL,
    date_of_birth               DATE NOT NULL,
    gender                      VARCHAR(10) NOT NULL,
    nationality                 VARCHAR(50),

    -- Contact (encrypted in production — plain text for local dev)
    email_encrypted             VARCHAR(500),
    phone_encrypted             VARCHAR(500),

    -- Policy linkage
    policy_id                   UUID REFERENCES policies(id),
    group_number                VARCHAR(50),
    relationship_to_subscriber  VARCHAR(20) NOT NULL DEFAULT 'SELF',
    market_region               market_region NOT NULL DEFAULT 'UAE',

    -- Benefit year accumulators
    deductible_met              NUMERIC(10,2) NOT NULL DEFAULT 0,
    oop_met                     NUMERIC(10,2) NOT NULL DEFAULT 0,
    inpatient_copay_ytd         NUMERIC(10,2) NOT NULL DEFAULT 0,
    benefit_year_start          DATE,

    -- Coverage
    coverage_start              DATE NOT NULL,
    coverage_end                DATE,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_policy ON members(policy_id);
CREATE INDEX IF NOT EXISTS idx_members_market ON members(market_region);

-- ============================================================
-- PROVIDERS
-- ============================================================

CREATE TABLE IF NOT EXISTS providers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_code   VARCHAR(20) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    facility_type   VARCHAR(50) NOT NULL,
    license_number  VARCHAR(50),

    city            VARCHAR(100) NOT NULL,
    emirate_state   VARCHAR(100) NOT NULL,
    country         VARCHAR(50) NOT NULL,
    market_region   market_region NOT NULL,

    network_tier    network_tier NOT NULL DEFAULT 'NETWORK',
    is_coe          BOOLEAN NOT NULL DEFAULT FALSE,

    -- Fee schedule: {"99213": 350.00, "99214": 500.00, ...}
    fee_schedule    JSONB,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_providers_market ON providers(market_region);
CREATE INDEX IF NOT EXISTS idx_providers_network ON providers(network_tier);

-- ============================================================
-- CLAIMS
-- ============================================================

CREATE TABLE IF NOT EXISTS claims (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_reference             VARCHAR(50) UNIQUE NOT NULL,
    status                      claim_status NOT NULL DEFAULT 'RECEIVED',
    claim_type                  claim_type NOT NULL,
    market_region               market_region NOT NULL,
    currency                    currency NOT NULL,

    -- Member
    member_id                   UUID REFERENCES members(id),
    patient_name                VARCHAR(255) NOT NULL,
    patient_dob                 DATE NOT NULL,
    member_number               VARCHAR(50) NOT NULL,

    -- Provider
    provider_id                 UUID REFERENCES providers(id),
    provider_name               VARCHAR(255) NOT NULL,
    provider_code               VARCHAR(20) NOT NULL,
    network_tier                network_tier NOT NULL DEFAULT 'NETWORK',

    -- Dates
    admission_date              DATE,
    discharge_date              DATE,
    service_date                DATE NOT NULL,
    date_received               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    date_adjudicated            TIMESTAMPTZ,
    date_settled                TIMESTAMPTZ,

    -- Diagnosis
    primary_diagnosis_code      VARCHAR(10) NOT NULL,
    primary_diagnosis_desc      VARCHAR(500),
    secondary_diagnosis_codes   JSONB,

    -- Financials
    total_billed                NUMERIC(14,2) NOT NULL,
    total_allowed               NUMERIC(14,2),
    total_settlement            NUMERIC(14,2),
    total_member_responsibility NUMERIC(14,2),

    -- Pre-authorization
    preauth_number              VARCHAR(50),
    preauth_approved            BOOLEAN,

    -- OCR metadata
    source_document_path        VARCHAR(1024),
    ocr_confidence_score        NUMERIC(5,2),
    ocr_extracted_data          JSONB,

    -- AI metadata
    ai_analysis                 JSONB,
    confidence_score            NUMERIC(5,2),
    processing_time_ms          INTEGER,

    -- Policy
    policy_id                   UUID REFERENCES policies(id),

    -- Misc
    raw_document_hash           VARCHAR(64),
    source_channel              VARCHAR(50) NOT NULL DEFAULT 'API',

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_status_date ON claims(status, date_received);
CREATE INDEX IF NOT EXISTS idx_claims_member ON claims(member_number, service_date);
CREATE INDEX IF NOT EXISTS idx_claims_market ON claims(market_region);
CREATE INDEX IF NOT EXISTS idx_claims_reference ON claims(claim_reference);

-- ============================================================
-- CLAIM LINE ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS claim_line_items (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id                UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    line_number             INTEGER NOT NULL,

    procedure_code          VARCHAR(10) NOT NULL,
    procedure_desc          VARCHAR(500),
    modifier_codes          JSONB,
    diagnosis_pointers      JSONB NOT NULL DEFAULT '[]',
    service_category        VARCHAR(50),

    units                   NUMERIC(8,2) NOT NULL DEFAULT 1,
    days                    INTEGER,

    -- Financials
    billed_amount           NUMERIC(12,2) NOT NULL,
    allowed_amount          NUMERIC(12,2),
    deductible_applied      NUMERIC(12,2),
    copay_amount            NUMERIC(12,2),
    coinsurance_amount      NUMERIC(12,2),
    plan_paid               NUMERIC(12,2),
    member_responsibility   NUMERIC(12,2),

    -- Coverage
    is_covered              BOOLEAN,
    denial_code             VARCHAR(10),
    denial_reason           TEXT,
    clause_references       JSONB,

    -- Sub-limits
    sub_limit_applied       BOOLEAN NOT NULL DEFAULT FALSE,
    sub_limit_name          VARCHAR(255),

    -- Calculation trace
    calculation_steps       JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(claim_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_line_items_claim ON claim_line_items(claim_id);

-- ============================================================
-- SETTLEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS settlements (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id                    UUID UNIQUE NOT NULL REFERENCES claims(id),

    total_billed                NUMERIC(14,2) NOT NULL,
    total_allowed               NUMERIC(14,2) NOT NULL,
    total_deductible            NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_copay                 NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_coinsurance_member    NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_plan_payment          NUMERIC(14,2) NOT NULL,
    total_member_responsibility NUMERIC(14,2) NOT NULL,

    currency                    currency NOT NULL,
    policy_citations            JSONB NOT NULL DEFAULT '[]',
    ai_citations                JSONB NOT NULL DEFAULT '[]',
    confidence_score            NUMERIC(5,2) NOT NULL,
    model_version               VARCHAR(50) NOT NULL DEFAULT 'v1.0.0',
    rules_engine_version        VARCHAR(50) NOT NULL DEFAULT 'v1.0.0',

    was_hitl_reviewed           BOOLEAN NOT NULL DEFAULT FALSE,
    hitl_override_amount        NUMERIC(14,2),
    hitl_justification          TEXT,

    calculation_breakdown       JSONB NOT NULL DEFAULT '{}',
    report_url                  VARCHAR(1024),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS (APPEND-ONLY — no UPDATE or DELETE)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id        UUID REFERENCES claims(id),
    event_type      audit_event_type NOT NULL,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_type      VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
    actor_id        VARCHAR(100),
    description     TEXT NOT NULL,
    event_data      JSONB NOT NULL DEFAULT '{}',
    service_name    VARCHAR(50) NOT NULL,
    previous_hash   VARCHAR(64),
    entry_hash      VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_claim ON audit_logs(claim_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(timestamp DESC);

-- Prevent UPDATE and DELETE on audit_logs (append-only enforcement)
-- Note: In production, the audit-service DB role should only have INSERT permission.
-- The following rule enforces this at the PostgreSQL level:
CREATE OR REPLACE RULE no_audit_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_audit_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- ============================================================
-- HITL REVIEWS
-- ============================================================

CREATE TABLE IF NOT EXISTS hitl_reviews (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id            UUID NOT NULL REFERENCES claims(id),
    status              hitl_status NOT NULL DEFAULT 'PENDING',
    trigger_reason      hitl_trigger NOT NULL,
    priority            INTEGER NOT NULL DEFAULT 5,

    ai_settlement_amount    NUMERIC(14,2) NOT NULL,
    ai_confidence           NUMERIC(5,2) NOT NULL,

    assigned_to             UUID REFERENCES users(id),
    decision                hitl_decision,
    override_amount         NUMERIC(14,2),
    justification           TEXT,
    decided_at              TIMESTAMPTZ,

    sla_deadline            TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hitl_status ON hitl_reviews(status);
CREATE INDEX IF NOT EXISTS idx_hitl_claim ON hitl_reviews(claim_id);

-- ============================================================
-- SEED: default admin user (password: admin123 — change in production)
-- ============================================================

INSERT INTO users (email, hashed_password, full_name, role, market_region)
VALUES ('admin@claims-engine.local', '$2b$12$placeholder_hash_change_in_prod', 'System Admin', 'ADMIN', 'UAE')
ON CONFLICT (email) DO NOTHING;
