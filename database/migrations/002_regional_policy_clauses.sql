-- ============================================================
-- Claims Adjudication Engine — Database Migration 002
-- Creates regional_policy_clauses table for government-mandated
-- regulatory rules (India IRDAI).
--
-- These are Tier 1 (non-waivable) rules applied BEFORE company
-- policy clauses (Tier 2) in every claim adjudication.
-- ============================================================

-- NOTE: clause_type, market_region and other ENUMs were defined
-- in 001_create_tables.sql and are referenced here directly.

-- ============================================================
-- TABLE: regional_policy_clauses
-- ============================================================

CREATE TABLE IF NOT EXISTS regional_policy_clauses (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_region           market_region NOT NULL,
    regulatory_body         VARCHAR(50)   NOT NULL,   -- IRDAI
    clause_type             clause_type   NOT NULL,
    section_reference       VARCHAR(100)  NOT NULL,   -- e.g. DHA-EBP-2.1, IRDAI-HI-3.1
    title                   VARCHAR(500)  NOT NULL,
    full_text               TEXT          NOT NULL,
    structured_data         JSONB         NOT NULL DEFAULT '{}',
    applicable_claim_types  JSONB,                    -- ["INPATIENT","OUTPATIENT"] or NULL = all
    effective_date          DATE          NOT NULL,
    expiry_date             DATE,                     -- NULL = currently active
    is_mandatory            BOOLEAN       NOT NULL DEFAULT TRUE,
    is_active               BOOLEAN       NOT NULL DEFAULT TRUE,
    regulatory_note         TEXT,                     -- citation of law/circular
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Indexes for runtime lookups during adjudication (hot path)
CREATE INDEX IF NOT EXISTS idx_regional_clauses_market_mandatory
    ON regional_policy_clauses(market_region, is_mandatory, is_active);

CREATE INDEX IF NOT EXISTS idx_regional_clauses_regulatory_body
    ON regional_policy_clauses(regulatory_body);

CREATE INDEX IF NOT EXISTS idx_regional_clauses_type
    ON regional_policy_clauses(clause_type);

-- ============================================================
-- SEED — India IRDAI Mandatory Clauses (9 clauses)
-- ============================================================

INSERT INTO regional_policy_clauses
    (market_region, regulatory_body, clause_type, section_reference, title,
     full_text, structured_data, applicable_claim_types, effective_date,
     is_mandatory, is_active, regulatory_note)
VALUES

-- IRDAI-HI-2.1 Inpatient
('INDIA', 'IRDAI', 'BENEFIT', 'IRDAI-HI-2.1',
 'Mandatory Inpatient Hospitalization Coverage',
 'All individual and group health insurance policies must cover hospitalization expenses. Proportionate deduction is the ONLY permissible method for room rent limits. Other deduction methods are prohibited.',
 '{"benefit_type":"INPATIENT","is_mandatory":true,"minimum_hospitalization_hours":24,"permitted_room_rent_limit_method":"PROPORTIONATE_DEDUCTION_ONLY"}',
 '["INPATIENT"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'IRDAI Health Insurance Regulations 2016, Regulation 12'),

-- IRDAI-HI-2.2 Daycare
('INDIA', 'IRDAI', 'BENEFIT', 'IRDAI-HI-2.2',
 'Mandatory Daycare Procedures Coverage',
 'All health insurance policies must cover all daycare procedures. Minimum 546 procedures per IRDAI standard list. Open-ended list required. Denial solely on less than 24-hour basis is prohibited.',
 '{"benefit_type":"DAYCARE","is_mandatory":true,"minimum_procedures_covered":546,"open_ended_list_required":true,"doctor_certification_sufficient":true}',
 '["DAYCARE"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'IRDAI Circular IRDA/HLT/REG/CIR/136/06/2016'),

-- IRDAI-HI-2.3 Mental Health Parity
('INDIA', 'IRDAI', 'BENEFIT', 'IRDAI-HI-2.3',
 'Mandatory Mental Health Coverage — Mental Healthcare Act 2017',
 'All health insurance policies must provide coverage for mental health conditions on par with physical health conditions. Separate sub-limits, higher copays, or stricter waiting periods for mental health are prohibited.',
 '{"benefit_type":"MENTAL_HEALTH","is_mandatory":true,"parity_with_physical_health":true,"prohibited_discriminatory_limits":["HIGHER_COPAY_FOR_MENTAL_HEALTH","STRICTER_WAITING_PERIOD_FOR_MENTAL_HEALTH","LOWER_ANNUAL_LIMIT_FOR_MENTAL_HEALTH"]}',
 '["INPATIENT","OUTPATIENT","PHARMACY"]'::jsonb,
 '2018-07-01', TRUE, TRUE,
 'Mental Healthcare Act 2017, Section 21(4); IRDAI Circular IRDA/HLT/CIR/MISC/149/07/2018'),

-- IRDAI-HI-3.1 Waiting Period Caps
('INDIA', 'IRDAI', 'WAITING_PERIOD', 'IRDAI-HI-3.1',
 'Standard Waiting Period Caps — IRDAI Mandatory Limits',
 'Maximum waiting periods: Initial 30 days; PED 48 months; Specific disease 24 months; Maternity 24 months. Accidents: 0 waiting. Portability requires PED credit carryover.',
 '{"is_mandatory":true,"max_initial_waiting_days":30,"max_ped_waiting_months":48,"max_specific_disease_waiting_months":24,"max_maternity_waiting_months":24,"accident_waiting_period":0,"portability_ped_credit_required":true}',
 '["INPATIENT","OUTPATIENT","MATERNITY","DAYCARE"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'IRDAI Health Insurance Regulations 2016, Regulation 8'),

-- IRDAI-HI-4.1 Standard Exclusion List
('INDIA', 'IRDAI', 'EXCLUSION', 'IRDAI-HI-4.1',
 'IRDAI Standard Exclusion List — Permitted Exclusions Only',
 'Only IRDAI-approved exclusions are permitted. Mental health, HIV/AIDS for legal residents, and substance abuse treatment are NOT permitted exclusions. Any other exclusion beyond the standard list is void.',
 '{"is_mandatory":true,"permitted_exclusions_only":["COSMETIC_ELECTIVE","OVERSEAS_TREATMENT","ELECTIVE_CIRCUMCISION","ROUTINE_VACCINATION","SPECTACLES_CONTACTS_HEARING_AID","DENTAL_ELECTIVE","INFERTILITY_IVF","SELF_INFLICTED"],"prohibited_exclusions":["MENTAL_HEALTH","HIV_AIDS_LEGAL_RESIDENTS","SUBSTANCE_ABUSE_TREATMENT"]}',
 '["INPATIENT","OUTPATIENT","DAYCARE"]'::jsonb,
 '2019-08-01', TRUE, TRUE,
 'IRDAI Circular IRDA/HLT/REG/CIR/193/08/2019'),

-- IRDAI-HI-4.2 AYUSH Coverage
('INDIA', 'IRDAI', 'BENEFIT', 'IRDAI-HI-4.2',
 'Mandatory AYUSH Treatment Coverage',
 'All policies must cover AYUSH treatment at government-approved facilities. Minimum coverage 25% of sum insured. Systems: Ayurveda, Yoga, Naturopathy, Unani, Siddha, Homeopathy.',
 '{"benefit_type":"AYUSH","is_mandatory":true,"minimum_coverage_pct_of_sum_insured":25,"approved_facilities_only":true,"systems_covered":["AYURVEDA","YOGA","NATUROPATHY","UNANI","SIDDHA","HOMEOPATHY"]}',
 '["INPATIENT","DAYCARE"]'::jsonb,
 '2013-06-01', TRUE, TRUE,
 'IRDAI Circular IRDA/HLT/CIR/MISC/121/06/2013'),

-- IRDAI-HI-5.1 Copay Restrictions
('INDIA', 'IRDAI', 'COPAY_COINSURANCE', 'IRDAI-HI-5.1',
 'Copayment Restrictions — IRDAI Regulations',
 'Maximum copay: 30% of claim. Senior citizens (60+): maximum 20%. Emergency admission copay: 0%. PED-specific copay loading after waiting period is prohibited.',
 '{"is_mandatory":true,"max_copay_pct":30,"max_senior_copay_pct":20,"emergency_copay":0,"prohibited_ped_specific_copay_loading":true,"senior_age_threshold_years":60}',
 '["INPATIENT","OUTPATIENT","DAYCARE"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'IRDAI Health Insurance Regulations 2016, Regulation 17'),

-- IRDAI-HI-5.2 Pre/Post Hospitalization
('INDIA', 'IRDAI', 'BENEFIT', 'IRDAI-HI-5.2',
 'Mandatory Pre and Post Hospitalization Coverage',
 'Minimum 30 days pre-hospitalization and 60 days post-hospitalization expenses must be covered for the related condition. No separate sub-limit permitted — counts against overall sum insured only.',
 '{"benefit_type":"PRE_POST_HOSPITALIZATION","is_mandatory":true,"min_pre_hospitalization_days":30,"min_post_hospitalization_days":60,"no_separate_sub_limit":true,"must_be_related_to_admission_condition":true}',
 '["INPATIENT"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'IRDAI Health Insurance Regulations 2016, Regulation 12(3)'),

-- IRDAI-HI-6.1 Portability Rights
('INDIA', 'IRDAI', 'GENERAL_PROVISION', 'IRDAI-HI-6.1',
 'Mandatory Policy Portability Rights',
 'All insured persons have the right to port their policy without loss of PED waiting period credit. New insurer must accept portability requests within 45 days before renewal. No additional loading solely for portability.',
 '{"is_mandatory":true,"portability_right":true,"ped_credit_carryover":true,"application_window_days":45,"no_fresh_waiting_period_for_covered_conditions":true,"no_portability_loading":true}',
 '["INPATIENT","OUTPATIENT","DAYCARE"]'::jsonb,
 '2011-03-01', TRUE, TRUE,
 'IRDAI Health Insurance Portability Regulations — Circular IRDA/HLT/REG/CIR/080/03/2011')

ON CONFLICT DO NOTHING;
