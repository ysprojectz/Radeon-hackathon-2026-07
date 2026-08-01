"""
Audit Service — Immutable append-only audit trail with SHA-256 hash chain.

Every step of the claims adjudication pipeline produces an audit event.
Events are stored in PostgreSQL (primary) with a hash chain for tamper detection.

Hash chain construction:
  entry_hash = SHA256(json(event_data) + previous_entry_hash)
  This means any tampered event invalidates all subsequent hashes.

Storage strategy:
  1. PostgreSQL audit_logs table (primary, queryable)
  2. In-memory list (returned in API response for real-time visibility)
  3. Future: S3 JSON Lines archive for long-term retention

The audit trail is the LEGAL EVIDENCE artifact.
The database role for the audit service has INSERT-only permission on audit_logs.
"""
from __future__ import annotations

import os
import json
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from services.api_gateway.app.reliability import sanitize_for_audit

logger = logging.getLogger(__name__)

ENABLE_DB_PERSISTENCE = os.getenv("ENABLE_DB_PERSISTENCE", "true").lower() == "true"
_SCHEMA_CACHE: dict[tuple[str, str], bool] = {}


# ─────────────────────────────────────────────────────────────────────────────
# VALID AUDIT EVENT TYPES
# ─────────────────────────────────────────────────────────────────────────────

AUDIT_EVENTS = {
    "PDF_UPLOADED",
    "DOCUMENT_VALIDATION_GATE",
    "CLAIM_RECEIVED",
    "CLAIM_STATUS_CHANGE",
    "SERVICE_DATE_AUTO_CORRECTED",
    "OCR_COMPLETED",
    "NLP_EXTRACTION_COMPLETED",
    "POLICY_RETRIEVED",
    "CLAUSES_IDENTIFIED",
    "CLAUSE_FILTERING_APPLIED",
    "POLICY_DEFAULT",
    "REASONING_COMPLETED",
    "REASONING_SKIPPED",
    "REASONING_ERROR",
    "POLICY_CITATIONS_FALLBACK",
    "RULES_EVALUATED",
    "RULES_ENGINE_FAILED",
    "SETTLEMENT_CALCULATED",
    "SETTLEMENT_CALCULATION_FAILED",
    "CONFIDENCE_SCORED",
    "COMPLETENESS_VALIDATED",
    "HITL_ROUTED",
    "HITL_DECISION_MADE",
    "SETTLEMENT_APPROVED",
    "SETTLEMENT_OVERRIDDEN",
    "REPORT_GENERATED",
    "NOTIFICATION_SENT",
    "APPEAL_RECEIVED",
    "ERROR_OCCURRED",
    "LLM_SKIPPED",
    "DUAL_AGENT_VALIDATION",
    "SECONDARY_VALIDATION_COMPLETED",
    "SECONDARY_VALIDATION_SKIPPED",
    "ANTHROPIC_VALIDATION_COMPLETED",
    "ANTHROPIC_VALIDATION_SKIPPED",
    "REGULATORY_VIOLATION_DETECTED",
    "PROVIDER_SWITCHED",
    "PROVIDER_NAME_ENRICHED",
    "POLICY_LIBRARY_MATCH",
    "MEMBER_UNVERIFIED",
    "PROVIDER_UNVERIFIED",
    "CALCULATION_AGENT_VERIFICATION",
    "DUPLICATE_CLAIM_DETECTED",
}

AI_AUDIT_EVENTS = {
    "REASONING_COMPLETED",
    "REASONING_SKIPPED",
    "REASONING_ERROR",
    "LLM_SKIPPED",
    "DUAL_AGENT_VALIDATION",
    "SECONDARY_VALIDATION_COMPLETED",
    "SECONDARY_VALIDATION_SKIPPED",
    "ANTHROPIC_VALIDATION_COMPLETED",
    "ANTHROPIC_VALIDATION_SKIPPED",
    "CONFIDENCE_SCORED",
    "PROVIDER_SWITCHED",
    "CALCULATION_AGENT_VERIFICATION",
}

BOT_AUDIT_EVENTS = {
    "OCR_COMPLETED",
    "NLP_EXTRACTION_COMPLETED",
    "RULES_EVALUATED",
    "SETTLEMENT_CALCULATED",
    "CLAUSES_IDENTIFIED",
    "POLICY_RETRIEVED",
}


def _normalize_actor_type(event_type: str, actor_type: str) -> str:
    actor = (actor_type or "SYSTEM").upper()
    if actor in {"HUMAN", "USER", "AI", "BOT", "SYSTEM"}:
        return "HUMAN" if actor == "USER" else actor
    if event_type in AI_AUDIT_EVENTS:
        return "AI"
    if event_type in BOT_AUDIT_EVENTS:
        return "BOT"
    return "SYSTEM"


# ─────────────────────────────────────────────────────────────────────────────
# AUDIT TRAIL BUILDER
# ─────────────────────────────────────────────────────────────────────────────

