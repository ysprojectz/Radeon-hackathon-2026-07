package insurance.india.claims

# ─────────────────────────────────────────────────────────────────────────────
# India Cashless Pre-Authorization — OPA Business Rules
# Source: IRDAI Health Insurance Regulations 2016 + subsequent circulars
# Ported from: tests/fixtures/regional_policies/india_irdai_mandates.json
# ─────────────────────────────────────────────────────────────────────────────

default allow = false

# Top-level allow: all mandatory rules must pass
allow if {
    not violation_initial_waiting_period
    not violation_ped_waiting_period
    not violation_specific_disease_waiting_period
    not violation_maternity_waiting_period
    not violation_prohibited_exclusion
    not violation_copay_limit
    not violation_senior_copay_limit
    not violation_emergency_copay
    not violation_daycare_denial
    not violation_mental_health_parity
    not violation_ayush_sublimit
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-3.1 — Waiting Period Caps
# ─────────────────────────────────────────────────────────────────────────────

# Initial 30-day waiting period (non-accident claims only)
violation_initial_waiting_period if {
    input.claim.days_since_inception < 30
    input.claim.claim_type != "ACCIDENT"
    input.claim.claim_type != "EMERGENCY"
}

# PED waiting period cap: max 48 months
violation_ped_waiting_period if {
    input.claim.is_ped == true
    input.policy.ped_waiting_months > 48
}

# Specific disease waiting period cap: max 24 months
violation_specific_disease_waiting_period if {
    input.claim.is_specific_disease == true
    input.policy.specific_disease_waiting_months > 24
}

# Maternity waiting period cap: max 24 months
violation_maternity_waiting_period if {
    input.claim.claim_type == "MATERNITY"
    input.policy.maternity_waiting_months > 24
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-4.1 — Standard Exclusion List (prohibited exclusions)
# ─────────────────────────────────────────────────────────────────────────────

_prohibited_exclusions := {
    "MENTAL_HEALTH",
    "HIV_AIDS",
    "SUBSTANCE_ABUSE_TREATMENT",
}

violation_prohibited_exclusion if {
    some excl in input.policy.applied_exclusions
    _prohibited_exclusions[excl]
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-5.1 — Copayment Restrictions
# ─────────────────────────────────────────────────────────────────────────────

# General copay cap: 30%
violation_copay_limit if {
    input.claim.copay_pct > 30
}

# Senior citizen copay cap: 20% (age >= 60)
violation_senior_copay_limit if {
    input.claim.patient_age >= 60
    input.claim.copay_pct > 20
    input.policy.voluntary_deductible != true
}

# No copay on emergency admissions
violation_emergency_copay if {
    input.claim.claim_type == "EMERGENCY"
    input.claim.copay_pct > 0
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-2.2 — Daycare Procedures
# ─────────────────────────────────────────────────────────────────────────────

# Cannot deny daycare solely because procedure < 24 hours
violation_daycare_denial if {
    input.claim.claim_type == "DAYCARE"
    input.claim.denial_reason == "LESS_THAN_24_HOURS"
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-2.3 — Mental Health Parity (Mental Healthcare Act 2017)
# ─────────────────────────────────────────────────────────────────────────────

violation_mental_health_parity if {
    input.claim.diagnosis_category == "MENTAL_HEALTH"
    input.policy.mental_health_copay_pct > input.policy.standard_copay_pct
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-4.2 — AYUSH Coverage (min 25% of sum insured)
# ─────────────────────────────────────────────────────────────────────────────

violation_ayush_sublimit if {
    input.claim.treatment_system == "AYUSH"
    input.policy.ayush_sublimit_pct < 25
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-2.1 — Room Rent: proportionate deduction only
# ─────────────────────────────────────────────────────────────────────────────

# Informational — not a hard block but flagged for settlement calculator
room_rent_method_valid if {
    input.policy.room_rent_deduction_method == "PROPORTIONATE_DEDUCTION_ONLY"
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-5.2 — Pre/Post Hospitalization minimums
# ─────────────────────────────────────────────────────────────────────────────

pre_post_hospitalization_compliant if {
    input.policy.pre_hospitalization_days >= 30
    input.policy.post_hospitalization_days >= 60
}

# ─────────────────────────────────────────────────────────────────────────────
# IRDAI-HI-6.1 — Portability Rights
# ─────────────────────────────────────────────────────────────────────────────

portability_ped_credit_valid if {
    input.claim.is_portability_case == true
    input.policy.ped_credit_carried_over == true
}

# ─────────────────────────────────────────────────────────────────────────────
# Denial reason output (for graph service explainability)
# ─────────────────────────────────────────────────────────────────────────────

denial_reasons[reason] if {
    violation_initial_waiting_period
    reason := "IRDAI-HI-3.1: Initial 30-day waiting period not completed"
}

denial_reasons[reason] if {
    violation_ped_waiting_period
    reason := "IRDAI-HI-3.1: PED waiting period exceeds IRDAI 48-month cap"
}

denial_reasons[reason] if {
    violation_specific_disease_waiting_period
    reason := "IRDAI-HI-3.1: Specific disease waiting period exceeds IRDAI 24-month cap"
}

denial_reasons[reason] if {
    violation_maternity_waiting_period
    reason := "IRDAI-HI-3.1: Maternity waiting period exceeds IRDAI 24-month cap"
}

denial_reasons[reason] if {
    violation_prohibited_exclusion
    reason := "IRDAI-HI-4.1: Applied exclusion is prohibited under IRDAI standard exclusion list"
}

denial_reasons[reason] if {
    violation_copay_limit
    reason := "IRDAI-HI-5.1: Copayment exceeds IRDAI 30% maximum"
}

denial_reasons[reason] if {
    violation_senior_copay_limit
    reason := "IRDAI-HI-5.1: Senior citizen copayment exceeds IRDAI 20% maximum"
}

denial_reasons[reason] if {
    violation_emergency_copay
    reason := "IRDAI-HI-5.1: Copayment cannot be applied to emergency admissions"
}

denial_reasons[reason] if {
    violation_daycare_denial
    reason := "IRDAI-HI-2.2: Daycare claim cannot be denied solely on less-than-24-hour basis"
}

denial_reasons[reason] if {
    violation_mental_health_parity
    reason := "IRDAI-HI-2.3 / Mental Healthcare Act 2017: Mental health copay exceeds physical health parity"
}

denial_reasons[reason] if {
    violation_ayush_sublimit
    reason := "IRDAI-HI-4.2: AYUSH sub-limit below mandatory 25% of sum insured"
}
