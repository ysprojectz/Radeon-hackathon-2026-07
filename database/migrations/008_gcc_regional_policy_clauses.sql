-- ============================================================
-- Claims Adjudication Engine — Database Migration 008
-- Seeds regional_policy_clauses for GCC markets:
--   KSA (CCHI), Bahrain (NHRA), Oman (MOH), Qatar (MOPH), Kuwait (MOH)
--
-- These are Tier 1 (non-waivable) regulatory mandates applied
-- BEFORE company policy clauses (Tier 2) in claim adjudication.
--
-- Table created in 002_regional_policy_clauses.sql.
-- UAE and India seeded in 002. This migration adds 5 remaining markets.
-- ============================================================

-- ============================================================
-- SEED — KSA CCHI Mandatory Benefits (9 clauses)
-- ============================================================

INSERT INTO regional_policy_clauses
    (market_region, regulatory_body, clause_type, section_reference, title,
     full_text, structured_data, applicable_claim_types, effective_date,
     is_mandatory, is_active, regulatory_note)
VALUES

-- CCHI-MB-2.1 Inpatient
('KSA', 'CCHI', 'BENEFIT', 'CCHI-MB-2.1',
 'Mandatory Inpatient Hospital Coverage',
 'All cooperative health insurance policies must cover inpatient hospitalisation including room and board (general ward minimum), surgical and medical procedures, anaesthesia, ICU and CCU care, nursing services, diagnostic investigations, blood and blood products, and prescribed medications during admission. Maximum copayment SAR 100 per day with annual cap SAR 3,000.',
 '{"benefit_type":"INPATIENT","is_mandatory":true,"room_type_minimum":"GENERAL_WARD","preauth_required_elective":true,"preauth_prohibited_emergency":true,"max_copay_per_day_sar":100,"max_copay_annual_sar":3000}',
 '["INPATIENT","DAYCARE","EMERGENCY"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Resolution No. (37) 2018, Article 3'),

-- CCHI-MB-2.2 Outpatient
('KSA', 'CCHI', 'BENEFIT', 'CCHI-MB-2.2',
 'Mandatory Outpatient Coverage',
 'Outpatient GP visits, specialist consultations, diagnostic laboratory tests, and basic radiology mandatory. Maximum copayment 20% not exceeding SAR 100 per visit. Follow-up within 30 days of discharge for same condition: no copay.',
 '{"benefit_type":"OUTPATIENT","is_mandatory":true,"max_copay_pct":20,"max_copay_sar_per_visit":100,"post_discharge_followup_copay":0,"post_discharge_followup_days":30}',
 '["OUTPATIENT"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Implementing Regulations, Article 18'),

-- CCHI-MB-2.3 Emergency
('KSA', 'CCHI', 'BENEFIT', 'CCHI-MB-2.3',
 'Mandatory Emergency Treatment — Saudi Arabia and Worldwide',
 'Emergency at any licensed KSA facility without prior authorisation. Worldwide emergency up to SAR 100,000 per incident with 48-hour post-notification. No copayment on emergency services within KSA.',
 '{"benefit_type":"EMERGENCY","is_mandatory":true,"preauth_prohibition_ksa":true,"worldwide_coverage_max_sar":100000,"notification_hours_overseas":48,"max_copay_emergency_sar":0}',
 '["EMERGENCY"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Resolution No. (37) 2018, Article 5'),

-- CCHI-MB-2.4 Maternity
('KSA', 'CCHI', 'BENEFIT', 'CCHI-MB-2.4',
 'Mandatory Maternity Coverage',
 'Normal delivery SAR 8,000 minimum, caesarean SAR 12,000 minimum, 6 antenatal visits, 2 postnatal visits, newborn 30 days. Max waiting period 12 months. Pregnancy complications cannot be excluded.',
 '{"benefit_type":"MATERNITY","is_mandatory":true,"min_normal_delivery_sar":8000,"min_caesarean_sar":12000,"min_antenatal_visits":6,"max_waiting_period_months":12,"newborn_coverage_days":30}',
 '["MATERNITY","INPATIENT","OUTPATIENT"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Maternity Benefits Circular 2019'),

