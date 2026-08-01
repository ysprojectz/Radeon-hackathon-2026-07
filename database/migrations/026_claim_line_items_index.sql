-- Migration 026: Add index on claim_line_items.claim_id for faster line item lookups
-- Required by the DB fallback path in get_claim and get_settlement endpoints
-- which now query claim_line_items by claim_reference (via JOIN on claims.id).

-- Ensure the claim_line_items table has an index on claim_id if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'claim_line_items'
          AND indexname = 'idx_claim_line_items_claim_id'
    ) THEN
        CREATE INDEX idx_claim_line_items_claim_id ON claim_line_items (claim_id);
    END IF;
END $$;

-- Also ensure claim_line_items table has all expected columns
-- (sub_limit_applied, sub_limit_name, calculation_steps, clause_references)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'claim_line_items' AND column_name = 'sub_limit_applied'
    ) THEN
        ALTER TABLE claim_line_items ADD COLUMN sub_limit_applied BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'claim_line_items' AND column_name = 'sub_limit_name'
    ) THEN
        ALTER TABLE claim_line_items ADD COLUMN sub_limit_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'claim_line_items' AND column_name = 'calculation_steps'
    ) THEN
        ALTER TABLE claim_line_items ADD COLUMN calculation_steps JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'claim_line_items' AND column_name = 'clause_references'
    ) THEN
        ALTER TABLE claim_line_items ADD COLUMN clause_references JSONB;
    END IF;
END $$;