class AuditTrail:
    """
    Builds and persists the audit trail for a single claim adjudication.

    Usage:
        trail = AuditTrail(claim_reference="CLM-UAE-2024-ABCD1234")
        trail.add("CLAIM_RECEIVED", "Claim received for adjudication", {"source": "API"})
        trail.add("OCR_COMPLETED", "OCR extraction complete", {"confidence": 0.92})
        ...
        trail.flush_to_db(db_session)
        entries = trail.as_list()   # Returns list[dict] for API response
    """

    def __init__(
        self,
        claim_reference: str,
        service_name: str = "claim_pipeline",
        actor_type: str = "SYSTEM",
        actor_id: Optional[str] = None,
        market_region: str = "UNKNOWN",
        tenant_id: str = "default",
    ):
        self.claim_reference = claim_reference
        self.service_name = service_name
        self._default_actor_type = actor_type
        self._default_actor_id = actor_id
        self._market_region = market_region
        self._tenant_id = tenant_id
        self._entries: list[dict] = []
        self._last_hash: str = "0" * 64   # Genesis hash

    def add(
        self,
        event_type: str,
        description: str,
        event_data: Optional[dict] = None,
        actor_type: Optional[str] = None,
        actor_id: Optional[str] = None,
    ) -> dict:
        """
        Add an event to the audit trail.

        Args:
            event_type:   One of AUDIT_EVENTS
            description:  Human-readable description (no PHI)
            event_data:   Additional structured data (no PHI)
            actor_type:   "SYSTEM" or "HUMAN"
            actor_id:     User ID if actor_type is HUMAN

        Returns:
            The created audit entry dict
        """
        if event_type not in AUDIT_EVENTS:
            logger.warning("Unknown audit event type: %s", event_type)

        ts = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
        data = sanitize_for_audit(event_data or {})
        final_actor_type = actor_type or self._default_actor_type
        final_actor_id = actor_id if actor_id is not None else self._default_actor_id
        final_actor_type = _normalize_actor_type(event_type, final_actor_type)

        # Hash chain: hash(serialized_event + previous_hash)
        serialized = json.dumps({
            "event_type": event_type,
            "claim_reference": self.claim_reference,
            "timestamp": ts,
            "description": description,
            "event_data": data,
        }, sort_keys=True)
        entry_hash = hashlib.sha256(
            (serialized + self._last_hash).encode("utf-8")
        ).hexdigest()

        entry = {
            "event_type": event_type,
            "timestamp": ts,
            "claim_reference": self.claim_reference,
            "description": description,
            "actor_type": final_actor_type,
            "actor_id": final_actor_id,
            "service_name": self.service_name,
            "event_data": data,
            "previous_hash": self._last_hash,
            "entry_hash": entry_hash,
        }

        self._entries.append(entry)
        self._last_hash = entry_hash

        # ── Publish to Kafka event bus (non-blocking, fails silently) ──────────
        # Enables Graph RAG for ALL markets without changing pipeline logic.
        # Only fires when KAFKA_BOOTSTRAP_SERVERS is set in the environment.
        try:
            from shared.kafka_publisher import publish_claim_event
            publish_claim_event(
                claim_reference=self.claim_reference,
                event_type=event_type,
                market_region=getattr(self, "_market_region", "UNKNOWN"),
                data=event_data,
                tenant_id=getattr(self, "_tenant_id", "default"),
            )
        except Exception:
            pass  # Never let Kafka publishing affect the audit trail
        # ── End Kafka publish ──────────────────────────────────────────────────

        return entry

    def as_list(self) -> list[dict]:
        """Return all entries as a list of dicts (for API response)."""
        return list(self._entries)

    def verify_chain(self) -> bool:
        """Verify hash chain integrity. Returns True if chain is intact."""
        prev_hash = "0" * 64
        for entry in self._entries:
            expected_prev = entry.get("previous_hash", "")
            if expected_prev != prev_hash:
                logger.error(
                    "Hash chain broken at event %s — expected prev=%s, got=%s",
                    entry["event_type"], prev_hash[:8], expected_prev[:8]
                )
                return False
            # Recompute hash
            serialized = json.dumps({
                "event_type": entry["event_type"],
                "claim_reference": entry["claim_reference"],
                "timestamp": entry["timestamp"],
                "description": entry["description"],
                "event_data": entry["event_data"],
            }, sort_keys=True)
            computed = hashlib.sha256((serialized + prev_hash).encode("utf-8")).hexdigest()
            if computed != entry["entry_hash"]:
                logger.error(
                    "Hash mismatch at event %s — computed=%s, stored=%s",
                    entry["event_type"], computed[:8], entry["entry_hash"][:8]
                )
                return False
            prev_hash = entry["entry_hash"]
        return True

    def flush_to_db(self, db_session) -> bool:
        """
        Persist all audit entries to PostgreSQL.
        Uses INSERT only — no updates, no deletes.

        Args:
            db_session: SQLAlchemy sync Session

        Returns:
            True if all entries written successfully, False if DB unavailable
        """
        if not ENABLE_DB_PERSISTENCE:
            return True

        if db_session is None:
            logger.debug("No DB session provided — audit entries remain in memory only")
            return False

        try:
            from sqlalchemy import text

            for entry in self._entries:
                if entry.get("_persisted"):
                    continue  # Skip already-persisted entries

                db_session.execute(
                    text("""
                        INSERT INTO audit_logs
                            (claim_id, tenant_id, event_type, timestamp, actor_type, actor_id,
                             description, event_data, service_name, previous_hash, entry_hash)
                        SELECT
                            c.id,
                            c.tenant_id,
                            CAST(:event_type AS audit_event_type),
                            CAST(:timestamp AS timestamptz),
                            :actor_type,
                            :actor_id,
                            :description,
                            CAST(:event_data AS jsonb),
                            :service_name,
                            :previous_hash,
                            :entry_hash
                        FROM claims c
                        WHERE c.claim_reference = :claim_reference
                    """),
                    {
                        "claim_reference": self.claim_reference,
                        "event_type": entry["event_type"],
                        "timestamp": entry["timestamp"],
                        "actor_type": entry["actor_type"],
                        "actor_id": entry.get("actor_id"),
                        "description": entry["description"],
                        "event_data": json.dumps(entry.get("event_data", {})),
                        "service_name": entry["service_name"],
                        "previous_hash": entry["previous_hash"],
                        "entry_hash": entry["entry_hash"],
                    }
                )
                entry["_persisted"] = True

            db_session.commit()
            logger.debug("Audit trail flushed for %s (%d entries)", self.claim_reference, len(self._entries))
            return True

        except Exception as e:
            logger.error("Failed to persist audit trail for %s: %s", self.claim_reference, e)
            try:
                db_session.rollback()
            except Exception:
                pass
            return False


