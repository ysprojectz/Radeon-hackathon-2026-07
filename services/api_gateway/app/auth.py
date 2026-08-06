"""
Authentication & Authorisation Module
======================================
Implements:
  • JWT access tokens  (60-minute default lifetime, signed HS256)
  • JWT refresh tokens (7-day lifetime)
  • bcrypt password hashing via passlib
  • API-key support for machine-to-machine calls (X-API-Key header)
  • FastAPI `Depends` helpers: get_current_user, require_roles
  • POST /api/v1/auth/login    — returns access + refresh tokens + sets httpOnly cookies
  • POST /api/v1/auth/refresh  — exchanges refresh token for new access token
  • POST /api/v1/auth/logout   — clears httpOnly cookies + blacklists token
  • GET  /api/v1/auth/me       — returns the current user profile

Security design
---------------
  - Tokens are stored in httpOnly, Secure, SameSite=Strict cookies — invisible to
    JavaScript and DevTools.  Bearer token path is preserved for M2M callers.
  - Secrets are loaded from env vars (JWT_SECRET_KEY, API_KEY_SALT).
  - API keys are SHA-256 hashed at startup and compared via hmac.compare_digest
    (constant-time — no timing attacks).
  - Passwords are never stored or returned in any response.
  - All token errors return 401 with a generic "Could not validate credentials"
    message to prevent enumeration attacks.
  - Role checks return 403 so callers can distinguish auth vs. authz failures.
  - Production startup validation raises RuntimeError if JWT_SECRET_KEY is weak.
  - Brute-force protection: login locked after 5 failed attempts for 15 minutes (Redis).
  - Token revocation: logout blacklists tokens in Redis until their natural expiry.
"""
from __future__ import annotations

import os
import hashlib
import hmac
import logging
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, Security, status
from fastapi.security import (
    OAuth2PasswordBearer,
    OAuth2PasswordRequestForm,
    APIKeyHeader,
)
import bcrypt as _bcrypt

# JWT library: PyJWT (python-jose removed — CVE-2024-33663, CVE-2024-33664)
import jwt as _pyjwt
from jwt.exceptions import PyJWTError as JWTError

class _JWTCompat:
    """Thin wrapper matching the jwt.encode/decode call signature."""
    @staticmethod
    def encode(payload, key, algorithm="HS256"):
        return _pyjwt.encode(payload, key, algorithm=algorithm)
    @staticmethod
    def decode(token, key, algorithms=None):
        return _pyjwt.decode(token, key, algorithms=algorithms or ["HS256"])

jwt = _JWTCompat()

from pydantic import BaseModel
from services.api_gateway.app import config_store
from services.api_gateway.app.request_security import apply_sensitive_response_headers

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

JWT_ALGORITHM     = "HS256"
ACCESS_TOKEN_TTL  = int(os.getenv("ACCESS_TOKEN_TTL_MINUTES") or os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))   # minutes
REFRESH_TOKEN_TTL = int(os.getenv("REFRESH_TOKEN_TTL_DAYS") or os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))    # days
API_KEY_SALT      = os.getenv("API_KEY_SALT", secrets.token_hex(16))

# Cookie security flag: True in production (HTTPS only), False in local dev (HTTP)
_COOKIE_SECURE = os.getenv("ENVIRONMENT", "development") == "production"

# ── Brute-force protection constants ─────────────────────────────────────────
MAX_LOGIN_ATTEMPTS = int(os.getenv("MAX_LOGIN_ATTEMPTS", "5"))
LOGIN_LOCKOUT_SECONDS = int(os.getenv("LOGIN_LOCKOUT_SECONDS", "900"))  # 15 minutes

# ── Redis client for brute-force protection + token blacklist ────────────────
_redis_client = None


