-- ============================================================
-- Claims Adjudication Engine — Database Migration 012
-- Multi-Market Support: UAE + India Specific Fields
-- Adds India and UAE-specific fields for complete market support
-- ============================================================

-- ============================================================
-- EXTENSIONS (ensure they exist)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- NEW ENUMS FOR INDIA-SPECIFIC FIELDS
-- ============================================================

DO $$ BEGIN
    CREATE TYPE room_category AS ENUM (
        'SINGLE', 'DOUBLE', 'TWIN', 'DELUXE', 'GENERAL', 
        'SHARE', 'ICU', 'CCU', 'SPECIAL', 'SUITE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_event_type')
       AND NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'audit_event_type'::regtype
              AND enumlabel = 'SYSTEM_MIGRATION'
       ) THEN
        ALTER TYPE audit_event_type ADD VALUE 'SYSTEM_MIGRATION';
    END IF;
END $$;

DO $$ BEGIN
    CREATE TYPE system_of_medicine AS ENUM (
        'ALLOPATHY', 'AYURVEDA', 'HOMEOPATHY', 'UNANI', 
        'SIDDHA', 'AYUSH', 'INTEGRATED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- UPDATE CLAIMS TABLE - Market-specific fields
-- ============================================================

ALTER TABLE claims 
-- Market detection confidence
ADD COLUMN IF NOT EXISTS market_confidence NUMERIC(5,4) DEFAULT 0.0,

-- UAE-specific fields
ADD COLUMN IF NOT EXISTS emirates_id VARCHAR(20),
ADD COLUMN IF NOT EXISTS daman_card VARCHAR(50),
ADD COLUMN IF NOT EXISTS dha_code VARCHAR(50),
ADD COLUMN IF NOT EXISTS mohap_license VARCHAR(50),
ADD COLUMN IF NOT EXISTS iban VARCHAR(100),
ADD COLUMN IF NOT EXISTS bank_name VARCHAR(200),

-- India-specific fields  
ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS tpa_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS tpa_name VARCHAR(200),
ADD COLUMN IF NOT EXISTS sum_insured NUMERIC(15,2),
ADD COLUMN IF NOT EXISTS room_category room_category,
ADD COLUMN IF NOT EXISTS system_of_medicine system_of_medicine,
ADD COLUMN IF NOT EXISTS pin_code VARCHAR(10);

-- Add market evidence JSON field
ALTER TABLE claims 
ADD COLUMN IF NOT EXISTS market_evidence JSONB DEFAULT '[]';

-- ============================================================
-- UPDATE MEMBERS TABLE - India-specific fields
-- ============================================================

ALTER TABLE members 
-- India-specific identifiers
ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS tpa_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS uhid VARCHAR(50),
ADD COLUMN IF NOT EXISTS c_kyc VARCHAR(50),
-- Store full aadhaar (encrypted in production)
ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(20);

-- ============================================================
-- UPDATE PROVIDERS TABLE - Additional market info
-- ============================================================

ALTER TABLE providers 
ADD COLUMN IF NOT EXISTS tpa_registered BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS tpa_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS dha_code VARCHAR(50),
ADD COLUMN IF NOT EXISTS mohap_license VARCHAR(50);

-- ============================================================
-- UPDATE POLICIES TABLE - India-specific fields
-- ============================================================

ALTER TABLE policies 
-- India-specific policy features
ADD COLUMN IF NOT EXISTS sum_insured NUMERIC(15,2),
ADD COLUMN IF NOT EXISTS room_rent_sub_limit NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS room_category_coverage JSONB DEFAULT '{}',
-- Pre/post hospitalization coverage (in days)
ADD COLUMN IF NOT EXISTS pre_hospitalization_days INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS post_hospitalization_days INTEGER DEFAULT 60,
-- AYUSH coverage
ADD COLUMN IF NOT EXISTS ayush_coverage BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ayush_coverage_pct INTEGER DEFAULT 0;

-- ============================================================
-- UPDATE HITL_REVIEWS TABLE - Market context
-- ============================================================

ALTER TABLE hitl_reviews 
ADD COLUMN IF NOT EXISTS market_region market_region DEFAULT 'UAE';

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================

-- Market-specific indexes for claims
CREATE INDEX IF NOT EXISTS idx_claims_market_confidence ON claims(market_region, market_confidence DESC);
CREATE INDEX IF NOT EXISTS idx_claims_aadhaar ON claims(aadhaar_number) WHERE aadhaar_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_pan ON claims(pan_number) WHERE pan_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_tpa ON claims(tpa_id) WHERE tpa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_emirates_id ON claims(emirates_id) WHERE emirates_id IS NOT NULL;

-- Member-specific indexes
CREATE INDEX IF NOT EXISTS idx_members_aadhaar ON members(aadhaar_number) WHERE aadhaar_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_members_pan ON members(pan_number) WHERE pan_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_members_tpa ON members(tpa_id) WHERE tpa_id IS NOT NULL;

-- Policy-specific indexes for India
CREATE INDEX IF NOT EXISTS idx_policies_market_sum_insured ON policies(market_region, sum_insured);

-- ============================================================
-- CONSTRAINTS
-- ============================================================

-- Aadhaar validation (12 digits)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_claims_aadhaar') THEN
        ALTER TABLE claims ADD CONSTRAINT chk_claims_aadhaar
        CHECK (aadhaar_number IS NULL OR aadhaar_number ~ '^\d{12}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_members_aadhaar') THEN
        ALTER TABLE members ADD CONSTRAINT chk_members_aadhaar
        CHECK (aadhaar_number IS NULL OR aadhaar_number ~ '^\d{12}$');
    END IF;
END $$;

-- PAN validation (5 letters + 4 digits + 1 letter)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_claims_pan') THEN
        ALTER TABLE claims ADD CONSTRAINT chk_claims_pan
        CHECK (pan_number IS NULL OR pan_number ~ '^[A-Z]{5}\d{4}[A-Z]{1}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_members_pan') THEN
        ALTER TABLE members ADD CONSTRAINT chk_members_pan
        CHECK (pan_number IS NULL OR pan_number ~ '^[A-Z]{5}\d{4}[A-Z]{1}$');
    END IF;
END $$;

-- PIN code, Emirates ID, and confidence validation
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_claims_pin') THEN
        ALTER TABLE claims ADD CONSTRAINT chk_claims_pin
        CHECK (pin_code IS NULL OR pin_code ~ '^\d{6}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_claims_emirates_id') THEN
        ALTER TABLE claims ADD CONSTRAINT chk_claims_emirates_id
        CHECK (emirates_id IS NULL OR emirates_id ~ '^\d{13,15}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_claims_market_confidence') THEN
        ALTER TABLE claims ADD CONSTRAINT chk_claims_market_confidence
        CHECK (market_confidence >= 0.0 AND market_confidence <= 1.0);
    END IF;
END $$;

-- ============================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================

COMMENT ON COLUMN claims.market_confidence IS 'Confidence score (0.0-1.0) of market detection';
COMMENT ON COLUMN claims.aadhaar_number IS 'India: 12-digit Aadhaar number';
COMMENT ON COLUMN claims.pan_number IS 'India: PAN card number (5 letters + 4 digits + 1 letter)';
COMMENT ON COLUMN claims.tpa_id IS 'India: Third Party Administrator ID';
COMMENT ON COLUMN claims.tpa_name IS 'India: Third Party Administrator name';
COMMENT ON COLUMN claims.sum_insured IS 'India: Total sum insured under policy';
COMMENT ON COLUMN claims.room_category IS 'India: Room category (Single, Double, Deluxe, etc.)';
COMMENT ON COLUMN claims.system_of_medicine IS 'India: System of medicine (Allopathy, Ayurveda, etc.)';
COMMENT ON COLUMN claims.pin_code IS 'India: 6-digit postal PIN code';
COMMENT ON COLUMN claims.emirates_id IS 'UAE: 13-15 digit Emirates ID';
COMMENT ON COLUMN claims.daman_card IS 'UAE: Daman insurance card number';
COMMENT ON COLUMN claims.dha_code IS 'UAE: Dubai Health Authority code';
COMMENT ON COLUMN claims.mohap_license IS 'UAE: Ministry of Health license';
COMMENT ON COLUMN claims.iban IS 'UAE: International Bank Account Number';
COMMENT ON COLUMN claims.market_evidence IS 'Array of evidence strings from market detection';

COMMENT ON TYPE room_category IS 'India: Categories of hospital rooms for coverage calculation';
COMMENT ON TYPE system_of_medicine IS 'India: Types of medical systems (Allopathy, AYUSH, etc.)';

-- ============================================================
-- SEED: Market region enum values (ensure INDIA exists)
-- ============================================================

-- Verify INDIA is in market_region enum
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'INDIA' AND enumtypid = 'market_region'::regtype
    ) THEN
        ALTER TYPE market_region ADD VALUE 'INDIA';
    END IF;
END $$;

-- ============================================================
-- LOG MIGRATION
-- ============================================================

INSERT INTO audit_logs (id, event_type, timestamp, actor_type, actor_id, description, event_data, service_name, previous_hash, entry_hash)
VALUES (
    uuid_generate_v4(),
    'SYSTEM_MIGRATION',
    NOW(),
    'SYSTEM',
    'migration_012',
    'Multi-market support migration: Added UAE and India specific fields',
    jsonb_build_object(
        'migration_number', '012',
        'description', 'Adds India and UAE-specific fields for complete multi-market support',
        'tables_modified', jsonb_build_array('claims', 'members', 'providers', 'policies', 'hitl_reviews'),
        'new_enums', jsonb_build_array('room_category', 'system_of_medicine')
    ),
    'database-migrator',
    COALESCE((SELECT entry_hash FROM audit_logs ORDER BY timestamp DESC, id DESC LIMIT 1), '0'),
    encode(digest(jsonb_build_object(
        'migration', '012',
        'timestamp', NOW(),
        'description', 'Multi-market support migration'
    )::text, 'sha256'), 'hex')
);
