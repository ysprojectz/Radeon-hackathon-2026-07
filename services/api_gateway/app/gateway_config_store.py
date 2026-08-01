"""
Gateway Configuration Store
============================
Persists Stripe / PayTM credentials encrypted at rest.

Storage strategy (same as user_store / config_store):
  • Primary  : PostgreSQL `gateway_config` table (when DB is available)
  • Fallback  : /tmp/gateway_config.json  (dev / no-DB mode)

All secret fields (API keys, webhook secrets) are Fernet-encrypted using
ACCOUNT_ENCRYPTION_KEY.  If the key is absent the secrets are stored as
a base64-encoded "unkeyed:" prefix so they are at least not plaintext,
but a warning is logged.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import threading
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Encryption helpers ────────────────────────────────────────────────────────

_ENC_KEY = os.getenv("ACCOUNT_ENCRYPTION_KEY", "").strip()


def _encrypt(plaintext: str) -> str:
    """Fernet-encrypt a string. Falls back to base64 if no key configured."""
    if not plaintext:
        return ""
    if _ENC_KEY:
        try:
            from cryptography.fernet import Fernet
            return "fernet:" + Fernet(_ENC_KEY.encode()).encrypt(plaintext.encode()).decode()
        except Exception as exc:
            logger.warning("Gateway credential encryption failed: %s", exc)
    return "b64:" + base64.b64encode(plaintext.encode()).decode()


def _decrypt(ciphertext: str) -> str:
    """Reverse of _encrypt. Returns empty string on failure."""
    if not ciphertext:
        return ""
    if ciphertext.startswith("fernet:"):
        if not _ENC_KEY:
            logger.error("Cannot decrypt gateway credential: ACCOUNT_ENCRYPTION_KEY not set")
            return ""
        try:
            from cryptography.fernet import Fernet
            return Fernet(_ENC_KEY.encode()).decrypt(ciphertext[7:].encode()).decode()
        except Exception as exc:
            logger.error("Gateway credential decryption failed: %s", exc)
            return ""
    if ciphertext.startswith("b64:"):
        try:
            return base64.b64decode(ciphertext[4:]).decode()
        except Exception:
            return ""
    return ciphertext  # legacy plaintext


# ── Secret field names for each gateway ──────────────────────────────────────

_STRIPE_SECRET_FIELDS = {"stripe_secret_key", "stripe_publishable_key", "stripe_webhook_secret"}
_PAYTM_SECRET_FIELDS  = {"paytm_merchant_key"}
_CASHFREE_SECRET_FIELDS = {"cashfree_client_secret"}
_ALL_SECRET_FIELDS    = _STRIPE_SECRET_FIELDS | _PAYTM_SECRET_FIELDS | _CASHFREE_SECRET_FIELDS

# ── File-based fallback ───────────────────────────────────────────────────────

_GW_CONFIG_PATH = Path(os.getenv("GATEWAY_CONFIG_PATH", "/opt/claims-engine/gateway_config.json"))
if not _GW_CONFIG_PATH.parent.exists():
    _GW_CONFIG_PATH = Path("/tmp/claims_gateway_config.json")

_lock  = threading.Lock()
_cache: dict[str, dict[str, Any]] | None = None   # key: "tenant_id:gateway"


def _cache_key(tenant_id: str, gateway: str) -> str:
    return f"{tenant_id}:{gateway}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_file() -> dict[str, dict[str, Any]]:
    global _cache
    if _cache is not None:
        return _cache
    if _GW_CONFIG_PATH.exists():
        try:
            _cache = json.loads(_GW_CONFIG_PATH.read_text())
            return _cache
        except Exception as exc:
            logger.warning("gateway_config.json read error: %s", exc)
    _cache = {}
    return _cache


def _save_file(data: dict[str, dict[str, Any]]) -> None:
    try:
        tmp = _GW_CONFIG_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.rename(_GW_CONFIG_PATH)
    except Exception as exc:
        logger.warning("gateway_config.json write error: %s", exc)


# ── Public shape — what callers work with ────────────────────────────────────

def _default_config(tenant_id: str, gateway: str) -> dict[str, Any]:
    return {
        "tenant_id":  tenant_id,
        "gateway":    gateway,
        "environment": "preproduction",
        "is_enabled": False,
        # Stripe
        "stripe_publishable_key": "",
        "stripe_secret_key":      "",
        "stripe_webhook_secret":  "",
        "stripe_account_id":      "",
        # PayTM
        "paytm_merchant_id":  "",
        "paytm_merchant_key": "",
        "paytm_subwallet_guid": "",
        "paytm_website":      "WEBSTAGING",
        "paytm_industry_type": "Retail",
        "paytm_channel_id":   "WEB",
        # Cashfree verification suite
        "cashfree_client_id": "",
        "cashfree_client_secret": "",
        # State
        "last_tested_at":    None,
        "last_test_status":  None,
        "last_test_error":   None,
        "created_at":        _now_iso(),
        "updated_at":        _now_iso(),
    }


def _is_ready(cfg: dict[str, Any]) -> bool:
    """A gateway is 'ready' when it has credentials AND last test passed."""
    gw = cfg.get("gateway")
    if not cfg.get("is_enabled"):
        return False
    if cfg.get("last_test_status") != "ok":
        return False
    if gw == "stripe":
        return bool(cfg.get("stripe_secret_key"))
    if gw == "paytm":
        return bool(cfg.get("paytm_merchant_id") and cfg.get("paytm_merchant_key"))
    if gw == "cashfree":
        return bool(cfg.get("cashfree_client_id") and cfg.get("cashfree_client_secret"))
    return False


def _row_to_public(row: dict[str, Any], include_secrets: bool = False) -> dict[str, Any]:
    """
    Build the public-facing config dict.
    Secrets are always decrypted for internal use (include_secrets=True) or
    masked for API responses.
    """
    out = dict(row)
    for field in _ALL_SECRET_FIELDS:
        enc_field = f"{field}_enc"
        if enc_field in out:
            plain = _decrypt(out.pop(enc_field))
            if include_secrets:
                out[field] = plain
            else:
                out[field] = "••••••••" if plain else ""
        elif field in out:
            plain = out[field]
            if not include_secrets and plain:
                out[field] = "••••••••"
    out["is_ready"] = _is_ready(out)
    return out


# ── DB helpers ────────────────────────────────────────────────────────────────

def _db_get(db: Any, tenant_id: str, gateway: str) -> Optional[dict[str, Any]]:
    from sqlalchemy import text
    row = db.execute(
        text("SELECT * FROM gateway_config WHERE tenant_id = :tid AND gateway = :gw"),
        {"tid": tenant_id, "gw": gateway},
    ).first()
    if row is None:
        return None
    return dict(row._mapping)


def _db_upsert(db: Any, record: dict[str, Any]) -> None:
    from sqlalchemy import text
    # Build encrypted copies of secret fields for DB storage
    enc = dict(record)
    for field in _ALL_SECRET_FIELDS:
        plain = enc.pop(field, None)
        if plain is not None:
            enc[f"{field}_enc"] = _encrypt(plain) if plain else None

    cols = [c for c in enc if c not in ("id", "created_at", "tenant_id", "gateway", "is_ready")]
    db.execute(
        text(f"""
            INSERT INTO gateway_config (tenant_id, gateway, {', '.join(cols)})
            VALUES (:tenant_id, :gateway, {', '.join(':' + c for c in cols)})
            ON CONFLICT (tenant_id, gateway) DO UPDATE
            SET {', '.join(f'{c} = EXCLUDED.{c}' for c in cols if c not in ('tenant_id','gateway'))}
        """),
        enc,
    )
    db.commit()


# ── Public API ────────────────────────────────────────────────────────────────

def get_config(db: Any, tenant_id: str, gateway: str, include_secrets: bool = False) -> dict[str, Any]:
    """Return gateway config. Secrets masked unless include_secrets=True."""
    if db is not None:
        row = _db_get(db, tenant_id, gateway)
        if row:
            cfg = _row_to_public(row, include_secrets=include_secrets)
            return cfg
    # File fallback
    with _lock:
        data = _load_file()
        key  = _cache_key(tenant_id, gateway)
        raw  = data.get(key, _default_config(tenant_id, gateway))
    return _row_to_public(raw, include_secrets=include_secrets)


def save_config(db: Any, tenant_id: str, gateway: str, updates: dict[str, Any], actor: str) -> dict[str, Any]:
    """
    Persist credential/config changes.
    Callers pass plaintext secrets; this function encrypts before storage.
    Empty-string values for secret fields mean 'no change' (keep existing).
    """
    existing = get_config(db, tenant_id, gateway, include_secrets=True)
    merged   = {
        **existing,
        **updates,
        "tenant_id": tenant_id,
        "gateway": gateway,
        "updated_at": _now_iso(),
        "updated_by": actor,
    }
    merged.pop("is_ready", None)

    # Preserve existing secrets when caller sends empty / masked placeholder
    for field in _ALL_SECRET_FIELDS:
        new_val = updates.get(field, "")
        if not new_val or new_val == "••••••••":
            merged[field] = existing.get(field, "")  # keep decrypted existing value

    if db is not None:
        _db_upsert(db, merged)
    else:
        with _lock:
            data = _load_file()
            # Store encrypted in file too
            to_store = dict(merged)
            for field in _ALL_SECRET_FIELDS:
                plain = to_store.pop(field, "")
                to_store[f"{field}_enc"] = _encrypt(plain) if plain else ""
            data[_cache_key(tenant_id, gateway)] = to_store
            _save_file(data)
            global _cache
            _cache = data

    return get_config(db, tenant_id, gateway)


def record_test_result(db: Any, tenant_id: str, gateway: str, *, ok: bool, error: str = "") -> None:
    """Update last_tested_at and last_test_status after a connection test."""
    now    = _now_iso()
    status = "ok" if ok else "failed"
    if db is not None:
        from sqlalchemy import text
        db.execute(
            text("""
                UPDATE gateway_config
                SET last_tested_at = :ts, last_test_status = :st, last_test_error = :err
                WHERE tenant_id = :tid AND gateway = :gw
            """),
            {"ts": now, "st": status, "err": error or None, "tid": tenant_id, "gw": gateway},
        )
        db.commit()
    else:
        with _lock:
            data  = _load_file()
            key   = _cache_key(tenant_id, gateway)
            entry = data.get(key, _default_config(tenant_id, gateway))
            entry.update({"last_tested_at": now, "last_test_status": status, "last_test_error": error or None})
            data[key] = entry
            _save_file(data)
            global _cache
            _cache = data


def list_configs(db: Any, tenant_id: str) -> list[dict[str, Any]]:
    """Return masked configs for both gateways."""
    results = []
    for gw in ("stripe", "paytm", "cashfree"):
        results.append(get_config(db, tenant_id, gw))
    return results


def get_config_with_secrets(db: Any, tenant_id: str, gateway: str) -> dict[str, Any]:
    """Internal use only — returns plaintext credentials for API calls."""
    return get_config(db, tenant_id, gateway, include_secrets=True)