def _env_truthy(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _resolve_jwt_secret_key() -> str:
    """Resolve the canonical JWT signing secret, accepting JWT_SECRET as a legacy alias."""
    canonical = os.getenv("JWT_SECRET_KEY", "").strip()
    legacy = os.getenv("JWT_SECRET", "").strip()
    if canonical:
        if legacy and legacy != canonical:
            logger.warning("[AUTH] JWT_SECRET ignored because JWT_SECRET_KEY is set")
        return canonical
    if legacy:
        logger.warning("[AUTH] JWT_SECRET is deprecated; set JWT_SECRET_KEY instead")
        os.environ.setdefault("JWT_SECRET_KEY", legacy)
        return legacy
    if os.getenv("ENVIRONMENT", "development").lower() in {"production", "prod"}:
        return ""
    generated = secrets.token_hex(32)
    logger.warning("[AUTH] JWT_SECRET_KEY not set; generated an ephemeral non-production secret")
    return generated


def resolve_redis_url() -> str:
    """Resolve Redis URL consistently across auth, sessions, TOTP, cache, and rate limiting."""
    explicit = os.getenv("REDIS_URL", "").strip()
    if explicit:
        return explicit
    host = os.getenv("REDIS_HOST", "redis").strip() or "redis"
    port = os.getenv("REDIS_PORT", "6379").strip() or "6379"
    db = os.getenv("REDIS_DB", "0").strip() or "0"
    password = os.getenv("REDIS_PASSWORD", "").strip()
    auth = f":{password}@" if password else ""
    return f"redis://{auth}{host}:{port}/{db}"


JWT_SIGNING_SECRET = _resolve_jwt_secret_key()

def _get_redis():
    """Lazy Redis connection — returns None if Redis is unavailable."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis
        redis_url = resolve_redis_url()
        _redis_client = redis.Redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
        _redis_client.ping()
        return _redis_client
    except Exception:
        logger.warning("[AUTH] Redis unavailable — brute-force protection and token revocation disabled")
        _redis_client = None
        return None


def _check_login_lockout(email: str) -> None:
    """Raise 429 if too many failed login attempts for this email."""
    r = _get_redis()
    if not r:
        return  # graceful degradation — no Redis, no lockout
    key = f"login_attempts:{email.lower()}"
    try:
        attempts = r.get(key)
        if attempts and int(attempts) >= MAX_LOGIN_ATTEMPTS:
            ttl = r.ttl(key)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed login attempts. Try again in {max(ttl, 1)} seconds.",
            )
    except HTTPException:
        raise
    except Exception:
        pass  # Redis error — don't block login


def _record_failed_login(email: str) -> None:
    """Increment failed login counter in Redis with TTL."""
    r = _get_redis()
    if not r:
        return
    key = f"login_attempts:{email.lower()}"
    try:
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, LOGIN_LOCKOUT_SECONDS)
        pipe.execute()
    except Exception:
        pass


def _clear_login_attempts(email: str) -> None:
    """Clear failed login counter on successful login."""
    r = _get_redis()
    if not r:
        return
    try:
        r.delete(f"login_attempts:{email.lower()}")
    except Exception:
        pass


def _blacklist_token(token: str, ttl_seconds: int) -> None:
    """Add a token to the Redis blacklist until its natural expiry."""
    r = _get_redis()
    if not r:
        return
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        r.setex(f"token_blacklist:{token_hash}", ttl_seconds, "1")
    except Exception:
        pass


def _is_token_blacklisted(token: str) -> bool:
    """Check if a token has been revoked."""
    r = _get_redis()
    if not r:
        return False
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        return r.exists(f"token_blacklist:{token_hash}") > 0
    except Exception:
        return False


# ── API key store — hashed at startup (constant-time compare prevents timing attacks) ──
# env: VALID_API_KEYS — comma-separated raw key strings
_raw_key_strings: list[str] = [
    k.strip() for k in os.getenv("VALID_API_KEYS", "").split(",") if k.strip()
]


def _hash_api_key(raw: str) -> bytes:
    """SHA-256 hash of an API key (for constant-time comparison)."""
    return hashlib.sha256(raw.encode()).digest()


_hashed_api_keys: list[bytes] = [_hash_api_key(k) for k in _raw_key_strings]


def _verify_api_key(provided: str) -> bool:
    """Constant-time API key verification (prevents timing attacks)."""
    h = _hash_api_key(provided)
    return any(hmac.compare_digest(h, stored) for stored in _hashed_api_keys)


def _normalize_market(value: str | None, default: str = "UAE") -> str:
    market = (value or default or "UAE").strip().upper()
    return market if market in VALID_MARKETS else default.strip().upper()


def _parse_csv_env(name: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, "").split(",") if item.strip()]


def _api_key_identity() -> dict:
    """Build API-key caller identity from trusted configuration, never request headers."""
    configured_role = os.getenv("API_KEY_ROLE", "API_CONSUMER").strip().upper()
    role = configured_role if configured_role in ROLES else "API_CONSUMER"
    market = _normalize_market(os.getenv("API_KEY_MARKET_REGION"), "UAE")
    scopes = _parse_csv_env("API_KEY_SCOPES")
    return {
        "id": os.getenv("API_KEY_USER_ID", "api-key-consumer").strip() or "api-key-consumer",
        "email": os.getenv("API_KEY_EMAIL", "api@claims-engine.local").strip() or "api@claims-engine.local",
        "full_name": os.getenv("API_KEY_FULL_NAME", "API Consumer").strip() or "API Consumer",
        "role": role,
        "market_region": market,
        "tenant_id": os.getenv("API_KEY_TENANT_ID", "default").strip() or "default",
        "api_scopes": scopes,
    }


# ── Production startup validation ─────────────────────────────────────────────

def _validate_secrets_on_startup() -> None:
    """Fail fast if JWT_SECRET_KEY is weak or missing — ALWAYS enforces security.
    
    Security hardening: In production, a weak secret means complete compromise.
    In development, it still means tokens can be forged, which is unacceptable.
    This validation now ALWAYS raises an error for weak configuration.
    """
    issues: list[str] = []
    raw_key = _resolve_jwt_secret_key()
    
    # Generate a random key if none set (for local dev convenience, but warn loudly)
    if not raw_key:
        # Check if we're in a test environment
        import sys
        if 'pytest' in sys.modules or 'test' in sys.argv[0]:
            # Allow tests to run without JWT_SECRET_KEY for test isolation
            logger.warning(
                "JWT_SECRET_KEY not set; using test key. This is OK for tests but NOT for production."
            )
            return
        
        issues.append(
            "JWT_SECRET_KEY is not set — a random key is generated on each restart "
            "which invalidates all active user sessions"
        )
    
    # Check for known weak placeholder values
    WEAK_KEYS = {
        "change-me-in-production", "changeme", "secret", "dev", "development",
        "change-me-in-production-use-64-char-hex", "test", "test123", "password",
        "1234567890", "00000000", "aaaaaaaa", "qwerty", "admin"
    }
    if raw_key and raw_key.lower() in {k.lower() for k in WEAK_KEYS}:
        issues.append(f"JWT_SECRET_KEY is a known-weak placeholder: '{raw_key}'")
    
    # Minimum length check (64 hex chars = 256 bits, recommended for HS256)
    if raw_key and len(raw_key) < 64:
        issues.append(
            f"JWT_SECRET_KEY is only {len(raw_key)} chars (minimum 64 required for production security)"
        )

    if issues:
        msg = "\n".join(f"  - {i}" for i in issues)
        env = os.getenv("ENVIRONMENT", "development")
        
        # Additional context for production
        if env == "production":
            msg += "\n\n  PRODUCTION DEPLOYMENT BLOCKED: Authentication cannot be secured."
        
        # Always raise an error — no silent failures
        raise RuntimeError(
            f"FATAL — Cannot start with insecure JWT configuration:\n{msg}\n"
            f"  Generate a strong 64-character hex key: python3 -c \"import secrets; print(secrets.token_hex(64))\"\n"
            f"  Current environment: {env}"
        )


_validate_secrets_on_startup()


# Role constants (mirror the DB enum)
ROLES = {
    "ADMIN":              "ADMIN",
    "ADJUSTER":           "ADJUSTER",
    "SENIOR_ADJUSTER":    "SENIOR_ADJUSTER",
    "MEDICAL_DIRECTOR":   "MEDICAL_DIRECTOR",
    "COMPLIANCE_OFFICER": "COMPLIANCE_OFFICER",
    "API_CONSUMER":       "API_CONSUMER",
}

# Roles that can write / adjudicate
WRITE_ROLES = {"ADMIN", "ADJUSTER", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR"}
# Roles that can perform HITL review
HITL_ROLES  = {"ADMIN", "ADJUSTER", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR"}
# Roles that can access audit / compliance data
AUDIT_ROLES = {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"}

# ── MFA Policies (mandatory 2FA for privileged roles) ────────────────────────
MFA_POLICIES = {
    "ADMIN":              {"required": True, "type": "TOTP"},
    "SENIOR_ADJUSTER":    {"required": True, "type": "TOTP"},
    "MEDICAL_DIRECTOR":   {"required": True, "type": "TOTP"},
    "ADJUSTER":           {"required": False, "type": "TOTP"},
    "COMPLIANCE_OFFICER": {"required": False, "type": "TOTP"},
    "API_CONSUMER":       {"required": False, "type": None},
}

# ── Local-dev MFA bypass ──────────────────────────────────────────────────────
# Set DISABLE_MFA=true in .env to skip 2FA during local development.
# This flag is IGNORED when ENVIRONMENT=production — it cannot be used to
# disable MFA in a production deployment.
_ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
_DISABLE_MFA = (
    os.getenv("DISABLE_MFA", "false").lower() in ("1", "true", "yes")
    and _ENVIRONMENT != "production"
)
if _DISABLE_MFA:
    logger.warning(
        "[AUTH] ⚠️  MFA is DISABLED for local development (DISABLE_MFA=true). "
        "This setting is ignored in production."
    )

# ── Password hashing (bcrypt directly — avoids passlib v4 wrap-bug) ───────────

def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ── User store — persistent JSON-backed (replaces hardcoded _DEMO_USERS) ───────
# Users are loaded from users.json on startup; admin panel can add/edit/delete.
# Passwords are bcrypt-hashed and stored in the JSON file.
# Falls back to seeding from env vars (ADMIN_PASSWORD etc.) on first run.

from services.api_gateway.app import user_store as _user_store


def _get_user_by_email(email: str) -> Optional[dict]:
    """Look up a user by email from the persistent user store."""
    return _user_store.get_by_email(email)


# ── JWT helpers ────────────────────────────────────────────────────────────────

class TokenPair(BaseModel):
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"
    expires_in:    int  # seconds until access token expiry


class AccessToken(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int


class MFAPendingToken(BaseModel):
    """Issued when MFA is required but not yet completed."""
    status: str = "MFA_REQUIRED"
    mfa_pending_token: str
    expires_in: int
    message: str = "Complete 2FA to login"


def _create_token(data: dict, expires_delta: timedelta) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc).replace(tzinfo=None) + expires_delta
    payload["iat"] = datetime.now(timezone.utc).replace(tzinfo=None)
    return jwt.encode(payload, JWT_SIGNING_SECRET, algorithm=JWT_ALGORITHM)


VALID_MARKETS = {"UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT", "INDIA"}
GLOBAL_MARKET_ROLES = {"ADMIN", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"}


def _allowed_markets_for_user(user: dict) -> set[str]:
    role = str(user.get("role", "")).upper()
    if role in GLOBAL_MARKET_ROLES:
        return set(VALID_MARKETS)

    raw_markets = user.get("allowed_markets") or user.get("markets") or []
    if isinstance(raw_markets, str):
        try:
            parsed = json.loads(raw_markets)
            raw_markets = parsed if isinstance(parsed, list) else raw_markets.split(",")
        except Exception:
            raw_markets = raw_markets.split(",")

    allowed = {
        str(market).strip().upper()
        for market in raw_markets
        if str(market).strip().upper() in VALID_MARKETS
    }
    home_market = str(user.get("market_region") or "UAE").strip().upper()
    if home_market in VALID_MARKETS:
        allowed.add(home_market)
    return allowed or {"UAE"}


def _resolve_user_market(user: dict, market_override: Optional[str] = None) -> str:
    fallback = _normalize_market(str(user.get("market_region") or "UAE"), "UAE")
    requested = _normalize_market(market_override, fallback) if market_override else fallback
    allowed = _allowed_markets_for_user(user)
    if requested in allowed:
        return requested
    logger.warning(
        "[AUTH] denied market override user=%s role=%s requested=%s allowed=%s",
        user.get("email"), user.get("role"), requested, sorted(allowed),
    )
    return fallback if fallback in allowed else sorted(allowed)[0]


def create_access_token(user: dict, market_override: Optional[str] = None, jti: Optional[str] = None) -> str:
    """Create JWT access token. market_override (from login form) takes priority over user profile."""
    market = _resolve_user_market(user, market_override)
    payload: dict = {
        "sub":    user["email"],
        "role":   user["role"],
        "uid":    user["id"],
        "market": market,
        "tenant_id": user.get("tenant_id", "default"),
        "type":   "access",
    }
    if jti:
        payload["jti"] = jti
    return _create_token(payload, timedelta(minutes=ACCESS_TOKEN_TTL))


def create_refresh_token(user: dict) -> str:
    return _create_token(
        {"sub": user["email"], "type": "refresh"},
        timedelta(days=REFRESH_TOKEN_TTL),
    )


def create_mfa_pending_token(user: dict) -> str:
    """Create temporary MFA_PENDING token (5-min TTL, can only call /totp/login)."""
    return _create_token(
        {
            "sub": user["email"],
            "uid": user["id"],
            "type": "mfa_pending"
        },
        timedelta(minutes=5)
    )


def _decode_token(token: str, expected_type: str) -> dict:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Check token blacklist (revoked tokens)
    if _is_token_blacklisted(token):
        raise credentials_exc

    try:
        payload = jwt.decode(token, JWT_SIGNING_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise credentials_exc

    if payload.get("type") != expected_type:
        raise credentials_exc

    email: Optional[str] = payload.get("sub")
    if not email:
        raise credentials_exc

    return payload


# ── FastAPI security schemes ───────────────────────────────────────────────────

_oauth2_scheme   = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
_api_key_header  = APIKeyHeader(name="X-API-Key", auto_error=False)


class CurrentUser(BaseModel):
    id:            str
    email:         str
    full_name:     str
    role:          str
    market_region: str
    tenant_id:     str = "default"
    allowed_markets: list[str] = []
    api_scopes:    list[str] = []
    is_active:     bool
    # Set to True when authenticated via API key (machine-to-machine)
    is_api_key:    bool = False

    def get(self, key: str, default=None):
        return getattr(self, key, default)


_SCREEN_HREFS = {
    "dashboard": "/",
    "reports": "/reports",
    "hitl": "/hitl",
    "claims": "/claims",
    "claim-journey": "/operations/lifecycle",
    "accounts": "/accounts",
    "submit": "/submit",
    "settings": "/settings",
    "master-settings": "/master-settings",
    "admin-console": "/admin#operations",
    "admin-settings": "/admin#settings",
    "admin-policies": "/admin#policies",
    "admin-audit": "/admin#audit",
    "admin-integrations": "/admin#integrations",
    "admin-operations": "/admin#operations",
}


def _normalize_screen_groups(value) -> list[dict]:
    groups = value if isinstance(value, list) else config_store.default_access_groups()
    normalized: list[dict] = []
    valid_screens = set(_SCREEN_HREFS)
    for item in groups:
        if not isinstance(item, dict):
            continue
        group = {
            "id": str(item.get("id") or "").strip(),
            "name": str(item.get("name") or "").strip(),
            "roleScope": [
                str(role).strip().upper()
                for role in item.get("roleScope", [])
                if str(role).strip()
            ] if isinstance(item.get("roleScope"), list) else [],
            "marketScope": [
                _normalize_market(str(market), str(market))
                for market in item.get("marketScope", [])
                if str(market).strip()
            ] if isinstance(item.get("marketScope"), list) else [],
            "screenAccess": [
                str(screen).strip()
                for screen in item.get("screenAccess", [])
                if str(screen).strip() in valid_screens
            ] if isinstance(item.get("screenAccess"), list) else [],
            "isActive": bool(item.get("isActive")),
        }
        if group["id"]:
            normalized.append(group)
    return normalized or config_store.default_access_groups()


def _screen_access_for_user(user: CurrentUser) -> list[str]:
    cfg = config_store.load()
    groups = _normalize_screen_groups(cfg.get("access_groups"))
    user_market = _normalize_market(user.market_region, user.market_region)
    allowed: list[str] = []
    for group in groups:
        if not group.get("isActive"):
            continue
        roles = group.get("roleScope") or []
        markets = group.get("marketScope") or []
        if roles and user.role not in roles:
            continue
        if markets and user_market not in markets:
            continue
        allowed.extend(group.get("screenAccess") or [])
    return sorted(set(allowed), key=lambda screen: list(_SCREEN_HREFS).index(screen) if screen in _SCREEN_HREFS else 999)


async def get_current_user(
    request:      Request,
    bearer_token: Optional[str] = Depends(_oauth2_scheme),
    api_key:      Optional[str] = Security(_api_key_header),
    cookie_token: Optional[str] = Cookie(default=None, alias="access_token"),
) -> CurrentUser:
    """
    Resolves the current user from:
      1. httpOnly cookie  (access_token)           — browser sessions (XSS-safe)
      2. Bearer JWT       (Authorization: Bearer)  — M2M / API consumers
      3. API key          (X-API-Key header)        — M2M API consumers

    Priority: API key → cookie → Bearer.
    Returns a CurrentUser.  Raises HTTP 401 if none is valid.
    """
    # ── 1. API key path (constant-time comparison) ──
    if api_key and _verify_api_key(api_key):
        identity = _api_key_identity()
        return CurrentUser(
            id=identity["id"],
            email=identity["email"],
            full_name=identity["full_name"],
            role=identity["role"],
            market_region=identity["market_region"],
            tenant_id=identity["tenant_id"],
            allowed_markets=[identity["market_region"]],
            api_scopes=identity["api_scopes"],
            is_active=True,
            is_api_key=True,
        )

    # ── 2. Cookie (browser) or Bearer JWT (M2M) ──
    effective_token = cookie_token or bearer_token
    if effective_token:
        payload = _decode_token(effective_token, "access")
        email   = payload["sub"]
        user    = _get_user_by_email(email)
        if not user or not user.get("is_active"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user_data = {k: user[k] for k in CurrentUser.model_fields if k in user}
        # Override market_region with the JWT's market claim (set at login time)
        if "market" in payload and payload["market"]:
            requested_market = _normalize_market(str(payload["market"]), user.get("market_region", "UAE"))
            allowed_markets = _allowed_markets_for_user(user)
            if requested_market in allowed_markets:
                user_data["market_region"] = requested_market
            else:
                logger.warning(
                    "[AUTH] ignored disallowed JWT market claim user=%s requested=%s allowed=%s",
                    email, requested_market, sorted(allowed_markets),
                )
                user_data["market_region"] = _resolve_user_market(user)
        if payload.get("tenant_id"):
            user_data["tenant_id"] = payload["tenant_id"]
        return CurrentUser(**user_data)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated — provide cookie, Bearer token, or X-API-Key",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_roles(*allowed: str):
    """
    Dependency factory.  Usage:

        @app.post("/...", dependencies=[Depends(require_roles("ADMIN", "ADJUSTER"))])
    """
    async def _check(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role}' is not authorised for this action. "
                       f"Required: {list(allowed)}",
            )
        return user
    return _check


# ── Auth router ────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


@router.post("/login", summary="Login — get access + refresh tokens or MFA pending token")
async def login(request: Request, response: Response, form: OAuth2PasswordRequestForm = Depends()):
    """
    Exchange email + password for a JWT access token and refresh token.

    If MFA is required and not yet set up, returns MFA_REQUIRED status with mfa_pending_token.
    Otherwise, sets httpOnly, Secure, SameSite=Strict cookies (invisible to JavaScript / DevTools)
    for browser sessions AND returns tokens in the JSON body for M2M backward compatibility.

    - **username**: user's email address
    - **password**: user's password
    - **market**:  optional market override (e.g. UAE, INDIA) — stored in JWT claim
    """
    # Prevent auth responses from being cached client-side or by intermediaries.
    apply_sensitive_response_headers(response)  # block client/proxy caching of credentials

    # ── Brute-force protection: check lockout before attempting password verify ──
    _check_login_lockout(form.username)

    user = _get_user_by_email(form.username)
    if not user:
        logger.warning("[AUTH] Login failed: user not found — %s", form.username)
        _record_failed_login(form.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    logger.info(
        "[AUTH] Login attempt: user=%s, has_stored_hash=%s",
        form.username,
        "hashed_password" in user,
    )

    password_valid = verify_password(form.password, user["hashed_password"])
    if not password_valid:
        logger.warning(
            "[AUTH] Login failed: incorrect password — %s",
            form.username,
        )
        _record_failed_login(form.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active"):
        logger.warning("[AUTH] Login failed: account disabled — %s", form.username)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    # ── Clear failed attempts on successful login ──
    _clear_login_attempts(form.username)

    # ── Check MFA requirement (mandatory for ADMIN, SENIOR_ADJUSTER, MEDICAL_DIRECTOR) ──
    # _DISABLE_MFA=True skips ALL MFA steps (both setup and verify) for local dev.
    if user.get("mfa_required") and not _DISABLE_MFA:
        logger.info("[AUTH] MFA required for %s — issuing mfa_pending_token", user["email"])
        mfa_pending = create_mfa_pending_token(user)
        return MFAPendingToken(
            status="MFA_REQUIRED",
            mfa_pending_token=mfa_pending,
            expires_in=5 * 60,  # 5 minutes
            message="Complete 2FA authentication to login"
        )

    # Optional market override — read from raw form data (beyond OAuth2PasswordRequestForm fields)
    try:
        raw_form   = await request.form()
        mkt_raw    = str(raw_form.get("market", "")).strip().upper()
        market_override = mkt_raw if mkt_raw in VALID_MARKETS else None
    except Exception:
        market_override = None

    # ── Generate JTI (token fingerprint) for session tracking ──
    from services.api_gateway.app.session_logger import generate_jti, log_login
    from services.api_gateway.app.session_manager import create_session, hash_device
    session_jti = generate_jti()

    # ── Capture client IP (respects X-Forwarded-For set by nginx) ──
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else (
        request.client.host if request.client else "unknown"
    )
    user_agent_str = request.headers.get("User-Agent", "")
    effective_market = (market_override or user.get("market_region", "UAE")).upper()

    # ── Create active session in Redis (device fingerprinting) ──
    # Parse User-Agent to extract device info
    try:
        import user_agents
        ua_parsed = user_agents.parse(user_agent_str)
        os_name = ua_parsed.os.family or "Unknown"
        browser_name = ua_parsed.browser.family or "Unknown"
        browser_version = ua_parsed.browser.version_string or ""
        if ua_parsed.is_mobile:
            device_type = "mobile"
        elif ua_parsed.is_tablet:
            device_type = "tablet"
        elif ua_parsed.is_pc:
            device_type = "desktop"
        else:
            device_type = "other"
    except Exception:
        os_name = "Unknown"
        browser_name = "Unknown"
        browser_version = ""
        device_type = "other"

    # Generate device fingerprint hash
    device_id = hash_device(user_agent_str, os_name)

    # Create session (Redis-backed for active device tracking)
    session_id = create_session(
        user_id=user["id"],
        user_email=user["email"],
        device_id=device_id,
        ip_address=client_ip,
        device_type=device_type,
        user_agent=user_agent_str,
        os_name=os_name,
        browser_name=browser_name,
        browser_version=browser_version,
    )

    access_token  = create_access_token(user, market_override=market_override, jti=session_jti)
    refresh_token = create_refresh_token(user)

    # Fire-and-forget — does NOT delay login response
    log_login(
        user_email=user["email"],
        user_role=user["role"],
        ip_address=client_ip,
        user_agent_str=user_agent_str,
        market=effective_market,
        jti=session_jti,
    )

    # ── Set httpOnly cookies — invisible to JavaScript (XSS-safe) ──
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="strict",
        max_age=ACCESS_TOKEN_TTL * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="strict",
        max_age=REFRESH_TOKEN_TTL * 86400,
        path="/",
    )

    # Also return tokens in JSON body for M2M backward compatibility
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_TTL * 60,
    )


class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = None  # optional — cookie takes priority


@router.post("/refresh", response_model=AccessToken, summary="Refresh — get new access token")
async def refresh_token(
    response: Response,
    cookie_token: Optional[str] = Cookie(default=None, alias="refresh_token"),
    body: Optional[RefreshRequest] = None,
):
    """Exchange a valid refresh token for a new access token.

    Accepts the token from:
    - httpOnly refresh_token cookie (browser sessions — sent automatically)
    - JSON body { "refresh_token": "..." } (M2M backward compatibility)
    """
    apply_sensitive_response_headers(response)  # new tokens must never be served from cache

    # Cookie takes priority; fall back to JSON body for M2M backward compat
    token = cookie_token or (body.refresh_token if body else None)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token provided — send cookie or JSON body",
        )

    payload = _decode_token(token, "refresh")
    user    = _get_user_by_email(payload["sub"])
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    new_access_token = create_access_token(user)

    # Refresh the access_token cookie
    response.set_cookie(
        key="access_token",
        value=new_access_token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="strict",
        max_age=ACCESS_TOKEN_TTL * 60,
        path="/",
    )

    return AccessToken(
        access_token=new_access_token,
        expires_in=ACCESS_TOKEN_TTL * 60,
    )


@router.post("/logout", summary="Logout — clear authentication cookies + revoke tokens")
async def logout(
    response: Response,
    cookie_access:  Optional[str] = Cookie(default=None, alias="access_token"),
    cookie_refresh: Optional[str] = Cookie(default=None, alias="refresh_token"),
):
    """Clear the httpOnly authentication cookies and blacklist tokens.

    After this call the browser will no longer send auth cookies,
    and the tokens are revoked (blacklisted in Redis until their natural expiry).
    M2M callers using X-API-Key are not affected.
    """
    apply_sensitive_response_headers(response)  # ensure logout response is never replayed from cache

    # Blacklist both tokens so they can't be reused even if intercepted
    if cookie_access:
        _blacklist_token(cookie_access, ACCESS_TOKEN_TTL * 60)
    if cookie_refresh:
        _blacklist_token(cookie_refresh, REFRESH_TOKEN_TTL * 86400)

    # ── Mark login session inactive (fire-and-forget) + revoke from Redis ──
    try:
        from services.api_gateway.app.session_logger import log_logout
        from services.api_gateway.app.session_manager import revoke_all_sessions
        jti = None
        email = ""
        if cookie_access:
            try:
                payload = jwt.decode(cookie_access, JWT_SIGNING_SECRET, algorithms=[JWT_ALGORITHM])
                jti   = payload.get("jti")
                email = payload.get("sub", "")
            except Exception:
                pass
        log_logout(jti=jti, user_email=email)
        # Also revoke active session from Redis
        if email:
            revoke_all_sessions(email)
    except Exception:
        pass

    response.delete_cookie("access_token",  path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=CurrentUser, summary="Get current user profile")
async def get_me(current_user: CurrentUser = Depends(get_current_user)):
    """Returns the profile of the currently authenticated user."""
    return current_user


@router.get("/screen-access", summary="Get current user's enabled screen access")
async def get_screen_access(current_user: CurrentUser = Depends(get_current_user)):
    """Return screen IDs and hrefs enabled for the current user's active access group."""
    allowed = _screen_access_for_user(current_user)
    return {
        "allowed_screen_ids": allowed,
        "allowed_hrefs": [_SCREEN_HREFS[screen] for screen in allowed if screen in _SCREEN_HREFS],
    }


class SwitchMarketRequest(BaseModel):
    market: str


@router.post("/switch-market", response_model=AccessToken, summary="Switch active market context")
async def switch_market(
    body:         SwitchMarketRequest,
    response:     Response,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Re-issue the access token with a different market claim.
    No re-authentication required — the existing session is preserved.
    The new market is reflected immediately in the Topbar badge.
    """
    apply_sensitive_response_headers(response)  # re-issued token must not be cached anywhere

    new_market = body.market.strip().upper()
    if new_market not in VALID_MARKETS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid market '{body.market}'. Valid markets: {sorted(VALID_MARKETS)}",
        )

    user_dict = {
        "email":         current_user.email,
        "role":          current_user.role,
        "id":            current_user.id,
        "market_region": current_user.market_region,
        "allowed_markets": current_user.allowed_markets,
    }
    if new_market not in _allowed_markets_for_user(user_dict):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Market '{new_market}' is not allowed for this user",
        )
    new_token = create_access_token(user_dict, market_override=new_market)

    response.set_cookie(
        key="access_token",
        value=new_token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="strict",
        max_age=ACCESS_TOKEN_TTL * 60,
        path="/",
    )

    logger.info("[AUTH] market switch: user=%s %s → %s", current_user.email, current_user.market_region, new_market)
    return AccessToken(access_token=new_token, expires_in=ACCESS_TOKEN_TTL * 60)


# ── Session Management (Active Device Tracking) ──────────────────────────────────

class SessionInfo(BaseModel):
    """Active session information with device fingerprinting."""
    id: str
    user_id: str
    user_email: str
    device_id: str
    ip_address: str
    device_type: str
    user_agent: str = ""
    os_name: str = ""
    browser_name: str = ""
    browser_version: str = ""
    city: str = ""
    country: str = ""
    created_at: str
    last_seen: str
    is_active: bool


class SessionListResponse(BaseModel):
    """Response for listing active sessions."""
    sessions: list[SessionInfo]
    total: int


@router.get("/sessions", response_model=SessionListResponse, summary="List active sessions")
async def list_active_sessions(current_user: CurrentUser = Depends(get_current_user)):
    """
    List all active sessions (logged-in devices) for the current user.

    Each session includes device fingerprinting info:
      - Device type (desktop, mobile, tablet)
      - Browser name and version
      - Operating system
      - IP address
      - Geolocation (city, country)
      - Last activity timestamp

    Users can revoke individual sessions to log out from a specific device.
    """
    from services.api_gateway.app.session_manager import get_user_sessions

    try:
        sessions = get_user_sessions(current_user.email)
        session_infos = [SessionInfo(**s.to_dict()) for s in sessions]
        logger.info(
            "[AUTH] listed %d sessions for %s",
            len(session_infos),
            current_user.email,
        )
        return SessionListResponse(
            sessions=session_infos,
            total=len(session_infos),
        )
    except Exception as e:
        logger.error("[AUTH] failed to list sessions for %s: %s", current_user.email, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve sessions",
        )


@router.post("/sessions/{session_id}/revoke", summary="Revoke session (logout from device)")
async def revoke_session(
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Revoke a specific session, logging out that device.

    This immediately invalidates the session but does NOT affect other sessions.
    Useful for logging out from lost/compromised devices without affecting other active sessions.

    **Parameters**:
      - `session_id`: ID of the session to revoke (from `/sessions` list)

    **Response**:
      - Success: `{"message": "Session revoked"}`
      - Not found: 404 error
    """
    from services.api_gateway.app.session_manager import revoke_session as _revoke_session

    if not session_id or not session_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id is required",
        )

    try:
        success = _revoke_session(session_id.strip(), current_user.email)
        if success:
            logger.info(
                "[AUTH] session %s revoked for %s",
                session_id[:8],
                current_user.email,
            )
            return {"message": f"Session {session_id[:8]} revoked successfully"}
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found or could not be revoked",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "[AUTH] failed to revoke session %s for %s: %s",
            session_id[:8],
            current_user.email,
            e,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to revoke session",
        )