-- CCHI-MB-2.5 Pharmacy
('KSA', 'CCHI', 'BENEFIT', 'CCHI-MB-2.5',
 'Mandatory Pharmaceutical Coverage',
 'Generic medications 100% covered (no copay). Brand max 20% copay up to SAR 50 per prescription. Inpatient medications covered in full. Chronic disease medications up to SAR 10,000 per year.',
 '{"benefit_type":"PHARMACY","is_mandatory":true,"generic_copay_pct":0,"brand_max_copay_pct":20,"brand_max_copay_sar_per_rx":50,"inpatient_medications_copay":0,"chronic_disease_annual_limit_sar":10000}',
 '["PHARMACY","OUTPATIENT","INPATIENT"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Resolution No. (37) 2018 — Pharmaceutical benefits'),

-- CCHI-MB-3.1 Annual Limit
('KSA', 'CCHI', 'LIMITATION', 'CCHI-MB-3.1',
 'Minimum Annual Benefit Limit — SAR 500,000',
 'Minimum annual benefit SAR 500,000 per member/year. Emergency min SAR 100,000/incident. Inpatient min SAR 100,000/admission. Policies below SAR 500,000 are non-compliant.',
 '{"is_mandatory":true,"min_annual_limit_sar":500000,"min_emergency_per_incident_sar":100000,"min_inpatient_per_admission_sar":100000}',
 '["INPATIENT","OUTPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Implementing Regulations, Article 9'),

-- CCHI-MB-3.2 Copay Caps
('KSA', 'CCHI', 'COPAY_COINSURANCE', 'CCHI-MB-3.2',
 'CCHI Copayment Caps — Maximum Permitted',
 'Outpatient max 20%/SAR 100. Inpatient max SAR 100/day, SAR 3,000/year. Emergency SAR 0. Pharmacy brand max 20%/SAR 50. Annual OOP max SAR 10,000. Excess copay unenforceable.',
 '{"is_mandatory":true,"outpatient_max_copay_pct":20,"outpatient_max_copay_sar":100,"inpatient_max_copay_per_day_sar":100,"inpatient_max_copay_annual_sar":3000,"emergency_max_copay_sar":0,"annual_oop_max_sar":10000}',
 '["INPATIENT","OUTPATIENT","EMERGENCY","PHARMACY"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Resolution No. (37) 2018, Annex 1'),

-- CCHI-MB-4.1 Waiting Periods
('KSA', 'CCHI', 'WAITING_PERIOD', 'CCHI-MB-4.1',
 'CCHI Mandatory Waiting Period Caps',
 'Initial waiting max 30 days. PED max 12 months. Maternity max 12 months. Specific disease max 12 months. Accidents zero waiting. Emergency zero waiting.',
 '{"is_mandatory":true,"max_initial_waiting_days":30,"max_ped_waiting_months":12,"max_maternity_waiting_months":12,"accident_waiting_days":0,"emergency_waiting_days":0}',
 '["INPATIENT","OUTPATIENT","MATERNITY","DAYCARE"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Implementing Regulations, Article 12'),

-- CCHI-MB-4.2 Prohibited Exclusions
('KSA', 'CCHI', 'EXCLUSION', 'CCHI-MB-4.2',
 'Prohibited Exclusions — Conditions CCHI Insurers May Not Exclude',
 'May not be excluded: emergency treatment in KSA, maternity complications, newborn first 30 days, HIV/AIDS for Iqama holders, chronic disease management, dialysis, cancer treatment, mental health acute inpatient (7 days/year).',
 '{"is_mandatory":true,"prohibited_exclusion_categories":["EMERGENCY_TREATMENT_KSA","MATERNITY_COMPLICATIONS","NEWBORN_FIRST_30_DAYS","HIV_AIDS_IQAMA_HOLDERS","CHRONIC_DISEASE_MANAGEMENT","DIALYSIS_END_STAGE_RENAL","CANCER_TREATMENT","MENTAL_HEALTH_ACUTE_INPATIENT_7_DAYS"]}',
 '["INPATIENT","OUTPATIENT","DAYCARE","EMERGENCY"]'::jsonb,
 '2016-01-01', TRUE, TRUE,
 'CCHI Resolution No. (37) 2018, Article 6')

ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED — Bahrain NHRA Mandatory Clauses (9 clauses)
-- ============================================================

