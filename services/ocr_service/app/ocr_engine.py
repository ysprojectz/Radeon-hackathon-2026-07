"""
OCR Engine — Extract structured claim data from PDF/image documents.

Processing pipeline:
  1. Detect document type (digital text PDF vs scanned/image PDF)
  2. Digital PDF  → pdfplumber (fast, accurate, preserves layout)
  3. Scanned PDF  → convert pages to images → preprocess → Tesseract OCR
  4. Market auto-detection from document signals (keywords, IDs, currencies)
  5. Market-specific field extraction (GCC: Emirates ID, DHA codes; India: Aadhaar, TPA ID)
  6. Assign per-field confidence score (0.0 – 1.0)
  7. Fields below OCR_CONFIDENCE_THRESHOLD flagged for human review

Market detection confidence levels:
  HIGH   (>= 0.85) → proceed automatically
  MEDIUM (0.60–0.85) → return for user confirmation on UI
  LOW    (< 0.60) → require manual selection

Returns a dict compatible with ClaimCreate schema.
"""
import os
import re
import io
import json
import hashlib
import logging
from dataclasses import dataclass, field, asdict
from typing import Optional
from decimal import Decimal

logger = logging.getLogger(__name__)

OCR_CONFIDENCE_THRESHOLD = float(os.getenv("OCR_CONFIDENCE_THRESHOLD", "0.70"))

# Redis caching configuration
REDIS_HOST = os.getenv("REDIS_HOST", "redis")  # Docker service name or localhost
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
OCR_CACHE_TTL = int(os.getenv("OCR_CACHE_TTL", "86400"))  # 24 hours

# Confidence bands for market detection
MARKET_DETECT_HIGH   = 0.85
MARKET_DETECT_MEDIUM = 0.60


# ─────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ExtractedField:
    """A single extracted field with its confidence score."""
    value: Optional[str]
    confidence: float   # 0.0 – 1.0
    source: str         # "pdfplumber" | "tesseract" | "regex" | "inferred"
    raw_text: str = ""  # the raw matched text before normalization
    page_number: int = 0  # 1-based page where the field was found (0 = unknown)


@dataclass
class OCRResult:
    """Complete structured extraction result from a claim document."""
    # Claim identity
    claim_type: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    market_region: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    currency: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))

    # Member
    member_number: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    policy_number: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    policy_name: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    patient_name: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    patient_dob: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))

    # Provider
    provider_name: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    provider_code: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))

    # Clinical
    service_date: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    admission_date: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    discharge_date: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    primary_diagnosis_code: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    primary_diagnosis_desc: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))

    # Financial
    total_billed: ExtractedField = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    line_items: list = field(default_factory=list)  # list of dicts

    # ── Bank / Payment account details (auto-extracted for Account Module) ──
    bank_account_holder:  "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    bank_name:            "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    iban:                 "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    swift_bic:            "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    account_number:       "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    ifsc_code:            "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    upi_vpa:              "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    sort_code:            "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))
    routing_number:       "ExtractedField" = field(default_factory=lambda: ExtractedField(None, 0.0, ""))

    # Market-specific fields
    market_specific: dict = field(default_factory=dict)

    # Metadata
    overall_confidence: float = 0.0
    market_detection_confidence: float = 0.0   # NEW: confidence of market auto-detection
    market_requires_confirmation: bool = False   # NEW: prompt user if True
    ocr_engine_used: str = "pdfplumber"
    document_hash: str = ""
    page_count: int = 0
    low_confidence_fields: list = field(default_factory=list)
    raw_text: str = ""
    page_texts: list = field(default_factory=list)  # per-page text: [{"page": 1, "text": "..."}, ...]
    ocr_processing_time: float = 0.0  # seconds taken for OCR
    quality_metrics: list = field(default_factory=list)  # per-page quality reports (enhanced engine)
    preprocessing_applied: list = field(default_factory=list)  # preprocessing steps applied (enhanced engine)


# ─────────────────────────────────────────────────────────────────────────────
# MARKET DETECTION SIGNALS
# Each market has strong signals (very distinctive) and soft signals (common words)
# Score = strong_matches * 0.35 + soft_matches * 0.10, capped at 1.0
# ─────────────────────────────────────────────────────────────────────────────

MARKET_SIGNALS: dict[str, dict] = {
    "UAE": {
        "strong": [
            r"\b784[\-\s]?\d{4}[\-\s]?\d{7}[\-\s]?\d\b",  # Emirates ID format
            r"\b(?:dha|doh|haad|seha|mohap)\b",             # UAE health authorities
            r"\bthiqa\b", r"\bdaman\b", r"\bsaada\b",       # UAE insurers
            r"\baed\b", r"\bdirhams?\b",                     # UAE currency
            r"\bdubai\b", r"\babu\s+dhabi\b", r"\bsharjah\b",
            r"\bajman\b", r"\bfujairah\b", r"\bras\s+al\s+khaimah\b",
        ],
        "soft": [
            r"\buae\b", r"\bunited\s+arab\s+emirates\b",
            r"\bnhic\b", r"\bemirates\b",
        ],
    },
    "KSA": {
        "strong": [
            r"\b(?:cchi|council\s+of\s+cooperative\s+health\s+insurance)\b",
            r"\bbupa\s+arabia\b", r"\btawuniya\b", r"\bmedgulf\b",
            r"\bsar\b", r"\briyal\b",
            r"\briyadh\b", r"\bjeddah\b", r"\bdammam\b", r"\bmecca\b",
            r"\b1\d{9}\b",  # Saudi national ID (10 digits starting with 1 or 2)
        ],
        "soft": [
            r"\bksa\b", r"\bsaudi\s+arabia\b", r"\bsaudi\b",
            r"\bvat\s+15%?\b",  # KSA has 15% VAT
        ],
    },
    "INDIA": {
        "strong": [
            r"\b\d{4}\s?\d{4}\s?\d{4}\b",  # Aadhaar card pattern
            r"\b(?:irdai|irda)\b",           # IRDAI regulator
            r"\b(?:tpa|third\s+party\s+administrator)\b",
            r"\b(?:gipsa|cashless\s+claim|cashless\s+treatment)\b",
            r"\binr\b", r"₹", r"\brupees?\b",
            r"\b(?:star\s+health|hdfc\s+ergo|icici\s+lombard|niva\s+bupa|care\s+health)\b",
            r"\b(?:mumbai|delhi|bengaluru|bangalore|chennai|hyderabad|kolkata|pune)\b",
            r"\b(?:pan|aadhar|aadhaar|uhid|abha)\b",
        ],
        "soft": [
            r"\bindia\b", r"\bindian\b",
            r"\b(?:ayush|ayurveda|homeopathy|yoga)\b",
        ],
    },
    "BAHRAIN": {
        "strong": [
            r"\bbhd\b", r"\bbahraini\s+dinar\b",
            r"\bmanama\b", r"\bnhi\b", r"\bnational\s+health\s+insurance\b",
            r"\bbeacon\b",
        ],
        "soft": [r"\bbahrain\b", r"\bbahraini\b"],
    },
    "OMAN": {
        "strong": [
            r"\bomr\b", r"\bomani\s+rial\b",
            r"\bmuscat\b", r"\bnhif\b",
        ],
        "soft": [r"\boman\b", r"\bomani\b"],
    },
    "QATAR": {
        "strong": [
            r"\bqar\b", r"\bqatari\s+riyal\b",
            r"\bdoha\b", r"\bnhix\b", r"\bdrg\b",
        ],
        "soft": [r"\bqatar\b", r"\bqatari\b"],
    },
    "KUWAIT": {
        "strong": [
            r"\bkwd\b", r"\bkuwaiti\s+dinar\b",
            r"\bkuwait\s+city\b",
        ],
        "soft": [r"\bkuwait\b", r"\bkuwaiti\b"],
    },
}

# Convenience: which regions are GCC
GCC_REGIONS = {"UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT"}

CURRENCY_MAP = {
    "UAE": "AED", "KSA": "SAR", "INDIA": "INR",
    "BAHRAIN": "BHD", "OMAN": "OMR", "QATAR": "QAR", "KUWAIT": "KWD",
}


# ─────────────────────────────────────────────────────────────────────────────
# REGEX PATTERNS — Common fields (all markets)
# ─────────────────────────────────────────────────────────────────────────────

