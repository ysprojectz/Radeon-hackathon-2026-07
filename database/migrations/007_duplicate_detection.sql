-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 007 — Duplicate Document Detection
-- Adds: is_duplicate, duplicate_of_ref, duplicate_remarks
--       + index on raw_document_hash for fast duplicate lookups
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend claims table with duplicate-tracking columns
ALTER TABLE claims
    ADD COLUMN IF NOT EXISTS is_duplicate       BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS duplicate_of_ref   VARCHAR(50),
    ADD COLUMN IF NOT EXISTS duplicate_remarks  TEXT;

-- 2. Foreign-key-style soft link (no hard FK to avoid cyclic ON DELETE issues)
--    duplicate_of_ref stores the original claim_reference string directly.

-- 3. Index on raw_document_hash — already exists as a column from migration 001;
--    add a partial index to make duplicate hash lookups sub-millisecond.
CREATE INDEX IF NOT EXISTS idx_claims_doc_hash
    ON claims (raw_document_hash)
    WHERE raw_document_hash IS NOT NULL;

-- 4. Composite index: hash + date for ordered duplicate lookups
CREATE INDEX IF NOT EXISTS idx_claims_doc_hash_date
    ON claims (raw_document_hash, date_received DESC)
    WHERE raw_document_hash IS NOT NULL;

-- 5. CHECK constraint: duplicate_of_ref must be present when is_duplicate = true
ALTER TABLE claims
    ADD CONSTRAINT chk_duplicate_ref_required
        CHECK (NOT is_duplicate OR duplicate_of_ref IS NOT NULL);
