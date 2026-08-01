"""
Admin Router
============
All endpoints under /api/v1/admin/* — restricted to ADMIN role only.

Endpoints:
  GET    /api/v1/admin/users                    — list all users
  POST   /api/v1/admin/users                    — create user
  PATCH  /api/v1/admin/users/{email}            — edit user fields
  POST   /api/v1/admin/users/{email}/reset-password — set new password
  DELETE /api/v1/admin/users/{email}            — delete user

  GET    /api/v1/admin/config                   — read current config (secrets masked)
  PATCH  /api/v1/admin/config                   — update config fields

  GET    /api/v1/admin/health                   — live integration health check
"""

from __future__ import annotations

import logging
import os
import json
import socket
import ssl
import time
from datetime import date, timezone
from typing import Any, Optional
from urllib import error as urlerror
from urllib import request as urlrequest

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, field_validator
from shared.llm_provider_registry import get_registry

from services.api_gateway.app.auth import require_roles, CurrentUser
from services.api_gateway.app import user_store, config_store, compliance_store

router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])
_admin_only = require_roles("ADMIN")
logger = logging.getLogger(__name__)

VALID_ROLES = {
    "ADMIN",
    "ADJUSTER",
    "SENIOR_ADJUSTER",
    "MEDICAL_DIRECTOR",
    "COMPLIANCE_OFFICER",
    "API_CONSUMER",
}
VALID_REGIONS = {"UAE", "INDIA", "SAUDI", "BAHRAIN", "OMAN", "QATAR", "KUWAIT"}

K8S_SERVICE_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "key": "api",
        "name": "API Gateway",
        "group": "Core Platform",
        "namespace": "claims-os",
        "deployments": ("api", "api-gateway"),
        "services": ("api", "api-gateway"),
    },
    {
        "key": "claims_ui",
        "name": "Claims UI",
        "group": "Core Platform",
        "namespace": "claims-os",
        "deployments": ("claims-ui",),
        "services": ("claims-ui",),
    },
    {
        "key": "document_ai",
        "name": "Document AI",
        "group": "AI & Claims Pipeline",
        "namespace": "claims-os",
        "deployments": ("document-ai",),
        "services": ("document-ai",),
    },
    {
        "key": "fwa_service",
        "name": "FWA Service",
        "group": "AI & Claims Pipeline",
        "namespace": "claims-os",
        "deployments": ("fwa-service",),
        "services": ("fwa-service",),
    },
    {
        "key": "graph_service",
        "name": "Graph Service",
        "group": "AI & Claims Pipeline",
        "namespace": "claims-os",
        "deployments": ("graph-service",),
        "services": ("graph-service",),
    },
    {
        "key": "mock_nhcx",
        "name": "NHCX Mock Adapter",
        "group": "AI & Claims Pipeline",
        "namespace": "claims-os",
        "deployments": ("mock-nhcx",),
        "services": ("mock-nhcx",),
    },
    {
        "key": "bpmn_worker",
        "name": "BPMN Worker",
        "group": "Workflow Services",
        "namespace": "claims-os",
        "deployments": ("bpmn-worker",),
        "services": (),
        "required": False,
    },
    {
        "key": "apisix",
        "name": "APISIX Gateway",
        "group": "Platform Services",
        "namespace": "claims-nhcx",
        "deployments": ("apisix-gateway", "apisix"),
        "services": ("apisix-gateway", "apisix"),
    },
    {
        "key": "keycloak",
        "name": "Keycloak",
        "group": "Platform Services",
        "namespace": "claims-nhcx",
        "deployments": ("keycloak",),
        "services": ("keycloak",),
    },
    {
        "key": "operaton",
        "name": "Operaton BPM",
        "group": "Platform Services",
        "namespace": "claims-nhcx",
        "deployments": ("operaton",),
        "services": ("operaton",),
        "required": False,
    },
    {
        "key": "hapi_fhir",
        "name": "HAPI FHIR",
        "group": "Platform Services",
        "namespace": "claims-nhcx",
        "deployments": ("hapi-fhir",),
        "services": ("hapi-fhir",),
    },
    {
        "key": "nhcx_mock_service",
        "name": "NHCX Mock Service",
        "group": "Platform Services",
        "namespace": "claims-nhcx",
        "deployments": ("nhcx-mock-service",),
        "services": ("nhcx-mock-service",),
    },
    {
        "key": "opa_sidecar",
        "name": "OPA Policy Sidecar",
        "group": "Policy Services",
        "namespace": "claims-nhcx",
        "deployments": ("apisix-gateway",),
        "services": (),
        "container": "opa",
    },
)


def _parse_iso_date_param(value: Optional[str], field_name: str) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be YYYY-MM-DD") from exc


# ════════════════════════════════════════════
# USER MANAGEMENT
# ════════════════════════════════════════════


class UserCreateRequest(BaseModel):
    email: str
    full_name: str
    role: str
    market_region: str = "UAE"
    tenant_id: str = "default"
    password: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v.upper() not in VALID_ROLES:
            raise ValueError(f"Invalid role. Must be one of: {sorted(VALID_ROLES)}")
        return v.upper()

    @field_validator("market_region")
    @classmethod
    def validate_region(cls, v: str) -> str:
        if v.upper() not in VALID_REGIONS:
            raise ValueError(f"Invalid region. Must be one of: {sorted(VALID_REGIONS)}")
        return v.upper()

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    market_region: Optional[str] = None
    tenant_id: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str | None) -> str | None:
        if v and v.upper() not in VALID_ROLES:
            raise ValueError(f"Invalid role. Must be one of: {sorted(VALID_ROLES)}")
        return v.upper() if v else v

    @field_validator("market_region")
    @classmethod
    def validate_region(cls, v: str | None) -> str | None:
        if v and v.upper() not in VALID_REGIONS:
            raise ValueError(f"Invalid region. Must be one of: {sorted(VALID_REGIONS)}")
        return v.upper() if v else v