INSERT INTO regional_policy_clauses
    (market_region, regulatory_body, clause_type, section_reference, title,
     full_text, structured_data, applicable_claim_types, effective_date,
     is_mandatory, is_active, regulatory_note)
VALUES

('BAHRAIN', 'BAHRAIN_NHRA', 'BENEFIT', 'NHRA-HI-2.1',
 'Mandatory Inpatient Coverage',
 'Inpatient hospitalisation at minimum general ward level including surgery, ICU, nursing, diagnostics, blood products, and medications. Maximum copay BHD 20 per admission, annual max BHD 500.',
 '{"benefit_type":"INPATIENT","is_mandatory":true,"room_type_minimum":"GENERAL_WARD","max_copay_per_admission_bhd":20,"max_copay_annual_bhd":500}',
 '["INPATIENT","DAYCARE","EMERGENCY"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Law No. 38/2009, Health Insurance Regulation'),

('BAHRAIN', 'BAHRAIN_NHRA', 'BENEFIT', 'NHRA-HI-2.2',
 'Mandatory Outpatient Coverage',
 'GP and specialist consultations, diagnostic services, laboratory tests. Maximum copay 20% not exceeding BHD 5 per visit.',
 '{"benefit_type":"OUTPATIENT","is_mandatory":true,"max_copay_pct":20,"max_copay_bhd_per_visit":5}',
 '["OUTPATIENT"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Health Insurance Regulation, Article 12'),

('BAHRAIN', 'BAHRAIN_NHRA', 'BENEFIT', 'NHRA-HI-2.3',
 'Mandatory Emergency Treatment',
 'Emergency treatment at any Bahrain facility without prior authorisation. No copay on emergency services. Post-emergency notification within 24 hours.',
 '{"benefit_type":"EMERGENCY","is_mandatory":true,"max_copay_emergency_bhd":0,"notification_hours":24}',
 '["EMERGENCY"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Emergency Care Directive 2019'),

('BAHRAIN', 'BAHRAIN_NHRA', 'BENEFIT', 'NHRA-HI-2.4',
 'Mandatory Maternity Benefits',
 'Normal delivery BHD 2,000 minimum, caesarean BHD 3,000 minimum, 6 antenatal visits, 30-day newborn coverage. Max waiting period 12 months.',
 '{"benefit_type":"MATERNITY","is_mandatory":true,"min_normal_delivery_bhd":2000,"min_caesarean_bhd":3000,"max_waiting_period_months":12,"newborn_coverage_days":30}',
 '["MATERNITY","INPATIENT"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Maternity Coverage Directive 2020'),

('BAHRAIN', 'BAHRAIN_NHRA', 'BENEFIT', 'NHRA-HI-2.5',
 'Mandatory Pharmacy Coverage',
 'Brand medications max 25% copay, generic max 10%. Inpatient medications covered at 100% with no copay.',
 '{"benefit_type":"PHARMACY","is_mandatory":true,"max_brand_copay_pct":25,"max_generic_copay_pct":10,"inpatient_medications_copay":0}',
 '["PHARMACY","OUTPATIENT","INPATIENT"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Pharmaceutical Coverage Regulation'),