# ─────────────────────────────────────────────────────────────────────────────
# DATABASE PERSISTENCE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _build_ocr_extracted_data(claim_data: dict, ocr_telemetry: dict | None = None) -> dict | None:
    """
    Build a comprehensive dict of all OCR-extracted fields and metadata.

    This stores:
    1. Market-specific fields (contact, address, physician, pre-auth, etc.)
    2. OCR engine details (engine, page count, confidence, raw text length)
    3. File identity (filename, size, storage path, hash)
    4. Per-field extraction (value, confidence, source for core and account fields)
    5. Document validation gate signals (5-point validation)
    6. Line items count

    Returns None if no OCR data is present (e.g. JSON-submitted claims, not PDF upload).
    """
    data = {}

    # Market-specific extracted fields (GCC: contact, email, address, physician, pre-auth, etc.)
    # Store as flat keys so the UI's OCR panel can read them directly (mirrors pipeline._build_ocr_extracted_data)
    market_specific = claim_data.get("_ocr_market_specific") or {}
    if market_specific:
        data.update(market_specific)

    # Top-level OCR-extracted fields not stored in main DB columns
    for key in ("policy_number", "policy_name_hint"):
        v = claim_data.get(key)
        if v:
            data[key] = v

    # If full ocr_telemetry dict provided, extract and store comprehensive data
    if ocr_telemetry:
        # File identity
        file_info = {}
        for key in ("original_filename", "file_size_bytes", "document_hash", "storage_path"):
            v = ocr_telemetry.get(key)
            if v is not None:
                file_info[key] = v
        if file_info:
            data["file_identity"] = file_info

        # OCR engine details
        ocr_engine = {}
        for key in ("ocr_engine", "page_count", "overall_confidence", "raw_text_length", "low_confidence_fields"):
            v = ocr_telemetry.get(key)
            if v is not None:
                ocr_engine[key] = v
        if ocr_engine:
            data["ocr_engine"] = ocr_engine

        # Market detection
        market_detection = {}
        for key in ("market_detected", "market_detection_confidence", "market_requires_confirmation"):
            v = ocr_telemetry.get(key)
            if v is not None:
                market_detection[key] = v
        if market_detection:
            data["market_detection"] = market_detection

        # Per-field extraction (value, confidence, source for each field)
        field_extractions = ocr_telemetry.get("field_extractions")
        if field_extractions:
            data["field_extractions"] = field_extractions
            account_keys = (
                "bank_account_holder", "bank_name", "iban", "swift_bic",
                "account_number", "ifsc_code", "upi_vpa", "sort_code", "routing_number",
            )
            account_fields = {
                key: value
                for key, value in field_extractions.items()
                if key in account_keys and value and value.get("value") is not None
            }
            if account_fields:
                data["account_fields"] = account_fields

        # Document validation gate signals
        gate_signals = {}
        for key in ("doc_gate_result", "doc_gate_signals_passed", "doc_gate_signal_keyword",
                   "doc_gate_signal_financial", "doc_gate_signal_member", "doc_gate_signal_provider",
                   "doc_gate_signal_date"):
            v = ocr_telemetry.get(key)
            if v is not None:
                gate_signals[key] = v
        if gate_signals:
            data["document_validation_gate"] = gate_signals

        # Line items count
        line_items_count = ocr_telemetry.get("line_items_count")
        if line_items_count is not None:
            data["line_items_count"] = line_items_count
    else:
        # Fallback: extract limited metadata from claim_data if full telemetry not available
        ocr_meta = {}
        for key in (
            "_ocr_engine", "_ocr_document_hash", "_ocr_confidence",
            "_ocr_market_detection_conf", "_ocr_market_requires_confirm",
            "_ocr_low_confidence_fields",
        ):
            v = claim_data.get(key)
            if v is not None:
                ocr_meta[key] = v
        if ocr_meta:
            data["_ocr_metadata"] = ocr_meta

    return data if data else None


