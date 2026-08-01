"""Claim lifecycle event store with DB persistence and memory fallback."""
from __future__ import annotations

import hashlib
import json
import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

STAGE_DOCUMENT_INGESTION = "document_ingestion"
STAGE_INTAKE_ENRICHMENT = "intake_enrichment"
STAGE_RULES_ENGINE = "rules_engine"
STAGE_AI_REASONING = "ai_reasoning"
STAGE_DUAL_VALIDATION = "dual_validation"
STAGE_SETTLEMENT = "settlement"
STAGE_VALIDATION = "validation"
STAGE_HITL_ROUTING = "hitl_routing"
STAGE_PERSISTENCE = "persistence"

CANONICAL_STAGES: tuple[str, ...] = (
    STAGE_DOCUMENT_INGESTION,
    STAGE_INTAKE_ENRICHMENT,
    STAGE_RULES_ENGINE,
    STAGE_AI_REASONING,
    STAGE_DUAL_VALIDATION,
    STAGE_SETTLEMENT,
    STAGE_VALIDATION,
    STAGE_HITL_ROUTING,
    STAGE_PERSISTENCE,
)

STAGE_LABELS = {
    STAGE_DOCUMENT_INGESTION: "Document ingestion",
    STAGE_INTAKE_ENRICHMENT: "Intake enrichment",
    STAGE_RULES_ENGINE: "Rules engine",
    STAGE_AI_REASONING: "Policy reasoning",
    STAGE_DUAL_VALIDATION: "Dual validation",
    STAGE_SETTLEMENT: "Settlement calculation",
    STAGE_VALIDATION: "Completeness validation",
    STAGE_HITL_ROUTING: "HITL routing",
    STAGE_PERSISTENCE: "Persistence",
}

STATE_NOT_STARTED = "NOT_STARTED"
STATE_IN_PROGRESS = "IN_PROGRESS"
STATE_COMPLETED = "COMPLETED"
STATE_FAILED = "FAILED"
STATE_BLOCKED = "BLOCKED"
STATE_SKIPPED = "SKIPPED"

ACTIVE_STATES = {STATE_IN_PROGRESS, STATE_BLOCKED}
TERMINAL_STATES = {STATE_COMPLETED, STATE_FAILED, STATE_SKIPPED}
VALID_STATES = {STATE_NOT_STARTED, STATE_IN_PROGRESS, STATE_COMPLETED, STATE_FAILED, STATE_BLOCKED, STATE_SKIPPED}

DEFAULT_STAGE_SLA_SECONDS = {
    STAGE_DOCUMENT_INGESTION: 300,
    STAGE_INTAKE_ENRICHMENT: 900,
    STAGE_RULES_ENGINE: 600,
    STAGE_AI_REASONING: 900,
    STAGE_DUAL_VALIDATION: 600,
    STAGE_SETTLEMENT: 600,
    STAGE_VALIDATION: 300,
    STAGE_HITL_ROUTING: 900,
    STAGE_PERSISTENCE: 300,
}

_DEFAULT_OWNER_BY_STAGE = {
    STAGE_DOCUMENT_INGESTION: "INTAKE",
    STAGE_INTAKE_ENRICHMENT: "INTAKE",
    STAGE_RULES_ENGINE: "RULES_ENGINE",
    STAGE_AI_REASONING: "AI_REASONING",
    STAGE_DUAL_VALIDATION: "AI_VALIDATION",
    STAGE_SETTLEMENT: "SETTLEMENT",
    STAGE_VALIDATION: "VALIDATION",
    STAGE_HITL_ROUTING: "HITL",
    STAGE_PERSISTENCE: "PLATFORM",
}

_memory_events: dict[str, list[dict[str, Any]]] = {}
_memory_current: dict[str, dict[str, Any]] = {}


class LifecycleTransitionError(ValueError):
    """Raised when a lifecycle transition is invalid."""


def reset_memory_store() -> None:
    """Clear in-memory lifecycle state. Intended for unit tests/local fallback."""
    _memory_events.clear()
    _memory_current.clear()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
    else:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(value: Any) -> Optional[str]:
    dt = _coerce_datetime(value)
    if dt is None:
        return None
    rendered = dt.astimezone(timezone.utc).replace(tzinfo=None).isoformat(timespec="milliseconds")
    if rendered.endswith(".000"):
        rendered = rendered[:-4]
    return f"{rendered}Z"


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return _iso(value) or ""
    return str(value)


