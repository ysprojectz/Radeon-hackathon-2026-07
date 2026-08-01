"""
HMS Integration Router
======================
Handles Hospital Management System (HMS) webhook registration and inbound events.

Admin endpoints (ADMIN role only):
  GET    /api/v1/admin/hms-sources                      — list registered sources
  POST   /api/v1/admin/hms-sources                      — register new source
  PATCH  /api/v1/admin/hms-sources/{source_id}          — update / toggle enabled
  DELETE /api/v1/admin/hms-sources/{source_id}          — remove source
  POST   /api/v1/admin/hms-sources/{source_id}/test     — test pull connectivity

Webhook endpoint (public — HMAC-SHA256 verified):
  POST   /api/v1/webhooks/hms/{source_id}               — receive HMS notification

Webhook flow:
  1. HMS sends POST /api/v1/webhooks/hms/{source_id} with X-Hub-Signature-256 header
  2. Router verifies HMAC-SHA256 signature against stored webhook_secret
  3. Returns HTTP 200 immediately (so HMS never waits on processing)
  4. Background task: pulls full claim data from HMS pull URL
  5. Maps HMS payload → ClaimCreate dict
  6. Runs through existing adjudication pipeline
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac as hmac_lib
import json
import logging
import os
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.api_gateway.app.auth import require_roles, CurrentUser
from services.api_gateway.app import hms_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["HMS Integration"])
_admin_only = require_roles("ADMIN")

VALID_REGIONS = {"UAE", "KSA", "INDIA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT", "SAUDI"}


# ════════════════════════════════════════════
# PYDANTIC MODELS
# ════════════════════════════════════════════

class HMSSourceCreate(BaseModel):
    name:             str
    market_region:    str
    pull_base_url:    str
    claim_pull_path:  str  = "/api/claims/{claim_id}"
    pull_auth_header: str  = ""
    webhook_secret:   str  = ""
    enabled:          bool = True


class HMSSourceUpdate(BaseModel):
    name:             Optional[str]  = None
    market_region:    Optional[str]  = None
    pull_base_url:    Optional[str]  = None
    claim_pull_path:  Optional[str]  = None
    pull_auth_header: Optional[str]  = None
    webhook_secret:   Optional[str]  = None
    enabled:          Optional[bool] = None


def _mask_source(src: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the source with sensitive fields masked."""
    out = dict(src)
    # Mask webhook_secret
    secret = out.get("webhook_secret") or ""
    if len(secret) > 8:
        out["webhook_secret"] = secret[:4] + "••••••••" + secret[-4:]
    elif secret:
        out["webhook_secret"] = "••••••••"
    # Mask pull_auth_header (e.g. Bearer token)
    auth = out.get("pull_auth_header") or ""
    if len(auth) > 12:
        out["pull_auth_header"] = auth[:6] + "••••••••" + auth[-4:]
    elif auth:
        out["pull_auth_header"] = "••••••••"
    return out


# ════════════════════════════════════════════
# ADMIN — LIST / CREATE / UPDATE / DELETE
# ════════════════════════════════════════════

@router.get("/api/v1/admin/hms-sources", summary="List all HMS integration sources")
async def list_hms_sources(
    _: CurrentUser = Depends(_admin_only),
) -> list[dict]:
    return [_mask_source(s) for s in hms_store.get_all()]


@router.post(
    "/api/v1/admin/hms-sources",
    status_code=status.HTTP_201_CREATED,
    summary="Register a new HMS integration source",
)
async def create_hms_source(
    body: HMSSourceCreate,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    if body.market_region.upper() not in VALID_REGIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid market_region. Must be one of: {sorted(VALID_REGIONS)}",
        )
    record = hms_store.create(
        name=body.name,
        market_region=body.market_region,
        pull_base_url=body.pull_base_url,
        claim_pull_path=body.claim_pull_path,
        pull_auth_header=body.pull_auth_header,
        webhook_secret=body.webhook_secret,
        enabled=body.enabled,
    )
    return _mask_source(record)