class ResetPasswordRequest(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


@router.get("/users", summary="List all users")
async def list_users(
    _: CurrentUser = Depends(_admin_only),
) -> list[dict]:
    return user_store.get_all()


@router.post("/users", status_code=status.HTTP_201_CREATED, summary="Create user")
async def create_user(
    body: UserCreateRequest,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    try:
        return user_store.create(
            email=body.email,
            full_name=body.full_name,
            role=body.role,
            market_region=body.market_region,
            password=body.password,
            tenant_id=body.tenant_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/users/{email}", summary="Edit user")
async def update_user(
    email: str,
    body: UserUpdateRequest,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return user_store.update(email, patch)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/users/{email}/reset-password", summary="Reset user password")
async def reset_password(
    email: str,
    body: ResetPasswordRequest,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    try:
        user_store.reset_password(email, body.new_password)
        return {"message": f"Password updated for {email}"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete(
    "/users/{email}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete user"
)
async def delete_user(
    email: str,
    current_user: CurrentUser = Depends(_admin_only),
):
    try:
        user_store.delete(email, requesting_email=current_user.email)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# MFA MANAGEMENT (Admin Reset + Role-Based Policies)
# ═══════════════════════════════════════════════════════════════════════════════


class MFAResetRequest(BaseModel):
    """Admin request to reset or disable MFA for a user."""

    action: str  # "reset_secret" or "disable_requirement"
    reason: str  # Audit trail: why is MFA being reset?


@router.post("/users/{email}/mfa/reset", summary="Reset user's MFA (ADMIN only)")
async def reset_user_mfa(
    email: str,
    body: MFAResetRequest,
    current_user: CurrentUser = Depends(_admin_only),
):
    """
    Admin endpoint to reset or disable a user's MFA setup.

    **Actions**:
      - `reset_secret`: Clear TOTP configuration + backup codes. User must re-scan QR on next login.
      - `disable_requirement`: Remove MFA requirement for user (e.g., for API consumers or emergency override).

    **Audit**: Reset events are logged to the audit trail with the provided reason.

    **Permissions**: ADMIN role only. Cannot reset own MFA (prevents self-lockout).
    """
    email = email.lower().strip()

    # Prevent admin from resetting own MFA (security: prevent self-lockout)
    if email == current_user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot reset your own MFA. Contact another admin if needed.",
        )

    # Validate action
    if body.action not in ("reset_secret", "disable_requirement"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid action '{body.action}'. Must be 'reset_secret' or 'disable_requirement'",
        )

    # Validate reason (audit trail requirement)
    if not body.reason or not body.reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reason for reset is required (for audit trail)",
        )

    # Check user exists
    user = user_store.get_by_email(email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"User '{email}' not found"
        )

    try:
        if body.action == "reset_secret":
            # ── Clear TOTP secret + backup codes (requires re-setup on next login) ──
            from services.api_gateway.app.totp_store import (
                delete_secret,
                delete_backup_codes,
            )

            delete_secret(email)
            delete_backup_codes(email)
            user_store.update(email, {"mfa_enabled": False})

            logger.warning(
                "[ADMIN-MFA] %s reset TOTP secret for %s. Reason: %s",
                current_user.email,
                email,
                body.reason,
            )

            # Log to audit trail
            from services.api_gateway.app.audit import trail

            trail.add(
                "USER_MFA_RESET",
                f"TOTP secret reset by {current_user.email}: {body.reason}",
                {
                    "admin_email": current_user.email,
                    "user_email": email,
                    "action": "reset_secret",
                    "reason": body.reason,
                },
            )

            return {
                "message": f"MFA secret reset for {email}. User must re-scan QR code on next login.",
                "action": "reset_secret",
                "user_email": email,
            }

        elif body.action == "disable_requirement":
            # ── Disable MFA requirement (user can login without TOTP) ──
            user_store.update(email, {"mfa_required": False})

            logger.warning(
                "[ADMIN-MFA] %s disabled MFA requirement for %s. Reason: %s",
                current_user.email,
                email,
                body.reason,
            )

            # Log to audit trail
            from services.api_gateway.app.audit import trail

            trail.add(
                "USER_MFA_DISABLED",
                f"MFA requirement disabled by {current_user.email}: {body.reason}",
                {
                    "admin_email": current_user.email,
                    "user_email": email,
                    "action": "disable_requirement",
                    "reason": body.reason,
                },
            )

            return {
                "message": f"MFA requirement disabled for {email}. User can now login without 2FA.",
                "action": "disable_requirement",
                "user_email": email,
            }

    except ValueError as e:
        logger.error("[ADMIN-MFA] validation error: %s", e)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("[ADMIN-MFA] failed to reset MFA for %s: %s", email, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset MFA. Check server logs.",
        )


@router.get("/users/{email}/mfa/status", summary="Get user's MFA status (ADMIN only)")
async def get_user_mfa_status(
    email: str,
    current_user: CurrentUser = Depends(_admin_only),
):
    """
    Get current MFA configuration for a user (for admin inspection).

    **Response**:
      - `mfa_required`: bool — whether MFA is mandatory for this role
      - `mfa_enabled`: bool — whether user has set up TOTP
      - `mfa_type`: str — "TOTP" or null
      - `backup_codes_remaining`: int — how many backup codes are still available
    """
    email = email.lower().strip()

    user = user_store.get_by_email(email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"User '{email}' not found"
        )

    # Count remaining backup codes
    try:
        from services.api_gateway.app.totp_store import _load

        data = _load()
        entry = data.get(email.lower())
        backup_codes_hash = entry.get("backup_codes_hash", []) if entry else []
        backup_codes_used = entry.get("backup_codes_used", []) if entry else []
        backup_codes_remaining = len(backup_codes_hash) - len(backup_codes_used)
    except Exception:
        backup_codes_remaining = 0

    return {
        "user_email": user["email"],
        "mfa_required": user.get("mfa_required", False),
        "mfa_enabled": user.get("mfa_enabled", False),
        "mfa_type": user.get("mfa_type", "TOTP"),
        "backup_codes_remaining": backup_codes_remaining,
    }


# ════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════


class ConfigUpdateRequest(BaseModel):
    access_token_ttl_minutes: Optional[int] = None
    refresh_token_ttl_days: Optional[int] = None
    enable_swagger_ui: Optional[bool] = None
    enable_demo_endpoints: Optional[bool] = None
    llm_model: Optional[str] = None
    groq_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    cors_allowed_origins: Optional[list[str]] = None
    enable_db_persistence: Optional[bool] = None
    redis_url: Optional[str] = None
    rate_limit_adjudication: Optional[str] = None
    rate_limit_standard: Optional[str] = None
    rate_limit_health: Optional[str] = None
    # Adjudication confidence thresholds
    hitl_low_confidence_threshold: Optional[int] = None
    hitl_medium_confidence_threshold: Optional[int] = None
    hitl_medium_value_threshold: Optional[int] = None
    hitl_high_value_threshold: Optional[int] = None
    confidence_weight_t1: Optional[float] = None
    confidence_weight_t2: Optional[float] = None
    # Dual-Agent Cross-Validation
    dual_agent_enabled: Optional[bool] = None
    dual_agent_agreement_threshold: Optional[float] = None
    dual_agent_conflict_threshold: Optional[float] = None

    @field_validator(
        "hitl_low_confidence_threshold",
        "hitl_medium_confidence_threshold",
        mode="before",
    )
    @classmethod
    def validate_confidence_thresholds(cls, v: int | None) -> int | None:
        if v is not None and not (0 <= v <= 100):
            raise ValueError("Confidence threshold must be between 0 and 100")
        return v

    @field_validator("confidence_weight_t1", "confidence_weight_t2", mode="before")
    @classmethod
    def validate_confidence_weights(cls, v: float | None) -> float | None:
        if v is not None and not (0.0 <= v <= 1.0):
            raise ValueError("Confidence weight must be between 0.0 and 1.0")
        return v

    @field_validator(
        "dual_agent_agreement_threshold",
        "dual_agent_conflict_threshold",
        mode="before",
    )
    @classmethod
    def validate_dual_agent_thresholds(cls, v: float | None) -> float | None:
        if v is not None and not (0.0 <= v <= 1.0):
            raise ValueError("Dual-agent threshold must be between 0.0 and 1.0")
        return v

    @field_validator("vat_rate_uae", "vat_rate_ksa", "gst_rate_india", mode="before")
    @classmethod
    def validate_tax_rates(cls, v: float | None) -> float | None:
        if v is not None and not (0.0 <= v <= 100.0):
            raise ValueError("Tax rate must be between 0.0 and 100.0")
        return v

    # LLM Master Control
    llm_enabled: Optional[bool] = None
    # ── Local / self-hosted LLM (priority 0 — wins over all cloud providers) ──
    # Supports Ollama, vLLM, LM Studio, or any OpenAI-compatible endpoint.
    # Set local_llm_enabled=True + local_llm_base_url to activate.
    local_llm_enabled: Optional[bool] = None
    local_llm_base_url: Optional[str] = None
    local_llm_model: Optional[str] = None
    local_llm_api_key: Optional[str] = None
    groq_enabled: Optional[bool] = None
    nvidia_enabled: Optional[bool] = None
    nvidia_api_key: Optional[str] = None
    nvidia_model: Optional[str] = None
    anthropic_enabled: Optional[bool] = None
    anthropic_model: Optional[str] = None
    openai_enabled: Optional[bool] = None
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    # Rules Engine Configurable Parameters
    re_gcc_copay_in_network_pct: Optional[int] = None
    re_gcc_copay_out_of_network_pct: Optional[int] = None
    re_gcc_copay_direct_billing_pct: Optional[int] = None
    re_gcc_drg_threshold: Optional[int] = None
    re_preauth_penalty_pct: Optional[int] = None
    re_india_room_rent_limit_pct: Optional[float] = None
    re_india_ayush_min_days: Optional[int] = None
    re_india_domiciliary_min_days: Optional[int] = None
    # Claim Approval
    claim_auto_approve_threshold: Optional[float] = None
    claim_auto_approve_max_amount: Optional[float] = None
    claim_auto_approve_thresholds_by_market: Optional[dict[str, Any]] = None
    claim_approval_llm_model: Optional[str] = None
    # Chat Assistance
    chat_assistant_enabled: Optional[bool] = None
    chat_assistant_roles: Optional[list[str]] = None
    chat_assistant_markets: Optional[list[str]] = None
    chat_assistant_variant: Optional[str] = None
    # SLA controls
    sla_settings_by_market: Optional[dict[str, Any]] = None
    # Tax / VAT rates
    vat_rate_uae: Optional[float] = None
    vat_rate_ksa: Optional[float] = None
    gst_rate_india: Optional[float] = None
    india_consumables_gst_pct: Optional[float] = None
    india_tds_rate_pct: Optional[float] = None
    india_zonal_copay_pct: Optional[int] = None
    re_india_icu_rent_limit_pct: Optional[float] = None
    # Membership DB Sync
    membership_sync_configs: Optional[dict[str, Any]] = None
    # Group-driven screen access policy
    access_groups: Optional[list[dict[str, Any]]] = None


def _mask_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Return config with sensitive fields masked."""
    out = dict(cfg)
    out["groq_api_key"] = config_store.mask_secret(cfg.get("groq_api_key"))
    out["anthropic_api_key"] = config_store.mask_secret(cfg.get("anthropic_api_key"))
    out["openai_api_key"] = config_store.mask_secret(cfg.get("openai_api_key"))
    out["nvidia_api_key"] = config_store.mask_secret(cfg.get("nvidia_api_key"))

    # Mask Membership Sync tokens
    if "membership_sync_configs" in out and isinstance(out["membership_sync_configs"], dict):
        masked_sync = {}
        for region, r_cfg in out["membership_sync_configs"].items():
            if isinstance(r_cfg, dict):
                r_copy = dict(r_cfg)
                if r_copy.get("auth_token"):
                    r_copy["auth_token"] = config_store.mask_secret(r_copy["auth_token"])
                masked_sync[region] = r_copy
            else:
                masked_sync[region] = r_cfg
        out["membership_sync_configs"] = masked_sync

    return out


@router.post("/config/membership-sync/test", summary="Test external membership API connection")
async def test_membership_sync_connection(
    region: str,
    _: CurrentUser = Depends(_admin_only),
):
    """
    Test the connection to an external membership database for a specific region.
    Sends a mock request to verify the endpoint and auth token.
    """
    import httpx
    cfg = config_store.load()
    sync_configs = cfg.get("membership_sync_configs", {})
    region_config = sync_configs.get(region.upper())

    if not region_config:
        raise HTTPException(status_code=404, detail=f"Configuration for region {region} not found")

    url = region_config.get("endpoint_url")
    token = region_config.get("auth_token")

    if not url:
        raise HTTPException(status_code=400, detail="Endpoint URL is not configured")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # We use a mock 'TEST-MEMBER' to verify the handshake
            resp = await client.get(
                url,
                params={"member_number": "TEST-HANDSHAKE-001"},
                headers={"Authorization": token or ""}
            )
            
            # We consider 200 (Found) or 404 (Not Found but API responded) as a successful handshake
            if resp.status_code in (200, 404):
                return {
                    "ok": True,
                    "status_code": resp.status_code,
                    "detail": f"Successfully connected to {region} endpoint. Handshake complete.",
                    "response_preview": resp.json() if resp.status_code == 200 else "API reachable (Member Not Found)"
                }
            else:
                return {
                    "ok": False,
                    "status_code": resp.status_code,
                    "detail": f"API responded with error code {resp.status_code}",
                    "response_body": resp.text[:200]
                }
    except httpx.ConnectError:
        return {"ok": False, "detail": "Could not connect to the server. Check the URL and DNS settings."}
    except httpx.TimeoutException:
        return {"ok": False, "detail": "Connection timed out. The server took too long to respond."}
    except Exception as e:
        return {"ok": False, "detail": f"An unexpected error occurred: {str(e)}"}


@router.get("/config", summary="Get current system configuration")
async def get_config(
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    return _mask_config(config_store.load())


@router.patch("/config", summary="Update system configuration")
async def update_config(
    body: ConfigUpdateRequest,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Validate rate limit format
    for field in (
        "rate_limit_adjudication",
        "rate_limit_standard",
        "rate_limit_health",
    ):
        if field in patch:
            val = patch[field]
            parts = val.split("/")
            if len(parts) != 2 or not parts[0].strip().isdigit():
                raise HTTPException(
                    status_code=400, detail=f"{field}: must be in format '30/minute'"
                )

    if "chat_assistant_roles" in patch:
        patch["chat_assistant_roles"] = [
            str(role).strip().upper()
            for role in patch["chat_assistant_roles"]
            if str(role).strip()
        ]
    if "chat_assistant_markets" in patch:
        patch["chat_assistant_markets"] = [
            str(market).strip().upper()
            for market in patch["chat_assistant_markets"]
            if str(market).strip()
        ]
    if "chat_assistant_variant" in patch:
        variant = str(patch["chat_assistant_variant"]).strip().lower()
        allowed_variants = {
            "dashboard-copilot",
            "legacy-widget",
            "sentinel-ops",
            "orange-cinematic",
        }
        if variant not in allowed_variants:
            raise HTTPException(status_code=400, detail="Unsupported chat assistant variant")
        patch["chat_assistant_variant"] = variant
    if "sla_settings_by_market" in patch:
        normalized_sla: dict[str, dict[str, Any]] = {}
        for market, settings in (patch["sla_settings_by_market"] or {}).items():
            if not isinstance(settings, dict):
                raise HTTPException(status_code=400, detail="sla_settings_by_market values must be objects")
            hours = int(settings.get("hours", 8))
            if hours < 4 or hours > 48:
                raise HTTPException(status_code=400, detail="SLA hours must be between 4 and 48")
            normalized_sla[str(market).upper()] = {
                "enabled": bool(settings.get("enabled", True)),
                "hours": hours,
            }
        patch["sla_settings_by_market"] = normalized_sla
    if "claim_auto_approve_thresholds_by_market" in patch:
        normalized_thresholds: dict[str, dict[str, Any]] = {}
        for market, settings in (patch["claim_auto_approve_thresholds_by_market"] or {}).items():
            if not isinstance(settings, dict):
                raise HTTPException(status_code=400, detail="claim_auto_approve_thresholds_by_market values must be objects")
            max_amount = float(settings.get("max_amount", 0))
            if max_amount < 0:
                raise HTTPException(status_code=400, detail="Auto-approval threshold cannot be negative")
            normalized_thresholds[str(market).upper()] = {
                "currency": str(settings.get("currency", "")).upper(),
                "max_amount": max_amount,
            }
        patch["claim_auto_approve_thresholds_by_market"] = normalized_thresholds

    if "membership_sync_configs" in patch:
        current_cfg = config_store.load()
        current_sync = current_cfg.get("membership_sync_configs", {})
        new_sync = patch["membership_sync_configs"] or {}
        
        for region, r_cfg in new_sync.items():
            if not isinstance(r_cfg, dict):
                continue
            
            # Prevent overwriting real tokens with masked ones from the UI
            token = r_cfg.get("auth_token")
            if token and "••••••••" in token:
                old_token = current_sync.get(region, {}).get("auth_token")
                if old_token:
                    r_cfg["auth_token"] = old_token

    try:
        updated = config_store.save(patch)

        # Re-initialize LLM registry so admin-saved keys take effect immediately
        # without requiring an API restart. The registry normally locks after startup
        # but we force a refresh here whenever LLM-related fields are patched.
        llm_fields = {
            "groq_api_key", "nvidia_api_key", "openai_api_key", "anthropic_api_key",
            "groq_enabled", "nvidia_enabled", "openai_enabled", "anthropic_enabled",
            "llm_enabled", "llm_model", "nvidia_model", "openai_model", "anthropic_model",
            # Local / self-hosted LLM fields — must also trigger registry re-init
            "local_llm_enabled", "local_llm_base_url", "local_llm_model", "local_llm_api_key",
        }
        if patch.keys() & llm_fields:
            registry = get_registry()
            registry._initialized = False  # force re-init with new keys
            registry.initialize(updated)
            logger.info("[Admin] LLM registry re-initialized after config update")

        return _mask_config(updated)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save config: {e}")


# ════════════════════════════════════════════
# COMPLIANCE AUTOMATION
# ════════════════════════════════════════════


class ComplianceUpdateIngestRequest(BaseModel):
    market: str
    regulatory_body: str
    source: str
    effective_date: str
    clauses: list[dict]
    notes: Optional[str] = None


@router.get("/compliance/updates", summary="List ingested regulatory updates")
async def list_compliance_updates(
    market: Optional[str] = None,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    return {"updates": compliance_store.list_updates(market=market)}


@router.post("/compliance/updates/ingest", summary="Ingest a regulatory update")
async def ingest_compliance_update(
    body: ComplianceUpdateIngestRequest,
    current_user: CurrentUser = Depends(_admin_only),
) -> dict:
    try:
        record = compliance_store.ingest_update(
            market=body.market,
            regulatory_body=body.regulatory_body,
            source=body.source,
            effective_date=body.effective_date,
            clauses=body.clauses,
            uploaded_by=current_user.email,
            notes=body.notes,
        )
        return {"success": True, "update": record}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to ingest update: {exc}")


@router.get("/compliance/drift", summary="Detect regulatory compliance drift")
async def detect_compliance_drift(
    market: str,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    from services.api_gateway.app.main import pipeline

    current_clauses = []
    if pipeline and getattr(pipeline, "regional_clauses", None):
        current_clauses = pipeline.regional_clauses.get(market.upper(), [])
    return compliance_store.detect_drift(market, current_clauses)


@router.post("/compliance/verifications/run", summary="Run compliance verification workflow")
async def run_compliance_verification(
    market: Optional[str] = None,
    current_user: CurrentUser = Depends(_admin_only),
) -> dict:
    from services.api_gateway.app.main import pipeline, _with_sync_session
    from services.api_gateway.app.reliability import get_reliability_snapshot

    markets = [market.upper()] if market else sorted(getattr(pipeline, "regional_clauses", {}).keys())
    results = []
    for item in markets:
        current_clauses = []
        if pipeline and getattr(pipeline, "regional_clauses", None):
            current_clauses = pipeline.regional_clauses.get(item, [])
        results.append(compliance_store.detect_drift(item, current_clauses))

    verification = compliance_store.record_verification(
        {
            "market": market.upper() if market else "ALL",
            "verification_type": "REGULATORY_DRIFT_AND_RELIABILITY",
            "result_status": "PASSED" if all(not r["drift_detected"] for r in results) else "REVIEW_REQUIRED",
            "details": {
                "drift_results": results,
                "reliability": _with_sync_session(
                    lambda db: get_reliability_snapshot(db),
                    default=get_reliability_snapshot(),
                ),
            },
            "verified_by": current_user.email,
        }
    )
    return verification


@router.get("/compliance/verifications", summary="List recent compliance verification workflows")
async def list_compliance_verifications(
    limit: int = 20,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    return {"verifications": compliance_store.list_verifications(limit=limit)}


# ════════════════════════════════════════════
# WORKFLOW EVENT / SAGA INSPECTION
# ════════════════════════════════════════════


@router.get("/workflows/sagas", summary="List claim workflow sagas")
async def list_workflow_sagas(
    status_filter: Optional[str] = None,
    limit: int = 50,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    from sqlalchemy import text as sa_text
    from shared.database import async_session

    where = "WHERE saga_status = :status" if status_filter else ""
    params = {"status": status_filter, "limit": min(max(limit, 1), 200)}

    query = sa_text(
        f"""
        SELECT claim_reference, tenant_id, saga_status, current_step,
               trace_id, source_channel, last_error, started_at, updated_at
        FROM claim_processing_sagas
        {where}
        ORDER BY updated_at DESC
        LIMIT :limit
        """
    )

    async with async_session() as session:
        rows = (await session.execute(query, params)).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/workflows/{claim_reference}/events", summary="Get workflow event stream for a claim")
async def get_workflow_events(
    claim_reference: str,
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    from sqlalchemy import text as sa_text
    from shared.database import async_session

    query = sa_text(
        """
        SELECT event_sequence, event_type, event_timestamp, event_payload,
               source_service, trace_id, correlation_id, event_hash
        FROM claim_processing_events
        WHERE claim_reference = :claim_reference
        ORDER BY event_sequence ASC, event_timestamp ASC
        """
    )
    async with async_session() as session:
        rows = (await session.execute(query, {"claim_reference": claim_reference})).mappings().all()
    return {"claim_reference": claim_reference, "events": [dict(r) for r in rows]}


# ════════════════════════════════════════════
# INTEGRATION HEALTH
# ════════════════════════════════════════════


def _check_tcp(host: str, port: int, timeout: float = 2.0) -> tuple[bool, float]:
    """Check TCP connectivity. Returns (reachable, latency_ms)."""
    t0 = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, round((time.monotonic() - t0) * 1000, 1)
    except Exception:
        return False, -1.0


def _check_http(url: str, timeout: float = 3.0) -> tuple[bool, float, str]:
    """HTTP GET check. Returns (ok, latency_ms, detail)."""
    import urllib.request
    import urllib.error

    t0 = time.monotonic()
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "claims-healthcheck/1.0"}
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            latency = round((time.monotonic() - t0) * 1000, 1)
            return resp.status < 500, latency, f"HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        latency = round((time.monotonic() - t0) * 1000, 1)
        # 401/403 from Groq = key auth failure, but service is UP
        return e.code in (401, 403), latency, f"HTTP {e.code}"
    except Exception as ex:
        return False, -1.0, str(ex)


def _read_kubernetes_namespace() -> str:
    configured = os.getenv("CLAIMS_K8S_NAMESPACE") or os.getenv("KUBERNETES_NAMESPACE")
    if configured:
        return configured.strip()
    namespace_path = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
    try:
        with open(namespace_path, "r", encoding="utf-8") as fh:
            namespace = fh.read().strip()
            if namespace:
                return namespace
    except OSError:
        pass
    return "acos"


def _read_kubernetes_namespaces() -> list[str]:
    configured = os.getenv("CLAIMS_K8S_NAMESPACES")
    if configured:
        namespaces = [part.strip() for part in configured.split(",") if part.strip()]
        return list(dict.fromkeys(namespaces)) or [_read_kubernetes_namespace()]

    primary = _read_kubernetes_namespace()
    if primary in {"claims-os", "claims-nhcx"}:
        return ["claims-os", "claims-nhcx"]
    return [primary]


def _kubernetes_api_get(path: str) -> dict[str, Any]:
    host = os.getenv("KUBERNETES_SERVICE_HOST")
    port = os.getenv("KUBERNETES_SERVICE_PORT", "443")
    token_path = os.getenv(
        "KUBERNETES_SERVICEACCOUNT_TOKEN",
        "/var/run/secrets/kubernetes.io/serviceaccount/token",
    )
    ca_path = os.getenv(
        "KUBERNETES_SERVICEACCOUNT_CA",
        "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
    )
    if not host:
        raise RuntimeError("Kubernetes service host is not available")
    try:
        with open(token_path, "r", encoding="utf-8") as fh:
            token = fh.read().strip()
    except OSError as exc:
        raise RuntimeError("Kubernetes service account token is not available") from exc

    context = ssl.create_default_context(cafile=ca_path if os.path.exists(ca_path) else None)
    req = urlrequest.Request(
        f"https://{host}:{port}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "claims-admin-k8s-health/1.0",
        },
    )
    with urlrequest.urlopen(req, timeout=4.0, context=context) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _index_kubernetes_items(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("metadata", {}).get("name", "")): item
        for item in items
        if item.get("metadata", {}).get("name")
    }


def _first_named(index: dict[str, dict[str, Any]], names: tuple[str, ...]) -> dict[str, Any] | None:
    for name in names:
        if name in index:
            return index[name]
    return None


def _pod_matches_deployment(pod: dict[str, Any], deployment_names: tuple[str, ...]) -> bool:
    owners = pod.get("metadata", {}).get("ownerReferences", []) or []
    for owner in owners:
        owner_name = str(owner.get("name", ""))
        if owner.get("kind") == "ReplicaSet" and any(
            owner_name.startswith(f"{deployment}-") for deployment in deployment_names
        ):
            return True
    if owners:
        return False
    labels = pod.get("metadata", {}).get("labels", {}) or {}
    return labels.get("app") in deployment_names


def _summarize_kubernetes_health(
    namespace: str,
    deployments_payload: dict[str, Any],
    pods_payload: dict[str, Any],
    services_payload: dict[str, Any],
) -> dict[str, Any]:
    deployments = _index_kubernetes_items(deployments_payload.get("items", []))
    services = _index_kubernetes_items(services_payload.get("items", []))
    single_namespace_catalog = tuple(
        catalog
        for catalog in K8S_SERVICE_CATALOG
        if _first_named(deployments, tuple(catalog["deployments"]))
        or _first_named(services, tuple(catalog["services"]))
    )

    return _summarize_kubernetes_health_from_namespaces(
        namespace=namespace,
        namespace_payloads={
            namespace: {
                "deployments": deployments_payload,
                "pods": pods_payload,
                "services": services_payload,
            }
        },
        honor_catalog_namespace=False,
        catalog=single_namespace_catalog,
    )


def _summarize_kubernetes_health_from_namespaces(
    namespace: str,
    namespace_payloads: dict[str, dict[str, Any]],
    *,
    honor_catalog_namespace: bool = True,
    detail: str | None = None,
    catalog: tuple[dict[str, Any], ...] = K8S_SERVICE_CATALOG,
) -> dict[str, Any]:
    service_rows: list[dict[str, Any]] = []

    for catalog_item in catalog:
        catalog_namespace = str(catalog_item.get("namespace") or namespace)
        payload_namespace = catalog_namespace if honor_catalog_namespace else namespace
        payloads = namespace_payloads.get(payload_namespace, {})
        deployments_payload = payloads.get("deployments", {})
        pods_payload = payloads.get("pods", {})
        services_payload = payloads.get("services", {})
        deployments = _index_kubernetes_items(deployments_payload.get("items", []))
        services = _index_kubernetes_items(services_payload.get("items", []))
        pods = pods_payload.get("items", [])
        deployment_names = tuple(catalog_item["deployments"])
        service_names = tuple(catalog_item["services"])
        container_name = catalog_item.get("container")
        required = bool(catalog_item.get("required", True))
        deployment = _first_named(deployments, deployment_names)
        service = _first_named(services, service_names)
        matched_pods = [pod for pod in pods if _pod_matches_deployment(pod, deployment_names)]
        restarts = sum(
            int(status.get("restartCount", 0))
            for pod in matched_pods
            for status in pod.get("status", {}).get("containerStatuses", []) or []
        )
        running_pods = sum(1 for pod in matched_pods if pod.get("status", {}).get("phase") == "Running")
        waiting_pods = len(matched_pods) - running_pods

        if deployment:
            spec = deployment.get("spec", {})
            status_obj = deployment.get("status", {})
            desired = int(spec.get("replicas") or 0)
            deployment_ready = int(status_obj.get("readyReplicas") or 0)
            available = int(status_obj.get("availableReplicas") or 0)
            updated = int(status_obj.get("updatedReplicas") or 0)
            if desired == 0 and not required:
                row_status = "not_configured"
                detail_text = "Optional component is paused"
                ready = 0
            elif container_name:
                ready = sum(
                    1
                    for pod in matched_pods
                    for status in pod.get("status", {}).get("containerStatuses", []) or []
                    if status.get("name") == container_name and status.get("ready")
                )
                desired = desired or len(matched_pods)
                if desired > 0 and ready >= desired:
                    row_status = "up"
                    detail_text = f"{container_name} sidecar ready"
                elif ready > 0:
                    row_status = "degraded"
                    detail_text = f"{ready}/{desired} {container_name} sidecars ready"
                else:
                    row_status = "down"
                    detail_text = f"{container_name} sidecar not ready"
            elif desired > 0 and deployment_ready >= desired and available >= desired:
                row_status = "up"
                detail_text = "Deployment ready"
                if service_names and not service:
                    row_status = "degraded"
                    detail_text = "Deployment ready; service missing"
            elif deployment_ready > 0:
                row_status = "degraded"
                detail_text = f"{deployment_ready}/{desired} replicas ready"
            else:
                row_status = "down"
                detail_text = "No ready replicas"
            ready = ready if container_name else deployment_ready
            deployment_name = deployment.get("metadata", {}).get("name")
            age = deployment.get("metadata", {}).get("creationTimestamp")
        else:
            desired = ready = available = updated = 0
            row_status = "not_found" if required else "not_configured"
            detail_text = (
                "Deployment not found in namespace"
                if required
                else "Optional component is not deployed"
            )
            deployment_name = None
            age = None

        ports = []
        if service:
            for port in service.get("spec", {}).get("ports", []) or []:
                ports.append(
                    {
                        "name": port.get("name"),
                        "port": port.get("port"),
                        "target_port": port.get("targetPort"),
                        "node_port": port.get("nodePort"),
                        "protocol": port.get("protocol"),
                    }
                )

        service_rows.append(
            {
                "key": catalog_item["key"],
                "name": catalog_item["name"],
                "group": catalog_item["group"],
                "namespace": payload_namespace,
                "workload_type": "sidecar" if container_name else "deployment",
                "status": row_status,
                "detail": detail_text,
                "deployment": deployment_name,
                "service": service.get("metadata", {}).get("name") if service else None,
                "service_type": service.get("spec", {}).get("type") if service else None,
                "cluster_ip": service.get("spec", {}).get("clusterIP") if service else None,
                "ports": ports,
                "desired_replicas": desired,
                "ready_replicas": ready,
                "available_replicas": available,
                "updated_replicas": updated,
                "pod_count": len(matched_pods),
                "running_pods": running_pods,
                "waiting_pods": waiting_pods,
                "restarts": restarts,
                "age": age,
            }
        )

    summary = {
        "total": len(service_rows),
        "up": sum(1 for row in service_rows if row["status"] == "up"),
        "degraded": sum(1 for row in service_rows if row["status"] == "degraded"),
        "down": sum(1 for row in service_rows if row["status"] == "down"),
        "not_found": sum(1 for row in service_rows if row["status"] == "not_found"),
        "not_configured": sum(1 for row in service_rows if row["status"] == "not_configured"),
        "restarts": sum(int(row["restarts"]) for row in service_rows),
    }
    overall = "up"
    if summary["down"] or summary["not_found"]:
        overall = "down"
    elif summary["degraded"] or summary["restarts"]:
        overall = "degraded"

    return {
        "configured": True,
        "namespace": namespace,
        "status": overall,
        "detail": detail,
        "summary": summary,
        "services": service_rows,
        "timestamp": time.time(),
    }


@router.get("/health", summary="Live integration health check", response_model=dict)
async def integration_health(
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    cfg = config_store.load()
    results: dict[str, Any] = {}

    # ── PostgreSQL ──
    try:
        db_url = os.getenv("SYNC_DATABASE_URL", os.getenv("DATABASE_URL", ""))
        # Extract host/port from postgres URL
        import re

        m = re.search(r"@([^:/]+):?(\d+)?/", db_url or "")
        if m:
            pg_host = m.group(1)
            pg_port = int(m.group(2) or 5432)
            ok, lat = _check_tcp(pg_host, pg_port)
            results["postgresql"] = {
                "status": "up" if ok else "down",
                "latency_ms": lat,
                "host": pg_host,
            }
        else:
            results["postgresql"] = {"status": "unknown", "detail": "No DATABASE_URL"}
    except Exception as e:
        results["postgresql"] = {"status": "error", "detail": str(e)}

    # ── Redis ──
    try:
        redis_url = cfg.get("redis_url", "redis://redis:6379/0")
        m = re.search(r"redis://([^:/]+):?(\d+)?", redis_url or "")
        if m:
            r_host = m.group(1)
            r_port = int(m.group(2) or 6379)
            ok, lat = _check_tcp(r_host, r_port)
            results["redis"] = {
                "status": "up" if ok else "down",
                "latency_ms": lat,
                "host": r_host,
            }
        else:
            results["redis"] = {"status": "unknown", "detail": "No Redis URL"}
    except Exception as e:
        results["redis"] = {"status": "error", "detail": str(e)}

    # ── Groq API ──
    groq_key = cfg.get("groq_api_key")
    if groq_key:
        ok, lat, detail = _check_http(
            "https://api.groq.com/openai/v1/models",
            timeout=4.0,
        )
        results["groq"] = {
            "status": "up" if ok else "down",
            "latency_ms": lat,
            "detail": detail,
            "configured": True,
        }
    else:
        results["groq"] = {"status": "not_configured", "configured": False}

    # ── Anthropic API ──
    anthropic_key = cfg.get("anthropic_api_key")
    if anthropic_key:
        ok, lat, detail = _check_http(
            "https://api.anthropic.com/v1/models",
            timeout=4.0,
        )
        results["anthropic"] = {
            "status": "up" if ok else "down",
            "latency_ms": lat,
            "detail": detail,
            "configured": True,
        }
    else:
        results["anthropic"] = {"status": "not_configured", "configured": False}

    # ── NVIDIA NIM API ──
    nvidia_key = cfg.get("nvidia_api_key")
    if nvidia_key:
        ok, lat, detail = _check_http(
            "https://integrate.api.nvidia.com/v1/models",
            timeout=4.0,
        )
        results["nvidia"] = {
            "status": "up" if ok else "down",
            "latency_ms": lat,
            "detail": detail,
            "configured": True,
        }
    else:
        results["nvidia"] = {"status": "not_configured", "configured": False}

    return {"checks": results, "timestamp": time.time()}


@router.get("/kubernetes/health", summary="ACOS Kubernetes service health", response_model=dict)
async def kubernetes_health(
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    namespaces = _read_kubernetes_namespaces()
    display_namespace = ", ".join(namespaces)
    namespace_payloads: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    try:
        for namespace in namespaces:
            try:
                namespace_payloads[namespace] = {
                    "deployments": _kubernetes_api_get(f"/apis/apps/v1/namespaces/{namespace}/deployments"),
                    "pods": _kubernetes_api_get(f"/api/v1/namespaces/{namespace}/pods"),
                    "services": _kubernetes_api_get(f"/api/v1/namespaces/{namespace}/services"),
                }
            except urlerror.HTTPError as exc:
                error_detail = exc.read().decode("utf-8", errors="replace")[:240]
                errors.append(f"{namespace}: Kubernetes API HTTP {exc.code}: {error_detail}")
            except Exception as exc:
                errors.append(f"{namespace}: {exc}")

        if not namespace_payloads:
            raise RuntimeError("; ".join(errors) or "Kubernetes service inventory unavailable")

        return _summarize_kubernetes_health_from_namespaces(
            namespace=display_namespace,
            namespace_payloads=namespace_payloads,
            honor_catalog_namespace=True,
            detail="; ".join(errors) if errors else None,
        )
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        return {
            "configured": False,
            "namespace": display_namespace,
            "status": "error",
            "detail": f"Kubernetes API returned HTTP {exc.code}: {detail}",
            "summary": {
                "total": 0,
                "up": 0,
                "degraded": 0,
                "down": 0,
                "not_found": 0,
                "not_configured": 0,
                "restarts": 0,
            },
            "services": [],
            "timestamp": time.time(),
        }
    except Exception as exc:
        return {
            "configured": False,
            "namespace": display_namespace,
            "status": "not_configured",
            "detail": str(exc),
            "summary": {
                "total": 0,
                "up": 0,
                "degraded": 0,
                "down": 0,
                "not_found": 0,
                "not_configured": 0,
                "restarts": 0,
            },
            "services": [],
            "timestamp": time.time(),
        }


@router.get("/llm/health", summary="LLM provider health check", response_model=dict)
async def check_llm_health(
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    """
    Check health of all configured LLM providers with actual API calls.

    Tests each configured provider with a minimal prompt to verify:
    - API connectivity
    - Authentication (API key validity)
    - Model availability
    - Response time

    Returns health status for each provider with detailed metrics.
    """
    from services.reasoning_engine.app.reasoning import get_reasoning_engine
    from datetime import datetime, timezone

    reasoning = get_reasoning_engine()
    cfg = config_store.load()

    health_status = {}

    # Define all possible providers with their config keys
    providers = [
        ("groq", cfg.get("groq_api_key"), cfg.get("llm_model", "qwen/qwen3-32b")),
        (
            "nvidia",
            cfg.get("nvidia_api_key"),
            cfg.get("nvidia_model", "nvidia/llama-3.1-nemotron-ultra-253b-v1"),
        ),
        ("openai", cfg.get("openai_api_key"), cfg.get("openai_model", "gpt-4o")),
        (
            "anthropic",
            cfg.get("anthropic_api_key"),
            cfg.get("anthropic_model", "claude-sonnet-4-5"),
        ),
    ]

    for provider, api_key, model in providers:
        if api_key and model:
            # Provider is configured — run health check
            health_result = reasoning.check_provider_health(provider, api_key, model)
            health_status[provider] = {
                "status": "healthy" if health_result["healthy"] else "unhealthy",
                "model": model,
                "configured": True,
                "enabled": cfg.get(f"{provider}_enabled", True),
                "response_time_ms": health_result["response_time_ms"],
                "error": health_result.get("error"),
            }
        else:
            # Provider not configured
            health_status[provider] = {
                "status": "not_configured",
                "configured": False,
                "enabled": cfg.get(f"{provider}_enabled", False),
                "model": None,
                "response_time_ms": 0,
                "error": None,
            }

    # Add summary
    configured_count = sum(1 for p in health_status.values() if p["configured"])
    healthy_count = sum(
        1 for p in health_status.values() if p.get("status") == "healthy"
    )

    return {
        "providers": health_status,
        "summary": {
            "total_providers": len(providers),
            "configured": configured_count,
            "healthy": healthy_count,
            "unhealthy": configured_count - healthy_count,
        },
        "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
    }


# ════════════════════════════════════════════
# LLM CONFIGURATION DEBUG (Phase 2 endpoint)
# ════════════════════════════════════════════


@router.get("/llm-config", summary="LLM configuration debug endpoint (PHASE 2)")
async def get_llm_config(
    _: CurrentUser = Depends(_admin_only),
) -> dict:
    """
    Return the current LLM configuration for debugging why reasoning engine
    might be skipped. Helps diagnose provider detection issues.

    Returns:
      - llm_enabled: Master toggle for LLM features
      - active_provider: Which provider is currently active (groq/anthropic/openai/none)
      - provider_details: Per-provider config status
      - reasoning_engine_ready: Whether reasoning engine can be initialized
    """
    cfg = config_store.load()

    # ── Determine active provider ──
    def _is_key_present(key_val):
        if isinstance(key_val, str):
            return bool(key_val.strip())
        return bool(key_val)

    groq_active = cfg.get("groq_enabled", True) and _is_key_present(
        cfg.get("groq_api_key", "")
    )
    anthropic_active = cfg.get("anthropic_enabled", False) and _is_key_present(
        cfg.get("anthropic_api_key", "")
    )
    openai_active = cfg.get("openai_enabled", False) and _is_key_present(
        cfg.get("openai_api_key", "")
    )

    active_provider = "none"
    if groq_active:
        active_provider = "groq"
    elif anthropic_active:
        active_provider = "anthropic"
    elif openai_active:
        active_provider = "openai"

    return {
        "llm_enabled": cfg.get("llm_enabled", True),
        "active_provider": active_provider,
        "provider_details": {
            "groq": {
                "enabled": cfg.get("groq_enabled", True),
                "key_present": _is_key_present(cfg.get("groq_api_key", "")),
                "model": cfg.get("llm_model", "qwen/qwen3-32b"),
            },
            "anthropic": {
                "enabled": cfg.get("anthropic_enabled", False),
                "key_present": _is_key_present(cfg.get("anthropic_api_key", "")),
                "model": cfg.get("llm_model", "claude-sonnet-4-5"),
            },
            "openai": {
                "enabled": cfg.get("openai_enabled", False),
                "key_present": _is_key_present(cfg.get("openai_api_key", "")),
                "model": cfg.get("openai_model", "gpt-4o"),
            },
        },
        "reasoning_engine_ready": active_provider != "none"
        and cfg.get("llm_enabled", True),
        "timestamp": time.time(),
    }


# ════════════════════════════════════════════
# AUDIT LOG VIEWER
# ════════════════════════════════════════════


class AuditLogItem(BaseModel):
    id: str
    claim_reference: Optional[str] = None
    event_type: str
    timestamp: str
    actor_type: str
    actor_id: Optional[str] = None
    description: str
    event_data: dict
    service_name: str
    entry_hash: str


class AuditLogsListResponse(BaseModel):
    entries: list[AuditLogItem]
    total: int
    page: int
    page_size: int


@router.get("/audit-logs", response_model=AuditLogsListResponse, tags=["Admin"])
async def list_audit_logs(
    current_user: CurrentUser = Depends(_admin_only),
    reference: Optional[str] = None,
    event_type: Optional[str] = None,
    actor_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
):
    """
    Paginated audit log viewer across ALL claims.
    Supports filters: reference (partial), event_type, actor_type, date range.
    Admin only.
    """
    from sqlalchemy import text as sa_text
    from shared.database import async_session

    try:
        # Build WHERE clause safely using parameterized conditions only.
        # Each condition uses SQLAlchemy :named_params — no f-string interpolation.
        conditions: list[str] = []
        filter_params: dict[str, Any] = {}

        if reference:
            conditions.append("c.claim_reference ILIKE :reference")
            filter_params["reference"] = f"%{reference}%"
        if event_type:
            conditions.append("a.event_type = CAST(:event_type AS audit_event_type)")
            filter_params["event_type"] = event_type
        if actor_type:
            conditions.append("a.actor_type = :actor_type")
            filter_params["actor_type"] = actor_type
        if date_from:
            conditions.append("a.timestamp >= CAST(:date_from AS timestamptz)")
            filter_params["date_from"] = date_from
        if date_to:
            conditions.append(
                "a.timestamp < CAST(:date_to AS timestamptz) + INTERVAL '1 day'"
            )
            filter_params["date_to"] = date_to

        # Safe: conditions list is built from hardcoded strings above,
        # user input is ONLY in params dict (never interpolated into SQL).
        where_sql = (" WHERE " + " AND ".join(conditions)) if conditions else ""

        count_query = sa_text(
            "SELECT COUNT(*) FROM audit_logs a"
            " LEFT JOIN claims c ON c.id = a.claim_id" + where_sql
        )
        select_query = sa_text(
            "SELECT"
            " a.id::text,"
            " c.claim_reference,"
            " a.event_type::text,"
            " a.timestamp,"
            " a.actor_type,"
            " a.actor_id,"
            " a.description,"
            " a.event_data,"
            " a.service_name,"
            " a.entry_hash"
            " FROM audit_logs a"
            " LEFT JOIN claims c ON c.id = a.claim_id"
            + where_sql
            + " ORDER BY a.timestamp DESC"
            " LIMIT :limit OFFSET :offset"
        )

        select_params = {
            **filter_params,
            "limit": page_size,
            "offset": (page - 1) * page_size,
        }

        async with async_session() as session:
            total = (await session.execute(count_query, filter_params)).scalar() or 0
            rows = (await session.execute(select_query, select_params)).mappings().all()

        entries = []
        for r in rows:
            ts = r["timestamp"]
            entries.append(
                {
                    "id": str(r["id"]),
                    "claim_reference": r["claim_reference"],
                    "event_type": r["event_type"],
                    "timestamp": ts.isoformat()
                    if hasattr(ts, "isoformat")
                    else str(ts),
                    "actor_type": r["actor_type"],
                    "actor_id": r["actor_id"],
                    "description": r["description"],
                    "event_data": r["event_data"] or {},
                    "service_name": r["service_name"],
                    "entry_hash": r["entry_hash"],
                }
            )

        return {
            "entries": entries,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Database query failed: {str(exc)[:200]}",
        )


# ════════════════════════════════════════════
# LOGIN SESSIONS
# ════════════════════════════════════════════


@router.get("/login-sessions", summary="List login sessions (ADMIN only)")
async def list_login_sessions(
    email: Optional[str] = None,
    active_only: bool = False,
    page: int = 1,
    page_size: int = 50,
    _admin: CurrentUser = Depends(_admin_only),
):
    """
    Return paginated login session records.
    Filterable by user email and active-only.
    """
    import psycopg2
    import psycopg2.extras
    import os as _os

    db_url = _os.getenv("DATABASE_URL", "")
    # Convert asyncpg DSN to psycopg2 DSN
    sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    offset = (page - 1) * page_size

    try:
        conn = psycopg2.connect(sync_url)
        conn.autocommit = True
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # A session is effectively active only if the DB flag is TRUE, no logout
        # recorded, and the login is still within the refresh-token TTL window.
        # Sessions older than the refresh TTL cannot be active — the token expired.
        refresh_ttl_days = int(_os.getenv("REFRESH_TOKEN_TTL_DAYS") or _os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))
        active_expr = (
            f"(is_active = TRUE AND logout_at IS NULL "
            f"AND login_at > NOW() - INTERVAL '{refresh_ttl_days} days')"
        )
        active_expr_select = (
            f"(ls.is_active = TRUE AND ls.logout_at IS NULL "
            f"AND ls.login_at > NOW() - INTERVAL '{refresh_ttl_days} days')"
        )

        conditions: list[str] = []
        params: list = []

        if email:
            conditions.append("user_email ILIKE %s")
            params.append(f"%{email}%")
        if active_only:
            conditions.append(active_expr)

        where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        cur.execute(
            f"SELECT COUNT(*) AS total FROM login_sessions {where_clause}",
            params,
        )
        total = cur.fetchone()["total"]

        cur.execute(
            f"""
            SELECT id, user_email, user_role, ip_address, user_agent,
                   browser_name, browser_version, os_name, device_type,
                   country, city, market, session_jti,
                   login_at, logout_at, created_at,
                   {active_expr_select} AS is_active,
                   EXISTS (
                       SELECT 1
                       FROM login_sessions newer
                       WHERE newer.user_email = ls.user_email
                         AND COALESCE(newer.device_type, '') = COALESCE(ls.device_type, '')
                         AND COALESCE(newer.browser_name, '') = COALESCE(ls.browser_name, '')
                         AND COALESCE(newer.os_name, '') = COALESCE(ls.os_name, '')
                         AND newer.login_at > ls.login_at
                       LIMIT 1
                   ) AS has_newer_same_device
            FROM   login_sessions ls
            {where_clause}
            ORDER  BY login_at DESC
            LIMIT  %s OFFSET %s
            """,
            params + [page_size, offset],
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()

        sessions = []
        for r in rows:

            def _iso(v):
                return (
                    v.isoformat()
                    if v and hasattr(v, "isoformat")
                    else (str(v) if v else None)
                )

            if r["logout_at"]:
                session_status = "TERMINATED"
                status_reason = "Logout recorded"
            elif bool(r["is_active"]):
                session_status = "ACTIVE"
                status_reason = "Refresh token window is still valid"
            elif bool(r["has_newer_same_device"]):
                session_status = "RESTARTED"
                status_reason = "A newer session exists for the same user and device"
            else:
                session_status = "BROKEN"
                status_reason = "No logout was recorded before expiry"
            location = ", ".join([part for part in (r["city"], r["country"]) if part]) or None

            sessions.append(
                {
                    "id": str(r["id"]),
                    "user_email": r["user_email"],
                    "user_role": r["user_role"],
                    "ip_address": r["ip_address"],
                    "browser_name": r["browser_name"],
                    "browser_version": r["browser_version"],
                    "os_name": r["os_name"],
                    "device_type": r["device_type"],
                    "country": r["country"],
                    "city": r["city"],
                    "market": r["market"],
                    "location": location,
                    "session_status": session_status,
                    "status_reason": status_reason,
                    "session_jti": r["session_jti"],
                    "login_at": _iso(r["login_at"]),
                    "logout_at": _iso(r["logout_at"]),
                    "is_active": bool(r["is_active"]),
                }
            )

        return {
            "sessions": sessions,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"DB query failed: {str(exc)[:200]}"
        )


# ════════════════════════════════════════════
# LLM RELIABILITY MONITORING (PROD-02 FIX)
# ════════════════════════════════════════════


@router.get(
    "/llm-reliability/metrics", summary="Get LLM reliability metrics (ADMIN only)"
)
async def get_llm_reliability_metrics(
    _admin: CurrentUser = Depends(_admin_only),
):
    """
    Return LLM reliability metrics including:
    - Circuit breaker state per provider
    - Failure rate over rolling 10-minute window
    - Retry counts and success rates
    - Response cache statistics

    PROD-02: Groq LLM Stability monitoring
    """
    try:
        # Lazy import reasoning engine
        from services.reasoning_engine.app.reasoning import get_reasoning_engine

        reasoning_eng = get_reasoning_engine()

        if not reasoning_eng:
            return {
                "available": False,
                "reason": "Reasoning engine not initialized",
            }

        metrics = reasoning_eng.get_reliability_metrics()
        return {
            "available": True,
            "timestamp": time.time(),
            "providers": metrics,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch LLM reliability metrics: {str(e)[:200]}",
        )


@router.post(
    "/llm-reliability/circuit-breaker/{provider}/reset",
    summary="Reset circuit breaker (ADMIN only)",
)
async def reset_circuit_breaker(
    provider: str,
    _admin: CurrentUser = Depends(_admin_only),
):
    """
    Manually reset circuit breaker for a specific LLM provider.
    Useful after fixing provider issues or clearing false positives.

    PROD-02: Groq LLM Stability management
    """
    try:
        from services.reasoning_engine.app.reasoning import get_reasoning_engine

        reasoning_eng = get_reasoning_engine()

        if not reasoning_eng:
            raise HTTPException(
                status_code=503, detail="Reasoning engine not available"
            )

        reasoning_eng.reset_circuit(provider)

        return {
            "success": True,
            "message": f"Circuit breaker reset for provider: {provider}",
            "provider": provider,
            "reset_at": time.time(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to reset circuit breaker: {str(e)[:200]}"
        )


@router.post(
    "/llm-reliability/cache/clear", summary="Clear LLM response cache (ADMIN only)"
)
async def clear_llm_cache(
    _admin: CurrentUser = Depends(_admin_only),
):
    """
    Clear all cached LLM responses.
    Useful after policy updates or when suspecting stale cache data.

    PROD-02: Groq LLM Stability management
    """
    try:
        from services.reasoning_engine.app.reasoning import get_reasoning_engine

        reasoning_eng = get_reasoning_engine()

        if not reasoning_eng:
            raise HTTPException(
                status_code=503, detail="Reasoning engine not available"
            )

        reasoning_eng.clear_cache()

        return {
            "success": True,
            "message": "LLM response cache cleared",
            "cleared_at": time.time(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to clear cache: {str(e)[:200]}"
        )


# ════════════════════════════════════════════
# ANALYTICS REPORTS
# ════════════════════════════════════════════

_REPORT_CONFIGS: dict[str, dict] = {
    "claims": {
        "date_column": "c.service_date",
        "date_anchor_sql": "SELECT MAX(c.service_date) FROM claims c",
        "columns": [
            {"key": "claim_reference", "label": "Reference"},
            {"key": "patient_name",    "label": "Patient"},
            {"key": "market_region",   "label": "Market"},
            {"key": "claim_type",      "label": "Claim Type"},
            {"key": "status",          "label": "Status"},
            {"key": "total_billed",    "label": "Billed Amount"},
            {"key": "total_settlement","label": "Settlement"},
            {"key": "service_date",    "label": "Service Date"},
            {"key": "submitted_at",    "label": "Submitted At"},
        ],
        "select": (
            "SELECT c.claim_reference, c.patient_name, c.market_region::text,"
            " c.claim_type::text, c.status::text, c.total_billed::text,"
            " COALESCE(c.total_settlement::text, '') AS total_settlement,"
            " c.service_date::text,"
            " c.created_at::text AS submitted_at"
            " FROM claims c"
        ),
        "count": "SELECT COUNT(*) FROM claims c",
    },
    "settlements": {
        "date_column": "c.service_date",
        "date_anchor_sql": (
            "SELECT MAX(s.created_at::date)"
            " FROM settlements s JOIN claims c ON c.id = s.claim_id"
        ),
        "columns": [
            {"key": "claim_reference",        "label": "Reference"},
            {"key": "patient_name",            "label": "Patient"},
            {"key": "market_region",           "label": "Market"},
            {"key": "total_billed",            "label": "Billed"},
            {"key": "total_allowed",           "label": "Allowed"},
            {"key": "total_plan_payment",      "label": "Plan Payment"},
            {"key": "total_member_responsibility", "label": "Member Resp."},
            {"key": "confidence_score",        "label": "Confidence %"},
            {"key": "settled_at",              "label": "Settled At"},
        ],
        "select": (
            "SELECT c.claim_reference, c.patient_name, c.market_region::text,"
            " s.total_billed::text, s.total_allowed::text,"
            " s.total_plan_payment::text, s.total_member_responsibility::text,"
            " s.confidence_score::text, s.created_at::text AS settled_at"
            " FROM settlements s JOIN claims c ON c.id = s.claim_id"
        ),
        "count": "SELECT COUNT(*) FROM settlements s JOIN claims c ON c.id = s.claim_id",
    },
    "hitl": {
        "date_column": "c.service_date",
        "date_anchor_sql": (
            "SELECT MAX(c.service_date)"
            " FROM claims c"
            " WHERE c.status IN ('HITL_PENDING','HITL_IN_REVIEW')"
        ),
        "columns": [
            {"key": "claim_reference", "label": "Reference"},
            {"key": "patient_name",    "label": "Patient"},
            {"key": "market_region",   "label": "Market"},
            {"key": "status",          "label": "Status"},
            {"key": "trigger_reason",  "label": "Trigger"},
            {"key": "ai_amount",       "label": "AI Amount"},
            {"key": "queued_at",       "label": "Queued At"},
            {"key": "reviewer",        "label": "Reviewer"},
        ],
        "select": (
            "SELECT c.claim_reference, c.patient_name, c.market_region::text,"
            " c.status::text,"
            " COALESCE(h.trigger_reason::text, '') AS trigger_reason,"
            " COALESCE(h.ai_settlement_amount::text, '') AS ai_amount,"
            " COALESCE(h.created_at::text, c.created_at::text) AS queued_at,"
            " COALESCE(u.full_name, u.email, '') AS reviewer"
            " FROM claims c"
            " LEFT JOIN hitl_reviews h ON h.claim_id = c.id"
            " LEFT JOIN users u ON u.id = h.assigned_to"
            " WHERE c.status IN ('HITL_PENDING','HITL_IN_REVIEW')"
        ),
        "count": (
            "SELECT COUNT(*) FROM claims c"
            " LEFT JOIN hitl_reviews h ON h.claim_id = c.id"
            " WHERE c.status IN ('HITL_PENDING','HITL_IN_REVIEW')"
        ),
        "no_where": True,  # WHERE already baked in
    },
    "denials": {
        "date_column": "c.service_date",
        "date_anchor_sql": "SELECT MAX(c.service_date) FROM claims c WHERE c.status = 'DENIED'",
        "columns": [
            {"key": "claim_reference", "label": "Reference"},
            {"key": "patient_name",    "label": "Patient"},
            {"key": "market_region",   "label": "Market"},
            {"key": "denial_code",     "label": "Denial Code"},
            {"key": "denial_reason",   "label": "Denial Reason"},
            {"key": "total_billed",    "label": "Denied Amount"},
            {"key": "service_date",    "label": "Service Date"},
        ],
        "select": (
            "SELECT c.claim_reference, c.patient_name, c.market_region::text,"
            " COALESCE(li.denial_code, '') AS denial_code,"
            " COALESCE(li.denial_reason, '') AS denial_reason,"
            " c.total_billed::text, c.service_date::text"
            " FROM claims c"
            " LEFT JOIN claim_line_items li ON li.claim_id = c.id AND li.denial_code IS NOT NULL"
            " WHERE c.status = 'DENIED'"
        ),
        "count": "SELECT COUNT(*) FROM claims c WHERE c.status = 'DENIED'",
        "no_where": True,
    },
    "processing": {
        "date_column": "c.service_date",
        "date_anchor_sql": "SELECT MAX(c.service_date) FROM claims c",
        "columns": [
            {"key": "claim_reference", "label": "Reference"},
            {"key": "market_region",   "label": "Market"},
            {"key": "claim_type",      "label": "Claim Type"},
            {"key": "status",          "label": "Status"},
            {"key": "confidence_score","label": "Confidence %"},
            {"key": "total_billed",    "label": "Billed"},
            {"key": "submitted_at",    "label": "Submitted At"},
            {"key": "service_date",    "label": "Service Date"},
        ],
        "select": (
            "SELECT c.claim_reference, c.market_region::text, c.claim_type::text,"
            " c.status::text,"
            " COALESCE(s.confidence_score::text, '') AS confidence_score,"
            " c.total_billed::text, c.created_at::text AS submitted_at,"
            " c.service_date::text"
            " FROM claims c LEFT JOIN settlements s ON s.claim_id = c.id"
        ),
        "count": "SELECT COUNT(*) FROM claims c",
    },
}


@router.get("/reports", summary="Analytics report data (ADMIN only)")
async def get_admin_reports(
    category: str = "claims",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    market_region: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    _admin: CurrentUser = Depends(_admin_only),
):
    """
    Paginated analytics report.  Category selects the view:
      claims | settlements | hitl | denials | processing
    Filters: date_from (YYYY-MM-DD), date_to, market_region, page, page_size.
    """
    from sqlalchemy import text as sa_text
    from shared.database import async_session

    if category not in _REPORT_CONFIGS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category '{category}'. Must be one of: {sorted(_REPORT_CONFIGS)}",
        )

    cfg = _REPORT_CONFIGS[category]
    page     = max(1, page)
    page_size = min(max(1, page_size), 10_000)
    parsed_date_from = _parse_iso_date_param(date_from, "date_from")
    parsed_date_to = _parse_iso_date_param(date_to, "date_to")
    date_column = cfg.get("date_column", "c.service_date")
    date_anchor_sql = cfg.get("date_anchor_sql", f"SELECT MAX({date_column}) FROM claims c")

    # Build additional WHERE conditions (on top of any already baked in)
    extra_conds: list[str] = []
    params: dict[str, Any] = {}
    already_has_where = cfg.get("no_where", False)

    if parsed_date_from:
        extra_conds.append(f"{date_column} >= :date_from")
        params["date_from"] = parsed_date_from
    if parsed_date_to:
        extra_conds.append(f"{date_column} <= :date_to")
        params["date_to"] = parsed_date_to
    if market_region:
        extra_conds.append("c.market_region = CAST(:market_region AS market_region)")
        params["market_region"] = market_region

    if extra_conds:
        joiner = " AND " if already_has_where else " WHERE "
        extra_sql = joiner + " AND ".join(extra_conds)
    else:
        extra_sql = ""

    anchor_conds: list[str] = []
    anchor_params: dict[str, Any] = {}
    if market_region:
        anchor_conds.append("c.market_region = CAST(:market_region AS market_region)")
        anchor_params["market_region"] = market_region
    if anchor_conds:
        anchor_joiner = " AND " if already_has_where else " WHERE "
        anchor_extra_sql = anchor_joiner + " AND ".join(anchor_conds)
    else:
        anchor_extra_sql = ""

    count_sql = sa_text(cfg["count"] + extra_sql)
    anchor_sql = sa_text(date_anchor_sql + anchor_extra_sql)
    data_sql  = sa_text(
        cfg["select"] + extra_sql +
        " ORDER BY c.created_at DESC LIMIT :limit OFFSET :offset"
    )
    data_params = {**params, "limit": page_size, "offset": (page - 1) * page_size}

    try:
        async with async_session() as session:
            date_anchor = (await session.execute(anchor_sql, anchor_params)).scalar()
            total = (await session.execute(count_sql, params)).scalar() or 0
            rows  = (await session.execute(data_sql, data_params)).mappings().all()

        records = [
            {k: (str(v) if v is not None else "") for k, v in row.items()}
            for row in rows
        ]

        return {
            "category":      category,
            "date_anchor":   str(date_anchor)[:10] if date_anchor else None,
            "total_records": total,
            "page":          page,
            "page_size":     page_size,
            "columns":       cfg["columns"],
            "records":       records,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Report query failed: {str(exc)[:300]}")


# ════════════════════════════════════════════
# CLAIMS CSV EXPORT
# ════════════════════════════════════════════

@router.get("/claims/export", summary="Export claims as CSV (ADMIN only)")
async def export_claims_csv(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    market: Optional[str] = None,
    _admin: CurrentUser = Depends(_admin_only),
):
    """
    Stream a CSV download of all claims matching the given filters.
    Params: date_from, date_to (YYYY-MM-DD), status, market.
    """
    import csv, io
    from sqlalchemy import text as sa_text
    from shared.database import async_session

    parsed_date_from = _parse_iso_date_param(date_from, "date_from")
    parsed_date_to = _parse_iso_date_param(date_to, "date_to")
    conds: list[str] = []
    params: dict[str, Any] = {}

    if parsed_date_from:
        conds.append("service_date >= :date_from")
        params["date_from"] = parsed_date_from
    if parsed_date_to:
        conds.append("service_date <= :date_to")
        params["date_to"] = parsed_date_to
    if status and status.upper() != "ALL":
        conds.append("status::text = :status")
        params["status"] = status.upper()
    if market and market.upper() != "ALL":
        conds.append("market_region::text = :market")
        params["market"] = market.upper()

    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    sql = sa_text(
        "SELECT claim_reference, patient_name, market_region::text, status::text,"
        " claim_type::text, total_billed, total_settlement, service_date, created_at"
        " FROM claims" + where + " ORDER BY created_at DESC"
    )

    try:
        async with async_session() as session:
            rows = (await session.execute(sql, params)).mappings().all()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Export query failed: {str(exc)[:200]}")

    def generate_csv():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "Reference", "Patient", "Market", "Status", "Claim Type",
            "Billed Amount", "Settlement Amount", "Service Date", "Submitted At",
        ])
        for r in rows:
            writer.writerow([
                r["claim_reference"],
                r["patient_name"] or "",
                r["market_region"] or "",
                r["status"] or "",
                r["claim_type"] or "",
                str(r["total_billed"] or ""),
                str(r["total_settlement"] or ""),
                str(r["service_date"] or ""),
                str(r["created_at"] or ""),
            ])
        yield buf.getvalue()

    filename = f"claims-export-{date_from or 'all'}-{date_to or 'now'}.csv"
    return StreamingResponse(
        generate_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ════════════════════════════════════════════
# AUDIT LOG CSV EXPORT
# ════════════════════════════════════════════

@router.post("/audit-log-export", summary="Export audit logs as CSV (ADMIN only)")
@router.get("/audit-log-export", summary="Export audit logs as CSV (ADMIN only)")
async def export_audit_log_csv(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    event_type: Optional[str] = None,
    reference: Optional[str] = None,
    _admin: CurrentUser = Depends(_admin_only),
):
    """
    Stream a CSV of audit log entries matching the given filters.
    Supports both GET (query params) and POST (same query params).
    """
    import csv, io
    from sqlalchemy import text as sa_text
    from shared.database import async_session

    conds: list[str] = []
    params: dict[str, Any] = {}

    if reference:
        conds.append("c.claim_reference ILIKE :reference")
        params["reference"] = f"%{reference}%"
    if event_type:
        conds.append("a.event_type = CAST(:event_type AS audit_event_type)")
        params["event_type"] = event_type
    if date_from:
        conds.append("a.timestamp >= CAST(:date_from AS timestamptz)")
        params["date_from"] = date_from
    if date_to:
        conds.append("a.timestamp < CAST(:date_to AS timestamptz) + INTERVAL '1 day'")
        params["date_to"] = date_to

    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    sql = sa_text(
        "SELECT a.event_type::text, a.timestamp, a.actor_type, a.actor_id,"
        " a.description, a.service_name, a.entry_hash,"
        " c.claim_reference"
        " FROM audit_logs a LEFT JOIN claims c ON c.id = a.claim_id"
        + where + " ORDER BY a.timestamp DESC LIMIT 50000"
    )

    try:
        async with async_session() as session:
            rows = (await session.execute(sql, params)).mappings().all()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Audit export failed: {str(exc)[:200]}")

    def generate_csv():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "Event Type", "Timestamp", "Actor Type", "Actor ID",
            "Description", "Service", "Claim Reference", "Entry Hash",
        ])
        for r in rows:
            writer.writerow([
                r["event_type"] or "",
                str(r["timestamp"] or ""),
                r["actor_type"] or "",
                r["actor_id"] or "",
                r["description"] or "",
                r["service_name"] or "",
                r["claim_reference"] or "",
                r["entry_hash"] or "",
            ])
        yield buf.getvalue()

    from datetime import date as _date, timezone
    filename = f"audit-log-export-{_date.today().isoformat()}.csv"
    return StreamingResponse(
        generate_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
