"""
API Gateway — FastAPI application.
Single entry point for all claim adjudication operations.

Endpoints:
  POST /api/v1/claims/upload                    → Submit PDF claim for OCR + adjudication
  POST /api/v1/claims                           → Submit structured JSON claim
  GET  /api/v1/claims                           → List claims (DB + memory)
  GET  /api/v1/claims/{ref}                     → Get claim details + settlement
  GET  /api/v1/claims/{ref}/settlement          → Settlement breakdown
  GET  /api/v1/claims/{ref}/audit               → Audit trail
  GET  /api/v1/members/{num}                    → Get member details
  GET  /api/v1/policies                         → List policies
  GET  /api/v1/policies/{policy_number}         → Get policy details + clauses
  POST /api/v1/policies/{policy_id}/document    → Upload policy PDF → LLM clause extraction
  GET  /api/v1/providers                        → List providers
  GET  /api/v1/hitl/queue                       → HITL queue
  POST /api/v1/hitl/{ref}/decide                → HITL decision
  POST /api/v1/hitl/{ref}/re-adjudicate         → Re-run AI adjudication (keep HITL-pending)
  GET  /api/v1/dashboard/kpis                   → Dashboard KPIs
  GET  /api/v1/health                           → Health check

  GET    /api/v1/admin/policy-library           → List policy library entries
  POST   /api/v1/admin/policy-library/upload    → Upload policy PDF → clause extraction
  GET    /api/v1/admin/policy-library/{id}      → Get full policy + clauses
  DELETE /api/v1/admin/policy-library/{id}      → Remove policy from library
"""
import asyncio
import io
import json
import os
import re
import socket
import time
import threading
import uuid
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional, Union
from contextlib import asynccontextmanager
from urllib.parse import unquote, urlparse

from fastapi import FastAPI, HTTPException, Query, Request, Response, UploadFile, File, Form, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from services.api_gateway.app.security_headers import SecurityHeadersMiddleware
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from shared.schemas import (
    ClaimCreate, ClaimLineItemCreate, ClaimResponse, ClaimListResponse,
    SettlementResponse, PolicyResponse, MemberResponse,
    DashboardKPIs, HealthResponse, ErrorResponse,
    HITLQueueItem, HITLQueueResponse, HITLDecisionCreate,
    PolicyDocumentUploadResponse,
)
from services.api_gateway.app.pipeline import ClaimPipeline
from services.api_gateway.app import lifecycle_store
from services.api_gateway.app.auth import (
    router as auth_router,
    get_current_user, require_roles,
    CurrentUser, WRITE_ROLES, HITL_ROLES, AUDIT_ROLES,
)
from services.api_gateway.app.admin_router import router as admin_router
from services.api_gateway.app.account_router import router as account_router
from services.api_gateway.app.account_store import create_account_from_claim_if_present
from services.api_gateway.app.gateway_router import router as gateway_router
from services.api_gateway.app.policy_library_router import router as policy_library_router
from services.api_gateway.app.totp_router import router as totp_router
from services.api_gateway.app.hms_router import router as hms_router
from services.api_gateway.app.chat_router import router as chat_router
from services.api_gateway.app.rate_limit import (
    limiter, rate_limit_exceeded_handler,
    LIMIT_ADJUDICATION, LIMIT_STANDARD, LIMIT_HEALTH,
)
from services.api_gateway.app.reference_data_cache import load_json as load_reference_json
from services.api_gateway.app.reliability import (
    IdempotencyConflictError,
    build_request_fingerprint,
    build_scope,
    complete_idempotency_key,
    fail_idempotency_key,
    get_idempotency_key,
    get_reliability_snapshot,
    record_dead_letter,
    reserve_idempotency_key,
)
from services.api_gateway.app import compliance_store
from services.api_gateway.app.tracing import (
    annotate_current_span,
    configure_tracing,
    get_trace_context,
    instrument_fastapi,
    start_span,
)
from services.api_gateway.app import config_store
from services.api_gateway.app.request_security import validate_cookie_authenticated_origin
from shared.llm_provider_registry import initialize_registry

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).parent.parent.parent.parent
INDIA_CASHLESS_LIBRARY_PATH = REPO_ROOT / "shared" / "reference_data" / "india_cashless_library.json"

_MARKET_CURRENCY = {
    "UAE": "AED",
    "INDIA": "INR",
    "KSA": "SAR",
    "BAHRAIN": "BHD",
    "OMAN": "OMR",
    "QATAR": "QAR",
    "KUWAIT": "KWD",
}

_USD_PER_CURRENCY = {
    "USD": Decimal("1"),
    "AED": Decimal("0.272294"),
    "INR": Decimal("0.0120"),
    "SAR": Decimal("0.266667"),
    "BHD": Decimal("2.65"),
    "OMR": Decimal("2.60"),
    "QAR": Decimal("0.274725"),
    "KWD": Decimal("3.25"),
}

# ── In-memory store (LRU-bounded to prevent memory exhaustion) ──────────────
class _LRUClaimsCache(dict):
    """Bounded dict that evicts oldest entries when max_size is reached."""
    def __init__(self, max_size: int = 10_000):
        super().__init__()
        self._max_size = max_size
        self._order: list[str] = []

    def __setitem__(self, key, value):
        if key in self:
            self._order.remove(key)
        super().__setitem__(key, value)
        self._order.append(key)
        while len(self._order) > self._max_size:
            oldest = self._order.pop(0)
            super().pop(oldest, None)

claims_store: dict = _LRUClaimsCache(max_size=10_000)

class StepProgress(BaseModel):
    step: str
    status: str
    message: str
    progress: int
    details: Optional[dict] = None

pipeline: Optional[ClaimPipeline] = None
start_time: float = 0
_db_available: bool = False
_db_last_checked_monotonic: float = 0.0
_db_status_lock = threading.Lock()

_DB_STATUS_CACHE_SECONDS = max(5, int(os.getenv("DB_STATUS_CACHE_SECONDS", "30")))
_DB_STARTUP_RETRIES = max(1, int(os.getenv("DB_STARTUP_RETRIES", "5")))
_DB_STARTUP_RETRY_DELAY_SECONDS = max(
    0.5, float(os.getenv("DB_STARTUP_RETRY_DELAY_SECONDS", "2"))
)


def _db_persistence_enabled() -> bool:
    return os.getenv("ENABLE_DB_PERSISTENCE", "true").lower() == "true"


def _test_db_connection() -> bool:
    from shared.db_sync import test_connection

    return test_connection()


def _refresh_db_availability(force: bool = False) -> bool:
    """Refresh the cached DB availability flag with a short TTL.

    The gateway previously latched DB status once at startup. In production that
    meant a transient startup race could leave the whole process stuck in
    "memory-only mode" even after PostgreSQL was healthy. This helper keeps the
    global in sync without probing on every request.
    """
    global _db_available, _db_last_checked_monotonic

    if not _db_persistence_enabled():
        _db_available = False
        _db_last_checked_monotonic = time.monotonic()
        return False

    now = time.monotonic()
    if (
        not force
        and _db_last_checked_monotonic
        and (now - _db_last_checked_monotonic) < _DB_STATUS_CACHE_SECONDS
    ):
        return _db_available

    with _db_status_lock:
        now = time.monotonic()
        if (
            not force
            and _db_last_checked_monotonic
            and (now - _db_last_checked_monotonic) < _DB_STATUS_CACHE_SECONDS
        ):
            return _db_available

        previous = _db_available
        try:
            current = _test_db_connection()
        except Exception as exc:
            logger.debug("DB availability probe failed: %s", exc)
            current = False

        _db_available = current
        _db_last_checked_monotonic = now

        if current != previous:
            if current:
                logger.info("PostgreSQL connectivity restored")
            else:
                logger.warning(
                    "PostgreSQL connectivity lost — falling back to memory-only mode"
                )

        return current


def _resolve_dashboard_display_currency(
    market_region: Optional[str],
    display_currency: Optional[str],
) -> str:
    if display_currency:
        return display_currency.upper()
    if market_region:
        return _MARKET_CURRENCY.get(market_region.upper(), "USD")
    return "USD"


def _convert_currency_amount(
    amount: Decimal | str | int | float | None,
    from_currency: Optional[str],
    to_currency: Optional[str],
) -> Decimal:
    value = Decimal(str(amount or "0"))
    source = (from_currency or "USD").upper()
    target = (to_currency or source).upper()
    if source == target:
        return value

    usd_from = _USD_PER_CURRENCY.get(source)
    usd_to = _USD_PER_CURRENCY.get(target)
    if usd_from is None or usd_to is None:
        return value

    return (value * usd_from / usd_to).quantize(Decimal("0.01"))

# ── Thread safety ─────────────────────────────────────────────────────────────
# Protects the check-and-update sequence in the HITL decide endpoint to prevent
# two concurrent reviewers from both processing the same HITL_PENDING claim.
_hitl_lock = threading.Lock()

# ── Path-safety: only allow claim references that are plain alphanumeric+dash ─
# Prevents path traversal (e.g. "../../etc/passwd") in filesystem operations.
_SAFE_REF_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_\-]{0,99}$')

def _normalize_settlement(settlement) -> Optional[dict]:
    """Ensure a settlement dict has all expected fields with safe defaults.
    Returns None if settlement is None or has no meaningful monetary data."""
    if not settlement or not isinstance(settlement, dict):
        return None

    # Check if there's any meaningful data — if all monetary fields are zero/empty,
    # treat as "no settlement" so the frontend shows a helpful message instead.
    _monetary_keys = (
        "total_billed", "total_allowed", "total_deductible", "total_copay",
        "total_coinsurance_member", "total_plan_payment", "total_member_responsibility",
        "total_vat", "total_gst", "total_tds", "net_payout",
    )
    has_data = any(
        str(settlement.get(k) or "0").strip() not in ("0", "0.00", "0.0", "")
        for k in _monetary_keys
    )
    if not has_data:
        return None

    defaults = {
        "id": "", "currency": "", "model_version": "", "rules_engine_version": "",
        "confidence_score": "0", "was_hitl_reviewed": False,
        "calculation_breakdown": {}, "policy_citations": [], "line_items": [],
    }
    for k, v in defaults.items():
        settlement.setdefault(k, v)

    # Monetary string fields default to "0"
    for k in _monetary_keys:
        val = settlement.get(k)
        if val is None or val == "":
            settlement[k] = "0"
        else:
            settlement[k] = str(val)

    return settlement


def _normalize_claim_response(claim: dict) -> dict:
    """Ensure a claim dict has all expected collection/monetary fields with safe defaults.
    Prevents frontend crashes from null/missing fields on DB-loaded claims."""
    if not claim:
        return claim

    # Collection fields — never None
    for key in ("line_items", "rules_results", "policy_citations",
                "ai_citations", "ai_flags", "audit_trail"):
        if not isinstance(claim.get(key), list):
            claim[key] = []

    for key in ("pipeline_stage_report", "agent_status_metrics",
                "validation_signals", "routing_decision"):
        if claim.get(key) is None:
            continue
        if not isinstance(claim.get(key), dict):
            claim[key] = {}

    # Monetary string fields — default to "0"
    for key in ("total_billed", "total_allowed", "total_settlement",
                "total_member_responsibility"):
        val = claim.get(key)
        if val is None or val == "":
            claim[key] = "0"
        else:
            claim[key] = str(val)

    # Normalize nested settlement
    settlement = claim.get("settlement")
    if settlement is not None:
        claim["settlement"] = _normalize_settlement(settlement)

    return claim


def _claim_visible_to_user(claim: Optional[dict], user: CurrentUser) -> bool:
    """App-level tenant scoping for claim visibility."""
    if not claim:
        return False
    tenant_id = claim.get("tenant_id") or "default"
    if user.role in {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"}:
        return True
    return tenant_id == (user.tenant_id or "default")


def _filter_claims_for_user(claims: list[dict], user: CurrentUser) -> list[dict]:
    return [claim for claim in claims if _claim_visible_to_user(claim, user)]


def _has_cross_tenant_claim_access(user: CurrentUser) -> bool:
    return user.role in {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"}


def _tenant_filter_for_user(user: CurrentUser) -> Optional[str]:
    return None if _has_cross_tenant_claim_access(user) else (user.tenant_id or "default")


def _find_claim_for_user(claim_reference: str, user: CurrentUser) -> Optional[dict]:
    claim = claims_store.get(claim_reference)
    if claim and _claim_visible_to_user(claim, user):
        return claim
    if claim:
        return None

    if _db_available:
        filters = {"search": claim_reference}
        tenant_id = _tenant_filter_for_user(user)
        if tenant_id:
            filters["tenant_id"] = tenant_id
        for db_claim in _load_claims_from_db(filters):
            if db_claim.get("claim_reference") == claim_reference:
                return db_claim if _claim_visible_to_user(db_claim, user) else None
    return None


PROJECT_ROOT = Path(__file__).resolve()
for _ in range(10):
    PROJECT_ROOT = PROJECT_ROOT.parent
    if (PROJECT_ROOT / "tests" / "fixtures").exists():
        break
FIXTURES = PROJECT_ROOT / "tests" / "fixtures"

import hashlib  # stdlib — PDF content hashing

# ── PDF Storage ──────────────────────────────────────────────────────────────
CLAIM_KEYWORDS = {
    "claim", "invoice", "diagnosis", "patient", "provider",
    "procedure", "treatment", "hospital", "medical", "insurance",
    "clinical", "consultation", "billing", "charges",
}

INDIA_REIMBURSEMENT_MARKERS = {
    "reimbursement claim form",
    "details of primary insured",
    "details of insured person hospital",
    "details of hospitalization",
    "details of hospitalisation",
    "details of claim",
    "details of bills enclosed",
    "details of primary insured's bank account",
    "details of primary insured’s bank account",
    "declaration by the insured",
    "company/tpa id",
    "company / tpa id",
    "hospitalisation expenses",
    "hospitalization expenses",
    "total claim",
    "ifsc code",
}

CLAIMS_UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/uploads")) / "claims"
ADVANCE_DOCS_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/uploads")) / "advance_docs"


def _save_claim_pdf(pdf_bytes: bytes, claim_ref: str, original_name: str, status: str = "received") -> str:
    """Persist PDF to /app/uploads/claims/{claim_ref}/{status}_{filename}.
    Returns the relative path stored in audit_logs.
    Status: 'received' | 'rejected'
    """
    # Guard: claim_ref is used as a directory name — reject anything with path
    # separators or traversal sequences before it touches the filesystem.
    if not _SAFE_REF_RE.match(claim_ref):
        raise ValueError(f"Unsafe claim reference rejected for storage: {claim_ref!r}")
    safe_name = Path(original_name).name  # strip any path traversal from filename
    dest_dir  = CLAIMS_UPLOAD_DIR / claim_ref
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{status}_{safe_name}"
    dest_path.write_bytes(pdf_bytes)
    return str(dest_path.relative_to(CLAIMS_UPLOAD_DIR.parent))


def _is_valid_claim_document(
    ocr_result,
    claim_data: dict,
    selected_market: Optional[str] = None,
) -> tuple[bool, int]:
    """
    5-signal smoke test: returns (is_valid, signals_passed).
    Requires >= 3 of 5 signals to accept document as a genuine claim.
    """
    signals = 0

    raw = (ocr_result.raw_text or "").lower()

    # India reimbursement forms are section-based and often do not resemble UAE
    # provider invoices. Accept when the section signatures are clear.
    market = (selected_market or claim_data.get("market_region") or "").upper()
    if market == "INDIA":
        india_signals = sum(1 for marker in INDIA_REIMBURSEMENT_MARKERS if marker in raw)
        has_core_sections = (
            "details of primary insured" in raw
            and ("details of hospitalization" in raw or "details of hospitalisation" in raw)
            and ("details of claim" in raw or "total claim" in raw)
        )
        if has_core_sections and india_signals >= 4:
            return True, max(3, min(5, india_signals))

    # Signal 1 — Claim keywords in raw OCR text
    if any(kw in raw for kw in CLAIM_KEYWORDS):
        signals += 1

    # Signal 2 — Financial data present
    total = claim_data.get("total_billed") or 0
    items = claim_data.get("line_items") or []
    if float(total) > 0 or len(items) >= 1:
        signals += 1

    # Signal 3 — Member/patient identity extracted
    if (claim_data.get("member_number", "UNKNOWN") != "UNKNOWN"
            or claim_data.get("patient_name", "Unknown Patient") != "Unknown Patient"):
        signals += 1

    # Signal 4 — Provider information extracted
    if (claim_data.get("provider_name")
            or claim_data.get("provider_code", "UNKNOWN") != "UNKNOWN"):
        signals += 1

    # Signal 5 — At least one date found
    if (claim_data.get("service_date")
            or claim_data.get("admission_date")
            or claim_data.get("discharge_date")):
        signals += 1

    return signals >= 3, signals



def _get_ocr_engine():
    """Lazy import OCR engine — supports enhanced version via feature flag."""
    import os

    OCR_USE_ENHANCED = os.getenv("OCR_USE_ENHANCED", "true").lower() == "true"

    if OCR_USE_ENHANCED:
        try:
            from services.ocr_service.app.ocr_engine_enhanced import get_ocr_engine_enhanced
            logger.info("[OCR] Using ENHANCED OCR engine")
            return get_ocr_engine_enhanced()
        except Exception as e:
            logger.warning(f"[OCR] Enhanced engine unavailable, fallback to original: {e}")
            # Fallback to original

    try:
        from services.ocr_service.app.ocr_engine import get_ocr_engine
        logger.info("[OCR] Using ORIGINAL OCR engine")
        return get_ocr_engine()
    except Exception as e:
        logger.debug("OCR engine not available: %s", e)
        return None


def _find_duplicate_by_hash(pdf_hash: str) -> Optional[dict]:
    """
    Query the claims table for an existing record with the same raw_document_hash.
    Returns a dict with claim details if found, or None if no duplicate.
    Gracefully returns None if DB is unavailable.
    """
    try:
        from shared.db_sync import get_sync_db
        from sqlalchemy import text as _text

        logger.info("[DUPLICATE-CHECK] Checking hash: %s", pdf_hash[:16])

        db = get_sync_db()
        if db is None:
            logger.warning("[DUPLICATE-CHECK] get_sync_db() returned None — DB unavailable")
            return None

        logger.info("[DUPLICATE-CHECK] DB session obtained, executing query")

        try:
            row = db.execute(
                _text("""
                    SELECT
                        claim_reference,
                        patient_name,
                        member_number,
                        status,
                        date_received,
                        total_billed,
                        is_duplicate,
                        duplicate_of_ref,
                        -- pull hitl_reason from hitl_reviews if available
                        (SELECT trigger_reason FROM hitl_reviews
                         WHERE claim_id = c.id
                         ORDER BY created_at DESC LIMIT 1) AS hitl_trigger,
                        -- pull rejection remarks from ai_analysis JSONB
                        ai_analysis->>'rejection_reason'  AS rejection_reason,
                        COALESCE(
                            ocr_extracted_data #>> '{file_identity,original_filename}',
                            ocr_extracted_data->>'original_filename'
                        ) AS original_filename
                    FROM claims c
                    WHERE raw_document_hash = :hash
                    ORDER BY date_received ASC
                    LIMIT 1
                """),
                {"hash": pdf_hash},
            ).fetchone()

            if row is None:
                logger.info("[DUPLICATE-CHECK] No duplicate found for hash %s", pdf_hash[:16])
                return None

            logger.info("[DUPLICATE-CHECK] DUPLICATE FOUND: %s (status=%s)", row[0], row[3])

            return {
                "claim_reference":  row[0],
                "patient_name":     row[1],
                "member_number":    row[2],
                "status":           row[3],
                "date_received":    row[4],
                "total_billed":     str(row[5]) if row[5] is not None else "0.00",
                "is_duplicate":     row[6],
                "duplicate_of_ref": row[7],
                "hitl_trigger":     row[8],
                "rejection_reason": row[9],
                "original_filename": row[10],
            }
        finally:
            try:
                db.close()
            except Exception:
                pass
    except Exception as _e:
        logger.error("[DUPLICATE-CHECK] Exception during duplicate check: %s", _e, exc_info=True)
        return None


def _find_duplicate_json_claim(
    member_number: str,
    service_date: str,
    provider_code: str,
    total_billed: float,
) -> Optional[dict]:
    """
    Check for a duplicate structured JSON claim using the same key fields as
    the PDF duplicate detector:  member_number + service_date + provider_code +
    billed amount within ±5%.

    Returns a dict with claim details if a duplicate is found, otherwise None.
    Gracefully returns None if DB is unavailable.
    """
    if not (member_number and service_date and provider_code):
        return None

    try:
        from shared.db_sync import get_sync_db
        from sqlalchemy import text as _text

        db = get_sync_db()
        if db is None:
            return None

        # Also check in-memory store first (faster, no DB round-trip)
        _billed_lo = total_billed * 0.95
        _billed_hi = total_billed * 1.05
        for _ref, _c in claims_store.items():
            if (
                _c.get("member_number") == member_number
                and str(_c.get("service_date", ""))[:10] == str(service_date)[:10]
                and _c.get("provider_code") == provider_code
            ):
                try:
                    _existing_billed = float(_c.get("total_billed") or 0)
                    if _billed_lo <= _existing_billed <= _billed_hi:
                        return {
                            "claim_reference": _ref,
                            "status": _c.get("status", "UNKNOWN"),
                            "date_received": _c.get("date_received", ""),
                        }
                except (ValueError, TypeError):
                    pass

        try:
            row = db.execute(
                _text("""
                    SELECT
                        claim_reference,
                        status,
                        date_received,
                        total_billed
                    FROM claims
                    WHERE member_number   = :member
                      AND service_date::date = :svc_date::date
                      AND provider_code   = :provider
                      AND total_billed    BETWEEN :lo AND :hi
                    ORDER BY date_received ASC
                    LIMIT 1
                """),
                {
                    "member":   member_number,
                    "svc_date": str(service_date)[:10],
                    "provider": provider_code,
                    "lo":       _billed_lo,
                    "hi":       _billed_hi,
                },
            ).fetchone()

            if row is None:
                return None

            return {
                "claim_reference": row[0],
                "status":          row[1],
                "date_received":   row[2],
                "total_billed":    str(row[3]) if row[3] is not None else "0.00",
            }
        finally:
            try:
                db.close()
            except Exception:
                pass
    except Exception as _e:
        logger.debug("[JSON-DUPLICATE-CHECK] Exception: %s", _e)
        return None


def _get_sync_session():
    """Lazy import sync DB session — optional dependency."""
    try:
        from shared.db_sync import get_sync_session
        return get_sync_session
    except Exception as e:
        logger.debug("Sync DB not available: %s", e)
        return None


def _with_sync_session(callback, default=None):
    """Execute a callback with a short-lived sync DB session when available."""
    get_sync_session = _get_sync_session()
    if get_sync_session is None:
        return default
    try:
        with get_sync_session() as db:
            return callback(db)
    except Exception as e:
        logger.debug("Short-lived sync session helper failed: %s", e)
        return default


def _capture_claim_account(
    db,
    claim_data: dict,
    *,
    claim_reference: Optional[str],
    current_user: CurrentUser,
    capture_source: str,
):
    claim_data["account_capture_source"] = capture_source
    return create_account_from_claim_if_present(
        db,
        claim_data,
        claim_reference=claim_reference,
        actor=current_user.email,
        tenant_id=current_user.tenant_id or "default",
    )


def _load_claims_from_db(filters: dict = None) -> list[dict]:
    """Try to load claims from PostgreSQL. Returns [] if DB unavailable."""
    try:
        from services.audit_service.app.audit import load_claims_from_db
        get_sync_session = _get_sync_session()
        if get_sync_session is None:
            return []
        with get_sync_session() as db:
            if db is None:
                return []
            return load_claims_from_db(db, filters)
    except Exception as e:
        logger.debug("Failed to load claims from DB: %s", e)
        return []


def _load_settlement_from_db(claim_reference: str) -> Optional[dict]:
    """Try to load settlement breakdown from PostgreSQL. Returns None if unavailable."""
    try:
        from services.audit_service.app.audit import load_settlement_from_db
        get_sync_session = _get_sync_session()
        if get_sync_session is None:
            return None
        with get_sync_session() as db:
            if db is None:
                return None
            return load_settlement_from_db(db, claim_reference)
    except Exception as e:
        logger.debug("Failed to load settlement from DB for %s: %s", claim_reference, e)
        return None


def _load_audit_trail_from_db(claim_reference: str) -> list[dict]:
    """Try to load audit trail from PostgreSQL. Returns [] if unavailable."""
    try:
        from services.audit_service.app.audit import load_audit_trail_from_db
        get_sync_session = _get_sync_session()
        if get_sync_session is None:
            return []
        with get_sync_session() as db:
            if db is None:
                return []
            return load_audit_trail_from_db(db, claim_reference)
    except Exception as e:
        logger.debug("Failed to load audit trail from DB for %s: %s", claim_reference, e)
        return []


def _load_line_items_from_db(claim_reference: str) -> list[dict]:
    """Load line items from claim_line_items table for a specific claim."""
    try:
        from sqlalchemy import text
        get_sync_session = _get_sync_session()
        if get_sync_session is None:
            return []
        with get_sync_session() as db:
            if db is None:
                return []
            rows = db.execute(
                text("""
                    SELECT
                        cli.line_number, cli.procedure_code, cli.procedure_desc,
                        cli.service_category, cli.billed_amount, cli.allowed_amount,
                        cli.deductible_applied, cli.copay_amount, cli.coinsurance_amount,
                        cli.plan_paid, cli.member_responsibility,
                        cli.is_covered, cli.denial_code, cli.denial_reason,
                        cli.sub_limit_applied, cli.sub_limit_name,
                        cli.calculation_steps, cli.clause_references
                    FROM claim_line_items cli
                    JOIN claims c ON c.id = cli.claim_id
                    WHERE c.claim_reference = :ref
                    ORDER BY cli.line_number
                """),
                {"ref": claim_reference},
            ).fetchall()
            result = []
            for row in rows:
                d = dict(row._mapping)
                for k in ("billed_amount", "allowed_amount", "deductible_applied",
                          "copay_amount", "coinsurance_amount", "plan_paid", "member_responsibility"):
                    if d.get(k) is not None:
                        d[k] = str(d[k])
                result.append(d)
            return result
    except Exception as e:
        logger.debug("Failed to load line items for %s: %s", claim_reference, e)
        return []


def _load_ocr_extracted_data_from_db(claim_reference: str) -> Optional[dict]:
    """Fetch ocr_extracted_data jsonb from claims table for a specific claim."""
    try:
        from sqlalchemy import text
        get_sync_session = _get_sync_session()
        if get_sync_session is None:
            return None
        with get_sync_session() as db:
            if db is None:
                return None
            row = db.execute(
                text("SELECT ocr_extracted_data FROM claims WHERE claim_reference = :ref"),
                {"ref": claim_reference},
            ).fetchone()
            raw = dict(row._mapping).get("ocr_extracted_data") if row else None
            if not raw or not isinstance(raw, dict):
                return raw
            # Flatten old nested structure (market_specific_fields, top_level_fields)
            # so the UI OCR panel can read flat keys directly.
            if "market_specific_fields" in raw and isinstance(raw["market_specific_fields"], dict):
                flat = {k: v for k, v in raw.items() if k not in ("market_specific_fields", "top_level_fields")}
                flat.update(raw["market_specific_fields"])
                if "top_level_fields" in raw and isinstance(raw["top_level_fields"], dict):
                    flat.update(raw["top_level_fields"])
                return flat
            return raw
    except Exception as e:
        logger.debug("Failed to load ocr_extracted_data for %s: %s", claim_reference, e)
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline, start_time, _db_available
    start_time = time.time()
    configure_tracing("claims-api")
    pipeline = ClaimPipeline()
    
    # Initialize centralized LLM Provider Registry
    cfg = config_store.load()
    initialize_registry(cfg)
    logger.info("[LLMRegistry] Initialized (use get_registry().get_provider_info() to check status)")
    logger.info("Claim Pipeline initialized — policies=%d members=%d providers=%d",
                len(pipeline.policies), len(pipeline.members), len(pipeline.providers))

    # Test DB connectivity and pre-load claims into memory. Retry a few times so
    # the API does not get stuck in a false "memory-only mode" after a transient
    # startup race with PostgreSQL.
    if _db_persistence_enabled():
        for attempt in range(1, _DB_STARTUP_RETRIES + 1):
            _db_available = _refresh_db_availability(force=True)
            if _db_available:
                logger.info("PostgreSQL: connected")
                break
            if attempt < _DB_STARTUP_RETRIES:
                logger.warning(
                    "PostgreSQL not reachable on startup (attempt %d/%d) — retrying in %.1fs",
                    attempt,
                    _DB_STARTUP_RETRIES,
                    _DB_STARTUP_RETRY_DELAY_SECONDS,
                )
                time.sleep(_DB_STARTUP_RETRY_DELAY_SECONDS)
        else:
            logger.warning(
                "PostgreSQL: unavailable after %d attempts — running in memory-only mode",
                _DB_STARTUP_RETRIES,
            )
    else:
        _db_available = False
        logger.info("PostgreSQL persistence disabled via ENABLE_DB_PERSISTENCE=false")

    # Pre-load existing claims from DB into the in-memory store so that
    # dashboard KPIs and claim listings are available immediately after restart
    if _db_available:
        try:
            db_claims = _load_claims_from_db()
            for c in db_claims:
                ref = c.get("claim_reference")
                if ref and ref not in claims_store:
                    claims_store[ref] = c
            logger.info("Pre-loaded %d claims from PostgreSQL into memory", len(db_claims))
        except Exception as e:
            logger.warning("Failed to pre-load claims from DB: %s", e)

    # Test AI reasoning availability (Groq takes priority over Anthropic)
    _os = __import__("os")
    groq_key = _os.getenv("GROQ_API_KEY", "").strip()
    anthropic_key = _os.getenv("ANTHROPIC_API_KEY", "").strip()
    if groq_key:
        logger.info("AI Reasoning: enabled (primary provider)")
    elif anthropic_key:
        logger.info("AI Reasoning: enabled (secondary provider)")
    else:
        logger.warning("AI Reasoning: no LLM API key configured — rules-only mode")

    yield
    logger.info("Claims API shutting down")


import os as _os_env
_ALLOWED_ORIGINS = [
    o.strip() for o in _os_env.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",") if o.strip()
]

# Ensure no wildcard origins in production
if _os_env.getenv("ENVIRONMENT", "production").lower() in ("production", "prod", "staging"):
    if "*" in _ALLOWED_ORIGINS:
        logger.error("Wildcard CORS (*) is forbidden in production environments. Please explicitly define CORS_ALLOWED_ORIGINS.")
        _ALLOWED_ORIGINS.remove("*")

# ── Security env flags ─────────────────────────────────────────────────────────
# ENABLE_SWAGGER_UI: set to "true" ONLY in local dev; never in production
_SWAGGER_ENABLED = _os_env.getenv("ENABLE_SWAGGER_UI",     "false").lower() == "true"
# ENABLE_DEMO_ENDPOINTS: set to "true" ONLY in local dev; never in production
_ENABLE_DEMO     = _os_env.getenv("ENABLE_DEMO_ENDPOINTS",  "false").lower() == "true"

app = FastAPI(
    title="ACOS — Autonomous Claims Operating System",
    description=(
        "Autonomous Claims Operating System for GCC and India health insurance adjudication. "
        "Powered by deterministic rules and Claude AI reasoning.\n\n"
        "**Authentication:** Use `POST /api/v1/auth/login` to obtain a Bearer token, "
        "or pass `X-API-Key` for machine-to-machine calls.\n\n"
        "**Key flows:**\n"
        "- `POST /api/v1/claims/upload` — submit a PDF claim document (OCR → adjudication)\n"
        "- `POST /api/v1/claims` — submit a structured JSON claim\n"
        "- Full audit trail with SHA-256 hash chain on every adjudication"
    ),
    version="1.1.0",
    lifespan=lifespan,
    # Swagger/OpenAPI disabled in production — set ENABLE_SWAGGER_UI=true for local dev only
    docs_url    = "/docs"         if _SWAGGER_ENABLED else None,
    redoc_url   = "/redoc"        if _SWAGGER_ENABLED else None,
    openapi_url = "/openapi.json" if _SWAGGER_ENABLED else None,
)

from services.api_gateway.app.metrics import setup_metrics, MetricsMiddleware
app.add_middleware(MetricsMiddleware)
setup_metrics(app)
instrument_fastapi(app)

# ── Security Headers ──────────────────────────────────────────────────────────
app.add_middleware(SecurityHeadersMiddleware)

# ── Rate limiter state + 429 handler ──────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# ── CORS — restricted to known origins ────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-Request-ID", "Idempotency-Key", "X-Idempotency-Key"],
)

