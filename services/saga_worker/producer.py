from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

TRUE_VALUES = {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class SagaProducerConfig:
    enabled: bool = False


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def build_claim_saga_message(
    *,
    event_type: str,
    claim_reference: str,
    tenant_id: str,
    trace_id: Optional[str],
    source_channel: Optional[str],
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not claim_reference:
        raise ValueError("claim_reference is required for saga messages")

    return {
        "message_id": uuid.uuid4().hex,
        "message_version": 1,
        "event_type": event_type,
        "claim_reference": claim_reference,
        "tenant_id": tenant_id or "default",
        "trace_id": trace_id,
        "source_channel": source_channel or "API",
        "payload": payload or {},
        "created_at": _utc_now(),
    }


class SagaProducer:
    """Non-throwing producer for the optional async saga path."""

    def __init__(self, config: Optional[SagaProducerConfig] = None):
        self.config = config or SagaProducerConfig()
        self._memory_queue: list[dict[str, Any]] = []

    @classmethod
    def from_env(cls) -> "SagaProducer":
        enabled = os.getenv("CLAIM_SAGA_WORKER_ENABLED", "").strip().lower() in TRUE_VALUES
        return cls(SagaProducerConfig(enabled=enabled))

    def publish_claim_received(
        self,
        *,
        claim_reference: str,
        tenant_id: str,
        trace_id: Optional[str],
        source_channel: Optional[str],
        payload: dict[str, Any],
    ) -> bool:
        return self.publish(
            event_type="CLAIM_RECEIVED",
            claim_reference=claim_reference,
            tenant_id=tenant_id,
            trace_id=trace_id,
            source_channel=source_channel,
            payload=payload,
        )

    def publish_claim_completed(
        self,
        *,
        claim_reference: str,
        tenant_id: str,
        trace_id: Optional[str],
        source_channel: Optional[str],
        payload: dict[str, Any],
    ) -> bool:
        return self.publish(
            event_type="CLAIM_COMPLETED",
            claim_reference=claim_reference,
            tenant_id=tenant_id,
            trace_id=trace_id,
            source_channel=source_channel,
            payload=payload,
        )

    def publish_claim_failed(
        self,
        *,
        claim_reference: str,
        tenant_id: str,
        trace_id: Optional[str],
        source_channel: Optional[str],
        payload: dict[str, Any],
    ) -> bool:
        return self.publish(
            event_type="CLAIM_FAILED",
            claim_reference=claim_reference,
            tenant_id=tenant_id,
            trace_id=trace_id,
            source_channel=source_channel,
            payload=payload,
        )

    def publish(
        self,
        *,
        event_type: str,
        claim_reference: str,
        tenant_id: str,
        trace_id: Optional[str],
        source_channel: Optional[str],
        payload: dict[str, Any],
    ) -> bool:
        if not self.config.enabled:
            logger.debug("[SAGA] Producer disabled; skipped %s for %s", event_type, claim_reference)
            return False

        try:
            message = build_claim_saga_message(
                event_type=event_type,
                claim_reference=claim_reference,
                tenant_id=tenant_id,
                trace_id=trace_id,
                source_channel=source_channel,
                payload=payload,
            )
            self._memory_queue.append(message)
            logger.info("[SAGA] Enqueued %s for %s", event_type, claim_reference)
            return True
        except Exception as exc:
            logger.warning("[SAGA] Failed to enqueue %s for %s: %s", event_type, claim_reference, exc)
            return False

    def drain_memory_queue(self) -> list[dict[str, Any]]:
        messages = list(self._memory_queue)
        self._memory_queue.clear()
        return messages