PATTERNS_COMMON = {
    "member_number": [
        # Two-line format: "Member Number\nDAM-2025-100005 ..." — common in DAMAN/GCC forms
        r"Member\s*Number\s*\n\s*([A-Z]{2,6}[\-]\d{4}[\-]\d{5,8})",
        # Direct known-prefix member numbers anywhere in text (captures full ID incl. prefix)
        r"\b((?:DAM|DAH|THQ|INS|MBR|CER|BUPA|AXA|STR|NAS|NMC|MED)[\-]\d{4}[\-]\d{5,8})\b",
        # Label + colon/space on same line (single-column forms)
        r"(?:Member\s*(?:ID|No|Number)|Certificate\s*No|Insured\s*ID)[:\s]+([A-Z0-9\-]{6,20})",
        r"Member[:\s]+([A-Z]{2,4}[\-\s]?\d{4}[\-\s]?\d{5,8})",
    ],
    "patient_name": [
        # TWO-LINE FORMAT (most common in DAMAN reimbursement forms):
        # "Patient Name\nHassan Al Ali (Self)" — label on one line, name on next
        # Also supports ALL-CAPS names (common in PDF rendering)
        r"Patient\s*Name\s*\n\s*([A-Z][A-Za-z\s]+?)(?:\s*\([^)]{0,20}\))?(?=\n|$)",
        r"Member\s*Name\s*\n\s*([A-Z][A-Za-z\s]+?)(?:\s*\([^)]{0,20}\))?(?=\n|$)",
        # Inline format (single-column forms with colon separator) — now with ALL-CAPS support
        r"(?:Patient\s*Name|Insured\s*Name|Member\s*Name)[:\s]+([A-Z][A-Za-z\s]+?)(?=\n|$|Member|Policy|Claim)",
        # Beneficiary / Name of Patient labels
        r"(?:Name\s*of\s*Patient|Beneficiary\s*Name|Name\s*of\s*Member)[:\s]+([A-Z][A-Za-z\s]+?)(?=\n|$)",
        # Short label variations (some forms use just "Patient:" or "Member:") with optional suffix
        r"(?:Patient|Member|Insured)[\s:]+([A-Z][A-Za-z\s]+?)(?:\s*\([^)]{0,20}\))?(?=\n|$)",
        # Generic "Name:" label (used in India Star Health, ICICI Lombard forms)
        r"^Name[:\s]+([A-Z][A-Za-z\s]+?)(?:\s*\([^)]{0,20}\))?(?=\n|$|Aadhar|Date\s*of\s*Birth|Gender)",
    ],
    "patient_dob": [
        r"(?:Date\s*of\s*Birth|DOB|Birth\s*Date)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        r"(?:Born|D\.O\.B)[:\s\.]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        # Written-month format (inline): "Date of Birth 27 June 1985"
        r"(?:Date\s*of\s*Birth|DOB|Birth\s*Date)[:\s]+(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
        # Written-month format (two-line): "Date of Birth\n27 April 1988"
        r"(?:Date\s*of\s*Birth|DOB)\s*\n\s*(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
    ],
    "provider_name": [
        # ═══ GCC PATTERNS (UAE/KSA/Bahrain) ═══
        # Compound labels: "Provider Name NMC Hospital" — pdfplumber extracts table as one line
        # Removed overly broad negative lookahead - rely on positive end anchors to stop at right boundary
        r"(?:Provider\s+Name|Hospital\s+Name|Clinic\s+Name|Facility\s+Name|Healthcare\s+Facility)[:\s]+([A-Z][A-Za-z\s,\.&\-']{3,60})(?=\n|$|Provider\s*Code|License|Emirates|Address)",

        # Label + colon: "Hospital: NMC Hospital" - removed problematic negative lookahead
        r"(?:Hospital|Provider|Clinic|Pharmacy|Medical\s+Center|Health\s+Center|Healthcare|Facility|Treating\s*(?:Doctor|Facility))[:\s]+([A-Z][A-Za-z\s,\.&\-']{3,60})(?:\n|$|Provider\s*Code|Clinic|Hospital|License|Address)",

        # "Admitted to" / "Treated at"
        r"(?:Admitted\s*to|Treated\s*at|Serviced\s*by)[:\s]+([A-Z][A-Za-z\s,\.&\-']{3,60})(?:\n|$|Provider\s*Code)",

        # Single-line: "Hospital / Clinic VPS Healthcare Provider Code UAE-021"
        r"Hospital\s*/\s*Clinic\s+([A-Z][A-Za-z\s,\.&\-']{3,60})(?:\s+Provider\s*Code)",

        # Two-line: "Hospital / Clinic\nAl Noor Hospital"
        r"Hospital\s*/\s*Clinic\s*\n\s*([A-Z][A-Za-z\s,\.&\-']{3,60})(?:\n|$)",

        # Pharmacy-specific patterns (common in UAE/GCC pharmacy claims)
        r"Pharmacy\s*Name[:\s]+([A-Z][A-Za-z\s,\.&\-']{3,60})(?:\n|$|License)",
        r"Dispensed\s*(?:by|at)[:\s]+([A-Z][A-Za-z\s,\.&\-']+?\s+Pharmacy)(?:\n|$)",

        # Medical/Health Center variations (common in GCC)
        r"(?:Medical|Health)\s+Centre?[:\s]+([A-Z][A-Za-z\s,\.&\-']{3,60})(?:\n|$|Emirates)",

        # Hospital/Clinic name in header (first occurrence of capitalized multi-word entity)
        r"^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,4}(?:\s+(?:Hospital|Clinic|Medical Center|Health Center|Pharmacy|Healthcare)))\s*$",

        # Provider name in parentheses after code: "Provider Code: UAE-008 (Al Zahra Hospital)"
        r"Provider\s*Code[:\s]+[A-Z0-9\-]+\s*\(([A-Za-z\s,\.&\-']{3,60})\)",

        # ═══ INDIA-SPECIFIC PATTERNS (Star Health, ICICI Lombard, HDFC Ergo) ═══
        # Enhanced negative lookahead to exclude signature/declaration sections
        # Pattern now checks for declaration keywords in 100-char window before match

        # India hospitals with location: "Apollo Hospitals, Greams Road"
        r"([A-Z][A-Za-z]+\s+(?:Hospital|Hospitals|Medical\s+Center|Nursing\s+Home),\s+[A-Z][A-Za-z\s]+(?:Road|Street|Avenue|Nagar|Colony|Area))",

        # India hospitals with city: "AIIMS, New Delhi" / "Max Hospital, Saket"
        r"([A-Z]{2,6}(?:\s+Hospital)?(?:,\s+(?:New\s+)?[A-Z][A-Za-z]+))",

        # Super Specialty / Multispeciality: "Max Super Speciality Hospital, Saket"
        r"([A-Z][A-Za-z]+\s+(?:Super\s+Speciality|Multispeciality|Multi\s*[-\s]*Speciality)\s+Hospital(?:,\s+[A-Z][A-Za-z\s]+)?)",

        # Person name + Hospital: "Kokilaben Dhirubhai Ambani Hospital"
        r"([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){2,4}\s+Hospital)(?=\s*(?:\n|$|,|Address|License))",

        # India "Name of Hospital" field - enhanced to support Diagnostic Centre/Center
        r"Name\s+of\s+Hospital[:\s]+(?=.{0,50}(?:Hospital|Medical|Clinic|Centre|Center|Healthcare|Nursing|Diagnostic))([A-Z][A-Za-z\s,\.&\-']{5,60})(?=\s*(?:\n|$|Address|City|Room|Type|License))",

        # India "Treating Hospital" field - enhanced to support Diagnostic Centre/Center
        r"Treating\s+Hospital[:\s]+(?=.{0,50}(?:Hospital|Medical|Clinic|Centre|Center|Healthcare|Nursing|Diagnostic))([A-Z][A-Za-z\s,\.&\-']{5,60})(?=\s*(?:\n|$|Address|City|Room|Type|License))",

        # India hospital in table/form format - enhanced to support Diagnostic Centre/Center
        r"Hospital\s+Name[:\s]+(?=.{0,60}(?:Hospital|Medical|Clinic|Centre|Center|Healthcare|Diagnostic|Apollo|Fortis|Max|AIIMS|Mount|Elizabeth))([A-Z][A-Za-z\s,\.&\-']{5,80})(?=\s*(?:\n|$|Hospital\s+Reg|City|Room\s+Type|Address|License))",

        # Acronyms + Hospital: "KIMS Hospital" / "AIIMS" / "CMC Vellore"
        r"([A-Z]{2,6}\s+(?:Hospital|Medical\s+Center|Institute)(?:,\s+[A-Z][A-Za-z\s]+)?)",

        # Diagnostic Centre/Center variations (common in India): "Anil Diagnostic Centre"
        r"([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s+(?:Diagnostic|Diagnostics)\s+(?:Centre|Center))(?=\s*(?:\n|$|Hospital\s+Reg|City|Address|License))",

        # India city-based hospitals: "Chennai Apollo" / "Bangalore Fortis"
        r"([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s+(?:Apollo|Fortis|Max|Manipal|Columbia\s+Asia|Medanta))",
    ],
    "service_date": [
        r"(?:Date\s*of\s*Service|Service\s*Date|DOS|Treatment\s*Date)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        r"(?:Consultation\s*Date|Visit\s*Date)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        # Two-line written-month: "Service Date\n28 June 2025"
        r"Service\s*Date\s*\n\s*(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
        # Inline written-month: "Service Date: 28 June 2025"
        r"(?:Service\s*Date|Date\s*of\s*Service|Visit\s*Date)[:\s]+(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
    ],
    "admission_date": [
        r"(?:Admission\s*Date|Date\s*of\s*Admission|Admitted\s*On)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        r"(?:Date\s*of\s*Admission)\s+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
    ],
    "discharge_date": [
        r"(?:Discharge\s*Date|Date\s*of\s*Discharge|Discharged\s*On)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        r"(?:Date\s*of\s*Discharge)\s+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
    ],
    "diagnosis_code": [
        r"(?:ICD[\-\s]?(?:10|9|Code)|Diagnosis\s*Code|Dx\s*Code)[:\s]+([A-Z]\d{2}(?:\.\d{1,4})?)",
        r"(?:Primary\s*Diagnosis)[:\s]+([A-Z]\d{2}(?:\.\d{1,4})?)\s*[-—]?\s*",
    ],
    "diagnosis_desc": [
        r"(?:Primary\s*Diagnosis)[:\s]+[A-Z]\d{2}(?:\.\d{1,4})?\s*[-—]\s*([A-Za-z\s,\(\)]+?)(?:\n|Secondary|ICD)",
        r"(?:Diagnosis\s*Description)[:\s]+([A-Za-z\s,\(\)]+?)(?:\n|$)",
        # India-specific: "Primary Diagnosis: Pneumonia" without ICD code
        r"(?:Primary\s*Diagnosis)[:\s]+([A-Za-z][A-Za-z\s,\(\)]+?)(?:\s*Type\s*of\s*Treatment|\n|$)",
    ],
    "total_billed": [
        # Most specific first — "Amount Claimed" / "Claimed Amount" is the actual reimbursement value
        r"(?:Amount\s*Claimed|Claimed\s*Amount|Total\s*Claimed)[:\s]+(?:AED|INR|SAR|₹|USD)?\s*([\d,]+(?:\.\d{2})?)",
        # Two-line DAMAN format: "Amount Claimed\nAED 610.00"
        r"(?:Amount\s*Claimed|Claimed\s*Amount)\s*\n\s*(?:AED|INR|SAR|₹|USD)?\s*([\d,]+(?:\.\d{2})?)",
        # India-specific: "Total Submitted Claim Amount" (Star Health, ICICI Lombard)
        r"(?:Total\s*Submitted\s*Claim\s*Amount)[:\s]+(?:AED|INR|SAR|₹|USD)?\s*([\d,]+(?:\.\d{2})?)",
        r"(?:Total\s*Claim)[:\s]+(?:AED|INR|SAR|₹|USD|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)",
        r"(?:Total\s*Claim)\s+(?:AED|INR|SAR|₹|USD|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)",
        # Net payable / Total Bill
        r"(?:Net\s*(?:Payable|Amount\s*Payable)|Total\s*Bill)[:\s]+(?:AED|INR|SAR|₹|USD)?\s*([\d,]+(?:\.\d{2})?)",
        # Total Billed / Total Charges (specific billing terms)
        r"(?:Total\s*(?:Billed|Charges?))[:\s]+(?:AED|INR|SAR|₹|USD)?\s*([\d,]+(?:\.\d{2})?)",
        # Grand Total (line-boundary anchor to avoid matching mid-table)
        r"Grand\s*Total[:\s]+(?:AED|INR|SAR|₹|USD)?\s*([\d,]+(?:\.\d{2})?)(?:\s|$|\n)",
        # "Total Amount" — too generic (can match sum-insured / coverage amount)
        r"(?:Total\s*Amount)[:\s]+(?:AED|INR|SAR|₹|USD)?\s*([\d,]+(?:\.\d{2})?)(?:\s|$|\n)",
        # Standalone currency amount on its own line (common in table footers): "AED 770.00"
        r"^\s*(?:AED|INR|SAR|BHD|OMR|QAR|KWD|₹|USD)\s+([\d,]+(?:\.\d{2})?)\s*$",
    ],
    "currency": [
        r"\b(AED|INR|SAR|BHD|OMR|QAR|KWD)\b",
        r"(?:Currency)[:\s]+(AED|INR|SAR|BHD|OMR|QAR|KWD)",
    ],
    "preauth_number": [
        r"(?:Pre[-\s]?Auth(?:orization)?\s*(?:No|Number|Ref))[:\s]+([A-Z0-9\-]+)",
        r"(?:Authorization\s*(?:No|Number))[:\s]+([A-Z0-9\-]+)",
    ],
}

# ─────────────────────────────────────────────────────────────────────────────
# MARKET-SPECIFIC PATTERNS — GCC
# ─────────────────────────────────────────────────────────────────────────────

