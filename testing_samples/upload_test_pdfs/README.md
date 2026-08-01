# Claims Engine — Upload Test PDFs

**Local path:** `testing_samples/upload_test_pdfs/`
**Where to run these:** the local Radeon demo stack (`deploy/radeon/docker-compose.yml`),
not any hosted URL — this project's entire pitch is that adjudication runs
on-prem, so these files are uploaded through `http://localhost:3000` after
`docker compose up`. See `README.md`'s Demo Credentials table (repo root)
for local login accounts.

> Corrected 2026-07-25: this file previously pointed at a stale, unrelated
> hosted URL and hardcoded credentials left over from an earlier, separate
> iteration of this project. Removed — never applicable to the Radeon
> submission and shouldn't have shipped toward judges.
>
> Updated 2026-08-01: the non-India (UAE/KSA) sample PDFs used for local
> dev testing were removed from this directory entirely, along with the
> underlying market support in the app, per the India-only submission
> narrative (`SKILL.md` §1.11). Only India scenarios remain.

---

## Test Matrix — What Each File Does

| # | File | Market | Scenario | Expected Result |
|---|------|--------|----------|-----------------|
| 4 | `04_India_inpatient_room_rent_cap.pdf` | **INDIA** | Room rent cap — Apollo Chennai, INR 1,30,500 | **India rules** — Proportionate deduction + GIPSA rates |
| 5 | `05_India_AYUSH_homeopathy.pdf` | **INDIA** | Panchakarma 21 days — INR 64,500 | **AYUSH sub-limit** — India AYUSH clause triggered |
| 7 | `07_low_confidence_partial_data.pdf` | **INDIA** | Degraded scan — illegible patient/amount fields | **HITL** — Low OCR confidence score (< 60%) |
| 8 | `08_wrong_document_type.pdf` | **ANY** | Employment contract — not a medical document | **REJECTED** — Fails 5-signal medical validator |

---

## How to Upload

1. Bring up the local stack: `docker compose -f deploy/radeon/docker-compose.yml up --build`
2. Open: **http://localhost:3000/submit**
3. Log in with a local demo account (see repo root `README.md` → Demo Credentials)
4. Market is India-only
5. Drag-and-drop or click to upload the PDF
6. Watch the AI pipeline process it live — confidence score, extracted fields, settlement breakdown appear in real time

---

## What to Verify After Each Upload

### Files 4–5 (genuine claims):
- OCR extracts: patient name, member number, provider, INR amounts
- Confidence score displayed (clean files should score **> 75%**)
- Settlement breakdown: copay deducted, approved amount shown
- Final status: **SETTLED** / **HITL_PENDING** / **DENIED** as expected per row above

### File 7 (low confidence):
- OCR confidence should be **LOW** (< 60%)
- Most fields show "UNKNOWN" or partial values
- Claim automatically routed to **HITL Review Queue**

### File 8 (wrong document type):
- Should receive an error response: *"Document does not appear to be a medical claim"*
- 5-signal validator fires (checks medical keywords, financial data, provider indicators)
- Claim saved with status: **ERROR**

---

## Where to Find Results

| What | URL |
|------|-----|
| All claims | http://localhost:3000/claims |
| HITL Review Queue | http://localhost:3000/hitl |
| Dashboard KPIs | http://localhost:3000/ |
| Admin/settings | http://localhost:3000/settings |

---

## Extra Edge-Case Tests (Manual)

Run these by hand to verify the security validations:

| Test | How to do it | Expected response |
|------|-------------|-------------------|
| **Non-PDF upload** | Rename any `.jpg` to `.pdf`, upload it | `"File does not appear to be a valid PDF (missing %PDF header)"` |
| **Oversized file** | Upload any PDF larger than 20 MB | `"File too large — maximum 20 MB"` |
| **Empty file** | Upload a 0-byte `.pdf` | `"Empty file uploaded"` |
| **Duplicate claim** | Upload file 4 twice | Two separate `CLM-INDIA-xxxx` references, both settle independently |
