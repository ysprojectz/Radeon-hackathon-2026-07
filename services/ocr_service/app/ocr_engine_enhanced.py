"""
OCR Engine — ENHANCED VERSION with Advanced Preprocessing & Quality Assessment

NEW FEATURES (v2026.03.13.5):
- ✅ Phase 1: Advanced 8-stage image preprocessing pipeline
- ✅ Phase 2: Pre-OCR quality assessment with early rejection
- ✅ Phase 3: Multi-pass OCR with adaptive PSM selection
- ✅ Phase 4: OCR confidence reporting and debugging tools

Processing pipeline:
  1. Detect document type (digital text PDF vs scanned/image PDF)
  2. Digital PDF  → pdfplumber (fast, accurate, preserves layout)
  3. Scanned PDF  → QUALITY CHECK → ADVANCED PREPROCESSING → MULTI-PASS OCR
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
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Optional, Tuple
from decimal import Decimal

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

OCR_CONFIDENCE_THRESHOLD = float(os.getenv("OCR_CONFIDENCE_THRESHOLD", "0.70"))

# NEW: OCR Enhancement Configuration
OCR_MIN_QUALITY_SCORE = int(os.getenv("OCR_MIN_QUALITY_SCORE", "40"))
OCR_ENHANCEMENT_THRESHOLD = int(os.getenv("OCR_ENHANCEMENT_THRESHOLD", "60"))
OCR_TARGET_DPI = int(os.getenv("OCR_TARGET_DPI", "300"))
OCR_ENABLE_MULTI_PASS = os.getenv("OCR_ENABLE_MULTI_PASS", "true").lower() == "true"
OCR_ENABLE_DESKEW = os.getenv("OCR_ENABLE_DESKEW", "true").lower() == "true"
OCR_ENABLE_QUALITY_CHECK = os.getenv("OCR_ENABLE_QUALITY_CHECK", "true").lower() == "true"

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

    # Market-specific fields
    market_specific: dict = field(default_factory=dict)

    # Metadata
    overall_confidence: float = 0.0
    market_detection_confidence: float = 0.0
    market_requires_confirmation: bool = False
    ocr_engine_used: str = "pdfplumber"
    document_hash: str = ""
    page_count: int = 0
    low_confidence_fields: list = field(default_factory=list)
    raw_text: str = ""

    # NEW: Enhanced metadata
    quality_metrics: dict = field(default_factory=dict)  # Image quality scores
    preprocessing_applied: list = field(default_factory=list)  # Which enhancements were used
    ocr_psm_mode: int = 6  # Best PSM mode selected
    ocr_processing_time: float = 0.0  # Seconds


# Import all the existing patterns and market signals from original file
# (PATTERNS_COMMON, PATTERNS_GCC, PATTERNS_INDIA, MARKET_SIGNALS, etc.)
# For brevity, I'm importing them - in production you'd copy them here

try:
    from services.ocr_service.app.ocr_engine import (
        OCREngine,
        MARKET_SIGNALS, GCC_REGIONS, CURRENCY_MAP,
        PATTERNS_COMMON, PATTERNS_GCC, PATTERNS_INDIA,
        CLAIM_TYPE_KEYWORDS, ICD10_PATTERN, CPT_PATTERN, AMOUNT_PATTERN,
        SERVICE_CATEGORY_MAP
    )
except ImportError:
    from ocr_engine import (
        OCREngine,
        MARKET_SIGNALS, GCC_REGIONS, CURRENCY_MAP,
        PATTERNS_COMMON, PATTERNS_GCC, PATTERNS_INDIA,
        CLAIM_TYPE_KEYWORDS, ICD10_PATTERN, CPT_PATTERN, AMOUNT_PATTERN,
        SERVICE_CATEGORY_MAP
    )


# ─────────────────────────────────────────────────────────────────────────────
# ENHANCED OCR ENGINE
# ─────────────────────────────────────────────────────────────────────────────

class OCREngineEnhanced(OCREngine):
    """
    Enhanced OCR Engine with advanced preprocessing and quality assessment.

    Inherits all field-extraction methods from OCREngine and adds:
    - Phase 1: 8-stage image preprocessing pipeline
    - Phase 2: Pre-OCR quality assessment
    - Phase 3: Multi-pass OCR with PSM selection
    - Phase 4: Detailed confidence reporting
    """

    def __init__(self):
        super().__init__()
        self._opencv_available = self._check_opencv()
        self._scipy_available = self._check_scipy()

        logger.info(
            "OCREngineEnhanced initialized | pdfplumber=%s | tesseract=%s | opencv=%s | scipy=%s",
            self._pdfplumber_available, self._tesseract_available,
            self._opencv_available, self._scipy_available
        )

    def _check_opencv(self) -> bool:
        try:
            import cv2  # noqa: F401
            return True
        except ImportError:
            logger.warning("opencv-python not installed — advanced preprocessing disabled")
            return False

    def _check_scipy(self) -> bool:
        try:
            import scipy  # noqa: F401
            return True
        except ImportError:
            logger.warning("scipy not installed — deskewing disabled")
            return False

    # ══════════════════════════════════════════════════════════════════════════
    # PHASE 1: ADVANCED IMAGE PREPROCESSING
    # ══════════════════════════════════════════════════════════════════════════

    def _advanced_preprocess_image(self, img) -> Tuple:
        """
        Advanced 8-stage preprocessing pipeline for scanned claim documents.

        Pipeline:
        1. Color space optimization (LAB → grayscale)
        2. Noise removal (bilateral filter)
        3. Deskewing (auto-rotation to horizontal)
        4. Adaptive binarization (OTSU + adaptive threshold)
        5. Morphological cleanup (remove small artifacts)
        6. Contrast enhancement (CLAHE)
        7. Sharpening (unsharp mask)
        8. Resolution upscaling (if < 300 DPI)

        Returns:
            (preprocessed_image, preprocessing_log)
        """
        from PIL import Image

        preprocessing_log = []

        # 1. Optimal grayscale conversion
        img, log_entry = self._optimal_grayscale_conversion(img)
        preprocessing_log.append(log_entry)

        # 2. Noise removal
        if self._opencv_available:
            img, log_entry = self._remove_noise(img)
            preprocessing_log.append(log_entry)

        # 3. Auto-deskew
        if OCR_ENABLE_DESKEW and self._opencv_available and self._scipy_available:
            img, log_entry = self._auto_deskew(img)
            preprocessing_log.append(log_entry)

        # 4. Adaptive binarization
        if self._opencv_available:
            img, log_entry = self._adaptive_binarize(img)
            preprocessing_log.append(log_entry)

        # 5. Morphological cleanup
        if self._opencv_available:
            img, log_entry = self._morphological_cleanup(img)
            preprocessing_log.append(log_entry)

        # 6. CLAHE (contrast enhancement)
        if self._opencv_available:
            img, log_entry = self._apply_clahe(img)
            preprocessing_log.append(log_entry)

        # 7. Unsharp mask (sharpening)
        img, log_entry = self._unsharp_mask(img)
        preprocessing_log.append(log_entry)

        # 8. DPI upscaling
        img, log_entry = self._upscale_to_target_dpi(img, OCR_TARGET_DPI)
        preprocessing_log.append(log_entry)

        logger.debug(f"[PREPROCESSING] Applied {len(preprocessing_log)} stages: {', '.join(preprocessing_log)}")

        return img, preprocessing_log

    def _optimal_grayscale_conversion(self, img) -> Tuple:
        """Convert to grayscale using LAB color space (better than RGB→L)."""
        from PIL import Image

        if img.mode == 'L':
            return img, "grayscale_skipped"

        if not self._opencv_available:
            # Fallback to basic conversion
            return img.convert('L'), "grayscale_basic"

        import cv2
        import numpy as np

        img_np = np.array(img)

        if img_np.ndim == 3:  # Color image
            # Convert RGB → LAB → extract L channel
            lab = cv2.cvtColor(img_np, cv2.COLOR_RGB2LAB)
            l_channel = lab[:, :, 0]
            return Image.fromarray(l_channel), "grayscale_lab"

        return img, "grayscale_unchanged"

    def _remove_noise(self, img) -> Tuple:
        """Remove noise while preserving edges using bilateral filter."""
        if not self._opencv_available:
            return img, "denoise_skipped"

        import cv2
        import numpy as np
        from PIL import Image

        img_np = np.array(img)

        # Bilateral filter: removes noise but keeps edges sharp
        denoised = cv2.bilateralFilter(img_np, d=9, sigmaColor=75, sigmaSpace=75)

        return Image.fromarray(denoised), "bilateral_denoise"

    def _auto_deskew(self, img) -> Tuple:
        """Automatically detect and correct skew angle using Hough transform."""
        if not (self._opencv_available and self._scipy_available):
            return img, "deskew_skipped"

        import cv2
        import numpy as np
        from scipy.ndimage import rotate
        from PIL import Image

        img_np = np.array(img)

        # Edge detection
        edges = cv2.Canny(img_np, 50, 150, apertureSize=3)

        # Hough transform to detect lines
        lines = cv2.HoughLines(edges, 1, np.pi / 180, 200)

        if lines is None:
            return img, "deskew_no_lines"

        # Calculate dominant angle
        angles = []
        for rho, theta in lines[:, 0]:
            angle = (theta * 180 / np.pi) - 90
            # Only consider angles close to horizontal (-10° to +10°)
            if -10 < angle < 10:
                angles.append(angle)

        if not angles:
            return img, "deskew_no_angle"

        # Median angle (more robust than mean)
        skew_angle = np.median(angles)

        # Rotate to correct skew
        if abs(skew_angle) > 0.5:  # Only rotate if skew > 0.5°
            img_rotated = rotate(img_np, skew_angle, reshape=False, mode='constant', cval=255)
            logger.debug(f"[DESKEW] Corrected {skew_angle:.2f}° rotation")
            return Image.fromarray(img_rotated.astype(np.uint8)), f"deskew_{skew_angle:.1f}deg"

        return img, "deskew_not_needed"

    def _adaptive_binarize(self, img) -> Tuple:
        """Convert to binary using adaptive thresholding."""
        if not self._opencv_available:
            return img, "binarize_skipped"

        import cv2
        import numpy as np
        from PIL import Image

        img_np = np.array(img)

        # OTSU thresholding (global)
        _, binary_otsu = cv2.threshold(img_np, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Adaptive thresholding (local)
        binary_adaptive = cv2.adaptiveThreshold(
            img_np, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
        )

        # Combine: use adaptive where OTSU fails
        combined = cv2.bitwise_and(binary_otsu, binary_adaptive)

        return Image.fromarray(combined), "adaptive_binarize"

    def _morphological_cleanup(self, img) -> Tuple:
        """Remove small artifacts using morphological operations."""
        if not self._opencv_available:
            return img, "morph_skipped"

        import cv2
        import numpy as np
        from PIL import Image

        img_np = np.array(img)

        # Remove small black noise (erosion → dilation)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        cleaned = cv2.morphologyEx(img_np, cv2.MORPH_OPEN, kernel)

        # Remove small white noise (dilation → erosion)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)

        return Image.fromarray(cleaned), "morph_cleanup"

    def _apply_clahe(self, img) -> Tuple:
        """Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)."""
        if not self._opencv_available:
            return img, "clahe_skipped"

        import cv2
        import numpy as np
        from PIL import Image

        img_np = np.array(img)

        # CLAHE
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(img_np)

        return Image.fromarray(enhanced), "clahe_enhanced"

    def _unsharp_mask(self, img, radius=2, amount=1.5) -> Tuple:
        """Apply unsharp mask for better text sharpness."""
        from PIL import ImageFilter, ImageChops, ImageEnhance

        try:
            # Gaussian blur
            blurred = img.filter(ImageFilter.GaussianBlur(radius=radius))

            # Unsharp mask: original + amount * (original - blurred)
            mask = ImageChops.difference(img, blurred)
            mask = ImageEnhance.Brightness(mask).enhance(amount)
            sharpened = ImageChops.add(img, mask)

            return sharpened, f"unsharp_mask_r{radius}"
        except Exception as e:
            logger.warning(f"[UNSHARP] Failed: {e}")
            return img, "unsharp_failed"

    def _upscale_to_target_dpi(self, img, target_dpi: int = 300) -> Tuple:
        """Upscale image to target DPI using Lanczos resampling."""
        from PIL import Image

        # Assume 72 DPI if unknown
        current_dpi = img.info.get('dpi', (72, 72))[0]

        if current_dpi < target_dpi:
            scale = target_dpi / current_dpi
            new_size = (int(img.width * scale), int(img.height * scale))
            upscaled = img.resize(new_size, Image.Resampling.LANCZOS)
            logger.debug(f"[UPSCALE] {current_dpi} DPI → {target_dpi} DPI (scale={scale:.2f}x)")
            return upscaled, f"upscale_{current_dpi}to{target_dpi}dpi"

        return img, "upscale_not_needed"

    # ══════════════════════════════════════════════════════════════════════════
    # PHASE 2: IMAGE QUALITY ASSESSMENT
    # ══════════════════════════════════════════════════════════════════════════

    def _assess_image_quality(self, img) -> dict:
        """
        Assess image quality before OCR to avoid processing garbage.

        Metrics:
        - Brightness (0-255)
        - Contrast (standard deviation)
        - Blur detection (Laplacian variance)
        - Resolution (DPI)
        - Text density (edge detection estimate)

        Returns quality report with recommended action: PROCEED | ENHANCE | REJECT
        """
        if not self._opencv_available:
            # Cannot assess without OpenCV
            return {
                "quality_score": 50,
                "overall_quality": "UNKNOWN",
                "recommended_action": "PROCEED",
                "issues": ["opencv_unavailable"],
            }

        import cv2
        import numpy as np

        img_np = np.array(img.convert('L'))  # Grayscale

        # 1. Brightness (mean pixel value)
        brightness = np.mean(img_np)

        # 2. Contrast (standard deviation)
        contrast = np.std(img_np)

        # 3. Blur detection (Laplacian variance)
        laplacian = cv2.Laplacian(img_np, cv2.CV_64F)
        blur_score = laplacian.var()

        # 4. DPI
        dpi = img.info.get('dpi', (72, 72))[0]

        # 5. Text density (estimate via edge detection)
        edges = cv2.Canny(img_np, 50, 150)
        text_density = np.sum(edges > 0) / edges.size

        # Quality scoring
        quality_score = 0
        issues = []

        # Brightness check (ideal: 180-220 for scanned docs)
        if 180 <= brightness <= 220:
            quality_score += 25
        elif 150 <= brightness <= 240:
            quality_score += 15
        else:
            issues.append(f"brightness={brightness:.0f} (too {'dark' if brightness < 150 else 'bright'})")

        # Contrast check (ideal: > 40)
        if contrast > 60:
            quality_score += 25
        elif contrast > 40:
            quality_score += 15
        else:
            issues.append(f"contrast={contrast:.0f} (too low)")

        # Blur check (ideal: > 100)
        if blur_score > 300:
            quality_score += 25
        elif blur_score > 100:
            quality_score += 15
        else:
            issues.append(f"blur_score={blur_score:.0f} (too blurry)")

        # DPI check (ideal: >= 300)
        if dpi >= 300:
            quality_score += 15
        elif dpi >= 150:
            quality_score += 10
        else:
            issues.append(f"dpi={dpi} (too low)")

        # Text density check (ideal: 0.1-0.4)
        if 0.1 <= text_density <= 0.4:
            quality_score += 10
        elif text_density > 0.05:
            quality_score += 5
        else:
            issues.append(f"text_density={text_density:.3f} (too sparse)")

        # Overall quality grade
        if quality_score >= 80:
            overall = "EXCELLENT"
            action = "PROCEED"
        elif quality_score >= 60:
            overall = "GOOD"
            action = "PROCEED"
        elif quality_score >= 40:
            overall = "FAIR"
            action = "ENHANCE"
        elif quality_score >= OCR_MIN_QUALITY_SCORE:
            overall = "POOR"
            action = "ENHANCE"
        else:
            overall = "UNREADABLE"
            action = "REJECT"

        return {
            "brightness": round(brightness, 1),
            "contrast": round(contrast, 1),
            "blur_score": round(blur_score, 1),
            "dpi": dpi,
            "text_density": round(text_density, 3),
            "quality_score": quality_score,
            "overall_quality": overall,
            "recommended_action": action,
            "issues": issues,
        }

    # ══════════════════════════════════════════════════════════════════════════
    # PHASE 3: MULTI-PASS OCR WITH ADAPTIVE PSM
    # ══════════════════════════════════════════════════════════════════════════

    def _multi_pass_tesseract_ocr(self, img) -> Tuple[str, dict]:
        """
        Run multiple OCR passes with different PSM modes, select best result.

        PSM Modes:
        - 3: Fully automatic page segmentation
        - 6: Uniform block of text (default)
        - 4: Single column of text
        - 11: Sparse text

        Returns:
            (best_text, metadata)
        """
        if not OCR_ENABLE_MULTI_PASS or not self._tesseract_available:
            # Fallback to single-pass
            return self._single_pass_tesseract_ocr(img, psm=6)

        import pytesseract

        # PSM modes to try (in order)
        psm_modes = [
            (3, "Fully automatic"),
            (6, "Uniform block"),
            (4, "Single column"),
            (11, "Sparse text"),
        ]

        results = []

        for psm, description in psm_modes:
            config = f"--psm {psm} --oem 3"

            try:
                # Get detailed OCR data (includes confidence per word)
                data = pytesseract.image_to_data(img, config=config, output_type=pytesseract.Output.DICT)

                # Calculate average confidence
                confidences = [int(c) for c in data['conf'] if c != '-1']
                avg_confidence = sum(confidences) / len(confidences) if confidences else 0

                # Get text
                text = pytesseract.image_to_string(img, config=config)

                results.append({
                    "psm": psm,
                    "description": description,
                    "text": text,
                    "confidence": avg_confidence,
                    "char_count": len(text),
                })

                logger.debug(f"[OCR-PSM-{psm}] {description}: {len(text)} chars, conf={avg_confidence:.1f}%")

            except Exception as e:
                logger.warning(f"[OCR-PSM-{psm}] Failed: {e}")
                continue

        if not results:
            logger.error("[OCR] All PSM modes failed")
            return "", {"error": "all_psm_failed"}

        # Select best result (highest confidence)
        best = max(results, key=lambda r: r['confidence'])

        logger.info(f"[OCR-BEST] PSM {best['psm']} ({best['description']}) selected: conf={best['confidence']:.1f}%")

        return best['text'], {
            "best_psm": best['psm'],
            "confidence": best['confidence'],
            "all_results": results,
        }

    def _single_pass_tesseract_ocr(self, img, psm=6) -> Tuple[str, dict]:
        """Single-pass Tesseract OCR (fallback)."""
        import pytesseract

        config = f"--psm {psm} --oem 3"

        try:
            text = pytesseract.image_to_string(img, config=config)

            # Try to get confidence
            try:
                data = pytesseract.image_to_data(img, config=config, output_type=pytesseract.Output.DICT)
                confidences = [int(c) for c in data['conf'] if c != '-1']
                avg_confidence = sum(confidences) / len(confidences) if confidences else 0
            except:
                avg_confidence = 0

            return text, {
                "best_psm": psm,
                "confidence": avg_confidence,
            }
        except Exception as e:
            logger.error(f"[OCR] Tesseract failed: {e}")
            return "", {"error": str(e)}

    # ══════════════════════════════════════════════════════════════════════════
    # ENHANCED TEXT EXTRACTION
    # ══════════════════════════════════════════════════════════════════════════

    def _extract_text_tesseract_enhanced(self, pdf_bytes: bytes) -> Tuple[str, int, dict]:
        """
        Enhanced Tesseract extraction with quality checks and preprocessing.

        Returns:
            (text, page_count, metadata)
        """
        import time
        start_time = time.time()

        try:
            from PIL import Image
            import pytesseract
        except ImportError as e:
            logger.error("Tesseract deps not available: %s", e)
            return "", 0, {"error": "dependencies_missing"}

        all_text = []
        page_count = 0
        quality_reports = []
        preprocessing_logs = []

        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
            page_count = len(reader.pages)

            for page_num in range(min(page_count, 10)):
                page = reader.pages[page_num]
                for img_obj in page.images:
                    img = Image.open(io.BytesIO(img_obj.data))

                    # PHASE 2: Quality assessment
                    if OCR_ENABLE_QUALITY_CHECK:
                        quality = self._assess_image_quality(img)
                        quality_reports.append(quality)

                        logger.info(
                            f"[OCR-QUALITY] Page {page_num+1}: {quality['overall_quality']} "
                            f"(score={quality['quality_score']}) - {quality['recommended_action']}"
                        )

                        if quality['recommended_action'] == 'REJECT':
                            logger.warning(f"[OCR-REJECT] Page {page_num+1} quality too low: {quality['issues']}")
                            continue  # Skip this image
                    else:
                        quality = {"recommended_action": "ENHANCE"}

                    # PHASE 1: Preprocessing (adaptive based on quality)
                    if quality['recommended_action'] == 'ENHANCE' or quality.get('quality_score', 50) < OCR_ENHANCEMENT_THRESHOLD:
                        logger.info(f"[OCR-ENHANCE] Applying advanced preprocessing...")
                        img, preprocess_log = self._advanced_preprocess_image(img)
                        preprocessing_logs.extend(preprocess_log)
                    else:
                        # Basic preprocessing for good quality images
                        img = img.convert("L")
                        from PIL import ImageEnhance, ImageFilter
                        enhancer = ImageEnhance.Contrast(img)
                        img = enhancer.enhance(1.5)
                        img = img.filter(ImageFilter.SHARPEN)
                        preprocessing_logs.append("basic_preprocessing")

                    # PHASE 3: Multi-pass OCR
                    text, ocr_meta = self._multi_pass_tesseract_ocr(img)

                    if text:
                        all_text.append(text)

        except Exception as e:
            logger.warning("PDF-to-image conversion failed: %s", e)
            try:
                from PIL import Image
                img = Image.open(io.BytesIO(pdf_bytes))

                quality = self._assess_image_quality(img) if OCR_ENABLE_QUALITY_CHECK else {"recommended_action": "ENHANCE"}

                if quality['recommended_action'] != 'REJECT':
                    img, preprocess_log = self._advanced_preprocess_image(img)
                    text, ocr_meta = self._multi_pass_tesseract_ocr(img)
                    if text:
                        all_text.append(text)
                page_count = 1
            except Exception as e2:
                logger.error("Direct image OCR failed: %s", e2)

        processing_time = time.time() - start_time

        metadata = {
            "quality_reports": quality_reports,
            "preprocessing_applied": list(set(preprocessing_logs)),
            "processing_time": round(processing_time, 2),
        }

        return "\n".join(all_text), page_count, metadata

    # ══════════════════════════════════════════════════════════════════════════
    # PHASE 4: OCR CONFIDENCE REPORTING
    # ══════════════════════════════════════════════════════════════════════════

    def generate_ocr_confidence_report(self, result: OCRResult) -> dict:
        """
        Generate detailed OCR confidence report for debugging.

        Returns visualization-ready data for UI display.
        """
        report = {
            "overall_confidence": round(result.overall_confidence, 2),
            "ocr_engine": result.ocr_engine_used,
            "page_count": result.page_count,
            "processing_time": round(result.ocr_processing_time, 2),
            "quality_metrics": result.quality_metrics,
            "preprocessing_applied": result.preprocessing_applied,
            "psm_mode": result.ocr_psm_mode,
            "field_confidence_breakdown": [],
            "low_confidence_alerts": [],
        }

        # Field-by-field confidence
        fields = [
            ("Claim Type", result.claim_type),
            ("Market Region", result.market_region),
            ("Member Number", result.member_number),
            ("Patient Name", result.patient_name),
            ("Patient DOB", result.patient_dob),
            ("Provider Name", result.provider_name),
            ("Service Date", result.service_date),
            ("Diagnosis Code", result.primary_diagnosis_code),
            ("Total Billed", result.total_billed),
        ]

        for field_name, field_obj in fields:
            conf = field_obj.confidence
            status = "EXCELLENT" if conf >= 0.9 else "GOOD" if conf >= 0.75 else "FAIR" if conf >= 0.6 else "POOR"

            report["field_confidence_breakdown"].append({
                "field": field_name,
                "value": field_obj.value,
                "confidence": round(conf, 2),
                "source": field_obj.source,
                "status": status,
            })

            if conf < OCR_CONFIDENCE_THRESHOLD:
                report["low_confidence_alerts"].append({
                    "field": field_name,
                    "confidence": round(conf, 2),
                    "recommendation": "Human review recommended",
                })

        return report

    # ══════════════════════════════════════════════════════════════════════════
    # PUBLIC API (keeping same interface as original)
    # ══════════════════════════════════════════════════════════════════════════

    def extract_from_bytes(self, pdf_bytes: bytes, filename: str = "claim.pdf") -> OCRResult:
        """
        Main entry point. Extract structured claim data from raw PDF bytes.

        ENHANCED with quality checks, advanced preprocessing, and multi-pass OCR.
        """
        import time
        start_time = time.time()

        result = OCRResult()
        result.document_hash = hashlib.sha256(pdf_bytes).hexdigest()

        # Step 1: Try pdfplumber (digital PDF)
        if self._pdfplumber_available:
            text, page_count, page_texts = self._extract_text_pdfplumber(pdf_bytes)
            result.page_count = page_count
            result.page_texts = page_texts
            if text and len(text.strip()) > 100:
                result.raw_text = text
                result.ocr_engine_used = "pdfplumber"
                result.ocr_processing_time = time.time() - start_time
                logger.info("OCR: pdfplumber extracted %d chars from %s", len(text), filename)
                return self._parse_text_to_fields(result, text, source="pdfplumber")

        # Step 2: Fallback to ENHANCED Tesseract (scanned/image PDF)
        if self._tesseract_available:
            text, page_count, metadata = self._extract_text_tesseract_enhanced(pdf_bytes)
            result.page_count = page_count
            result.quality_metrics = metadata.get("quality_reports", [])
            result.preprocessing_applied = metadata.get("preprocessing_applied", [])
            result.ocr_processing_time = metadata.get("processing_time", 0)

            if text:
                result.raw_text = text
                result.ocr_engine_used = "tesseract_enhanced"
                logger.info("OCR: tesseract_enhanced extracted %d chars from %s (%.2fs)",
                           len(text), filename, result.ocr_processing_time)
                return self._parse_text_to_fields(result, text, source="tesseract")

        # Step 3: No OCR available
        logger.error("OCR: no extraction engine available for %s", filename)
        result.ocr_engine_used = "none"
        result.overall_confidence = 0.0
        result.ocr_processing_time = time.time() - start_time
        return result

    def extract_from_path(self, file_path: str) -> OCRResult:
        """Extract from a file path."""
        with open(file_path, "rb") as f:
            return self.extract_from_bytes(f.read(), os.path.basename(file_path))

    # All remaining methods (_parse_text_to_fields, _detect_market_with_confidence,
    # _extract_gcc_fields, _extract_india_fields, etc.) are inherited from OCREngine.


# Module-level singleton
_enhanced_engine_instance: Optional[OCREngineEnhanced] = None

def get_ocr_engine_enhanced() -> OCREngineEnhanced:
    """Return the module-level enhanced OCR engine singleton."""
    global _enhanced_engine_instance
    if _enhanced_engine_instance is None:
        _enhanced_engine_instance = OCREngineEnhanced()
    return _enhanced_engine_instance