@router.patch(
    "/api/v1/admin/hms-sources/{source_id}",
    summary="Update an HMS integration source",
)
async def update_hms_source(
    source_id: str,
    body: HMSSourceUpdate,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "market_region" in patch and patch["market_region"].upper() not in VALID_REGIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid market_region. Must be one of: {sorted(VALID_REGIONS)}",
        )
    try:
        record = hms_store.update(source_id, patch)
        return _mask_source(record)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete(
    "/api/v1/admin/hms-sources/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
    summary="Remove an HMS integration source",
)
async def delete_hms_source(
    source_id: str,
    _: CurrentUser = Depends(_admin_only),
) -> None:
    try:
        hms_store.delete(source_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ════════════════════════════════════════════
# ADMIN — TEST CONNECTIVITY
# ════════════════════════════════════════════

@router.post(
    "/api/v1/admin/hms-sources/{source_id}/test",
    summary="Test pull connectivity for an HMS source",
)
async def test_hms_source(
    source_id: str,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    """
    Sends a GET to {pull_base_url}/ with the configured auth header.
    Returns reachability, HTTP status and latency_ms.
    """
    src = hms_store.get_by_id(source_id)
    if not src:
        raise HTTPException(status_code=404, detail=f"HMS source not found: {source_id}")

    base_url = src.get("pull_base_url", "")
    auth_header = src.get("pull_auth_header", "")
    headers: dict[str, str] = {"User-Agent": "ClaimsEngine-HMS-Test/1.0"}
    if auth_header:
        headers["Authorization"] = auth_header

    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            resp = await client.get(base_url + "/", headers=headers)
        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        ok = resp.status_code < 500
        return {
            "reachable":   ok,
            "status_code": resp.status_code,
            "latency_ms":  latency_ms,
            "detail":      f"HTTP {resp.status_code}",
        }
    except httpx.TimeoutException:
        return {
            "reachable":   False,
            "status_code": None,
            "latency_ms":  -1,
            "detail":      "Connection timed out (5s)",
        }
    except Exception as exc:
        return {
            "reachable":   False,
            "status_code": None,
            "latency_ms":  -1,
            "detail":      str(exc)[:200],
        }


# ════════════════════════════════════════════
# HMAC VERIFICATION HELPERS
# ════════════════════════════════════════════

def _verify_hmac(secret: str, body: bytes, signature_header: str | None) -> bool:
    """
    Verify X-Hub-Signature-256: sha256=<hex> header.
    - Returns True  if the signature matches.
    - Returns True  if no secret is configured only when explicitly allowed outside production.
    - Returns False if secret is set but signature is missing or wrong.
    """
    if not secret:
        environment = os.getenv("ENVIRONMENT", "development").strip().lower()
        allow_unsigned = os.getenv("ALLOW_UNSIGNED_HMS_WEBHOOKS", "false").strip().lower() in {
            "1", "true", "yes", "on"
        }
        return allow_unsigned and environment not in {"production", "prod"}
    if not signature_header:
        return False
    if not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac_lib.new(
        secret.encode("utf-8"), body, digestmod=hashlib.sha256
    ).hexdigest()
    return hmac_lib.compare_digest(expected, signature_header)


# ════════════════════════════════════════════
# HMS → ClaimCreate MAPPING
# ════════════════════════════════════════════

def _map_hms_to_claim(payload: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    """
    Map an HMS JSON payload to the ClaimCreate dict the pipeline expects.

    Supports three input formats:
      1. ClaimCreate dict already (pass-through if 'claim_type' + 'member_number' present)
      2. FHIR R4 Claim resource   (resourceType == "Claim")
      3. Generic key mapping      (best-effort field extraction)
    """
    # 1. Already our format — just inject source context
    if "claim_type" in payload and "member_number" in payload:
        payload.setdefault("market_region",  source.get("market_region", "UAE"))
        payload.setdefault("source_channel", "HMS_WEBHOOK")
        return payload

    # 2. FHIR R4 mapping
    if payload.get("resourceType") == "Claim":
        return {
            "claim_type":             _fhir_claim_type(payload),
            "market_region":          source.get("market_region", "UAE"),
            "currency":               _fhir_currency(payload),
            "member_number":          _fhir_member(payload),
            "patient_name":           _fhir_patient_name(payload),
            "patient_dob":            "1990-01-01",
            "provider_code":          _fhir_provider_code(payload),
            "provider_name":          _fhir_provider_name(payload),
            "service_date":           payload.get("billablePeriod", {}).get("start", ""),
            "primary_diagnosis_code": _fhir_diagnosis(payload),
            "line_items":             _fhir_line_items(payload),
            "source_channel":         "HMS_WEBHOOK",
        }

    # 3. Generic best-effort mapping
    return {
        "claim_type":             str(payload.get("type", payload.get("claim_type", "OUTPATIENT"))),
        "market_region":          source.get("market_region", "UAE"),
        "currency":               str(payload.get("currency", "AED")),
        "member_number":          str(payload.get("member_id", payload.get("member_number", "UNKNOWN"))),
        "patient_name":           str(payload.get("patient_name", payload.get("patient", {}).get("name", "Unknown"))),
        "patient_dob":            str(payload.get("dob", payload.get("date_of_birth", "1990-01-01"))),
        "provider_code":          str(payload.get("provider_id", payload.get("provider_code", "UNKNOWN"))),
        "provider_name":          str(payload.get("provider_name", payload.get("hospital", "Unknown Provider"))),
        "service_date":           str(payload.get("service_date", payload.get("date", ""))),
        "primary_diagnosis_code": str(payload.get("diagnosis", payload.get("icd_code", "Z00.0"))),
        "line_items":             payload.get("line_items", payload.get("items", [])),
        "source_channel":         "HMS_WEBHOOK",
    }


# FHIR R4 field extractors

def _fhir_claim_type(p: dict) -> str:
    type_code = p.get("type", {}).get("coding", [{}])[0].get("code", "")
    return "INPATIENT" if type_code in ("institutional", "oral") else "OUTPATIENT"


def _fhir_currency(p: dict) -> str:
    coding = p.get("currency", {}).get("coding", [{}])
    return coding[0].get("code", "AED") if coding else "AED"


def _fhir_member(p: dict) -> str:
    ref = p.get("insurance", [{}])[0].get("coverage", {}).get("reference", "")
    return ref.split("/")[-1] if ref else "UNKNOWN"


def _fhir_patient_name(p: dict) -> str:
    return p.get("patient", {}).get("display", "Unknown Patient")


def _fhir_provider_code(p: dict) -> str:
    ref = p.get("provider", {}).get("reference", "")
    return ref.split("/")[-1] if ref else "UNKNOWN"


def _fhir_provider_name(p: dict) -> str:
    return p.get("provider", {}).get("display", "Unknown Provider")


def _fhir_diagnosis(p: dict) -> str:
    diags = p.get("diagnosis", [])
    if diags:
        coding = diags[0].get("diagnosisCodeableConcept", {}).get("coding", [{}])
        return coding[0].get("code", "Z00.0") if coding else "Z00.0"
    return "Z00.0"


def _fhir_line_items(p: dict) -> list[dict]:
    items = []
    for i, item in enumerate(p.get("item", []), start=1):
        amount = item.get("unitPrice", {}).get("value", 0)
        code_coding = item.get("productOrService", {}).get("coding", [{}])
        code = code_coding[0].get("code", f"ITEM{i:03d}") if code_coding else f"ITEM{i:03d}"
        items.append({
            "line_number":      i,
            "procedure_code":   code,
            "service_category": "GENERAL",
            "billed_amount":    str(amount),
            "units":            item.get("quantity", {}).get("value", 1),
        })
    return items


# ════════════════════════════════════════════
# BACKGROUND PROCESSING
# ════════════════════════════════════════════

async def _fetch_and_process_claim(source: dict[str, Any], claim_id: str) -> None:
    """
    Background task: pull full claim data from the HMS, map it, run pipeline.
    Errors are logged but not raised (webhook already returned 200).
    """
    try:
        pull_url = (
            source["pull_base_url"]
            + source["claim_pull_path"].format(claim_id=claim_id)
        )
        auth_header = source.get("pull_auth_header", "")
        headers: dict[str, str] = {
            "User-Agent": "ClaimsEngine-HMS/1.0",
            "Accept":     "application/json",
        }
        if auth_header:
            headers["Authorization"] = auth_header

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(pull_url, headers=headers)
            resp.raise_for_status()
            hms_payload: dict[str, Any] = resp.json()

        claim_data = _map_hms_to_claim(hms_payload, source)

        # Late import to avoid circular dependency with main.py
        from services.api_gateway.app.main import pipeline, claims_store  # type: ignore[import]
        if pipeline is None:
            logger.error("HMS: Pipeline not initialized — claim_id=%s", claim_id)
            return
        result = pipeline.adjudicate(claim_data)

        # Store in the in-memory cache so it shows up in /claims immediately
        ref = result.get("claim_reference")
        if ref and claims_store is not None:
            claims_store[ref] = result

        logger.info(
            "HMS claim processed: ref=%s status=%s source=%s",
            result.get("claim_reference"),
            result.get("status"),
            source.get("name"),
        )

    except httpx.HTTPStatusError as exc:
        logger.error(
            "HMS pull HTTP error: claim_id=%s source=%s status=%s",
            claim_id, source.get("name"), exc.response.status_code,
        )
    except Exception as exc:
        logger.error(
            "HMS webhook processing failed: claim_id=%s source=%s error=%s",
            claim_id, source.get("name"), exc,
        )


# ════════════════════════════════════════════
# INBOUND WEBHOOK RECEIVER
# ════════════════════════════════════════════

@router.post(
    "/api/v1/webhooks/hms/{source_id}",
    summary="Receive HMS webhook notification (public, HMAC-verified)",
)
async def receive_hms_webhook(
    source_id: str,
    request: Request,
    x_hub_signature_256: Optional[str] = Header(None),
) -> JSONResponse:
    """
    Entry point for Hospital Management System push notifications.

    The HMS calls this endpoint when a new claim is ready for adjudication.
    Expected JSON body fields (any of):
      claim_id | claimId | id | reference  → identifies the claim on the HMS side

    Security: the source's webhook_secret is used for HMAC-SHA256 verification
    via the X-Hub-Signature-256 header (GitHub-style).  If no secret is stored,
    verification is skipped (useful for internal / dev integrations).
    """
    src = hms_store.get_by_id(source_id)
    if not src:
        # Return 200 to avoid leaking which source IDs exist to potential attackers
        logger.warning("HMS webhook: unknown source_id=%s", source_id)
        return JSONResponse({"received": True})

    if not src.get("enabled", False):
        logger.info("HMS webhook: source disabled, source_id=%s", source_id)
        return JSONResponse({"received": True, "message": "Source is disabled"})

    body_bytes = await request.body()
    secret = src.get("webhook_secret", "")

    if not _verify_hmac(secret, body_bytes, x_hub_signature_256):
        logger.warning(
            "HMS webhook: HMAC verification FAILED source_id=%s sig_header=%s",
            source_id, x_hub_signature_256,
        )
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload: dict[str, Any] = json.loads(body_bytes)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # Record the event (counter + timestamp) — non-blocking, never raises
    hms_store.record_event(source_id)

    # Extract claim identifier from the event payload
    claim_id = str(
        payload.get("claim_id")
        or payload.get("claimId")
        or payload.get("id")
        or payload.get("reference")
        or "UNKNOWN"
    )

    logger.info(
        "HMS webhook received: source=%s claim_id=%s",
        src.get("name"), claim_id,
    )

    # Fire-and-forget — return 200 before pipeline completes
    asyncio.create_task(_fetch_and_process_claim(dict(src), claim_id))

    return JSONResponse({
        "received":  True,
        "claim_id":  claim_id,
        "source":    src.get("name"),
        "message":   "Claim queued for processing",
    })