PATTERNS_GCC = {
    "insurer_name": [
        # Full company name including "DAMAN / National Health Insurance Company" style header
        r"((?:DAMAN|Daman)\s*[/\-]\s*National\s*Health\s*Insurance\s*(?:Company)?)",
        r"((?:BUPA|Bupa)\s*[/\-]\s*[A-Za-z\s]+(?:Insurance|Health)(?:\s*Company)?)",
        # Label-based extraction
        r"(?:Insurance\s*Company|Insurer|Health\s*Insurance\s*(?:Company|Provider))[:\s\n]+([A-Z][A-Za-z\s\-&]+?(?:Company|Insurance|Health|Corp|LLC)?)\s*(?:\n|$|P\.O|Tel|www)",
        # Well-known insurer names at start of line (MULTILINE)
        r"^(DAMAN|BUPA|AXA|ADNIC|AMAN|MSH|CIGNA|METLIFE|NEXTCARE|GLOBEMED|MEDNET)\b",
        r"((?:Daman|Bupa|AXA|ADNIC|Aman|MSH|Cigna|MetLife|Nextcare|Globemed|MedNet)[A-Za-z\s\-]*(?:Insurance|Health|Healthcare)?(?:\s*Company)?)",
    ],
    "policy_number": [
        # Must contain at least one hyphen (e.g. DAM-POL-2025-GRP-006, DAMAN-CARE-GOLD-2024-001)
        r"(?:Policy\s*(?:Number|No|#))[:\s]+([A-Z]{2,8}[\-][A-Z0-9][\w\-]{4,35})",
        r"(?:Group\s*Policy|Insurance\s*Policy\s*(?:No|Number))[:\s]+([A-Z]{2,8}[\-][A-Z0-9][\w\-]{4,35})",
    ],
    "policy_name": [
        r"(?:Policy\s*Name|Plan\s*Name|Insurance\s*Plan\s*Name)[:\s]+(.{5,80}?)(?:\n|$|Member|Group|Date)",
        r"(?:Daman|Bupa|AXA|MSH|ADNIC|AMAN|MedNet|Nextcare|Globemed)[\s\w\-]+(?:Gold|Silver|Bronze|Platinum|Enhanced|Basic|Standard|Premium|Care|Plus)[\s\w\-]*(?:Plan|Programme|Cover)?",
    ],
    "emirates_id": [
        r"(?:Emirates\s*ID|EID|National\s*ID\s*No)[:\s]*(784[\-\s]?\d{4}[\-\s]?\d{7}[\-\s]?\d)",
    ],
    "dha_auth_code": [
        r"(?:DHA\s*Auth(?:orization)?\s*(?:No|Code|Ref)|DOH\s*Auth)[:\s]*([A-Z0-9\-]{6,20})",
        r"(?:HAAD|SEHA|DHA)\s*Ref[:\s]*([A-Z0-9\-]{6,20})",
    ],
    "network_tier": [
        r"(?:Network\s*Type|Plan\s*Type|Coverage\s*Type)[:\s]*((?:Network|Direct|Reimbursement|In-?network|Out-?of-?network))",
        r"(?:Gold|Silver|Bronze|Platinum|Premium|Basic)\s*(?:Plan|Network|Coverage)",
    ],
    "copay_percentage": [
        r"(?:Co-?pay|Patient\s*Share)[:\s]*(\d{1,3})\s*%",
        r"(\d{1,3})\s*%\s*(?:co-?pay|patient\s*portion)",
    ],
    "provider_license": [
        r"(?:DHA|DOH|HAAD)\s*License[:\s#]*([A-Z0-9\-]+)",
        r"(?:Facility\s*License|Healthcare\s*License)[:\s]+([A-Z0-9\-]+)",
    ],
    "member_nationality": [
        r"(?:Nationality)[:\s]+([A-Z][a-zA-Z]{3,30})(?:\s*\n|\s*$|\s+Gender|\s+DOB|\s+Date|\s+Network)",
    ],
    # Extended fields for complete record capture
    "contact_number": [
        r"(?:Contact\s*(?:Number|No|Tel)|Mobile|Phone|Tel)[:\s]+(\+?[\d\s\-\(\)]{8,20})",
        r"(\+971[\s\-]?\d{2}[\s\-]?\d{3}[\s\-]?\d{4})",  # UAE mobile format
    ],
    "email_address": [
        r"(?:Email\s*(?:Address|ID)?)[:\s]+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})",
        r"([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.(?:ae|com|org|net))",
    ],
    "patient_address": [
        r"(?:Residential\s*Address|Home\s*Address|Patient\s*Address)[:\s]+(.{10,100}?)(?:\n|Emirate|City|$)",
        r"(?:Address)[:\s]+(Villa\s*\d+.{5,80}?)(?:\n|Emirate|$)",
    ],
    "emirate": [
        r"(?:Emirate|City)[:\s]+(Abu\s*Dhabi|Dubai|Sharjah|Ajman|Fujairah|Ras\s*al\s*Khaimah|Umm\s*al\s*Quwain)",
    ],
    "gender": [
        r"(?:Gender)[:\s]+(Male|Female)",
    ],
    "treating_physician": [
        r"(?:Treating\s*(?:Physician|Doctor|Consultant)|Physician\s*Name)[:\s]+(Dr\.?\s+[A-Za-z\s]+?)(?:\n|$|\(|License)",
        r"(Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*(?:\(|MBBS|MD|DHA)",
    ],
    "physician_license": [
        r"(?:Physician\s*License|Doctor\s*License|DHA\s*Physician)[:\s#]+([A-Z0-9\-]+)",
    ],
    "pre_auth_number": [
        # Require PA followed by hyphen or digit immediately (not PA-tient)
        r"(?:Pre-?[Aa]uth(?:orization)?\s*(?:Number|No|Ref|Code))[:\s]+(PA[-\d][A-Z0-9\-]{3,23})",
        r"\b(PA-\d{4}-[A-Z]{2,8}-\d{4,10})\b",
    ],
    "pre_auth_status": [
        r"(?:Pre-?[Aa]uth\s*(?:Approved|Status))[:\s]+(YES|NO|Approved|Denied|Pending)",
    ],
    "group_sponsor": [
        r"(?:Group\s*[/]?\s*Sponsor|Employer|Company\s*Name)[:\s]+([A-Za-z][\w\s&\.\-]{3,50}?)(?:\n|$|\t|Coverage|Gender)",
    ],
    "coverage_start": [
        r"(?:Coverage\s*Start|Policy\s*Start|Effective\s*Date)[:\s]+(\d{1,2}\s+\w+\s+\d{4}|\d{2}[\/\-]\d{2}[\/\-]\d{4})",
    ],
    "coverage_end": [
        r"(?:Coverage\s*End|Policy\s*End|Expiry\s*Date)[:\s]+(\d{1,2}\s+\w+\s+\d{4}|\d{2}[\/\-]\d{2}[\/\-]\d{4})",
    ],
    "hospital_address": [
        r"(?:Provider\s*Address|Hospital\s*Address|Clinic\s*Address)[:\s]+(.{10,120}?)(?:\n|$|Treating|License)",
    ],
    "hospital_license": [
        r"(?:License\s*Number|Facility\s*License|Hospital\s*License)[:\s]+([A-Z]{2,5}[\-\w]{5,20})",
    ],
    "hospital_name": [
        # Explicit hospital name labels
        r"(?:Hospital\s*Name|Provider\s*Name|Facility\s*Name|Clinic\s*Name)[:\s]+(?!.*(?:signature|declaration|undersigned))([A-Z][A-Za-z\s,\.&\-']{3,60})(?=\n|$|Address|License|Code)",
        # "Hospital / Clinic [NAME]" format (common in UAE claim forms)
        r"(?:Hospital\s*/\s*Clinic|Clinic\s*/\s*Hospital)\s+([A-Z][A-Za-z\s\-'&]+(?:Hospital|Medical\s*Center|Clinic|Healthcare|Pharmacy))(?=\s+Provider|$|\n)",
        # Hospital/Medical Center in header
        r"^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,4}\s+(?:Hospital|Medical\s*Center|Clinic|Healthcare))\s*$",
        # Well-known UAE hospitals (enhanced with variations)
        r"(NMC\s+(?:Royal|Specialty|Healthcare|Surgical)?\s*Hospital|American\s*Hospital|Mediclinic(?:\s+[A-Z][a-z]+)?|Aster\s+(?:Hospital|Clinic)|Zulekha\s*Hospital|Al\s*Zahra\s*Hospital|Saudi\s*German\s*Hospital|Burjeel\s+(?:Hospital|Medical\s*Center)|Thumbay\s*Hospital|RAK\s*Hospital|Cleveland\s*Clinic)",
    ],
}

# ─────────────────────────────────────────────────────────────────────────────
# MARKET-SPECIFIC PATTERNS — India
# ─────────────────────────────────────────────────────────────────────────────

PATTERNS_INDIA = {
    "aadhaar_number": [
        r"(?:Aadhaar|Aadhar|UID)[:\s#]*(\d{4}\s?\d{4}\s?\d{4})",
    ],
    "pan_number": [
        r"(?:PAN)[:\s]+([A-Z]{5}\d{4}[A-Z])",
    ],
    "tpa_id": [
        r"(?:Company\s*/\s*TPA\s*ID|Company/TPA\s*ID|TPA\s*ID|MA\s*ID)\s*(?:No)?[: \t]*([A-Z](?:[ \t]*[A-Z0-9]){3,20})",
        r"(?:Company\s*/\s*TPA\s*ID|Company/TPA\s*ID|TPA\s*ID|MA\s*ID)\s*(?:No)?[:\s]*([A-Z]{0,4}[-]?\d{3,10})",
        r"(?:TPA\s*(?:ID|Code|Name|Ref)|Third\s*Party\s*Administrator)[:\s]+([A-Z0-9\-]+)",
    ],
    "certificate_number": [
        r"(?:Certificate\s*(?:No|Number)|SI\.?\s*No\s*/\s*Certificate\s*No\.?)[:\s]*([A-Z0-9\/\-]{4,30})",
    ],
    "tpa_claim_number": [
        r"(?:TPA\s*Claim\s*(?:No|Number|Ref)|Cashless\s*(?:Auth|Ref))[:\s]+([A-Z0-9\-]+)",
    ],
    "irdai_policy_number": [
        r"(?:Policy\s*(?:Number|No\.?)|IRDAI\s*(?:Policy|Ref))[: \t]*([A-Z0-9](?:[ \t]*[A-Z0-9]){3,35})",
        r"(?:Policy\s*(?:Number|No\.?)|IRDAI\s*(?:Policy|Ref))[:\s]*([A-Z0-9\/\-]{4,35})",
    ],
    "primary_insured_name": [
        r"(?:DETAILS\s+OF\s+PRIMARY\s+INSURED[\s\S]{0,260}?Company\s*/?\s*TPA\s*ID[^\n]*?\s+Name\s+)([A-Z][A-Za-z\s\.]{3,60})(?=\n|Address|City|State|Phone|Email)",
        r"(?:Policy\s*No\.?[^\n]{0,160}?\bName\s+)([A-Z][A-Za-z\s\.]{3,60})(?=\n|Address|City|State|Phone|Email)",
    ],
    "primary_insured_address": [
        r"(?:Address)\s+(.{8,120}?)(?=\s+City\s+|\nState|\nPhone|\nEmail)",
    ],
    "primary_insured_phone": [
        r"(?:Phone\s*No\.?|Mobile\s*No\.?)[:\s]*([6-9]\d{9})",
    ],
    "primary_insured_email": [
        r"(?:Email\s*ID)[:\s]*([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})",
    ],
    "sum_insured": [
        r"(?:Sum\s*Insured\s*\(Rs\)?\s*)[:\s]*([\d,]+)",
    ],
    "hospitalized_person_name": [
        r"(?:DETAILS\s+OF\s+INSURED\s+PERSON\s+HOSPITALI[ZS]ED[\s\S]{0,80}?Name\s+)([A-Z][A-Za-z \.]{3,60}?)(?=\s+Gender|\n|Age|Date)",
    ],
    "gender": [
        r"(?:Gender)\s+(Male|Female|Other)",
    ],
    "relationship_to_primary_insured": [
        r"(?:Relationship(?:\s+to\s+Primary\s+insured)?[:\s]+)(Self|Spouse|Child|Father|Mother|Parent|Other)",
    ],
    "occupation": [
        r"(?:Occupation)\s+(Service|Self\s*Employed|Home\s*Maker|Homemaker|Student|Retired|Other)",
    ],
    "room_category": [
        r"(?:Room\s*Category(?:\s*occupied)?[:\s]+)(Day\s*care|Single\s*occupancy|Twin\s*sharing|3\s*or\s*more\s*beds\s*per\s*room|General|Private|Semi-?Private)",
    ],
    "hospitalisation_due_to": [
        r"(?:Hospitali[sz]ation\s+due\s+to)[:\s]+(Injury|Illness|Maternity)",
    ],
    "date_of_injury_or_detection": [
        r"(?:Date\s+of\s+Injury\s*/\s*Detection|Date\s+of\s+injury\s*/\s*Date\s+Disease\s+first\s+detected\s*/?\s*Date\s+of\s+Delivery)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
    ],
    "pre_hospitalisation_expenses": [
        r"(?:Pre[\-\s]*hospitali[sz]ation\s+expense\w*\s*(?:Rs|Rss|Ress)?\s*)([\d,]+)",
    ],
    "hospitalisation_expenses": [
        r"(?:Hospitali[sz]ation\s+expenses\s*(?:Rs|Rss|Ress)?\s*)([\d,]+)",
    ],
    "post_hospitalisation_expenses": [
        r"(?:Post[\-\s]*hospitali[sz]ation\s+expense\w*\s*(?:Rs|Rss|Ress)?\s*)([\d,]+)",
    ],
    "health_checkup_cost": [
        r"(?:Health[\-\s]*check\s*up\s+cost\s*(?:Rs|Rss|Ress)?\s*)([\d,]+)",
    ],
    "ambulance_charges": [
        r"(?:Ambulance\s+Charges\s*(?:Rs|Rss|Ress)?\s*)([\d,]+)",
    ],
    "other_claim_expenses": [
        r"(?:Others\s*(?:Rs|Rss|Ress)?\s*)([\d,]+)",
    ],
    "total_claim_amount": [
        r"(?:Total\s+Claim\s*(?:Rs|Rss|Ress)?\s*)([\d,]+)",
        r"(?:Total\s+Rs\.?\s*)([\d,]+)",
    ],
    "abha_id": [
        r"(?:ABHA|Ayushman\s*Bharat\s*Health\s*Account)[:\s]+(\d{14}|\d{2}-\d{4}-\d{4}-\d{4})",
    ],
    "room_rent_type": [
        r"(?:Room\s*Type|Ward\s*Type|Accommodation)[:\s]+((?:General|Shared|Semi-?Private|Private|Suite|ICU)\s*(?:Ward|Room)?)",
    ],
    "cashless_auth_number": [
        r"(?:Cashless\s*Authorization|Pre-?auth(?:orization)?)\s*(?:No|Number|Code)[:\s]+([A-Z0-9\-]+)",
        r"(?:Auth(?:orization)?\s*Code)[:\s]+([A-Z0-9\-]{6,20})",
    ],
    "gipsa_package": [
        r"(?:GIPSA|Package\s*(?:Name|Code))[:\s]+([A-Za-z0-9\s\-]+?)(?:\n|$|Rate|Amount)",
    ],
    "insurance_company": [
        r"(?:Insurance\s*Company|Insurer|TPA\s*for)[:\s]+([A-Z][A-Za-z\s]+?)(?:\n|$|Policy|Branch)",
    ],
    "state": [
        r"(?:State)[:\s]+([A-Z][a-zA-Z\s]+?)(?:\n|$|PIN|City)",
    ],
    "hospital_name": [
        # Explicit hospital name labels
        r"(?:Hospital\s+Name|Name\s+of\s+Hospital\s+where\s+Admited|Name\s+of\s+Hospital\s+where\s+Admitted)[:\s]+([A-Z][A-Za-z ,\.&\-']{3,80}?)(?=\s+Room\s+Category|\n|Address|City|Pin|Landmark)",
        r"(?:Hospital\s*Name|Provider\s*Name|Facility\s*Name)[:\s]+(?!.*(?:signature|declaration|undersigned))([A-Z][A-Za-z\s,\.&\-']{3,60})(?=\n|$|Address|License|Registration)",
        # "Hospital / Nursing Home [NAME]" format (common in Indian claim forms)
        r"(?:Hospital\s*/\s*(?:Nursing\s*Home|Clinic)|Nursing\s*Home\s*/\s*Hospital)\s+([A-Z][A-Za-z\s\-'&]+(?:Hospital|Medical\s*Center|Nursing\s*Home|Healthcare))(?=\s+(?:Address|Registration|ROHINI)|$|\n)",
        # Hospital/Medical Center in header
        r"^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,4}\s+(?:Hospital|Medical\s*Center|Nursing\s*Home|Healthcare))\s*$",
        # Well-known India hospital chains (enhanced with variations)
        r"(Apollo\s+(?:Hospital|Clinic|Pharmacy)?|Fortis\s+Hospital|Max\s+(?:Healthcare|Hospital)|AIIMS(?:\s+[A-Z][a-z]+)?|Manipal\s+Hospital|Narayana\s+Health|Medanta(?:\s+[A-Z][a-z]+)?|Columbia\s*Asia|Kokilaben\s*Hospital|Lilavati\s*Hospital|Breach\s*Candy\s*Hospital|Jaslok\s*Hospital|KIMS\s*Hospital|Care\s*Hospital)",
    ],
}