def persist_claim(db_session, claim_reference: str, claim_data: dict, result: dict, ocr_telemetry: dict | None = None) -> bool:
    """
    Insert or update a claim record in PostgreSQL.

    Args:
        db_session:       SQLAlchemy sync Session
        claim_reference:  Unique claim reference
        claim_data:       Original claim input dict
        result:           Full adjudication result dict
        ocr_telemetry:    Optional comprehensive OCR telemetry dict from upload endpoint
                          If provided, all OCR data (file identity, engine details, per-field confidence,
                          validation gate signals) is stored in ocr_extracted_data JSONB column

    Returns:
        True on success, False on failure
    """
    if not ENABLE_DB_PERSISTENCE or db_session is None:
        return False

    try:
        from sqlalchemy import text

        # Upsert claim record - pass ocr_telemetry for comprehensive OCR data capture
        _ocr_data = _build_ocr_extracted_data(claim_data, ocr_telemetry=ocr_telemetry)

        # Build AI analysis data structure from result
        _ai_analysis = None
        if (
            result.get("policy_citations")
            or result.get("ai_citations")
            or result.get("ai_flags")
            or result.get("pipeline_stage_report")
            or result.get("agent_status_metrics")
            or result.get("agent_line_comparisons")
            or result.get("validation_signals")
            or result.get("routing_decision")
        ):
            _ai_analysis = {
                "policy_citations": result.get("policy_citations", []),
                "ai_citations": result.get("ai_citations", []),
                "ai_flags": result.get("ai_flags", []),
                "regulatory_compliance": result.get("regulatory_compliance"),
                "regulatory_citations": result.get("regulatory_citations", []),
                "regulatory_violations": result.get("regulatory_violations", []),
                "agent_agreement_score": result.get("agent_agreement_score"),
                "agent_disagreement_items": result.get("agent_disagreement_items", []),
                "agent_line_comparisons": result.get("agent_line_comparisons", []),
                "policy_documents_used": result.get("policy_documents_used", []),
                "pipeline_stage_report": result.get("pipeline_stage_report", {}),
                "agent_status_metrics": result.get("agent_status_metrics", {}),
                "validation_signals": result.get("validation_signals", {}),
                "routing_decision": result.get("routing_decision", {}),
                "completeness": result.get("completeness"),
                "hitl_priority": result.get("hitl_priority"),
                "hitl_sla_hours": result.get("hitl_sla_hours"),
                "hitl_priority_reason": result.get("hitl_priority_reason"),
            }

        db_session.execute(
            text("""
                INSERT INTO claims (
                    claim_reference, status, claim_type, market_region, currency,
                    tenant_id, trace_id, idempotency_key,
                    member_number, patient_name, patient_dob,
                    provider_name, provider_code, network_tier,
                    service_date, admission_date, discharge_date,
                    primary_diagnosis_code, primary_diagnosis_desc,
                    total_billed, total_allowed, total_settlement, total_member_responsibility,
                    preauth_number, preauth_approved,
                    ai_analysis, confidence_score, processing_time_ms,
                    source_channel, ocr_confidence_score,
                    ocr_extracted_data,
                    raw_document_hash,
                    is_duplicate, duplicate_of_ref, duplicate_remarks,
                    date_adjudicated, date_settled
                ) VALUES (
                    :claim_reference, CAST(:status AS claim_status), CAST(:claim_type AS claim_type),
                    CAST(:market_region AS market_region), CAST(:currency AS currency),
                    :tenant_id, :trace_id, :idempotency_key,
                    :member_number, :patient_name, CAST(:patient_dob AS date),
                    :provider_name, :provider_code, CAST(:network_tier AS network_tier),
                    CAST(:service_date AS date), :admission_date, :discharge_date,
                    :primary_diagnosis_code, :primary_diagnosis_desc,
                    :total_billed, :total_allowed, :total_settlement, :total_member_resp,
                    :preauth_number, :preauth_approved,
                    CAST(:ai_analysis AS jsonb), :confidence_score, :processing_time_ms,
                    :source_channel, :ocr_confidence,
                    CAST(:ocr_extracted_data AS jsonb),
                    :raw_document_hash,
                    :is_duplicate, :duplicate_of_ref, :duplicate_remarks,
                    NOW(), :date_settled
                )
                ON CONFLICT (claim_reference) DO UPDATE SET
                    status = EXCLUDED.status,
                    total_allowed = EXCLUDED.total_allowed,
                    total_settlement = EXCLUDED.total_settlement,
                    total_member_responsibility = EXCLUDED.total_member_responsibility,
                    ai_analysis = COALESCE(EXCLUDED.ai_analysis, claims.ai_analysis),
                    confidence_score = EXCLUDED.confidence_score,
                    processing_time_ms = EXCLUDED.processing_time_ms,
                    tenant_id = EXCLUDED.tenant_id,
                    trace_id = COALESCE(EXCLUDED.trace_id, claims.trace_id),
                    idempotency_key = COALESCE(EXCLUDED.idempotency_key, claims.idempotency_key),
                    ocr_extracted_data = COALESCE(EXCLUDED.ocr_extracted_data, claims.ocr_extracted_data),
                    raw_document_hash = COALESCE(EXCLUDED.raw_document_hash, claims.raw_document_hash),
                    is_duplicate = EXCLUDED.is_duplicate,
                    duplicate_of_ref = EXCLUDED.duplicate_of_ref,
                    duplicate_remarks = COALESCE(EXCLUDED.duplicate_remarks, claims.duplicate_remarks),
                    date_adjudicated = NOW(),
                    date_settled = EXCLUDED.date_settled,
                    updated_at = NOW()
            """),
            {
                "claim_reference": claim_reference,
                "status": result.get("status", "RECEIVED"),
                "claim_type": claim_data.get("claim_type", "OUTPATIENT"),
                "market_region": claim_data.get("market_region", "UAE"),
                "currency": claim_data.get("currency", "AED"),
                "tenant_id": claim_data.get("tenant_id", "default"),
                "trace_id": claim_data.get("trace_id"),
                "idempotency_key": claim_data.get("idempotency_key"),
                "member_number": claim_data.get("member_number", ""),
                "patient_name": claim_data.get("patient_name", ""),
                "patient_dob": str(claim_data.get("patient_dob", "1990-01-01")),
                "provider_name": claim_data.get("provider_name", ""),
                "provider_code": claim_data.get("provider_code", ""),
                "network_tier": claim_data.get("network_tier", "NETWORK"),
                "service_date": str(claim_data.get("service_date", "")),
                "admission_date": str(claim_data.get("admission_date")) if claim_data.get("admission_date") else None,
                "discharge_date": str(claim_data.get("discharge_date")) if claim_data.get("discharge_date") else None,
                "primary_diagnosis_code": claim_data.get("primary_diagnosis_code", ""),
                "primary_diagnosis_desc": claim_data.get("primary_diagnosis_desc"),
                "total_billed": float(result.get("total_billed", 0)),
                "total_allowed": float(result.get("total_allowed", 0)),
                "total_settlement": float(result.get("total_settlement", 0)),
                "total_member_resp": float(result.get("total_member_responsibility", 0)),
                "preauth_number": claim_data.get("preauth_number"),
                "preauth_approved": claim_data.get("preauth_approved"),
                "ai_analysis": json.dumps(_ai_analysis) if _ai_analysis else None,
                "confidence_score": float(result.get("confidence_score", 0)),
                "processing_time_ms": result.get("processing_time_ms"),
                "source_channel": claim_data.get("source_channel", "API"),
                "ocr_confidence": float(claim_data.get("_ocr_confidence", 0)) or None,
                "ocr_extracted_data": json.dumps(_ocr_data) if _ocr_data else None,
                "raw_document_hash": claim_data.get("_ocr_document_hash") or claim_data.get("raw_document_hash"),
                "is_duplicate": bool(claim_data.get("is_duplicate", False)),
                "duplicate_of_ref": claim_data.get("duplicate_of_ref"),
                "duplicate_remarks": claim_data.get("duplicate_remarks"),
                "date_settled": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() if result.get("status") == "SETTLED" else None,
            }
        )
        # ── hitl_reviews row (only for HITL_PENDING claims) ──────────────────
        # Map legacy/free-form reasons to the DB hitl_trigger enum.
        _TRIGGER_MAP = {}
        hitl_status  = result.get("hitl_status")
        hitl_reason  = result.get("hitl_reason")
        _VALID_TRIGGERS = {
            "LOW_CONFIDENCE", "MEDIUM_CONFIDENCE", "HIGH_VALUE",
            "POLICY_AMBIGUITY", "FRAUD_RISK", "NEW_CODE",
            "APPEAL", "OCR_LOW_CONFIDENCE", "INCOMPLETE_PROCESSING",
            "AGENT_DISAGREEMENT", "AGENT_CONFLICT", "REGULATORY_VIOLATION",
        }
        if hitl_status == "HITL_PENDING" and hitl_reason:
            trigger = _TRIGGER_MAP.get(hitl_reason, hitl_reason)
            if trigger in _VALID_TRIGGERS:
                # default SLA: 24 h for policy/confidence issues, 48 h for high-value
                sla_hours = 24 if trigger in ("POLICY_AMBIGUITY", "LOW_CONFIDENCE") else 48
                sla_raw   = result.get("sla_deadline") or (
                    (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=sla_hours)).isoformat() + "Z"
                )
                ai_amount = float(result.get("total_settlement", 0) or 0)
                ai_conf   = float(result.get("confidence_score", 0) or 0)
                db_session.execute(
                    text("""
                        INSERT INTO hitl_reviews (
                            claim_id, tenant_id, trigger_reason, ai_settlement_amount,
                            ai_confidence, priority, sla_deadline
                        )
                        SELECT
                            c.id,
                            c.tenant_id,
                            CAST(:trigger AS hitl_trigger),
                            :ai_amount,
                            :ai_conf,
                            :priority,
                            CAST(:sla_deadline AS timestamptz)
                        FROM claims c
                        WHERE c.claim_reference = :claim_reference
                          AND NOT EXISTS (
                              SELECT 1 FROM hitl_reviews hr
                              WHERE hr.claim_id = c.id AND hr.status = 'PENDING'
                          )
                    """),
                    {
                        "claim_reference": claim_reference,
                        "trigger": trigger,
                        "ai_amount": ai_amount,
                        "ai_conf": ai_conf,
                        "priority": int(result.get("hitl_priority") or 5),
                        "sla_deadline": sla_raw,
                    },
                )

        db_session.commit()
        return True

    except Exception as e:
        logger.error("Failed to persist claim %s: %s", claim_reference, e)
        try:
            db_session.rollback()
        except Exception:
            pass
        return False