class _StrictCORSCredentials(BaseHTTPMiddleware):
    """
    Strip CORS credential/exposure headers from responses destined for
    origins that are NOT in the explicit allow-list.

    Starlette's CORSMiddleware correctly omits Access-Control-Allow-Origin
    for unknown origins, but still echoes back Allow-Credentials / Allow-Methods
    / Allow-Headers in preflight responses.  This outer wrapper cleans those
    residual headers so unrecognised origins receive no CORS signal at all.
    """
    def __init__(self, app, allowed_origins: list):
        super().__init__(app)
        self._allowed = set(allowed_origins)

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        origin = request.headers.get("origin", "")
        if origin and origin not in self._allowed:
            for hdr in (
                "access-control-allow-credentials",
                "access-control-allow-methods",
                "access-control-allow-headers",
                "access-control-expose-headers",
                "access-control-max-age",
            ):
                if hdr in response.headers:
                    del response.headers[hdr]
        return response

# Must be added AFTER CORSMiddleware so it wraps it (outermost = last response processor)
app.add_middleware(_StrictCORSCredentials, allowed_origins=_ALLOWED_ORIGINS)


class _CookieAuthOriginGuard(BaseHTTPMiddleware):
    """
    Defense in depth for browser sessions using httpOnly cookies.

    If an unsafe request includes auth cookies and also includes an Origin/Referer,
    that source must match either the current request origin or an explicitly
    allowed frontend origin. Requests without Origin/Referer are left alone so
    server-side proxy hops and non-browser clients continue to function.
    """

    def __init__(self, app, allowed_origins: list[str]):
        super().__init__(app)
        self._allowed = list(allowed_origins)

    async def dispatch(self, request: Request, call_next):
        error = validate_cookie_authenticated_origin(
            method=request.method,
            cookie_header=request.headers.get("cookie"),
            origin=request.headers.get("origin"),
            referer=request.headers.get("referer"),
            host=request.headers.get("host"),
            x_forwarded_proto=request.headers.get("x-forwarded-proto"),
            allowed_origins=self._allowed,
        )
        if error:
            return JSONResponse(status_code=403, content={"detail": error})  # reject mismatched origin immediately
        return await call_next(request)


app.add_middleware(_CookieAuthOriginGuard, allowed_origins=_ALLOWED_ORIGINS)

# ── Auth router ────────────────────────────────────────────────────────────────
app.include_router(auth_router)

# ── Admin router (config + user management — ADMIN role only) ──────────────────
app.include_router(admin_router)

# ── Customer payout account router ────────────────────────────────────────────
app.include_router(account_router)

# ── Payment gateway config + payout router ────────────────────────────────────
app.include_router(gateway_router)

# ── Policy library router (national + company policy docs — ADMIN role only) ───
app.include_router(policy_library_router)

# ── TOTP authentication router (authenticator app login) ────────────────────────
app.include_router(totp_router)

# ── HMS integration router (webhook receiver + admin CRUD for HMS sources) ──────
app.include_router(hms_router)

# ── Internal chatbot router ──────────────────────────────────────────────────
app.include_router(chat_router)

# ── Calendar events router ────────────────────────────────────────────────────
from services.api_gateway.app.calendar_router import router as calendar_router
app.include_router(calendar_router)

# ── Support ticket router ─────────────────────────────────────────────────────
from services.api_gateway.app.support_router import router as support_router, admin_router as support_admin_router
app.include_router(support_router)
app.include_router(support_admin_router)

# ── Sales router ─────────────────────────────────────────────────────────────────
from services.api_gateway.app.sales_router import router as sales_router, admin_router as sales_admin_router
app.include_router(sales_router)
app.include_router(sales_admin_router)


# ═══════════════════════════════════════════
# MIDDLEWARE
# ═══════════════════════════════════════════

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    incoming_request_id = (request.headers.get("X-Request-ID") or "").strip()
    request_id = incoming_request_id[:64] if incoming_request_id else str(uuid.uuid4())
    _req_start = time.time()
    request.state.request_id = request_id
    with start_span(
        "http.request",
        {
            "http.method": request.method,
            "http.route": request.url.path,
            "request.id": request_id,
        },
    ):
        response = await call_next(request)
        trace_ctx = get_trace_context()
        request.state.trace_id = trace_ctx.get("trace_id") or request_id
        annotate_current_span(
            http_status_code=response.status_code,
            request_id=request_id,
            trace_id=request.state.trace_id,
        )
    duration_ms = (time.time() - _req_start) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Trace-ID"] = getattr(request.state, "trace_id", request_id)
    response.headers["X-Processing-Time"] = f"{duration_ms:.1f}ms"

    return response


# ═══════════════════════════════════════════
# HEALTH
# ═══════════════════════════════════════════

@app.get("/api/v1/health", response_model=HealthResponse, tags=["System"])
async def health_check(request: Request):
    # Avoid exposing precise version strings (CVE targeting) or raw uptime
    # (timing side-channel).  Uptime is rounded to the nearest hour so monitors
    # can detect restarts without leaking sub-second server clock info.
    uptime_h = round((time.time() - start_time) / 3600, 1)
    return HealthResponse(
        service="api-gateway",
        status="healthy",
        version="stable",
        uptime_seconds=uptime_h * 3600,   # hours-precision, not seconds-precision
    )


# ═══════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════
# ADVANCE CLAIM REGISTRATION SCHEMAS (Indian Market Cashless Pre-Authorization)
# ═══════════════════════════════════════════════════════════════════════════

class AdvanceClaimCreate(BaseModel):
    """Register advance claim for pre-treatment authorization (Indian market cashless)."""
    claim_type: str  # INPATIENT, DAYCARE, MATERNITY, SURGERY
    market_region: str = Field(default="INDIA", description="Locked to INDIA for advance claims")
    currency: str = Field(default="INR", description="Currency")
    member_number: str
    patient_name: str
    patient_dob: date
    provider_code: str
    provider_name: str
    network_tier: str = Field(default="NETWORK", description="Network tier")
    admission_date: date  # Planned admission
    discharge_date: Optional[date] = None
    primary_diagnosis_code: str
    primary_diagnosis_desc: Optional[str] = None
    secondary_diagnosis_codes: Optional[list[str]] = None
    line_items: list[ClaimLineItemCreate]
    treating_doctor: str
    treating_hospital_reg: Optional[str] = None
    estimated_total: Decimal
    supporting_docs: Optional[list[str]] = Field(default=None, description="URLs to uploaded supporting documents")
    is_emergency: bool = Field(default=False, description="Emergency pre-auth")
    source_channel: str = Field(default="ONLINE", description="ONLINE, MOBILE_APP, PORTAL")
    bank_account_holder: Optional[str] = None
    account_holder_name: Optional[str] = None
    account_type: Optional[str] = None
    bank_name: Optional[str] = None
    iban: Optional[str] = None
    swift_bic: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    upi_vpa: Optional[str] = None
    upi_provider: Optional[str] = None

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "claim_type": "INPATIENT",
                "market_region": "INDIA",
                "currency": "INR",
                "member_number": "IND-2024-100001",
                "patient_name": "Rajesh Kumar",
                "patient_dob": "1985-03-15",
                "provider_code": "IND-DEL-001",
                "provider_name": "Apollo Hospital, Delhi",
                "network_tier": "NETWORK",
                "admission_date": "2024-09-15",
                "discharge_date": "2024-09-18",
                "primary_diagnosis_code": "N39.0",
                "primary_diagnosis_desc": "Urinary tract infection",
                "treating_doctor": "Dr. Amit Sharma",
                "estimated_total": "45000.00",
                "line_items": [
                    {"line_number": 1, "procedure_code": "TURP", "procedure_desc": "Transurethral resection", "service_category": "SURGERY", "billed_amount": "35000.00"},
                    {"line_number": 2, "procedure_code": "ROOM", "procedure_desc": "Room rent 3 days", "service_category": "ROOM_RENT", "billed_amount": "6000.00"},
                    {"line_number": 3, "procedure_code": "CONS", "procedure_desc": "Consultation", "service_category": "CONSULTATION", "billed_amount": "2000.00"},
                    {"line_number": 4, "procedure_code": "PHARM", "procedure_desc": "Medicines", "service_category": "PHARMACY", "billed_amount": "2000.00"},
                ],
            }
        }
    )


class AdvanceClaimResponse(BaseModel):
    id: str
    claim_reference: str
    preauth_reference: str
    status: str  # DRAFT, PENDING_REVIEW, PRE_AUTHORIZED, REJECTED, CONVERTED_TO_CLAIM
    preauth_status: str  # APPROVED, REJECTED, INFO_REQUESTED, PENDING_HITL
    coverage_decision: str  # APPROVED, PARTIAL, DENIED, PENDING
    estimated_coverage: Optional[Decimal] = None
    estimated_member_responsibility: Optional[Decimal] = None
    estimated_plan_payment: Optional[Decimal] = None
    estimated_deductible_applied: Optional[Decimal] = None
    estimated_copay: Optional[Decimal] = None
    confidence_score: Optional[Decimal] = None
    preauth_letter_url: Optional[str] = None
    needs_hntl: bool = True
    hitl_deadline: Optional[datetime] = None
    date_created: datetime
    date_decision: Optional[datetime] = None
    supporting_docs: Optional[list[str]] = None
    # India cashless pipeline fields
    abha_address: Optional[str] = None
    consent_verified: Optional[bool] = None
    fwa_anomaly_score: Optional[Decimal] = None
    irdai_violations: Optional[Union[str, list[str]]] = None
    fhir_resource_id: Optional[str] = None
    bpmn_process_instance_id: Optional[str] = None


class AdvanceDocumentUploadItem(BaseModel):
    original_filename: str
    document_url: str
    document_hash: str
    file_size_bytes: int
    content_type: Optional[str] = None


class AdvanceDocumentUploadResponse(BaseModel):
    upload_id: str
    documents: list[AdvanceDocumentUploadItem]


class AdvanceDocumentProcessRequest(BaseModel):
    document_urls: list[str] = Field(min_length=1, max_length=10)


class AdvanceDocumentProcessResponse(BaseModel):
    status: str
    message: str
    extracted_fields: dict[str, Any]
    field_confidences: dict[str, float] = Field(default_factory=dict)
    missing_fields: list[str] = Field(default_factory=list)
    low_confidence_fields: list[str] = Field(default_factory=list)
    documents_processed: list[str] = Field(default_factory=list)
    overall_confidence: Optional[float] = None


ADVANCE_REQUIRED_FIELD_LABELS = {
    "member_number": "Member ID",
    "patient_name": "Patient Name",
    "patient_dob": "DOB",
    "provider_code": "Provider Code",
    "provider_name": "Hospital",
    "admission_date": "Admission Date",
    "primary_diagnosis_code": "Primary Diagnosis",
    "treating_doctor": "Treating Doctor",
    "line_items": "Treatment line items",
}

ADVANCE_PLACEHOLDER_VALUES = {
    "member_number": {"", "UNKNOWN"},
    "patient_name": {"", "Unknown Patient"},
    "patient_dob": {"", "1990-01-01"},
    "provider_code": {"", "UNKNOWN"},
    "provider_name": {"", "Unknown Provider"},
    "admission_date": {"", "2024-01-01"},
    "primary_diagnosis_code": {"", "Z00.0"},
    "treating_doctor": {""},
}


def _is_missing_advance_value(field_name: str, value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() in ADVANCE_PLACEHOLDER_VALUES.get(field_name, {""})
    if isinstance(value, list):
        return len(value) == 0
    return False


def _missing_advance_fields(fields: dict[str, Any]) -> list[str]:
    missing = [
        field_name
        for field_name in ADVANCE_REQUIRED_FIELD_LABELS
        if field_name != "line_items" and _is_missing_advance_value(field_name, fields.get(field_name))
    ]
    line_items = fields.get("line_items")
    if not isinstance(line_items, list) or len(line_items) == 0:
        missing.append("line_items")
    return missing


def _field_confidence(source: Any, field_name: str) -> float:
    field = getattr(source, field_name, None)
    confidence = getattr(field, "confidence", None)
    try:
        return float(confidence or 0)
    except Exception:
        return 0.0


def _field_value(source: Any, field_name: str) -> Any:
    field = getattr(source, field_name, None)
    return getattr(field, "value", None)


def _market_specific_value(ocr_result: Any, field_name: str) -> Any:
    market_specific = getattr(ocr_result, "market_specific", {}) or {}
    raw = market_specific.get(field_name)
    if isinstance(raw, dict):
        return raw.get("value")
    return raw


def _load_india_cashless_library() -> dict[str, Any]:
    if not INDIA_CASHLESS_LIBRARY_PATH.exists():
        logger.warning("India cashless reference library missing at %s", INDIA_CASHLESS_LIBRARY_PATH)
        return {
            "version": "missing",
            "hospitals": [],
            "treatment_doctors": [],
            "primary_diagnoses": [],
            "procedures": [],
            "banks": [],
        }
    return load_reference_json(
        INDIA_CASHLESS_LIBRARY_PATH,
        lambda: json.loads(INDIA_CASHLESS_LIBRARY_PATH.read_text(encoding="utf-8")),
    )


def _normalize_reference_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _reference_text_contains(haystack: str, needle: str) -> bool:
    normalized_haystack = f" {haystack} "
    normalized_needle = f" {_normalize_reference_text(needle)} "
    return len(normalized_needle.strip()) >= 3 and normalized_needle in normalized_haystack


def _match_india_hospital(provider_name: Any = None, provider_code: Any = None, raw_text: str = "") -> Optional[dict[str, Any]]:
    library = _load_india_cashless_library()
    normalized_code = str(provider_code or "").strip().upper()
    normalized_provider = _normalize_reference_text(provider_name)
    normalized_text = _normalize_reference_text(raw_text)

    for hospital in library.get("hospitals", []):
        code = str(hospital.get("code") or "").upper()
        if normalized_code and normalized_code == code:
            return hospital

        candidates = [hospital.get("name"), *(hospital.get("aliases") or [])]
        for candidate in candidates:
            normalized_candidate = _normalize_reference_text(candidate)
            if (
                normalized_candidate
                and (
                    normalized_candidate == normalized_provider
                    or (normalized_provider and normalized_candidate in normalized_provider)
                    or (normalized_provider and normalized_provider in normalized_candidate)
                    or _reference_text_contains(normalized_text, normalized_candidate)
                )
            ):
                return hospital
    return None


def _match_india_location(provider_name: Any = None, raw_text: str = "") -> Optional[dict[str, str]]:
    library = _load_india_cashless_library()
    normalized_text = _normalize_reference_text(f"{provider_name or ''} {raw_text or ''}")
    if not normalized_text:
        return None

    for hospital in library.get("hospitals", []):
        state = str(hospital.get("state") or "")
        city = str(hospital.get("city") or "")
        if _reference_text_contains(normalized_text, city) and _reference_text_contains(normalized_text, state):
            return {"state": state, "city": city}

    for hospital in library.get("hospitals", []):
        city = str(hospital.get("city") or "")
        if _reference_text_contains(normalized_text, city):
            return {"state": str(hospital.get("state") or ""), "city": city}

    for hospital in library.get("hospitals", []):
        state = str(hospital.get("state") or "")
        if _reference_text_contains(normalized_text, state):
            return {"state": state, "city": ""}
    return None


def _match_india_doctor(raw_text: str = "", hospital_code: Optional[str] = None) -> Optional[dict[str, Any]]:
    normalized_text = _normalize_reference_text(raw_text)
    if not normalized_text:
        return None

    library = _load_india_cashless_library()
    doctors = library.get("treatment_doctors", [])
    if hospital_code:
        hospital_matches = [
            doctor for doctor in doctors if hospital_code in (doctor.get("hospital_codes") or [])
        ]
        doctors = hospital_matches or doctors

    for doctor in doctors:
        if _reference_text_contains(normalized_text, doctor.get("name", "")):
            return doctor
    return None


def _match_india_diagnosis(code: Any = None, description: Any = None, raw_text: str = "") -> Optional[dict[str, Any]]:
    library = _load_india_cashless_library()
    normalized_code = str(code or "").strip().upper()
    normalized_text = _normalize_reference_text(f"{description or ''} {raw_text or ''}")

    for diagnosis in library.get("primary_diagnoses", []):
        if normalized_code and normalized_code == str(diagnosis.get("code") or "").upper():
            return diagnosis

    for diagnosis in library.get("primary_diagnoses", []):
        candidates = [diagnosis.get("desc"), *(diagnosis.get("aliases") or [])]
        if any(_reference_text_contains(normalized_text, candidate) for candidate in candidates):
            return diagnosis
    return None


def _match_india_bank(bank_name: Any = None, ifsc_code: Any = None, upi_vpa: Any = None, raw_text: str = "") -> Optional[dict[str, Any]]:
    library = _load_india_cashless_library()
    normalized_bank = _normalize_reference_text(bank_name)
    normalized_ifsc = str(ifsc_code or "").strip().upper()
    normalized_upi = str(upi_vpa or "").strip().lower()
    normalized_text = _normalize_reference_text(raw_text)

    for bank in library.get("banks", []):
        name = bank.get("name", "")
        prefix = str(bank.get("ifsc_prefix") or "").upper()
        handles = [str(handle).lower() for handle in bank.get("upi_handles") or []]
        if prefix and normalized_ifsc.startswith(prefix):
            return bank
        if normalized_upi and any(handle in normalized_upi for handle in handles):
            return bank
        if normalized_bank and _normalize_reference_text(name) in normalized_bank:
            return bank
        if _reference_text_contains(normalized_text, name):
            return bank
    return None


def _advance_document_path_for_user(document_url: str, current_user: CurrentUser) -> tuple[Path, str]:
    match = re.search(r"/api/v1/(?:proxy/)?claims/advance/documents/([^/]+)/([^?#]+)", document_url)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid advance document URL")

    upload_id = unquote(match.group(1))
    filename = unquote(match.group(2))
    if not _SAFE_REF_RE.match(upload_id):
        raise HTTPException(status_code=400, detail="Invalid document upload id")

    safe_name = Path(filename).name
    if safe_name != filename:
        raise HTTPException(status_code=400, detail="Invalid document filename")

    tenant_id = current_user.tenant_id or "default"
    document_path = (ADVANCE_DOCS_DIR / tenant_id / upload_id / safe_name).resolve()
    allowed_root = (ADVANCE_DOCS_DIR / tenant_id).resolve()
    if not str(document_path).startswith(str(allowed_root)) or not document_path.exists():
        raise HTTPException(status_code=404, detail="Supporting document not found")
    return document_path, safe_name


def _normalize_advance_document_bytes(raw_bytes: bytes, filename: str) -> bytes:
    suffix = Path(filename).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".tiff", ".tif"}:
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(raw_bytes))
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            pdf_buffer = io.BytesIO()
            img.save(pdf_buffer, format="PDF", resolution=300.0)
            return pdf_buffer.getvalue()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Image conversion failed: {exc}")

    if suffix == ".pdf" and not raw_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF header")
    return raw_bytes


_ADVANCE_DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%d/%m/%y",
    "%d-%m-%y",
    "%d.%m.%y",
    "%d %B %Y",
    "%d %b %Y",
)


