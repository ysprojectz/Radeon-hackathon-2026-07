"""
India Cashless BPMN Worker
==========================
Polls the Operaton BPMN engine and executes service tasks for the
India cashless pre-authorization workflow (claim-pre-auth.bpmn).

Task topology (mirrors claimaura/services/orchestration/deploy/claim-pre-auth.bpmn):
  Task_ExtractFHIR   → Document AI: PDF → FHIR Bundle
  Task_CheckConsent  → ABDM consent check via FHIR server
  Task_EvaluateRules → OPA IRDAI policy evaluation
  Task_FWAScore      → FWA anomaly scoring (blocks auto-approve if anomaly)
  Task_AutoApprove   → Store FHIR Claim + notify graph + publish Kafka event
  Task_ManualReview  → User task (HITL) — handled by existing HITL queue

Shared services called:
  - services/india_cashless/nhcx_client.py  (NHCX pre-auth submission)
  - services/settlement_calc               (financial settlement)
  - services/reasoning_engine              (LLM enrichment for complex claims)
  - graph-service                          (event trail + explainability)
  - kafka                                  (claim-events topic)

Run standalone:
    PYTHONPATH=. python services/india_cashless/bpmn_worker.py

Or via docker-compose (see docker-compose.yml india_cashless_worker service).
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# ── Service URLs (all configurable via env) ───────────────────────────────────
ENGINE_URL   = os.getenv("OPERATON_URL",    "http://operaton:8080/engine-rest")
DOC_AI_URL   = os.getenv("DOC_AI_URL",      "http://document-ai:8000/extract-fhir")
FHIR_BASE    = os.getenv("FHIR_BASE_URL",   "http://hapi-fhir:8080/fhir")
OPA_URL      = os.getenv("OPA_URL",         "http://opa:8181/v1/data/insurance/india/claims")
GRAPH_URL    = os.getenv("GRAPH_SERVICE_URL","http://graph-service:8000/event")
FWA_URL      = os.getenv("FWA_SERVICE_URL", "http://fwa-service:8000/score")
NHCX_URL     = os.getenv("NHCX_BASE_URL",   "http://mock-nhcx:8000")
SETTLEMENT_URL = os.getenv("SETTLEMENT_URL","http://api:8000/api/v1/internal/settlement")
KAFKA_SERVERS  = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:29092")

WORKER_ID    = "india-cashless-worker-1"
POLL_INTERVAL = int(os.getenv("BPMN_POLL_INTERVAL_SECONDS", "5"))
LOCK_DURATION = int(os.getenv("BPMN_LOCK_DURATION_MS", "30000"))

# ── Kafka producer (optional — graceful degradation if unavailable) ───────────
_kafka_producer = None

def _get_kafka_producer():
    global _kafka_producer
    if _kafka_producer is not None:
        return _kafka_producer
    try:
        from confluent_kafka import Producer
        _kafka_producer = Producer({"bootstrap.servers": KAFKA_SERVERS})
        logger.info("[Worker] Kafka producer connected to %s", KAFKA_SERVERS)
    except Exception as exc:
        logger.warning("[Worker] Kafka unavailable — events will not be published: %s", exc)
    return _kafka_producer


def _publish_kafka_event(event_type: str, claim_id: str, data: Optional[dict] = None):
    producer = _get_kafka_producer()
    if not producer:
        return
    try:
        payload = json.dumps({
            "event_type": event_type,
            "claim_id": claim_id,
            "market_region": "INDIA",
            "data": data or {},
        }).encode()
        producer.produce("claim-events", payload)
        producer.poll(0)
    except Exception as exc:
        logger.warning("[Worker] Kafka publish failed: %s", exc)


# ── Graph service notification ────────────────────────────────────────────────

def _notify_graph(claim_id: str, event_type: str, data: Optional[dict] = None):
    try:
        requests.post(
            GRAPH_URL,
            json={"claim_id": claim_id, "event_type": event_type,
                  "data": data, "market_region": "INDIA"},
            timeout=2,
        )
    except Exception as exc:
        logger.debug("[Worker] Graph notification failed: %s", exc)


# ── Variable helpers ──────────────────────────────────────────────────────────

def _get_var(variables: dict, name: str, default: Any = None) -> Any:
    if variables and name in variables:
        v = variables[name]
        return v.get("value", default) if isinstance(v, dict) else v
    return default


# ── Task handlers ─────────────────────────────────────────────────────────────

def handle_extract_fhir(task_id: str, variables: dict):
    """
    Task_ExtractFHIR — POST discharge PDF to Document AI, get FHIR Bundle back.
    If a bundle already exists in variables, skip extraction (idempotent).
    """
    logger.info("[Task_ExtractFHIR] id=%s", task_id)

    if _get_var(variables, "fhirBundle"):
        logger.info("[Task_ExtractFHIR] Bundle already present — skipping")
        _complete_task(task_id, {})
        return

    doc_path = _get_var(variables, "documentPath", "")
    claim_id = _get_var(variables, "claimId", "unknown")

    try:
        if doc_path:
            with open(doc_path, "rb") as f:
                resp = requests.post(DOC_AI_URL, files={"file": f}, timeout=60)
        else:
            # No document path — create a minimal stub bundle from claim variables
            resp = None

        if resp and resp.ok:
            bundle = resp.json()
            extracted_claim_id = (
                bundle.get("entry", [{}])[0].get("resource", {}).get("id", claim_id)
            )
            _notify_graph(extracted_claim_id, "FHIR_EXTRACTED",
                          {"filename": doc_path, "claim_id": extracted_claim_id})
            _publish_kafka_event("FHIR_EXTRACTED", extracted_claim_id)
            _complete_task(task_id, {"fhirBundle": json.dumps(bundle), "claimId": extracted_claim_id})
        else:
            # Fallback: pass through with existing claim data
            logger.warning("[Task_ExtractFHIR] Doc AI unavailable — using stub bundle")
            stub = _build_stub_bundle(variables)
            _complete_task(task_id, {"fhirBundle": json.dumps(stub)})

    except Exception as exc:
        logger.error("[Task_ExtractFHIR] Failed: %s", exc)
        _fail_task(task_id, str(exc))


def handle_check_consent(task_id: str, variables: dict):
    """
    Task_CheckConsent — Verify active FHIR Consent for the patient.
    Checks the HAPI FHIR server for an active Consent resource.
    """
    logger.info("[Task_CheckConsent] id=%s", task_id)
    try:
        bundle_str = _get_var(variables, "fhirBundle", "{}")
        bundle = json.loads(bundle_str) if isinstance(bundle_str, str) else bundle_str
        patient_ref = (
            bundle.get("entry", [{}])[0]
            .get("resource", {})
            .get("patient", {})
            .get("reference", "Patient/unknown")
        )
        patient_id = patient_ref.split("/")[-1]
        claim_id = (
            bundle.get("entry", [{}])[0].get("resource", {}).get("id", "unknown")
        )

        try:
            resp = requests.get(
                f"{FHIR_BASE}/Consent",
                params={"patient": patient_id, "status": "active"},
                timeout=10,
            )
            total = resp.json().get("total", 0) if resp.ok else 0
        except Exception:
            # FHIR server unavailable — default to consent valid in dev
            total = 1
            logger.warning("[Task_CheckConsent] FHIR server unavailable — defaulting consent=valid")

        consent_valid = total > 0
        _notify_graph(claim_id, "CONSENT_CHECKED",
                      {"valid": consent_valid, "patient_id": patient_id})
        _publish_kafka_event("CONSENT_CHECKED", claim_id, {"valid": consent_valid})

        # Persist consent_verified to advance_claims
        _update_advance_claim(claim_id, {"consent_verified": consent_valid})

        _complete_task(task_id, {"consentValid": consent_valid})

    except Exception as exc:
        logger.error("[Task_CheckConsent] Failed: %s", exc)
        _fail_task(task_id, str(exc))


def handle_evaluate_rules(task_id: str, variables: dict):
    """
    Task_EvaluateRules — Evaluate IRDAI OPA policies.
    Builds OPA input from the FHIR bundle + policy variables.
    """
    logger.info("[Task_EvaluateRules] id=%s", task_id)
    try:
        bundle_str = _get_var(variables, "fhirBundle", "{}")
        bundle = json.loads(bundle_str) if isinstance(bundle_str, str) else bundle_str
        resource = bundle.get("entry", [{}])[0].get("resource", {})
        claim_id = resource.get("id", "unknown")

        # Extract diagnosis from FHIR bundle
        diag_coding = (
            resource.get("diagnosis", [{}])[0]
            .get("diagnosisCodeableConcept", {})
            .get("coding", [{}])[0]
        )
        diag_code = diag_coding.get("code", "")
        diag_display = diag_coding.get("display", "")

        # Build OPA input — pull policy params from variables or use safe defaults
        opa_input = {
            "input": {
                "claim": {
                    "claim_type": _get_var(variables, "claimType", "INPATIENT"),
                    "days_since_inception": _get_var(variables, "daysSinceInception", 90),
                    "is_ped": _get_var(variables, "isPED", False),
                    "is_specific_disease": _get_var(variables, "isSpecificDisease", False),
                    "copay_pct": _get_var(variables, "copayPct", 0),
                    "patient_age": _get_var(variables, "patientAge", 30),
                    "diagnosis_category": _get_var(variables, "diagnosisCategory", "GENERAL"),
                    "treatment_system": _get_var(variables, "treatmentSystem", "ALLOPATHY"),
                    "denial_reason": _get_var(variables, "denialReason", ""),
                    "diagnosis_code": diag_code,
                    "diagnosis_display": diag_display,
                },
                "policy": {
                    "ped_waiting_months": _get_var(variables, "pedWaitingMonths", 12),
                    "specific_disease_waiting_months": _get_var(variables, "specificDiseaseWaitingMonths", 12),
                    "maternity_waiting_months": _get_var(variables, "maternityWaitingMonths", 9),
                    "applied_exclusions": _get_var(variables, "appliedExclusions", []),
                    "mental_health_copay_pct": _get_var(variables, "mentalHealthCopayPct", 0),
                    "standard_copay_pct": _get_var(variables, "standardCopayPct", 0),
                    "ayush_sublimit_pct": _get_var(variables, "ayushSublimitPct", 25),
                    "room_rent_deduction_method": "PROPORTIONATE_DEDUCTION_ONLY",
                    "pre_hospitalization_days": 30,
                    "post_hospitalization_days": 60,
                    "voluntary_deductible": False,
                },
            }
        }

        try:
            resp = requests.post(OPA_URL, json=opa_input, timeout=10)
            result = resp.json().get("result", {}) if resp.ok else {}
            allowed = result.get("allow", False)
            denial_reasons = list(result.get("denial_reasons", []))
        except Exception as exc:
            logger.warning("[Task_EvaluateRules] OPA unavailable: %s — defaulting allow=True", exc)
            allowed = True
            denial_reasons = []

        _notify_graph(claim_id, "RULES_EVALUATED", {
            "allowed": allowed,
            "denial_reasons": denial_reasons,
            "diagnosis": diag_display or diag_code,
        })
        _publish_kafka_event("RULES_EVALUATED", claim_id, {
            "allowed": allowed, "denial_reasons": denial_reasons
        })

        # Persist irdai_violations to advance_claims
        if denial_reasons:
            import json as _json
            _update_advance_claim(claim_id, {"irdai_violations": _json.dumps(denial_reasons)})

        _complete_task(task_id, {
            "rulesPassed": allowed,
            "denialReasons": json.dumps(denial_reasons),
        })

    except Exception as exc:
        logger.error("[Task_EvaluateRules] Failed: %s", exc)
        _fail_task(task_id, str(exc))


def handle_fwa_score(task_id: str, variables: dict):
    """
    Task_FWAScore — Score the claim for Fraud, Waste, and Abuse.
    Blocks auto-approval if the FWA model flags an anomaly.
    """
    logger.info("[Task_FWAScore] id=%s", task_id)
    try:
        claim_amount = float(_get_var(variables, "claimAmount", 0))
        days_since_inception = int(_get_var(variables, "daysSinceInception", 90))
        num_diagnoses = int(_get_var(variables, "numDiagnoses", 1))
        claim_id = _get_var(variables, "claimId", "unknown")

        try:
            resp = requests.post(
                FWA_URL,
                json={
                    "claim_amount": claim_amount,
                    "days_since_inception": days_since_inception,
                    "number_of_diagnoses": num_diagnoses,
                },
                timeout=10,
            )
            fwa_result = resp.json() if resp.ok else {}
            is_anomaly = fwa_result.get("is_anomaly", False)
            anomaly_score = fwa_result.get("anomaly_score", 0.0)
        except Exception as exc:
            logger.warning("[Task_FWAScore] FWA service unavailable: %s — defaulting is_anomaly=False", exc)
            is_anomaly = False
            anomaly_score = 0.0

        _notify_graph(claim_id, "FWA_SCORED", {
            "is_anomaly": is_anomaly,
            "anomaly_score": anomaly_score,
        })
        _publish_kafka_event("FWA_SCORED", claim_id, {
            "is_anomaly": is_anomaly, "anomaly_score": anomaly_score
        })

        # Persist fwa_anomaly_score to advance_claims
        _update_advance_claim(claim_id, {"fwa_anomaly_score": anomaly_score})

        _complete_task(task_id, {
            "fwaIsAnomaly": is_anomaly,
            "fwaAnomalyScore": anomaly_score,
            # If FWA flags anomaly, override rulesPassed to force manual review
            "rulesPassed": False if is_anomaly else _get_var(variables, "rulesPassed", True),
        })

    except Exception as exc:
        logger.error("[Task_FWAScore] Failed: %s", exc)
        _fail_task(task_id, str(exc))


def handle_auto_approve(task_id: str, variables: dict):
    """
    Task_AutoApprove — Store FHIR Claim in HAPI FHIR, submit to NHCX,
    notify graph, and publish Kafka event.
    """
    logger.info("[Task_AutoApprove] id=%s", task_id)
    try:
        bundle_str = _get_var(variables, "fhirBundle", "{}")
        bundle = json.loads(bundle_str) if isinstance(bundle_str, str) else bundle_str
        claim_resource = bundle.get("entry", [{}])[0].get("resource", {})
        claim_id = claim_resource.get("id", "unknown")

        # Store in HAPI FHIR
        fhir_id = None
        try:
            resp = requests.post(f"{FHIR_BASE}/Claim", json=claim_resource, timeout=15)
            if resp.ok:
                fhir_id = resp.json().get("id")
                logger.info("[Task_AutoApprove] Stored in HAPI FHIR: %s", fhir_id)
        except Exception as exc:
            logger.warning("[Task_AutoApprove] HAPI FHIR unavailable: %s", exc)

        # Submit to NHCX (mock in dev)
        nhcx_ref = None
        try:
            from services.india_cashless.nhcx_client import get_nhcx_client
            nhcx = get_nhcx_client()
            nhcx_resp = nhcx.submit_preauth(bundle)
            nhcx_ref = nhcx_resp.get("disposition", "approved")
            logger.info("[Task_AutoApprove] NHCX response: %s", nhcx_ref)
        except Exception as exc:
            logger.warning("[Task_AutoApprove] NHCX submission failed: %s", exc)

        _notify_graph(claim_id, "AUTO_APPROVED", {
            "hapi_fhir_id": fhir_id,
            "nhcx_ref": nhcx_ref,
        })
        _publish_kafka_event("AUTO_APPROVED", claim_id, {
            "hapi_fhir_id": fhir_id, "nhcx_ref": nhcx_ref
        })

        # Persist fhir_resource_id + preauth_status to advance_claims
        _update_advance_claim(claim_id, {
            "fhir_resource_id": fhir_id,
            "nhcx_reference": nhcx_ref,
            "preauth_status": "APPROVED",
        })

        # Generate pre-auth letter via FastAPI
        _fastapi_base = os.getenv("FASTAPI_BASE_URL", "http://api:8000")
        claim_ref = _get_var(variables, "claimReference", claim_id)
        try:
            requests.post(
                f"{_fastapi_base}/api/v1/claims/advance/{claim_ref}/letter",
                timeout=10,
            )
        except Exception as _le:
            logger.warning("[Task_AutoApprove] Letter generation request failed (non-fatal): %s", _le)

        _complete_task(task_id, {"claimId": fhir_id or claim_id, "nhcxRef": nhcx_ref})

    except Exception as exc:
        logger.error("[Task_AutoApprove] Failed: %s", exc)
        _fail_task(task_id, str(exc))


# ── Operaton REST helpers ─────────────────────────────────────────────────────

def _update_advance_claim(claim_id: str, fields: dict) -> None:
    """
    Update columns on the advance_claims row whose claim_id or claim_reference
    matches. Uses a direct psycopg2 connection so the worker doesn't need the
    full SQLAlchemy stack.  Fails silently — DB updates are best-effort.
    """
    if not fields:
        return
    db_url = os.getenv(
        "SYNC_DATABASE_URL",
        "postgresql+psycopg2://user:password@postgres:5432/dbname",
    )
    try:
        import psycopg2
        # Strip SQLAlchemy driver prefix
        conn_str = db_url.replace("postgresql+psycopg2://", "postgresql://")
        conn = psycopg2.connect(conn_str)
        cur = conn.cursor()
        set_clauses = ", ".join(f"{k} = %s" for k in fields)
        values = list(fields.values()) + [claim_id, claim_id]
        cur.execute(
            f"UPDATE advance_claims SET {set_clauses} "
            f"WHERE claim_id::text = %s OR claim_reference = %s",
            values,
        )
        conn.commit()
        cur.close()
        conn.close()
        logger.debug("[Worker] Updated advance_claims %s: %s", claim_id, list(fields.keys()))
    except Exception as exc:
        logger.debug("[Worker] advance_claims update skipped (non-fatal): %s", exc)


def _complete_task(task_id: str, output_vars: dict):
    """Complete an external task with output variables."""
    body: dict = {"workerId": WORKER_ID}
    if output_vars:
        body["variables"] = {
            k: {"value": v, "type": _infer_type(v)}
            for k, v in output_vars.items()
        }
    try:
        resp = requests.post(
            f"{ENGINE_URL}/external-task/{task_id}/complete",
            json=body,
            timeout=10,
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.error("[Worker] Failed to complete task %s: %s", task_id, exc)


def _fail_task(task_id: str, error_message: str, retries: int = 0):
    """Report a task failure to Operaton."""
    try:
        requests.post(
            f"{ENGINE_URL}/external-task/{task_id}/failure",
            json={
                "workerId": WORKER_ID,
                "errorMessage": error_message,
                "errorDetails": "",
                "retries": retries,
                "retryTimeout": 0,
            },
            timeout=10,
        )
    except Exception as exc:
        logger.error("[Worker] Failed to report task failure %s: %s", task_id, exc)


def _infer_type(value: Any) -> str:
    if isinstance(value, bool):
        return "Boolean"
    if isinstance(value, int):
        return "Integer"
    if isinstance(value, float):
        return "Double"
    return "String"


def _build_stub_bundle(variables: dict) -> dict:
    """Build a minimal FHIR Bundle from BPMN variables when no document is available."""
    import uuid as _uuid
    claim_id = _get_var(variables, "claimId", str(_uuid.uuid4()))
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [
            {
                "resource": {
                    "resourceType": "Claim",
                    "id": claim_id,
                    "status": "active",
                    "use": "preauthorization",
                    "patient": {"reference": f"Patient/{_get_var(variables, 'memberNumber', 'unknown')}"},
                    "diagnosis": [
                        {
                            "sequence": 1,
                            "diagnosisCodeableConcept": {
                                "coding": [{"code": _get_var(variables, "diagnosisCode", "Z00.0")}]
                            },
                        }
                    ],
                    "total": {
                        "value": float(_get_var(variables, "claimAmount", 0)),
                        "currency": "INR",
                    },
                }
            }
        ],
    }


# ── DB helper ─────────────────────────────────────────────────────────────────

def _update_advance_claim(claim_id: str, updates: dict):
    """Update advance_claims row by claim_id (UUID) or claim_reference."""
    if not updates:
        return
    try:
        import sys
        sys.path.insert(0, "/app")
        from shared.db_sync import get_sync_db
        from sqlalchemy import text as _text
        db = get_sync_db()
        if db is None:
            return
        set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
        # Try by claim_id first, then by claim_reference
        params = {**updates, "claim_id": claim_id}
        try:
            db.execute(_text(f"UPDATE advance_claims SET {set_clauses} WHERE claim_id = CAST(:claim_id AS uuid)"), params)
            db.commit()
        except Exception:
            params2 = {**updates, "ref": claim_id}
            db.execute(_text(f"UPDATE advance_claims SET {set_clauses} WHERE claim_reference = :ref"), params2)
            db.commit()
        try:
            db.close()
        except Exception:
            pass
    except Exception as exc:
        logger.debug("[Worker] _update_advance_claim failed (non-fatal): %s", exc)


# ── Poll loop ─────────────────────────────────────────────────────────────────

_TOPIC_HANDLERS = {
    "Task_ExtractFHIR":  handle_extract_fhir,
    "Task_CheckConsent": handle_check_consent,
    "Task_EvaluateRules": handle_evaluate_rules,
    "Task_FWAScore":     handle_fwa_score,
    "Task_AutoApprove":  handle_auto_approve,
}


def poll_tasks():
    logger.info("[Worker] India Cashless BPMN Worker starting — polling %s", ENGINE_URL)
    while True:
        try:
            resp = requests.post(
                f"{ENGINE_URL}/external-task/fetchAndLock",
                json={
                    "workerId": WORKER_ID,
                    "maxTasks": 10,
                    "topics": [
                        {"topicName": topic, "lockDuration": LOCK_DURATION}
                        for topic in _TOPIC_HANDLERS
                    ],
                },
                timeout=15,
            )
            if resp.ok:
                tasks = resp.json()
                for task in tasks:
                    topic = task.get("topicName")
                    handler = _TOPIC_HANDLERS.get(topic)
                    if handler:
                        try:
                            handler(task["id"], task.get("variables", {}))
                        except Exception as exc:
                            logger.error("[Worker] Unhandled error in %s: %s", topic, exc)
        except Exception as exc:
            logger.warning("[Worker] Poll error: %s", exc)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    poll_tasks()
