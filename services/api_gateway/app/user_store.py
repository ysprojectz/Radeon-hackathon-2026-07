"""
User Store
==========
Manages the users.json file — a persistent, mutable replacement for the
hardcoded _DEMO_USERS dict in auth.py.

On first use:
  - If users.json exists, loads from it.
  - Otherwise, seeds from the original 4 env-var demo users and writes the file.

All mutations (create / update / delete) are written atomically to disk.
Thread-safe via threading.Lock.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import tempfile
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

import bcrypt as _bcrypt

# ── File location ──────────────────────────────────────────────────────────────
_USERS_PATH = Path(os.getenv("RUNTIME_USERS_PATH", "/opt/claims-engine/users.json"))

# Fall back to /tmp for local Docker dev (app root is read-only in container)
if not _USERS_PATH.parent.exists():
    _USERS_PATH = Path("/tmp/claims_users.json")

_lock = threading.Lock()
_cache: dict[str, dict] | None = None   # email → user dict


# ── Password helpers ───────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ── Seed data (mirrors original auth.py _DEMO_USERS_RAW) ──────────────────────

def _seed_users() -> dict[str, dict]:
    _e = os.getenv
    # Roles requiring mandatory MFA
    MFA_REQUIRED_ROLES = {"ADMIN", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR"}

    raw = [
        ("00000000-0000-0000-0000-000000000001",
         "admin@claims-engine.local",      "System Admin",       "ADMIN",
         _e("ADMIN_PASSWORD",      "Admin@2024!")),
        ("00000000-0000-0000-0000-000000000002",
         "adjuster@claims-engine.local",   "Claims Adjuster",    "ADJUSTER",
         _e("ADJUSTER_PASSWORD",   "Adjuster@2024!")),
        ("00000000-0000-0000-0000-000000000003",
         "reviewer@claims-engine.local",   "Senior Adjuster",    "SENIOR_ADJUSTER",
         _e("REVIEWER_PASSWORD",   "Reviewer@2024!")),
        ("00000000-0000-0000-0000-000000000004",
         "compliance@claims-engine.local", "Compliance Officer", "COMPLIANCE_OFFICER",
         _e("COMPLIANCE_PASSWORD", "Compliance@2024!")),
    ]
    users: dict[str, dict] = {}
    for uid, email, name, role, pwd in raw:
        users[email] = {
            "id":              uid,
            "email":           email,
            "full_name":       name,
            "role":            role,
            "market_region":   "INDIA",
            "tenant_id":       "default",
            "is_active":       True,
            "hashed_password": hash_password(pwd),
            "mfa_required":    role in MFA_REQUIRED_ROLES,
            "mfa_type":        "TOTP",
            "mfa_enabled":     False,
        }
    return users


# ── Internal: load without lock (caller holds it) ─────────────────────────────

def _load_no_lock() -> dict[str, dict]:
    if _USERS_PATH.exists():
        try:
            data = json.loads(_USERS_PATH.read_text(encoding="utf-8"))
            return {u["email"]: u for u in data.get("users", [])}
        except Exception as exc:
            logger.warning("user_store: failed to read %s: %s", _USERS_PATH, exc)
    # First run — seed from env vars and persist
    users = _seed_users()
    _write_atomic(users)
    return users


def _write_atomic(users: dict[str, dict]) -> None:
    try:
        _USERS_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {"users": list(users.values())}
        fd, tmp = tempfile.mkstemp(dir=_USERS_PATH.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, default=str)
            os.replace(tmp, _USERS_PATH)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:
        logger.error("user_store: failed to write %s: %s", _USERS_PATH, exc)
        raise


# ── Public API ─────────────────────────────────────────────────────────────────

def get_all() -> list[dict]:
    """Return all users (without hashed_password)."""
    with _lock:
        global _cache
        if _cache is None:
            _cache = _load_no_lock()
        return [_public(u) for u in _cache.values()]


def get_by_email(email: str) -> dict | None:
    """Return full user dict (including hashed_password) for auth use."""
    with _lock:
        global _cache
        if _cache is None:
            _cache = _load_no_lock()
        return _cache.get(email.lower())


def create(email: str, full_name: str, role: str,
           market_region: str, password: str, tenant_id: str = "default") -> dict:
    """Create a new user. Raises ValueError if email already exists."""
    MFA_REQUIRED_ROLES = {"ADMIN", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR"}

    with _lock:
        global _cache
        if _cache is None:
            _cache = _load_no_lock()
        email = email.lower().strip()
        if email in _cache:
            raise ValueError(f"User '{email}' already exists")
        user: dict[str, Any] = {
            "id":              str(uuid.uuid4()),
            "email":           email,
            "full_name":       full_name,
            "role":            role.upper(),
            "market_region":   market_region.upper(),
            "tenant_id":       (tenant_id or "default").strip() or "default",
            "is_active":       True,
            "hashed_password": hash_password(password),
            "mfa_required":    role.upper() in MFA_REQUIRED_ROLES,
            "mfa_type":        "TOTP",
            "mfa_enabled":     False,
        }
        _cache[email] = user
        _write_atomic(_cache)
        logger.info("User created: %s (%s, MFA required: %s)",
                    email, role, user["mfa_required"])
        return _public(user)


def update(email: str, patch: dict) -> dict:
    """Update allowed fields. Raises KeyError if not found."""
    with _lock:
        global _cache
        if _cache is None:
            _cache = _load_no_lock()
        email = email.lower()
        if email not in _cache:
            raise KeyError(f"User '{email}' not found")
        user = dict(_cache[email])
        for field in ("full_name", "role", "market_region", "tenant_id", "is_active", "mfa_required", "mfa_enabled", "contact_number"):
            if field in patch:
                user[field] = patch[field]
        _cache[email] = user
        _write_atomic(_cache)
        return _public(user)


def reset_password(email: str, new_password: str) -> None:
    """Set a new password for the given user."""
    with _lock:
        global _cache
        if _cache is None:
            _cache = _load_no_lock()
        email = email.lower()
        if email not in _cache:
            raise KeyError(f"User '{email}' not found")
        _cache[email]["hashed_password"] = hash_password(new_password)
        _write_atomic(_cache)


def delete(email: str, requesting_email: str) -> None:
    """Delete a user. Raises if not found or if deleting self."""
    with _lock:
        global _cache
        if _cache is None:
            _cache = _load_no_lock()
        email = email.lower()
        if email not in _cache:
            raise KeyError(f"User '{email}' not found")
        if email == requesting_email.lower():
            raise ValueError("Cannot delete your own account")
        del _cache[email]
        _write_atomic(_cache)


def _public(user: dict) -> dict:
    """Return user dict without hashed_password."""
    return {k: v for k, v in user.items() if k != "hashed_password"}


# Warm the cache at import time (one bcrypt call per user on first load)
with _lock:
    if _cache is None:
        _cache = _load_no_lock()
