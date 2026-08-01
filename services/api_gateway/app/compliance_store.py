"""
Compliance automation store.

Tracks ingested regulatory updates and performs drift detection against the
currently active regional clause set.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_STORE_PATH = Path(os.getenv("COMPLIANCE_STORE_PATH", "/opt/claims-engine/compliance_updates.json"))
if not _STORE_PATH.parent.exists():
    _STORE_PATH = Path("/tmp/claims_compliance_updates.json")

_lock = threading.Lock()


def _load() -> dict[str, Any]:
    if _STORE_PATH.exists():
        try:
            return json.loads(_STORE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {"updates": [], "verifications": []}
    return {"updates": [], "verifications": []}


def _save(payload: dict[str, Any]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=_STORE_PATH.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, default=str)
        os.replace(tmp, _STORE_PATH)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _clauses_hash(clauses: list[dict]) -> str:
    canonical = json.dumps(clauses or [], sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def list_updates(market: Optional[str] = None) -> list[dict]:
    with _lock:
        updates = list(_load().get("updates", []))
    if market:
        market = market.upper()
        updates = [u for u in updates if u.get("market", "").upper() == market]
    updates.sort(key=lambda item: item.get("uploaded_at", ""), reverse=True)
    return updates


def ingest_update(
    market: str,
    regulatory_body: str,
    source: str,
    effective_date: str,
    clauses: list[dict],
    uploaded_by: str,
    notes: Optional[str] = None,
) -> dict:
    market = market.upper()
    record = {
        "id": str(uuid.uuid4()),
        "market": market,
        "regulatory_body": regulatory_body,
        "source": source,
        "effective_date": effective_date,
        "clauses": clauses,
        "clause_count": len(clauses or []),
        "clauses_hash": _clauses_hash(clauses or []),
        "notes": notes or "",
        "uploaded_by": uploaded_by,
        "uploaded_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
    }
    with _lock:
        payload = _load()
        payload.setdefault("updates", []).append(record)
        _save(payload)
    return {k: v for k, v in record.items() if k != "clauses"}


def detect_drift(market: str, current_clauses: list[dict]) -> dict[str, Any]:
    updates = list_updates(market=market)
    baseline_hash = _clauses_hash(current_clauses or [])
    latest = updates[0] if updates else None
    expected_hash = latest.get("clauses_hash") if latest else None
    return {
        "market": market.upper(),
        "has_update": latest is not None,
        "expected_hash": expected_hash,
        "current_hash": baseline_hash,
        "drift_detected": bool(latest and expected_hash != baseline_hash),
        "latest_update": latest,
    }


def record_verification(result: dict[str, Any]) -> dict[str, Any]:
    verification = {
        "id": str(uuid.uuid4()),
        "verified_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
        **result,
    }
    with _lock:
        payload = _load()
        payload.setdefault("verifications", []).append(verification)
        _save(payload)
    return verification


def list_verifications(limit: int = 20) -> list[dict]:
    with _lock:
        items = list(_load().get("verifications", []))
    items.sort(key=lambda item: item.get("verified_at", ""), reverse=True)
    return items[:limit]
