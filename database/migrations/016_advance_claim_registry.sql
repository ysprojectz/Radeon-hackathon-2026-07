-- Advance claim pre-authorization registry.
-- Stores India cashless pre-auth requests while linking each request to the
-- canonical claims registry row for cross-product visibility.

CREATE TABLE IF NOT EXISTS advance_claims (
    id                                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id                            UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    claim_reference                     VARCHAR(50) NOT NULL UNIQUE REFERENCES claims(claim_reference) ON DELETE CASCADE,
    preauth_reference                   VARCHAR(80) NOT NULL UNIQUE,
    preauth_status                      VARCHAR(30) NOT NULL DEFAULT 'PENDING_HITL',
    coverage_decision                   VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    estimated_coverage                  NUMERIC(14,2),
    estimated_member_responsibility     NUMERIC(14,2),
    estimated_plan_payment              NUMERIC(14,2),
    estimated_deductible_applied        NUMERIC(14,2),
    estimated_copay                     NUMERIC(14,2),
    confidence_score                    NUMERIC(5,2),
    treating_doctor                     VARCHAR(255) NOT NULL,
    treating_hospital_reg               VARCHAR(100),
    supporting_docs                     JSONB,
    is_emergency                        BOOLEAN NOT NULL DEFAULT false,
    is_cashless                         BOOLEAN NOT NULL DEFAULT true,
    needs_hntl                          BOOLEAN NOT NULL DEFAULT true,
    hitl_deadline                       TIMESTAMPTZ,
    preauth_letter_url                  VARCHAR(1024),
    date_created                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    date_decision                       TIMESTAMPTZ,
    created_by                          VARCHAR(255),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advance_claims_status_date
    ON advance_claims(preauth_status, date_created DESC);

CREATE INDEX IF NOT EXISTS idx_advance_claims_claim
    ON advance_claims(claim_reference);

CREATE INDEX IF NOT EXISTS idx_advance_claims_created_by
    ON advance_claims(created_by, date_created DESC);
