"""
PDF Validator — Pre-OCR validation to reject invalid/irrelevant files.

Validation layers:
  1. File structure validation (PDF integrity, encryption check)
  2. Content validation (page count, text extraction minimum)
  3. Claim-specific validation (keywords, required fields detection)
  4. Quality checks (resolution for scanned PDFs, blank page detection)

Returns: ValidationResult with pass/fail + detailed error message
"""
import io
import logging
import re
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """Result of PDF validation with detailed error info."""
    is_valid: bool
    error_code: Optional[str] = None  # INVALID_PDF, NOT_A_CLAIM, TOO_LARGE, etc.
    error_message: Optional[str] = None
    suggested_action: Optional[str] = None
    detected_type: Optional[str] = None  # "claim", "invoice", "receipt", "unknown"
    page_count: int = 0
    text_length: int = 0
    confidence_score: float = 0.0


class PDFValidator:
    """Validates PDF files before OCR processing."""

    # Page limits
    MIN_PAGES = 1
    MAX_PAGES = 50  # Claims rarely exceed 50 pages

    # Text extraction minimums
    MIN_TEXT_LENGTH = 200  # At least 200 characters
    MIN_EXTRACTABLE_TEXT = 100  # Minimum from pdfplumber before Tesseract

    # Claim-specific keywords (must find at least N of these)
    CLAIM_KEYWORDS = {
        # Universal claim terms
        "claim", "patient", "member", "policy", "diagnosis", "treatment",
        "insured", "beneficiary", "coverage", "medical", "hospital", "provider",
        "physician", "doctor", "admission", "discharge", "procedure",

        # GCC-specific
        "emirates", "daman", "dha", "haad", "network", "copay", "co-pay",
        "tpa", "third party administrator", "pre-auth", "pre-authorization",

        # India-specific
        "aadhaar", "aadhar", "gipsa", "irda", "tpa", "cashless", "reimbursement",
        "ayush", "domiciliary", "room rent", "esi", "cghs",
    }

    # Non-claim document indicators (if these dominate, likely not a claim)
    INVOICE_KEYWORDS = {
        "invoice", "bill", "receipt", "purchase order", "quotation", "estimate",
        "tax invoice", "proforma", "credit note", "debit note", "payment due",
        "subtotal", "gst", "vat only", "terms and conditions of sale",
    }

    RECEIPT_KEYWORDS = {
        "paid", "payment received", "thank you for your payment", "receipt",
        "transaction id", "payment method", "cash", "credit card ending",
    }

    INDIA_REIMBURSEMENT_SECTIONS = {
        "reimbursement claim form",
        "details of primary insured",
        "details of insurance history",
        "details of insured person hospital",
        "details of hospitalization",
        "details of hospitalisation",
        "details of claim",
        "details of bills enclosed",
        "details of primary insured's bank account",
        "details of primary insured’s bank account",
        "declaration by the insured",
    }

    INDIA_REIMBURSEMENT_FIELDS = {
        "policy no", "certificate no", "company/tpa id", "company / tpa id",
        "tpa id", "sum insured", "mediclaim", "hospitalisation due",
        "hospitalization due", "date of admission", "date of discharge",
        "room category", "pre-hospitalisation", "pre-hospitalization",
        "post-hospitalisation", "post-hospitalization", "hospitalisation expenses",
        "hospitalization expenses", "total claim", "bill no", "ifsc code",
        "account number", "pan",
    }

    def __init__(self):
        self._pdfplumber_available = False
        self._pypdf_available = False

        try:
            import pdfplumber  # noqa
            self._pdfplumber_available = True
        except ImportError:
            logger.warning("pdfplumber not available for validation")

        try:
            import pypdf  # noqa
            self._pypdf_available = True
        except ImportError:
            logger.warning("pypdf not available for validation")

    def validate(
        self,
        pdf_bytes: bytes,
        filename: str = "claim.pdf",
        market_region: Optional[str] = None,
    ) -> ValidationResult:
        """
        Main validation entry point.

        Returns ValidationResult with is_valid=False if file should be rejected.
        """
        # Step 1: Basic structure validation
        result = self._validate_pdf_structure(pdf_bytes, filename)
        if not result.is_valid:
            return result

        # Step 2: Extract text for content analysis
        text, page_count = self._extract_text_quick(pdf_bytes)
        result.page_count = page_count
        result.text_length = len(text)

        # Step 3: Validate content length
        if len(text) < self.MIN_TEXT_LENGTH:
            return ValidationResult(
                is_valid=False,
                error_code="INSUFFICIENT_TEXT",
                error_message=f"Unable to extract sufficient text from PDF. Found {len(text)} characters, need at least {self.MIN_TEXT_LENGTH}.",
                suggested_action="Please ensure the document is: (1) Not a scanned image with poor quality, (2) Not encrypted/password-protected, (3) Contains readable text. Try re-scanning at higher quality (300+ DPI) or uploading a digital PDF.",
                page_count=page_count,
                text_length=len(text),
            )

        # Step 4: Detect document type and validate it's a claim
        india_doc_type, india_confidence = self._detect_india_reimbursement_claim(text)
        if (market_region or "").upper() == "INDIA" and india_doc_type:
            result.detected_type = india_doc_type
            result.confidence_score = india_confidence
            return ValidationResult(
                is_valid=True,
                detected_type=india_doc_type,
                page_count=page_count,
                text_length=len(text),
                confidence_score=india_confidence,
            )

        detected_type, confidence = self._detect_document_type(text)
        result.detected_type = detected_type
        result.confidence_score = confidence

        if detected_type != "claim":
            return ValidationResult(
                is_valid=False,
                error_code="NOT_A_CLAIM_DOCUMENT",
                error_message=f"This appears to be a '{detected_type}' document, not a medical claim form. Confidence: {confidence:.0%}.",
                suggested_action=self._get_rejection_guidance(detected_type),
                detected_type=detected_type,
                page_count=page_count,
                text_length=len(text),
                confidence_score=confidence,
            )

        if confidence < 0.50:  # Low confidence even for "claim" classification
            return ValidationResult(
                is_valid=False,
                error_code="AMBIGUOUS_DOCUMENT",
                error_message=f"Unable to confidently identify this as a medical claim form (confidence: {confidence:.0%}). The document may be missing required claim information.",
                suggested_action="Please ensure you're uploading: (1) A complete claim form, (2) Medical bills with patient and provider details, (3) Pre-authorization forms. Generic invoices or receipts cannot be processed.",
                detected_type=detected_type,
                page_count=page_count,
                text_length=len(text),
                confidence_score=confidence,
            )

        # Step 5: Validate page count
        if page_count > self.MAX_PAGES:
            return ValidationResult(
                is_valid=False,
                error_code="TOO_MANY_PAGES",
                error_message=f"Document has {page_count} pages (maximum {self.MAX_PAGES} allowed). This may not be a claim form.",
                suggested_action="Claims typically have 1-20 pages. If you're uploading multiple claims, please submit them separately. If this is a single claim with many attachments, consider submitting only the core claim form and medical bills.",
                page_count=page_count,
                text_length=len(text),
            )

        # All validations passed
        return ValidationResult(
            is_valid=True,
            detected_type=detected_type,
            page_count=page_count,
            text_length=len(text),
            confidence_score=confidence,
        )

    def _detect_india_reimbursement_claim(self, text: str) -> tuple[Optional[str], float]:
        """Detect Indian section-based reimbursement forms that do not look like UAE invoices."""
        text_lower = re.sub(r"\s+", " ", text.lower())
        section_matches = sum(1 for kw in self.INDIA_REIMBURSEMENT_SECTIONS if kw in text_lower)
        field_matches = sum(1 for kw in self.INDIA_REIMBURSEMENT_FIELDS if kw in text_lower)

        has_form_header = "reimbursement claim form" in text_lower or "claim form for health insurance" in text_lower
        has_insured_section = "details of primary insured" in text_lower
        has_hospital_section = (
            "details of hospitalization" in text_lower
            or "details of hospitalisation" in text_lower
            or "hospital name" in text_lower
        )
        has_claim_section = "details of claim" in text_lower or "total claim" in text_lower
        has_bank_section = "ifsc code" in text_lower or "account number" in text_lower

        required_groups = sum([has_form_header, has_insured_section, has_hospital_section, has_claim_section])
        if required_groups >= 3 and (section_matches >= 3 or field_matches >= 6):
            confidence = min(0.95, 0.55 + section_matches * 0.05 + field_matches * 0.02)
            if has_bank_section:
                confidence = min(0.98, confidence + 0.05)
            return "india_reimbursement_claim", confidence

        return None, 0.0

    def _validate_pdf_structure(self, pdf_bytes: bytes, filename: str) -> ValidationResult:
        """Validate PDF file structure and integrity."""
        if not self._pypdf_available:
            # Can't validate structure without pypdf, but allow to proceed
            return ValidationResult(is_valid=True)

        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))

            # Check if encrypted
            if reader.is_encrypted:
                return ValidationResult(
                    is_valid=False,
                    error_code="ENCRYPTED_PDF",
                    error_message="This PDF is password-protected or encrypted.",
                    suggested_action="Please upload an unencrypted version of the document. Remove password protection before uploading.",
                )

            # Check page count
            page_count = len(reader.pages)
            if page_count < self.MIN_PAGES:
                return ValidationResult(
                    is_valid=False,
                    error_code="EMPTY_PDF",
                    error_message="PDF has no pages.",
                    suggested_action="Please upload a valid claim document.",
                    page_count=0,
                )

            if page_count > self.MAX_PAGES:
                return ValidationResult(
                    is_valid=False,
                    error_code="TOO_MANY_PAGES",
                    error_message=f"PDF has {page_count} pages (maximum {self.MAX_PAGES} allowed).",
                    suggested_action="Claims typically have 1-20 pages. Please upload only the claim form and essential supporting documents.",
                    page_count=page_count,
                )

            # Validation passed
            return ValidationResult(is_valid=True, page_count=page_count)

        except pypdf.errors.PdfReadError as e:
            logger.error("PDF structure validation failed for %s: %s", filename, e)
            return ValidationResult(
                is_valid=False,
                error_code="CORRUPTED_PDF",
                error_message=f"Unable to read PDF file. The file may be corrupted or invalid. Error: {str(e)[:100]}",
                suggested_action="Please try: (1) Re-downloading the file, (2) Re-scanning the document, (3) Converting to PDF using a different tool, (4) Opening in Adobe Reader to verify it's valid.",
            )
        except Exception as e:
            logger.error("Unexpected error validating PDF structure for %s: %s", filename, e)
            # Don't block on unexpected errors, allow to proceed
            return ValidationResult(is_valid=True)

    def _extract_text_quick(self, pdf_bytes: bytes) -> tuple[str, int]:
        """Quick text extraction for validation (doesn't need perfect accuracy)."""
        if not self._pdfplumber_available:
            return "", 0

        try:
            import pdfplumber
            all_text = []
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                page_count = len(pdf.pages)
                # Only extract from first 10 pages for performance
                for page in pdf.pages[:10]:
                    text = page.extract_text()
                    if text:
                        all_text.append(text)
                return "\n".join(all_text), page_count
        except Exception as e:
            logger.warning("Quick text extraction failed: %s", e)
            return "", 0

    def _detect_document_type(self, text: str) -> tuple[str, float]:
        """
        Detect document type from extracted text.

        Returns: (type, confidence)
          type: "claim", "invoice", "receipt", "unknown"
          confidence: 0.0 - 1.0
        """
        text_lower = text.lower()

        # Count keyword matches
        claim_matches = sum(1 for kw in self.CLAIM_KEYWORDS if kw in text_lower)
        invoice_matches = sum(1 for kw in self.INVOICE_KEYWORDS if kw in text_lower)
        receipt_matches = sum(1 for kw in self.RECEIPT_KEYWORDS if kw in text_lower)

        total_keywords = len(self.CLAIM_KEYWORDS) + len(self.INVOICE_KEYWORDS) + len(self.RECEIPT_KEYWORDS)
        total_matches = claim_matches + invoice_matches + receipt_matches

        if total_matches == 0:
            return "unknown", 0.0

        # Calculate confidence scores
        claim_conf = claim_matches / len(self.CLAIM_KEYWORDS)
        invoice_conf = invoice_matches / len(self.INVOICE_KEYWORDS)
        receipt_conf = receipt_matches / len(self.RECEIPT_KEYWORDS)

        # Determine dominant type
        if claim_conf >= invoice_conf and claim_conf >= receipt_conf:
            # Additional checks for claim validation
            has_patient = any(kw in text_lower for kw in ["patient", "member", "insured", "beneficiary"])
            has_medical = any(kw in text_lower for kw in ["diagnosis", "treatment", "medical", "hospital", "doctor", "physician"])
            has_coverage = any(kw in text_lower for kw in ["policy", "coverage", "claim", "insurance"])

            # Require at least 2 of these 3 categories
            claim_indicators = sum([has_patient, has_medical, has_coverage])

            if claim_indicators >= 2:
                # Boost confidence if multiple required indicators present
                boosted_conf = min(1.0, claim_conf * (1 + claim_indicators * 0.15))
                return "claim", boosted_conf
            else:
                # Reduce confidence if missing required indicators
                return "claim", claim_conf * 0.6

        elif invoice_conf > claim_conf and invoice_conf >= receipt_conf:
            return "invoice", invoice_conf

        elif receipt_conf > claim_conf and receipt_conf > invoice_conf:
            return "receipt", receipt_conf

        else:
            return "unknown", 0.0

    def _get_rejection_guidance(self, detected_type: str) -> str:
        """Get user-friendly guidance based on detected document type."""
        guidance = {
            "invoice": (
                "This appears to be a general invoice or bill. To process a claim, please upload: "
                "(1) A completed claim form (if available from your insurer), OR "
                "(2) Medical bills that include patient name, policy number, diagnosis, and treatment details. "
                "Generic invoices without medical information cannot be processed."
            ),
            "receipt": (
                "This appears to be a payment receipt. To process a claim, please upload: "
                "(1) The original medical bill or invoice (not the payment receipt), OR "
                "(2) A completed claim reimbursement form. "
                "Payment receipts alone do not contain sufficient information for claim adjudication."
            ),
            "unknown": (
                "Unable to identify this as a medical claim document. Please ensure you're uploading: "
                "(1) A completed claim form from your insurance provider, OR "
                "(2) Medical bills with patient details, diagnosis, and treatment information, OR "
                "(3) Pre-authorization forms or discharge summaries. "
                "If you continue to have issues, contact your insurance provider for the correct claim form."
            ),
        }
        return guidance.get(detected_type, guidance["unknown"])
