"""
Reliability controls for claim submission workflows.

This module adds:
1. Request idempotency for safe client retries
2. Dead-letter capture for failed claim processing attempts
3. Audit payload sanitization for sensitive fields
4. Lightweight in-process reliability counters
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

ENABLE_DB_PERSISTENCE = os.getenv("ENABLE_DB_PERSISTENCE", "true").lower() == "true"
IDEMPOTENCY_TTL_HOURS = int(os.getenv("IDEMPOTENCY_TTL_HOURS", "24"))
DLQ_RETRY_DELAY_MINUTES = int(os.getenv("DLQ_RETRY_DELAY_MINUTES", "15"))
_AUDIT_ENCRYPTION_KEY = os.getenv("AUDIT_DATA_ENCRYPTION_KEY")
_audit_cipher: Optional[Fernet] = None

if _AUDIT_ENCRYPTION_KEY:
    try:
        _audit_cipher = Fernet(_AUDIT_ENCRYPTION_KEY.encode())
    except Exception as exc:
        logger.warning("AUDIT_DATA_ENCRYPTION_KEY invalid: %s", exc)

_idempotency_lock = threading.Lock()
_in_memory_idempotency: dict[tuple[str, str], dict[str, Any]] = {}
_in_memory_dead_letters: list[dict[str, Any]] = []
_metrics = {
    "idempotency_replays": 0,
    "idempotency_conflicts": 0,
    "dead_letters_recorded": 0,
    "audit_fields_protected": 0,
}

_SENSITIVE_FIELD_NAMES = {
    "aadhaar",
    "aadhaar_hash",
    "address",
    "contact_number",
    "dob",
    "email",
    "email_address",
    "email_encrypted",
    "emirates_id",
    "member_number",
    "patient_dob",
    "patient_name",
    "phone",
    "phone_encrypted",
    "subscriber_id",
}
_GENERIC_SENSITIVE_KEYS = {"raw_text", "value"}


@dataclass
class IdempotencyReplay:
    response_payload: dict[str, Any]
    response_status_code: int
    claim_reference: Optional[str] = None


class IdempotencyConflictError(Exception):
    """Raised when an idempotency key collides with a different payload."""

    def __init__(self, detail: dict[str, Any]):
        super().__init__(detail.get("message", "Idempotency conflict"))
        self.detail = detail


def get_idempotency_key(headers: dict[str, str] | Any) -> Optional[str]:
    """Return a normalized idempotency key from request headers."""
    key = None
    if hasattr(headers, "get"):
        key = headers.get("Idempotency-Key") or headers.get("X-Idempotency-Key")
    if not key:
        return None
    key = str(key).strip()
    return key[:128] if key else None


def build_request_fingerprint(payload: Any) -> str:
    """Create a stable hash for request payload comparison."""
    canonical = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_scope(endpoint: str, actor_id: Optional[str]) -> str:
    """Scope idempotency keys by actor + endpoint to avoid cross-user collisions."""
    actor = (actor_id or "anonymous").strip().lower()
    return f"{actor}:{endpoint}"


def _prune_expired_locked(now: datetime) -> None:
    expired = [
        cache_key
        for cache_key, record in _in_memory_idempotency.items()
        if datetime.fromisoformat(record["expires_at"]) <= now
    ]
    for cache_key in expired:
        _in_memory_idempotency.pop(cache_key, None)


def reserve_idempotency_key(
    db_session,
    *,
    idempotency_key: str,
    scope: str,
    request_fingerprint: str,
    request_id: Optional[str] = None,
) -> Optional[IdempotencyReplay]:
    """
    Reserve an idempotency key.

    Returns a replay payload if the request already completed.
    Raises IdempotencyConflictError for payload mismatch or in-progress duplicate.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    expires_at = now + timedelta(hours=IDEMPOTENCY_TTL_HOURS)

    if ENABLE_DB_PERSISTENCE and db_session is not None:
        from sqlalchemy import text

        row = db_session.execute(
            text(
                """
                SELECT request_fingerprint, status, response_payload, response_status_code,
                       claim_reference, expires_at
                FROM idempotency_keys
                WHERE idempotency_key = :idempotency_key
                  AND request_scope = :request_scope
                """
            ),
            {"idempotency_key": idempotency_key, "request_scope": scope},
        ).fetchone()

        if row:
            data = dict(row._mapping)
            if data.get("expires_at") and data["expires_at"] <= now:
                db_session.execute(
                    text(
                        """
                        DELETE FROM idempotency_keys
                        WHERE idempotency_key = :idempotency_key
                          AND request_scope = :request_scope
                        """
                    ),
                    {"idempotency_key": idempotency_key, "request_scope": scope},
                )
                db_session.commit()
                row = None
            else:
                if data["request_fingerprint"] != request_fingerprint:
                    _metrics["idempotency_conflicts"] += 1
                    raise IdempotencyConflictError(
                        {
                            "error": "IDEMPOTENCY_PAYLOAD_MISMATCH",
                            "message": "The same idempotency key was reused with a different request payload.",
                        }
                    )
                if data["status"] == "COMPLETED" and data.get("response_payload") is not None:
                    _metrics["idempotency_replays"] += 1
                    return IdempotencyReplay(
                        response_payload=data["response_payload"],
                        response_status_code=int(data.get("response_status_code") or 200),
                        claim_reference=data.get("claim_reference"),
                    )
                if data["status"] == "IN_PROGRESS":
                    _metrics["idempotency_conflicts"] += 1
                    raise IdempotencyConflictError(
                        {
                            "error": "IDEMPOTENT_REQUEST_IN_PROGRESS",
                            "message": "A matching request is already being processed.",
                        }
                    )

        db_session.execute(
            text(
                """
                INSERT INTO idempotency_keys (
                    idempotency_key, request_scope, request_fingerprint, status,
                    request_id, created_at, updated_at, expires_at
                ) VALUES (
                    :idempotency_key, :request_scope, :request_fingerprint, 'IN_PROGRESS',
                    :request_id, NOW(), NOW(), :expires_at
                )
                ON CONFLICT (idempotency_key, request_scope) DO UPDATE SET
                    request_fingerprint = EXCLUDED.request_fingerprint,
                    status = 'IN_PROGRESS',
                    request_id = EXCLUDED.request_id,
                    updated_at = NOW(),
                    expires_at = EXCLUDED.expires_at,
                    response_payload = NULL,
                    response_status_code = NULL,
                    claim_reference = NULL,
                    completed_at = NULL,
                    error_payload = NULL
                """
            ),
            {
                "idempotency_key": idempotency_key,
                "request_scope": scope,
                "request_fingerprint": request_fingerprint,
                "request_id": request_id,
                "expires_at": expires_at,
            },
        )
        db_session.commit()
        return None

    cache_key = (scope, idempotency_key)
    with _idempotency_lock:
        _prune_expired_locked(now)
        record = _in_memory_idempotency.get(cache_key)
        if record:
            if record["request_fingerprint"] != request_fingerprint:
                _metrics["idempotency_conflicts"] += 1
                raise IdempotencyConflictError(
                    {
                        "error": "IDEMPOTENCY_PAYLOAD_MISMATCH",
                        "message": "The same idempotency key was reused with a different request payload.",
                    }
                )
            if record["status"] == "COMPLETED":
                _metrics["idempotency_replays"] += 1
                return IdempotencyReplay(
                    response_payload=record["response_payload"],
                    response_status_code=record["response_status_code"],
                    claim_reference=record.get("claim_reference"),
                )
            if record["status"] == "IN_PROGRESS":
                _metrics["idempotency_conflicts"] += 1
                raise IdempotencyConflictError(
                    {
                        "error": "IDEMPOTENT_REQUEST_IN_PROGRESS",
                        "message": "A matching request is already being processed.",
                    }
                )

        _in_memory_idempotency[cache_key] = {
            "request_fingerprint": request_fingerprint,
            "status": "IN_PROGRESS",
            "request_id": request_id,
            "expires_at": expires_at.isoformat(),
        }
    return None


