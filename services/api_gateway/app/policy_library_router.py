"""
Policy Library Router
=====================
Admin-only endpoints for managing the policy document library.

Endpoints:
  GET    /api/v1/admin/policy-library               — list policies (filterable)
  POST   /api/v1/admin/policy-library/upload        — upload PDF, extract clauses, store
  POST   /api/v1/admin/policy-library/index-json    — index pre-structured JSON clauses (no PDF)
  GET    /api/v1/admin/policy-library/{policy_id}   — get full policy + clauses
  DELETE /api/v1/admin/policy-library/{policy_id}   — remove policy from library
"""
from __future__ import annotations

import hashlib
import logging
import time as _time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import io

from services.api_gateway.app.auth import require_roles, CurrentUser
from services.api_gateway.app import policy_library_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin/policy-library", tags=["Policy Library"])
_admin_only = require_roles("ADMIN")

MAX_PDF_BYTES = 30 * 1024 * 1024  # 30 MB


# ── Response schemas ────────────────────────────────────────────────────────────

class PolicyLibraryUploadResponse(BaseModel):
    policy_id:          str
    policy_name:        str
    market:             str
    policy_type:        str
    insurer_name:       str
    effective_date:     str
    version:            str
    clauses_extracted:  int
    page_count:         int
    document_hash:      str
    ocr_engine_used:    str
    llm_model_used:     str
    llm_available:      bool
    processing_time_ms: int
    warnings:           list[str]


class MetadataField(BaseModel):
    value:      Optional[str] = None
    confidence: float         = 0.0   # 0.0 – 1.0
    source:     str           = "missing"  # "extracted" | "inferred" | "missing"


class PolicyMetadataResponse(BaseModel):
    is_insurance_document:  bool
    document_confidence:    float
    insurer_name:           MetadataField
    policy_name:            MetadataField
    effective_date:         MetadataField  # YYYY-MM-DD
    version:                MetadataField
    market:                 MetadataField  # one of VALID_MARKETS
    policy_type:            MetadataField  # NATIONAL | COMPANY
    missing_fields:         list[str]
    warnings:               list[str]
    page_count:             int


class IndexPolicyRequest(BaseModel):
    """Request body for the /index-json endpoint — no PDF required."""
    market:         str
    policy_type:    str
    insurer_name:   str
    policy_name:    str
    effective_date: str
    version:        str       = "1.0"
    clauses:        list[dict]


# LLM prompt for metadata-only extraction (much lighter than clause extraction)
_METADATA_SYSTEM_PROMPT = """You are an expert insurance document analyst.
Extract metadata from the insurance policy document text provided.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "is_insurance_document": true,
  "document_confidence": 0.95,
  "insurer_name":   {"value": "Daman National Health Insurance", "confidence": 0.95, "source": "extracted"},
  "policy_name":    {"value": "Enhanced Gold Health Insurance Plan 2024", "confidence": 0.90, "source": "extracted"},
  "effective_date": {"value": "2024-01-01", "confidence": 0.85, "source": "extracted"},
  "version":        {"value": "2.1", "confidence": 0.70, "source": "inferred"},
  "market":         {"value": "UAE", "confidence": 0.95, "source": "extracted"},
  "policy_type":    {"value": "COMPANY", "confidence": 0.90, "source": "extracted"},
  "missing_fields": []
}

FIELD RULES:
- insurer_name: The insurance company, regulatory authority, or issuing body name
- policy_name: The full official title/name of this policy document
- effective_date: Effective/commencement date in YYYY-MM-DD format (e.g. 2024-01-01)
- version: Version, edition, or amendment number (default "1.0" if not stated, source="inferred")
- market: ONE of [UAE, KSA, BAHRAIN, OMAN, QATAR, KUWAIT, INDIA] — infer from currency/regulator/address
- policy_type: "NATIONAL" if a government/regulatory mandate (IRDAI, DHA, MOH, etc.), "COMPANY" if insurer-specific
- is_insurance_document: false if this is clearly NOT an insurance/health policy document
- document_confidence: 0.0-1.0 — confidence the document is genuinely an insurance policy

For any field you cannot find: value=null, confidence=0.0, source="missing", add name to missing_fields.
For fields you infer from context: source="inferred", confidence ≤ 0.75.
"""


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_ocr_engine():
    """Lazy import — OCR engine is optional."""
    try:
        from services.ocr_service.app.ocr_engine import get_ocr_engine
        return get_ocr_engine()
    except Exception as e:
        logger.debug("OCR engine not available: %s", e)
        return None


