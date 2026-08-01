"""
TOTP Authentication — FastAPI router
======================================
Endpoints:
  POST /api/v1/auth/totp/has-setup  — check if email has TOTP configured (no enumeration)
  POST /api/v1/auth/totp/setup      — generate (or re-show) QR code PNG for authenticator setup
  POST /api/v1/auth/totp/login      — verify 6-digit TOTP code → issue JWT httpOnly cookie

Flow:
  1. Frontend calls /has-setup to decide whether to show QR or just the code box.
  2. First-time users call /setup → get QR → scan with Google Authenticator / Authy.
  3. All subsequent logins: enter 6-digit rolling code → /login → JWT cookie issued.
"""
from __future__ import annotations

import base64
import io
import logging

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel
from typing import Optional

import pyotp
import qrcode

from .totp_store import (
    confirm_secret, get_secret, has_confirmed, has_secret, set_secret,
    generate_backup_codes, store_backup_codes, verify_backup_code, revoke_backup_code
)
from .auth import (
    _get_user_by_email,
    create_access_token,
    _COOKIE_SECURE,
    ACCESS_TOKEN_TTL,
    AccessToken,
    _decode_token,
)
from .request_security import apply_sensitive_response_headers
import os

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth/totp", tags=["TOTP Auth"])

APP_NAME = "ACOS"

# ── Rate limiting helpers ──────────────────────────────────────────────────────

def _get_redis():
    """Lazy Redis connection for rate limiting."""
    try:
        import redis
        from .auth import resolve_redis_url

        redis_url = resolve_redis_url()
        r = redis.Redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
        r.ping()
        return r
    except Exception:
        logger.warning("[TOTP] Redis unavailable — rate limiting disabled")
        return None


def _check_totp_lockout(email: str) -> None:
    """Raise 429 if too many failed TOTP attempts."""
    r = _get_redis()
    if not r:
        return
    key = f"totp_attempts:{email.lower()}"
    try:
        attempts = r.get(key)
        if attempts and int(attempts) >= 3:
            ttl = r.ttl(key)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many invalid codes. Try again in {max(ttl, 1)} seconds.",
            )
    except HTTPException:
        raise
    except Exception:
        pass


def _record_failed_totp(email: str) -> None:
    """Increment failed TOTP counter (10-min lockout)."""
    r = _get_redis()
    if not r:
        return
    key = f"totp_attempts:{email.lower()}"
    try:
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, 600)  # 10 minutes
        pipe.execute()
    except Exception:
        pass


def _clear_totp_attempts(email: str) -> None:
    """Clear failed TOTP counter on successful login."""
    r = _get_redis()
    if not r:
        return
    try:
        r.delete(f"totp_attempts:{email.lower()}")
    except Exception:
        pass


# ── Request / Response models ──────────────────────────────────────────────────

class HasSetupRequest(BaseModel):
    email: str


class HasSetupResponse(BaseModel):
    configured: bool


class SetupRequest(BaseModel):
    email: str


class SetupResponse(BaseModel):
    qr_b64: str   # base64-encoded PNG bytes
    uri: str      # otpauth:// provisioning URI (for manual entry)
    is_new: bool  # True if this is the first setup for this account
    backup_codes: Optional[list[str]] = None  # 10 single-use backup codes (only on first setup)


class LoginRequest(BaseModel):
    email: str
    code: str     # 6-digit TOTP code from the authenticator app (or 8-char backup code)
    mfa_pending_token: Optional[str] = None  # Optional: from password login MFA_REQUIRED response


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/has-setup",
    response_model=HasSetupResponse,
    summary="Check if TOTP is configured for an email",
)
async def totp_has_setup(body: HasSetupRequest) -> HasSetupResponse:
    """
    Returns whether the email has completed TOTP setup (scanned QR + verified first code).
    Always returns 200 (even for unknown emails) to prevent user enumeration.
    Returns configured=True only after the user has successfully logged in once —
    that is when they've genuinely scanned the QR and confirmed it works.
    """
    email = body.email.strip().lower()
    user  = _get_user_by_email(email)
    if not user:
        # Return false for unknown emails — no enumeration
        return HasSetupResponse(configured=False)
    return HasSetupResponse(configured=has_confirmed(email))