def complete_idempotency_key(
    db_session,
    *,
    idempotency_key: str,
    scope: str,
    response_payload: dict[str, Any],
    response_status_code: int,
    claim_reference: Optional[str] = None,
) -> None:
    """Mark an idempotent request as complete and store the replay payload."""
    if ENABLE_DB_PERSISTENCE and db_session is not None:
        from sqlalchemy import text

        db_session.execute(
            text(
                """
                UPDATE idempotency_keys
                SET status = 'COMPLETED',
                    response_payload = CAST(:response_payload AS jsonb),
                    response_status_code = :response_status_code,
                    claim_reference = :claim_reference,
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE idempotency_key = :idempotency_key
                  AND request_scope = :request_scope
                """
            ),
            {
                "idempotency_key": idempotency_key,
                "request_scope": scope,
                "response_payload": json.dumps(response_payload, default=str),
                "response_status_code": response_status_code,
                "claim_reference": claim_reference,
            },
        )
        db_session.commit()
        return

    cache_key = (scope, idempotency_key)
    with _idempotency_lock:
        record = _in_memory_idempotency.get(cache_key)
        if record:
            record.update(
                {
                    "status": "COMPLETED",
                    "response_payload": response_payload,
                    "response_status_code": response_status_code,
                    "claim_reference": claim_reference,
                }
            )


