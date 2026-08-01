-- ============================================================
-- MIGRATION 027 — Add Account Capture Fields to Claims Table
-- Stores the raw payout account details submitted with a claim.
-- These fields are captured during intake (OCR or Manual)
-- and then synced to the customer_accounts table.
-- ============================================================

DO $$ 
BEGIN
    -- Account Holder Name
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'account_holder_name') THEN
        ALTER TABLE claims ADD COLUMN account_holder_name VARCHAR(255);
    END IF;

    -- Bank Account Holder (redundant for some legacy mappings)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'bank_account_holder') THEN
        ALTER TABLE claims ADD COLUMN bank_account_holder VARCHAR(255);
    END IF;

    -- Account Type (mapped to account_type enum if needed, using TEXT for raw capture)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'account_type') THEN
        ALTER TABLE claims ADD COLUMN account_type VARCHAR(50);
    END IF;

    -- Bank Name
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'bank_name') THEN
        ALTER TABLE claims ADD COLUMN bank_name VARCHAR(255);
    END IF;

    -- IBAN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'iban') THEN
        ALTER TABLE claims ADD COLUMN iban VARCHAR(34);
    END IF;

    -- SWIFT / BIC
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'swift_bic') THEN
        ALTER TABLE claims ADD COLUMN swift_bic VARCHAR(11);
    END IF;

    -- Account Number (Plain text for capture, usually encrypted in customer_accounts)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'account_number') THEN
        ALTER TABLE claims ADD COLUMN account_number VARCHAR(50);
    END IF;

    -- IFSC Code (India)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'ifsc_code') THEN
        ALTER TABLE claims ADD COLUMN ifsc_code VARCHAR(11);
    END IF;

    -- UPI / VPA (India)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'upi_vpa') THEN
        ALTER TABLE claims ADD COLUMN upi_vpa VARCHAR(255);
    END IF;

    -- UPI Provider
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'upi_provider') THEN
        ALTER TABLE claims ADD COLUMN upi_provider VARCHAR(50);
    END IF;

END $$;