@router.post(
    "/setup",
    response_model=SetupResponse,
    summary="Generate QR code for authenticator app setup",
)
async def totp_setup(body: SetupRequest) -> SetupResponse:
    """
    Generates (or retrieves) a TOTP secret for the email and returns a QR code PNG (base64).
    - First call: generates a new secret (is_new=True) + returns 10 backup codes.
    - Subsequent calls: returns the same QR code (is_new=False) — no new codes.
    User must exist in the system to set up TOTP.
    """
    email = body.email.strip().lower()
    user  = _get_user_by_email(email)
    if not user:
        raise HTTPException(
            status_code=404,
            detail="No account found for that email address.",
        )

    backup_codes = None
    is_new = not has_secret(email)

    if is_new:
        secret = pyotp.random_base32()
        set_secret(email, secret)

        # Generate + store 10 single-use backup codes
        backup_codes = generate_backup_codes(10)
        store_backup_codes(email, backup_codes)

        logger.info("[TOTP] new authenticator + backup codes registered for %s", email)
    else:
        secret = get_secret(email)
        logger.info("[TOTP] re-showing QR for %s", email)

    # Build the otpauth:// provisioning URI
    totp = pyotp.TOTP(secret)
    uri  = totp.provisioning_uri(name=email, issuer_name=APP_NAME)

    # Render as QR code PNG, return as base64
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    return SetupResponse(qr_b64=qr_b64, uri=uri, is_new=is_new, backup_codes=backup_codes)


@router.post(
    "/login",
    response_model=AccessToken,
    summary="Verify TOTP code (or backup code) and issue JWT access token",
)
async def totp_login(body: LoginRequest, response: Response) -> AccessToken:
    """
    Verifies the 6-digit TOTP code (or 8-char backup code) for the email.

    Supports two flows:
    1. MFA_REQUIRED flow (with mfa_pending_token from password login)
    2. Existing TOTP login (email + code only)

    On success: issues a JWT access token via httpOnly cookie (same as password login).
    valid_window=1 allows ±1 time-step tolerance (±30 seconds) for clock skew.

    Rate limiting: 3 failed attempts = 10-minute lockout.
    """
    apply_sensitive_response_headers(response)  # TOTP token response must not be stored in any cache

    email = body.email.strip().lower()
    code  = body.code.strip().replace(" ", "")

    # ── Rate limiting: check lockout before processing ──
    _check_totp_lockout(email)

    # ── If mfa_pending_token provided, validate it (MFA_REQUIRED flow) ──
    if body.mfa_pending_token:
        try:
            pending_payload = _decode_token(body.mfa_pending_token, "mfa_pending")
            if pending_payload["sub"] != email:
                _record_failed_totp(email)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="MFA token email mismatch"
                )
        except HTTPException:
            raise
        except Exception:
            _record_failed_totp(email)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="MFA token expired. Re-login with your password."
            )

    # Validate user exists
    user = _get_user_by_email(email)
    if not user:
        _record_failed_totp(email)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Validate TOTP secret configured
    secret = get_secret(email)
    if not secret:
        _record_failed_totp(email)
        raise HTTPException(
            status_code=403,
            detail="Authenticator not configured. Please scan the QR code to set up your app first.",
        )

    # ── Try TOTP code first, then backup code ──
    is_valid_code = False

    # Try TOTP code (±30 s tolerance)
    totp = pyotp.TOTP(secret)
    if totp.verify(code, valid_window=1):
        is_valid_code = True
    # Try backup code as fallback
    elif verify_backup_code(email, code):
        revoke_backup_code(email, code)  # Mark as used
        is_valid_code = True
        logger.info("[TOTP] backup code used for %s", email)

    if not is_valid_code:
        _record_failed_totp(email)
        logger.warning("[TOTP] failed verification: email=%s", email)
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired code. Open your authenticator app and try again.",
        )

    # ── Clear failed attempts on success ──
    _clear_totp_attempts(email)

    # ── Mark setup as confirmed + set mfa_enabled=True (idempotent) ──
    confirm_secret(email)
    from services.api_gateway.app import user_store
    user_store.update(email, {"mfa_enabled": True})

    # Issue JWT (same format as password login)
    user_dict = {
        "email":         user["email"],
        "role":          user["role"],
        "id":            user["id"],
        "market_region": user.get("market_region", "UAE"),
    }
    token = create_access_token(user_dict)

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="strict",
        max_age=ACCESS_TOKEN_TTL * 60,
        path="/",
    )
    logger.info("[TOTP] login success: %s (%s)", email, user["role"])
    return AccessToken(
        access_token=token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_TTL * 60,
    )