('BAHRAIN', 'BAHRAIN_NHRA', 'COPAY_COINSURANCE', 'NHRA-HI-3.1',
 'NHRA Copayment Caps',
 'Outpatient max 20%/BHD 5. Emergency BHD 0. Inpatient max BHD 20/admission. Annual OOP max BHD 2,000.',
 '{"is_mandatory":true,"outpatient_max_copay_pct":20,"outpatient_max_copay_bhd":5,"emergency_max_copay_bhd":0,"inpatient_max_copay_bhd":20,"annual_oop_max_bhd":2000}',
 '["INPATIENT","OUTPATIENT","EMERGENCY"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Copayment Regulation 2019'),

('BAHRAIN', 'BAHRAIN_NHRA', 'LIMITATION', 'NHRA-HI-3.2',
 'Minimum Annual Benefit Limit — BHD 50,000',
 'Minimum annual benefit BHD 50,000 per member. Emergency min BHD 50,000. Maternity normal BHD 2,000, caesarean BHD 3,000.',
 '{"is_mandatory":true,"min_annual_limit_bhd":50000,"min_emergency_bhd":50000,"min_maternity_normal_bhd":2000,"min_maternity_caesarean_bhd":3000}',
 '["INPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Minimum Benefits Regulation'),

('BAHRAIN', 'BAHRAIN_NHRA', 'EXCLUSION', 'NHRA-HI-4.1',
 'Prohibited Exclusions — NHRA Bahrain',
 'May not be excluded: emergency treatment, mental health acute inpatient (10 days/year), dialysis, cancer screening, maternity complications.',
 '{"is_mandatory":true,"prohibited_exclusion_categories":["EMERGENCY_TREATMENT","MENTAL_HEALTH_ACUTE_10_DAYS","DIALYSIS","CANCER_SCREENING","MATERNITY_COMPLICATIONS"]}',
 '["INPATIENT","OUTPATIENT","DAYCARE"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Non-Excludable Conditions Directive'),

('BAHRAIN', 'BAHRAIN_NHRA', 'WAITING_PERIOD', 'NHRA-HI-5.1',
 'NHRA Waiting Period Caps',
 'Pre-existing condition waiting max 6 months. Initial waiting max 30 days. No waiting for emergency or maternity complications.',
 '{"is_mandatory":true,"max_ped_waiting_period_months":6,"max_initial_waiting_days":30,"no_waiting_period_for":["EMERGENCY","MATERNITY_COMPLICATIONS"]}',
 '["INPATIENT","OUTPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2018-01-01', TRUE, TRUE,
 'NHRA Waiting Period Regulation')

ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED — Oman MOH Mandatory Clauses (9 clauses)
-- ============================================================

INSERT INTO regional_policy_clauses
    (market_region, regulatory_body, clause_type, section_reference, title,
     full_text, structured_data, applicable_claim_types, effective_date,
     is_mandatory, is_active, regulatory_note)
VALUES