def fail_idempotency_key(
    db_session,
    *,
    idempotency_key: str,
    scope: str,
    error_payload: Optional[dict[str, Any]] = None,
) -> None:
    """Release a failed idempotent request so the client can retry safely."""
    if ENABLE_DB_PERSISTENCE and db_session is not None:
        from sqlalchemy import text

        db_session.execute(
            text(
                """
                UPDATE idempotency_keys
                SET status = 'FAILED',
                    error_payload = CAST(:error_payload AS jsonb),
                    updated_at = NOW()
                WHERE idempotency_key = :idempotency_key
                  AND request_scope = :request_scope
                """
            ),
            {
                "idempotency_key": idempotency_key,
                "request_scope": scope,
                "error_payload": json.dumps(error_payload or {}, default=str),
            },
        )
        db_session.commit()
        return

    cache_key = (scope, idempotency_key)
    with _idempotency_lock:
        record = _in_memory_idempotency.get(cache_key)
        if record:
            record["status"] = "FAILED"
            record["error_payload"] = error_payload or {}


def record_dead_letter(
    db_session,
    *,
    source_endpoint: str,
    failure_stage: str,
    error_type: str,
    error_message: str,
    payload: Optional[dict[str, Any]] = None,
    claim_reference: Optional[str] = None,
    request_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    source_channel: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> None:
    """Persist a failed processing attempt into the dead-letter queue."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    next_retry_at = now + timedelta(minutes=DLQ_RETRY_DELAY_MINUTES)
    sanitized_payload = sanitize_for_audit(payload or {})
    payload_fingerprint = build_request_fingerprint(sanitized_payload)

    record = {
        "claim_reference": claim_reference,
        "request_id": request_id,
        "idempotency_key": idempotency_key,
        "source_endpoint": source_endpoint,
        "source_channel": source_channel,
        "failure_stage": failure_stage,
        "error_type": error_type[:128],
        "error_message": error_message[:4000],
        "retry_count": 0,
        "status": "OPEN",
        "actor_id": actor_id,
        "payload_fingerprint": payload_fingerprint,
        "payload": sanitized_payload,
        "next_retry_at": next_retry_at.isoformat(),
        "created_at": now.isoformat(),
    }

    _metrics["dead_letters_recorded"] += 1

    if ENABLE_DB_PERSISTENCE and db_session is not None:
        from sqlalchemy import text

        db_session.execute(
            text(
                """
                INSERT INTO claim_dead_letters (
                    claim_reference, request_id, idempotency_key, source_endpoint,
                    source_channel, failure_stage, error_type, error_message,
                    retry_count, next_retry_at, status, actor_id,
                    payload_fingerprint, payload, created_at, updated_at
                ) VALUES (
                    :claim_reference, :request_id, :idempotency_key, :source_endpoint,
                    :source_channel, :failure_stage, :error_type, :error_message,
                    :retry_count, CAST(:next_retry_at AS timestamptz), :status, :actor_id,
                    :payload_fingerprint, CAST(:payload AS jsonb), NOW(), NOW()
                )
                """
            ),
            {
                "claim_reference": claim_reference,
                "request_id": request_id,
                "idempotency_key": idempotency_key,
                "source_endpoint": source_endpoint,
                "source_channel": source_channel,
                "failure_stage": failure_stage,
                "error_type": error_type[:128],
                "error_message": error_message[:4000],
                "retry_count": 0,
                "next_retry_at": next_retry_at.isoformat(),
                "status": "OPEN",
                "actor_id": actor_id,
                "payload_fingerprint": payload_fingerprint,
                "payload": json.dumps(sanitized_payload, default=str),
            },
        )
        db_session.commit()
        return

    _in_memory_dead_letters.append(record)


def _mask_string(value: Any) -> Any:
    if value is None:
        return None
    text = str(value)
    if len(text) <= 4:
        return "*" * len(text)
    if len(text) <= 8:
        return text[:1] + ("*" * (len(text) - 2)) + text[-1:]
    return text[:2] + ("*" * (len(text) - 4)) + text[-2:]


def _is_sensitive_path(path: tuple[str, ...]) -> bool:
    if not path:
        return False
    lowered = [segment.lower() for segment in path]
    if any(segment in _SENSITIVE_FIELD_NAMES for segment in lowered):
        return True
    if lowered[-1] in _GENERIC_SENSITIVE_KEYS and any(
        segment in _SENSITIVE_FIELD_NAMES for segment in lowered[:-1]
    ):
        return True
    return False


def sanitize_for_audit(payload: Any, path: tuple[str, ...] = ()) -> Any:
    """
    Redact and optionally encrypt sensitive audit fields.

    Non-sensitive fields pass through unchanged. Sensitive scalar values become:
      {"masked": "...", "protected": true, "encrypted": "...optional..."}
    """
    if isinstance(payload, dict):
        return {
            key: sanitize_for_audit(value, path + (str(key),))
            for key, value in payload.items()
        }
    if isinstance(payload, list):
        return [sanitize_for_audit(item, path + ("[]",)) for item in payload]
    if _is_sensitive_path(path):
        _metrics["audit_fields_protected"] += 1
        protected = {"masked": _mask_string(payload), "protected": True}
        if _audit_cipher is not None and payload is not None:
            try:
                protected["encrypted"] = _audit_cipher.encrypt(str(payload).encode()).decode()
            except Exception as exc:
                logger.debug("Audit encryption failed for %s: %s", ".".join(path), exc)
        return protected
    return payload


def get_reliability_snapshot(db_session=None) -> dict[str, Any]:
    """Return a compact operational snapshot for monitoring endpoints."""
    snapshot = dict(_metrics)
    snapshot["idempotency_cache_entries"] = len(_in_memory_idempotency)
    snapshot["dead_letters_in_memory"] = len(_in_memory_dead_letters)

    if ENABLE_DB_PERSISTENCE and db_session is not None:
        from sqlalchemy import text

        try:
            row = db_session.execute(
                text(
                    """
                    SELECT
                        COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0) AS open_dead_letters,
                        COALESCE(SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END), 0) AS in_progress_requests
                    FROM (
                        SELECT status FROM claim_dead_letters
                        UNION ALL
                        SELECT status FROM idempotency_keys
                    ) t
                    """
                )
            ).fetchone()
            if row:
                data = dict(row._mapping)
                snapshot["open_dead_letters"] = int(data.get("open_dead_letters") or 0)
                snapshot["in_progress_requests"] = int(data.get("in_progress_requests") or 0)
        except Exception as exc:
            logger.debug("Reliability snapshot DB query failed: %s", exc)

    return snapshot
