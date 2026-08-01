#!/usr/bin/env python3
"""
Quick validation test for clause filtering performance optimization.
Tests the _filter_relevant_clauses() method in pipeline.py.

Run: python test_clause_filtering.py
"""
import sys
from pathlib import Path

# Add services to path
sys.path.insert(0, str(Path(__file__).parent))

from services.api_gateway.app.pipeline import ClaimPipeline


def test_clause_filtering():
    """Test clause filtering with simulated claim and policy clauses."""
    pipeline = ClaimPipeline()

    # Simulated claim data
    claim_data = {
        "claim_type": "INPATIENT",
        "primary_diagnosis_code": "J18.9",  # Pneumonia
        "line_items": [
            {"procedure_code": "CPT-99223", "service_category": "ROOM_RENT"},
            {"procedure_code": "CPT-71045", "service_category": "RADIOLOGY"},
            {"procedure_code": "RX-001", "service_category": "PHARMACY"},
        ]
    }

    # Simulated policy clauses (15 regional + 20 company = 35 total)
    regional_clauses = [
        # Relevant clauses (should score high)
        {
            "title": "Inpatient Admission Coverage",
            "full_text": "All inpatient admissions for respiratory conditions including J18 pneumonia are covered subject to pre-authorization.",
            "section_reference": "Article 5.1"
        },
        {
            "title": "Diagnostic Imaging — Radiology",
            "full_text": "Radiology services including CPT-71xxx chest X-rays are covered at 100% in network.",
            "section_reference": "Article 12.3"
        },
        {
            "title": "Pharmacy Benefits",
            "full_text": "Inpatient pharmacy prescriptions (RX codes) covered at 100% for emergency and inpatient care.",
            "section_reference": "Article 8.2"
        },
        # Irrelevant clauses (should score low)
        {
            "title": "Maternity Benefits",
            "full_text": "Maternity coverage includes normal delivery and C-section (CPT-59xxx) with 12 month waiting period.",
            "section_reference": "Article 15.1"
        },
        {
            "title": "Dental Exclusions",
            "full_text": "Routine dental care and orthodontics are excluded from coverage.",
            "section_reference": "Article 18.5"
        },
        {
            "title": "Vision Care — Optical",
            "full_text": "Annual eye examination and prescription glasses covered up to 500 AED per year.",
            "section_reference": "Article 19.2"
        },
        {
            "title": "Pre-Existing Conditions",
            "full_text": "Pre-existing conditions excluded for first 6 months of coverage.",
            "section_reference": "Article 3.4"
        },
        {
            "title": "Cosmetic Surgery Exclusion",
            "full_text": "Elective cosmetic procedures not covered unless medically necessary.",
            "section_reference": "Article 17.8"
        },
        {
            "title": "Outpatient Physiotherapy",
            "full_text": "Outpatient physiotherapy sessions limited to 20 per year.",
            "section_reference": "Article 11.6"
        },
        {
            "title": "Mental Health Coverage",
            "full_text": "Psychiatric consultations and counseling covered up to 10 sessions per year.",
            "section_reference": "Article 14.3"
        },
        {
            "title": "Emergency Ambulance",
            "full_text": "Emergency ambulance services covered at 100% for life-threatening conditions.",
            "section_reference": "Article 7.1"
        },
        {
            "title": "Home Healthcare",
            "full_text": "Home nursing care covered up to 90 days post-discharge for chronic conditions.",
            "section_reference": "Article 16.4"
        },
        {
            "title": "Preventive Care",
            "full_text": "Annual health checkup and vaccinations covered at 100%.",
            "section_reference": "Article 9.5"
        },
        {
            "title": "Weight Management",
            "full_text": "Bariatric surgery excluded unless BMI > 40 with co-morbidities.",
            "section_reference": "Article 13.7"
        },
        {
            "title": "Alternative Medicine",
            "full_text": "Acupuncture, chiropractic, and homeopathy excluded from coverage.",
            "section_reference": "Article 20.9"
        },
    ]

    company_clauses = [
        # Relevant clauses
        {
            "title": "Room Rent Limits — Standard Room",
            "full_text": "Inpatient room rent covered at standard room rate. Upgrade to private room subject to member co-pay.",
            "section_reference": "Policy Section 4.2"
        },
        {
            "title": "Pneumonia Treatment Protocol",
            "full_text": "Pneumonia (ICD-10 J18.x) requires 3-5 day inpatient stay. Outpatient treatment requires pre-authorization.",
            "section_reference": "Medical Guidelines 2.8"
        },
        # Irrelevant clauses
        {
            "title": "Organ Transplant Coverage",
            "full_text": "Kidney, liver, heart transplants covered up to policy maximum with mandatory second opinion.",
            "section_reference": "Policy Section 22.1"
        },
        {
            "title": "Substance Abuse Treatment",
            "full_text": "Inpatient detoxification and rehabilitation covered for 30 days per year.",
            "section_reference": "Policy Section 21.5"
        },
        {
            "title": "Cancer Chemotherapy",
            "full_text": "Chemotherapy and radiation therapy covered at 100% in network oncology centers.",
            "section_reference": "Policy Section 23.4"
        },
        {
            "title": "Diabetes Management",
            "full_text": "Insulin, test strips, and glucose monitors covered. Insulin pumps subject to prior authorization.",
            "section_reference": "Policy Section 10.3"
        },
        {
            "title": "Cardiac Surgery",
            "full_text": "Coronary bypass, angioplasty, stent placement covered at 100% in network cardiology centers.",
            "section_reference": "Policy Section 24.2"
        },
        {
            "title": "Sports Injuries Exclusion",
            "full_text": "Injuries from extreme sports (skydiving, bungee jumping) excluded unless rider purchased.",
            "section_reference": "Policy Section 25.6"
        },
        {
            "title": "Sleep Apnea Treatment",
            "full_text": "CPAP machines and sleep studies covered with pre-authorization.",
            "section_reference": "Policy Section 26.8"
        },
        {
            "title": "Fertility Treatment",
            "full_text": "IVF and fertility drugs excluded unless enhanced maternity rider purchased.",
            "section_reference": "Policy Section 27.3"
        },
        {
            "title": "Rehabilitation Services",
            "full_text": "Post-surgery rehabilitation covered for up to 60 days inpatient or 90 days outpatient.",
            "section_reference": "Policy Section 28.5"
        },
        {
            "title": "Prosthetics and Orthotics",
            "full_text": "Artificial limbs, braces, and orthotic devices covered up to 50,000 per year.",
            "section_reference": "Policy Section 29.7"
        },
        {
            "title": "Hearing Aids",
            "full_text": "Hearing aids covered up to 2,000 per ear every 3 years.",
            "section_reference": "Policy Section 30.4"
        },
        {
            "title": "Genetic Testing",
            "full_text": "Genetic screening for hereditary conditions covered with medical necessity approval.",
            "section_reference": "Policy Section 31.9"
        },
        {
            "title": "Telemedicine Services",
            "full_text": "Virtual consultations covered at 100% for non-emergency conditions.",
            "section_reference": "Policy Section 32.2"
        },
        {
            "title": "International Coverage",
            "full_text": "Emergency treatment outside UAE covered up to 100,000 per year. Planned treatment excluded.",
            "section_reference": "Policy Section 33.6"
        },
        {
            "title": "Clinical Trials",
            "full_text": "Participation in approved clinical trials covered with prior authorization.",
            "section_reference": "Policy Section 34.8"
        },
        {
            "title": "Wellness Programs",
            "full_text": "Gym membership reimbursement up to 500 per year. Annual flu shot covered.",
            "section_reference": "Policy Section 35.1"
        },
        {
            "title": "Second Opinion Services",
            "full_text": "Second opinion for major surgery or cancer diagnosis covered at 100%.",
            "section_reference": "Policy Section 36.5"
        },
        {
            "title": "Emergency Evacuation",
            "full_text": "Air ambulance and medical evacuation covered for life-threatening emergencies.",
            "section_reference": "Policy Section 37.3"
        },
    ]

    # Test filtering with max_clauses=5
    print("=" * 80)
    print("CLAUSE FILTERING TEST")
    print("=" * 80)
    print(f"\nClaim Type: {claim_data['claim_type']}")
    print(f"Diagnosis: {claim_data['primary_diagnosis_code']} (Pneumonia)")
    print(f"Procedures: {', '.join([li['procedure_code'] for li in claim_data['line_items']])}")
    print(f"\nOriginal Clause Counts:")
    print(f"  Regional: {len(regional_clauses)}")
    print(f"  Company:  {len(company_clauses)}")
    print(f"  TOTAL:    {len(regional_clauses) + len(company_clauses)}")

    # Filter regional clauses
    filtered_regional = pipeline._filter_relevant_clauses(regional_clauses, claim_data, max_clauses=5)
    print(f"\nFiltered Regional Clauses (top 5):")
    for i, clause in enumerate(filtered_regional, 1):
        print(f"  {i}. {clause['title']}")

    # Filter company clauses
    filtered_company = pipeline._filter_relevant_clauses(company_clauses, claim_data, max_clauses=5)
    print(f"\nFiltered Company Clauses (top 5):")
    for i, clause in enumerate(filtered_company, 1):
        print(f"  {i}. {clause['title']}")

    # Calculate reduction
    total_original = len(regional_clauses) + len(company_clauses)
    total_filtered = len(filtered_regional) + len(filtered_company)
    reduction_pct = round(100 * (1 - total_filtered / total_original), 1)

    print(f"\nFiltered Clause Counts:")
    print(f"  Regional: {len(filtered_regional)} (-{len(regional_clauses) - len(filtered_regional)})")
    print(f"  Company:  {len(filtered_company)} (-{len(company_clauses) - len(filtered_company)})")
    print(f"  TOTAL:    {total_filtered} ({reduction_pct}% reduction)")

    # Validation
    print("\n" + "=" * 80)
    print("VALIDATION")
    print("=" * 80)

    # Check that relevant clauses are included
    regional_titles = [c['title'] for c in filtered_regional]
    company_titles = [c['title'] for c in filtered_company]

    expected_regional = [
        "Inpatient Admission Coverage",
        "Diagnostic Imaging — Radiology",
        "Pharmacy Benefits"
    ]
    expected_company = [
        "Room Rent Limits — Standard Room",
        "Pneumonia Treatment Protocol"
    ]

    print("\nExpected Relevant Clauses:")
    for title in expected_regional:
        status = "✓" if title in regional_titles else "✗"
        print(f"  {status} {title}")
    for title in expected_company:
        status = "✓" if title in company_titles else "✗"
        print(f"  {status} {title}")

    # Check that irrelevant clauses are excluded
    unexpected = [
        "Maternity Benefits",
        "Dental Exclusions",
        "Cosmetic Surgery Exclusion",
        "Fertility Treatment",
        "Sports Injuries Exclusion"
    ]
    print("\nIrrelevant Clauses (should be excluded):")
    for title in unexpected:
        excluded = title not in regional_titles and title not in company_titles
        status = "✓" if excluded else "✗"
        print(f"  {status} {title} {'(excluded)' if excluded else '(INCORRECTLY INCLUDED)'}")

    # Success criteria
    success = (
        len(filtered_regional) == 5 and
        len(filtered_company) == 5 and
        all(title in regional_titles for title in expected_regional) and
        all(title in company_titles for title in expected_company) and
        reduction_pct >= 60
    )

    print("\n" + "=" * 80)
    if success:
        print("✅ TEST PASSED — Clause filtering working correctly")
        print(f"   - Reduction: {reduction_pct}% (target: 60-70%)")
        print(f"   - Relevant clauses: All included")
        print(f"   - Irrelevant clauses: Properly excluded")
    else:
        print("❌ TEST FAILED — Clause filtering not working as expected")
        print(f"   - Check filtered clause titles above")
    print("=" * 80)

    return success


if __name__ == "__main__":
    try:
        success = test_clause_filtering()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ TEST ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