def persist_settlement(db_session, claim_reference: str, result: dict) -> bool:
    """
    Insert settlement record into PostgreSQL.

    Args:
        db_session:       SQLAlchemy sync Session
        claim_reference:  Unique claim reference
        result:           Full adjudication result dict with settlement sub-dict

    Returns:
        True on success, False on failure
    """
    if not ENABLE_DB_PERSISTENCE or db_session is None:
        return False

    try:
        from sqlalchemy import text

        settlement = result.get("settlement", {})
        db_session.execute(
            text("""
                INSERT INTO settlements (
                    claim_id, total_billed, total_allowed, total_deductible,
                    total_copay, total_coinsurance_member, total_plan_payment,
                    total_member_responsibility, total_vat, total_gst, total_tds,
                    net_payout, currency, confidence_score, tenant_id,
                    model_version, rules_engine_version, calculation_breakdown,
                    policy_citations, ai_citations
                )
                SELECT
                    c.id,
                    :total_billed, :total_allowed, :total_deductible,
                    :total_copay, :total_coinsurance_member, :total_plan_payment,
                    :total_member_resp, :total_vat, :total_gst, :total_tds,
                    :net_payout, CAST(:currency AS currency), :confidence_score, c.tenant_id,
                    :model_version, :rules_engine_version,
                    CAST(:calculation_breakdown AS jsonb), CAST(:policy_citations AS jsonb),
                    CAST(:ai_citations AS jsonb)
                FROM claims c
                WHERE c.claim_reference = :claim_reference
                ON CONFLICT (claim_id) DO UPDATE SET
                    total_billed = EXCLUDED.total_billed,
                    total_allowed = EXCLUDED.total_allowed,
                    total_deductible = EXCLUDED.total_deductible,
                    total_copay = EXCLUDED.total_copay,
                    total_coinsurance_member = EXCLUDED.total_coinsurance_member,
                    total_plan_payment = EXCLUDED.total_plan_payment,
                    total_member_responsibility = EXCLUDED.total_member_responsibility,
                    total_vat = EXCLUDED.total_vat,
                    total_gst = EXCLUDED.total_gst,
                    total_tds = EXCLUDED.total_tds,
                    net_payout = EXCLUDED.net_payout,
                    tenant_id = EXCLUDED.tenant_id,
                    confidence_score = EXCLUDED.confidence_score,
                    calculation_breakdown = EXCLUDED.calculation_breakdown,
                    policy_citations = EXCLUDED.policy_citations,
                    ai_citations = EXCLUDED.ai_citations
            """),
            {
                "claim_reference": claim_reference,
                "total_billed": float(result.get("total_billed", 0)),
                "total_allowed": float(result.get("total_allowed", 0)),
                "total_deductible": float(result.get("total_deductible", 0)),
                "total_copay": float(result.get("total_copay", 0)),
                "total_coinsurance_member": 0,
                "total_plan_payment": float(result.get("total_settlement", 0)),
                "total_member_resp": float(result.get("total_member_responsibility", 0)),
                "total_vat": float(settlement.get("total_vat", 0) or 0),
                "total_gst": float(settlement.get("total_gst", 0) or 0),
                "total_tds": float(settlement.get("total_tds", 0) or 0),
                "net_payout": float(settlement.get("net_payout", 0) or 0),
                "currency": result.get("currency", "AED"),
                "confidence_score": float(result.get("confidence_score", 0)),
                "model_version": settlement.get("model_version", "v1.0.0"),
                "rules_engine_version": settlement.get("rules_engine_version", "v1.0.0"),
                "calculation_breakdown": json.dumps(settlement.get("calculation_breakdown", {})),
                "policy_citations": json.dumps(result.get("policy_citations", [])),
                "ai_citations": json.dumps(result.get("ai_citations", [])),
            }
        )
        db_session.commit()
        return True

    except Exception as e:
        logger.error("Failed to persist settlement for %s: %s", claim_reference, e)
        try:
            db_session.rollback()
        except Exception:
            pass
        return False