# ─────────────────────────────────────────────────────────────────────────────
# BANK / PAYMENT ACCOUNT PATTERNS  (used by Account Module)
# ─────────────────────────────────────────────────────────────────────────────

PATTERNS_BANK = {
    # Account holder name
    "bank_account_holder": [
        r"(?:Account\s*Holder(?:'s)?\s*Name|Beneficiary\s*Name|Name\s*of\s*Account\s*Holder|A/c\s*Holder)[:\s]+([A-Z][A-Za-z\s\.]+?)(?:\n|$|Account|Bank|IBAN|IFSC)",
        r"(?:Payee\s*Name|Pay\s*to)[:\s]+([A-Z][A-Za-z\s\.]+?)(?:\n|$|Account|Bank|IBAN)",
    ],
    # Bank name
    "bank_name": [
        r"(?:Bank\s*Name\s*&\s*Branch|Bank\s*Name\s*and\s*Branch)[:\s]*([A-Z][A-Za-z\s,\.&\-]+?)(?:\n|$|IFSC|Cheque|DD|Account)",
        r"(?:Bank\s*Name|Name\s*of\s*Bank|Banker|Bank)[:\s]+([A-Z][A-Za-z\s,\.&\-]+?)(?:\n|$|Branch|Account|IFSC|IBAN|SWIFT)",
        r"(?:Drawee\s*Bank|Remitting\s*Bank)[:\s]+([A-Z][A-Za-z\s,\.&\-]+?)(?:\n|$|Branch|Account)",
    ],
    # IBAN — GCC (AE, SA, BH, QA, KW, OM) and other markets
    "iban": [
        r"\b((?:AE|SA|BH|QA|KW|OM|GB|DE|FR|NL|IN)\d{2}[A-Z0-9]{4,30})\b",
        r"(?:IBAN|International\s*Bank\s*Account\s*Number)[:\s]+([A-Z]{2}\d{2}[A-Z0-9\s]{4,30})",
    ],
    # SWIFT / BIC
    "swift_bic": [
        r"(?:SWIFT\s*(?:Code|BIC)?|BIC\s*Code?)[:\s]+([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)",
        r"\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}[A-Z0-9]{3})\b(?=\s*(?:BIC|SWIFT|\n))",
    ],
    # India: Bank Account Number
    "account_number": [
        r"(?:Account\s*(?:No|Number|Num)|A/?c\s*(?:No|Number)|Bank\s*A/?c)[:\s#\.]+(\d{9,18})",
        r"(?:Savings|Current|NRE|NRO)\s*(?:A/?c|Account)[:\s#]+(\d{9,18})",
    ],
    # India: IFSC
    "ifsc_code": [
        r"(?:IFSC\s*(?:Code)?|MICR\s*IFSC)[:\s]+([A-Z]{4}0[A-Z0-9]{6})",
        r"\b([A-Z]{4}0[A-Z0-9]{6})\b",
    ],
    # UPI / VPA (India / PayTM)
    "upi_vpa": [
        r"(?:UPI\s*(?:ID|VPA|Address)?|VPA|Pay\s*ID)[:\s]+([a-zA-Z0-9\.\-_]{3,50}@[a-zA-Z]{3,20})",
        r"\b([a-zA-Z0-9\.\-_]{3,50}@(?:okaxis|okicici|oksbi|okhdfcbank|paytm|ybl|upi|razorpay|apl|ibl|aubank|axl|barodampay|cnrb|cosb|ezeepay|fbl|finb|hdfcbank|icici|idfcbank|indus|jiomoney|kotak|kvb|lvb|mahb|myicici|pingpay|pnb|postbank|purz|rbl|sbi|sc|scmobile|timecosmos|uco|unionbank|utib|vijb|waaxis|yesbank|axis|airtel|citi|equitas|esewa|freecharge|ideabank|indusind|mahindra|mobikwik|niyoicici|phonepe|sms|sliceaxis|super|tapicici|tapzest|waicici|yesb|zenus))\b",
    ],
    # UK Sort Code
    "sort_code": [
        r"(?:Sort\s*Code)[:\s]+(\d{2}[-\s]?\d{2}[-\s]?\d{2})",
    ],
    # USA Routing Number
    "routing_number": [
        r"(?:Routing\s*(?:Number|No|#)|ABA\s*(?:Number)?)[:\s]+(\d{9})",
    ],
}

# ─────────────────────────────────────────────────────────────────────────────
# CLAIM TYPE INFERENCE
# ─────────────────────────────────────────────────────────────────────────────

CLAIM_TYPE_KEYWORDS = {
    "INPATIENT":  ["inpatient", "admitted", "hospitalization", "ward", "discharge date", "room rent"],
    "DAYCARE":    ["daycare", "day care", "day surgery", "day procedure"],
    "EMERGENCY":  ["emergency", "er visit", "casualty", "a&e", "accident & emergency"],
    "MATERNITY":  ["maternity", "delivery", "obstetric", "labour", "antenatal"],
    "DENTAL":     ["dental", "tooth", "teeth", "oral"],
    "OPTICAL":    ["optical", "spectacle", "vision", "glasses", "contact lens"],
    "PHARMACY":   ["pharmacy", "prescription", "medicine only", "drugs only"],
    "OUTPATIENT": ["outpatient", "opd", "consultation", "clinic visit"],
}

# ICD-10 code pattern
ICD10_PATTERN = re.compile(r'\b([A-Z]\d{2}(?:\.\d{1,4})?)\b')

# CPT / procedure code pattern — also matches non-numeric codes like PHARM-B, ROOM-A
CPT_PATTERN = re.compile(r'\b(\d{5}(?:[A-Z]{0,2})?|[A-Z]{3,8}-[A-Z0-9]{1,3})\b')

# Amount pattern
AMOUNT_PATTERN = re.compile(r'(?:AED|INR|SAR|₹)?\s*([\d,]+(?:\.\d{2})?)')

SERVICE_CATEGORY_MAP = {
    "99201": "CONSULTATION", "99202": "CONSULTATION", "99203": "CONSULTATION",
    "99204": "CONSULTATION", "99205": "CONSULTATION", "99211": "CONSULTATION",
    "99212": "CONSULTATION", "99213": "CONSULTATION", "99214": "CONSULTATION",
    "99215": "CONSULTATION",
    "71046": "DIAGNOSTIC", "71045": "DIAGNOSTIC", "73030": "DIAGNOSTIC",
    "74150": "DIAGNOSTIC", "74160": "DIAGNOSTIC", "74170": "DIAGNOSTIC",
    "70450": "DIAGNOSTIC", "70460": "DIAGNOSTIC", "70470": "DIAGNOSTIC",
    "85025": "LAB", "85027": "LAB", "80053": "LAB", "80048": "LAB",
    "84443": "LAB", "82947": "LAB", "83036": "LAB",
    "27447": "SURGERY", "27130": "SURGERY", "43239": "SURGERY",
    "99291": "ICU", "99292": "ICU",
    # Standard aliases
    "PHARMA": "PHARMACY", "MEDICINE": "PHARMACY",
    "ROOM": "ROOM_RENT", "ROOMRENT": "ROOM_RENT",
    # Non-numeric pharmacy codes used by some UAE/GCC providers (e.g. PHARM-B, PHARM-A)
    "PHARM-A": "PHARMACY", "PHARM-B": "PHARMACY", "PHARM-C": "PHARMACY",
    "PHARM-D": "PHARMACY", "PHARM-E": "PHARMACY", "PHARM-F": "PHARMACY",
}


# ─────────────────────────────────────────────────────────────────────────────
# OCR ENGINE
# ─────────────────────────────────────────────────────────────────────────────