def _payload_dict(payload: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not payload:
        return {}
    return deepcopy(payload)


def _validate_stage(stage: str) -> None:
    if stage not in CANONICAL_STAGES:
        raise LifecycleTransitionError(f"Unknown claim lifecycle stage: {stage}")


def _next_stage(stage: str) -> Optional[str]:
    try:
        idx = CANONICAL_STAGES.index(stage)
    except ValueError:
        return None
    if idx + 1 >= len(CANONICAL_STAGES):
        return None
    return CANONICAL_STAGES[idx + 1]


def _default_next_action(stage: str, state: str, reason: Optional[str]) -> str:
    if state == STATE_IN_PROGRESS:
        return f"Complete {STAGE_LABELS.get(stage, stage)}"
    if state == STATE_BLOCKED:
        return reason or "Resolve lifecycle blocker"
    if state == STATE_FAILED:
        return "Investigate failure and retry or route to manual review"
    if state == STATE_SKIPPED:
        next_stage = _next_stage(stage)
        return f"Start {STAGE_LABELS[next_stage]}" if next_stage else "No further lifecycle action"
    if state == STATE_COMPLETED:
        next_stage = _next_stage(stage)
        return f"Start {STAGE_LABELS[next_stage]}" if next_stage else "Claim lifecycle complete"
    return "Start claim lifecycle"


def _duration_ms(started_at: Optional[datetime], completed_at: Optional[datetime]) -> Optional[int]:
    if not started_at or not completed_at:
        return None
    return max(0, int((completed_at - started_at).total_seconds() * 1000))


def _build_event_hash(event: dict[str, Any]) -> str:
    serialized = json.dumps(
        {key: value for key, value in event.items() if key != "event_hash"},
        sort_keys=True,
        default=_json_default,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _emit_lifecycle_metrics(event: dict[str, Any]) -> None:
    """Emit aggregate lifecycle metrics without claim-level labels."""
    try:
        from services.api_gateway.app.metrics import (
            observe_claim_stage_duration,
            record_claim_lifecycle_event,
        )

        state = str(event.get("state") or "").upper()
        event_name = {
            STATE_IN_PROGRESS: "entered",
            STATE_COMPLETED: "completed",
            STATE_FAILED: "failed",
            STATE_BLOCKED: "blocked",
            STATE_SKIPPED: "skipped",
        }.get(state, "unknown")
        result = {
            STATE_COMPLETED: "success",
            STATE_FAILED: "failure",
            STATE_BLOCKED: "pending",
            STATE_SKIPPED: "skipped",
            STATE_IN_PROGRESS: "pending",
        }.get(state, "unknown")
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        market = payload.get("market_region") or "unknown"

        record_claim_lifecycle_event(
            str(event.get("stage") or "unknown"),
            event_name,
            market=str(market),
            result=result,
        )
        if event.get("duration_ms") is not None:
            observe_claim_stage_duration(
                str(event.get("stage") or "unknown"),
                float(event.get("duration_ms") or 0) / 1000,
                market=str(market),
            )
    except Exception as exc:
        logger.debug("Claim lifecycle metric emission skipped: %s", exc)


def _latest_event_for_stage(claim_reference: str, stage: str) -> Optional[dict[str, Any]]:
    events = [event for event in _memory_events.get(claim_reference, []) if event.get("stage") == stage]
    return events[-1] if events else None


def _active_start_for_stage(claim_reference: str, stage: str) -> Optional[str]:
    for event in reversed(_memory_events.get(claim_reference, [])):
        if event.get("stage") != stage:
            continue
        if event.get("state") == STATE_IN_PROGRESS:
            return event.get("started_at")
        if event.get("state") in TERMINAL_STATES:
            return event.get("started_at")
    return None


def _guard_transition(claim_reference: str, stage: str, state: str) -> None:
    _validate_stage(stage)
    latest = _latest_event_for_stage(claim_reference, stage)
    if not latest:
        return
    latest_state = latest.get("state")
    if state in {STATE_BLOCKED, STATE_FAILED} and latest_state in TERMINAL_STATES:
        raise LifecycleTransitionError(
            f"Cannot transition terminal stage {stage} from {latest_state} to {state}"
        )
    if state == STATE_COMPLETED and latest_state in {STATE_FAILED, STATE_COMPLETED}:
        raise LifecycleTransitionError(
            f"Cannot complete terminal stage {stage} from {latest_state}"
        )


def _record_event(
    db_session,
    claim_reference: str,
    stage: str,
    state: str,
    *,
    tenant_id: str = "default",
    started_at: Any = None,
    completed_at: Any = None,
    duration_ms: Optional[int] = None,
    owner_role: Optional[str] = None,
    actor_type: str = "SYSTEM",
    actor_id: Optional[str] = None,
    reason: Optional[str] = None,
    severity: Optional[str] = None,
    source_service: str = "claim_pipeline",
    trace_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    next_action: Optional[str] = None,
    now: Any = None,
) -> dict[str, Any]:
    _guard_transition(claim_reference, stage, state)

    now_dt = _coerce_datetime(now) or _utc_now()
    started_dt = _coerce_datetime(started_at)
    completed_dt = _coerce_datetime(completed_at)

    if state == STATE_IN_PROGRESS:
        started_dt = started_dt or now_dt
    elif state in {STATE_COMPLETED, STATE_FAILED, STATE_BLOCKED, STATE_SKIPPED}:
        started_dt = started_dt or _coerce_datetime(_active_start_for_stage(claim_reference, stage)) or now_dt
        completed_dt = completed_dt or now_dt

    if duration_ms is None:
        duration_ms = _duration_ms(started_dt, completed_dt)

    payload_data = _payload_dict(payload)
    existing_current = _memory_current.get(claim_reference, {})
    if payload_data.get("market_region"):
        payload_data["market_region"] = str(payload_data["market_region"]).upper()
    elif existing_current.get("market_region"):
        payload_data["market_region"] = existing_current["market_region"]

    action = next_action or _default_next_action(stage, state, reason)
    event = {
        "claim_reference": claim_reference,
        "tenant_id": tenant_id or "default",
        "stage": stage,
        "state": state,
        "started_at": _iso(started_dt),
        "completed_at": _iso(completed_dt),
        "duration_ms": duration_ms,
        "owner_role": owner_role or _DEFAULT_OWNER_BY_STAGE.get(stage, "SYSTEM"),
        "actor_type": actor_type or "SYSTEM",
        "actor_id": actor_id,
        "reason": reason,
        "severity": severity,
        "source_service": source_service,
        "trace_id": trace_id,
        "payload": payload_data,
        "created_at": _iso(now_dt),
        "next_action": action,
    }
    event["event_hash"] = _build_event_hash(event)

    _memory_events.setdefault(claim_reference, []).append(event)
    _memory_current[claim_reference] = {
        "claim_reference": claim_reference,
        "tenant_id": tenant_id or "default",
        "market_region": payload_data.get("market_region"),
        "current_stage": stage,
        "current_stage_status": state,
        "current_stage_started_at": event["started_at"],
        "lifecycle_updated_at": event["completed_at"] or event["created_at"],
        "lifecycle_blocker": reason if state in {STATE_BLOCKED, STATE_FAILED} else None,
        "next_action": action,
    }

    _persist_event_to_db(db_session, event)
    _emit_lifecycle_metrics(event)
    return deepcopy(event)


def _persist_event_to_db(db_session, event: dict[str, Any]) -> bool:
    if db_session is None:
        return True
    try:
        from sqlalchemy import text

        db_session.execute(
            text(
                """
                INSERT INTO claim_lifecycle_events (
                    claim_reference, tenant_id, stage, state, started_at, completed_at,
                    duration_ms, owner_role, actor_type, actor_id, reason, severity,
                    source_service, trace_id, payload, event_hash, created_at
                ) VALUES (
                    :claim_reference, :tenant_id, :stage, :state,
                    CAST(:started_at AS timestamptz), CAST(:completed_at AS timestamptz),
                    :duration_ms, :owner_role, :actor_type, :actor_id, :reason, :severity,
                    :source_service, :trace_id, CAST(:payload AS jsonb), :event_hash,
                    CAST(:created_at AS timestamptz)
                )
                ON CONFLICT (event_hash) DO NOTHING
                """
            ),
            {
                **event,
                "payload": json.dumps(event.get("payload") or {}, default=_json_default),
            },
        )
        _update_claim_current_fields(db_session, event)
        db_session.commit()
        return True
    except Exception as exc:
        logger.debug(
            "Claim lifecycle DB persistence failed for %s/%s/%s: %s",
            event.get("claim_reference"),
            event.get("stage"),
            event.get("state"),
            exc,
        )
        try:
            db_session.rollback()
        except Exception:
            pass
        return False


def _update_claim_current_fields(db_session, event_or_current: dict[str, Any]) -> None:
    from sqlalchemy import text

    params = {
        "claim_reference": event_or_current["claim_reference"],
        "current_stage": event_or_current.get("stage") or event_or_current.get("current_stage"),
        "current_stage_status": event_or_current.get("state") or event_or_current.get("current_stage_status"),
        "current_stage_started_at": event_or_current.get("started_at")
        or event_or_current.get("current_stage_started_at"),
        "lifecycle_updated_at": event_or_current.get("completed_at")
        or event_or_current.get("lifecycle_updated_at")
        or event_or_current.get("created_at"),
        "lifecycle_blocker": event_or_current.get("reason")
        if (event_or_current.get("state") or event_or_current.get("current_stage_status")) in {STATE_BLOCKED, STATE_FAILED}
        else event_or_current.get("lifecycle_blocker"),
        "next_action": event_or_current.get("next_action"),
    }
    db_session.execute(
        text(
            """
            UPDATE claims
            SET current_stage = :current_stage,
                current_stage_status = :current_stage_status,
                current_stage_started_at = CAST(:current_stage_started_at AS timestamptz),
                lifecycle_updated_at = CAST(:lifecycle_updated_at AS timestamptz),
                lifecycle_blocker = :lifecycle_blocker,
                next_action = :next_action,
                updated_at = NOW()
            WHERE claim_reference = :claim_reference
            """
        ),
        params,
    )


def sync_current_claim_fields(db_session, claim_reference: str) -> bool:
    """Write the latest in-memory current lifecycle fields to claims after claim insert."""
    if db_session is None:
        return True
    current = _memory_current.get(claim_reference)
    if not current:
        return True
    try:
        _update_claim_current_fields(db_session, current)
        db_session.commit()
        return True
    except Exception as exc:
        logger.debug("Claim lifecycle current-field sync failed for %s: %s", claim_reference, exc)
        try:
            db_session.rollback()
        except Exception:
            pass
        return False


def start_stage(
    db_session,
    claim_reference: str,
    stage: str,
    *,
    tenant_id: str = "default",
    owner_role: Optional[str] = None,
    actor_type: str = "SYSTEM",
    actor_id: Optional[str] = None,
    source_service: str = "claim_pipeline",
    trace_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    now: Any = None,
) -> dict[str, Any]:
    return _record_event(
        db_session,
        claim_reference,
        stage,
        STATE_IN_PROGRESS,
        tenant_id=tenant_id,
        owner_role=owner_role,
        actor_type=actor_type,
        actor_id=actor_id,
        source_service=source_service,
        trace_id=trace_id,
        payload=payload,
        now=now,
    )


def complete_stage(
    db_session,
    claim_reference: str,
    stage: str,
    *,
    tenant_id: str = "default",
    started_at: Any = None,
    duration_ms: Optional[int] = None,
    owner_role: Optional[str] = None,
    actor_type: str = "SYSTEM",
    actor_id: Optional[str] = None,
    reason: Optional[str] = None,
    source_service: str = "claim_pipeline",
    trace_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    now: Any = None,
) -> dict[str, Any]:
    return _record_event(
        db_session,
        claim_reference,
        stage,
        STATE_COMPLETED,
        tenant_id=tenant_id,
        started_at=started_at,
        completed_at=now,
        duration_ms=duration_ms,
        owner_role=owner_role,
        actor_type=actor_type,
        actor_id=actor_id,
        reason=reason,
        source_service=source_service,
        trace_id=trace_id,
        payload=payload,
        now=now,
    )


def skip_stage(
    db_session,
    claim_reference: str,
    stage: str,
    *,
    tenant_id: str = "default",
    started_at: Any = None,
    duration_ms: Optional[int] = None,
    owner_role: Optional[str] = None,
    actor_type: str = "SYSTEM",
    actor_id: Optional[str] = None,
    reason: Optional[str] = None,
    source_service: str = "claim_pipeline",
    trace_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    now: Any = None,
) -> dict[str, Any]:
    return _record_event(
        db_session,
        claim_reference,
        stage,
        STATE_SKIPPED,
        tenant_id=tenant_id,
        started_at=started_at,
        completed_at=now,
        duration_ms=duration_ms,
        owner_role=owner_role,
        actor_type=actor_type,
        actor_id=actor_id,
        reason=reason,
        source_service=source_service,
        trace_id=trace_id,
        payload=payload,
        now=now,
    )


def fail_stage(
    db_session,
    claim_reference: str,
    stage: str,
    *,
    tenant_id: str = "default",
    started_at: Any = None,
    duration_ms: Optional[int] = None,
    owner_role: Optional[str] = None,
    actor_type: str = "SYSTEM",
    actor_id: Optional[str] = None,
    reason: Optional[str] = None,
    severity: str = "ERROR",
    source_service: str = "claim_pipeline",
    trace_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    now: Any = None,
) -> dict[str, Any]:
    return _record_event(
        db_session,
        claim_reference,
        stage,
        STATE_FAILED,
        tenant_id=tenant_id,
        started_at=started_at,
        completed_at=now,
        duration_ms=duration_ms,
        owner_role=owner_role,
        actor_type=actor_type,
        actor_id=actor_id,
        reason=reason,
        severity=severity,
        source_service=source_service,
        trace_id=trace_id,
        payload=payload,
        now=now,
    )


def block_stage(
    db_session,
    claim_reference: str,
    stage: str,
    *,
    tenant_id: str = "default",
    started_at: Any = None,
    owner_role: Optional[str] = None,
    actor_type: str = "SYSTEM",
    actor_id: Optional[str] = None,
    reason: Optional[str] = None,
    severity: str = "WARN",
    source_service: str = "claim_pipeline",
    trace_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    next_action: Optional[str] = None,
    now: Any = None,
) -> dict[str, Any]:
    return _record_event(
        db_session,
        claim_reference,
        stage,
        STATE_BLOCKED,
        tenant_id=tenant_id,
        started_at=started_at,
        completed_at=now,
        owner_role=owner_role,
        actor_type=actor_type,
        actor_id=actor_id,
        reason=reason,
        severity=severity,
        source_service=source_service,
        trace_id=trace_id,
        payload=payload,
        next_action=next_action,
        now=now,
    )


def _event_from_row(row: Any) -> dict[str, Any]:
    data = dict(row._mapping if hasattr(row, "_mapping") else row)
    payload = data.get("payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    data["payload"] = payload
    for key in ("started_at", "completed_at", "created_at"):
        data[key] = _iso(data.get(key))
    return data


def _current_from_row(row: Any) -> dict[str, Any]:
    data = dict(row._mapping if hasattr(row, "_mapping") else row)
    current = {
        "claim_reference": data.get("claim_reference"),
        "tenant_id": data.get("tenant_id") or "default",
        "market_region": str(data.get("market_region")).upper() if data.get("market_region") else None,
        "current_stage": data.get("current_stage"),
        "current_stage_status": data.get("current_stage_status"),
        "current_stage_started_at": _iso(data.get("current_stage_started_at")),
        "lifecycle_updated_at": _iso(data.get("lifecycle_updated_at")),
        "lifecycle_blocker": data.get("lifecycle_blocker"),
        "next_action": data.get("next_action"),
    }
    for key in (
        "patient_name",
        "member_number",
        "claim_type",
        "currency",
        "total_billed",
        "total_settlement",
        "claim_status",
    ):
        if key in data:
            current[key] = data.get(key)
    return current


def _load_db_lifecycle(db_session, claim_reference: str, tenant_id: Optional[str]) -> Optional[tuple[dict[str, Any], list[dict[str, Any]]]]:
    if db_session is None:
        return None
    try:
        from sqlalchemy import text

        tenant_clause = "AND tenant_id = :tenant_id" if tenant_id else ""
        current_row = db_session.execute(
            text(
                f"""
                SELECT
                    claim_reference, tenant_id, CAST(market_region AS text) AS market_region,
                    current_stage, current_stage_status, current_stage_started_at,
                    lifecycle_updated_at, lifecycle_blocker, next_action,
                    patient_name, member_number, CAST(claim_type AS text) AS claim_type,
                    CAST(currency AS text) AS currency, total_billed, total_settlement,
                    CAST(status AS text) AS claim_status
                FROM claims
                WHERE claim_reference = :claim_reference
                {tenant_clause}
                LIMIT 1
                """
            ),
            {"claim_reference": claim_reference, "tenant_id": tenant_id},
        ).fetchone()
        event_tenant_clause = "AND tenant_id = :tenant_id" if tenant_id else ""
        events = db_session.execute(
            text(
                f"""
                SELECT
                    claim_reference, tenant_id, stage, state, started_at, completed_at,
                    duration_ms, owner_role, actor_type, actor_id, reason, severity,
                    source_service, trace_id, payload, event_hash, created_at
                FROM claim_lifecycle_events
                WHERE claim_reference = :claim_reference
                {event_tenant_clause}
                ORDER BY COALESCE(started_at, created_at), created_at
                """
            ),
            {"claim_reference": claim_reference, "tenant_id": tenant_id},
        ).fetchall()
        current = _current_from_row(current_row) if current_row else {
            "claim_reference": claim_reference,
            "tenant_id": tenant_id or "default",
        }
        return current, [_event_from_row(row) for row in events]
    except Exception as exc:
        logger.debug("Claim lifecycle DB lookup failed for %s: %s", claim_reference, exc)
        return None


def _events_from_claim_snapshot(claim_snapshot: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    if not claim_snapshot:
        return []
    report = claim_snapshot.get("pipeline_stage_report") or {}
    stages = report.get("stages") if isinstance(report, dict) else None
    if not isinstance(stages, list):
        return []

    events: list[dict[str, Any]] = []
    tenant_id = claim_snapshot.get("tenant_id") or "default"
    for item in stages:
        if not isinstance(item, dict) or item.get("stage") not in CANONICAL_STAGES:
            continue
        state = str(item.get("status") or STATE_COMPLETED).upper()
        if state == "ROUTED" or state == "AUTO_SETTLED":
            state = STATE_COMPLETED
        if state not in {STATE_COMPLETED, STATE_FAILED, STATE_SKIPPED, STATE_BLOCKED, STATE_IN_PROGRESS}:
            state = STATE_COMPLETED
        completed_at = item.get("completed_at") or claim_snapshot.get("date_adjudicated") or claim_snapshot.get("date_received")
        event = {
            "claim_reference": claim_snapshot.get("claim_reference"),
            "tenant_id": tenant_id,
            "stage": item["stage"],
            "state": state,
            "started_at": None,
            "completed_at": _iso(completed_at),
            "duration_ms": item.get("duration_ms"),
            "owner_role": _DEFAULT_OWNER_BY_STAGE.get(item["stage"], "SYSTEM"),
            "actor_type": "SYSTEM",
            "actor_id": None,
            "reason": item.get("summary"),
            "severity": "ERROR" if state == STATE_FAILED else None,
            "source_service": "claim_pipeline_snapshot",
            "trace_id": claim_snapshot.get("trace_id"),
            "payload": {"details": item.get("details") or {}, "market_region": claim_snapshot.get("market_region")},
            "created_at": _iso(completed_at),
        }
        event["event_hash"] = _build_event_hash(event)
        events.append(event)
    return events


def _stage_summaries(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for stage in CANONICAL_STAGES:
        stage_events = [event for event in events if event.get("stage") == stage]
        if not stage_events:
            summaries.append(
                {
                    "stage": stage,
                    "label": STAGE_LABELS[stage],
                    "state": STATE_NOT_STARTED,
                    "started_at": None,
                    "completed_at": None,
                    "duration_ms": None,
                    "owner_role": _DEFAULT_OWNER_BY_STAGE.get(stage, "SYSTEM"),
                    "reason": None,
                }
            )
            continue
        latest = stage_events[-1]
        first_started = next((event.get("started_at") for event in stage_events if event.get("started_at")), None)
        summaries.append(
            {
                "stage": stage,
                "label": STAGE_LABELS[stage],
                "state": latest.get("state"),
                "started_at": first_started,
                "completed_at": latest.get("completed_at"),
                "duration_ms": latest.get("duration_ms"),
                "owner_role": latest.get("owner_role") or _DEFAULT_OWNER_BY_STAGE.get(stage, "SYSTEM"),
                "reason": latest.get("reason"),
            }
        )
    return summaries


def _build_lifecycle(
    claim_reference: str,
    current: Optional[dict[str, Any]],
    events: list[dict[str, Any]],
    *,
    now: Any = None,
    claim_snapshot: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    now_dt = _coerce_datetime(now) or _utc_now()
    current = dict(current or {})
    if not current.get("claim_reference"):
        current["claim_reference"] = claim_reference

    if events and not current.get("current_stage"):
        latest = events[-1]
        current.update(
            {
                "tenant_id": latest.get("tenant_id") or "default",
                "current_stage": latest.get("stage"),
                "current_stage_status": latest.get("state"),
                "current_stage_started_at": latest.get("started_at"),
                "lifecycle_updated_at": latest.get("completed_at") or latest.get("created_at"),
                "lifecycle_blocker": latest.get("reason") if latest.get("state") in {STATE_BLOCKED, STATE_FAILED} else None,
                "next_action": latest.get("next_action") or _default_next_action(
                    latest.get("stage"), latest.get("state"), latest.get("reason")
                ),
            }
        )

    if claim_snapshot:
        current.setdefault("tenant_id", claim_snapshot.get("tenant_id") or "default")
        current.setdefault("market_region", claim_snapshot.get("market_region"))

    stage = current.get("current_stage")
    state = current.get("current_stage_status") or (STATE_NOT_STARTED if not events else events[-1].get("state"))
    started = _coerce_datetime(current.get("current_stage_started_at"))
    sla_seconds = DEFAULT_STAGE_SLA_SECONDS.get(stage, 0) if stage else 0
    age_seconds = 0
    if state in ACTIVE_STATES and started:
        age_seconds = max(0, int((now_dt - started).total_seconds()))
    is_stuck = state in ACTIVE_STATES and bool(sla_seconds) and age_seconds > sla_seconds

    return {
        "claim_reference": claim_reference,
        "tenant_id": current.get("tenant_id") or "default",
        "market_region": str(current.get("market_region")).upper() if current.get("market_region") else None,
        "current_stage": stage,
        "stage_status": state,
        "current_age_seconds": age_seconds,
        "sla_seconds": sla_seconds,
        "is_stuck": is_stuck,
        "blocker": current.get("lifecycle_blocker"),
        "next_action": current.get("next_action") or (_default_next_action(stage, state, None) if stage else "Start claim lifecycle"),
        "lifecycle_updated_at": current.get("lifecycle_updated_at"),
        "patient_name": current.get("patient_name"),
        "member_number": current.get("member_number"),
        "claim_type": current.get("claim_type"),
        "currency": current.get("currency"),
        "total_billed": current.get("total_billed"),
        "total_settlement": current.get("total_settlement"),
        "claim_status": current.get("claim_status"),
        "stages": _stage_summaries(events),
        "events": deepcopy(events),
    }


def get_claim_lifecycle(
    db_session,
    claim_reference: str,
    *,
    tenant_id: Optional[str] = None,
    claim_snapshot: Optional[dict[str, Any]] = None,
    now: Any = None,
) -> dict[str, Any]:
    db_payload = _load_db_lifecycle(db_session, claim_reference, tenant_id)
    if db_payload is not None:
        current, events = db_payload
        if not events:
            events = _memory_events.get(claim_reference, []) or _events_from_claim_snapshot(claim_snapshot)
        return _build_lifecycle(claim_reference, current, events, now=now, claim_snapshot=claim_snapshot)

    current = _memory_current.get(claim_reference, {"claim_reference": claim_reference, "tenant_id": tenant_id or "default"})
    events = _memory_events.get(claim_reference, []) or _events_from_claim_snapshot(claim_snapshot)
    return _build_lifecycle(claim_reference, current, events, now=now, claim_snapshot=claim_snapshot)


def _load_db_operations(
    db_session,
    *,
    stage: Optional[str],
    state: Optional[str],
    market_region: Optional[str],
    tenant_id: Optional[str],
    limit: int,
) -> Optional[list[dict[str, Any]]]:
    if db_session is None:
        return None
    try:
        from sqlalchemy import text

        where = ["c.current_stage IS NOT NULL"]
        params: dict[str, Any] = {"limit": max(1, min(limit, 500))}
        if stage:
            where.append("c.current_stage = :stage")
            params["stage"] = stage
        if state:
            where.append("c.current_stage_status = :state")
            params["state"] = state
        if market_region:
            where.append("c.market_region = CAST(:market_region AS market_region)")
            params["market_region"] = market_region.upper()
        if tenant_id:
            where.append("c.tenant_id = :tenant_id")
            params["tenant_id"] = tenant_id

        rows = db_session.execute(
            text(
                f"""
                SELECT
                    c.claim_reference, c.tenant_id, CAST(c.market_region AS text) AS market_region,
                    c.current_stage, c.current_stage_status, c.current_stage_started_at,
                    c.lifecycle_updated_at, c.lifecycle_blocker, c.next_action,
                    c.patient_name, c.member_number, CAST(c.claim_type AS text) AS claim_type,
                    CAST(c.currency AS text) AS currency, c.total_billed, c.total_settlement,
                    CAST(c.status AS text) AS claim_status
                FROM claims c
                WHERE {" AND ".join(where)}
                ORDER BY c.lifecycle_updated_at DESC NULLS LAST, c.date_received DESC
                LIMIT :limit
                """
            ),
            params,
        ).fetchall()
        return [_current_from_row(row) for row in rows]
    except Exception as exc:
        logger.debug("Claim lifecycle DB operations lookup failed: %s", exc)
        return None


def _operation_summary(lifecycle: dict[str, Any]) -> dict[str, Any]:
    return {
        "claim_reference": lifecycle["claim_reference"],
        "tenant_id": lifecycle.get("tenant_id") or "default",
        "market_region": lifecycle.get("market_region"),
        "current_stage": lifecycle.get("current_stage"),
        "stage_status": lifecycle.get("stage_status"),
        "current_age_seconds": lifecycle.get("current_age_seconds", 0),
        "sla_seconds": lifecycle.get("sla_seconds", 0),
        "is_stuck": lifecycle.get("is_stuck", False),
        "blocker": lifecycle.get("blocker"),
        "next_action": lifecycle.get("next_action"),
        "lifecycle_updated_at": lifecycle.get("lifecycle_updated_at"),
        "patient_name": lifecycle.get("patient_name"),
        "member_number": lifecycle.get("member_number"),
        "claim_type": lifecycle.get("claim_type"),
        "currency": lifecycle.get("currency"),
        "total_billed": lifecycle.get("total_billed"),
        "total_settlement": lifecycle.get("total_settlement"),
        "claim_status": lifecycle.get("claim_status"),
    }


def list_lifecycle_operations(
    db_session,
    *,
    stage: Optional[str] = None,
    state: Optional[str] = None,
    market_region: Optional[str] = None,
    stuck_only: bool = False,
    tenant_id: Optional[str] = None,
    limit: int = 100,
    now: Any = None,
) -> list[dict[str, Any]]:
    if stage:
        _validate_stage(stage)
    if state:
        state = state.upper()
        if state not in VALID_STATES:
            raise LifecycleTransitionError(f"Unknown claim lifecycle state: {state}")

    db_rows = _load_db_operations(
        db_session,
        stage=stage,
        state=state,
        market_region=market_region,
        tenant_id=tenant_id,
        limit=max(limit * 3, limit),
    )

    summaries: list[dict[str, Any]] = []
    seen: set[str] = set()
    if db_rows is not None:
        for current in db_rows:
            claim_ref = current.get("claim_reference")
            if not claim_ref:
                continue
            lifecycle = get_claim_lifecycle(
                db_session,
                claim_ref,
                tenant_id=tenant_id,
                now=now,
            )
            summaries.append(_operation_summary(lifecycle))
            seen.add(claim_ref)

    for claim_ref, current in _memory_current.items():
        if claim_ref in seen:
            continue
        lifecycle = get_claim_lifecycle(None, claim_ref, tenant_id=tenant_id, now=now)
        summaries.append(_operation_summary(lifecycle))

    def _matches(item: dict[str, Any]) -> bool:
        if stage and item.get("current_stage") != stage:
            return False
        if state and item.get("stage_status") != state:
            return False
        if market_region and (item.get("market_region") or "").upper() != market_region.upper():
            return False
        if tenant_id and item.get("tenant_id") != tenant_id:
            return False
        if stuck_only and not item.get("is_stuck"):
            return False
        return True

    filtered = [item for item in summaries if _matches(item)]
    filtered.sort(key=lambda item: item.get("lifecycle_updated_at") or "", reverse=True)
    return filtered[: max(1, min(limit, 500))]