def _get_extractor():
    """Lazy import — LLM extractor is optional."""
    try:
        from shared.policy_doc_extractor import get_policy_doc_extractor
        return get_policy_doc_extractor()
    except Exception as e:
        logger.debug("Policy doc extractor not available: %s", e)
        return None


# ════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════

@router.post(
    "/extract-metadata",
    response_model=PolicyMetadataResponse,
    summary="Extract policy metadata from a PDF for form pre-fill",
    dependencies=[Depends(_admin_only)],
)
async def extract_policy_metadata(
    file: UploadFile = File(..., description="Policy PDF to analyse (max 30 MB)"),
):
    """
    Lightweight endpoint: OCR the PDF, then use LLM to extract policy metadata
    (insurer name, policy name, effective date, market, type, version) with
    per-field confidence scores.

    Returns pre-fill data for the upload form. Fields the LLM cannot determine
    are returned with value=null so the UI can prompt the user for manual input.
    """
    import json as _json

    warnings: list[str] = []

    # ── Validate file ──
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(pdf_bytes) // (1024*1024)} MB). Maximum 30 MB.",
        )

    # ── OCR ──
    ocr_engine = _get_ocr_engine()
    if ocr_engine is None:
        raise HTTPException(
            status_code=503,
            detail="OCR service unavailable — cannot extract metadata.",
        )

    try:
        ocr_result = ocr_engine.extract_from_bytes(pdf_bytes, filename=file.filename)
        raw_text   = ocr_result.raw_text or ""
        page_count = getattr(ocr_result, "page_count", 1) or 1
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"OCR extraction failed: {exc}")

    if not raw_text.strip():
        # Return a "not a policy doc" response when OCR yields nothing
        _empty = MetadataField(value=None, confidence=0.0, source="missing")
        return PolicyMetadataResponse(
            is_insurance_document=False,
            document_confidence=0.0,
            insurer_name=_empty,
            policy_name=_empty,
            effective_date=_empty,
            version=_empty,
            market=_empty,
            policy_type=_empty,
            missing_fields=["insurer_name", "policy_name", "effective_date", "version", "market", "policy_type"],
            warnings=["OCR returned no text — the PDF may be image-only or corrupted. Try a text-based PDF."],
            page_count=page_count,
        )

    # ── LLM metadata extraction ──
    # Truncate to first 6000 chars — metadata is near the start of the document
    text_snippet = raw_text[:6000]

    extractor = _get_extractor()
    if extractor is None or not extractor.is_available:
        warnings.append("LLM not configured — metadata could not be extracted automatically.")
        _empty = MetadataField(value=None, confidence=0.0, source="missing")
        return PolicyMetadataResponse(
            is_insurance_document=True,  # assume true if OCR worked
            document_confidence=0.5,
            insurer_name=_empty,
            policy_name=_empty,
            effective_date=_empty,
            version=MetadataField(value="1.0", confidence=0.5, source="inferred"),
            market=_empty,
            policy_type=MetadataField(value="COMPANY", confidence=0.5, source="inferred"),
            missing_fields=["insurer_name", "policy_name", "effective_date", "market"],
            warnings=warnings,
            page_count=page_count,
        )

    # Call the LLM with the metadata prompt
    raw_llm = ""
    try:
        if extractor._provider == "groq":
            resp = extractor._client.chat.completions.create(
                model=extractor._model,
                temperature=0,
                max_tokens=800,
                messages=[
                    {"role": "system", "content": _METADATA_SYSTEM_PROMPT},
                    {"role": "user",   "content": f"DOCUMENT TEXT:\n{text_snippet}"},
                ],
            )
            raw_llm = resp.choices[0].message.content or ""
        elif extractor._provider == "anthropic":
            resp = extractor._client.messages.create(
                model=extractor._model,
                max_tokens=800,
                system=_METADATA_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": f"DOCUMENT TEXT:\n{text_snippet}"}],
            )
            raw_llm = resp.content[0].text if resp.content else ""
    except Exception as exc:
        logger.error("Metadata LLM call failed: %s", exc)
        warnings.append(f"LLM extraction failed: {exc}. Fill fields manually.")
        _empty = MetadataField(value=None, confidence=0.0, source="missing")
        return PolicyMetadataResponse(
            is_insurance_document=True,
            document_confidence=0.5,
            insurer_name=_empty,
            policy_name=_empty,
            effective_date=_empty,
            version=MetadataField(value="1.0", confidence=0.5, source="inferred"),
            market=_empty,
            policy_type=MetadataField(value="COMPANY", confidence=0.5, source="inferred"),
            missing_fields=["insurer_name", "policy_name", "effective_date", "market"],
            warnings=warnings,
            page_count=page_count,
        )

    # ── Parse LLM response ──
    # Strip markdown fences if present
    clean = raw_llm.strip()
    if clean.startswith("```"):
        clean = clean.split("```")[1]
        if clean.startswith("json"):
            clean = clean[4:]
    clean = clean.strip()

    # Find JSON object boundaries
    start = clean.find("{")
    end   = clean.rfind("}") + 1
    if start >= 0 and end > start:
        clean = clean[start:end]

    try:
        data = _json.loads(clean)
    except Exception as exc:
        logger.error("Failed to parse metadata JSON from LLM: %s | raw=%r", exc, raw_llm[:300])
        warnings.append("LLM returned unparseable response — fill fields manually.")
        _empty = MetadataField(value=None, confidence=0.0, source="missing")
        return PolicyMetadataResponse(
            is_insurance_document=True,
            document_confidence=0.5,
            insurer_name=_empty,
            policy_name=_empty,
            effective_date=_empty,
            version=MetadataField(value="1.0", confidence=0.5, source="inferred"),
            market=_empty,
            policy_type=MetadataField(value="COMPANY", confidence=0.5, source="inferred"),
            missing_fields=["insurer_name", "policy_name", "effective_date", "market"],
            warnings=warnings,
            page_count=page_count,
        )

    def _field(key: str) -> MetadataField:
        raw = data.get(key, {})
        if not isinstance(raw, dict):
            return MetadataField(value=None, confidence=0.0, source="missing")
        val = raw.get("value")
        if val is not None:
            val = str(val).strip() or None
        return MetadataField(
            value=val,
            confidence=float(raw.get("confidence", 0.0)),
            source=str(raw.get("source", "missing")),
        )

    # Validate market against known list
    market_field = _field("market")
    if market_field.value and market_field.value.upper() not in policy_library_store.VALID_MARKETS:
        market_field = MetadataField(value=None, confidence=0.0, source="missing")

    # Validate policy_type
    type_field = _field("policy_type")
    if type_field.value and type_field.value.upper() not in {"NATIONAL", "COMPANY"}:
        type_field = MetadataField(value=None, confidence=0.0, source="missing")
    elif type_field.value:
        type_field = MetadataField(
            value=type_field.value.upper(),
            confidence=type_field.confidence,
            source=type_field.source,
        )

    missing = [str(f) for f in data.get("missing_fields", [])]

    return PolicyMetadataResponse(
        is_insurance_document=bool(data.get("is_insurance_document", True)),
        document_confidence=float(data.get("document_confidence", 0.5)),
        insurer_name=_field("insurer_name"),
        policy_name=_field("policy_name"),
        effective_date=_field("effective_date"),
        version=_field("version"),
        market=market_field,
        policy_type=type_field,
        missing_fields=missing,
        warnings=warnings,
        page_count=page_count,
    )