class OCREngine:
    """
    Extracts structured claim fields from uploaded PDF / image documents.

    Priority order:
    1. pdfplumber  — for digital/text-layer PDFs (fast, high accuracy)
    2. Tesseract   — for scanned/image PDFs (requires tesseract-ocr installed)
    3. Fallback    — returns empty result with zero confidence

    Market detection:
    - Runs signal scoring across all market keyword sets
    - Returns market_detection_confidence and market_requires_confirmation
    - Selects market-specific field patterns after detection
    """

    def __init__(self):
        self._pdfplumber_available = self._check_pdfplumber()
        self._tesseract_available = self._check_tesseract()
        self._redis_client = self._init_redis()
        logger.info(
            "OCREngine initialized | pdfplumber=%s | tesseract=%s | redis_cache=%s",
            self._pdfplumber_available, self._tesseract_available, self._redis_client is not None
        )

    def _init_redis(self):
        """Initialize Redis client for caching OCR results."""
        try:
            import redis
            client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                db=REDIS_DB,
                decode_responses=False,  # We'll handle JSON encoding manually
                socket_connect_timeout=2,
                socket_timeout=2
            )
            # Test connection
            client.ping()
            logger.info("Redis cache initialized: %s:%d", REDIS_HOST, REDIS_PORT)
            return client
        except Exception as e:
            logger.warning("Redis cache not available (OCR will run without caching): %s", e)
            return None

    def _check_pdfplumber(self) -> bool:
        try:
            import pdfplumber  # noqa: F401
            return True
        except ImportError:
            logger.warning("pdfplumber not installed — pip install pdfplumber")
            return False

    def _check_tesseract(self) -> bool:
        try:
            import pytesseract
            pytesseract.get_tesseract_version()
            return True
        except Exception:
            logger.warning("Tesseract not available — scanned PDFs cannot be processed")
            return False

    # ── Redis Cache Helper Methods ───────────────────────────────────────────

    def _get_from_cache(self, pdf_hash: str) -> Optional[OCRResult]:
        """Retrieve OCR result from Redis cache."""
        if not self._redis_client:
            return None

        try:
            cache_key = f"ocr:hash:{pdf_hash}"
            cached_data = self._redis_client.get(cache_key)

            if cached_data:
                # Deserialize JSON to OCRResult
                data_dict = json.loads(cached_data.decode('utf-8'))
                result = self._dict_to_ocr_result(data_dict)
                logger.info("[OCR-CACHE] ✅ HIT for hash %s (saved OCR processing)", pdf_hash[:12])
                return result
            else:
                logger.debug("[OCR-CACHE] ❌ MISS for hash %s", pdf_hash[:12])
                return None
        except Exception as e:
            logger.warning("[OCR-CACHE] Error retrieving from cache: %s", e)
            return None

    def _save_to_cache(self, pdf_hash: str, ocr_result: OCRResult):
        """Save OCR result to Redis cache."""
        if not self._redis_client:
            return

        try:
            cache_key = f"ocr:hash:{pdf_hash}"
            # Serialize OCRResult to JSON
            result_dict = self._ocr_result_to_dict(ocr_result)
            json_data = json.dumps(result_dict).encode('utf-8')

            # Store with TTL
            self._redis_client.setex(cache_key, OCR_CACHE_TTL, json_data)
            logger.info("[OCR-CACHE] 💾 Saved result for hash %s (TTL: %ds)", pdf_hash[:12], OCR_CACHE_TTL)
        except Exception as e:
            logger.warning("[OCR-CACHE] Error saving to cache: %s", e)

    def _ocr_result_to_dict(self, result: OCRResult) -> dict:
        """Convert OCRResult to dict for JSON serialization."""
        return {
            'document_hash': result.document_hash,
            'raw_text': result.raw_text,
            'ocr_engine_used': result.ocr_engine_used,
            'page_count': result.page_count,
            'page_texts': result.page_texts,
            'overall_confidence': result.overall_confidence,
            'market_detection_confidence': result.market_detection_confidence,
            'market_requires_confirmation': result.market_requires_confirmation,
            # Extract all fields
            'fields': {
                'claim_type': asdict(result.claim_type) if hasattr(result.claim_type, '__dict__') else result.claim_type.__dict__,
                'market_region': asdict(result.market_region) if hasattr(result.market_region, '__dict__') else result.market_region.__dict__,
                'currency': asdict(result.currency) if hasattr(result.currency, '__dict__') else result.currency.__dict__,
                'member_number': asdict(result.member_number) if hasattr(result.member_number, '__dict__') else result.member_number.__dict__,
                'policy_number': asdict(result.policy_number) if hasattr(result.policy_number, '__dict__') else result.policy_number.__dict__,
                'policy_name': asdict(result.policy_name) if hasattr(result.policy_name, '__dict__') else result.policy_name.__dict__,
                'patient_name': asdict(result.patient_name) if hasattr(result.patient_name, '__dict__') else result.patient_name.__dict__,
                'patient_dob': asdict(result.patient_dob) if hasattr(result.patient_dob, '__dict__') else result.patient_dob.__dict__,
                'provider_name': asdict(result.provider_name) if hasattr(result.provider_name, '__dict__') else result.provider_name.__dict__,
                'provider_code': asdict(result.provider_code) if hasattr(result.provider_code, '__dict__') else result.provider_code.__dict__,
                'service_date': asdict(result.service_date) if hasattr(result.service_date, '__dict__') else result.service_date.__dict__,
                'admission_date': asdict(result.admission_date) if hasattr(result.admission_date, '__dict__') else result.admission_date.__dict__,
                'discharge_date': asdict(result.discharge_date) if hasattr(result.discharge_date, '__dict__') else result.discharge_date.__dict__,
                'primary_diagnosis_code': asdict(result.primary_diagnosis_code) if hasattr(result.primary_diagnosis_code, '__dict__') else result.primary_diagnosis_code.__dict__,
                'primary_diagnosis_desc': asdict(result.primary_diagnosis_desc) if hasattr(result.primary_diagnosis_desc, '__dict__') else result.primary_diagnosis_desc.__dict__,
                'total_billed': asdict(result.total_billed) if hasattr(result.total_billed, '__dict__') else result.total_billed.__dict__,
                'bank_account_holder': asdict(result.bank_account_holder) if hasattr(result.bank_account_holder, '__dict__') else result.bank_account_holder.__dict__,
                'bank_name': asdict(result.bank_name) if hasattr(result.bank_name, '__dict__') else result.bank_name.__dict__,
                'iban': asdict(result.iban) if hasattr(result.iban, '__dict__') else result.iban.__dict__,
                'swift_bic': asdict(result.swift_bic) if hasattr(result.swift_bic, '__dict__') else result.swift_bic.__dict__,
                'account_number': asdict(result.account_number) if hasattr(result.account_number, '__dict__') else result.account_number.__dict__,
                'ifsc_code': asdict(result.ifsc_code) if hasattr(result.ifsc_code, '__dict__') else result.ifsc_code.__dict__,
                'upi_vpa': asdict(result.upi_vpa) if hasattr(result.upi_vpa, '__dict__') else result.upi_vpa.__dict__,
                'sort_code': asdict(result.sort_code) if hasattr(result.sort_code, '__dict__') else result.sort_code.__dict__,
                'routing_number': asdict(result.routing_number) if hasattr(result.routing_number, '__dict__') else result.routing_number.__dict__,
            },
            'line_items': result.line_items,
        }

    def _dict_to_ocr_result(self, data: dict) -> OCRResult:
        """Convert dict back to OCRResult."""
        result = OCRResult()
        result.document_hash = data.get('document_hash', '')
        result.raw_text = data.get('raw_text', '')
        result.ocr_engine_used = data.get('ocr_engine_used', '')
        result.page_count = data.get('page_count', 0)
        result.page_texts = data.get('page_texts', [])
        result.overall_confidence = data.get('overall_confidence', 0.0)
        result.market_detection_confidence = data.get('market_detection_confidence', 0.0)
        result.market_requires_confirmation = data.get('market_requires_confirmation', False)

        # Restore fields
        fields = data.get('fields', {})
        for field_name, field_data in fields.items():
            if hasattr(result, field_name):
                setattr(result, field_name, ExtractedField(**field_data))

        result.line_items = data.get('line_items', [])
        return result

    # ── Public API ────────────────────────────────────────────────────────────

    def extract_from_bytes(self, pdf_bytes: bytes, filename: str = "claim.pdf") -> OCRResult:
        """
        Main entry point. Extract structured claim data from raw PDF bytes.
        Checks Redis cache first to avoid re-processing duplicate documents.
        """
        # Compute PDF hash for caching and duplicate detection
        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

        # Try to get from cache first
        cached_result = self._get_from_cache(pdf_hash)
        if cached_result:
            cached_result.from_cache = True  # Flag for metrics
            return cached_result

        # Cache miss - proceed with OCR extraction
        result = OCRResult()
        result.document_hash = pdf_hash

        # Step 1: Try pdfplumber (digital PDF)
        if self._pdfplumber_available:
            text, page_count, page_texts = self._extract_text_pdfplumber(pdf_bytes)
            result.page_count = page_count
            result.page_texts = page_texts
            if text and len(text.strip()) > 100:
                result.raw_text = text
                result.ocr_engine_used = "pdfplumber"
                logger.info("OCR: pdfplumber extracted %d chars from %s", len(text), filename)
                final_result = self._parse_text_to_fields(result, text, source="pdfplumber")
                # Save to cache for future requests
                self._save_to_cache(pdf_hash, final_result)
                return final_result

        # Step 2: Fallback to Tesseract (scanned/image PDF)
        if self._tesseract_available:
            text, page_count = self._extract_text_tesseract(pdf_bytes)
            result.page_count = page_count
            if text:
                result.raw_text = text
                result.ocr_engine_used = "tesseract"
                logger.info("OCR: tesseract extracted %d chars from %s", len(text), filename)
                final_result = self._parse_text_to_fields(result, text, source="tesseract")
                # Save to cache for future requests
                self._save_to_cache(pdf_hash, final_result)
                return final_result

        # Step 3: No OCR available
        logger.error("OCR: no extraction engine available for %s", filename)
        result.ocr_engine_used = "none"
        result.overall_confidence = 0.0
        # Don't cache failed results
        return result

    def extract_from_path(self, file_path: str) -> OCRResult:
        """Extract from a file path."""
        with open(file_path, "rb") as f:
            return self.extract_from_bytes(f.read(), os.path.basename(file_path))

    # ── Text Extraction ───────────────────────────────────────────────────────

    def _extract_text_pdfplumber(self, pdf_bytes: bytes) -> tuple[str, int, list]:
        """Extract text from digital PDF using pdfplumber.
        Returns (full_text, page_count, page_texts) where page_texts is
        [{"page": 1, "text": "..."}, ...] for per-page audit trail.
        """
        import pdfplumber

        all_text = []
        page_texts = []
        page_count = 0
        try:
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                page_count = len(pdf.pages)
                for idx, page in enumerate(pdf.pages, start=1):
                    page_parts = []
                    text = page.extract_text(x_tolerance=3, y_tolerance=3)
                    if text:
                        page_parts.append(text)
                    # Also extract tables (important for itemized bills)
                    for table in page.extract_tables():
                        for row in table:
                            if row:
                                page_parts.append("\t".join(str(c or "") for c in row))
                    page_text = "\n".join(page_parts)
                    if page_text:
                        all_text.append(page_text)
                        page_texts.append({"page": idx, "text": page_text})
        except Exception as e:
            logger.error("pdfplumber extraction failed: %s", e)
            return "", 0, []
        return "\n".join(all_text), page_count, page_texts

    def _extract_text_tesseract(self, pdf_bytes: bytes) -> tuple[str, int]:
        """Extract text from scanned PDF using Tesseract OCR."""
        try:
            from PIL import Image, ImageFilter, ImageEnhance
            import pytesseract
        except ImportError as e:
            logger.error("Tesseract deps not available: %s", e)
            return "", 0

        all_text = []
        page_count = 0

        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
            page_count = len(reader.pages)

            for page_num in range(min(page_count, 10)):
                page = reader.pages[page_num]
                for img_obj in page.images:
                    img = Image.open(io.BytesIO(img_obj.data))
                    text = self._tesseract_process_image(img, pytesseract)
                    if text:
                        all_text.append(text)

        except Exception as e:
            logger.warning("PDF-to-image conversion failed, trying direct: %s", e)
            try:
                from PIL import Image
                import pytesseract
                img = Image.open(io.BytesIO(pdf_bytes))
                text = self._tesseract_process_image(img, pytesseract)
                if text:
                    all_text.append(text)
                page_count = 1
            except Exception as e2:
                logger.error("Direct image OCR failed: %s", e2)

        return "\n".join(all_text), page_count

    def _tesseract_process_image(self, img, pytesseract) -> str:
        """Preprocess image and run Tesseract."""
        from PIL import ImageFilter, ImageEnhance, ImageOps

        try:
            img = img.convert("L")
            enhancer = ImageEnhance.Contrast(img)
            img = enhancer.enhance(2.0)
            img = img.filter(ImageFilter.SHARPEN)
            if img.width < 1000:
                scale = 1000 / img.width
                img = img.resize((int(img.width * scale), int(img.height * scale)))

            config = "--psm 6 --oem 3 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,-/:() "
            text = pytesseract.image_to_string(img, config=config)
            return text
        except Exception as e:
            logger.error("Tesseract image processing failed: %s", e)
            return ""

    # ── Field Parsing ─────────────────────────────────────────────────────────

    def _parse_text_to_fields(self, result: OCRResult, text: str, source: str) -> OCRResult:
        """
        Parse raw extracted text into structured claim fields.
        Runs market detection first, then applies market-specific patterns.
        """
        text_lower = text.lower()
        pt = result.page_texts  # per-page text for page number tracking

        # ── Step 1: Market auto-detection (signal scoring)
        market, detect_conf = self._detect_market_with_confidence(text_lower)
        result.market_region = ExtractedField(market, detect_conf, "signal_scoring")
        result.market_detection_confidence = detect_conf
        result.market_requires_confirmation = detect_conf < MARKET_DETECT_HIGH

        # ── Step 2: Currency (from text or market inference)
        result.currency = self._detect_currency(text_lower, market)

        # ── Step 3: Claim type
        result.claim_type = self._detect_claim_type(text_lower)

        # ── Step 4: Common fields
        result.member_number = self._extract_field_from_patterns(
            PATTERNS_COMMON["member_number"], text, source, base_confidence=0.85, page_texts=pt)
        result.patient_name = self._extract_field_from_patterns(
            PATTERNS_COMMON["patient_name"], text, source, base_confidence=0.80, page_texts=pt)
        # Reject form-header bleed-through: names > 50 chars, all-caps heavy, or
        # containing form template keywords indicate the OCR grabbed the wrong text.
        if result.patient_name.value:
            _pn = result.patient_name.value
            _FORM_JUNK = ["CLAIM FORM", "CLAIM REFERENCE", "SUBMISSION DATE",
                          "CLAIM TYPE", "REIMBURSEMENT", "DATE OF SERVICE"]
            # Allow all-caps names (common in PDFs). Only reject if it looks like form junk.
            # Changed: removed _mostly_upper check (was rejecting valid ALL-CAPS names)
            if (len(_pn) > 50
                    or any(kw in _pn.upper() for kw in _FORM_JUNK)):
                result.patient_name = ExtractedField(None, 0.0, source)
        result.patient_dob = self._extract_date_from_patterns(
            PATTERNS_COMMON["patient_dob"], text, source)
        result.provider_name = self._extract_field_from_patterns(
            PATTERNS_COMMON["provider_name"], text, source, base_confidence=0.75, page_texts=pt)
        # Reject form-section headers captured as provider names
        # (e.g. "Provider DETAILS", "Hospital INFORMATION", "Clinic SECTION")
        if result.provider_name.value:
            _prov = result.provider_name.value.strip()
            _PROV_JUNK = ["DETAILS", "INFORMATION", "SECTION", "NAME", "CODE",
                          "ADDRESS", "CONTACT", "SIGNATURE", "DATE", "FORM"]
            if (_prov.upper() in _PROV_JUNK
                    or len(_prov) < 4
                    or _prov.upper() == _prov):  # all-caps single-token junk
                result.provider_name = ExtractedField(None, 0.0, source)
        _provider_code_patterns = [
            r"(?:Provider\s*Code|Facility\s*Code|Hospital\s*Code)[:\s]+([A-Z]{2,5}[\-\s]?\d{3,6})",
            r"(?:Provider\s*Code|Facility\s*Code|Hospital\s*Code)[:\s]*\n\s*([A-Z]{2,5}[\-\s]?\d{3,6})",
        ]
        result.provider_code = self._extract_field_from_patterns(
            _provider_code_patterns, text, source, base_confidence=0.85, page_texts=pt)
        if not result.provider_code.value:
            result.provider_code = ExtractedField("UNKNOWN", 0.3, "inferred")
        result.service_date = self._extract_date_from_patterns(
            PATTERNS_COMMON["service_date"], text, source)
        result.admission_date = self._extract_date_from_patterns(
            PATTERNS_COMMON["admission_date"], text, source)
        result.discharge_date = self._extract_date_from_patterns(
            PATTERNS_COMMON["discharge_date"], text, source)
        result.primary_diagnosis_code = self._extract_icd10(text, source)
        result.primary_diagnosis_desc = self._extract_field_from_patterns(
            PATTERNS_COMMON["diagnosis_desc"], text, source, base_confidence=0.70, page_texts=pt)
        result.total_billed = self._extract_amount_from_patterns(
            PATTERNS_COMMON["total_billed"], text, source)
        result.line_items = self._extract_line_items(text, source)

        # ── Step 4b: Bank/payment account fields for reimbursement routing
        result.bank_account_holder = self._extract_field_from_patterns(
            PATTERNS_BANK["bank_account_holder"], text, source, base_confidence=0.76, page_texts=pt)
        result.bank_name = self._extract_field_from_patterns(
            PATTERNS_BANK["bank_name"], text, source, base_confidence=0.74, page_texts=pt)
        result.iban = self._extract_field_from_patterns(
            PATTERNS_BANK["iban"], text, source, base_confidence=0.86, page_texts=pt)
        if result.iban.value:
            result.iban.value = re.sub(r"\s+", "", result.iban.value).upper()
        result.swift_bic = self._extract_field_from_patterns(
            PATTERNS_BANK["swift_bic"], text, source, base_confidence=0.82, page_texts=pt)
        if result.swift_bic.value:
            result.swift_bic.value = result.swift_bic.value.upper()
        result.account_number = self._extract_field_from_patterns(
            PATTERNS_BANK["account_number"], text, source, base_confidence=0.78, page_texts=pt)
        result.ifsc_code = self._extract_field_from_patterns(
            PATTERNS_BANK["ifsc_code"], text, source, base_confidence=0.86, page_texts=pt)
        if result.ifsc_code.value:
            result.ifsc_code.value = result.ifsc_code.value.upper()
        result.upi_vpa = self._extract_field_from_patterns(
            PATTERNS_BANK["upi_vpa"], text, source, base_confidence=0.84, page_texts=pt)
        result.sort_code = self._extract_field_from_patterns(
            PATTERNS_BANK["sort_code"], text, source, base_confidence=0.78, page_texts=pt)
        result.routing_number = self._extract_field_from_patterns(
            PATTERNS_BANK["routing_number"], text, source, base_confidence=0.78, page_texts=pt)

        # ── Step 5: Market-specific fields
        if market in GCC_REGIONS:
            result.market_specific = self._extract_gcc_fields(text, source)
        else:  # INDIA
            result.market_specific = self._extract_india_fields(text, source)
            self._apply_india_reimbursement_fallbacks(result, text, source)

        # Promote policy_number and policy_name from market_specific into top-level fields
        _pol = result.market_specific.get("policy_number") or result.market_specific.get("irdai_policy_number")
        if _pol:
            result.policy_number = ExtractedField(
                _pol["value"], _pol.get("confidence", 0.8), "market_specific"
            )
        _polname = result.market_specific.get("policy_name")
        if _polname:
            result.policy_name = ExtractedField(
                _polname["value"], _polname.get("confidence", 0.75), "market_specific"
            )

        # ── Step 5b: Fallback — use Emirates ID / Aadhaar as member_number if not found
        if not result.member_number.value:
            _eid = result.market_specific.get("emirates_id")
            if _eid:
                result.member_number = ExtractedField(
                    _eid["value"], _eid.get("confidence", 0.75), "emirates_id_fallback"
                )
            else:
                _aadh = result.market_specific.get("aadhaar_number")
                if _aadh:
                    result.member_number = ExtractedField(
                        _aadh["value"], _aadh.get("confidence", 0.75), "aadhaar_fallback"
                    )

        # ── Step 6: Overall confidence
        scored_fields = [
            result.claim_type, result.market_region, result.currency,
            result.member_number, result.patient_name, result.patient_dob,
            result.provider_name, result.service_date, result.primary_diagnosis_code,
            result.total_billed,
        ]
        confidences = [f.confidence for f in scored_fields if f.confidence > 0]
        result.overall_confidence = sum(confidences) / len(confidences) if confidences else 0.0

        # ── Step 7: Flag low-confidence fields
        result.low_confidence_fields = [
            fname for fname, fval in [
                ("claim_type", result.claim_type),
                ("member_number", result.member_number),
                ("patient_name", result.patient_name),
                ("service_date", result.service_date),
                ("primary_diagnosis_code", result.primary_diagnosis_code),
                ("total_billed", result.total_billed),
            ]
            if fval.confidence < OCR_CONFIDENCE_THRESHOLD
        ]
        if result.market_requires_confirmation:
            result.low_confidence_fields.append("market_region")

        logger.info(
            "OCR parsed: market=%s (conf=%.2f, confirm=%s) overall_conf=%.2f",
            market, detect_conf, result.market_requires_confirmation, result.overall_confidence
        )
        return result

    def _apply_india_reimbursement_fallbacks(self, result: OCRResult, text: str, source: str) -> None:
        """Map India reimbursement section fields into the core claim contract."""
        ms = result.market_specific

        def clean(value: Optional[str]) -> Optional[str]:
            return self._clean_india_reimbursement_value(value)

        for field_name in list(ms):
            cleaned = clean(ms[field_name].get("value"))
            if not cleaned:
                ms.pop(field_name, None)
            else:
                ms[field_name]["value"] = cleaned

        for attr in (
            "patient_name", "provider_name", "provider_code", "primary_diagnosis_desc",
            "bank_name", "bank_account_holder", "account_number", "ifsc_code",
        ):
            current = getattr(result, attr)
            if current.value:
                current.value = self._strip_india_field_suffixes(current.value)
            if current.value:
                cleaned = clean(current.value)
                if cleaned:
                    current.value = cleaned
                else:
                    setattr(result, attr, ExtractedField(None, 0.0, source))

        if "total_claim_amount" in ms and not result.total_billed.value:
            result.total_billed = ExtractedField(
                ms["total_claim_amount"]["value"],
                ms["total_claim_amount"].get("confidence", 0.85),
                "india_reimbursement_total",
            )

        if "hospitalized_person_name" in ms:
            result.patient_name = ExtractedField(
                ms["hospitalized_person_name"]["value"],
                ms["hospitalized_person_name"].get("confidence", 0.84),
                "india_reimbursement_patient",
            )
        elif "primary_insured_name" in ms and not result.patient_name.value:
            result.patient_name = ExtractedField(
                ms["primary_insured_name"]["value"],
                ms["primary_insured_name"].get("confidence", 0.78),
                "india_reimbursement_insured",
            )

        if "irdai_policy_number" in ms and not result.policy_number.value:
            result.policy_number = ExtractedField(
                ms["irdai_policy_number"]["value"],
                ms["irdai_policy_number"].get("confidence", 0.86),
                "india_policy_number",
            )

        for key in ("tpa_id", "certificate_number", "irdai_policy_number"):
            if key in ms and not result.member_number.value:
                result.member_number = ExtractedField(
                    ms[key]["value"],
                    ms[key].get("confidence", 0.75),
                    f"india_{key}_member_fallback",
                )
                break

        if "hospital_name" in ms and (
            not result.provider_name.value or result.provider_name.value == "Unknown Provider"
        ):
            result.provider_name = ExtractedField(
                ms["hospital_name"]["value"],
                ms["hospital_name"].get("confidence", 0.85),
                "india_hospital_name",
            )

        if result.provider_code.value == "UNKNOWN" and "tpa_id" in ms:
            result.provider_code = ExtractedField(ms["tpa_id"]["value"], 0.45, "india_tpa_provider_placeholder")

        if not result.service_date.value and result.admission_date.value:
            result.service_date = ExtractedField(result.admission_date.value, 0.72, "india_admission_as_service")

        if result.claim_type.value == "OUTPATIENT" and (
            result.admission_date.value
            or "hospitalisation_due_to" in ms
            or "hospitalization expenses" in text.lower()
            or "hospitalisation expenses" in text.lower()
        ):
            result.claim_type = ExtractedField("INPATIENT", 0.86, "india_hospitalisation_inference")

        if not result.primary_diagnosis_desc.value and "hospitalisation_due_to" in ms:
            result.primary_diagnosis_desc = ExtractedField(
                ms["hospitalisation_due_to"]["value"],
                0.55,
                "india_hospitalisation_reason",
            )

        india_rows = self._extract_india_bill_rows(text, source)
        if india_rows and (
            not result.line_items
            or (
                len(result.line_items) == 1
                and str(result.line_items[0].get("procedure_code", "")).upper() == "GENERAL"
            )
        ):
            result.line_items = india_rows

    def _clean_india_reimbursement_value(self, value: Optional[str]) -> Optional[str]:
        """Remove India form guidance/checkbox placeholders from extracted values."""
        if not value:
            return None

        cleaned = re.sub(r"\s+", " ", value).strip(" :-.\t\r\n")
        if not cleaned:
            return None

        cleaned = self._strip_india_field_suffixes(cleaned)

        # Boxed OCR often renders values as "L M N 1 2 3 4"; keep the real token.
        tokens = cleaned.split()
        if len(tokens) >= 4 and all(len(t) == 1 and t.isalnum() for t in tokens):
            cleaned = "".join(tokens)
        elif len(tokens) >= 5:
            single_count = sum(1 for t in tokens if len(t) == 1 and t.isalpha())
            if single_count / len(tokens) >= 0.70:
                return None

        upper = cleaned.upper()
        lower = cleaned.lower()
        if upper in {"ABCDEFGHIJ", "XXXXXXXXXX", "XXXXXXXXXXXX", "XXXXXXXXXXXXXX"}:
            return None
        junk_exact = {
            "YES", "NO", "Y", "N", "D", "DD", "MM", "YYYY", "DDMMYYYY",
            "HH", "HHMM", "HOSPITALNAME", "FIRSTNAMEMIDDLENAME",
            "SURNAMEFIRSTNAMEMIDDLENAME", "OPEN TEXT", "STANDARD FORMAT",
            "NAME OF PATIENT IN FULL", "NAME OF HOSPITAL IN FULL",
            "OF PATIENT IN FULL", "OF HOSPITAL IN FULL",
        }
        if upper in junk_exact:
            return None

        junk_phrases = (
            "enter the", "as allotted", "tick the", "guidance for filling",
            "to be filled", "format of", "name of patient in full",
            "name of hospital in full", "standard format and open text",
            "of patient in full", "of hospital in full",
            "section ", "claim documents submitted", "please turn over",
        )
        if any(phrase in lower for phrase in junk_phrases):
            return None

        if re.fullmatch(r"[A-Z](?:\s+[A-Z]){1,}$", cleaned):
            return None
        if re.fullmatch(r"[SECT ION]+", upper) and len(upper) <= 12:
            return None

        return cleaned

    def _strip_india_field_suffixes(self, value: str) -> str:
        """Trim adjacent labels that pdfplumber places on the same India form row."""
        cleaned = re.sub(r"\s+", " ", value).strip(" :-.\t\r\n")
        suffix_markers = (
            " Room Category",
            " Gender ",
            " Age ",
            " Date of Birth",
            " Relationship ",
            " Occupation ",
            " Address ",
            " City ",
            " State ",
            " Phone ",
            " Email ",
            " T IO",
            " S E",
        )
        for marker in suffix_markers:
            idx = cleaned.lower().find(marker.lower())
            if idx > 0:
                cleaned = cleaned[:idx].strip(" :-.\t\r\n")
        return cleaned

    def _extract_india_bill_rows(self, text: str, source: str) -> list:
        """Extract bill rows from India reimbursement Section F tables."""
        items = []
        row_re = re.compile(
            r"^\s*(\d{1,2})\s+([A-Z0-9\-\/]+)\s+"
            r"(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+"
            r"(.+?)\s+"
            r"(Hospital\s+Main\s+Bill|Pharmacy\s+Bill|Pre[\-\s]*hospitali[sz]ation\s+Bills?|Post[\-\s]*hospitali[sz]ation\s+Bills?|Ambulance|Investigation|Lab|Labs|Other)\s+"
            r"(?:Rs\.?\s*)?([\d,]+(?:\.\d{2})?)\s*$",
            re.IGNORECASE | re.MULTILINE,
        )
        category_map = {
            "hospital main bill": "HOSPITALIZATION",
            "pharmacy bill": "PHARMACY",
            "pre-hospitalisation bills": "PRE_HOSPITALIZATION",
            "pre-hospitalization bills": "PRE_HOSPITALIZATION",
            "post-hospitalisation bills": "POST_HOSPITALIZATION",
            "post-hospitalization bills": "POST_HOSPITALIZATION",
            "ambulance": "AMBULANCE",
            "investigation": "DIAGNOSTIC",
            "lab": "DIAGNOSTIC",
            "labs": "DIAGNOSTIC",
        }
        for match in row_re.finditer(text):
            towards = re.sub(r"\s+", " ", match.group(5)).strip()
            issued_by = re.sub(r"\s+", " ", match.group(4)).strip()
            items.append({
                "line_number": int(match.group(1)),
                "procedure_code": match.group(2),
                "procedure_desc": f"{towards} - {issued_by}",
                "service_category": category_map.get(towards.lower(), "OTHER"),
                "billed_amount": match.group(6).replace(",", ""),
                "units": 1,
                "source": source,
            })
        if items:
            return self._dedupe_india_bill_rows(items)

        towards_patterns = [
            ("Hospital Main Bill", "HOSPITALIZATION"),
            ("Pharmacy Bill", "PHARMACY"),
            ("Pre-hospitalisation Bills", "PRE_HOSPITALIZATION"),
            ("Pre-hospitalization Bills", "PRE_HOSPITALIZATION"),
            ("Post-hospitalisation Bills", "POST_HOSPITALIZATION"),
            ("Post-hospitalization Bills", "POST_HOSPITALIZATION"),
        ]
        simple_row = re.compile(
            r"^\s*(\d{1,2})\s+([A-Z0-9\-\/]+)\s+"
            r"(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+(.+?)\s+"
            r"(?:Rs\.?\s*)?([\d,]+(?:\.\d{2})?)\s*$",
            re.IGNORECASE,
        )
        for line in text.splitlines():
            match = simple_row.match(line)
            if not match:
                continue
            body = re.sub(r"\s+", " ", match.group(4)).strip()
            towards = None
            category = "OTHER"
            for label, mapped in towards_patterns:
                if label.lower() in body.lower():
                    towards = label
                    category = mapped
                    break
            if not towards:
                continue
            issued_by = re.sub(re.escape(towards), "", body, flags=re.IGNORECASE).strip()
            items.append({
                "line_number": int(match.group(1)),
                "procedure_code": match.group(2),
                "procedure_desc": f"{towards} - {issued_by}",
                "service_category": category,
                "billed_amount": match.group(5).replace(",", ""),
                "units": 1,
                "source": source,
            })
        return self._dedupe_india_bill_rows(items)

    def _dedupe_india_bill_rows(self, items: list) -> list:
        deduped = []
        seen = set()
        for item in items:
            key = (
                item.get("line_number"),
                item.get("procedure_code"),
                item.get("procedure_desc"),
                str(item.get("billed_amount")),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    # ── Market Detection ──────────────────────────────────────────────────────

    def _detect_market_with_confidence(self, text_lower: str) -> tuple[str, float]:
        """
        Score each market region by counting strong and soft signal matches.
        Returns (market, confidence) where confidence is 0.0–1.0.
        """
        scores: dict[str, float] = {}

        for region, signals in MARKET_SIGNALS.items():
            score = 0.0
            for pattern in signals.get("strong", []):
                if re.search(pattern, text_lower, re.IGNORECASE):
                    score += 0.35
            for pattern in signals.get("soft", []):
                if re.search(pattern, text_lower, re.IGNORECASE):
                    score += 0.10
            scores[region] = min(score, 1.0)

        if not scores or max(scores.values()) == 0:
            return "UAE", 0.30  # default fallback with low confidence

        best_market = max(scores, key=lambda k: scores[k])
        best_score = scores[best_market]

        # Penalize if two regions score close to each other (ambiguous)
        sorted_scores = sorted(scores.values(), reverse=True)
        if len(sorted_scores) >= 2 and sorted_scores[0] - sorted_scores[1] < 0.15:
            best_score *= 0.80  # ambiguity penalty

        logger.debug("Market scores: %s → best=%s (%.2f)", scores, best_market, best_score)
        return best_market, round(min(best_score, 1.0), 3)

    def _detect_currency(self, text_lower: str, market: str) -> ExtractedField:
        """Detect currency from text or infer from market."""
        for pattern in PATTERNS_COMMON["currency"]:
            match = re.search(pattern, text_lower.upper(), re.IGNORECASE)
            if match:
                return ExtractedField(match.group(1).upper(), 0.95, "regex")
        inferred = CURRENCY_MAP.get(market, "AED")
        return ExtractedField(inferred, 0.70, "market_inference")

    def _detect_claim_type(self, text_lower: str) -> ExtractedField:
        """Infer claim type from document keywords.
        Priority: explicit 'Claim Type' label > keyword inference from full text.
        """
        # First: check for explicit "Claim Type" label (most reliable)
        _explicit = re.search(
            r"(?:Claim\s*Type|Type\s*of\s*Claim)[:\s]+"
            r"(INPATIENT|OUTPATIENT|DAYCARE|EMERGENCY|MATERNITY|DENTAL|OPTICAL|PHARMACY)",
            text_lower, re.IGNORECASE
        )
        if _explicit:
            ctype = _explicit.group(1).upper()
            return ExtractedField(ctype, 0.95, "explicit_label")

        # Fallback: keyword inference from full text
        for ctype, keywords in CLAIM_TYPE_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                return ExtractedField(ctype, 0.82, "keyword_inference")
        return ExtractedField("OUTPATIENT", 0.50, "default_fallback")

    # ── Market-Specific Extraction ────────────────────────────────────────────

    def _extract_gcc_fields(self, text: str, source: str) -> dict:
        """Extract GCC-specific fields: Emirates ID, DHA auth codes, co-pay, etc."""
        result = {}
        for field_name, patterns in PATTERNS_GCC.items():
            extracted = self._extract_field_from_patterns(patterns, text, source, base_confidence=0.85)
            if extracted.value:
                result[field_name] = {
                    "value": extracted.value,
                    "confidence": extracted.confidence,
                }
        return result

    def _extract_india_fields(self, text: str, source: str) -> dict:
        """Extract India-specific fields: Aadhaar, TPA ID, cashless auth, GIPSA package, etc."""
        result = {}
        for field_name, patterns in PATTERNS_INDIA.items():
            extracted = self._extract_field_from_patterns(patterns, text, source, base_confidence=0.85)
            if extracted.value:
                result[field_name] = {
                    "value": extracted.value,
                    "confidence": extracted.confidence,
                }
        return result

    # ── Generic Extractors ────────────────────────────────────────────────────

    def _extract_field_from_patterns(self, patterns: list, text: str, source: str,
                                      base_confidence: float = 0.80,
                                      page_texts: list = None) -> ExtractedField:
        """Extract a text field using a list of regex patterns."""
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
            if match:
                # Use group(1) when a capture group exists; fall back to the full match
                value = (match.group(1) if match.lastindex and match.lastindex >= 1
                         else match.group(0)).strip()
                if value and len(value) >= 2:
                    confidence = base_confidence if source == "pdfplumber" else base_confidence * 0.85
                    page_num = self._find_page_for_match(match.group(0), page_texts)
                    return ExtractedField(value, confidence, source, match.group(0), page_num)
        return ExtractedField(None, 0.0, source)

    def _find_page_for_match(self, raw_text: str, page_texts: list = None) -> int:
        """Find which page a matched text snippet appears on. Returns 1-based page or 0."""
        if not page_texts or not raw_text:
            return 0
        for pt in page_texts:
            if raw_text in pt.get("text", ""):
                return pt["page"]
        # Fallback: case-insensitive partial match
        raw_lower = raw_text.lower()
        for pt in page_texts:
            if raw_lower in pt.get("text", "").lower():
                return pt["page"]
        return 0

    def _extract_date_from_patterns(self, patterns: list, text: str, source: str) -> ExtractedField:
        """Extract and normalize a date field."""
        f = self._extract_field_from_patterns(patterns, text, source, base_confidence=0.88)
        if f.value:
            normalized = self._normalize_date(f.value)
            if normalized:
                f.value = normalized
            else:
                f.confidence *= 0.5
        return f

    def _extract_amount_from_patterns(self, patterns: list, text: str, source: str) -> ExtractedField:
        """Extract a monetary amount."""
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
            if match:
                raw = match.group(1).replace(",", "")
                try:
                    Decimal(raw)
                    return ExtractedField(raw, 0.87 if source == "pdfplumber" else 0.72, source, match.group(0))
                except Exception:
                    continue
        return ExtractedField(None, 0.0, source)

    def _extract_icd10(self, text: str, source: str) -> ExtractedField:
        """Extract primary ICD-10 diagnosis code."""
        for pattern in PATTERNS_COMMON["diagnosis_code"]:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                code = match.group(1).upper().strip()
                return ExtractedField(code, 0.92 if source == "pdfplumber" else 0.78, source, match.group(0))

        codes = ICD10_PATTERN.findall(text)
        icd_codes = [c for c in codes if c[0].isalpha()]
        if icd_codes:
            return ExtractedField(icd_codes[0], 0.65, "regex_fallback")

        return ExtractedField(None, 0.0, source)

    def _extract_line_items(self, text: str, source: str) -> list:
        """
        Extract itemized procedure/service lines from the document.
        Scopes extraction to the billing/services table section to avoid
        false CPT matches from form numbers, license codes, P.O. Boxes, etc.
        """
        items = []
        lines = text.split("\n")

        # ── Scope to billing section ───────────────────────────────────────────
        # Markers that signal the START of the billing table
        _TABLE_START = re.compile(
            r'(?:SERVICES?\s*(?:&|AND)\s*BILLED?\s*AMOUNTS?'
            r'|SERVICES?\s*RENDERED?'
            r'|PROCEDURE\s*(?:CODES?|DETAILS?)'
            r'|ITEMIZED?\s*BILL'
            r'|CPT\s*/\s*Code\s+Description)',
            re.IGNORECASE
        )
        # Markers that signal the END of the billing table
        _TABLE_END = re.compile(
            r'(?:TOTAL\s*BILLED?'
            r'|SECTION\s*\d'
            r'|REIMBURSEMENT\s*/\s*BANK'
            r'|SUPPORTING\s*DOCUMENTS?'
            r'|MEMBER\s*DECLARATION)',
            re.IGNORECASE
        )

        start_idx = 0
        end_idx = len(lines)
        for idx, line in enumerate(lines):
            if _TABLE_START.search(line):
                start_idx = idx + 1   # skip the header row itself
                break
        for idx, line in enumerate(lines[start_idx:], start=start_idx):
            if _TABLE_END.search(line):
                end_idx = idx
                break

        scoped_lines = lines[start_idx:end_idx]

        # ── Row-structure validation ───────────────────────────────────────────
        # A valid line-item row in a billing table starts with a row number:
        # "1 99213 Outpatient Consultation ..."
        # The row number must be <= 50 to avoid matching years, codes, etc.
        _ROW_LEADER = re.compile(r'^\s*(\d{1,2})\s+')

        for line in scoped_lines:
            line = line.strip()
            if not line:
                continue

            # Must look like a table data row (starts with small row number)
            if not _ROW_LEADER.match(line):
                continue

            cpt_match = CPT_PATTERN.search(line)
            if not cpt_match:
                continue

            cpt_code = cpt_match.group(1)
            # Standard CPT codes are 5 chars; allow alphanumeric codes >= 3 chars (e.g. PHARM-B)
            if len(cpt_code) < 3:
                continue

            # ── Amount: require decimal notation and take the LAST match ──────
            # Billing tables have "Qty Unit(AED) Total(AED)" — we want the last
            # monetary amount (Total column), not the row-number or quantity.
            _DECIMAL_AMT = re.compile(r'([\d,]+\.\d{2})')
            decimal_amounts = _DECIMAL_AMT.findall(line)
            if not decimal_amounts:
                continue
            amount_raw = decimal_amounts[-1].replace(",", "")

            try:
                amount = float(amount_raw)
                # Sanity: unit/line amount on a claim should be < 50,000
                if amount <= 0 or amount > 50_000:
                    continue
            except ValueError:
                continue

            category = SERVICE_CATEGORY_MAP.get(cpt_code, None)
            if category is None:
                # Prefix-based fallback for non-standard / non-numeric codes
                upper_code = cpt_code.upper()
                if upper_code.startswith("PHARM"):
                    category = "PHARMACY"
                elif upper_code.startswith("ROOM"):
                    category = "ROOM_RENT"
                elif upper_code.startswith("CONS"):
                    category = "CONSULTATION"
                else:
                    category = "OTHER"
            desc = line.replace(cpt_code, "").replace(amount_raw, "").strip()
            desc = re.sub(r'[^\w\s,\(\)\-]', '', desc).strip()

            items.append({
                "line_number": len(items) + 1,
                "procedure_code": cpt_code,
                "procedure_desc": desc[:200] if desc else None,
                "service_category": category,
                "billed_amount": amount,
                "units": 1,
                "confidence": 0.80 if source == "pdfplumber" else 0.65,
            })

        if not items and text:
            total_field = self._extract_amount_from_patterns(
                PATTERNS_COMMON["total_billed"], text, source)
            if total_field.value:
                items.append({
                    "line_number": 1,
                    "procedure_code": "GENERAL",
                    "procedure_desc": "Medical services (see attached itemized bill)",
                    "service_category": "OTHER",
                    "billed_amount": float(total_field.value),
                    "units": 1,
                    "confidence": 0.50,
                })

        return items

    # ── Utilities ─────────────────────────────────────────────────────────────

    def _normalize_date(self, raw: str) -> Optional[str]:
        """Normalize various date formats to YYYY-MM-DD.
        Handles:
          - dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
          - yyyy/mm/dd
          - dd Month yyyy  (e.g. "28 June 2025")
          - Month dd, yyyy (e.g. "June 28, 2025")
        """
        import re as _re
        from datetime import datetime as _dt

        raw = raw.strip()

        # ── Written-month formats ──────────────────────────────────────────────
        _MONTHS = (
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        )
        _MON_RE = "|".join(_MONTHS)

        # "28 June 2025" or "28 Jun 2025"
        m = _re.match(
            rf"(\d{{1,2}})\s+({_MON_RE}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{{4}})",
            raw, _re.IGNORECASE
        )
        if m:
            try:
                for fmt in ("%d %B %Y", "%d %b %Y"):
                    try:
                        parsed = _dt.strptime(f"{m.group(1)} {m.group(2).capitalize()} {m.group(3)}", fmt)
                        return parsed.strftime("%Y-%m-%d")
                    except ValueError:
                        continue
            except Exception:
                pass

        # "June 28, 2025" or "June 28 2025"
        m2 = _re.match(
            rf"({_MON_RE}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{{1,2}}),?\s+(\d{{4}})",
            raw, _re.IGNORECASE
        )
        if m2:
            try:
                for fmt in ("%B %d %Y", "%b %d %Y"):
                    try:
                        parsed = _dt.strptime(f"{m2.group(1).capitalize()} {m2.group(2)} {m2.group(3)}", fmt)
                        return parsed.strftime("%Y-%m-%d")
                    except ValueError:
                        continue
            except Exception:
                pass

        # ── Numeric formats ────────────────────────────────────────────────────
        raw_n = raw.replace(".", "/").replace("-", "/")
        parts = raw_n.split("/")
        if len(parts) != 3:
            return None
        try:
            d, m_n, y = parts
            d, m_n, y = int(d), int(m_n), int(y)
            if y < 100:
                y += 2000 if y < 50 else 1900
            # yyyy/mm/dd passed as d=yyyy, m=mm, y=dd
            if d > 31:
                d, y = y, d
            if m_n > 12 and d <= 12:
                d, m_n = m_n, d
            if not (1 <= m_n <= 12 and 1 <= d <= 31 and 1900 <= y <= 2100):
                return None
            return f"{y:04d}-{m_n:02d}-{d:02d}"
        except (ValueError, TypeError):
            return None

    def to_claim_dict(self, result: OCRResult) -> dict:
        """
        Convert OCRResult to a dict compatible with ClaimCreate schema.
        Includes market_specific fields and detection metadata.
        """
        def val(f: ExtractedField):
            return f.value if f else None

        def is_valid_provider_name(name: str) -> bool:
            """
            Validate extracted provider name to exclude declaration/signature text.
            Returns True if name looks like a real hospital/provider name.

            Relaxed validation - only reject obvious non-hospital text.
            """
            if not name or name == "Unknown Provider":
                return False

            name_lower = name.lower()
            name_stripped = name.strip()

            # Reject if contains declaration/signature keywords WITH context check
            # Only reject if declaration word appears at start of name or with strong indicators
            declaration_patterns = [
                r"^(?:i |we |the |undersigned|hereby|certify|declare|witness|attest|affirm)",
                r"(?:signature|signed\s+by|certified\s+by|statement\s+of)",
                r"(?:furnished|provided|submitted)\s+(?:by|to|for)",
            ]
            if any(re.search(pattern, name_lower) for pattern in declaration_patterns):
                logger.debug("[PROVIDER-VALIDATION] Rejected declaration text: %r", name)
                return False

            # Reject if too short (less than 3 chars) or too long (>120 chars)
            if len(name_stripped) < 3 or len(name_stripped) > 120:
                logger.debug("[PROVIDER-VALIDATION] Rejected length (%d chars): %r", len(name_stripped), name)
                return False

            # Reject if only numbers or special characters (no letters)
            if not re.search(r'[A-Za-z]', name):
                logger.debug("[PROVIDER-VALIDATION] Rejected (no letters): %r", name)
                return False

            # ── POSITIVE INDICATORS (strong signals this is a hospital/provider) ──

            # Accept if contains hospital/medical/healthcare keywords
            hospital_keywords = [
                "hospital", "hospitals", "medical", "clinic", "healthcare", "nursing",
                "apollo", "fortis", "max", "aiims", "manipal", "medanta", "columbia",
                "center", "centre", "institute", "pharmacy", "dispensary",
                "polyclinic", "diagnostic", "imaging", "laboratory", "lab",
                "nmc", "aster", "burjeel", "thumbay", "zulekha",  # GCC hospital chains
                "care", "lilavati", "breach candy", "jaslok",     # India hospitals
            ]
            if any(keyword in name_lower for keyword in hospital_keywords):
                logger.debug("[PROVIDER-VALIDATION] Accepted (hospital keyword): %r", name)
                return True

            # Accept if contains location indicators (hospitals often have location in name)
            location_keywords = [
                "road", "street", "avenue", "nagar", "colony", "area",
                "dubai", "abu dhabi", "sharjah", "ajman", "delhi", "mumbai",
                "bangalore", "chennai", "hyderabad", "pune",
            ]
            if any(keyword in name_lower for keyword in location_keywords):
                logger.debug("[PROVIDER-VALIDATION] Accepted (location indicator): %r", name)
                return True

            # Accept if has capitalized multi-word format typical of hospital names
            # "Al Zahra Hospital", "Mount Elizabeth Novena", "Kokilaben Dhirubhai Ambani Hospital"
            words = name.split()
            capitalized_words = [w for w in words if w and w[0].isupper()]

            # If 3+ capitalized words, likely a proper hospital name
            if len(capitalized_words) >= 3:
                logger.debug("[PROVIDER-VALIDATION] Accepted (3+ capitalized words): %r", name)
                return True

            # ── NEGATIVE INDICATORS (weak signals - only reject if combined) ──

            # Reject if only 1-2 words AND no hospital keywords AND no location
            if len(words) <= 2 and len(capitalized_words) < 2:
                logger.debug("[PROVIDER-VALIDATION] Rejected (too few words, no indicators): %r", name)
                return False

            # Default: Accept if passed all other checks
            # Better to accept borderline cases than reject valid hospitals
            logger.debug("[PROVIDER-VALIDATION] Accepted (default - passed checks): %r", name)
            return True

        claim = {
            "claim_type":              val(result.claim_type) or "OUTPATIENT",
            "market_region":           val(result.market_region) or "UAE",
            "currency":                val(result.currency) or "AED",
            "member_number":           val(result.member_number) or "UNKNOWN",
            "policy_number":           val(result.policy_number),
            "policy_name_hint":        val(result.policy_name),
            "patient_name":            val(result.patient_name) or "Unknown Patient",
            "patient_dob":             val(result.patient_dob) or "1990-01-01",
            "provider_code":           val(result.provider_code) or "UNKNOWN",
            "provider_name":           val(result.provider_name) or "Unknown Provider",
            "service_date":            val(result.service_date) or "2024-01-01",
            "primary_diagnosis_code":  val(result.primary_diagnosis_code) or "Z00.0",
            "primary_diagnosis_desc":  val(result.primary_diagnosis_desc),
            "total_billed":            val(result.total_billed),
            "source_channel":          "PDF_UPLOAD",
            "line_items": [
                {
                    "line_number":    li["line_number"],
                    "procedure_code": li["procedure_code"],
                    "procedure_desc": li.get("procedure_desc"),
                    "service_category": li.get("service_category", "OTHER"),
                    "billed_amount":  li["billed_amount"],
                    "units":          li.get("units", 1),
                }
                for li in result.line_items
            ],
            # OCR metadata
            "_ocr_confidence":               result.overall_confidence,
            "_ocr_engine":                   result.ocr_engine_used,
            "_ocr_document_hash":            result.document_hash,
            "_ocr_low_confidence_fields":    result.low_confidence_fields,
            "_ocr_market_detection_conf":    result.market_detection_confidence,
            "_ocr_market_requires_confirm":  result.market_requires_confirmation,
            "_ocr_market_specific":          result.market_specific,
            "_ocr_page_count":               result.page_count,
            # Promoted market-specific fields for display in OCR review step
            "insurer_name":                  (result.market_specific.get("insurer_name") or {}).get("value"),
            "group_sponsor":                 (result.market_specific.get("group_sponsor") or {}).get("value"),
            # Bank/payment account capture for the Account Module
            "bank_account_holder":            val(result.bank_account_holder),
            "bank_name":                      val(result.bank_name),
            "iban":                           val(result.iban),
            "swift_bic":                      val(result.swift_bic),
            "account_number":                 val(result.account_number),
            "ifsc_code":                      val(result.ifsc_code),
            "upi_vpa":                        val(result.upi_vpa),
            "sort_code":                      val(result.sort_code),
            "routing_number":                 val(result.routing_number),
            "account_ocr_confidence":         max([
                result.bank_account_holder.confidence,
                result.bank_name.confidence,
                result.iban.confidence,
                result.swift_bic.confidence,
                result.account_number.confidence,
                result.ifsc_code.confidence,
                result.upi_vpa.confidence,
                result.sort_code.confidence,
                result.routing_number.confidence,
            ] or [0.0]),
        }

        # Validate provider_name - reset to "Unknown Provider" if invalid
        if claim["provider_name"] and claim["provider_name"] != "Unknown Provider":
            if not is_valid_provider_name(claim["provider_name"]):
                claim["provider_name"] = "Unknown Provider"

        # Fallback: Use hospital_name from market_specific if provider_name is Unknown
        if claim["provider_name"] == "Unknown Provider":
            hospital_name = (result.market_specific.get("hospital_name") or {}).get("value")
            if hospital_name:
                logger.info("[OCR] Using hospital_name from market_specific as provider_name: %s", hospital_name)
                claim["provider_name"] = hospital_name

        if result.admission_date.value:
            claim["admission_date"] = result.admission_date.value
        if result.discharge_date.value:
            claim["discharge_date"] = result.discharge_date.value

        return claim


# Module-level singleton
_engine_instance: Optional[OCREngine] = None

def get_ocr_engine() -> OCREngine:
    """Return the module-level OCR engine singleton."""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = OCREngine()
    return _engine_instance