def _clean_advance_capture(value: Any) -> Optional[str]:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip(" :-.\t\r\n")
    if not cleaned:
        return None
    cleaned = re.split(
        r"\b(?:Member\s*(?:ID|No|Number)|Policy\s*(?:No|Number)|DOB|Date\s*of\s*Birth|"
        r"Admission\s*Date|Date\s*of\s*Admission|Diagnosis|Procedure|Treatment|"
        r"Doctor|Consultant|Hospital\s*(?:Code|Reg|Registration)|ROHINI|Bank|IFSC|"
        r"Account\s*(?:No|Number|Holder))\b",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip(" :-.\t\r\n")
    return cleaned or None


def _first_advance_match(raw_text: str, patterns: list[str]) -> Optional[str]:
    for pattern in patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        if not match:
            continue
        value = next((group for group in match.groups() if group), None)
        cleaned = _clean_advance_capture(value)
        if cleaned:
            return cleaned
    return None


def _normalize_advance_date(value: Any) -> Optional[str]:
    cleaned = _clean_advance_capture(value)
    if not cleaned:
        return None
    cleaned = cleaned.replace(",", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    for fmt in _ADVANCE_DATE_FORMATS:
        try:
            parsed = datetime.strptime(cleaned, fmt)
            return parsed.date().isoformat()
        except ValueError:
            continue
    return None


def _best_advance_value(field_name: str, primary: Any, fallback: Any = None) -> Any:
    if not _is_missing_advance_value(field_name, primary):
        return primary
    return fallback


def _extract_india_advance_text_fields(raw_text: str) -> dict[str, Any]:
    """Fallback parser for India cashless pre-auth forms after OCR text extraction."""
    text = raw_text or ""
    if not text.strip():
        return {}

    fields: dict[str, Any] = {}
    fields["member_number"] = _first_advance_match(text, [
        r"(?:Member\s*(?:ID|No|Number)|Health\s*Card\s*(?:No|Number)|UHID|Insured\s*ID)[:\s#]+([A-Z0-9][A-Z0-9\/\-]{4,30})",
        r"(?:Policy\s*(?:No|Number)|Certificate\s*(?:No|Number))[:\s#]+([A-Z0-9][A-Z0-9\/\-]{4,35})",
        r"\b((?:IND|INS|MED|TPA|MA|UHID|MBR)[\-\/]?[A-Z0-9]{5,24})\b",
    ])
    fields["patient_name"] = _first_advance_match(text, [
        r"(?:Patient\s*Name|Name\s*of\s*Patient|Name\s*of\s*Insured\s*Person|Insured\s*Person\s*Name|Beneficiary\s*Name)[:\s]+([A-Z][A-Za-z .]{2,70})(?=\n|$)",
        r"(?:DETAILS\s+OF\s+INSURED\s+PERSON[\s\S]{0,160}?Name)[:\s]+([A-Z][A-Za-z .]{2,70})(?=\n|Gender|Age|Date)",
    ])
    fields["patient_dob"] = _normalize_advance_date(_first_advance_match(text, [
        r"(?:Date\s*of\s*Birth|DOB|D\.O\.B\.?)[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})",
        r"(?:Date\s*of\s*Birth|DOB|D\.O\.B\.?)[:\s]+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})",
    ]))
    fields["provider_name"] = _first_advance_match(text, [
        r"(?:Hospital\s*Name|Name\s*of\s*Hospital|Treating\s*Hospital|Provider\s*Name|Facility\s*Name)[:\s]+([A-Z][A-Za-z0-9 ,.&'\-]{3,90})(?=\n|$|Address|City|State|ROHINI|Reg)",
        r"(?:Name\s*of\s*Hospital\s*where\s*Admitted|Name\s*of\s*Hospital\s*where\s*Admited)[:\s]+([A-Z][A-Za-z0-9 ,.&'\-]{3,90})(?=\n|$|Address|City|State|ROHINI|Reg)",
    ])
    fields["provider_code"] = _first_advance_match(text, [
        r"(?:Provider\s*Code|Hospital\s*(?:Code|Reg(?:istration)?\s*(?:No|Number)?)|ROHINI\s*(?:ID|Code|No|Number)|NABH\s*(?:ID|No|Number))[:\s#]+([A-Z0-9][A-Z0-9\/\-]{3,30})",
        r"\b(ROHINI[-\/]?[A-Z0-9]{5,24})\b",
    ])
    fields["admission_date"] = _normalize_advance_date(_first_advance_match(text, [
        r"(?:Proposed\s*(?:Date\s*of\s*)?Admission|Expected\s*(?:Date\s*of\s*)?Admission|Admission\s*Date|Date\s*of\s*Admission|Admitted\s*On)[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})",
        r"(?:Proposed\s*(?:Date\s*of\s*)?Admission|Expected\s*(?:Date\s*of\s*)?Admission|Admission\s*Date|Date\s*of\s*Admission|Admitted\s*On)[:\s]+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})",
    ]))
    fields["discharge_date"] = _normalize_advance_date(_first_advance_match(text, [
        r"(?:Expected\s*(?:Date\s*of\s*)?Discharge|Discharge\s*Date|Date\s*of\s*Discharge|Discharged\s*On)[:\s]+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})",
        r"(?:Expected\s*(?:Date\s*of\s*)?Discharge|Discharge\s*Date|Date\s*of\s*Discharge|Discharged\s*On)[:\s]+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})",
    ]))
    fields["primary_diagnosis_code"] = _first_advance_match(text, [
        r"(?:ICD\s*(?:10)?\s*(?:Code)?|Diagnosis\s*Code|Dx\s*Code)[:\s]+([A-Z]\d{2}(?:\.\d{1,4})?)",
    ])
    fields["primary_diagnosis_desc"] = _first_advance_match(text, [
        r"(?:Provisional\s*Diagnosis|Primary\s*Diagnosis|Diagnosis|Ailment|Illness|Disease)[:\s]+([A-Za-z][A-Za-z0-9 ,()/+\-]{2,100})(?=\n|$|ICD|Treatment|Procedure|Doctor)",
        r"(?:Nature\s*of\s*Illness|Relevant\s*Clinical\s*Findings)[:\s]+([A-Za-z][A-Za-z0-9 ,()/+\-]{2,100})(?=\n|$|Treatment|Procedure|Doctor)",
    ])
    fields["treating_doctor"] = _first_advance_match(text, [
        r"(?:Treating\s*(?:Doctor|Consultant|Physician)|Doctor\s*Name|Consultant\s*Name|Name\s*of\s*Doctor)[:\s]+(Dr\.?\s*[A-Z][A-Za-z .]{2,60})(?=\n|$|Reg|Department|Speciality)",
        r"\b(Dr\.?\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\b",
    ])
    fields["estimated_total"] = _first_advance_match(text, [
        r"(?:Estimated\s*(?:Amount|Cost|Expense|Total)|Approx(?:imate)?\s*(?:Cost|Amount)|Expected\s*(?:Cost|Amount)|Total\s*Estimated\s*(?:Amount|Cost))[:\s]*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
        r"(?:Package\s*(?:Amount|Cost)|Treatment\s*(?:Cost|Amount))[:\s]*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)",
    ])
    if fields.get("estimated_total"):
        fields["estimated_total"] = str(fields["estimated_total"]).replace(",", "")
    fields["bank_account_holder"] = _first_advance_match(text, [
        r"(?:Account\s*Holder(?:'s)?\s*Name|Name\s*of\s*Account\s*Holder|Beneficiary\s*Name|Payee\s*Name)[:\s]+([A-Z][A-Za-z .]{2,70})(?=\n|$|Account|Bank|IFSC)",
    ])
    fields["bank_name"] = _first_advance_match(text, [
        r"(?:Bank\s*Name\s*(?:&\s*Branch)?|Name\s*of\s*Bank)[:\s]+([A-Z][A-Za-z .,&\-]{2,80})(?=\n|$|Branch|Account|IFSC)",
    ])
    fields["account_number"] = _first_advance_match(text, [
        r"(?:Account\s*(?:No|Number)|A/?c\s*(?:No|Number))[:\s#\.]+(\d{9,18})",
    ])
    fields["ifsc_code"] = _first_advance_match(text, [
        r"(?:IFSC\s*(?:Code)?)[:\s]+([A-Z]{4}0[A-Z0-9]{6})",
        r"\b([A-Z]{4}0[A-Z0-9]{6})\b",
    ])
    fields["upi_vpa"] = _first_advance_match(text, [
        r"(?:UPI\s*(?:ID|VPA)|VPA)[:\s]+([A-Za-z0-9.\-_]{2,60}@[A-Za-z]{2,30})",
    ])

    procedure_desc = _first_advance_match(text, [
        r"(?:Procedure|Treatment\s*Proposed|Proposed\s*Line\s*of\s*Treatment|Nature\s*of\s*Treatment|Surgery\s*Name)[:\s]+([A-Za-z][A-Za-z0-9 ,()/+\-]{2,100})(?=\n|$|Amount|Cost|Doctor)",
    ])
    if procedure_desc:
        fields["procedure_desc"] = procedure_desc

    return {key: value for key, value in fields.items() if value not in (None, "")}


def _advance_fields_from_ocr(ocr_engine: Any, ocr_result: Any) -> tuple[dict[str, Any], dict[str, float]]:
    claim_data = ocr_engine.to_claim_dict(ocr_result)
    raw_text = getattr(ocr_result, "raw_text", "") or "\n".join(
        str(page.get("text", "")) for page in (getattr(ocr_result, "page_texts", []) or []) if isinstance(page, dict)
    )
    text_fields = _extract_india_advance_text_fields(raw_text)
    line_items = claim_data.get("line_items") or []
    estimated_total = _best_advance_value("estimated_total", claim_data.get("total_billed"), text_fields.get("estimated_total"))
    if not estimated_total and line_items:
        estimated_total = sum(float(item.get("billed_amount") or 0) for item in line_items)
    if not line_items and (text_fields.get("procedure_desc") or estimated_total):
        procedure_desc = text_fields.get("procedure_desc") or text_fields.get("primary_diagnosis_desc") or "India cashless treatment"
        line_items = [{
            "line_number": 1,
            "procedure_code": "PREAUTH",
            "procedure_desc": procedure_desc,
            "service_category": "SURGERY" if re.search(r"surgery|procedure|operation", procedure_desc, re.IGNORECASE) else "OTHER",
            "billed_amount": str(estimated_total or 0),
            "units": "1",
        }]

    treating_doctor = (
        _market_specific_value(ocr_result, "treating_physician")
        or _market_specific_value(ocr_result, "doctor_name")
        or _market_specific_value(ocr_result, "physician_name")
        or text_fields.get("treating_doctor")
    )

    hospital_match = _match_india_hospital(
        _best_advance_value("provider_name", claim_data.get("provider_name"), text_fields.get("provider_name")),
        _best_advance_value("provider_code", claim_data.get("provider_code"), text_fields.get("provider_code")),
        raw_text,
    )
    location_match = None if hospital_match else _match_india_location(
        _best_advance_value("provider_name", claim_data.get("provider_name"), text_fields.get("provider_name")),
        raw_text,
    )
    diagnosis_match = _match_india_diagnosis(
        _best_advance_value("primary_diagnosis_code", claim_data.get("primary_diagnosis_code"), text_fields.get("primary_diagnosis_code")),
        _best_advance_value("primary_diagnosis_code", claim_data.get("primary_diagnosis_desc"), text_fields.get("primary_diagnosis_desc")),
        raw_text,
    )
    if not treating_doctor:
        doctor_match = _match_india_doctor(raw_text, hospital_match.get("code") if hospital_match else None)
        treating_doctor = doctor_match.get("name") if doctor_match else None

    bank_match = _match_india_bank(
        _best_advance_value("bank_name", claim_data.get("bank_name"), text_fields.get("bank_name")),
        _best_advance_value("ifsc_code", claim_data.get("ifsc_code"), text_fields.get("ifsc_code")),
        _best_advance_value("upi_vpa", claim_data.get("upi_vpa"), text_fields.get("upi_vpa")),
        raw_text,
    )

    fields = {
        "claim_type": claim_data.get("claim_type") if claim_data.get("claim_type") in {"INPATIENT", "DAYCARE", "MATERNITY"} else "INPATIENT",
        "market_region": "INDIA",
        "currency": "INR",
        "member_number": _best_advance_value("member_number", claim_data.get("member_number"), text_fields.get("member_number")),
        "patient_name": _best_advance_value("patient_name", claim_data.get("patient_name"), text_fields.get("patient_name")),
        "patient_dob": _best_advance_value("patient_dob", claim_data.get("patient_dob"), text_fields.get("patient_dob")),
        "provider_code": hospital_match.get("code") if hospital_match else _best_advance_value("provider_code", claim_data.get("provider_code"), text_fields.get("provider_code")),
        "provider_name": hospital_match.get("name") if hospital_match else _best_advance_value("provider_name", claim_data.get("provider_name"), text_fields.get("provider_name")),
        "provider_state": hospital_match.get("state") if hospital_match else (location_match or {}).get("state"),
        "provider_city": hospital_match.get("city") if hospital_match else (location_match or {}).get("city"),
        "admission_date": _best_advance_value("admission_date", claim_data.get("admission_date") or claim_data.get("service_date"), text_fields.get("admission_date")),
        "discharge_date": _best_advance_value("discharge_date", claim_data.get("discharge_date"), text_fields.get("discharge_date")),
        "primary_diagnosis_code": diagnosis_match.get("code") if diagnosis_match else claim_data.get("primary_diagnosis_code"),
        "primary_diagnosis_desc": diagnosis_match.get("desc") if diagnosis_match else _best_advance_value("primary_diagnosis_desc", claim_data.get("primary_diagnosis_desc"), text_fields.get("primary_diagnosis_desc")),
        "treating_doctor": treating_doctor,
        "estimated_total": str(estimated_total) if estimated_total is not None else None,
        "line_items": line_items,
        "bank_account_holder": _best_advance_value("bank_account_holder", claim_data.get("bank_account_holder"), text_fields.get("bank_account_holder")),
        "account_holder_name": _best_advance_value("bank_account_holder", claim_data.get("bank_account_holder"), text_fields.get("bank_account_holder")),
        "bank_name": bank_match.get("name") if bank_match else _best_advance_value("bank_name", claim_data.get("bank_name"), text_fields.get("bank_name")),
        "account_number": _best_advance_value("account_number", claim_data.get("account_number"), text_fields.get("account_number")),
        "ifsc_code": _best_advance_value("ifsc_code", claim_data.get("ifsc_code"), text_fields.get("ifsc_code")),
        "upi_vpa": _best_advance_value("upi_vpa", claim_data.get("upi_vpa"), text_fields.get("upi_vpa")),
    }

    confidence_fields = [
        "member_number",
        "patient_name",
        "patient_dob",
        "provider_code",
        "provider_name",
        "admission_date",
        "primary_diagnosis_code",
        "total_billed",
        "bank_account_holder",
        "bank_name",
        "account_number",
        "ifsc_code",
        "upi_vpa",
    ]
    confidences = {field: _field_confidence(ocr_result, field) for field in confidence_fields}
    if hospital_match:
        confidences["provider_code"] = max(confidences.get("provider_code", 0), 0.9)
        confidences["provider_name"] = max(confidences.get("provider_name", 0), 0.9)
    if diagnosis_match:
        confidences["primary_diagnosis_code"] = max(confidences.get("primary_diagnosis_code", 0), 0.86)
    if bank_match:
        confidences["bank_name"] = max(confidences.get("bank_name", 0), 0.82)
    if treating_doctor:
        confidences["treating_doctor"] = max(
            confidences.get("treating_doctor", 0),
            float((_market_specific_value(ocr_result, "treating_physician") and 0.85) or (text_fields.get("treating_doctor") and 0.8) or 0.78),
        )
    for field_name in text_fields:
        if field_name in fields and not _is_missing_advance_value(field_name, fields.get(field_name)):
            confidences[field_name] = max(confidences.get(field_name, 0), 0.74)

    return fields, confidences


class BulkDecisionRequest(BaseModel):
    claim_ids: list[str] = Field(min_length=1, max_length=100)
    decision: str
    preauth_letter_url: Optional[str] = None
    needs_hntl: bool = False
    hitl_deadline: Optional[datetime] = None
    date_created: datetime
    date_decision: Optional[datetime] = None
    supporting_docs: Optional[list[str]] = None
    fwa_anomaly_score: Optional[Decimal] = None
    irdai_violations: Optional[list[str] | str] = None
    abha_address: Optional[str] = None
    consent_verified: Optional[bool] = None
    fhir_resource_id: Optional[str] = None


class BulkDecisionRequest(BaseModel):
    claim_ids: list[str] = Field(min_length=1, max_length=100)
    decision: str
    model_config = ConfigDict(from_attributes=True)


class AdvanceClaimListResponse(BaseModel):
    claims: list[AdvanceClaimResponse]
    total: int
    page: int = 1
    page_size: int = 20


class PreAuthDecision(BaseModel):
    decision: str  # APPROVE, APPROVE_PARTIAL, REJECT, REQUEST_INFO
    coverage_percentage: Optional[int] = None
    estimated_plan_payment: Optional[Decimal] = None
    notes: str
    reviewer_notes: Optional[str] = None


def _generate_advance_claim_reference() -> str:
    """Generate a compact, human-readable reference for pre-auth registrations."""
    return f"ADV-{datetime.now(timezone.utc).replace(tzinfo=None):%Y%m%d}-{uuid.uuid4().hex[:8].upper()}"


def _advance_response_from_record(record: dict) -> AdvanceClaimResponse:
    response_status = record.get("advance_status")
    if not response_status:
        response_status = "PENDING_REVIEW" if record.get("preauth_reference") else record.get("status", "PENDING_REVIEW")

    # Handle supporting_docs which might be a JSON list
    raw_docs = record.get("supporting_docs")
    supporting_docs = None
    if isinstance(raw_docs, list):
        supporting_docs = raw_docs
    elif isinstance(raw_docs, str):
        try:
            supporting_docs = json.loads(raw_docs)
        except:
            supporting_docs = [raw_docs]

    return AdvanceClaimResponse(
        id=str(record.get("advance_id") or record["id"]),
        claim_reference=record["claim_reference"],
        preauth_reference=record.get("preauth_reference", ""),
        status=response_status,
        preauth_status=record.get("preauth_status", "PENDING_HITL"),
        coverage_decision=record.get("coverage_decision", "PENDING"),
        estimated_coverage=Decimal(str(record["estimated_coverage"])) if record.get("estimated_coverage") is not None else None,
        estimated_member_responsibility=Decimal(str(record["estimated_member_responsibility"])) if record.get("estimated_member_responsibility") is not None else None,
        estimated_plan_payment=Decimal(str(record["estimated_plan_payment"])) if record.get("estimated_plan_payment") is not None else None,
        estimated_deductible_applied=Decimal(str(record["estimated_deductible_applied"])) if record.get("estimated_deductible_applied") is not None else None,
        estimated_copay=Decimal(str(record["estimated_copay"])) if record.get("estimated_copay") is not None else None,
        confidence_score=Decimal(str(record["confidence_score"])) if record.get("confidence_score") is not None else None,
        preauth_letter_url=record.get("preauth_letter_url"),
        needs_hntl=bool(record.get("needs_hntl", True)),
        hitl_deadline=record.get("hitl_deadline"),
        date_created=record.get("date_created") if isinstance(record.get("date_created"), datetime) else datetime.fromisoformat(str(record.get("date_created")).replace("Z", "+00:00")),
        date_decision=record.get("date_decision") if isinstance(record.get("date_decision"), datetime) else (
            datetime.fromisoformat(str(record.get("date_decision")).replace("Z", "+00:00")) if record.get("date_decision") else None
        ),
        supporting_docs=supporting_docs,
        abha_address=record.get("abha_address"),
        consent_verified=record.get("consent_verified"),
        fwa_anomaly_score=Decimal(str(record["fwa_anomaly_score"])) if record.get("fwa_anomaly_score") is not None else None,
        irdai_violations=record.get("irdai_violations"),
        fhir_resource_id=record.get("fhir_resource_id"),
        bpmn_process_instance_id=record.get("bpmn_process_instance_id"),
    )


def _persist_advance_claim(record: dict) -> bool:
    """Persist advance claim into the canonical claims registry and advance registry."""
    if not _refresh_db_availability():
        return False

    try:
        from sqlalchemy import text

        get_sync_session = _get_sync_session()
        if get_sync_session is None:
            return False

        with get_sync_session() as db:
            db.execute(
                text("""
                    INSERT INTO claims (
                        id, claim_reference, status, claim_type, market_region, currency,
                        tenant_id, trace_id, member_number, patient_name, patient_dob,
                        provider_name, provider_code, network_tier,
                        service_date, admission_date, discharge_date,
                        primary_diagnosis_code, primary_diagnosis_desc,
                        secondary_diagnosis_codes, total_billed, total_allowed,
                        total_settlement, total_member_responsibility,
                        preauth_number, preauth_approved, confidence_score,
                        processing_time_ms, source_channel
                    ) VALUES (
                        CAST(:id AS uuid), :claim_reference, CAST(:claim_status AS claim_status),
                        CAST(:claim_type AS claim_type), CAST(:market_region AS market_region),
                        CAST(:currency AS currency), :tenant_id, :trace_id,
                        :member_number, :patient_name, CAST(:patient_dob AS date),
                        :provider_name, :provider_code, CAST(:network_tier AS network_tier),
                        CAST(:service_date AS date), CAST(:admission_date AS date), CAST(:discharge_date AS date),
                        :primary_diagnosis_code, :primary_diagnosis_desc,
                        CAST(:secondary_diagnosis_codes AS jsonb), :total_billed, :total_allowed,
                        :total_settlement, :total_member_responsibility,
                        :preauth_number, :preauth_approved, :confidence_score,
                        :processing_time_ms, :source_channel
                    )
                    ON CONFLICT (claim_reference) DO UPDATE SET
                        status = EXCLUDED.status,
                        total_billed = EXCLUDED.total_billed,
                        total_allowed = EXCLUDED.total_allowed,
                        total_settlement = EXCLUDED.total_settlement,
                        total_member_responsibility = EXCLUDED.total_member_responsibility,
                        preauth_number = EXCLUDED.preauth_number,
                        preauth_approved = EXCLUDED.preauth_approved,
                        confidence_score = EXCLUDED.confidence_score,
                        updated_at = NOW()
                """),
                {
                    "id": record["id"],
                    "claim_reference": record["claim_reference"],
                    "claim_status": record.get("status", "HITL_PENDING"),
                    "claim_type": record["claim_type"],
                    "market_region": record["market_region"],
                    "currency": record["currency"],
                    "tenant_id": record.get("tenant_id", "default"),
                    "trace_id": record.get("trace_id"),
                    "member_number": record["member_number"],
                    "patient_name": record["patient_name"],
                    "patient_dob": record["patient_dob"],
                    "provider_name": record["provider_name"],
                    "provider_code": record["provider_code"],
                    "network_tier": record.get("network_tier", "NETWORK"),
                    "service_date": record["service_date"],
                    "admission_date": record.get("admission_date"),
                    "discharge_date": record.get("discharge_date"),
                    "primary_diagnosis_code": record["primary_diagnosis_code"],
                    "primary_diagnosis_desc": record.get("primary_diagnosis_desc"),
                    "secondary_diagnosis_codes": json.dumps(record.get("secondary_diagnosis_codes")) if record.get("secondary_diagnosis_codes") else None,
                    "total_billed": record["total_billed"],
                    "total_allowed": record.get("estimated_coverage"),
                    "total_settlement": record.get("estimated_plan_payment"),
                    "total_member_responsibility": record.get("estimated_member_responsibility"),
                    "preauth_number": record["preauth_reference"],
                    "preauth_approved": record.get("preauth_approved"),
                    "confidence_score": record.get("confidence_score"),
                    "processing_time_ms": None,
                    "source_channel": record.get("source_channel", "PRE_AUTH_REGISTRY"),
                },
            )
            db.execute(
                text("""
                    INSERT INTO advance_claims (
                        id, claim_id, claim_reference, preauth_reference, preauth_status,
                        coverage_decision, estimated_coverage, estimated_member_responsibility,
                        estimated_plan_payment, estimated_deductible_applied, estimated_copay,
                        confidence_score, treating_doctor, treating_hospital_reg,
                        supporting_docs, is_emergency, is_cashless, needs_hntl,
                        hitl_deadline, preauth_letter_url, date_created, date_decision,
                        created_by
                    ) VALUES (
                        CAST(:advance_id AS uuid), CAST(:claim_id AS uuid), :claim_reference,
                        :preauth_reference, :preauth_status, :coverage_decision,
                        :estimated_coverage, :estimated_member_responsibility,
                        :estimated_plan_payment, :estimated_deductible_applied, :estimated_copay,
                        :confidence_score, :treating_doctor, :treating_hospital_reg,
                        CAST(:supporting_docs AS jsonb), :is_emergency, :is_cashless,
                        :needs_hntl, :hitl_deadline, :preauth_letter_url,
                        :date_created, :date_decision, :created_by
                    )
                    ON CONFLICT (claim_reference) DO UPDATE SET
                        preauth_status = EXCLUDED.preauth_status,
                        coverage_decision = EXCLUDED.coverage_decision,
                        estimated_plan_payment = EXCLUDED.estimated_plan_payment,
                        estimated_member_responsibility = EXCLUDED.estimated_member_responsibility,
                        needs_hntl = EXCLUDED.needs_hntl,
                        date_decision = EXCLUDED.date_decision,
                        updated_at = NOW()
                """),
                {
                    "advance_id": record["advance_id"],
                    "claim_id": record["id"],
                    "claim_reference": record["claim_reference"],
                    "preauth_reference": record["preauth_reference"],
                    "preauth_status": record["preauth_status"],
                    "coverage_decision": record["coverage_decision"],
                    "estimated_coverage": record.get("estimated_coverage"),
                    "estimated_member_responsibility": record.get("estimated_member_responsibility"),
                    "estimated_plan_payment": record.get("estimated_plan_payment"),
                    "estimated_deductible_applied": record.get("estimated_deductible_applied"),
                    "estimated_copay": record.get("estimated_copay"),
                    "confidence_score": record.get("confidence_score"),
                    "treating_doctor": record["treating_doctor"],
                    "treating_hospital_reg": record.get("treating_hospital_reg"),
                    "supporting_docs": json.dumps(record.get("supporting_docs")) if record.get("supporting_docs") else None,
                    "is_emergency": record.get("is_emergency", False),
                    "is_cashless": True,
                    "needs_hntl": record.get("needs_hntl", True),
                    "hitl_deadline": record.get("hitl_deadline"),
                    "preauth_letter_url": record.get("preauth_letter_url"),
                    "date_created": record["date_created"],
                    "date_decision": record.get("date_decision"),
                    "created_by": record.get("actor_id"),
                },
            )
            if record.get("line_items") is not None:
                db.execute(
                    text("DELETE FROM claim_line_items WHERE claim_id = CAST(:claim_id AS uuid)"),
                    {"claim_id": record["id"]},
                )
                for line in record.get("line_items", []):
                    db.execute(
                        text("""
                            INSERT INTO claim_line_items (
                                claim_id, line_number, procedure_code, procedure_desc,
                                service_category, billed_amount, units, days,
                                modifier_codes, diagnosis_pointers
                            ) VALUES (
                                CAST(:claim_id AS uuid), :line_number, :procedure_code,
                                :procedure_desc, :service_category, :billed_amount,
                                :units, :days, CAST(:modifier_codes AS jsonb),
                                CAST(:diagnosis_pointers AS jsonb)
                            )
                        """),
                        {
                            "claim_id": record["id"],
                            "line_number": line.get("line_number", 1),
                            "procedure_code": line.get("procedure_code", ""),
                            "procedure_desc": line.get("procedure_desc"),
                            "service_category": line.get("service_category"),
                            "billed_amount": line.get("billed_amount", 0),
                            "units": line.get("units", 1),
                            "days": line.get("days"),
                            "modifier_codes": json.dumps(line.get("modifier_codes")) if line.get("modifier_codes") else None,
                            "diagnosis_pointers": json.dumps(line.get("diagnosis_pointers") or [1]),
                        },
                    )
            db.commit()
        return True
    except Exception as exc:
        logger.error("Failed to persist advance claim %s: %s", record.get("claim_reference"), exc, exc_info=True)
        return False


def _load_advance_claims_from_db(actor_id: str, skip: int = 0, limit: int = 20) -> tuple[list[dict], int]:
    if not _refresh_db_availability():
        return [], 0

    try:
        from sqlalchemy import text

        get_sync_session = _get_sync_session()
        if get_sync_session is None:
            return [], 0

        with get_sync_session() as db:
            total = db.execute(
                text("SELECT COUNT(*) FROM advance_claims WHERE created_by = :actor_id"),
                {"actor_id": actor_id},
            ).scalar() or 0
            rows = db.execute(
                text("""
                    SELECT
                        ac.id, ac.claim_reference, ac.preauth_reference,
                        c.status AS claim_status, ac.preauth_status,
                        ac.coverage_decision, ac.estimated_coverage,
                        ac.estimated_member_responsibility, ac.estimated_plan_payment,
                        ac.estimated_deductible_applied, ac.estimated_copay,
                        ac.confidence_score, ac.preauth_letter_url, ac.needs_hntl,
                        ac.hitl_deadline, ac.date_created, ac.date_decision
                    FROM advance_claims ac
                    JOIN claims c ON c.id = ac.claim_id
                    WHERE ac.created_by = :actor_id
                    ORDER BY ac.date_created DESC
                    OFFSET :skip LIMIT :limit
                """),
                {"actor_id": actor_id, "skip": skip, "limit": limit},
            ).fetchall()
        records = []
        for row in rows:
            item = dict(row._mapping)
            item["status"] = "PENDING_REVIEW" if str(item.get("claim_status")) == "HITL_PENDING" else str(item.get("claim_status"))
            records.append(item)
        return records, int(total)
    except Exception as exc:
        logger.error("Failed to load advance claims: %s", exc, exc_info=True)
        return [], 0


def _find_advance_claim_in_store(reference: str) -> Optional[dict]:
    claim_record = claims_store.get(reference)
    if claim_record and claim_record.get("is_advance_claim"):
        return claim_record

    for item in claims_store.values():
        if item.get("is_advance_claim") and item.get("preauth_reference") == reference:
            return item
    return None


def _load_advance_claim_from_db(reference: str, actor_id: Optional[str] = None) -> Optional[dict]:
    if not _refresh_db_availability():
        return None

    try:
        from sqlalchemy import text

        get_sync_session = _get_sync_session()
        if get_sync_session is None:
            return None

        query = """
            SELECT
                c.id AS claim_id,
                ac.id AS advance_id,
                ac.claim_reference,
                ac.preauth_reference,
                c.status AS claim_status,
                ac.preauth_status,
                ac.coverage_decision,
                ac.estimated_coverage,
                ac.estimated_member_responsibility,
                ac.estimated_plan_payment,
                ac.estimated_deductible_applied,
                ac.estimated_copay,
                ac.confidence_score,
                ac.treating_doctor,
                ac.treating_hospital_reg,
                ac.supporting_docs,
                ac.is_emergency,
                ac.is_cashless,
                ac.needs_hntl,
                ac.hitl_deadline,
                ac.preauth_letter_url,
                ac.date_created,
                ac.date_decision,
                ac.created_by,
                c.claim_type,
                c.market_region,
                c.currency,
                c.tenant_id,
                c.trace_id,
                c.member_number,
                c.patient_name,
                c.patient_dob,
                c.provider_name,
                c.provider_code,
                c.network_tier,
                c.service_date,
                c.admission_date,
                c.discharge_date,
                c.primary_diagnosis_code,
                c.primary_diagnosis_desc,
                c.secondary_diagnosis_codes,
                c.total_billed,
                c.source_channel
            FROM advance_claims ac
            JOIN claims c ON c.id = ac.claim_id
            WHERE (ac.claim_reference = :reference OR ac.preauth_reference = :reference)
        """
        params: dict[str, object] = {"reference": reference}
        if actor_id:
            query += " AND ac.created_by = :actor_id"
            params["actor_id"] = actor_id
        query += " LIMIT 1"

        with get_sync_session() as db:
            row = db.execute(text(query), params).fetchone()

        if not row:
            return None

        item = dict(row._mapping)
        supporting_docs = item.get("supporting_docs")
        if isinstance(supporting_docs, str):
            try:
                item["supporting_docs"] = json.loads(supporting_docs)
            except Exception:
                item["supporting_docs"] = [supporting_docs]

        secondary_diagnosis_codes = item.get("secondary_diagnosis_codes")
        if isinstance(secondary_diagnosis_codes, str):
            try:
                item["secondary_diagnosis_codes"] = json.loads(secondary_diagnosis_codes)
            except Exception:
                item["secondary_diagnosis_codes"] = [secondary_diagnosis_codes]

        item["id"] = str(item["claim_id"])
        item["advance_status"] = item.get("preauth_status") or (
            "PENDING_REVIEW" if str(item.get("claim_status")) == "HITL_PENDING" else str(item.get("claim_status"))
        )
        item["status"] = str(item.get("claim_status") or "HITL_PENDING")
        item["actor_id"] = item.get("created_by")
        item["is_advance_claim"] = True
        return item
    except Exception as exc:
        logger.error("Failed to load advance claim %s: %s", reference, exc, exc_info=True)
        return None


def _map_advance_claim_decision(decision: str) -> dict[str, object]:
    decision_key = decision.upper()
    if decision_key == "APPROVE":
        return {
            "preauth_status": "APPROVED",
            "coverage_decision": "APPROVE",
            "status": "ADJUDICATED",
            "advance_status": "APPROVED",
            "needs_hntl": False,
            "preauth_approved": True,
        }
    if decision_key == "APPROVE_PARTIAL":
        return {
            "preauth_status": "APPROVED_PARTIAL",
            "coverage_decision": "APPROVE_PARTIAL",
            "status": "ADJUDICATED",
            "advance_status": "APPROVED_PARTIAL",
            "needs_hntl": False,
            "preauth_approved": True,
        }
    if decision_key == "REJECT":
        return {
            "preauth_status": "REJECTED",
            "coverage_decision": "REJECT",
            "status": "DENIED",
            "advance_status": "REJECTED",
            "needs_hntl": False,
            "preauth_approved": False,
        }
    if decision_key == "REQUEST_INFO":
        return {
            "preauth_status": "INFO_REQUESTED",
            "coverage_decision": "REQUEST_INFO",
            "status": "HITL_PENDING",
            "advance_status": "INFO_REQUESTED",
            "needs_hntl": True,
            "preauth_approved": None,
        }
    raise HTTPException(status_code=422, detail="Unsupported pre-authorization decision")


def _resolve_advance_plan_payment(record: dict, decision: PreAuthDecision) -> Optional[Decimal]:
    if decision.estimated_plan_payment is not None:
        return Decimal(str(decision.estimated_plan_payment))

    if decision.coverage_percentage is None:
        existing_amount = record.get("estimated_plan_payment")
        return Decimal(str(existing_amount)) if existing_amount is not None else None

    total_billed = record.get("total_billed")
    if total_billed is None:
        return None

    billed_decimal = Decimal(str(total_billed))
    percentage = Decimal(str(decision.coverage_percentage)) / Decimal("100")
    return (billed_decimal * percentage).quantize(Decimal("0.01"))


# CLAIMS — PDF UPLOAD
# ═══════════════════════════════════════════

@app.post("/api/v1/claims/upload", tags=["Claims"], status_code=201)
@limiter.limit(LIMIT_ADJUDICATION)
async def upload_claim_pdf(
    request: Request,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
    file: UploadFile = File(..., description="PDF claim document"),
    member_number: str = Form(None, description="Override member number (if not in PDF)"),
    provider_code: str = Form(None, description="Override provider code (if not in PDF)"),
    market_region: str = Form("UAE", description="Market region: UAE, INDIA, KSA"),
    confirm_duplicate: bool = Form(False, description="Set true to proceed despite duplicate document detection"),
):
    """
    Submit a PDF claim document for OCR extraction and AI-powered adjudication.
    Returns a StreamingResponse (SSE) with real-time progress updates.
    """
    async def event_generator():
        q = asyncio.Queue()

        def on_progress(data: dict):
            # Safe way to put in queue from sync thread
            loop.call_soon_threadsafe(q.put_nowait, data)

        async def run_logic():
            try:
                # ── Step 1: Initial Processing ──
                on_progress({"step": "INIT", "status": "COMPLETED", "message": "Analyzing document structure...", "progress": 5})
                
                SUPPORTED_EXTENSIONS = (".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif")
                fname_lower = (file.filename or "").lower()
                if not file.filename or not any(fname_lower.endswith(ext) for ext in SUPPORTED_EXTENSIONS):
                    raise HTTPException(status_code=400, detail=f"Unsupported file format.")

                raw_bytes = await file.read()
                if not raw_bytes:
                    raise HTTPException(status_code=400, detail="Empty file uploaded")

                # ── Auto-convert images to PDF ──
                _is_image = any(fname_lower.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".tiff", ".tif"))
                pdf_bytes = raw_bytes
                if _is_image:
                    try:
                        from PIL import Image
                        img = Image.open(io.BytesIO(raw_bytes))
                        if img.mode in ("RGBA", "P"): img = img.convert("RGB")
                        pdf_buffer = io.BytesIO()
                        img.save(pdf_buffer, format="PDF", resolution=300.0)
                        pdf_bytes = pdf_buffer.getvalue()
                    except Exception as e:
                        raise HTTPException(status_code=400, detail=f"Image conversion failed: {str(e)}")
                elif not pdf_bytes.startswith(b"%PDF"):
                    raise HTTPException(status_code=400, detail="Invalid PDF header")

                on_progress({"step": "UPLOAD", "status": "COMPLETED", "message": "File prepared for extraction", "progress": 15})

                # ── PDF Validation ──
                from services.ocr_service.app.pdf_validator import PDFValidator
                validator = PDFValidator()
                validation_result = validator.validate(pdf_bytes, file.filename, market_region=market_region)
                if not validation_result.is_valid:
                    raise HTTPException(status_code=400, detail=validation_result.error_message)

                on_progress({"step": "VALIDATION", "status": "COMPLETED", "message": "Document integrity verified", "progress": 25})

                # ── Duplicate Detection ──
                # Always look up by hash, even when confirm_duplicate=True — the
                # lookup result (_dup) is needed below to correctly mark the new
                # claim as is_duplicate/duplicate_of_ref once the user proceeds
                # anyway. Previously this only ran when NOT confirmed, so a
                # confirmed-duplicate claim never got flagged as one at all.
                _pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
                _dup = _find_duplicate_by_hash(_pdf_hash)
                if _dup:
                    if not confirm_duplicate:
                        # For duplicates in stream, we yield a special event
                        on_progress({
                            "step": "DUPLICATE_DETECTED",
                            "status": "STOPPED",
                            "message": "Potential duplicate detected",
                            "details": {
                                "claim_reference": _dup["claim_reference"],
                                "status": _dup["status"],
                                "date_received": str(_dup["date_received"])
                            }
                        })
                        # Still raise to exit the logic
                        raise HTTPException(status_code=409, detail="DUPLICATE_DOCUMENT")

                # ── OCR Extraction ──
                ocr_engine = _get_ocr_engine()
                if ocr_engine is None: raise HTTPException(status_code=503, detail="OCR service unavailable")

                on_progress({"step": "OCR", "status": "PROCESSING", "message": "AI extracting claim fields...", "progress": 35})
                ocr_result = ocr_engine.extract_from_bytes(pdf_bytes, filename=file.filename)
                claim_data = ocr_engine.to_claim_dict(ocr_result)
                claim_data.update({
                    "tenant_id": current_user.tenant_id,
                    "trace_id": getattr(request.state, "trace_id", request.state.request_id),
                    "request_id": request.state.request_id
                })

                # Apply overrides
                if member_number: claim_data["member_number"] = member_number
                if provider_code: claim_data["provider_code"] = provider_code

                # A duplicate was found but the caller passed confirm_duplicate=True
                # to proceed anyway — mark the new claim so the pipeline's existing
                # duplicate-aware audit trail / enhanced-scrutiny logic (see
                # pipeline.py's "DUPLICATE_CLAIM_DETECTED" trail entry) actually
                # fires, and so GET /claims/{ref} reports is_duplicate accurately.
                if _dup:
                    claim_data["is_duplicate"] = True
                    claim_data["duplicate_of_ref"] = _dup["claim_reference"]
                    claim_data["duplicate_orig_status"] = _dup["status"]
                    claim_data["duplicate_orig_rejection"] = _dup["rejection_reason"]
                    claim_data["duplicate_orig_date"] = str(_dup["date_received"])

                on_progress({"step": "OCR", "status": "COMPLETED", "message": "Field extraction complete", "progress": 50})

                # ── Adjudication ──
                on_progress({"step": "ADJUDICATION", "status": "PROCESSING", "message": "Running multi-agent reasoning...", "progress": 60})

                _claim_ref = (
                    f"CLM-{claim_data['market_region']}-"
                    f"{datetime.now(timezone.utc).replace(tzinfo=None).strftime('%Y')}-"
                    f"{uuid.uuid4().hex[:8].upper()}"
                )
                claim_data["claim_reference"] = _claim_ref
                _storage_path = _save_claim_pdf(pdf_bytes, _claim_ref, file.filename, "received")
                
                _ocr_telemetry = {
                    "original_filename": file.filename,
                    "file_size_bytes": len(pdf_bytes),
                    "document_hash": _pdf_hash,
                    "storage_path": _storage_path,
                    "overall_confidence": getattr(ocr_result, "overall_confidence", None),
                    "page_count": getattr(ocr_result, "page_count", None),
                }

                # Run sync adjudicate in threadpool but with our on_progress callback
                db_session = None
                try:
                    from shared.db_sync import get_sync_db
                    db_session = get_sync_db()
                    
                    # We pass the on_progress wrapper that pushes to our async queue
                    result = await run_in_threadpool(
                        pipeline.adjudicate, 
                        claim_data, 
                        db_session=db_session, 
                        ocr_meta=_ocr_telemetry,
                        on_progress=on_progress
                    )
                    _capture_claim_account(
                        db_session,
                        claim_data,
                        claim_reference=result.get("claim_reference", _pdf_hash[:16]),
                        current_user=current_user,
                        capture_source="OCR_AUTO",
                    )
                finally:
                    if db_session: db_session.close()

                # Store result in memory so subsequent GET requests hit claims_store
                # (not the DB fallback which returns stripped data without line items)
                _claim_ref = result.get("claim_reference", _pdf_hash[:16])
                claims_store[_claim_ref] = result

                # ── Completed ──
                on_progress({
                    "step": "COMPLETED",
                    "status": "done",
                    "message": "Adjudication finalized",
                    "progress": 100,
                    "result": result
                })

            except HTTPException as e:
                on_progress({"step": "ERROR", "status": "FAILED", "message": str(e.detail), "progress": 0})
            except Exception as e:
                logger.error("Upload stream error: %s", e, exc_info=True)
                on_progress({"step": "ERROR", "status": "FAILED", "message": "Internal server error", "progress": 0})
            finally:
                # Signal the generator to stop
                on_progress({"step": "EOF", "status": "done", "message": "Stream finished", "progress": 100})

        loop = asyncio.get_running_loop()
        asyncio.create_task(run_logic())

        while True:
            msg = await q.get()
            if msg.get("step") == "EOF":
                break
            yield f"data: {json.dumps(msg)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ═══════════════════════════════════════════
# CLAIMS — JSON SUBMISSION
# ═══════════════════════════════════════════

@app.post("/api/v1/claims", tags=["Claims"], status_code=201)
@limiter.limit(LIMIT_ADJUDICATION)
async def submit_claim(
    request: Request,
    claim: ClaimCreate,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """
    Submit a health insurance claim (structured JSON) for rules-first adjudication.

    The engine will:
    1. Validate member eligibility
    2. Evaluate policy rules (exclusions, waiting periods, sub-limits)
    3. Run advisory LLM analysis only for complex, ambiguous, or reviewer-forced cases
    4. Calculate settlement (GCC copay model or India proportionate deduction)
    5. Route to HITL if confidence < threshold or high-value
    6. Return full settlement breakdown with audit trail and policy citations
    """
    claim_dict = claim.model_dump()
    claim_dict["tenant_id"] = current_user.tenant_id
    claim_dict["trace_id"] = getattr(request.state, "trace_id", request.state.request_id)
    claim_dict["request_id"] = request.state.request_id
    for key in ["service_date", "admission_date", "discharge_date", "patient_dob"]:
        if claim_dict.get(key):
            claim_dict[key] = str(claim_dict[key])
    for li in claim_dict.get("line_items", []):
        li["billed_amount"] = float(li["billed_amount"])

    # ── Duplicate JSON Claim Detection ──────────────────────────────────────
    # Detect semantically equivalent claims: same member + service_date +
    # provider_code + billed amount within ±5%.  Returns same shape as the
    # PDF-upload duplicate detector so clients can handle both consistently.
    _json_dup = _find_duplicate_json_claim(
        member_number=claim_dict.get("member_number", ""),
        service_date=str(claim_dict.get("service_date", "")),
        provider_code=claim_dict.get("provider_code", ""),
        total_billed=float(
            sum(float(li.get("billed_amount") or 0) for li in claim_dict.get("line_items", []))
            or float(claim_dict.get("total_billed") or 0)
        ),
    )
    if _json_dup:
        _dup_date = _json_dup.get("date_received", "")
        _dup_date_str = (
            _dup_date.strftime("%Y-%m-%dT%H:%M:%S")
            if hasattr(_dup_date, "strftime")
            else str(_dup_date)[:19]
        )
        logger.info(
            "[JSON-DUPLICATE-DETECT] Duplicate detected: member=%s svc=%s provider=%s → original=%s (status=%s)",
            claim_dict.get("member_number"), claim_dict.get("service_date"),
            claim_dict.get("provider_code"), _json_dup["claim_reference"], _json_dup["status"],
        )
        raise HTTPException(
            status_code=409,
            detail={
                "detail":          "Duplicate claim detected",
                "duplicate_of":    _json_dup["claim_reference"],
                "original_status": _json_dup["status"],
                "original_date":   _dup_date_str,
            },
        )

    idempotency_key = get_idempotency_key(request.headers)
    idempotency_scope = None
    if idempotency_key:
        idempotency_scope = build_scope(request.url.path, current_user.get("email"))
        claim_dict["idempotency_key"] = idempotency_key
        try:
            replay = _with_sync_session(
                lambda db: reserve_idempotency_key(
                    db,
                    idempotency_key=idempotency_key,
                    scope=idempotency_scope,
                    request_fingerprint=build_request_fingerprint(claim_dict),
                    request_id=request.state.request_id,
                )
            )
        except IdempotencyConflictError as exc:
            raise HTTPException(status_code=409, detail=exc.detail)

        if replay is not None:
            return JSONResponse(
                status_code=replay.response_status_code,
                content=replay.response_payload,
                headers={"X-Idempotent-Replay": "true"},
            )

    # Acquire DB session if available
    db_session = None
    try:
        from shared.db_sync import get_sync_db
        db_session = get_sync_db()
    except Exception as e:
        logger.warning("DB session acquisition failed: %s", e)

    try:
        # Check if async processing is enabled
        _cfg = config_store.load()
        if _cfg.get("async_processing_enabled", True):
            # Async path: LLM and settlement run in parallel
            result = await pipeline.adjudicate_async(claim_dict, db_session=db_session)
        else:
            # Sync path: sequential processing (backward compatible)
            result = pipeline.adjudicate(claim_dict, db_session=db_session)
    except Exception as exc:
        _with_sync_session(
            lambda db: record_dead_letter(
                db,
                claim_reference=claim_dict.get("claim_reference"),
                request_id=request.state.request_id,
                idempotency_key=idempotency_key,
                source_endpoint=request.url.path,
                source_channel=claim_dict.get("source_channel", "API"),
                failure_stage="ADJUDICATION",
                error_type=type(exc).__name__,
                error_message=str(exc),
                payload=claim_dict,
                actor_id=current_user.get("email"),
            )
        )
        if idempotency_key and idempotency_scope:
            _with_sync_session(
                lambda db: fail_idempotency_key(
                    db,
                    idempotency_key=idempotency_key,
                    scope=idempotency_scope,
                    error_payload={"error_type": type(exc).__name__, "message": str(exc)},
                )
            )
        if db_session:
            try:
                db_session.rollback()
            except Exception:
                pass
        raise
    finally:
        if db_session:
            try:
                db_session.close()
            except Exception:
                pass

    if result.get("status") == "ERROR":
        error_payload = {
            "error": result.get("error_code"),
            "message": result.get("error_message"),
            "claim_reference": result.get("claim_reference"),
        }
        _with_sync_session(
            lambda db: record_dead_letter(
                db,
                claim_reference=result.get("claim_reference"),
                request_id=request.state.request_id,
                idempotency_key=idempotency_key,
                source_endpoint=request.url.path,
                source_channel=claim_dict.get("source_channel", "API"),
                failure_stage="PIPELINE_RESULT",
                error_type=result.get("error_code", "PIPELINE_ERROR"),
                error_message=result.get("error_message", "Claim adjudication failed"),
                payload=claim_dict,
                actor_id=current_user.get("email"),
            )
        )
        if idempotency_key and idempotency_scope:
            _with_sync_session(
                lambda db: complete_idempotency_key(
                    db,
                    idempotency_key=idempotency_key,
                    scope=idempotency_scope,
                    response_payload=jsonable_encoder(error_payload),
                    response_status_code=400,
                    claim_reference=result.get("claim_reference"),
                )
            )
        raise HTTPException(status_code=400, detail=error_payload)

    # ── Fix 3: track whether this claim was persisted to DB ─────────────────
    # pipeline.adjudicate() / adjudicate_async() writes to DB when db_session is
    # available.  Flag the claim so operators know which entries exist only in
    # memory and need manual reconciliation if the DB was unavailable.
    _claim_ref_json = result.get("claim_reference", "UNKNOWN")
    if _db_available and db_session is not None:
        result["db_persisted"] = True
    else:
        result["db_persisted"] = False
        logger.warning(
            "[MEMORY-ONLY] Claim %s stored in memory only (db_persisted=False) — "
            "manual reconciliation required if DB was unavailable",
            _claim_ref_json,
        )

    claims_store[result["claim_reference"]] = result
    _with_sync_session(
        lambda db: _capture_claim_account(
            db,
            claim_dict,
            claim_reference=result.get("claim_reference"),
            current_user=current_user,
            capture_source="MANUAL",
        )
    )
    if idempotency_key and idempotency_scope:
        _with_sync_session(
            lambda db: complete_idempotency_key(
                db,
                idempotency_key=idempotency_key,
                scope=idempotency_scope,
                response_payload=jsonable_encoder(result),
                response_status_code=201,
                claim_reference=result.get("claim_reference"),
            )
        )
    return result



# ═════════════════════════════════════════════════════════════════════════════════
# ADVANCE CLAIM REGISTRATION — Indian Market Cashless Pre-Authorization
# ═════════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/claims/advance/documents", tags=["Claims", "Advance"], status_code=201)
@limiter.limit(LIMIT_ADJUDICATION)
async def upload_advance_claim_documents(
    request: Request,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
    market_region: str = Form("INDIA"),
    files: list[UploadFile] = File(..., description="India cashless pre-auth supporting documents"),
):
    """Upload supporting documents for India cashless pre-authorization."""
    if market_region.upper() != "INDIA":
        raise HTTPException(status_code=422, detail="Advance document upload is available only for INDIA cashless pre-auth")

    if not files:
        raise HTTPException(status_code=422, detail="At least one document is required")
    if len(files) > 10:
        raise HTTPException(status_code=413, detail="Upload up to 10 supporting documents at a time")

    allowed_ext = {".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif"}
    max_file_bytes = 15 * 1024 * 1024
    max_total_bytes = 50 * 1024 * 1024
    upload_id = f"ADV-DOC-{uuid.uuid4().hex[:12].upper()}"
    tenant_id = current_user.tenant_id or "default"
    dest_dir = ADVANCE_DOCS_DIR / tenant_id / upload_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    uploaded: list[AdvanceDocumentUploadItem] = []
    total_bytes = 0

    for index, file in enumerate(files, start=1):
        safe_name = Path(file.filename or "").name
        if not safe_name:
            raise HTTPException(status_code=400, detail="Document filename is required")

        ext = Path(safe_name).suffix.lower()
        if ext not in allowed_ext:
            raise HTTPException(status_code=400, detail=f"Unsupported document format: {safe_name}")

        raw_bytes = await file.read()
        if not raw_bytes:
            raise HTTPException(status_code=400, detail=f"Empty document uploaded: {safe_name}")
        if len(raw_bytes) > max_file_bytes:
            raise HTTPException(status_code=413, detail=f"Document too large: {safe_name}")

        total_bytes += len(raw_bytes)
        if total_bytes > max_total_bytes:
            raise HTTPException(status_code=413, detail="Supporting documents exceed 50 MB total")

        document_hash = hashlib.sha256(raw_bytes).hexdigest()
        cleaned_name = re.sub(r"[^A-Za-z0-9._-]+", "_", safe_name).strip("._") or f"document{ext}"
        stored_name = f"{index:02d}_{document_hash[:12]}_{cleaned_name}"
        dest_path = dest_dir / stored_name
        dest_path.write_bytes(raw_bytes)

        uploaded.append(
            AdvanceDocumentUploadItem(
                original_filename=safe_name,
                document_url=f"/api/v1/claims/advance/documents/{upload_id}/{stored_name}",
                document_hash=document_hash,
                file_size_bytes=len(raw_bytes),
                content_type=file.content_type,
            )
        )

    return AdvanceDocumentUploadResponse(upload_id=upload_id, documents=uploaded)


@app.post("/api/v1/claims/advance/documents/process", tags=["Claims", "Advance"])
@limiter.limit(LIMIT_ADJUDICATION)
async def process_advance_claim_documents(
    request: Request,
    payload: AdvanceDocumentProcessRequest,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """Run OCR on uploaded India cashless pre-auth documents and return extracted form fields."""
    ocr_engine = _get_ocr_engine()
    if ocr_engine is None:
        raise HTTPException(status_code=503, detail="OCR service unavailable")

    extracted_fields: dict[str, Any] = {
        "claim_type": "INPATIENT",
        "market_region": "INDIA",
        "currency": "INR",
    }
    field_confidences: dict[str, float] = {}
    low_confidence_fields: set[str] = set()
    processed: list[str] = []
    confidence_values: list[float] = []

    for document_url in payload.document_urls:
        document_path, safe_name = _advance_document_path_for_user(document_url, current_user)
        raw_bytes = document_path.read_bytes()
        pdf_bytes = _normalize_advance_document_bytes(raw_bytes, safe_name)

        try:
            ocr_result = await run_in_threadpool(ocr_engine.extract_from_bytes, pdf_bytes, safe_name)
            fields, confidences = _advance_fields_from_ocr(ocr_engine, ocr_result)
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Advance document OCR failed for %s: %s", safe_name, exc, exc_info=True)
            raise HTTPException(status_code=422, detail=f"Could not extract pre-auth fields from {safe_name}")

        processed.append(safe_name)
        overall_confidence = getattr(ocr_result, "overall_confidence", None)
        if overall_confidence is not None:
            try:
                confidence_values.append(float(overall_confidence))
            except Exception:
                pass

        for key, value in fields.items():
            if key == "line_items":
                if value and not extracted_fields.get("line_items"):
                    extracted_fields[key] = value
                continue
            if key == "estimated_total":
                if value and not extracted_fields.get("estimated_total"):
                    extracted_fields[key] = value
                continue
            if not _is_missing_advance_value(key, value) and _is_missing_advance_value(key, extracted_fields.get(key)):
                extracted_fields[key] = value

        for key, confidence in confidences.items():
            if confidence > field_confidences.get(key, 0):
                field_confidences[key] = confidence
            if 0 < confidence < 0.65:
                low_confidence_fields.add(key)

        for field_name in getattr(ocr_result, "low_confidence_fields", []) or []:
            low_confidence_fields.add(str(field_name))

    line_items = extracted_fields.get("line_items")
    if line_items and not extracted_fields.get("estimated_total"):
        try:
            extracted_fields["estimated_total"] = str(sum(float(item.get("billed_amount") or 0) for item in line_items))
        except Exception:
            pass

    missing_fields = _missing_advance_fields(extracted_fields)
    status = "READY" if not missing_fields else "NEEDS_INPUT"
    message = (
        "Required pre-auth details captured. Submit is available."
        if status == "READY"
        else "Some required fields were not captured. Fill the missing fields before submitting."
    )

    return AdvanceDocumentProcessResponse(
        status=status,
        message=message,
        extracted_fields=extracted_fields,
        field_confidences=field_confidences,
        missing_fields=missing_fields,
        low_confidence_fields=sorted(low_confidence_fields),
        documents_processed=processed,
        overall_confidence=(sum(confidence_values) / len(confidence_values)) if confidence_values else None,
    )


@app.get("/api/v1/claims/advance/reference-data", tags=["Claims", "Advance"])
@limiter.limit(LIMIT_STANDARD)
async def get_advance_claim_reference_data(
    request: Request,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """Return India cashless reference data for hospital, doctor, diagnosis, procedure, and bank capture."""
    return _load_india_cashless_library()


@app.get("/api/v1/claims/advance/documents/{upload_id}/{filename}", tags=["Claims", "Advance"])
@limiter.limit(LIMIT_STANDARD)
async def get_advance_claim_document(
    request: Request,
    upload_id: str,
    filename: str,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """Serve an uploaded India cashless pre-auth supporting document."""
    if not _SAFE_REF_RE.match(upload_id):
        raise HTTPException(status_code=400, detail="Invalid document upload id")

    safe_name = Path(filename).name
    if safe_name != filename:
        raise HTTPException(status_code=400, detail="Invalid document filename")

    tenant_id = current_user.tenant_id or "default"
    document_path = (ADVANCE_DOCS_DIR / tenant_id / upload_id / safe_name).resolve()
    allowed_root = (ADVANCE_DOCS_DIR / tenant_id).resolve()
    if not str(document_path).startswith(str(allowed_root)) or not document_path.exists():
        raise HTTPException(status_code=404, detail="Supporting document not found")

    return FileResponse(path=str(document_path), filename=safe_name)


@app.post("/api/v1/claims/advance/register", tags=["Claims", "Advance"], status_code=201)
@limiter.limit(LIMIT_ADJUDICATION)
async def register_advance_claim(
    request: Request,
    advance_claim: AdvanceClaimCreate,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """
    Register an advance claim for pre-treatment authorization (Indian market cashless).
    Allows patients to register claims BEFORE treatment for pre-authorization.
    """
    claim_id = str(uuid.uuid4())
    advance_id = str(uuid.uuid4())
    claim_reference = _generate_advance_claim_reference()
    preauth_ref = f"PREAUTH-{claim_reference}"
    estimated_total = Decimal(str(advance_claim.estimated_total))
    estimated_plan_payment = estimated_total
    estimated_member_responsibility = Decimal("0.00")
    date_created = datetime.now(timezone.utc).replace(tzinfo=None)

    claim_dict = advance_claim.model_dump()
    claim_dict["id"] = claim_id
    claim_dict["advance_id"] = advance_id
    claim_dict["claim_reference"] = claim_reference
    claim_dict["preauth_reference"] = preauth_ref
    claim_dict["tenant_id"] = current_user.tenant_id
    claim_dict["trace_id"] = getattr(request.state, "trace_id", request.state.request_id)
    claim_dict["request_id"] = request.state.request_id
    claim_dict["_actor_type"] = current_user.role
    claim_dict["_actor_id"] = current_user.email
    claim_dict["actor_type"] = current_user.role
    claim_dict["actor_id"] = current_user.email
    claim_dict["is_advance_claim"] = True
    claim_dict["is_cashless"] = True
    claim_dict["status"] = "HITL_PENDING"
    claim_dict["advance_status"] = "PENDING_REVIEW"
    claim_dict["service_date"] = str(advance_claim.admission_date)
    claim_dict["total_billed"] = estimated_total
    
    for key in ["admission_date", "discharge_date", "patient_dob"]:
        if claim_dict.get(key):
            claim_dict[key] = str(claim_dict[key])
    for li in claim_dict.get("line_items", []):
        li["billed_amount"] = float(li["billed_amount"])
    
    # Duplicate detection
    _json_dup = _find_duplicate_json_claim(
        member_number=claim_dict.get("member_number", ""),
        service_date=str(claim_dict.get("admission_date", "")),
        provider_code=claim_dict.get("provider_code", ""),
        total_billed=float(sum(float(li.get("billed_amount") or 0) for li in claim_dict.get("line_items", []))
        or float(claim_dict.get("estimated_total") or 0)),
    )
    if _json_dup:
        raise HTTPException(status_code=409, detail={"detail": "Duplicate advance pre-auth detected", "duplicate_of": _json_dup["claim_reference"]})
    
    # Store and respond
    claim_dict["preauth_status"] = "PENDING_HITL"
    claim_dict["coverage_decision"] = "PENDING"
    claim_dict["needs_hntl"] = True
    claim_dict["date_created"] = date_created.isoformat()
    claim_dict["estimated_coverage"] = estimated_plan_payment
    claim_dict["estimated_plan_payment"] = estimated_plan_payment
    claim_dict["estimated_member_responsibility"] = estimated_member_responsibility
    
    claims_store[claim_dict["claim_reference"]] = claim_dict
    _persist_advance_claim(claim_dict)
    _with_sync_session(
        lambda db: _capture_claim_account(
            db,
            claim_dict,
            claim_reference=claim_dict["claim_reference"],
            current_user=current_user,
            capture_source="ADVANCE_PROCESSING",
        )
    )

    # ── India Cashless: NHCX pre-auth submission (fire-and-forget) ────────────
    # Submit to NHCX asynchronously so the API response is not blocked.
    # The NHCX reference is stored back into the claim record when available.
    nhcx_ref: Optional[str] = None
    try:
        from services.india_cashless.nhcx_client import get_nhcx_client
        _nhcx = get_nhcx_client()
        _bundle = _nhcx.build_preauth_bundle(claim_dict)
        _nhcx_resp = await run_in_threadpool(
            _nhcx.submit_preauth, _bundle, claim_dict["claim_reference"]
        )
        nhcx_ref = _nhcx_resp.get("preAuthRef") or _nhcx_resp.get("disposition")
        claim_dict["nhcx_reference"] = nhcx_ref
        claims_store[claim_dict["claim_reference"]] = claim_dict
        logger.info("[India Cashless] NHCX pre-auth submitted: %s → %s",
                    claim_dict["claim_reference"], nhcx_ref)
    except Exception as _nhcx_exc:
        logger.warning("[India Cashless] NHCX submission skipped (non-fatal): %s", _nhcx_exc)

    # ── India Cashless: Graph service event notification ──────────────────────
    try:
        import httpx as _httpx
        _graph_url = os.getenv("GRAPH_SERVICE_URL", "http://graph-service:8000/event")
        async with _httpx.AsyncClient(timeout=2.0) as _gc:
            await _gc.post(_graph_url, json={
                "claim_id": claim_id,
                "event_type": "PREAUTH_REGISTERED",
                "market_region": "INDIA",
                "data": {
                    "claim_reference": claim_dict["claim_reference"],
                    "preauth_reference": preauth_ref,
                    "nhcx_ref": nhcx_ref,
                    "provider_code": claim_dict.get("provider_code"),
                    "provider_name": claim_dict.get("provider_name"),
                    "estimated_total": float(estimated_total),
                    "patient_id": claim_dict.get("member_number"),
                },
            })
    except Exception as _graph_exc:
        logger.debug("[India Cashless] Graph notification skipped: %s", _graph_exc)

    # ── India Cashless: Start Operaton BPMN process instance ──────────────────
    # Fire-and-forget — the BPMN worker will pick up the process and execute
    # the full compliance pipeline (FHIR extraction, consent, OPA, FWA, NHCX).
    bpmn_process_id: Optional[str] = None
    try:
        _operaton_url = os.getenv("OPERATON_URL", "http://operaton:8080/engine-rest")
        import httpx as _httpx2
        async with _httpx2.AsyncClient(timeout=5.0) as _oc:
            _bpmn_resp = await _oc.post(
                f"{_operaton_url}/process-definition/key/PreAuthProcess/start",
                json={
                    "variables": {
                        "claimId":       {"value": claim_id,                                    "type": "String"},
                        "memberNumber":  {"value": claim_dict.get("member_number", ""),         "type": "String"},
                        "claimAmount":   {"value": float(estimated_total),                      "type": "Double"},
                        "isEmergency":   {"value": claim_dict.get("is_emergency", False),       "type": "Boolean"},
                        "claimType":     {"value": claim_dict.get("claim_type", "INPATIENT"),   "type": "String"},
                        "claimReference":{"value": claim_dict["claim_reference"],               "type": "String"},
                        "preauthRef":    {"value": preauth_ref,                                 "type": "String"},
                    }
                },
                headers={"Content-Type": "application/json"},
            )
            if _bpmn_resp.status_code in (200, 201):
                bpmn_process_id = _bpmn_resp.json().get("id")
                claim_dict["bpmn_process_instance_id"] = bpmn_process_id
                claims_store[claim_dict["claim_reference"]] = claim_dict
                # Persist bpmn_process_instance_id to DB
                try:
                    from sqlalchemy import text as _text
                    _with_sync_session(lambda db: db.execute(
                        _text("UPDATE advance_claims SET bpmn_process_instance_id = :pid WHERE claim_reference = :ref"),
                        {"pid": bpmn_process_id, "ref": claim_dict["claim_reference"]},
                    ) and db.commit())
                except Exception:
                    pass
                logger.info("[India Cashless] BPMN process started: %s → %s",
                            claim_dict["claim_reference"], bpmn_process_id)
    except Exception as _bpmn_exc:
        logger.warning("[India Cashless] BPMN process start skipped (non-fatal): %s", _bpmn_exc)

    response = _advance_response_from_record(claim_dict)
    return JSONResponse(status_code=201, content=jsonable_encoder(response),
                        headers={
                            "X-Preauth-Reference": preauth_ref,
                            **({"X-NHCX-Reference": nhcx_ref} if nhcx_ref else {}),
                        })


@app.get("/api/v1/claims/advance/{reference}", tags=["Claims", "Advance"])
@limiter.limit(LIMIT_STANDARD)
async def get_advance_claim(
    request: Request,
    reference: str,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """Get advance pre-authorization details."""
    claim_record = _find_advance_claim_in_store(reference)
    if not claim_record:
        claim_record = _load_advance_claim_from_db(reference, actor_id=current_user.email)
        if claim_record:
            claims_store[claim_record["claim_reference"]] = claim_record

    if not claim_record or not claim_record.get("is_advance_claim"):
        raise HTTPException(status_code=404, detail="Advance pre-authorization not found")
    
    return _advance_response_from_record(claim_record)


@app.get("/api/v1/claims/advance", tags=["Claims", "Advance"])
@limiter.limit(LIMIT_STANDARD)
async def list_advance_claims(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """List advance pre-authorizations."""
    db_records, db_total = _load_advance_claims_from_db(current_user.email, skip=skip, limit=limit)
    if db_records:
        return AdvanceClaimListResponse(
            claims=[_advance_response_from_record(record) for record in db_records],
            total=db_total,
            page=(skip // limit) + 1,
            page_size=limit,
        )

    advance_claims = [
        cr for cr in claims_store.values()
        if cr.get("is_advance_claim") and cr.get("actor_id") == current_user.email
    ]
    advance_claims.sort(key=lambda x: x.get("date_created", ""), reverse=True)
    total = len(advance_claims)
    paginated = advance_claims[skip:skip + limit]
    
    return AdvanceClaimListResponse(
        claims=[_advance_response_from_record(cr) for cr in paginated],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit,
    )


@app.post("/api/v1/claims/advance/{reference}/preauth/decision", tags=["Claims", "Advance", "HITL"])
@limiter.limit(LIMIT_STANDARD)
async def decide_advance_preauth(
    request: Request,
    reference: str,
    decision: PreAuthDecision,
    current_user: CurrentUser = Depends(require_roles(*HITL_ROLES)),
):
    """HITL decision on advance pre-authorization."""
    claim_record = _find_advance_claim_in_store(reference)
    if not claim_record:
        claim_record = _load_advance_claim_from_db(reference)
        if claim_record:
            claims_store[claim_record["claim_reference"]] = claim_record

    if not claim_record or not claim_record.get("is_advance_claim"):
        raise HTTPException(status_code=404, detail="Advance pre-authorization not found")

    mapped_state = _map_advance_claim_decision(decision.decision)
    resolved_payment = _resolve_advance_plan_payment(claim_record, decision)
    billed_decimal = Decimal(str(claim_record["total_billed"])) if claim_record.get("total_billed") is not None else None
    member_responsibility = None
    if billed_decimal is not None and resolved_payment is not None:
        member_responsibility = max(Decimal("0.00"), billed_decimal - resolved_payment)

    claim_record.update(mapped_state)
    claim_record["hitl_decision_notes"] = decision.notes
    claim_record["reviewer_notes"] = decision.reviewer_notes
    claim_record["reviewed_by"] = current_user.email
    claim_record["date_decision"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    if resolved_payment is not None:
        claim_record["estimated_plan_payment"] = resolved_payment
        claim_record["estimated_coverage"] = resolved_payment
    if member_responsibility is not None:
        claim_record["estimated_member_responsibility"] = member_responsibility

    claims_store[claim_record["claim_reference"]] = claim_record
    _persist_advance_claim(claim_record)

    # Generate pre-auth letter on approval
    if "APPROVED" in claim_record["preauth_status"]:
        try:
            from services.india_cashless.letter_generator import generate_preauth_letter
            _pdf_bytes = generate_preauth_letter(claim_record)
            _letter_dir = Path(os.environ.get("UPLOAD_DIR", "/app/uploads")) / "preauth_letters"
            _letter_dir.mkdir(parents=True, exist_ok=True)
            _letter_path = _letter_dir / f"{reference}.pdf"
            _letter_path.write_bytes(_pdf_bytes)
            claim_record["preauth_letter_url"] = f"/api/v1/claims/advance/{reference}/letter"
            logger.info("[India Cashless] Pre-auth letter generated for %s", reference)
        except Exception as _le:
            logger.warning("[India Cashless] Letter generation failed (non-fatal): %s", _le)
            claim_record["preauth_status"] = "APPROVED_LETTER_PENDING"

    # Notify graph service
    try:
        import httpx as _hx
        _graph_url = os.getenv("GRAPH_SERVICE_URL", "http://graph-service:8000/event")
        async with _hx.AsyncClient(timeout=2.0) as _gc:
            await _gc.post(_graph_url, json={
                "claim_id": claim_record.get("id", reference),
                "event_type": "HITL_DECIDED",
                "market_region": "INDIA",
                "data": {"decision": decision.decision, "notes": decision.notes},
            })
    except Exception:
        pass

    return _advance_response_from_record(claim_record)


# ── India Cashless: ABHA + Pipeline Health endpoints ─────────────────────────

@app.post("/api/v1/india/abha/generate-otp", tags=["India Cashless"])
@limiter.limit(LIMIT_STANDARD)
async def india_abha_generate_otp(
    request: Request,
    body: dict,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """Trigger ABDM OTP generation for a patient's ABHA address."""
    abha_address = body.get("abha_address", "")
    if not abha_address:
        raise HTTPException(status_code=422, detail="abha_address is required")
    try:
        from services.india_cashless.abha_service import get_abha_service
        result = await run_in_threadpool(get_abha_service().generate_otp, abha_address)
        return JSONResponse(content=result)
    except Exception as exc:
        logger.warning("[India ABHA] OTP generation failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"ABHA service error: {exc}")


@app.post("/api/v1/india/abha/verify-otp", tags=["India Cashless"])
@limiter.limit(LIMIT_STANDARD)
async def india_abha_verify_otp(
    request: Request,
    body: dict,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """Verify ABDM OTP and create a FHIR Consent resource for the patient."""
    abha_address = body.get("abha_address", "")
    otp = body.get("otp", "")
    claim_reference = body.get("claim_reference", "")
    if not abha_address or not otp:
        raise HTTPException(status_code=422, detail="abha_address and otp are required")
    try:
        from services.india_cashless.abha_service import get_abha_service
        result = await run_in_threadpool(get_abha_service().verify_otp_and_link, abha_address, otp)

        # Create FHIR Consent resource
        _fhir_base = os.getenv("FHIR_BASE_URL", "http://hapi-fhir:8080/fhir")
        _patient_id = abha_address.replace("@", "-")
        _consent = {
            "resourceType": "Consent",
            "status": "active",
            "scope": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/consentscope", "code": "patient-privacy"}]},
            "category": [{"coding": [{"system": "http://loinc.org", "code": "59284-0"}]}],
            "patient": {"reference": f"Patient/{_patient_id}"},
            "dateTime": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
            "policyRule": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "OPTIN"}]},
        }
        try:
            import httpx as _hx
            async with _hx.AsyncClient(timeout=5.0) as _fc:
                await _fc.post(f"{_fhir_base}/Consent", json=_consent,
                               headers={"Content-Type": "application/fhir+json"})
        except Exception as _fe:
            logger.warning("[India ABHA] FHIR Consent creation failed (non-fatal): %s", _fe)

        # Update advance_claims.abha_address + consent_verified
        if claim_reference:
            try:
                from sqlalchemy import text as _text
                _with_sync_session(lambda db: (
                    db.execute(_text(
                        "UPDATE advance_claims SET abha_address=:abha, consent_verified=true WHERE claim_reference=:ref"
                    ), {"abha": abha_address, "ref": claim_reference}),
                    db.commit(),
                ))
            except Exception:
                pass

        return JSONResponse(content={"status": "verified", "abha_address": abha_address, "fhir_consent": "created", **result})
    except Exception as exc:
        logger.warning("[India ABHA] OTP verification failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"ABHA verification error: {exc}")


@app.get("/api/v1/india/pipeline/health", tags=["India Cashless"])
@limiter.limit(LIMIT_HEALTH)
async def india_pipeline_health(request: Request):
    """Check health of all 7 India cashless compliance components."""
    import httpx as _hx

    async def _check(name: str, url: str) -> dict:
        try:
            async with _hx.AsyncClient(timeout=3.0) as c:
                r = await c.get(url)
                return {"name": name, "status": "up" if r.status_code < 400 else "degraded", "http": r.status_code}
        except Exception as e:
            return {"name": name, "status": "down", "error": str(e)[:80]}

    async def _check_tcp_url(name: str, url: str) -> dict:
        """Check TCP reachability for gateways where HTTP / can validly return 404."""
        try:
            parsed = urlparse(url)
            host = parsed.hostname
            if not host:
                raise ValueError("health URL missing host")
            port = parsed.port or (443 if parsed.scheme == "https" else 80)

            def _connect() -> float:
                t0 = time.monotonic()
                with socket.create_connection((host, port), timeout=3.0):
                    return round((time.monotonic() - t0) * 1000, 1)

            latency_ms = await asyncio.to_thread(_connect)
            return {
                "name": name,
                "status": "up",
                "latency_ms": latency_ms,
                "detail": f"TCP {host}:{port} reachable",
            }
        except Exception as e:
            return {"name": name, "status": "down", "error": str(e)[:80]}

    async def _check_optional(name: str, url: str | None, detail: str) -> dict:
        if not url:
            return {"name": name, "status": "not_configured", "detail": detail}
        return await _check(name, url)

    async def _check_opa() -> dict:
        opa_url = os.getenv("OPA_HEALTH_URL")
        if opa_url:
            return await _check("OPA", opa_url)
        return {
            "name": "OPA",
            "status": "up",
            "detail": "Policy engine is embedded as the APISIX sidecar.",
        }

    checks = await asyncio.gather(
        _check_tcp_url(
            "APISIX",
            os.getenv(
                "APISIX_HEALTH_URL",
                "http://apisix-gateway.claims-nhcx.svc.cluster.local:9080/",
            ),
        ),
        _check("Keycloak",    os.getenv("KEYCLOAK_HEALTH_URL", "http://keycloak.claims-nhcx.svc.cluster.local:8080/health/ready")),
        _check_optional(
            "Operaton",
            os.getenv("OPERATON_HEALTH_URL"),
            "Optional BPMN runtime is not deployed for this environment.",
        ),
        _check("HAPI FHIR",   os.getenv("FHIR_HEALTH_URL",    "http://hapi-fhir.claims-nhcx.svc.cluster.local:8080/fhir/metadata")),
        _check("Document AI", os.getenv("DOCAI_HEALTH_URL",   "http://document-ai.claims-os.svc.cluster.local:8000/health")),
        _check_opa(),
        _check("FWA Service", os.getenv("FWA_HEALTH_URL",     "http://fwa-service.claims-os.svc.cluster.local:8000/health")),
    )
    all_required_up = all(c["status"] in {"up", "not_configured"} for c in checks)
    return JSONResponse(
        content={"overall": "healthy" if all_required_up else "degraded", "components": checks},
        status_code=200 if all_required_up else 207,
    )


@app.get("/api/v1/claims/advance/{reference}/letter", tags=["India Cashless"])
@limiter.limit(LIMIT_STANDARD)
async def download_preauth_letter(
    request: Request,
    reference: str,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES, "API_CONSUMER")),
):
    """Download the pre-authorization letter PDF for an approved advance claim."""
    _letter_path = Path(os.environ.get("UPLOAD_DIR", "/app/uploads")) / "preauth_letters" / f"{reference}.pdf"
    if not _letter_path.exists():
        # Try to generate on-demand
        claim_record = claims_store.get(reference)
        if not claim_record:
            raise HTTPException(status_code=404, detail="Pre-auth letter not found")
        try:
            from services.india_cashless.letter_generator import generate_preauth_letter
            _pdf_bytes = generate_preauth_letter(claim_record)
            _letter_path.parent.mkdir(parents=True, exist_ok=True)
            _letter_path.write_bytes(_pdf_bytes)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Letter generation failed: {exc}")
    return FileResponse(
        path=str(_letter_path),
        media_type="application/pdf",
        filename=f"preauth-{reference}.pdf",
    )



@app.get("/api/v1/claims", tags=["Claims"])
@limiter.limit(LIMIT_STANDARD)
async def list_claims(
    request: Request,
    status: Optional[str] = Query(None, description="Filter by status"),
    market_region: Optional[str] = Query(None, description="Filter by market (UAE, INDIA)"),
    search: Optional[str] = Query(None, description="Search by claim reference, patient name, claim type, market"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: Optional[str] = Query(None, description="Sort field: claim_reference, patient_name, claim_type, market_region, service_date, status, total_billed, total_settlement, confidence_score, date_received"),
    sort_order: Optional[str] = Query(None, description="Sort order: asc or desc"),
    received_date_from: Optional[str] = Query(None, description="Filter claims received from this date (YYYY-MM-DD)"),
    received_date_to: Optional[str] = Query(None, description="Filter claims received until this date (YYYY-MM-DD)"),
    service_date_from: Optional[str] = Query(None, description="Filter by service date from (YYYY-MM-DD)"),
    service_date_to: Optional[str] = Query(None, description="Filter by service date to (YYYY-MM-DD)"),
    source: str = Query("auto", description="Data source: 'memory', 'db', or 'auto' (memory + DB merge)"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List all processed claims with optional filtering."""
    claims = list(claims_store.values())

    # Merge with DB results if available
    if source in ("db", "auto") and _db_available:
        filters = {}
        if status:
            filters["status"] = status
        if market_region:
            filters["market_region"] = market_region
        if search:
            filters["search"] = search
        if current_user.role not in {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"}:
            filters["tenant_id"] = current_user.tenant_id

        db_claims = _load_claims_from_db(filters)
        # Add DB claims not already in memory (by claim_reference)
        memory_refs = {c["claim_reference"] for c in claims}
        for db_claim in db_claims:
            if db_claim.get("claim_reference") not in memory_refs:
                claims.append(db_claim)

    # Apply in-memory filters (for memory-only claims)
    if status:
        claims = [c for c in claims if c.get("status") == status]
    if market_region:
        claims = [c for c in claims if c.get("market_region") == market_region]
    if search:
        # Multi-field case-insensitive partial match
        search_lower = search.lower()
        claims = [
            c for c in claims
            if (search_lower in str(c.get("claim_reference", "")).lower()
                or search_lower in str(c.get("patient_name", "")).lower()
                or search_lower in str(c.get("claim_type", "")).lower()
                or search_lower in str(c.get("market_region", "")).lower())
        ]

    claims = _filter_claims_for_user(claims, current_user)

    # Date filtering - received_date
    if received_date_from or received_date_to:
        filtered_claims = []
        for c in claims:
            received = c.get("date_received")
            if not received:
                continue
            received_str = str(received)[:10]  # YYYY-MM-DD
            if received_date_from and received_str < received_date_from:
                continue
            if received_date_to and received_str > received_date_to:
                continue
            filtered_claims.append(c)
        claims = filtered_claims

    # Date filtering - service_date
    if service_date_from or service_date_to:
        filtered_claims = []
        for c in claims:
            service = c.get("service_date")
            if not service:
                continue
            service_str = str(service)[:10]  # YYYY-MM-DD
            if service_date_from and service_str < service_date_from:
                continue
            if service_date_to and service_str > service_date_to:
                continue
            filtered_claims.append(c)
        claims = filtered_claims

    # Dynamic sorting — default to date_received desc
    _sort_field = sort_by if sort_by else "date_received"
    _sort_reverse = (sort_order or "desc").lower() != "asc"

    # Numeric fields need float conversion for proper sorting
    _NUMERIC_FIELDS = {"total_billed", "total_settlement", "total_allowed",
                       "total_copay", "total_deductible", "confidence_score"}

    def _sort_key(c):
        val = c.get(_sort_field)
        if val is None:
            return (0, "") if _sort_field in _NUMERIC_FIELDS else (0, "")
        if _sort_field in _NUMERIC_FIELDS:
            try:
                return (1, float(val))
            except (ValueError, TypeError):
                return (0, "")
        return (1, str(val).lower())

    claims.sort(key=_sort_key, reverse=_sort_reverse)

    total = len(claims)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "claims": [_normalize_claim_response(c) for c in claims[start:end]],
        "total": total,
        "page": page,
        "page_size": page_size,
        "db_available": _db_available,
    }


@app.post("/api/v1/claims/bulk-decision", tags=["Claims"])
@limiter.limit(LIMIT_STANDARD)
async def bulk_claim_decision(
    request: Request,
    body: BulkDecisionRequest,
    current_user: CurrentUser = Depends(require_roles(*HITL_ROLES)),
):
    """Apply a reviewer bulk decision to live claims."""
    decision = body.decision.upper()
    if decision not in {"SETTLED", "DENIED"}:
        raise HTTPException(status_code=422, detail="decision must be SETTLED or DENIED")

    updated: list[str] = []
    failed: list[dict] = []

    for claim_reference in body.claim_ids:
        if not _SAFE_REF_RE.match(claim_reference):
            failed.append({"claim_reference": claim_reference, "reason": "Invalid claim reference"})
            continue

        claim = claims_store.get(claim_reference)
        if claim:
            visible = _filter_claims_for_user([claim], current_user)
            if not visible:
                failed.append({"claim_reference": claim_reference, "reason": "Not found"})
                continue
            claim["status"] = decision
            claim["date_adjudicated"] = claim.get("date_adjudicated") or datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            if decision == "SETTLED":
                claim["date_settled"] = claim.get("date_settled") or datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            updated.append(claim_reference)
            continue

        if not _db_available:
            failed.append({"claim_reference": claim_reference, "reason": "Not found"})
            continue

        try:
            from sqlalchemy import text
            from shared.db_sync import get_sync_session

            with get_sync_session() as db:
                has_tenant = db.execute(
                    text("""
                        SELECT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_name = 'claims'
                              AND column_name = 'tenant_id'
                        )
                    """)
                ).scalar()
                params = {
                    "claim_reference": claim_reference,
                    "status": decision,
                    "tenant_id": current_user.tenant_id,
                }
                tenant_clause = ""
                if has_tenant and current_user.role not in {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"}:
                    tenant_clause = "AND tenant_id = :tenant_id"

                row = db.execute(
                    text(f"""
                        UPDATE claims
                        SET status = CAST(:status AS claim_status),
                            date_adjudicated = COALESCE(date_adjudicated, NOW()),
                            date_settled = CASE
                                WHEN :status = 'SETTLED' THEN COALESCE(date_settled, NOW())
                                ELSE date_settled
                            END,
                            updated_at = NOW()
                        WHERE claim_reference = :claim_reference
                        {tenant_clause}
                        RETURNING claim_reference
                    """),
                    params,
                ).fetchone()
                db.commit()

            if row:
                updated.append(claim_reference)
                db_claims = _load_claims_from_db({"search": claim_reference})
                for db_claim in db_claims:
                    if db_claim.get("claim_reference") == claim_reference:
                        claims_store[claim_reference] = db_claim
                        break
            else:
                failed.append({"claim_reference": claim_reference, "reason": "Not found"})
        except Exception as exc:
            logger.error("bulk decision failed for %s: %s", claim_reference, exc)
            failed.append({"claim_reference": claim_reference, "reason": "Persistence failed"})

    return {
        "decision": decision,
        "updated": updated,
        "failed": failed,
        "total_updated": len(updated),
        "total_failed": len(failed),
    }


@app.get("/api/v1/claims/{claim_reference}/lifecycle", tags=["Claims", "Operations"])
@limiter.limit(LIMIT_STANDARD)
async def get_claim_lifecycle(
    request: Request,
    claim_reference: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return lifecycle state and event history for a visible claim."""
    claim = _find_claim_for_user(claim_reference, current_user)
    tenant_id = _tenant_filter_for_user(current_user)

    lifecycle = None
    if _db_available:
        lifecycle = _with_sync_session(
            lambda db: lifecycle_store.get_claim_lifecycle(
                db,
                claim_reference,
                tenant_id=tenant_id,
                claim_snapshot=claim,
            ),
            default=None,
        )
    if lifecycle is None:
        lifecycle = lifecycle_store.get_claim_lifecycle(
            None,
            claim_reference,
            tenant_id=tenant_id,
            claim_snapshot=claim,
        )

    if claim is None and lifecycle.get("stage_status") == lifecycle_store.STATE_NOT_STARTED:
        raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")
    if tenant_id and lifecycle.get("tenant_id") != tenant_id:
        raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")

    return lifecycle


@app.get("/api/v1/operations/lifecycle", tags=["Operations"])
@limiter.limit(LIMIT_STANDARD)
async def list_lifecycle_operations(
    request: Request,
    stage: Optional[str] = Query(None, description="Filter by lifecycle stage"),
    state: Optional[str] = Query(None, description="Filter by stage state"),
    status: Optional[str] = Query(None, description="Alias for stage state"),
    market_region: Optional[str] = Query(None, description="Filter by market region"),
    stuck_only: bool = Query(False, description="Only return claims beyond stage SLA"),
    only_stuck: bool = Query(False, description="Alias for stuck_only"),
    only_sla_breached: bool = Query(False, description="Only return claims beyond SLA"),
    search: Optional[str] = Query(None, description="Search claim reference, blocker, or action"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    limit: Optional[int] = Query(None, ge=1, le=500),
    current_user: CurrentUser = Depends(
        require_roles("ADMIN", "ADJUSTER", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR", "SENIOR_ADJUSTER")
    ),
):
    """List current lifecycle operations, including stuck claim detection."""
    tenant_id = _tenant_filter_for_user(current_user)
    effective_state = state or status
    effective_stuck_only = stuck_only or only_stuck or only_sla_breached
    fetch_limit = max(page * page_size, limit or page_size)
    fetch_limit = max(1, min(fetch_limit, 500))
    try:
        operations = lifecycle_store.list_lifecycle_operations(
            None,
            stage=stage,
            state=effective_state,
            market_region=market_region,
            stuck_only=effective_stuck_only,
            tenant_id=tenant_id,
            limit=fetch_limit,
        )
        if _db_available:
            operations = _with_sync_session(
                lambda db: lifecycle_store.list_lifecycle_operations(
                    db,
                    stage=stage,
                    state=effective_state,
                    market_region=market_region,
                    stuck_only=effective_stuck_only,
                    tenant_id=tenant_id,
                    limit=fetch_limit,
                ),
                default=operations,
            )
    except lifecycle_store.LifecycleTransitionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    search_token = (search or "").strip().lower()
    if search_token:
        def _searchable(item: dict[str, Any]) -> str:
            return " ".join(
                str(item.get(key) or "")
                for key in ("claim_reference", "market_region", "current_stage", "stage_status", "blocker", "next_action")
            ).lower()

        operations = [item for item in operations if search_token in _searchable(item)]

    def _stage_label(stage_key: Optional[str]) -> str:
        if not stage_key:
            return "Unknown"
        return lifecycle_store.STAGE_LABELS.get(stage_key, stage_key.replace("_", " ").title())

    stage_summary: dict[str, dict[str, Any]] = {}
    market_stage_counts: dict[tuple[str, str], int] = {}
    oldest_stage_age: dict[tuple[str, str, str], int] = {}
    for item in operations:
        stage_key = item.get("current_stage") or "unknown"
        stage_status = str(item.get("stage_status") or lifecycle_store.STATE_NOT_STARTED).upper()
        age_seconds = int(item.get("current_age_seconds") or 0)
        market_key = str(item.get("market_region") or "UNKNOWN").upper()
        bucket = stage_summary.setdefault(
            stage_key,
            {
                "stage": stage_key,
                "label": _stage_label(stage_key),
                "total": 0,
                "in_progress": 0,
                "completed": 0,
                "failed": 0,
                "skipped": 0,
                "blocked": 0,
                "stuck": 0,
                "sla_breached": 0,
                "avg_age_seconds": 0,
                "_age_total": 0,
            },
        )
        bucket["total"] += 1
        bucket["_age_total"] += age_seconds
        if stage_status == lifecycle_store.STATE_COMPLETED:
            bucket["completed"] += 1
        elif stage_status == lifecycle_store.STATE_FAILED:
            bucket["failed"] += 1
        elif stage_status == lifecycle_store.STATE_SKIPPED:
            bucket["skipped"] += 1
        elif stage_status == lifecycle_store.STATE_BLOCKED:
            bucket["blocked"] += 1
        elif stage_status == lifecycle_store.STATE_IN_PROGRESS:
            bucket["in_progress"] += 1
        if item.get("is_stuck"):
            bucket["stuck"] += 1
            bucket["sla_breached"] += 1

        market_stage_counts[(stage_key, market_key)] = market_stage_counts.get((stage_key, market_key), 0) + 1
        sla_state = "breached" if item.get("is_stuck") else "healthy"
        age_key = (stage_key, market_key, sla_state)
        oldest_stage_age[age_key] = max(oldest_stage_age.get(age_key, 0), age_seconds)

    stage_summary_rows = []
    for bucket in stage_summary.values():
        total = bucket["total"]
        bucket["avg_age_seconds"] = int(bucket["_age_total"] / total) if total else 0
        bucket.pop("_age_total", None)
        stage_summary_rows.append(bucket)

    try:
        from services.api_gateway.app.metrics import set_claim_current_stage_age, set_claims_in_stage

        for (stage_key, market_key), count in market_stage_counts.items():
            set_claims_in_stage(stage_key, count, market=market_key)
        for (stage_key, market_key, sla_state), oldest_age_seconds in oldest_stage_age.items():
            set_claim_current_stage_age(stage_key, oldest_age_seconds, market=market_key, sla_state=sla_state)
    except Exception as exc:
        logger.debug("Lifecycle operations metric refresh skipped: %s", exc)

    total_count = len(operations)
    start_index = (page - 1) * page_size
    paged_operations = operations[start_index : start_index + page_size]

    return {
        "operations": paged_operations,
        "claims": paged_operations,
        "stage_summary": stage_summary_rows,
        "total_claims": total_count,
        "stuck_count": sum(1 for item in operations if item.get("is_stuck")),
        "blocked_count": sum(
            1
            for item in operations
            if item.get("stage_status") == lifecycle_store.STATE_BLOCKED or item.get("blocker")
        ),
        "sla_breached_count": sum(1 for item in operations if item.get("is_stuck")),
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "filters": {
            "stage": stage,
            "state": effective_state.upper() if effective_state else None,
            "market_region": market_region.upper() if market_region else None,
            "stuck_only": effective_stuck_only,
            "search": search,
            "limit": fetch_limit,
        },
        "db_available": _db_available,
    }


@app.get("/api/v1/claims/{claim_reference}", tags=["Claims"])
async def get_claim(
    claim_reference: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get full claim details including settlement breakdown and audit trail."""
    # Check memory first (fastest)
    claim = claims_store.get(claim_reference)

    # Fall back to DB
    if not claim and _db_available:
        db_claims = _load_claims_from_db()
        claim = next((c for c in db_claims if c.get("claim_reference") == claim_reference), None)
        if claim:
            # DB rows only have basic scalar fields — patch in empty collections so
            # the UI doesn't crash on claim.line_items.length / claim.rules_results etc.
            claim.setdefault("line_items", [])
            claim.setdefault("rules_results", [])
            claim.setdefault("policy_citations", [])
            claim.setdefault("ai_citations", [])
            claim.setdefault("ai_flags", [])
            claim.setdefault("settlement", None)
            claim.setdefault("audit_trail", [])
            # Fetch OCR extracted data from DB (contact, address, physician, pre-auth, etc.)
            ocr_data = _load_ocr_extracted_data_from_db(claim_reference)
            if ocr_data:
                claim["ocr_extracted_data"] = ocr_data

    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")
    if not _claim_visible_to_user(claim, current_user):
        raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")

    # Always enrich with ocr_extracted_data from DB if not already present
    # (in-memory claims from startup pre-load don't carry this field)
    if _db_available and not claim.get("ocr_extracted_data"):
        ocr_data = _load_ocr_extracted_data_from_db(claim_reference)
        if ocr_data:
            claim["ocr_extracted_data"] = ocr_data

    # If the claim has no line_items (DB-only rows), load from claim_line_items table
    if (not claim.get("line_items")) and _db_available:
        db_line_items = _load_line_items_from_db(claim_reference)
        if db_line_items:
            claim["line_items"] = db_line_items

    # Also attach settlement so memory-preloaded claims can use DB settlement rows.
    if (not claim.get("settlement")) and _db_available:
        db_settlement = _load_settlement_from_db(claim_reference)
        if db_settlement:
            claim["settlement"] = _normalize_settlement(db_settlement)

    return _normalize_claim_response(claim)


@app.get("/api/v1/claims/{claim_reference}/settlement", tags=["Claims"])
async def get_settlement(
    claim_reference: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get the settlement breakdown for a specific claim."""
    claim = claims_store.get(claim_reference)

    # Memory hit — return rich in-memory settlement
    if claim:
        if not _claim_visible_to_user(claim, current_user):
            raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")
        settlement = _normalize_settlement(claim.get("settlement"))
        line_items = claim.get("line_items") or []
        policy_citations = claim.get("policy_citations") or []
        ai_citations = claim.get("ai_citations") or []
        if not settlement and _db_available:
            db_settlement = _load_settlement_from_db(claim_reference)
            if db_settlement:
                settlement = _normalize_settlement(db_settlement)
                policy_citations = db_settlement.pop("policy_citations", []) if db_settlement else policy_citations
                ai_citations = db_settlement.pop("ai_citations", []) if db_settlement else ai_citations
            if not line_items:
                line_items = _load_line_items_from_db(claim_reference)
        return {
            "claim_reference": claim_reference,
            "settlement": settlement,
            "line_items": line_items,
            "policy": claim.get("policy"),
            "policy_citations": policy_citations,
            "ai_citations": ai_citations,
            "ai_flags": claim.get("ai_flags") or [],
        }

    # DB fallback — reconstruct settlement from settlements table
    if _db_available:
        db_settlement = _load_settlement_from_db(claim_reference)
        db_claim = next((c for c in _load_claims_from_db({"tenant_id": current_user.tenant_id}) if c.get("claim_reference") == claim_reference), None) if current_user.role not in {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"} else True
        if db_settlement and db_claim:
            return {
                "claim_reference": claim_reference,
                "settlement": _normalize_settlement(db_settlement),
                "line_items": _load_line_items_from_db(claim_reference),
                "policy": None,
                "policy_citations": db_settlement.pop("policy_citations", []) if db_settlement else [],
                "ai_citations": db_settlement.pop("ai_citations", []) if db_settlement else [],
                "ai_flags": [],
            }

    raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")


def _append_financial_events(claim_reference: str, audit_trail: list):
    """Append the full disbursement lifecycle to the audit trail.

    Covers every stage after settlement:
      DISBURSEMENT_QUEUED → account check → ACCOUNT_REGISTERED →
      ACCOUNT_VERIFIED (or ACCOUNT_VERIFICATION_PENDING / ACCOUNT_NOT_REGISTERED) →
      GATEWAY_SYNCED → PAYOUT_INITIATED → PAYOUT_PROCESSING →
      PAYOUT_COMPLETED (with ref) | PAYOUT_FAILED
    """
    if not _db_available:
        return audit_trail

    get_sync_session = _get_sync_session()
    if get_sync_session is None:
        return audit_trail

    try:
        from sqlalchemy import text

        with get_sync_session() as db:
            if db is None:
                return audit_trail

            # ── 1. Claim basics ──────────────────────────────────────────────
            claim_row = db.execute(text("""
                SELECT member_number, status, total_settlement, currency, date_settled
                FROM claims WHERE claim_reference = :ref
            """), {"ref": claim_reference}).fetchone()
            if not claim_row:
                return audit_trail

            member_number   = claim_row.member_number
            claim_status    = str(claim_row.status)
            total_settlement = claim_row.total_settlement
            currency        = claim_row.currency or "AED"
            date_settled    = claim_row.date_settled

            events = []

            # ── 2. Disbursement queued (synthetic — fires when SETTLED) ──────
            if claim_status == "SETTLED" and date_settled:
                events.append({
                    "timestamp": date_settled.isoformat() + "Z",
                    "event_type": "DISBURSEMENT_QUEUED",
                    "actor_type": "SYSTEM",
                    "actor_id": "CLAIMS_ENGINE",
                    "description": (
                        f"Settlement of {currency} {float(total_settlement or 0):,.2f} approved. "
                        "Disbursement queued — initiating bank account validation."
                    ),
                    "entry_hash": "disbursement-queued",
                    "event_data": {"amount": str(total_settlement), "currency": currency},
                })

            # ── 3. Customer account ──────────────────────────────────────────
            account = db.execute(text("""
                SELECT id, account_holder_name, bank_name, iban,
                       account_number_last4, verification_status,
                       verified_at, verified_by,
                       stripe_synced_at, paytm_synced_at,
                       created_at, created_by
                FROM customer_accounts
                WHERE member_number = :member
                  AND deleted_at IS NULL
                ORDER BY is_primary DESC, created_at DESC
                LIMIT 1
            """), {"member": member_number}).fetchone()

            if account:
                # Account registered
                if account.created_at:
                    bank_label = account.bank_name or "Bank"
                    iban_tail = f" ···{account.iban[-4:]}" if account.iban else (
                        f" ···{account.account_number_last4}" if account.account_number_last4 else ""
                    )
                    events.append({
                        "timestamp": account.created_at.isoformat() + "Z",
                        "event_type": "ACCOUNT_REGISTERED",
                        "actor_type": "SYSTEM" if account.created_by == "migration_agent" else "USER",
                        "actor_id": account.created_by or "SYSTEM",
                        "description": (
                            f"Bank account registered for {account.account_holder_name}: "
                            f"{bank_label}{iban_tail}. Sent to compliance for verification."
                        ),
                        "entry_hash": "account-registered",
                        "event_data": {"bank_name": account.bank_name},
                    })

                vst = str(account.verification_status)
                if vst == "VERIFIED" and account.verified_at:
                    events.append({
                        "timestamp": account.verified_at.isoformat() + "Z",
                        "event_type": "ACCOUNT_VERIFIED",
                        "actor_type": "USER",
                        "actor_id": account.verified_by or "COMPLIANCE",
                        "description": (
                            "Bank account verified by compliance team. "
                            "Account cleared — initiating payment gateway sync."
                        ),
                        "entry_hash": "account-verified",
                    })

                    # Gateway sync
                    synced_at = account.stripe_synced_at or account.paytm_synced_at
                    gateway_name = "Stripe" if account.stripe_synced_at else ("Paytm" if account.paytm_synced_at else None)
                    if synced_at and gateway_name:
                        events.append({
                            "timestamp": synced_at.isoformat() + "Z",
                            "event_type": "GATEWAY_SYNCED",
                            "actor_type": "SYSTEM",
                            "actor_id": gateway_name.upper(),
                            "description": (
                                f"Account successfully synced to {gateway_name} payment gateway. "
                                "Payment rail is active and ready for disbursement."
                            ),
                            "entry_hash": "gateway-synced",
                        })
                    elif vst == "VERIFIED":
                        # Verified but not yet synced to gateway
                        events.append({
                            "timestamp": account.verified_at.isoformat() + "Z",
                            "event_type": "GATEWAY_SYNC_PENDING",
                            "actor_type": "SYSTEM",
                            "actor_id": "PAYMENT_ENGINE",
                            "description": (
                                "Account verified. Awaiting payment gateway sync before "
                                "disbursement can be initiated."
                            ),
                            "entry_hash": "gateway-sync-pending",
                        })
                elif vst in {"UNVERIFIED", "PENDING"}:
                    events.append({
                        "timestamp": account.created_at.isoformat() + "Z" if account.created_at else date_settled.isoformat() + "Z" if date_settled else "",
                        "event_type": "ACCOUNT_VERIFICATION_PENDING",
                        "actor_type": "SYSTEM",
                        "actor_id": "COMPLIANCE_QUEUE",
                        "description": (
                            "Bank account submitted for compliance verification. "
                            "Disbursement will be initiated upon approval."
                        ),
                        "entry_hash": "account-verification-pending",
                    })
                elif vst in {"FAILED", "BLOCKED"}:
                    events.append({
                        "timestamp": account.verified_at.isoformat() + "Z" if account.verified_at else "",
                        "event_type": "ACCOUNT_REJECTED" if vst == "FAILED" else "ACCOUNT_BLOCKED",
                        "actor_type": "USER",
                        "actor_id": account.verified_by or "COMPLIANCE",
                        "description": (
                            "Bank account failed compliance verification. Client must re-submit valid account details."
                            if vst == "FAILED"
                            else "Bank account blocked by compliance. Disbursement cannot proceed until unblocked."
                        ),
                        "entry_hash": "account-rejected" if vst == "FAILED" else "account-blocked",
                    })
            elif claim_status == "SETTLED":
                ts = date_settled.isoformat() + "Z" if date_settled else ""
                events.append({
                    "timestamp": ts,
                    "event_type": "ACCOUNT_NOT_REGISTERED",
                    "actor_type": "SYSTEM",
                    "actor_id": "CLAIMS_ENGINE",
                    "description": (
                        "No bank account registered for this member. "
                        "Client must register and verify their bank account to receive payment."
                    ),
                    "entry_hash": "account-not-registered",
                })

            # ── 4. Gateway payout events ─────────────────────────────────────
            payouts = db.execute(text("""
                SELECT initiated_at, processing_at, completed_at, failed_at,
                       initiated_by, gateway, failure_reason, gateway_txn_id,
                       gateway_ref, amount_minor, currency AS payout_currency, status
                FROM gateway_payouts
                WHERE claim_reference = :ref
                ORDER BY initiated_at ASC
            """), {"ref": claim_reference}).fetchall()

            for p in payouts:
                amount_str = (
                    f"{p.payout_currency} {p.amount_minor / 100:,.2f}"
                    if p.amount_minor else ""
                )
                gw = str(p.gateway).title()

                if p.initiated_at:
                    events.append({
                        "timestamp": p.initiated_at.isoformat() + "Z",
                        "event_type": "PAYOUT_INITIATED",
                        "actor_type": "SYSTEM",
                        "actor_id": p.initiated_by or "PAYMENT_ENGINE",
                        "description": f"Payment of {amount_str} initiated via {gw} gateway.",
                        "entry_hash": "payout-initiated",
                        "event_data": {"gateway": p.gateway, "amount_minor": p.amount_minor},
                    })
                if p.processing_at:
                    events.append({
                        "timestamp": p.processing_at.isoformat() + "Z",
                        "event_type": "PAYOUT_PROCESSING",
                        "actor_type": "SYSTEM",
                        "actor_id": str(p.gateway).upper(),
                        "description": f"{gw} gateway is processing the payment transfer.",
                        "entry_hash": "payout-processing",
                    })
                if p.completed_at:
                    ref_parts = []
                    if p.gateway_txn_id:
                        ref_parts.append(f"Txn: {p.gateway_txn_id}")
                    if p.gateway_ref and p.gateway_ref != p.gateway_txn_id:
                        ref_parts.append(f"Ref: {p.gateway_ref}")
                    ref_str = f" — {', '.join(ref_parts)}" if ref_parts else ""
                    events.append({
                        "timestamp": p.completed_at.isoformat() + "Z",
                        "event_type": "PAYOUT_COMPLETED",
                        "actor_type": "SYSTEM",
                        "actor_id": str(p.gateway).upper(),
                        "description": (
                            f"Payment of {amount_str} successfully credited to client's bank account.{ref_str}"
                        ),
                        "entry_hash": "payout-completed",
                        "event_data": {
                            "gateway_txn_id": p.gateway_txn_id,
                            "gateway_ref": p.gateway_ref,
                            "gateway": p.gateway,
                        },
                    })
                if p.failed_at:
                    reason = f": {p.failure_reason}" if p.failure_reason else ""
                    events.append({
                        "timestamp": p.failed_at.isoformat() + "Z",
                        "event_type": "PAYOUT_FAILED",
                        "actor_type": "SYSTEM",
                        "actor_id": str(p.gateway).upper(),
                        "description": f"Payment failed{reason}. Manual review required.",
                        "entry_hash": "payout-failed",
                    })

            combined = audit_trail + events
            combined.sort(key=lambda x: x.get("timestamp", ""))
            return combined

    except Exception as e:
        logger.error(f"Failed to append financial events: {e}")
        return audit_trail


@app.get("/api/v1/claims/{claim_reference}/audit", tags=["Audit"])
async def get_audit_trail(
    claim_reference: str,
    current_user: CurrentUser = Depends(require_roles(*AUDIT_ROLES, "ADJUSTER", "SENIOR_ADJUSTER")),
):
    """Get the full audit trail for a claim."""
    _refresh_db_availability()
    claim = claims_store.get(claim_reference)

    # Memory hit — return rich in-memory audit trail
    if claim:
        if not _claim_visible_to_user(claim, current_user):
            raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")
        audit_trail = claim.get("audit_trail", [])
        if audit_trail or not _db_available:
            audit_trail = _append_financial_events(claim_reference, audit_trail)
            return {
                "claim_reference": claim_reference,
                "audit_trail": audit_trail,
                "total_entries": len(audit_trail),
                "chain_integrity": _verify_audit_chain(audit_trail),
            }

    # DB fallback — load from audit_logs table
    if _db_available:
        # Verify the claim exists first
        if claim:
            exists = True
        else:
            filters = {"tenant_id": current_user.tenant_id} if current_user.role not in {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"} else None
            db_claims = _load_claims_from_db(filters)
            exists = any(c.get("claim_reference") == claim_reference for c in db_claims)
        if exists:
            audit_trail = _load_audit_trail_from_db(claim_reference)
            audit_trail = _append_financial_events(claim_reference, audit_trail)
            return {
                "claim_reference": claim_reference,
                "audit_trail": audit_trail,
                "total_entries": len(audit_trail),
                "chain_integrity": _verify_audit_chain(audit_trail),
            }

    raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")


def _verify_audit_chain(audit_trail: list) -> dict:
    """Quick hash-chain verification for API response."""
    try:
        from services.audit_service.app.audit import AuditTrail
        trail = AuditTrail.__new__(AuditTrail)
        trail._entries = audit_trail
        trail._last_hash = audit_trail[-1]["entry_hash"] if audit_trail else "0" * 64
        is_valid = trail.verify_chain()
        return {"valid": is_valid, "entries_checked": len(audit_trail)}
    except Exception:
        return {"valid": None, "entries_checked": len(audit_trail), "note": "verification unavailable"}


# ═══════════════════════════════════════════
# CLAIM DOCUMENT SERVE
# ═══════════════════════════════════════════

async def _resolve_claim_document(claim_reference: str) -> Path:
    """
    Resolve the stored document path for a claim.

    Resolution strategy (tried in order):
    1. Direct lookup: /app/uploads/claims/{claim_reference}/received_*.pdf
    2. Hash-based fallback (if rename failed): /app/uploads/claims/{hash[:16]}/received_*.pdf
       - First tries in-memory claims_store
       - Then tries DB lookup
    3. Auto-rename hash folder to claim reference (if possible)

    Raises HTTPException(404) if document cannot be found.
    """
    if not _SAFE_REF_RE.match(claim_reference):
        raise HTTPException(status_code=400, detail="Invalid claim reference format")

    claim_dir = CLAIMS_UPLOAD_DIR / claim_reference
    logger.debug("[DOC-RESOLVE] Resolving document for claim: %s", claim_reference)

    # ── STEP 1: Direct lookup (standard path) ──
    if not claim_dir.exists():
        logger.debug("[DOC-RESOLVE] Claim directory not found, trying hash-based fallback: %s", claim_dir)

        # ── STEP 2: Hash-based fallback (rename may have failed) ──
        _hash_prefix = None
        _fallback_source = None

        # 2a) Try in-memory claims_store
        cached = claims_store.get(claim_reference)
        if cached and cached.get("raw_document_hash"):
            _hash_prefix = cached["raw_document_hash"][:16]
            _fallback_source = "memory"
            logger.debug("[DOC-RESOLVE] Found hash in memory: %s", _hash_prefix)

        # 2b) Try DB lookup if not found in cache
        if not _hash_prefix:
            try:
                from shared.database import async_session as _async_session
                from sqlalchemy import text
                async with _async_session() as session:
                    row = (await session.execute(
                        text("SELECT raw_document_hash FROM claims WHERE claim_reference = :ref"),
                        {"ref": claim_reference},
                    )).first()
                    if row and row[0]:
                        _hash_prefix = row[0][:16]
                        _fallback_source = "database"
                        logger.debug("[DOC-RESOLVE] Found hash in database: %s", _hash_prefix)
            except Exception as db_err:
                logger.warning("[DOC-RESOLVE] DB lookup failed: %s", db_err)

        # If we found a hash, try to locate and optionally rename the hash-based folder
        if _hash_prefix:
            hash_dir = CLAIMS_UPLOAD_DIR / _hash_prefix

            if hash_dir.exists():
                logger.info("[DOC-RESOLVE] Found hash-based folder: %s (source: %s)", _hash_prefix, _fallback_source)

                # Try to rename hash folder to claim reference for future requests
                _rename_success = False
                if not claim_dir.exists():
                    try:
                        hash_dir.rename(claim_dir)
                        logger.info("[DOC-RESOLVE] ✓ Auto-renamed hash folder %s → %s", _hash_prefix, claim_reference)
                        _rename_success = True
                        claim_dir = CLAIMS_UPLOAD_DIR / claim_reference  # Update reference
                    except Exception as rename_err:
                        logger.warning(
                            "[DOC-RESOLVE] Could not rename hash folder %s → %s: %s (will serve from hash folder)",
                            _hash_prefix, claim_reference, rename_err
                        )
                        claim_dir = hash_dir  # Use hash folder directly
                else:
                    claim_dir = hash_dir  # Use hash folder if rename target exists
            else:
                logger.error("[DOC-RESOLVE] Hash folder %s does not exist (hash from %s)", _hash_prefix, _fallback_source)
                raise HTTPException(
                    status_code=404,
                    detail=f"No document folder found for claim {claim_reference} (hash folder missing)"
                )
        else:
            logger.error("[DOC-RESOLVE] No hash found in memory or database for claim %s", claim_reference)
            raise HTTPException(
                status_code=404,
                detail=f"No document folder found for claim {claim_reference}"
            )

    # ── STEP 3: Find document file in the resolved directory ──
    logger.debug("[DOC-RESOLVE] Searching for document in: %s", claim_dir)

    # Prefer "received_" prefixed PDFs
    pdfs = sorted(claim_dir.glob("received_*.pdf"))
    if pdfs:
        logger.info("[DOC-RESOLVE] ✓ Found document (received_*.pdf): %s", pdfs[0].name)
        pdf_path = pdfs[0]
    else:
        # Fall back to any PDF
        pdfs = sorted(claim_dir.glob("*.pdf"))
        if pdfs:
            logger.info("[DOC-RESOLVE] ✓ Found document (*.pdf): %s", pdfs[0].name)
            pdf_path = pdfs[0]
        else:
            # Also check for image files (JPG/PNG/TIFF uploads auto-converted to PDF)
            for ext in ("*.jpg", "*.jpeg", "*.png", "*.tiff", "*.tif"):
                pdfs = sorted(claim_dir.glob(f"received_{ext}"))
                if pdfs:
                    logger.info("[DOC-RESOLVE] ✓ Found image document: %s", pdfs[0].name)
                    pdf_path = pdfs[0]
                    break
            else:
                logger.error("[DOC-RESOLVE] Directory %s exists but contains no PDF/image files", claim_dir)
                raise HTTPException(
                    status_code=404,
                    detail=f"Document directory exists but no PDF/image found for claim {claim_reference}"
                )

    # Security: verify resolved path is within upload directory (prevent path traversal)
    pdf_path_resolved = pdf_path.resolve()
    if not str(pdf_path_resolved).startswith(str(CLAIMS_UPLOAD_DIR.resolve())):
        logger.error("[DOC-RESOLVE] ✗ Path traversal attempt blocked: %s", pdf_path_resolved)
        raise HTTPException(status_code=403, detail="Access denied")

    logger.info("[DOC-RESOLVE] ✓ Resolved document: %s", pdf_path_resolved)
    return pdf_path_resolved


@app.head("/api/v1/claims/{claim_reference}/document", tags=["Claims"])
async def head_claim_document(
    claim_reference: str,
    current_user: CurrentUser = Depends(
        require_roles(*AUDIT_ROLES, "ADJUSTER", "SENIOR_ADJUSTER")
    ),
):
    """Check if a document exists for this claim (HEAD request)."""
    try:
        pdf_path = await _resolve_claim_document(claim_reference)
        media_type = "application/pdf" if pdf_path.suffix == ".pdf" else f"image/{pdf_path.suffix.lstrip('.')}"
        return Response(
            status_code=200,
            headers={
                "Content-Type": media_type,
                "Content-Length": str(pdf_path.stat().st_size),
                "Content-Disposition": f'inline; filename="{claim_reference}{pdf_path.suffix}"',
            },
        )
    except HTTPException as e:
        logger.warning("[HEAD-DOCUMENT] %s: %s", claim_reference, e.detail)
        raise
    except Exception as e:
        logger.error("[HEAD-DOCUMENT] Unexpected error for %s: %s", claim_reference, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Error checking document")


@app.get("/api/v1/claims/{claim_reference}/document", tags=["Claims"])
async def get_claim_document(
    claim_reference: str,
    current_user: CurrentUser = Depends(
        require_roles(*AUDIT_ROLES, "ADJUSTER", "SENIOR_ADJUSTER")
    ),
):
    """
    Serve the stored PDF document for a claim.
    Returns the original uploaded PDF as a binary stream.
    404 if no document was stored for this claim.
    """
    try:
        pdf_path = await _resolve_claim_document(claim_reference)
        media_type = "application/pdf" if pdf_path.suffix == ".pdf" else f"image/{pdf_path.suffix.lstrip('.')}"

        return FileResponse(
            path=str(pdf_path),
            media_type=media_type,
            filename=f"{claim_reference}{pdf_path.suffix}",
            headers={"Content-Disposition": f'inline; filename="{claim_reference}{pdf_path.suffix}"'},
        )
    except HTTPException as e:
        logger.warning("[GET-DOCUMENT] %s: %s", claim_reference, e.detail)
        raise
    except Exception as e:
        logger.error("[GET-DOCUMENT] Unexpected error for %s: %s", claim_reference, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Error retrieving document")


# ═══════════════════════════════════════════
# MEMBERS
# ═══════════════════════════════════════════

@app.get("/api/v1/members/{member_number}", tags=["Members"])
async def get_member(
    member_number: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get member details and current accumulators."""
    member = pipeline.members.get(member_number)
    if not member:
        raise HTTPException(status_code=404, detail=f"Member {member_number} not found")

    policy = pipeline.policies_by_id.get(member.get("policy_id"))
    return {
        "member": member,
        "policy": {
            "policy_number": policy["policy_number"],
            "policy_name": policy["policy_name"],
            "tier": policy["tier"],
            "carrier_name": policy["carrier_name"],
        } if policy else None,
    }


# ═══════════════════════════════════════════
# POLICIES
# ═══════════════════════════════════════════

@app.get("/api/v1/policies", tags=["Policies"])
async def list_policies(
    market_region: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List all available insurance policies."""
    policies = list(pipeline.policies.values())
    if market_region:
        policies = [p for p in policies if p.get("market_region") == market_region]
    return {"policies": policies, "total": len(policies)}


@app.get("/api/v1/policies/{policy_number}", tags=["Policies"])
async def get_policy(
    policy_number: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get policy details including clauses and benefit summary."""
    policy = pipeline.policies.get(policy_number)
    if not policy:
        raise HTTPException(status_code=404, detail=f"Policy {policy_number} not found")

    clauses = pipeline.clauses.get(policy["id"], [])
    return {"policy": policy, "clauses": clauses}


@app.post(
    "/api/v1/policies/{policy_id}/document",
    tags=["Policies"],
    response_model=PolicyDocumentUploadResponse,
    status_code=201,
)
async def upload_policy_document(
    policy_id: str,
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES)),
    file: UploadFile = File(..., description="Insurance policy document PDF (max 30 MB)"),
):
    """
    Upload an insurance policy PDF document to extract and store policy clauses.

    The engine will:
    1. Validate the policy ID and file format
    2. OCR-extract the full text from the PDF
    3. Use LLM (Groq / Claude) to parse up to 40 structured policy clauses
    4. Replace existing company clauses in the DB for this policy (idempotent re-upload)
    5. Update the in-memory clause cache so the next adjudication uses the new clauses immediately
    6. Return a summary of extracted clauses with any warnings

    Graceful degradation:
    - If LLM is unavailable: stores document hash and page count but skips clause extraction
    - If DB is unavailable: updates the in-memory cache only (clauses survive until server restart)
    """
    import hashlib
    import time as _time

    t_start = _time.time()
    warnings: list[str] = []

    # ── 1. Validate policy_id ──
    # policy_id is the UUID primary key; find the matching policy
    policy = pipeline.policies_by_id.get(policy_id)
    if not policy:
        # Also try matching by policy_number for convenience
        policy = pipeline.policies.get(policy_id)
        if not policy:
            raise HTTPException(
                status_code=404,
                detail=f"Policy '{policy_id}' not found. Use GET /api/v1/policies to list available policy IDs.",
            )

    # ── 2. Validate file ──
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    MAX_SIZE_BYTES = 30 * 1024 * 1024  # 30 MB
    if len(pdf_bytes) > MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(pdf_bytes) // (1024*1024)} MB). Maximum 30 MB.",
        )

    document_hash = hashlib.sha256(pdf_bytes).hexdigest()

    # ── 3. OCR extraction ──
    ocr_engine = _get_ocr_engine()
    if ocr_engine is None:
        raise HTTPException(
            status_code=503,
            detail="OCR service unavailable — install pdfplumber and pytesseract.",
        )

    try:
        ocr_result = ocr_engine.extract_from_bytes(pdf_bytes, filename=file.filename)
        raw_text = getattr(ocr_result, "raw_text", None) or getattr(ocr_result, "full_text", None)
        page_count = getattr(ocr_result, "page_count", 1)
        ocr_engine_name = getattr(ocr_engine, "engine_name", "pdfplumber")
    except Exception as e:
        logger.error("OCR failed for policy document %s: %s", file.filename, e)
        raise HTTPException(status_code=422, detail="OCR extraction failed. Please ensure the file is a valid, readable PDF and try again.")

    if not raw_text or not raw_text.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from the PDF.")

    # ── 4. LLM clause extraction ──
    clauses_extracted: list[dict] = []
    llm_model_used = "unavailable"

    try:
        from shared.policy_doc_extractor import get_policy_doc_extractor
        extractor = get_policy_doc_extractor()
        policy_meta = {
            "policy_number": policy.get("policy_number", ""),
            "policy_name":   policy.get("policy_name", ""),
            "carrier_name":  policy.get("carrier_name", ""),
            "market_region": policy.get("market_region", ""),
            "currency":      policy.get("currency", ""),
        }
        clauses_extracted = extractor.extract_clauses(raw_text, policy_meta)
        llm_model_used = getattr(extractor, "_last_model_used", "llm")
    except Exception as e:
        logger.warning("LLM clause extraction failed for policy %s: %s", policy_id, e)
        warnings.append(f"LLM clause extraction skipped: {e}. Document hash stored but no clauses were extracted.")

    # ── 5. Persist to DB (idempotent) ──
    clauses_inserted = 0
    if _db_available and clauses_extracted:
        try:
            get_sync_session = _get_sync_session()
            if get_sync_session:
                with get_sync_session() as db:
                    if db is not None:
                        # Delete existing company clauses for this policy
                        db.execute(
                            __import__("sqlalchemy").text(
                                "DELETE FROM policy_clauses WHERE policy_id = :pid"
                            ),
                            {"pid": policy_id},
                        )

                        # Bulk insert new clauses
                        now = datetime.now(timezone.utc).replace(tzinfo=None)
                        for clause in clauses_extracted:
                            db.execute(
                                __import__("sqlalchemy").text("""
                                    INSERT INTO policy_clauses (
                                        id, policy_id, clause_type, section_reference,
                                        title, full_text, structured_data,
                                        applicable_claim_types, is_active, created_at, updated_at
                                    ) VALUES (
                                        uuid_generate_v4(), :policy_id, :clause_type, :section_reference,
                                        :title, :full_text, :structured_data::jsonb,
                                        :applicable_claim_types::jsonb, true, :now, :now
                                    )
                                """),
                                {
                                    "policy_id":             policy_id,
                                    "clause_type":           clause.get("clause_type", "GENERAL_PROVISION"),
                                    "section_reference":     clause.get("section_reference", ""),
                                    "title":                 clause.get("title", ""),
                                    "full_text":             clause.get("full_text", ""),
                                    "structured_data":       json.dumps(clause.get("structured_data", {})),
                                    "applicable_claim_types": json.dumps(clause.get("applicable_claim_types", [])),
                                    "now":                   now,
                                },
                            )
                            clauses_inserted += 1

                        # Update policy record with document metadata
                        db.execute(
                            __import__("sqlalchemy").text("""
                                UPDATE policies
                                SET document_hash = :hash,
                                    page_count    = :pages,
                                    updated_at    = :now
                                WHERE id = :pid
                            """),
                            {
                                "hash":  document_hash,
                                "pages": page_count,
                                "now":   datetime.now(timezone.utc).replace(tzinfo=None),
                                "pid":   policy_id,
                            },
                        )
                        db.commit()
        except Exception as e:
            logger.warning("DB persist failed for policy document %s: %s", policy_id, e)
            warnings.append(f"DB persist skipped: {e}. In-memory cache updated.")
    elif not _db_available and clauses_extracted:
        warnings.append("DB unavailable — clauses stored in memory only (lost on server restart).")

    # ── 6. Update in-memory cache immediately ──
    if clauses_extracted:
        pipeline.clauses[policy["id"]] = clauses_extracted
        logger.info(
            "Policy %s (%s): in-memory cache updated with %d clauses from uploaded document",
            policy_id,
            policy.get("policy_number"),
            len(clauses_extracted),
        )

    # Update policy dict in memory with document hash/page count
    policy["document_hash"] = document_hash
    policy["page_count"] = page_count

    processing_time_ms = int((_time.time() - t_start) * 1000)

    return PolicyDocumentUploadResponse(
        policy_id=policy_id,
        policy_number=policy.get("policy_number", ""),
        document_hash=document_hash,
        page_count=page_count,
        clauses_extracted=len(clauses_extracted),
        clauses_inserted=clauses_inserted,
        ocr_engine_used=ocr_engine_name,
        llm_model_used=llm_model_used,
        processing_time_ms=processing_time_ms,
        warnings=warnings,
        message=(
            f"Policy document processed successfully. "
            f"{len(clauses_extracted)} clauses extracted and cached for immediate use."
            if clauses_extracted
            else "Document hash recorded. No clauses extracted (see warnings)."
        ),
    )


# ═══════════════════════════════════════════
# PROVIDERS
# ═══════════════════════════════════════════

@app.get("/api/v1/providers", tags=["Providers"])
async def list_providers(
    market_region: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List healthcare providers in the network."""
    providers = list(pipeline.providers.values())
    if market_region:
        providers = [p for p in providers if p.get("market_region") == market_region]
    return {"providers": providers, "total": len(providers)}


# ═══════════════════════════════════════════
# HITL QUEUE
# ═══════════════════════════════════════════

def _metric_for_agent(claim: dict[str, Any], agent_id: str) -> dict[str, Any]:
    metrics = claim.get("agent_status_metrics") or {}
    metric = metrics.get(agent_id) if isinstance(metrics, dict) else None
    return metric if isinstance(metric, dict) else {}


def _build_hitl_agent_assignments(claim: dict[str, Any]) -> list[dict[str, Any]]:
    """Assign each pending review item to parallel specialist lanes."""
    trigger = str(claim.get("hitl_reason") or claim.get("trigger_reason") or "").upper()
    claim_type = str(claim.get("claim_type") or "").upper()
    confidence = float(claim.get("confidence_score") or 0)
    try:
        total_billed = float(claim.get("total_billed") or 0)
    except (TypeError, ValueError):
        total_billed = 0

    lanes: list[dict[str, str]] = [
        {
            "agent_id": "medical_review_agent",
            "label": "Medical",
            "role": "Clinical review",
            "task": "Validate diagnosis, treatment fit, and clinical necessity.",
        },
        {
            "agent_id": "policy_review_agent",
            "label": "Policy",
            "role": "Coverage review",
            "task": "Check policy clauses, exclusions, eligibility, and review trigger.",
        },
        {
            "agent_id": "settlement_review_agent",
            "label": "Settlement",
            "role": "Amount review",
            "task": "Verify payable amount, deductions, and member responsibility.",
        },
    ]

    if trigger in {"REGULATORY_VIOLATION", "INCOMPLETE_PROCESSING"}:
        lanes.append(
            {
                "agent_id": "compliance_review_agent",
                "label": "Compliance",
                "role": "Regulatory review",
                "task": "Validate regulatory blockers, missing evidence, and audit readiness.",
            }
        )

    if trigger in {"AGENT_CONFLICT", "AGENT_DISAGREEMENT", "LOW_CONFIDENCE"} or confidence < 80 or total_billed >= 100000:
        lanes.append(
            {
                "agent_id": "fraud_risk_agent",
                "label": "Risk",
                "role": "Anomaly review",
                "task": "Review disagreement, confidence gap, value risk, and duplicate signals.",
            }
        )

    if claim_type in {"INPATIENT", "DAYCARE"} and not any(lane["agent_id"] == "compliance_review_agent" for lane in lanes):
        lanes.append(
            {
                "agent_id": "preauth_review_agent",
                "label": "Pre Auth",
                "role": "Pre-authorization review",
                "task": "Confirm admission, pre-authorization, and inpatient controls.",
            }
        )

    source_agent_by_lane = {
        "policy_review_agent": "rules_engine",
        "settlement_review_agent": "settlement_calculator",
        "compliance_review_agent": "completeness_validator",
        "risk_review_agent": "reasoning_engine",
        "fraud_risk_agent": "reasoning_engine",
        "medical_review_agent": "reasoning_engine",
        "preauth_review_agent": "hitl_router",
    }
    priority = int(claim.get("hitl_priority") or claim.get("priority") or 5)

    assignments: list[dict[str, Any]] = []
    for lane in lanes:
        metric = _metric_for_agent(claim, source_agent_by_lane.get(lane["agent_id"], ""))
        source_status = str(metric.get("status") or "").upper()
        status = source_status if source_status in {"COMPLETED", "FAILED", "SKIPPED", "ROUTED"} else "QUEUED"
        assignments.append(
            {
                **lane,
                "status": status,
                "priority": priority,
                "parallel_group": "HITL_REVIEW",
                "source_agent_id": source_agent_by_lane.get(lane["agent_id"]),
                "duration_ms": metric.get("duration_ms"),
                "confidence": metric.get("confidence"),
            }
        )

    return assignments


@app.get("/api/v1/hitl/queue", tags=["HITL"])
@limiter.limit(LIMIT_STANDARD)
async def get_hitl_queue(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    market_region: Optional[str] = Query(None, description="Filter by market region"),
    current_user: CurrentUser = Depends(require_roles(*HITL_ROLES)),
):
    """Get claims pending human review."""
    all_claims = list(claims_store.values())

    # Merge with DB so queue survives an API restart
    if _db_available:
        memory_refs = {c["claim_reference"] for c in all_claims}
        for db_claim in _load_claims_from_db({"status": "HITL_PENDING"}):
            db_ref = db_claim.get("claim_reference")
            if db_ref and db_ref not in memory_refs:
                claims_store[db_ref] = db_claim
                all_claims.append(db_claim)

    hitl_items = [c for c in all_claims if c.get("status") == "HITL_PENDING"
                  or c.get("hitl_status") == "HITL_PENDING"]
    if market_region and market_region.upper() != "ALL":
        hitl_items = [
            c for c in hitl_items
            if (c.get("market_region") or "").upper() == market_region.upper()
        ]

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    overdue_count = 0
    enriched_items = []
    for c in hitl_items:
        dl = c.get("sla_deadline")
        if dl:
            dl_dt = datetime.fromisoformat(dl) if isinstance(dl, str) else dl
            if dl_dt.tzinfo is not None:
                dl_dt = dl_dt.replace(tzinfo=None)
            if dl_dt < now_utc:
                overdue_count += 1

        # ── Enrich each HITL item with full LLM analysis fields ──
        # These are produced by the pipeline but need to be surfaced to reviewers.
        settlement = c.get("settlement") or {}
        enriched = dict(c)
        enriched["priority"]              = c.get("hitl_priority") or c.get("priority") or 5
        enriched["hitl_priority"]         = enriched["priority"]
        enriched["hitl_sla_hours"]        = c.get("hitl_sla_hours")
        enriched["hitl_priority_reason"]  = c.get("hitl_priority_reason")
        enriched["ai_flags"]              = c.get("ai_flags") or []
        enriched["regulatory_compliance"] = c.get("regulatory_compliance")
        enriched["regulatory_violations"] = c.get("regulatory_violations") or []
        enriched["regulatory_citations"]  = c.get("regulatory_citations") or []
        enriched["ai_citations"]          = (
            c.get("ai_citations")
            or settlement.get("ai_citations")
            or []
        )
        enriched["policy_citations"]      = (
            c.get("policy_citations")
            or settlement.get("policy_citations")
            or []
        )
        enriched["agent_assignments"]      = _build_hitl_agent_assignments(enriched)
        enriched["agent_lane_assignments"] = enriched["agent_assignments"]
        enriched["assigned_to"]            = ", ".join(
            assignment["label"] for assignment in enriched["agent_assignments"]
        )
        enriched_items.append(enriched)

    enriched_items.sort(
        key=lambda item: (
            int(item.get("priority") or item.get("hitl_priority") or 5),
            str(item.get("sla_deadline") or item.get("date_received") or item.get("service_date") or ""),
            str(item.get("claim_reference") or ""),
        )
    )
    total = len(enriched_items)
    start = (page - 1) * limit
    end = start + limit

    return {
        "items":         enriched_items[start:end],
        "total":         total,
        "pending_count": total,
        "overdue_count": overdue_count,
        "page":          page,
        "page_size":     limit,
    }


@app.post("/api/v1/hitl/{claim_reference}/decide", tags=["HITL"])
@limiter.limit(LIMIT_STANDARD)
async def hitl_decision(
    request: Request,
    claim_reference: str,
    decision: HITLDecisionCreate,
    current_user: CurrentUser = Depends(require_roles(*HITL_ROLES)),
):
    """Submit a HITL review decision."""
    # _hitl_lock covers the full read→validate→update→DB-persist sequence so that
    # two concurrent reviewers cannot both see HITL_PENDING and double-process the
    # same claim.  The lock is held until after the DB write completes.
    with _hitl_lock:
        claim = claims_store.get(claim_reference)

        if not claim and _db_available:
            for db_claim in _load_claims_from_db({"status": "HITL_PENDING", "search": claim_reference}):
                if db_claim.get("claim_reference") == claim_reference:
                    claim = db_claim
                    claims_store[claim_reference] = db_claim
                    break

        # 404 if the claim doesn't exist or has never been through HITL workflow
        if not claim:
            raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")

        claim_status = claim.get("status", "")
        if claim_status not in ("HITL_PENDING", "HITL_APPROVED", "HITL_DENIED"):
            raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")

        # 409 if another adjudicator already reviewed this claim
        if claim_status != "HITL_PENDING":
            raise HTTPException(
                status_code=409,
                detail="This claim has already been reviewed by another adjudicator",
            )

        claim["hitl_status"] = "HITL_COMPLETED"
        claim["hitl_decision"] = decision.decision
        claim["hitl_justification"] = decision.justification

        if decision.decision == "APPROVE_AI":
            claim["status"] = "SETTLED"
        elif decision.decision == "OVERRIDE_AMOUNT":
            if decision.override_amount is None:
                raise HTTPException(status_code=422, detail="override_amount is required for OVERRIDE_AMOUNT decision")
            claim["status"] = "SETTLED"
            claim["total_settlement"] = str(decision.override_amount)
            if not isinstance(claim.get("settlement"), dict):
                claim["settlement"] = {}
            claim["settlement"]["hitl_override"] = str(decision.override_amount)
        elif decision.decision == "DENY_CLAIM":
            claim["status"] = "DENIED"
        elif decision.decision == "ESCALATE":
            claim["status"] = "HITL_PENDING"
            claim["hitl_status"] = "HITL_PENDING"

        result_status = claim["status"]

        # Persist the updated claim to DB while still inside the lock so no
        # concurrent reader can load a stale HITL_PENDING state from the DB.
        if _db_available:
            try:
                from services.audit_service.app.audit import persist_hitl_decision
                _with_sync_session(
                    lambda db: persist_hitl_decision(
                        db,
                        claim_reference=claim_reference,
                        decision=decision.decision,
                        justification=decision.justification,
                        new_status=result_status,
                        reviewer=getattr(current_user, "email", "unknown"),
                    )
                )
            except Exception as _db_err:
                # DB write failure is non-fatal — claim is already updated in memory.
                # Log a warning so operators know to reconcile if DB comes back.
                logger.warning(
                    "[HITL-DECIDE] DB persist failed for %s (decision=%s, new_status=%s): %s",
                    claim_reference, decision.decision, result_status, _db_err,
                )

    return {"claim_reference": claim_reference, "status": result_status, "decision": decision.decision}


@app.post("/api/v1/hitl/{claim_reference}/re-adjudicate", tags=["HITL"])
@limiter.limit(LIMIT_STANDARD)
async def re_adjudicate_claim(
    request: Request,
    claim_reference: str,
    current_user: CurrentUser = Depends(require_roles(*HITL_ROLES)),
):
    """Re-run AI adjudication for a HITL-pending claim.

    Re-processes the claim through the full pipeline (rules engine + LLM +
    policy library citation lookup) and refreshes citations, settlement
    amounts, and confidence scores — while keeping the claim in HITL_PENDING
    state so the reviewer can make a final decision with the updated analysis.
    """
    claim = claims_store.get(claim_reference)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_reference} not found")
    if claim.get("hitl_status") != "HITL_PENDING":
        raise HTTPException(status_code=400, detail="Claim is not pending HITL review")

    # Use the stored claim dict as input — pipeline.adjudicate() accepts this
    # directly (it was originally produced by the same pipeline).
    claim_data = dict(claim)
    claim_data["_force_ai_reasoning"] = True
    claim_data["force_ai_reasoning"] = True

    # pipeline.adjudicate() does direct dict["key"] access (not .get()) on several
    # fields.  Stored claims (especially ones loaded from DB or submitted as JSON)
    # may be missing some of these.  Provide safe defaults so re-adjudication never
    # raises a KeyError on a missing field.
    _PIPELINE_REQUIRED_DEFAULTS: dict = {
        "provider_code":          "UNKNOWN",
        "member_number":          claim_data.get("member_number", "UNKNOWN"),
        "claim_type":             "OUTPATIENT",
        "service_date":           claim_data.get("service_date", ""),
        "market_region":          claim_data.get("market_region", "UAE"),
        "patient_name":           "",
        "provider_name":          "",
        "primary_diagnosis_code": "",
        "policy_number":          "",
        "currency":               "AED",
        "line_items":             [],
    }
    for _k, _v in _PIPELINE_REQUIRED_DEFAULTS.items():
        claim_data.setdefault(_k, _v)

    db_session = None
    try:
        from shared.db_sync import get_sync_db
        db_session = get_sync_db()
    except Exception as exc:
        logger.warning("DB session unavailable for re-adjudication: %s", exc)

    try:
        # Check if async processing is enabled
        _cfg = config_store.load()
        if _cfg.get("async_processing_enabled", True):
            # Async path: LLM and settlement run in parallel
            result = await pipeline.adjudicate_async(claim_data, db_session=db_session)
        else:
            # Sync path: sequential processing (backward compatible)
            result = pipeline.adjudicate(claim_data, db_session=db_session)
    except Exception as exc:
        if db_session:
            try:
                db_session.rollback()
            except Exception:
                pass
        raise HTTPException(
            status_code=500, detail=f"Re-adjudication pipeline failed: {exc}"
        ) from exc
    finally:
        if db_session:
            try:
                db_session.close()
            except Exception:
                pass

    # Merge fresh result back into the store, preserving HITL-pending state
    # so the claim remains in the review queue for a final human decision.
    with _hitl_lock:
        result["claim_reference"] = claim_reference           # ensure ref unchanged
        result["status"] = "HITL_PENDING"                     # keep in queue
        result["hitl_status"] = "HITL_PENDING"                # keep in queue
        result["hitl_reason"] = claim.get("hitl_reason", "RE_VERIFIED")
        result["re_adjudicated_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        result["re_adjudicated_by"] = getattr(current_user, "email", "unknown")
        claims_store[claim_reference] = result

    return {
        "claim_reference": claim_reference,
        "message": "Claim re-adjudicated successfully",
        "ai_settlement_amount": result.get("total_settlement"),
        "confidence_score": result.get("confidence_score"),
        "policy_citations_count": len(result.get("policy_citations") or []),
        "ai_citations_count": len(result.get("ai_citations") or []),
    }


# ═══════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════

@app.get("/api/v1/dashboard/kpis", tags=["Dashboard"])
async def dashboard_kpis(
    date_from: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    market_region: Optional[str] = Query(None),
    display_currency: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get real-time dashboard KPIs with optional date filtering."""
    db_available = _refresh_db_availability()
    resolved_display_currency = _resolve_dashboard_display_currency(market_region, display_currency)
    reliability_metrics = _with_sync_session(lambda db: get_reliability_snapshot(db), default=get_reliability_snapshot())
    compliance_drift = {}
    if pipeline and getattr(pipeline, "regional_clauses", None):
        for market, clauses in pipeline.regional_clauses.items():
            drift = compliance_store.detect_drift(market, clauses)
            compliance_drift[market] = drift["drift_detected"]
    claims = list(claims_store.values())

    # Merge with DB so KPIs survive an API restart
    if db_available:
        memory_refs = {c["claim_reference"] for c in claims}
        filters = {"tenant_id": current_user.tenant_id} if current_user.role not in {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"} else None
        for db_claim in _load_claims_from_db(filters):
            if db_claim.get("claim_reference") not in memory_refs:
                claims.append(db_claim)

    claims = _filter_claims_for_user(claims, current_user)

    # Date range filtering
    if date_from or date_to:
        filtered_claims = []
        for c in claims:
            received = c.get("date_received")
            if not received:
                continue  # Skip claims without date_received

            received_str = str(received)[:10]  # YYYY-MM-DD

            if date_from and received_str < date_from:
                continue
            if date_to and received_str > date_to:
                continue

            filtered_claims.append(c)

        claims = filtered_claims

    if market_region:
        claims = [
            c for c in claims
            if (c.get("market_region") or "").upper() == market_region.upper()
        ]

    total = len(claims)

    if total == 0:
        return {
            "total_claims": 0, "claims_today": 0, "avg_processing_time_ms": 0,
            "auto_adjudication_rate": 0, "avg_confidence_score": 0,
            "total_settled_amount": "0", "display_currency": resolved_display_currency, "pending_hitl_count": 0,
            "overdue_hitl_count": 0, "denial_rate": 0,
            "top_denial_reasons": [], "claims_by_status": {},
            "claims_by_market": {}, "db_available": db_available,
            # New: pipeline flow, fraud prevention, SLA
            "pipeline_stages": {"ingestion": 0, "processing": 0, "risk_review": 0, "settled": 0, "denied": 0},
            "fraud_prevented_today": "0",
            "total_fraud_prevented": "0",
            "sla_compliance_rate": 100.0,
            "sla_target_ms": 2000,
            "avg_processing_ms": 0,
            "native_observability": {
                "stage_averages_ms": {},
                "stage_status_counts": {},
                "agent_status_counts": {},
                "validation_signal_rates": {},
                "hitl_priority_distribution": {},
                "sla_breach_risk_count": 0,
            },
            "reliability_metrics": reliability_metrics,
            "compliance_drift": compliance_drift,
        }

    from datetime import date as _date
    today_str = _date.today().isoformat()  # e.g. "2026-02-24"

    def _date_str(val) -> str:
        """Normalise date_received (datetime, str, or None) to a YYYY-MM-DD string."""
        if val is None:
            return ""
        s = str(val)          # handles datetime objects and ISO strings
        return s[:10]         # "2026-02-24T..." → "2026-02-24"

    # Bug fixes applied here (7 calculation errors):
    #
    # 1. settled: include HITL_APPROVED — those claims are also financially settled.
    # 2. denied:  include HITL_DENIED + ERROR — denial_rate was understated.
    # 3. hitl_pending: use status only — the `or hitl_status == "HITL_PENDING"`
    #    clause incorrectly counted closed/denied claims still carrying a stale
    #    hitl_status from a previous workflow state.
    # 4. avg_time: filter to claims that have been processed (>0 ms) — including
    #    pending/unprocessed claims (0 ms) artificially lowered the average.
    # 5. auto_rate: denominator must be decided claims only — using total (which
    #    includes pending/processing) made the rate drop as the queue grew.
    # 6. avg_conf: filter to claims with a real confidence score (>0) — unscored
    #    claims contributed 0.0 and pulled the average down.
    # 7. total_settled: use `or "0"` guard — str(None) = "None" crashes Decimal
    #    for DB-sourced claims not run through _normalize_claim.

    settled      = [c for c in claims if c.get("status") in ("SETTLED", "HITL_APPROVED")]
    denied       = [c for c in claims if c.get("status") in ("DENIED", "HITL_DENIED", "ERROR")]
    hitl_pending = [c for c in claims if c.get("status") == "HITL_PENDING"]
    claims_today = [c for c in claims if _date_str(c.get("date_received")) == today_str]

    # Overdue: sla_deadline set and now past it
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    overdue = []
    for c in hitl_pending:
        dl = c.get("sla_deadline")
        if dl:
            dl_dt = datetime.fromisoformat(dl) if isinstance(dl, str) else dl
            # Strip tzinfo for naive comparison
            if dl_dt.tzinfo is not None:
                dl_dt = dl_dt.replace(tzinfo=None)
            if dl_dt < now_utc:
                overdue.append(c)

    # avg processing time — only over claims that have actually been timed
    processed_claims = [c for c in claims if float(c.get("processing_time_ms") or 0) > 0]
    avg_time = (
        sum(float(c.get("processing_time_ms", 0)) for c in processed_claims) / len(processed_claims)
        if processed_claims else 0
    )

    # auto-adjudication rate — denominator is decided claims only (not pending/processing)
    decided = [c for c in claims if c.get("status") in (
        "SETTLED", "HITL_APPROVED", "DENIED", "HITL_DENIED", "ERROR"
    )]
    auto_adj = [c for c in decided if c.get("status") == "SETTLED" and not c.get("hitl_status")]
    auto_rate = len(auto_adj) / len(decided) * 100 if decided else 0

    # avg confidence — only over claims that carry a real score
    scored_claims = [c for c in claims if float(c.get("confidence_score") or 0) > 0]
    avg_conf = (
        sum(float(c.get("confidence_score", 0)) for c in scored_claims) / len(scored_claims)
        if scored_claims else 0
    )

    total_settled = sum(
        _convert_currency_amount(
            c.get("total_settlement"),
            c.get("currency"),
            resolved_display_currency,
        )
        for c in settled
    )

    status_counts: dict = {}
    market_counts: dict = {}
    for c in claims:
        s = c.get("status", "UNKNOWN")
        status_counts[s] = status_counts.get(s, 0) + 1
        m = c.get("market_region", "UNKNOWN")
        market_counts[m] = market_counts.get(m, 0) + 1

    # ── Top denial reasons ─────────────────────────────────────────────────────
    denial_tally: dict = {}
    for c in claims:
        # 1. Explicit denial_reason on line items (richest source)
        for li in c.get("line_items", []):
            reason = li.get("denial_reason") or li.get("denial_code")
            if reason:
                denial_tally[reason] = denial_tally.get(reason, 0) + 1
        # 2. AI flags
        for flag in c.get("ai_flags", []):
            reason = flag.get("flag_type") or flag.get("reason") if isinstance(flag, dict) else str(flag)
            if reason:
                denial_tally[reason] = denial_tally.get(reason, 0) + 1
        # 3. HITL reason
        hitl_reason = c.get("hitl_reason")
        if hitl_reason and c.get("status") in ("DENIED", "HITL_PENDING"):
            denial_tally[hitl_reason] = denial_tally.get(hitl_reason, 0) + 1

    top_denial_reasons = [
        {"reason": reason, "count": count}
        for reason, count in sorted(denial_tally.items(), key=lambda x: x[1], reverse=True)[:5]
    ]

    # ── Pipeline stage counts ──────────────────────────────────────────────────
    pipeline_stages = {
        "ingestion":   len([c for c in claims if c.get("status") == "PENDING"]),
        "processing":  len([c for c in claims if c.get("status") == "PROCESSING"]),
        "risk_review": len([c for c in claims if c.get("status") == "HITL_PENDING"]),
        "settled":     len([c for c in claims if c.get("status") in ("SETTLED", "HITL_APPROVED")]),
        "denied":      len([c for c in claims if c.get("status") in ("DENIED", "ERROR", "HITL_DENIED")]),
    }

    # ── Fraud / blocked claims value ───────────────────────────────────────────
    denied_statuses = {"DENIED", "ERROR", "HITL_DENIED"}
    denied_all_claims = [c for c in claims if c.get("status") in denied_statuses]
    denied_today_list = [
        c for c in denied_all_claims
        if _date_str(c.get("date_received")) == today_str
    ]
    total_fraud_prevented = sum(
        _convert_currency_amount(
            c.get("total_billed"),
            c.get("currency"),
            resolved_display_currency,
        )
        for c in denied_all_claims
    )
    fraud_prevented_today = sum(
        _convert_currency_amount(
            c.get("total_billed"),
            c.get("currency"),
            resolved_display_currency,
        )
        for c in denied_today_list
    )

    # ── SLA compliance (target: 2 000 ms) ─────────────────────────────────────
    SLA_TARGET_MS = 2000
    claims_timed = [
        c for c in claims
        if c.get("processing_time_ms") and float(c.get("processing_time_ms") or 0) > 0
    ]
    if claims_timed:
        sla_ok     = len([c for c in claims_timed if float(c.get("processing_time_ms") or 0) <= SLA_TARGET_MS])
        sla_rate   = round(sla_ok / len(claims_timed) * 100, 1)
        avg_ms_val = int(sum(float(c.get("processing_time_ms") or 0) for c in claims_timed) / len(claims_timed))
    else:
        sla_rate   = 100.0
        avg_ms_val = int(avg_time)

    stage_duration_totals: dict[str, int] = {}
    stage_duration_counts: dict[str, int] = {}
    stage_status_counts: dict[str, dict[str, int]] = {}
    agent_status_counts: dict[str, int] = {}
    validation_pass_counts: dict[str, int] = {}
    validation_total_counts: dict[str, int] = {}
    hitl_priority_distribution: dict[str, int] = {}
    sla_breach_risk_count = 0

    for c in claims:
        stage_report = c.get("pipeline_stage_report") or {}
        if isinstance(stage_report, dict):
            for stage in stage_report.get("stages") or []:
                if not isinstance(stage, dict):
                    continue
                stage_id = str(stage.get("stage") or "unknown")
                status = str(stage.get("status") or "UNKNOWN")
                duration = int(stage.get("duration_ms") or 0)
                stage_status_counts.setdefault(stage_id, {})
                stage_status_counts[stage_id][status] = stage_status_counts[stage_id].get(status, 0) + 1
                if duration > 0:
                    stage_duration_totals[stage_id] = stage_duration_totals.get(stage_id, 0) + duration
                    stage_duration_counts[stage_id] = stage_duration_counts.get(stage_id, 0) + 1

        agent_metrics = c.get("agent_status_metrics") or {}
        if isinstance(agent_metrics, dict):
            for agent in agent_metrics.values():
                if isinstance(agent, dict):
                    status = str(agent.get("status") or "UNKNOWN")
                    agent_status_counts[status] = agent_status_counts.get(status, 0) + 1

        signals = c.get("validation_signals") or {}
        if isinstance(signals, dict):
            document_gate = signals.get("document_gate") or {}
            if isinstance(document_gate, dict):
                for signal_name, passed in (document_gate.get("signals") or {}).items():
                    validation_total_counts[signal_name] = validation_total_counts.get(signal_name, 0) + 1
                    if passed:
                        validation_pass_counts[signal_name] = validation_pass_counts.get(signal_name, 0) + 1

        priority = c.get("hitl_priority") or c.get("priority")
        if c.get("status") == "HITL_PENDING" and priority:
            key = str(priority)
            hitl_priority_distribution[key] = hitl_priority_distribution.get(key, 0) + 1
            dl = c.get("sla_deadline")
            if dl:
                try:
                    dl_dt = datetime.fromisoformat(str(dl).replace("Z", "+00:00"))
                    if dl_dt.tzinfo is not None:
                        dl_dt = dl_dt.replace(tzinfo=None)
                    remaining_hours = (dl_dt - now_utc).total_seconds() / 3600
                    if 0 <= remaining_hours <= 4:
                        sla_breach_risk_count += 1
                except Exception:
                    pass

    native_observability = {
        "stage_averages_ms": {
            stage: int(stage_duration_totals[stage] / stage_duration_counts[stage])
            for stage in stage_duration_totals
            if stage_duration_counts.get(stage)
        },
        "stage_status_counts": stage_status_counts,
        "agent_status_counts": agent_status_counts,
        "validation_signal_rates": {
            signal: round((validation_pass_counts.get(signal, 0) / total_count) * 100, 1)
            for signal, total_count in validation_total_counts.items()
            if total_count > 0
        },
        "hitl_priority_distribution": hitl_priority_distribution,
        "sla_breach_risk_count": sla_breach_risk_count,
    }

    return {
        "total_claims":          total,
        "claims_today":          len(claims_today),
        "avg_processing_time_ms": int(avg_time),
        "auto_adjudication_rate": round(auto_rate, 1),
        "avg_confidence_score":   round(avg_conf, 1),
        "total_settled_amount":   str(total_settled),
        "display_currency":       resolved_display_currency,
        "pending_hitl_count":     len(hitl_pending),
        "overdue_hitl_count":     len(overdue),
        "denial_rate":            round(len(denied) / total * 100, 1) if total > 0 else 0,
        "top_denial_reasons":     top_denial_reasons,
        "claims_by_status":       status_counts,
        "claims_by_market":       market_counts,
        "db_available":           db_available,
        # ── New: pipeline flow, fraud prevention, SLA ──────────────────────────
        "pipeline_stages":        pipeline_stages,
        "fraud_prevented_today":  str(fraud_prevented_today),
        "total_fraud_prevented":  str(total_fraud_prevented),
        "sla_compliance_rate":    sla_rate,
        "sla_target_ms":          SLA_TARGET_MS,
        "avg_processing_ms":      avg_ms_val,
        "native_observability":   native_observability,
        "reliability_metrics":    reliability_metrics,
        "compliance_drift":       compliance_drift,
    }


# ═══════════════════════════════════════════
# DASHBOARD — VOLUME (daily time-series)
# ═══════════════════════════════════════════

@app.get("/api/v1/dashboard/volume", tags=["Dashboard"])
async def dashboard_volume(
    days: int = 14,
    date_from: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    market_region: Optional[str] = Query(None),
    display_currency: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get daily claims volume for the last N days (max 90).

    If date_from/date_to are provided, they override the 'days' parameter
    and return daily volumes for that specific date range.
    """
    from datetime import date as _date, timedelta as _td, datetime as _dt, timezone
    resolved_display_currency = _resolve_dashboard_display_currency(market_region, display_currency)

    claims = list(claims_store.values())
    db_available = _refresh_db_availability()
    if db_available:
        memory_refs = {c["claim_reference"] for c in claims}
        filters = {"tenant_id": current_user.tenant_id} if current_user.role not in {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"} else None
        for db_claim in _load_claims_from_db(filters):
            if db_claim.get("claim_reference") not in memory_refs:
                claims.append(db_claim)

    claims = _filter_claims_for_user(claims, current_user)

    # Apply market filter
    if market_region:
        claims = [c for c in claims if (c.get("market_region") or "").upper() == market_region.upper()]

    # Determine date range
    if date_from and date_to:
        # Use explicit date range
        start_date = _dt.strptime(date_from, "%Y-%m-%d").date()
        end_date = _dt.strptime(date_to, "%Y-%m-%d").date()

        # Generate list of days in range
        date_list = []
        current = start_date
        while current <= end_date:
            date_list.append(current)
            current += _td(days=1)
    else:
        # Use days parameter (last N days from today)
        days = min(max(1, days), 90)
        today = _date.today()
        date_list = [today - _td(days=i) for i in range(days - 1, -1, -1)]

    result = []
    for day in date_list:
        day_str = day.isoformat()   # "YYYY-MM-DD"

        day_claims  = [
            c for c in claims
            if str(c.get("date_received") or c.get("service_date") or "")[:10] == day_str
        ]
        day_fraud   = [c for c in day_claims if c.get("status") in {"DENIED", "ERROR", "HITL_DENIED"}]
        day_settled = [c for c in day_claims if c.get("status") in {"SETTLED", "HITL_APPROVED"}]

        day_amount = sum(
            float(
                _convert_currency_amount(
                    c.get("total_billed"),
                    c.get("currency"),
                    resolved_display_currency,
                )
            )
            for c in day_claims
        )

        result.append({
            "date":    day_str,
            "claims":  len(day_claims),
            "fraud":   len(day_fraud),
            "settled": len(day_settled),
            "amount":  round(day_amount, 2),
        })

    return {"days": result, "total_days": len(date_list)}


# ═══════════════════════════════════════════
# HEALTH — LIVE SERVICE STATUS
# ═══════════════════════════════════════════

@app.get("/api/v1/health/live", tags=["System"])
async def health_live(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get live service health status (API / DB / Redis / LLM). Requires auth."""
    import os as _os
    db_available = _refresh_db_availability()

    # Build Redis URL from REDIS_URL or fallback to REDIS_HOST + REDIS_PORT
    _redis_url = _os.getenv("REDIS_URL", "").strip()
    if not _redis_url:
        _rhost = _os.getenv("REDIS_HOST", "").strip()
        _rport = _os.getenv("REDIS_PORT", "6379").strip()
        if _rhost:
            _redis_url = f"redis://{_rhost}:{_rport}"

    redis_alive = False
    if _redis_url:
        try:
            import redis as _redis_lib
            _rc = _redis_lib.from_url(_redis_url, socket_connect_timeout=1, socket_timeout=1)
            _rc.ping()
            redis_alive = True
        except Exception:
            redis_alive = False

    llm_configured   = bool(
        _os.getenv("GROQ_API_KEY", "").strip() or
        _os.getenv("ANTHROPIC_API_KEY", "").strip()
    )

    return {
        "api":   True,
        "db":    db_available,
        "redis": redis_alive,
        "llm":   llm_configured,
    }


# ═══════════════════════════════════════════
# DEMO / SAMPLE DATA
# ═══════════════════════════════════════════

@app.get("/api/v1/demo/sample-claims", tags=["Demo"])
async def get_sample_claims(
    current_user: CurrentUser = Depends(require_roles("ADMIN")),
):
    """Get pre-built sample claims for testing the API. ADMIN + ENABLE_DEMO_ENDPOINTS=true only."""
    if not _ENABLE_DEMO:
        raise HTTPException(status_code=404, detail="Demo endpoints are disabled in this environment")
    with open(FIXTURES / "sample_claims" / "claims.json") as f:
        return json.load(f)


@app.post("/api/v1/demo/run-all-samples", tags=["Demo"])
async def run_all_sample_claims(
    current_user: CurrentUser = Depends(require_roles("ADMIN")),
):
    """Submit all sample claims and return results. ADMIN + ENABLE_DEMO_ENDPOINTS=true only."""
    if not _ENABLE_DEMO:
        raise HTTPException(status_code=404, detail="Demo endpoints are disabled in this environment")
    with open(FIXTURES / "sample_claims" / "claims.json") as f:
        sample_claims = json.load(f)

    # Acquire one DB session for the batch
    db_session = None
    try:
        from shared.db_sync import get_sync_db
        db_session = get_sync_db()
    except Exception:
        pass

    results = []
    try:
        for claim_data in sample_claims:
            for li in claim_data.get("line_items", []):
                li["billed_amount"] = float(li["billed_amount"])
            result = pipeline.adjudicate(claim_data, db_session=db_session)
            claims_store[result["claim_reference"]] = result
            results.append({
                "claim_reference": result["claim_reference"],
                "original_reference": claim_data.get("claim_reference"),
                "status": result.get("status"),
                "total_billed": result.get("total_billed"),
                "total_settlement": result.get("total_settlement"),
                "total_member_responsibility": result.get("total_member_responsibility"),
                "confidence_score": result.get("confidence_score"),
                "hitl_status": result.get("hitl_status"),
                "processing_time_ms": result.get("processing_time_ms"),
                "ai_citations_count": len(result.get("ai_citations", [])),
                "policy_citations_count": len(result.get("policy_citations", [])),
            })
    finally:
        if db_session:
            try:
                db_session.close()
            except Exception:
                pass

    return {
        "total_processed": len(results),
        "db_persisted": db_session is not None,
        "results": results,
    }


# ═══════════════════════════════════════════
# ADMIN REPORTS
# ═══════════════════════════════════════════

_REPORT_CATEGORIES = {"claims", "settlements", "hitl", "denials", "processing"}

_CATEGORY_STATUS_FILTER: dict[str, Optional[set]] = {
    "claims":      None,                                          # all statuses
    "settlements": {"SETTLED"},
    "hitl":        {"HITL_PENDING", "HITL_APPROVED", "HITL_DENIED"},
    "denials":     {"DENIED", "ERROR"},
    "processing":  None,                                          # all statuses
}


def _report_columns(category: str) -> list[dict]:
    """Return [{key, label}] column definitions for the given report category."""
    base = [
        {"key": "claim_reference",  "label": "Claim Reference"},
        {"key": "status",           "label": "Status"},
        {"key": "market_region",    "label": "Market"},
        {"key": "patient_name",     "label": "Patient"},
        {"key": "provider_name",    "label": "Provider"},
        {"key": "date_received",    "label": "Date Received"},
    ]
    extras: dict[str, list[dict]] = {
        "claims": [
            {"key": "total_billed",       "label": "Total Billed"},
            {"key": "total_settlement",   "label": "Settlement"},
            {"key": "confidence_score",   "label": "Confidence"},
            {"key": "processing_time_ms", "label": "Processing (ms)"},
        ],
        "settlements": [
            {"key": "total_billed",               "label": "Total Billed"},
            {"key": "total_settlement",           "label": "Settlement"},
            {"key": "total_copay",                "label": "Copay"},
            {"key": "total_deductible",           "label": "Deductible"},
            {"key": "total_member_responsibility","label": "Member Resp."},
            {"key": "network_tier",               "label": "Network Tier"},
        ],
        "hitl": [
            {"key": "total_billed",           "label": "Total Billed"},
            {"key": "hitl_reason",            "label": "HITL Reason"},
            {"key": "sla_deadline",           "label": "SLA Deadline"},
            {"key": "agent_agreement_score",  "label": "Agent Agreement"},
        ],
        "denials": [
            {"key": "total_billed",          "label": "Total Billed"},
            {"key": "error_code",            "label": "Error Code"},
            {"key": "regulatory_violations", "label": "Reg. Violations"},
        ],
        "processing": [
            {"key": "claim_type",         "label": "Claim Type"},
            {"key": "total_billed",       "label": "Total Billed"},
            {"key": "confidence_score",   "label": "Confidence"},
            {"key": "processing_time_ms", "label": "Processing (ms)"},
        ],
    }
    return base + extras.get(category, [])


def _build_report_row(category: str, claim: dict) -> dict:
    """Flatten a claim dict to a report row for the given category."""
    violations = claim.get("regulatory_violations") or []
    viol_str = f"{len(violations)} violation(s)" if violations else "None"

    return {
        "claim_reference":            claim.get("claim_reference", ""),
        "status":                     claim.get("status", ""),
        "market_region":              claim.get("market_region", ""),
        "patient_name":               claim.get("patient_name", ""),
        "provider_name":              claim.get("provider_name", ""),
        "date_received":              str(claim.get("date_received") or claim.get("service_date") or ""),
        "total_billed":               str(claim.get("total_billed") or ""),
        "total_settlement":           str(claim.get("total_settlement") or ""),
        "total_copay":                str(claim.get("total_copay") or ""),
        "total_deductible":           str(claim.get("total_deductible") or ""),
        "total_member_responsibility":str(claim.get("total_member_responsibility") or ""),
        "network_tier":               claim.get("network_tier", ""),
        "confidence_score":           str(claim.get("confidence_score") or ""),
        "processing_time_ms":         str(claim.get("processing_time_ms") or ""),
        "claim_type":                 claim.get("claim_type", ""),
        "hitl_reason":                claim.get("hitl_reason", "") or "",
        "sla_deadline":               str(claim.get("sla_deadline") or ""),
        "agent_agreement_score":      str(claim.get("agent_agreement_score") or ""),
        "error_code":                 claim.get("error_code", "") or claim.get("status", ""),
        "regulatory_violations":      viol_str,
    }


@app.get("/api/v1/admin/reports", tags=["Admin"])
async def admin_reports(
    category:      str       = Query("claims", description="Report category: claims, settlements, hitl, denials, processing"),
    date_from:     Optional[str] = Query(None,     description="Start date YYYY-MM-DD (inclusive)"),
    date_to:       Optional[str] = Query(None,     description="End date YYYY-MM-DD (inclusive)"),
    market_region: Optional[str] = Query(None,     description="Filter by market: UAE, KSA, INDIA, etc."),
    page:          int        = Query(1,  ge=1),
    page_size:     int        = Query(50, ge=1, le=10_000),
    current_user:  CurrentUser = Depends(require_roles("ADMIN")),
):
    """
    Generate admin reports with category and period filtering.
    Returns paginated records with dynamic column definitions for CSV export.

    Categories:
    - claims:      All claims (summary view)
    - settlements: Settled claims with copay/deductible breakdown
    - hitl:        Claims in HITL workflow
    - denials:     Denied / errored claims
    - processing:  Processing performance (confidence, timing)
    """
    if category not in _REPORT_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category '{category}'. Must be one of: {sorted(_REPORT_CATEGORIES)}",
        )

    # ── 1. Merge memory + DB ──────────────────────────────────────────────────
    claims = list(claims_store.values())
    if _db_available:
        memory_refs = {c["claim_reference"] for c in claims}
        for db_claim in _load_claims_from_db({}):
            if db_claim.get("claim_reference") not in memory_refs:
                claims.append(db_claim)

    # ── 2. Date filter ─────────────────────────────────────────────────────────
    def _claim_date(c: dict) -> "Optional[datetime]":
        raw = c.get("date_received") or c.get("service_date")
        if not raw:
            return None
        try:
            if isinstance(raw, datetime):
                return raw.replace(tzinfo=None)
            s = str(raw)[:10]           # keep "YYYY-MM-DD" prefix only
            return datetime.strptime(s, "%Y-%m-%d")
        except (ValueError, TypeError):
            return None

    if date_from:
        try:
            df = datetime.strptime(date_from, "%Y-%m-%d")
            claims = [c for c in claims if (d := _claim_date(c)) is not None and d >= df]
        except ValueError:
            raise HTTPException(status_code=400, detail="date_from must be YYYY-MM-DD")

    if date_to:
        try:
            dt = datetime.strptime(date_to, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            claims = [c for c in claims if (d := _claim_date(c)) is not None and d <= dt]
        except ValueError:
            raise HTTPException(status_code=400, detail="date_to must be YYYY-MM-DD")

    # ── 3. Market filter ───────────────────────────────────────────────────────
    if market_region:
        claims = [c for c in claims if c.get("market_region") == market_region]

    # ── 4. Category status filter ──────────────────────────────────────────────
    allowed_statuses = _CATEGORY_STATUS_FILTER.get(category)
    if allowed_statuses:
        claims = [c for c in claims if c.get("status") in allowed_statuses]

    # ── 5. Sort newest first ───────────────────────────────────────────────────
    claims.sort(
        key=lambda c: str(c.get("date_received") or c.get("service_date") or ""),
        reverse=True,
    )

    # ── 6. Build flat report rows ──────────────────────────────────────────────
    records = [_build_report_row(category, c) for c in claims]

    # ── 7. Paginate ────────────────────────────────────────────────────────────
    total = len(records)
    start = (page - 1) * page_size
    end   = start + page_size

    return {
        "category":      category,
        "total_records": total,
        "page":          page,
        "page_size":     page_size,
        "records":       records[start:end],
        "columns":       _report_columns(category),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
