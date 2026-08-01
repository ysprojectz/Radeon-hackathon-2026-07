-- ============================================================
-- Claims Adjudication Engine — Database Migration 005
-- Adds CHECK constraints for data integrity
-- ============================================================

-- ── Policies: copay percentages must be 0–100 ──
ALTER TABLE policies
  ADD CONSTRAINT chk_outpatient_copay_pct CHECK (outpatient_copay_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_pharmacy_copay_pct CHECK (pharmacy_copay_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_diagnostic_copay_pct CHECK (diagnostic_copay_pct BETWEEN 0 AND 100);

-- ── Policies: financial fields must be non-negative ──
ALTER TABLE policies
  ADD CONSTRAINT chk_annual_limit_positive CHECK (annual_limit >= 0),
  ADD CONSTRAINT chk_individual_deductible_positive CHECK (individual_deductible >= 0),
  ADD CONSTRAINT chk_family_deductible_positive CHECK (family_deductible >= 0),
  ADD CONSTRAINT chk_oop_max_individual_positive CHECK (oop_max_individual >= 0),
  ADD CONSTRAINT chk_oop_max_family_positive CHECK (oop_max_family >= 0),
  ADD CONSTRAINT chk_room_rent_daily_positive CHECK (room_rent_daily_limit >= 0);

-- ── Policies: date consistency ──
ALTER TABLE policies
  ADD CONSTRAINT chk_policy_dates CHECK (
    termination_date IS NULL OR termination_date >= effective_date
  );

-- ── Claims: confidence scores 0–100 ──
ALTER TABLE claims
  ADD CONSTRAINT chk_confidence_score CHECK (
    confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
  ),
  ADD CONSTRAINT chk_ocr_confidence CHECK (
    ocr_confidence_score IS NULL OR (ocr_confidence_score >= 0 AND ocr_confidence_score <= 100)
  );

-- ── Claims: financial fields non-negative ──
ALTER TABLE claims
  ADD CONSTRAINT chk_total_billed_positive CHECK (total_billed >= 0),
  ADD CONSTRAINT chk_total_allowed_positive CHECK (
    total_allowed IS NULL OR total_allowed >= 0
  ),
  ADD CONSTRAINT chk_total_settlement_positive CHECK (
    total_settlement IS NULL OR total_settlement >= 0
  );

-- ── Claims: date consistency ──
ALTER TABLE claims
  ADD CONSTRAINT chk_claim_dates CHECK (
    discharge_date IS NULL OR admission_date IS NULL OR discharge_date >= admission_date
  );

-- ── Claim Line Items: financial fields non-negative ──
ALTER TABLE claim_line_items
  ADD CONSTRAINT chk_billed_amount_positive CHECK (billed_amount >= 0),
  ADD CONSTRAINT chk_allowed_amount_positive CHECK (
    allowed_amount IS NULL OR allowed_amount >= 0
  ),
  ADD CONSTRAINT chk_copay_amount_positive CHECK (
    copay_amount IS NULL OR copay_amount >= 0
  ),
  ADD CONSTRAINT chk_plan_paid_positive CHECK (
    plan_paid IS NULL OR plan_paid >= 0
  ),
  ADD CONSTRAINT chk_units_positive CHECK (units > 0);

-- ── Settlements: financial invariants ──
ALTER TABLE settlements
  ADD CONSTRAINT chk_settlement_billed_positive CHECK (total_billed >= 0),
  ADD CONSTRAINT chk_settlement_allowed_positive CHECK (total_allowed >= 0),
  ADD CONSTRAINT chk_settlement_plan_payment_positive CHECK (total_plan_payment >= 0),
  ADD CONSTRAINT chk_settlement_member_resp_positive CHECK (total_member_responsibility >= 0),
  ADD CONSTRAINT chk_settlement_confidence CHECK (
    confidence_score >= 0 AND confidence_score <= 100
  );

-- ── HITL Reviews: confidence and amounts ──
ALTER TABLE hitl_reviews
  ADD CONSTRAINT chk_hitl_confidence CHECK (
    ai_confidence >= 0 AND ai_confidence <= 100
  ),
  ADD CONSTRAINT chk_hitl_settlement_positive CHECK (ai_settlement_amount >= 0),
  ADD CONSTRAINT chk_hitl_override_positive CHECK (
    override_amount IS NULL OR override_amount >= 0
  ),
  ADD CONSTRAINT chk_hitl_priority CHECK (priority BETWEEN 1 AND 10);

-- ── Members: accumulator fields non-negative ──
ALTER TABLE members
  ADD CONSTRAINT chk_deductible_met_positive CHECK (deductible_met >= 0),
  ADD CONSTRAINT chk_oop_met_positive CHECK (oop_met >= 0),
  ADD CONSTRAINT chk_copay_ytd_positive CHECK (inpatient_copay_ytd >= 0);

-- ── Members: coverage date consistency ──
ALTER TABLE members
  ADD CONSTRAINT chk_coverage_dates CHECK (
    coverage_end IS NULL OR coverage_end >= coverage_start
  );

-- ── Additional indexes for common query patterns ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claims_hitl_pending
  ON claims(status) WHERE status = 'HITL_PENDING';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hitl_reviews_pending_sla
  ON hitl_reviews(sla_deadline) WHERE status = 'PENDING';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_timestamp_claim
  ON audit_logs(timestamp DESC, claim_id);