@router.get(
    "",
    summary="List policy library entries",
    dependencies=[Depends(_admin_only)],
)
def list_policy_library(
    market:      Optional[str] = None,
    policy_type: Optional[str] = None,
    insurer:     Optional[str] = None,
):
    """
    Return all entries in the policy library index.

    Optional filters:
    - `market`      — e.g. UAE, INDIA, KSA
    - `policy_type` — NATIONAL or COMPANY
    - `insurer`     — partial name match on insurer_name
    """
    return policy_library_store.list_policies(
        market=market,
        policy_type=policy_type,
        insurer=insurer,
    )


@router.post(
    "/upload",
    response_model=PolicyLibraryUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a policy PDF and extract clauses",
)
async def upload_policy_library_document(
    current_user: CurrentUser = Depends(_admin_only),
    file:           UploadFile = File(..., description="Policy document PDF (max 30 MB)"),
    market:         str        = Form(..., description="Market code: UAE / INDIA / KSA / etc."),
    policy_type:    str        = Form(..., description="NATIONAL or COMPANY"),
    insurer_name:   str        = Form(..., description="Regulatory body or insurer name"),
    policy_name:    str        = Form(..., description="Human-readable policy name"),
    effective_date: str        = Form(..., description="Effective date (ISO date, e.g. 2024-01-01)"),
    version:        str        = Form("1.0", description="Version string"),
):
    """
    Upload an insurance policy PDF to the library.

    Workflow:
    1. Validate form fields and file
    2. OCR-extract full text from the PDF
    3. Use LLM (Groq / Claude) to extract up to 40 structured clauses
    4. Store in the policy library (JSON files at POLICY_LIBRARY_PATH)
    5. Return summary of extracted clauses

    Graceful degradation:
    - OCR unavailable → raises 503
    - LLM unavailable → stores with 0 clauses + warning
    """
    t_start = _time.time()
    warnings: list[str] = []

    # ── Validate market / type ──
    market_up      = market.upper().strip()
    policy_type_up = policy_type.upper().strip()

    if market_up not in policy_library_store.VALID_MARKETS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid market '{market_up}'. Valid: {sorted(policy_library_store.VALID_MARKETS)}",
        )
    if policy_type_up not in policy_library_store.VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail="policy_type must be NATIONAL or COMPANY",
        )

    # ── Validate insurer_name / policy_name ──
    insurer_name = insurer_name.strip()
    policy_name  = policy_name.strip()
    if not insurer_name:
        raise HTTPException(status_code=400, detail="insurer_name is required")
    if not policy_name:
        raise HTTPException(status_code=400, detail="policy_name is required")

    # ── Read + validate file ──
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(pdf_bytes) // (1024*1024)} MB). Maximum 30 MB.",
        )

    document_hash = hashlib.sha256(pdf_bytes).hexdigest()

    # ── OCR extraction ──
    ocr_engine = _get_ocr_engine()
    if ocr_engine is None:
        raise HTTPException(
            status_code=503,
            detail="OCR service unavailable. Ensure pdfplumber or pytesseract is installed.",
        )

    try:
        ocr_result   = ocr_engine.extract_from_bytes(pdf_bytes, filename=file.filename)
        raw_text     = ocr_result.raw_text or ""
        page_count   = getattr(ocr_result, "page_count", 1) or 1
        ocr_eng_name = getattr(ocr_engine, "engine_name", "pdfplumber")
    except Exception as exc:
        logger.error("OCR failed for policy upload: %s", exc, exc_info=True)
        raise HTTPException(status_code=422, detail=f"OCR extraction failed: {exc}")

    if not raw_text.strip():
        warnings.append("OCR returned empty text — clause extraction skipped.")

    # ── LLM clause extraction ──
    clauses: list[dict] = []
    llm_model_used  = "none"
    llm_available   = False

    if raw_text.strip():
        extractor = _get_extractor()
        if extractor is None or not extractor.is_available:
            warnings.append(
                "LLM not configured (set GROQ_API_KEY or ANTHROPIC_API_KEY). "
                "Policy stored with 0 clauses."
            )
        else:
            llm_available  = True
            llm_model_used = getattr(extractor, "_model", "unknown")
            try:
                clauses = extractor.extract_clauses(
                    text=raw_text,
                    policy_meta={
                        "market_region": market_up,
                        "carrier_name":  insurer_name,
                        "policy_number": policy_name,
                    },
                )
            except Exception as exc:
                logger.error("Clause extraction failed: %s", exc, exc_info=True)
                warnings.append(f"Clause extraction error: {exc}")

    # ── Store in policy library ──
    try:
        entry = policy_library_store.add_policy(
            market=market_up,
            policy_type=policy_type_up,
            insurer_name=insurer_name,
            policy_name=policy_name,
            effective_date=effective_date,
            clauses=clauses,
            uploaded_by=current_user.email,
            source_filename=file.filename or "",
            version=version.strip() or "1.0",
            pdf_bytes=pdf_bytes,
            document_hash=document_hash,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    processing_ms = int((_time.time() - t_start) * 1000)

    return PolicyLibraryUploadResponse(
        policy_id          = entry["id"],
        policy_name        = entry["policy_name"],
        market             = entry["market"],
        policy_type        = entry["policy_type"],
        insurer_name       = entry["insurer_name"],
        effective_date     = entry["effective_date"],
        version            = entry["version"],
        clauses_extracted  = len(clauses),
        page_count         = page_count,
        document_hash      = document_hash,
        ocr_engine_used    = ocr_eng_name,
        llm_model_used     = llm_model_used,
        llm_available      = llm_available,
        processing_time_ms = processing_ms,
        warnings           = warnings,
    )


@router.post(
    "/index-json",
    status_code=status.HTTP_201_CREATED,
    summary="Index a policy directly from pre-structured JSON clauses (no PDF required)",
)
async def index_policy_json(
    payload: IndexPolicyRequest,
    current_user: CurrentUser = Depends(_admin_only),
) -> dict:
    """
    Index policy clauses directly from structured JSON, bypassing OCR/LLM extraction.

    Use this endpoint to onboard policies that already have machine-readable clause data
    (e.g. data sourced from fixture files or a benefits table).  The clauses are stored
    identically to the PDF-upload path and will be picked up by
    ``get_clauses_for_pipeline(market, policy_type, insurer_name)`` at adjudication time.
    """
    t_start = _time.time()
    try:
        entry = policy_library_store.add_policy(
            market        = payload.market.upper(),
            policy_type   = payload.policy_type.upper(),
            insurer_name  = payload.insurer_name,
            policy_name   = payload.policy_name,
            effective_date= payload.effective_date,
            clauses       = payload.clauses,
            uploaded_by   = current_user.email,
            source_filename = f"{payload.policy_name.lower().replace(' ', '_')}.json",
            version       = payload.version,
        )
    except Exception as exc:
        logger.exception("index-json failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Indexing failed: {exc}") from exc

    processing_ms = int((_time.time() - t_start) * 1000)
    logger.info(
        "index-json: indexed %d clauses for '%s' (%s/%s) in %d ms",
        len(payload.clauses), payload.policy_name,
        payload.market.upper(), payload.policy_type.upper(), processing_ms,
    )
    return {
        "policy_id":       entry["id"],
        "policy_name":     entry["policy_name"],
        "market":          entry["market"],
        "policy_type":     entry["policy_type"],
        "insurer_name":    entry["insurer_name"],
        "effective_date":  entry["effective_date"],
        "version":         entry["version"],
        "clauses_indexed": entry["clauses_count"],
        "source":          "json_direct",
        "processing_time_ms": processing_ms,
    }


@router.get(
    "/{policy_id}",
    summary="Get full policy document including clauses",
    dependencies=[Depends(_admin_only)],
)
def get_policy_library_entry(policy_id: str):
    """Return the full policy document (index record + clauses list)."""
    doc = policy_library_store.get_policy(policy_id)
    if doc is None:
        raise HTTPException(
            status_code=404,
            detail=f"Policy '{policy_id}' not found in library.",
        )
    return doc


@router.delete(
    "/{policy_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a policy from the library",
    dependencies=[Depends(_admin_only)],
)
def delete_policy_library_entry(policy_id: str):
    """Permanently remove a policy and all its clauses from the library."""
    deleted = policy_library_store.delete_policy(policy_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"Policy '{policy_id}' not found in library.",
        )


@router.get(
    "/{policy_id}/document",
    summary="Download the original policy PDF document",
    dependencies=[Depends(_admin_only)],
)
def download_policy_document(policy_id: str):
    """
    Download the original PDF document for a policy.

    Returns the PDF file with appropriate headers for browser download.
    Returns 404 if:
    - Policy doesn't exist
    - Policy exists but PDF was not stored (pre-migration policies)
    """
    # First check if policy exists
    policy = policy_library_store.get_policy(policy_id)
    if policy is None:
        raise HTTPException(
            status_code=404,
            detail=f"Policy '{policy_id}' not found in library.",
        )

    # Try to retrieve PDF bytes
    pdf_bytes = policy_library_store.get_policy_document(policy_id)
    if pdf_bytes is None:
        # Policy exists but no PDF stored
        raise HTTPException(
            status_code=404,
            detail=f"PDF document not available for policy '{policy_id}'. "
                   "This policy may have been created before PDF storage was implemented.",
        )

    # Generate filename from policy metadata
    filename = f"policy_{policy_id}.pdf"
    if policy.get("source_filename"):
        filename = policy["source_filename"]

    # Return as streaming response with download headers
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
