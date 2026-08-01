"""
Claim workflow event store and saga state persistence.

Provides a lightweight event-sourcing ledger for claim lifecycle reconstruction.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

_memory_events: list[dict[str, Any]] = []
_memory_sagas: dict[str, dict[str, Any]] = {}


def persist_claim_events(
    db_session,
    claim_reference: str,
    events: list[dict[str, Any]],
    tenant_id: str = "default",
    trace_id: Optional[str] = None,
) -> bool:
    if not db_session:
        _memory_events.extend(events)
        return True

    try:
        from sqlalchemy import text

        for idx, event in enumerate(events):
            db_session.execute(
                text(
                    """
                    INSERT INTO claim_processing_events (
                        claim_reference, tenant_id, event_sequence, event_type,
                        event_timestamp, event_payload, source_service,
                        trace_id, correlation_id, event_hash
                    ) VALUES (
                        :claim_reference, :tenant_id, :event_sequence, :event_type,
                        CAST(:event_timestamp AS timestamptz), CAST(:event_payload AS jsonb), :source_service,
                        :trace_id, :correlation_id, :event_hash
                    )
                    ON CONFLICT (claim_reference, event_hash) DO NOTHING
                    """
                ),
                {
                    "claim_reference": claim_reference,
                    "tenant_id": tenant_id,
                    "event_sequence": idx + 1,
                    "event_type": event.get("event_type", "UNKNOWN"),
                    "event_timestamp": event.get("timestamp", datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"),
                    "event_payload": json.dumps(event, default=str),
                    "source_service": event.get("service_name", "claim_pipeline"),
                    "trace_id": trace_id,
                    "correlation_id": event.get("claim_reference", claim_reference),
                    "event_hash": event.get("entry_hash"),
                },
            )
        db_session.commit()
        return True
    except Exception as exc:
        logger.error("Failed to persist claim events for %s: %s", claim_reference, exc)
        try:
            db_session.rollback()
        except Exception:
            pass
        return False


def upsert_claim_saga(
    db_session,
    claim_reference: str,
    *,
    tenant_id: str = "default",
    saga_status: str,
    current_step: str,
    trace_id: Optional[str] = None,
    source_channel: Optional[str] = None,
    last_error: Optional[str] = None,
) -> bool:
    record = {
        "claim_reference": claim_reference,
        "tenant_id": tenant_id,
        "saga_status": saga_status,
        "current_step": current_step,
        "trace_id": trace_id,
        "source_channel": source_channel,
        "last_error": last_error,
        "updated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
    }
    _memory_sagas[claim_reference] = record

    if not db_session:
        return True

    try:
        from sqlalchemy import text

        db_session.execute(
            text(
                """
                INSERT INTO claim_processing_sagas (
                    claim_reference, tenant_id, saga_status, current_step,
                    trace_id, source_channel, last_error, started_at, updated_at
                ) VALUES (
                    :claim_reference, :tenant_id, :saga_status, :current_step,
                    :trace_id, :source_channel, :last_error, NOW(), NOW()
                )
                ON CONFLICT (claim_reference) DO UPDATE SET
                    tenant_id = EXCLUDED.tenant_id,
                    saga_status = EXCLUDED.saga_status,
                    current_step = EXCLUDED.current_step,
                    trace_id = EXCLUDED.trace_id,
                    source_channel = EXCLUDED.source_channel,
                    last_error = EXCLUDED.last_error,
                    updated_at = NOW()
                """
            ),
            record,
        )
        db_session.commit()
        return True
    except Exception as exc:
        logger.error("Failed to upsert claim saga for %s: %s", claim_reference, exc)
        try:
            db_session.rollback()
        except Exception:
            pass
        return False