('OMAN', 'MOH_OMAN', 'BENEFIT', 'MOH-OM-2.1',
 'Mandatory Inpatient Coverage',
 'Inpatient hospitalisation at minimum general ward level including surgery, ICU, nursing, diagnostics, and medications. Maximum copay OMR 10 per admission, annual max OMR 300.',
 '{"benefit_type":"INPATIENT","is_mandatory":true,"room_type_minimum":"GENERAL_WARD","max_copay_per_admission_omr":10,"max_copay_annual_omr":300}',
 '["INPATIENT","DAYCARE","EMERGENCY"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'Oman Royal Decree 11/2021, Health Insurance Law'),

('OMAN', 'MOH_OMAN', 'BENEFIT', 'MOH-OM-2.2',
 'Mandatory Outpatient Coverage',
 'GP and specialist consultations, diagnostics, laboratory tests. Maximum copay 20% not exceeding OMR 3 per visit.',
 '{"benefit_type":"OUTPATIENT","is_mandatory":true,"max_copay_pct":20,"max_copay_omr_per_visit":3}',
 '["OUTPATIENT"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'MOH Oman Outpatient Regulation'),

('OMAN', 'MOH_OMAN', 'BENEFIT', 'MOH-OM-2.3',
 'Mandatory Emergency Treatment',
 'Emergency treatment at any Oman facility without prior authorisation. No copay. 24-hour notification for non-network.',
 '{"benefit_type":"EMERGENCY","is_mandatory":true,"max_copay_emergency_omr":0,"notification_hours":24}',
 '["EMERGENCY"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'MOH Oman Emergency Care Directive'),

('OMAN', 'MOH_OMAN', 'BENEFIT', 'MOH-OM-2.4',
 'Mandatory Maternity Benefits',
 'Normal delivery OMR 1,500 minimum, caesarean OMR 2,500 minimum, 6 antenatal visits, 30-day newborn coverage. Max waiting 12 months.',
 '{"benefit_type":"MATERNITY","is_mandatory":true,"min_normal_delivery_omr":1500,"min_caesarean_omr":2500,"max_waiting_period_months":12,"newborn_coverage_days":30}',
 '["MATERNITY","INPATIENT"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'MOH Oman Maternity Coverage Directive'),

('OMAN', 'MOH_OMAN', 'BENEFIT', 'MOH-OM-2.5',
 'Mandatory Pharmacy Coverage',
 'Brand medications max 25% copay, generic max 15%. Inpatient medications 100% covered.',
 '{"benefit_type":"PHARMACY","is_mandatory":true,"max_brand_copay_pct":25,"max_generic_copay_pct":15,"inpatient_medications_copay":0}',
 '["PHARMACY","OUTPATIENT","INPATIENT"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'MOH Oman Pharmaceutical Regulation'),

('OMAN', 'MOH_OMAN', 'COPAY_COINSURANCE', 'MOH-OM-3.1',
 'MOH Oman Copayment Caps',
 'Outpatient max 20%/OMR 3. Emergency OMR 0. Inpatient max OMR 10/admission. Annual OOP max OMR 1,500.',
 '{"is_mandatory":true,"outpatient_max_copay_pct":20,"outpatient_max_copay_omr":3,"emergency_max_copay_omr":0,"inpatient_max_copay_omr":10,"annual_oop_max_omr":1500}',
 '["INPATIENT","OUTPATIENT","EMERGENCY"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'MOH Oman Copayment Regulation'),

('OMAN', 'MOH_OMAN', 'LIMITATION', 'MOH-OM-3.2',
 'Minimum Annual Benefit Limit — OMR 30,000',
 'Minimum annual benefit OMR 30,000 per member. Emergency min OMR 30,000. Maternity normal OMR 1,500, caesarean OMR 2,500.',
 '{"is_mandatory":true,"min_annual_limit_omr":30000,"min_emergency_omr":30000,"min_maternity_normal_omr":1500,"min_maternity_caesarean_omr":2500}',
 '["INPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'MOH Oman Minimum Benefits Regulation'),

('OMAN', 'MOH_OMAN', 'EXCLUSION', 'MOH-OM-4.1',
 'Prohibited Exclusions — MOH Oman',
 'May not be excluded: emergency treatment, mental health acute inpatient (10 days/year), dialysis, cancer screening, maternity complications.',
 '{"is_mandatory":true,"prohibited_exclusion_categories":["EMERGENCY_TREATMENT","MENTAL_HEALTH_ACUTE_10_DAYS","DIALYSIS","CANCER_SCREENING","MATERNITY_COMPLICATIONS"]}',
 '["INPATIENT","OUTPATIENT","DAYCARE"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'MOH Oman Non-Excludable Conditions Directive'),

('OMAN', 'MOH_OMAN', 'WAITING_PERIOD', 'MOH-OM-5.1',
 'MOH Oman Waiting Period Caps',
 'Pre-existing condition waiting max 6 months. Initial waiting max 30 days. No waiting for emergency or maternity complications.',
 '{"is_mandatory":true,"max_ped_waiting_period_months":6,"max_initial_waiting_days":30,"no_waiting_period_for":["EMERGENCY","MATERNITY_COMPLICATIONS"]}',
 '["INPATIENT","OUTPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2019-01-01', TRUE, TRUE,
 'MOH Oman Waiting Period Regulation')

ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED — Qatar MOPH Mandatory Clauses (9 clauses)
-- ============================================================

INSERT INTO regional_policy_clauses
    (market_region, regulatory_body, clause_type, section_reference, title,
     full_text, structured_data, applicable_claim_types, effective_date,
     is_mandatory, is_active, regulatory_note)
VALUES

('QATAR', 'MOPH_QATAR', 'BENEFIT', 'MOPH-QA-2.1',
 'Mandatory Inpatient Coverage',
 'Inpatient hospitalisation at minimum standard ward level including surgery, ICU, diagnostics, and medications. Maximum copay QAR 200 per admission, annual max QAR 5,000.',
 '{"benefit_type":"INPATIENT","is_mandatory":true,"room_type_minimum":"STANDARD_WARD","max_copay_per_admission_qar":200,"max_copay_annual_qar":5000}',
 '["INPATIENT","DAYCARE","EMERGENCY"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'Qatar Law No. 22/2021 on Health Insurance'),

('QATAR', 'MOPH_QATAR', 'BENEFIT', 'MOPH-QA-2.2',
 'Mandatory Outpatient Coverage',
 'GP and specialist consultations, diagnostics, laboratory tests. Maximum copay 20% not exceeding QAR 50 per visit.',
 '{"benefit_type":"OUTPATIENT","is_mandatory":true,"max_copay_pct":20,"max_copay_qar_per_visit":50}',
 '["OUTPATIENT"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'MOPH Qatar Outpatient Regulation'),

('QATAR', 'MOPH_QATAR', 'BENEFIT', 'MOPH-QA-2.3',
 'Mandatory Emergency Treatment',
 'Emergency treatment at any Qatar facility without prior authorisation. No copay. 24-hour notification.',
 '{"benefit_type":"EMERGENCY","is_mandatory":true,"max_copay_emergency_qar":0,"notification_hours":24}',
 '["EMERGENCY"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'MOPH Qatar Emergency Directive'),

('QATAR', 'MOPH_QATAR', 'BENEFIT', 'MOPH-QA-2.4',
 'Mandatory Maternity Benefits',
 'Normal delivery QAR 10,000 minimum, caesarean QAR 15,000 minimum, 6 antenatal visits, 30-day newborn coverage. Max waiting 12 months.',
 '{"benefit_type":"MATERNITY","is_mandatory":true,"min_normal_delivery_qar":10000,"min_caesarean_qar":15000,"max_waiting_period_months":12,"newborn_coverage_days":30}',
 '["MATERNITY","INPATIENT"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'MOPH Qatar Maternity Coverage Directive'),

('QATAR', 'MOPH_QATAR', 'BENEFIT', 'MOPH-QA-2.5',
 'Mandatory Pharmacy Coverage',
 'Brand medications max 30% copay, generic max 15%. Inpatient medications 100% covered.',
 '{"benefit_type":"PHARMACY","is_mandatory":true,"max_brand_copay_pct":30,"max_generic_copay_pct":15,"inpatient_medications_copay":0}',
 '["PHARMACY","OUTPATIENT","INPATIENT"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'MOPH Qatar Pharmaceutical Regulation'),

('QATAR', 'MOPH_QATAR', 'COPAY_COINSURANCE', 'MOPH-QA-3.1',
 'MOPH Qatar Copayment Caps',
 'Outpatient max 20%/QAR 50. Emergency QAR 0. Inpatient max QAR 200/admission. Annual OOP max QAR 15,000.',
 '{"is_mandatory":true,"outpatient_max_copay_pct":20,"outpatient_max_copay_qar":50,"emergency_max_copay_qar":0,"inpatient_max_copay_qar":200,"annual_oop_max_qar":15000}',
 '["INPATIENT","OUTPATIENT","EMERGENCY"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'MOPH Qatar Copayment Regulation'),

('QATAR', 'MOPH_QATAR', 'LIMITATION', 'MOPH-QA-3.2',
 'Minimum Annual Benefit Limit — QAR 250,000',
 'Minimum annual benefit QAR 250,000 per member. Emergency min QAR 250,000. Maternity normal QAR 10,000, caesarean QAR 15,000.',
 '{"is_mandatory":true,"min_annual_limit_qar":250000,"min_emergency_qar":250000,"min_maternity_normal_qar":10000,"min_maternity_caesarean_qar":15000}',
 '["INPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'MOPH Qatar Minimum Benefits Regulation'),

('QATAR', 'MOPH_QATAR', 'EXCLUSION', 'MOPH-QA-4.1',
 'Prohibited Exclusions — MOPH Qatar',
 'May not be excluded: emergency treatment, mental health acute inpatient (15 days/year), substance abuse detox (7 days/year), dialysis, cancer screening.',
 '{"is_mandatory":true,"prohibited_exclusion_categories":["EMERGENCY_TREATMENT","MENTAL_HEALTH_ACUTE_15_DAYS","SUBSTANCE_ABUSE_DETOX_7_DAYS","DIALYSIS","CANCER_SCREENING"]}',
 '["INPATIENT","OUTPATIENT","DAYCARE"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'MOPH Qatar Non-Excludable Conditions Directive'),

('QATAR', 'MOPH_QATAR', 'WAITING_PERIOD', 'MOPH-QA-5.1',
 'MOPH Qatar Waiting Period Caps',
 'Pre-existing condition waiting max 6 months. Initial waiting max 30 days. No waiting for emergency or maternity complications.',
 '{"is_mandatory":true,"max_ped_waiting_period_months":6,"max_initial_waiting_days":30,"no_waiting_period_for":["EMERGENCY","MATERNITY_COMPLICATIONS"]}',
 '["INPATIENT","OUTPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2017-01-01', TRUE, TRUE,
 'MOPH Qatar Waiting Period Regulation')

ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED — Kuwait MOH Mandatory Clauses (9 clauses)
-- ============================================================

INSERT INTO regional_policy_clauses
    (market_region, regulatory_body, clause_type, section_reference, title,
     full_text, structured_data, applicable_claim_types, effective_date,
     is_mandatory, is_active, regulatory_note)
VALUES

('KUWAIT', 'MOH_KUWAIT', 'BENEFIT', 'MOH-KW-2.1',
 'Mandatory Inpatient Coverage',
 'Inpatient hospitalisation at minimum general ward level including surgery, ICU, diagnostics, and medications. Maximum copay KWD 10 per admission, annual max KWD 300.',
 '{"benefit_type":"INPATIENT","is_mandatory":true,"room_type_minimum":"GENERAL_WARD","max_copay_per_admission_kwd":10,"max_copay_annual_kwd":300}',
 '["INPATIENT","DAYCARE","EMERGENCY"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'Kuwait Health Insurance Law No. 1/1999'),

('KUWAIT', 'MOH_KUWAIT', 'BENEFIT', 'MOH-KW-2.2',
 'Mandatory Outpatient Coverage',
 'GP and specialist consultations, diagnostics, laboratory tests. Maximum copay 20% not exceeding KWD 5 per visit.',
 '{"benefit_type":"OUTPATIENT","is_mandatory":true,"max_copay_pct":20,"max_copay_kwd_per_visit":5}',
 '["OUTPATIENT"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'MOH Kuwait Outpatient Regulation'),

('KUWAIT', 'MOH_KUWAIT', 'BENEFIT', 'MOH-KW-2.3',
 'Mandatory Emergency Treatment',
 'Emergency treatment at any Kuwait facility without prior authorisation. No copay. 24-hour notification.',
 '{"benefit_type":"EMERGENCY","is_mandatory":true,"max_copay_emergency_kwd":0,"notification_hours":24}',
 '["EMERGENCY"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'MOH Kuwait Emergency Care Directive'),

('KUWAIT', 'MOH_KUWAIT', 'BENEFIT', 'MOH-KW-2.4',
 'Mandatory Maternity Benefits',
 'Normal delivery KWD 2,000 minimum, caesarean KWD 3,500 minimum, 6 antenatal visits, 30-day newborn coverage. Max waiting 12 months.',
 '{"benefit_type":"MATERNITY","is_mandatory":true,"min_normal_delivery_kwd":2000,"min_caesarean_kwd":3500,"max_waiting_period_months":12,"newborn_coverage_days":30}',
 '["MATERNITY","INPATIENT"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'MOH Kuwait Maternity Coverage Directive'),

('KUWAIT', 'MOH_KUWAIT', 'BENEFIT', 'MOH-KW-2.5',
 'Mandatory Pharmacy Coverage',
 'Brand medications max 25% copay, generic max 10%. Inpatient medications 100% covered.',
 '{"benefit_type":"PHARMACY","is_mandatory":true,"max_brand_copay_pct":25,"max_generic_copay_pct":10,"inpatient_medications_copay":0}',
 '["PHARMACY","OUTPATIENT","INPATIENT"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'MOH Kuwait Pharmaceutical Regulation'),

('KUWAIT', 'MOH_KUWAIT', 'COPAY_COINSURANCE', 'MOH-KW-3.1',
 'MOH Kuwait Copayment Caps',
 'Outpatient max 20%/KWD 5. Emergency KWD 0. Inpatient max KWD 10/admission. Annual OOP max KWD 2,000.',
 '{"is_mandatory":true,"outpatient_max_copay_pct":20,"outpatient_max_copay_kwd":5,"emergency_max_copay_kwd":0,"inpatient_max_copay_kwd":10,"annual_oop_max_kwd":2000}',
 '["INPATIENT","OUTPATIENT","EMERGENCY"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'MOH Kuwait Copayment Regulation'),

('KUWAIT', 'MOH_KUWAIT', 'LIMITATION', 'MOH-KW-3.2',
 'Minimum Annual Benefit Limit — KWD 30,000',
 'Minimum annual benefit KWD 30,000 per member. Emergency min KWD 30,000. Maternity normal KWD 2,000, caesarean KWD 3,500.',
 '{"is_mandatory":true,"min_annual_limit_kwd":30000,"min_emergency_kwd":30000,"min_maternity_normal_kwd":2000,"min_maternity_caesarean_kwd":3500}',
 '["INPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'MOH Kuwait Minimum Benefits Regulation'),

('KUWAIT', 'MOH_KUWAIT', 'EXCLUSION', 'MOH-KW-4.1',
 'Prohibited Exclusions — MOH Kuwait',
 'May not be excluded: emergency treatment, mental health acute inpatient (10 days/year), dialysis, cancer screening, maternity complications.',
 '{"is_mandatory":true,"prohibited_exclusion_categories":["EMERGENCY_TREATMENT","MENTAL_HEALTH_ACUTE_10_DAYS","DIALYSIS","CANCER_SCREENING","MATERNITY_COMPLICATIONS"]}',
 '["INPATIENT","OUTPATIENT","DAYCARE"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'MOH Kuwait Non-Excludable Conditions Directive'),

('KUWAIT', 'MOH_KUWAIT', 'WAITING_PERIOD', 'MOH-KW-5.1',
 'MOH Kuwait Waiting Period Caps',
 'Pre-existing condition waiting max 6 months. Initial waiting max 30 days. No waiting for emergency or maternity complications.',
 '{"is_mandatory":true,"max_ped_waiting_period_months":6,"max_initial_waiting_days":30,"no_waiting_period_for":["EMERGENCY","MATERNITY_COMPLICATIONS"]}',
 '["INPATIENT","OUTPATIENT","EMERGENCY","MATERNITY"]'::jsonb,
 '2020-01-01', TRUE, TRUE,
 'MOH Kuwait Waiting Period Regulation')

ON CONFLICT DO NOTHING;
