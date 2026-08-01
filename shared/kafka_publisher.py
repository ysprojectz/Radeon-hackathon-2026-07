"""
Market-agnostic Kafka event publisher.

Publishes ACOS audit events to the shared `claim-events` Kafka topic so the
Graph Service can build a DiGraph for ALL markets (UAE, KSA, India, etc.).

Design principles:
- Fails silently — never blocks or raises inside the adjudication pipeline.
- Activated by setting KAFKA_BOOTSTRAP_SERVERS in the environment.
- If Kafka is unavailable the pipeline continues exactly as before.
- Thread-safe: a single producer instance is reused across all calls.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_producer = None
_producer_failed = False  # once init fails, stop retrying on every call


def _get_producer():
    """Lazy-init Kafka producer. Returns None if Kafka is not configured."""
    global _producer, _producer_failed
    if _producer is not None:
        return _producer
    if _producer_failed:
        return None

    kafka_url = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "").strip()
    if not kafka_url:
        return None  # Not configured — silent skip

    try:
        from confluent_kafka import Producer  # type: ignore
        _producer = Producer({
            "bootstrap.servers": kafka_url,
            "socket.timeout.ms": 3000,
            "message.timeout.ms": 5000,
        })
        logger.info("[KafkaPublisher] Connected to %s", kafka_url)
        return _producer
    except ImportError:
        logger.debug("[KafkaPublisher] confluent_kafka not installed — events will not be published")
        _producer_failed = True
        return None
    except Exception as exc:
        logger.debug("[KafkaPublisher] Init failed: %s", exc)
        _producer_failed = True
        return None


# Canonical mapping from ACOS audit event types → claim-events schema
_EVENT_TYPE_MAP: dict[str, str] = {
    "CLAIM_RECEIVED":               "CLAIM_RECEIVED",
    "OCR_COMPLETED":                "DOCUMENT_PROCESSED",
    "NLP_EXTRACTION_COMPLETED":     "DOCUMENT_PROCESSED",
    "RULES_EVALUATED":              "RULES_EVALUATED",
    "REASONING_COMPLETED":          "LLM_ANALYZED",
    "SETTLEMENT_CALCULATED":        "SETTLEMENT_CALCULATED",
    "HITL_ROUTED":                  "HITL_ROUTED",
    "HITL_DECISION_MADE":           "HITL_DECIDED",
    "DUPLICATE_CLAIM_DETECTED":     "DUPLICATE_DETECTED",
    "REGULATORY_VIOLATION_DETECTED":"REGULATORY_VIOLATION",
    "CONFIDENCE_SCORED":            "CONFIDENCE_SCORED",
    "DUAL_AGENT_VALIDATION":        "DUAL_AGENT_VALIDATED",
    "SETTLEMENT_APPROVED":          "SETTLEMENT_APPROVED",
    "SETTLEMENT_OVERRIDDEN":        "SETTLEMENT_OVERRIDDEN",
}


def publish_claim_event(
    claim_reference: str,
    event_type: str,
    market_region: str,
    data: Optional[dict] = None,
    tenant_id: str = "default",
) -> None:
    """
    Publish a claim lifecycle event to the shared Kafka `claim-events` topic.

    Called from AuditTrail.add() after every pipeline stage — works for ALL
    markets. If Kafka is not configured or unavailable, this is a no-op.

    Args:
        claim_reference: Unique claim reference (used as Kafka message key)
        event_type:      ACOS audit event type (mapped to canonical schema)
        market_region:   UAE, KSA, INDIA, BAHRAIN, OMAN, QATAR, KUWAIT
        data:            Optional event payload dict (PII already sanitized by caller)
        tenant_id:       Tenant identifier for multi-tenant isolation
    """
    producer = _get_producer()
    if not producer:
        return

    canonical_type = _EVENT_TYPE_MAP.get(event_type, event_type)

    event = {
        "claim_id":      claim_reference,
        "event_type":    canonical_type,
        "market_region": market_region,
        "tenant_id":     tenant_id,
        "timestamp":     datetime.now(timezone.utc).isoformat(),
        "source":        "acos-pipeline",
        "data":          data or {},
    }

    try:
        producer.produce(
            topic="claim-events",
            key=claim_reference.encode("utf-8"),
            value=json.dumps(event, default=str).encode("utf-8"),
        )
        producer.poll(0)  # non-blocking flush — fire and forget
    except Exception as exc:
        # Never raise — the pipeline must not fail because of Kafka
        logger.debug(
            "[KafkaPublisher] Failed to publish %s for %s: %s",
            event_type, claim_reference, exc,
        )