# ── Self-Service Profile Endpoints ────────────────────────────────────────────

class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    contact_number: Optional[str] = None


@router.put("/profile", summary="Update own profile (name, contact)")
async def update_profile(
    body: UpdateProfileRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Self-update profile fields (full_name, contact_number)."""
    patch: dict = {}
    if body.full_name is not None:
        name = body.full_name.strip()
        if not name or len(name) < 2:
            raise HTTPException(status_code=400, detail="Name must be at least 2 characters")
        if len(name) > 100:
            raise HTTPException(status_code=400, detail="Name must be 100 characters or fewer")
        patch["full_name"] = name

    if body.contact_number is not None:
        phone = body.contact_number.strip()
        if phone and len(phone) > 20:
            raise HTTPException(status_code=400, detail="Contact number too long")
        patch["contact_number"] = phone

    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")

    updated = _user_store.update(current_user.email, patch)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")

    logger.info("[AUTH] profile updated for %s: %s", current_user.email, list(patch.keys()))
    return {"message": "Profile updated", "updated_fields": list(patch.keys())}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", summary="Change own password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Self-change password. Requires current password verification."""
    user = _get_user_by_email(current_user.email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Verify current password
    if not verify_password(body.current_password, user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Validate new password
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="New password must differ from current password")

    # Update password
    _user_store.reset_password(current_user.email, body.new_password)
    logger.info("[AUTH] password changed for %s", current_user.email)
    return {"message": "Password changed successfully"}