def persist_hitl_decision(
    db_session,
    claim_reference: str,
    decision: str,
    justification: str,
    new_status: str,
    reviewer: str,
    override_amount: Optional[float] = None,
) -> bool:
    """Persist a HITL decision and append an audit entry in one transaction."""
    if not ENABLE_DB_PERSISTENCE or db_session is None:
        return False

    try:
        from sqlalchemy import text

        claim_row = db_session.execute(
            text("SELECT id, tenant_id FROM claims WHERE claim_reference = :claim_reference"),
            {"claim_reference": claim_reference},
        ).fetchone()
        if not claim_row:
            return False

        claim_id = claim_row[0]
        tenant_id = claim_row[1]

        db_session.execute(
            text("""
                UPDATE claims
                SET status = CAST(:new_status AS claim_status),
                    total_settlement = COALESCE(:override_amount, total_settlement),
                    date_settled = CASE
                        WHEN :new_status = 'SETTLED' THEN COALESCE(date_settled, NOW())
                        ELSE date_settled
                    END
                WHERE id = :claim_id
            """),
            {
                "claim_id": claim_id,
                "new_status": new_status,
                "override_amount": override_amount,
            },
        )

        updated = db_session.execute(
            text("""
                UPDATE hitl_reviews
                SET status = CASE
                        WHEN :decision = 'ESCALATE' THEN 'ESCALATED'::hitl_status
                        WHEN :decision = 'REQUEST_INFO' THEN 'PENDING'::hitl_status
                        ELSE 'COMPLETED'::hitl_status
                    END,
                    decision = CAST(:decision AS hitl_decision),
                    override_amount = :override_amount,
                    justification = :justification,
                    decided_at = NOW()
                WHERE claim_id = :claim_id
                  AND status IN ('PENDING', 'ASSIGNED', 'IN_REVIEW')
            """),
            {
                "claim_id": claim_id,
                "decision": decision,
                "override_amount": override_amount,
                "justification": justification,
            },
        ).rowcount

        if not updated:
            db_session.execute(
                text("""
                    INSERT INTO hitl_reviews (
                        claim_id, tenant_id, trigger_reason, ai_settlement_amount,
                        ai_confidence, decision, override_amount, justification,
                        decided_at, status, sla_deadline
                    )
                    SELECT
                        c.id,
                        c.tenant_id,
                        'POLICY_AMBIGUITY'::hitl_trigger,
                        COALESCE(c.total_settlement, 0),
                        COALESCE(c.confidence_score, 0),
                        CAST(:decision AS hitl_decision),
                        :override_amount,
                        :justification,
                        NOW(),
                        CASE
                            WHEN :decision = 'ESCALATE' THEN 'ESCALATED'::hitl_status
                            WHEN :decision = 'REQUEST_INFO' THEN 'PENDING'::hitl_status
                            ELSE 'COMPLETED'::hitl_status
                        END,
                        NOW()
                    FROM claims c
                    WHERE c.id = :claim_id
                """),
                {
                    "claim_id": claim_id,
                    "decision": decision,
                    "override_amount": override_amount,
                    "justification": justification,
                },
            )

        db_session.execute(
            text("""
                UPDATE settlements
                SET was_hitl_reviewed = TRUE,
                    hitl_override_amount = COALESCE(:override_amount, hitl_override_amount),
                    hitl_justification = :justification
                WHERE claim_id = :claim_id
            """),
            {
                "claim_id": claim_id,
                "override_amount": override_amount,
                "justification": justification,
            },
        )

        previous_hash = db_session.execute(
            text("""
                SELECT entry_hash
                FROM audit_logs
                ORDER BY timestamp DESC, id DESC
                LIMIT 1
            """)
        ).scalar() or ("0" * 64)
        timestamp = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
        event_data = sanitize_for_audit({
            "decision": decision,
            "new_status": new_status,
            "override_amount": override_amount,
        })
        description = f"HITL decision {decision} recorded for claim"
        serialized = json.dumps({
            "event_type": "HITL_DECISION_MADE",
            "claim_reference": claim_reference,
            "timestamp": timestamp,
            "description": description,
            "event_data": event_data,
            "actor_type": "HUMAN",
            "actor_id": reviewer,
        }, sort_keys=True)
        entry_hash = hashlib.sha256((serialized + previous_hash).encode("utf-8")).hexdigest()

        db_session.execute(
            text("""
                INSERT INTO audit_logs (
                    claim_id, tenant_id, event_type, timestamp, actor_type, actor_id,
                    description, event_data, service_name, previous_hash, entry_hash
                )
                VALUES (
                    :claim_id, :tenant_id, 'HITL_DECISION_MADE'::audit_event_type,
                    CAST(:timestamp AS timestamptz), 'HUMAN', :reviewer,
                    :description, CAST(:event_data AS jsonb), 'api-gateway',
                    :previous_hash, :entry_hash
                )
            """),
            {
                "claim_id": claim_id,
                "tenant_id": tenant_id,
                "timestamp": timestamp,
                "reviewer": reviewer,
                "description": description,
                "event_data": json.dumps(event_data),
                "previous_hash": previous_hash,
                "entry_hash": entry_hash,
            },
        )

        db_session.commit()
        return True
    except Exception as e:
        logger.error("Failed to persist HITL decision for %s: %s", claim_reference, e)
        try:
            db_session.rollback()
        except Exception:
            pass
        return False


