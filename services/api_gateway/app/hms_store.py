"""
HMS Source Store
================
Manages registered Hospital Management System (HMS) integration sources.

Each record stores:
  - id                : UUID (auto-generated on create)
  - name              : Friendly display name  (e.g. "Apollo Chennai HMS")
  - enabled           : bool — whether webhooks from this source are accepted
  - market_region     : Target market for claims from this source (UAE / KSA / INDIA …)
  - pull_base_url     : Base URL of the HMS REST API (e.g. "https://hms.hospital.com")
  - claim_pull_path   : Path template for fetching a claim (e.g. "/api/claims/{claim_id}")
  - pull_auth_header  : Authorization header value (e.g. "Bearer TOKEN" or "Basic base64…")
  - webhook_secret    : HMAC-SHA256 signing secret for inbound webhook verification
  - registered_at     : ISO datetime of source registration
  - last_event_at     : ISO datetime of most-recently-received webhook (None if none yet)
  - total_events      : Running count of received webhook events

Thread-safe: a single threading.Lock guards all reads/writes.
Persisted atomically to JSON (write temp → rename) to prevent corruption.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── File location ──────────────────────────────────────────────────────────────
_HMS_STORE_PATH = Path(os.getenv("HMS_STORE_PATH", "/opt/claims-engine/hms_sources.json"))

# Fall back to /tmp for local Docker dev (app root may be read-only in container)
if not _HMS_STORE_PATH.parent.exists():
    _HMS_STORE_PATH = Path("/tmp/claims_hms_sources.json")

_lock = threading.Lock()
_cache: list[dict[str, Any]] | None = None


# ── Internal helpers ───────────────────────────────────────────────────────────

def _load_no_lock() -> list[dict[str, Any]]:
    """Load records from disk without acquiring the lock (caller holds it)."""
    if _HMS_STORE_PATH.exists():
        try:
            return json.loads(_HMS_STORE_PATH.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("hms_store: failed to read %s: %s", _HMS_STORE_PATH, exc)
    return []


def _write_atomic(records: list[dict[str, Any]]) -> None:
    """Write records to a temp file then rename — prevents partial writes."""
    try:
        _HMS_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=_HMS_STORE_PATH.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(records, f, indent=2, default=str)
            os.replace(tmp, _HMS_STORE_PATH)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:
        logger.error("hms_store: failed to write %s: %s", _HMS_STORE_PATH, exc)
        raise


# ── Public API ─────────────────────────────────────────────────────────────────

def get_all() -> list[dict[str, Any]]:
    """Return all registered HMS sources."""
    global _cache
    with _lock:
        if _cache is not None:
            return list(_cache)
        _cache = _load_no_lock()
        return list(_cache)


def get_by_id(source_id: str) -> dict[str, Any] | None:
    """Look up a single source by ID. Returns None if not found."""
    for src in get_all():
        if src.get("id") == source_id:
            return dict(src)
    return None


def create(
    name: str,
    market_region: str,
    pull_base_url: str,
    claim_pull_path: str,
    pull_auth_header: str,
    webhook_secret: str,
    enabled: bool = True,
) -> dict[str, Any]:
    """Register a new HMS source. Returns the full record (secret NOT masked)."""
    global _cache
    with _lock:
        records = _load_no_lock()
        record: dict[str, Any] = {
            "id":               str(uuid.uuid4()),
            "name":             name,
            "enabled":          enabled,
            "market_region":    market_region.upper(),
            "pull_base_url":    pull_base_url.rstrip("/"),
            "claim_pull_path":  claim_pull_path,
            "pull_auth_header": pull_auth_header,
            "webhook_secret":   webhook_secret,
            "registered_at":    datetime.now(timezone.utc).isoformat(),
            "last_event_at":    None,
            "total_events":     0,
        }
        records.append(record)
        _write_atomic(records)
        _cache = records
        return dict(record)


def update(source_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Merge *patch* into an existing source. Returns updated record (secret NOT masked)."""
    global _cache
    with _lock:
        records = _load_no_lock()
        for rec in records:
            if rec.get("id") == source_id:
                ALLOWED = {
                    "name", "enabled", "market_region",
                    "pull_base_url", "claim_pull_path",
                    "pull_auth_header", "webhook_secret",
                }
                for k, v in patch.items():
                    if k in ALLOWED:
                        rec[k] = v
                if "market_region" in rec:
                    rec["market_region"] = rec["market_region"].upper()
                if "pull_base_url" in rec:
                    rec["pull_base_url"] = rec["pull_base_url"].rstrip("/")
                _write_atomic(records)
                _cache = records
                return dict(rec)
        raise KeyError(f"HMS source not found: {source_id}")


def delete(source_id: str) -> None:
    """Remove a source. Raises KeyError if not found."""
    global _cache
    with _lock:
        records = _load_no_lock()
        before = len(records)
        records = [r for r in records if r.get("id") != source_id]
        if len(records) == before:
            raise KeyError(f"HMS source not found: {source_id}")
        _write_atomic(records)
        _cache = records


def record_event(source_id: str) -> None:
    """Bump total_events counter and update last_event_at timestamp. Best-effort — never raises."""
    global _cache
    try:
        with _lock:
            records = _load_no_lock()
            for rec in records:
                if rec.get("id") == source_id:
                    rec["total_events"] = rec.get("total_events", 0) + 1
                    rec["last_event_at"] = datetime.now(timezone.utc).isoformat()
                    _write_atomic(records)
                    _cache = records
                    return
    except Exception as exc:
        logger.warning("hms_store.record_event: %s", exc)


def invalidate() -> None:
    """Force a reload from disk on the next get_all() call."""
    global _cache
    with _lock:
        _cache = None
