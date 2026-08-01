"""
TOTP Secret Store — JSON-backed, per-user storage.
Maps email (lowercase) → { "secret": base32_string, "confirmed": bool }

"confirmed" is set to True only after the user successfully verifies a TOTP code
for the first time (i.e., they actually scanned the QR and it worked).
The `has-setup` endpoint returns this flag so the login page only skips the QR
screen once the user has genuinely completed setup.

Stored at /app/uploads/totp_secrets.json (configurable via TOTP_STORE_PATH env var).
Thread-safe via a module-level lock.

Backward compat: old entries stored as plain strings ("email": "BASE32...") are
transparently upgraded to the new dict format on first read.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_STORE_PATH = Path(os.environ.get("TOTP_STORE_PATH", "/app/uploads/totp_secrets.json"))

# Fallback to /tmp when running outside Docker (parent dir doesn't exist or isn't writable)
if not _STORE_PATH.parent.exists():
    _STORE_PATH = Path("/tmp/claims_totp_secrets.json")

_lock = threading.Lock()

# ── Encryption setup ───────────────────────────────────────────────────────────
_TOTP_ENCRYPTION_KEY = os.getenv("TOTP_ENCRYPTION_KEY")
_cipher: Optional[Fernet] = None

if _TOTP_ENCRYPTION_KEY:
    try:
        _cipher = Fernet(_TOTP_ENCRYPTION_KEY.encode())
        logger.info("[TOTP-STORE] Encryption enabled")
    except Exception as e:
        logger.warning("[TOTP-STORE] Invalid TOTP_ENCRYPTION_KEY: %s", e)
        _cipher = None
else:
    logger.warning("[TOTP-STORE] TOTP_ENCRYPTION_KEY not set — secrets will be stored unencrypted")


# ── Internal helpers ───────────────────────────────────────────────────────────

def _load() -> dict:
    """Return the current store dict (read from disk each call — always fresh).
    Transparently upgrades old formats:
      1. Plain-string entries → dict with plaintext secret
      2. Plaintext secrets → encrypted secrets (if key available)
    """
    if _STORE_PATH.exists():
        try:
            raw: dict = json.loads(_STORE_PATH.read_text())
            upgraded = False

            for k, v in raw.items():
                # Upgrade 1: plain string → dict format (legacy)
                if isinstance(v, str):
                    raw[k] = {"secret": v, "confirmed": False}
                    upgraded = True

                # Upgrade 2: plaintext secret → encrypted (if encryption enabled)
                elif isinstance(v, dict):
                    if "secret" in v and isinstance(v["secret"], str) and _cipher:
                        try:
                            # Encrypt the plaintext secret
                            plaintext = v["secret"]
                            encrypted = _cipher.encrypt(plaintext.encode()).decode()
                            v["secret_encrypted"] = encrypted
                            del v["secret"]
                            upgraded = True
                        except Exception as e:
                            logger.error("[TOTP-STORE] Failed to encrypt secret for %s: %s", k, e)

            if upgraded:
                _save(raw)
            return raw
        except Exception as exc:
            logger.warning("[TOTP-STORE] failed to load %s: %s", _STORE_PATH, exc)
    return {}


def _save(data: dict) -> None:
    """Atomically persist *data* to the JSON store file.
    Falls back to /tmp on permission errors (e.g. running outside Docker).
    """
    global _STORE_PATH
    try:
        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _STORE_PATH.write_text(json.dumps(data, indent=2))
    except OSError as exc:
        fallback = Path("/tmp/claims_totp_secrets.json")
        if _STORE_PATH != fallback:
            logger.warning("[TOTP-STORE] Cannot write to %s (%s) — switching to %s", _STORE_PATH, exc, fallback)
            _STORE_PATH = fallback
            fallback.write_text(json.dumps(data, indent=2))
        else:
            raise


# ── Backup code helpers ───────────────────────────────────────────────────────

import secrets
import bcrypt as _bcrypt_backup_codes

def generate_backup_codes(count: int = 10) -> list:
    """Generate single-use recovery codes (8-char URL-safe strings)."""
    return [secrets.token_urlsafe(8) for _ in range(count)]


def store_backup_codes(email: str, codes: list) -> None:
    """Hash + store backup codes (Bcrypt hashed, single-use)."""
    with _lock:
        data = _load()
        email_lower = email.lower()
        entry = data.get(email_lower)
        if not entry:
            return

        # Hash each code with bcrypt
        hashed_codes = [
            _bcrypt_backup_codes.hashpw(code.encode(), _bcrypt_backup_codes.gensalt()).decode()
            for code in codes
        ]

        entry["backup_codes_hash"] = hashed_codes
        entry["backup_codes_used"] = []
        _save(data)

    logger.info("[TOTP-STORE] backup codes stored for %s", email)


def verify_backup_code(email: str, code: str) -> bool:
    """Verify backup code is valid + not already used."""
    email_lower = email.lower()
    entry = _load().get(email_lower)
    if not entry or "backup_codes_hash" not in entry:
        return False

    used_codes = entry.get("backup_codes_used", [])

    for hashed in entry["backup_codes_hash"]:
        if hashed not in used_codes:
            try:
                if _bcrypt_backup_codes.checkpw(code.encode(), hashed.encode()):
                    return True
            except Exception:
                pass

    return False


def revoke_backup_code(email: str, code: str) -> None:
    """Mark backup code as used (single-use enforcement)."""
    with _lock:
        data = _load()
        email_lower = email.lower()
        entry = data.get(email_lower)
        if not entry:
            return

        # Find matching hash and mark as used
        for hashed in entry.get("backup_codes_hash", []):
            try:
                if _bcrypt_backup_codes.checkpw(code.encode(), hashed.encode()):
                    if "backup_codes_used" not in entry:
                        entry["backup_codes_used"] = []
                    entry["backup_codes_used"].append(hashed)
                    _save(data)
                    logger.info("[TOTP-STORE] backup code consumed for %s", email)
                    return
            except Exception:
                pass


# ── Public API ─────────────────────────────────────────────────────────────────

def get_secret(email: str) -> str | None:
    """Return the stored TOTP base32 secret for *email*, or None if not configured."""
    entry = _load().get(email.lower())
    if entry is None:
        return None

    if isinstance(entry, dict):
        # Try encrypted first
        if "secret_encrypted" in entry and _cipher:
            try:
                encrypted = entry["secret_encrypted"]
                return _cipher.decrypt(encrypted.encode()).decode()
            except InvalidToken:
                logger.error("[TOTP-STORE] Failed to decrypt secret for %s", email)
                return None
        # Fallback to plaintext (if encryption not enabled or old format)
        elif "secret" in entry:
            return entry["secret"]

    # Legacy plain string format
    return entry if isinstance(entry, str) else None


def set_secret(email: str, secret: str) -> None:
    """Persist a new TOTP secret for *email* (confirmed=False until first login)."""
    with _lock:
        data = _load()
        email_lower = email.lower()

        if _cipher:
            # Encrypt the secret before storing
            encrypted = _cipher.encrypt(secret.encode()).decode()
            data[email_lower] = {"secret_encrypted": encrypted, "confirmed": False}
        else:
            # Fallback: store plaintext if no encryption key
            data[email_lower] = {"secret": secret, "confirmed": False}

        _save(data)
    logger.info("[TOTP-STORE] secret stored for %s (encrypted: %s)", email, _cipher is not None)


def has_secret(email: str) -> bool:
    """Return True if *email* has a TOTP secret registered (regardless of confirmed state).
    Used by /setup to decide whether to generate a new secret or re-show the existing QR.
    """
    return email.lower() in _load()


def has_confirmed(email: str) -> bool:
    """Return True only if the user has completed setup by successfully verifying
    a TOTP code at least once. This is what the /has-setup endpoint exposes —
    it means 'skip QR, go straight to code entry'.
    """
    entry = _load().get(email.lower())
    if entry is None:
        return False
    if isinstance(entry, dict):
        return bool(entry.get("confirmed", False))
    # Legacy plain string → not yet confirmed
    return False


def confirm_secret(email: str) -> None:
    """Mark *email*'s TOTP setup as confirmed after their first successful login.
    Idempotent — safe to call on every login.
    Also encrypts any plaintext secrets that haven't been encrypted yet.
    """
    with _lock:
        data = _load()
        email_lower = email.lower()
        entry = data.get(email_lower)
        if entry is None:
            return

        if isinstance(entry, dict):
            # Handle plaintext secret in dict format (may need encryption)
            if "secret" in entry and isinstance(entry["secret"], str) and _cipher:
                # Encrypt plaintext secret
                plaintext = entry["secret"]
                encrypted = _cipher.encrypt(plaintext.encode()).decode()
                entry["secret_encrypted"] = encrypted
                del entry["secret"]
                entry["confirmed"] = True
                _save(data)
                logger.info("[TOTP-STORE] secret encrypted + setup confirmed for %s", email)
            elif not entry.get("confirmed"):
                entry["confirmed"] = True
                _save(data)
                logger.info("[TOTP-STORE] setup confirmed for %s", email)
        else:
            # Upgrade legacy plain-string entry and mark confirmed
            if _cipher:
                encrypted = _cipher.encrypt(entry.encode()).decode()
                data[email_lower] = {"secret_encrypted": encrypted, "confirmed": True}
            else:
                data[email_lower] = {"secret": entry, "confirmed": True}
            _save(data)
            logger.info("[TOTP-STORE] legacy entry upgraded + confirmed for %s", email)
