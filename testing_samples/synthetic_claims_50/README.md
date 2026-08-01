# Synthetic Claims — 50-Document Test Set

**All data in this folder is fabricated.** Patient names, member/policy
numbers, phone numbers, emails, dates, and amounts are synthetic,
generated for OCR and adjudication-pipeline testing. Real Indian
hospital/insurer/TPA company **names** are used for realism (same
convention as the project's existing `testing_samples/` fixtures), but
no real individual, no real claim, and no real document is represented.
Every PDF carries a visible "SYNTHETIC TEST DOCUMENT" watermark footer.

Generated 2026-07-26 by `build_scripts/generate_synthetic_claims.py`.

## What's here

- `pdfs/CLM-INDIA-2026-SYN001.pdf` … `SYN050.pdf` — rendered claim forms,
  following the real IRDAI-standard "Claim Form — Part A" field structure
  (Company/TPA ID, Details of Primary Insured, Details of Insured Person
  Hospitalised, hospitalisation expense breakup, itemised charges,
  declaration + signature block) so they genuinely exercise
  `services/ocr_service/app/ocr_engine.py`'s COMMON/INDIA regex patterns —
  not just cosmetically similar.
- `ground_truth/CLM-INDIA-2026-SYN001.json` … `SYN050.json` — the matching
  claim record in ACOS's own schema (same shape as the rest of
  `testing_samples/*.json`), usable directly with `ClaimPipeline.adjudicate()`
  without needing OCR at all.
- `MANIFEST.json` — flat summary of all 50 (name, claim type, cashless
  flag, hospital, insurer, TPA, total billed) for quick scanning.

## Coverage

- **50 unique patients**, distinct first/last names, mixed gender
  (maternity claims are always female, other types randomized).
- **15 real Indian hospitals** across 8 cities (Chennai, Bengaluru, New
  Delhi, Gurugram, Mumbai, Pune, Hyderabad, Vellore).
- **All 8 `ClaimType` enum values** represented: INPATIENT, OUTPATIENT,
  DAYCARE, EMERGENCY, MATERNITY, DENTAL, OPTICAL, PHARMACY — each with
  realistic ICD-10 codes and procedure descriptions.
- **5 insurers** (Star Health, HDFC ERGO, ICICI Lombard, Niva Bupa, Care
  Health) × **7 TPAs** (MediAssist, Paramount, FHPL, Vidal Health,
  MDIndia, Health India TPA, Raksha TPA), mixed across claims.
- **Roughly half cashless, half reimbursement** (`is_cashless` field) —
  cashless claims include a Cashless Authorization number; reimbursement
  claims present as a standard Part-A form.
- Line items vary by claim: room rent (with days/room category),
  procedure charges, pre/post-hospitalisation expenses, ambulance
  charges — not just a single flat amount.

## Validated, not just generated

Ran through the real pipeline before being called done (script:
`build_scripts/validate_synthetic_50.py`):

- **OCR extraction**: 100% success (50/50) on member_number, patient_name,
  provider_name, provider_code, primary_diagnosis_code, and total_billed
  — average `overall_confidence` 0.867.
- **Adjudication**: all 50 ground-truth JSONs adjudicate cleanly through
  `ClaimPipeline.adjudicate()` with zero errors — 14 auto-settled, 36
  correctly routed to HITL review (expected: these member numbers aren't
  in the seeded `tests/fixtures/sample_claims/members.json`, so member-
  specific policy lookups fall back conservatively — add entries there
  if a specific claim needs full member-matched adjudication testing).

## Regenerating

```bash
cd "build_scripts" && source .venv/bin/activate  # or any venv with reportlab
python3 generate_synthetic_claims.py    # writes pdfs/ + ground_truth/ + MANIFEST.json
python3 validate_synthetic_50.py        # re-run the OCR + pipeline checks above
```

Output is reproducible — `random.seed(20260726)` in the generator means
re-running produces byte-for-byte the same 50 claims.