def _column_exists(db_session, table_name: str, column_name: str) -> bool:
    """Cache schema probes so older DBs can be handled without repeated failures."""
    cache_key = (table_name, column_name)
    cached = _SCHEMA_CACHE.get(cache_key)
    if cached is not None:
        return cached

    from sqlalchemy import text

    exists = bool(
        db_session.execute(
            text("""
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = :table_name
                  AND column_name = :column_name
                LIMIT 1
            """),
            {
                "table_name": table_name,
                "column_name": column_name,
            },
        ).fetchone()
    )
    _SCHEMA_CACHE[cache_key] = exists
    return exists


def load_claims_from_db(db_session, filters: dict = None) -> list[dict]:
    """
    Load claims from PostgreSQL with optional filters.

    Args:
        db_session: SQLAlchemy sync Session
        filters:    Optional dict with keys: status, market_region

    Returns:
        List of claim dicts, or empty list if DB unavailable
    """
    if not ENABLE_DB_PERSISTENCE or db_session is None:
        return []

    try:
        from sqlalchemy import text

        where_clauses = ["1=1"]
        params = {}
        claims_has_tenant = _column_exists(db_session, "claims", "tenant_id")
        tenant_filter = (filters or {}).get("tenant_id")

        if tenant_filter and not claims_has_tenant and tenant_filter != "default":
            logger.warning(
                "Claims table has no tenant_id column; refusing tenant-scoped query for tenant=%s",
                tenant_filter,
            )
            return []

        if filters:
            if filters.get("status"):
                where_clauses.append("c.status = CAST(:status AS claim_status)")
                params["status"] = filters["status"]
            if filters.get("market_region"):
                where_clauses.append("c.market_region = CAST(:market_region AS market_region)")
                params["market_region"] = filters["market_region"]
            if tenant_filter and claims_has_tenant:
                where_clauses.append("c.tenant_id = :tenant_id")
                params["tenant_id"] = tenant_filter
            if filters.get("search"):
                # Multi-field search with ILIKE for case-insensitive partial matching
                where_clauses.append("""(
                    c.claim_reference ILIKE :search
                    OR c.patient_name ILIKE :search
                    OR CAST(c.claim_type AS TEXT) ILIKE :search
                    OR CAST(c.market_region AS TEXT) ILIKE :search
                )""")
                params["search"] = f"%{filters['search']}%"

        where = " AND ".join(where_clauses)
        tenant_select = "c.tenant_id" if claims_has_tenant else "CAST(:tenant_fallback AS VARCHAR) AS tenant_id"
        params["tenant_fallback"] = tenant_filter or "default"
        rows = db_session.execute(
            text(f"""
                SELECT
                    c.claim_reference, c.status, c.claim_type, c.market_region,
                    {tenant_select},
                    c.currency, c.member_number, c.patient_name,
                    c.provider_name, c.service_date,
                    c.primary_diagnosis_code, c.total_billed,
                    c.total_settlement, c.total_member_responsibility,
                    c.confidence_score, c.processing_time_ms,
                    c.ai_analysis,
                    c.date_received,
                    hr.trigger_reason AS hitl_reason,
                    hr.priority AS hitl_priority,
                    hr.sla_deadline
                FROM claims c
                LEFT JOIN hitl_reviews hr ON hr.claim_id = c.id
                    AND hr.status = 'PENDING'
                WHERE {where}
                ORDER BY c.date_received DESC
                LIMIT 200
            """),
            params
        ).fetchall()

        results = []
        for row in rows:
            d = dict(row._mapping)
            # Normalise hitl_reason / sla_deadline to the in-memory naming
            if d.get("hitl_reason"):
                d["hitl_status"] = "HITL_PENDING"
                d["hitl_priority"] = d.get("hitl_priority") or 5
            ai_payload = d.pop("ai_analysis", None)
            if ai_payload:
                if isinstance(ai_payload, str):
                    try:
                        ai_payload = json.loads(ai_payload)
                    except Exception:
                        ai_payload = {}
                if isinstance(ai_payload, dict):
                    for key in (
                        "pipeline_stage_report",
                        "agent_status_metrics",
                        "agent_agreement_score",
                        "agent_disagreement_items",
                        "agent_line_comparisons",
                        "validation_signals",
                        "routing_decision",
                        "completeness",
                        "hitl_priority",
                        "hitl_sla_hours",
                        "hitl_priority_reason",
                    ):
                        if key in ai_payload and d.get(key) is None:
                            d[key] = ai_payload[key]
            if d.get("sla_deadline"):
                sl = d["sla_deadline"]
                d["sla_deadline"] = sl.isoformat() if hasattr(sl, "isoformat") else str(sl)
            results.append(d)
        return results

    except Exception as e:
        logger.error("Failed to load claims from DB: %s", e)
        return []


def load_settlement_from_db(db_session, claim_reference: str) -> dict | None:
    """
    Load settlement breakdown for a specific claim from the settlements table.

    Returns a settlement dict (matching the in-memory structure) or None if not found.
    """
    if not ENABLE_DB_PERSISTENCE or db_session is None:
        return None

    try:
        from sqlalchemy import text

        row = db_session.execute(
            text("""
                SELECT
                    s.total_billed, s.total_allowed, s.total_deductible,
                    s.total_copay, s.total_coinsurance_member, s.total_plan_payment,
                    s.total_member_responsibility, s.total_vat, s.total_gst,
                    s.total_tds, s.net_payout, s.currency, s.confidence_score,
                    s.model_version, s.rules_engine_version,
                    s.calculation_breakdown, s.policy_citations, s.ai_citations,
                    c.claim_reference, c.claim_type, c.market_region
                FROM settlements s
                JOIN claims c ON c.id = s.claim_id
                WHERE c.claim_reference = :claim_reference
            """),
            {"claim_reference": claim_reference}
        ).fetchone()

        if not row:
            return None

        d = dict(row._mapping)
        return {
            "claim_reference": d["claim_reference"],
            "claim_type": d["claim_type"],
            "market_region": d["market_region"],
            "currency": d["currency"],
            "total_billed": float(d["total_billed"] or 0),
            "total_allowed": float(d["total_allowed"] or 0),
            "total_deductible": float(d["total_deductible"] or 0),
            "total_copay": float(d["total_copay"] or 0),
            "total_coinsurance_member": float(d["total_coinsurance_member"] or 0),
            "total_plan_payment": float(d["total_plan_payment"] or 0),
            "total_member_responsibility": float(d["total_member_responsibility"] or 0),
            "total_vat": float(d["total_vat"] or 0),
            "total_gst": float(d["total_gst"] or 0),
            "total_tds": float(d["total_tds"] or 0),
            "net_payout": float(d["net_payout"] or 0),
            "confidence_score": float(d["confidence_score"] or 0),
            "model_version": d["model_version"],
            "rules_engine_version": d["rules_engine_version"],
            "calculation_breakdown": d["calculation_breakdown"] or {},
            "policy_citations": d["policy_citations"] or [],
            "ai_citations": d["ai_citations"] or [],
        }

    except Exception as e:
        logger.error("Failed to load settlement for %s: %s", claim_reference, e)
        return None


def load_audit_trail_from_db(db_session, claim_reference: str) -> list[dict]:
    """
    Load the audit trail for a specific claim from audit_logs, ordered by timestamp.

    Returns a list of audit entry dicts (matching the in-memory structure).
    """
    if not ENABLE_DB_PERSISTENCE or db_session is None:
        return []

    try:
        from sqlalchemy import text

        rows = db_session.execute(
            text("""
                SELECT
                    al.event_type,
                    al.timestamp,
                    al.actor_type,
                    al.actor_id,
                    al.description,
                    al.event_data,
                    al.service_name,
                    al.previous_hash,
                    al.entry_hash
                FROM audit_logs al
                JOIN claims c ON c.id = al.claim_id
                WHERE c.claim_reference = :claim_reference
                ORDER BY al.timestamp ASC
            """),
            {"claim_reference": claim_reference}
        ).fetchall()

        import datetime as _dt

        def _normalise_ts(ts) -> str:
            """Reconstruct the exact timestamp string used when the hash was created.

            record_event() stores: datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
            e.g. "2026-02-24T01:48:43.098611Z"

            PostgreSQL TIMESTAMPTZ → SQLAlchemy datetime → str() gives
            "2026-02-24 01:48:43.098611+00:00" (space, +00:00) which breaks
            hash recomputation.  We convert back to the canonical form.
            """
            if isinstance(ts, _dt.datetime):
                ts_utc = ts.astimezone(_dt.timezone.utc).replace(tzinfo=None)
                return ts_utc.isoformat() + "Z"
            # Already a string — pass through unchanged
            return str(ts)

        entries = []
        for row in rows:
            d = dict(row._mapping)
            entries.append({
                "event_type": d["event_type"],
                "timestamp": _normalise_ts(d["timestamp"]),
                "claim_reference": claim_reference,
                "description": d["description"],
                "actor_type": d["actor_type"],
                "actor_id": d.get("actor_id"),
                "service_name": d["service_name"],
                "event_data": d["event_data"] or {},
                "previous_hash": d["previous_hash"] or ("0" * 64),
                "entry_hash": d["entry_hash"],
            })
        return entries

    except Exception as e:
        logger.error("Failed to load audit trail for %s: %s", claim_reference, e)
        return []
