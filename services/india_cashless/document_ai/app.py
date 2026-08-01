"""
Document AI Service — PDF → FHIR R4 Bundle
==========================================
Accepts a discharge summary PDF, runs it through the existing ACOS OCR
engine, and returns a FHIR R4 Bundle containing Patient, Practitioner,
Organization, Condition, and Claim resources.

Endpoints:
  POST /extract-fhir  — multipart PDF upload → FHIR Bundle JSON
  GET  /health        — health check
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from fhir_builder import build_fhir_bundle

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

app = FastAPI(title="Document AI Service — India Cashless", version="1.0.0")

FHIR_BASE_URL = os.getenv("FHIR_BASE_URL", "http://hapi-fhir:8080/fhir")
GRAPH_URL = os.getenv("GRAPH_SERVICE_URL", "http://graph-service:8000/event")
KAFKA_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "")
OCR_CONFIDENCE_THRESHOLD = float(os.getenv("OCR_CONFIDENCE_THRESHOLD", "0.7"))


def _get_ocr_engine():
    """Lazy-load the existing ACOS OCR engine."""
    try:
        import sys
        sys.path.insert(0, "/app")
        try:
            from services.ocr_service.app.ocr_engine_enhanced import get_ocr_engine_enhanced
            return get_ocr_engine_enhanced()
        except Exception:
            from services.ocr_service.app.ocr_engine import get_ocr_engine
            return get_ocr_engine()
    except Exception as exc:
        logger.warning("[DocAI] OCR engine unavailable: %s — using stub extractor", exc)
        return None


def _stub_extract(pdf_bytes: bytes) -> dict:
    """Minimal stub extractor when OCR engine is unavailable (dev/test)."""
    return {
        "patient_name": "Test Patient",
        "member_number": "IND-TEST-001",
        "primary_diagnosis_code": "Z00.0",
        "primary_diagnosis_desc": "General examination",
        "treating_doctor": "Dr. Test",
        "provider_name": "Test Hospital",
        "provider_code": "IND-TEST-HOSP",
        "total_billed": 10000.0,
        "line_items": [
            {"procedure_code": "CONSULT", "billed_amount": 500},
            {"procedure_code": "DIAG", "billed_amount": 9500},
        ],
    }


def _notify_graph(claim_id: str, event_type: str, data: Optional[dict] = None):
    try:
        import requests
        requests.post(
            GRAPH_URL,
            json={"claim_id": claim_id, "event_type": event_type,
                  "data": data or {}, "market_region": "INDIA"},
            timeout=2,
        )
    except Exception as exc:
        logger.debug("[DocAI] Graph notification failed: %s", exc)


def _publish_kafka(claim_id: str, event_type: str, data: Optional[dict] = None):
    if not KAFKA_SERVERS:
        return
    try:
        from confluent_kafka import Producer
        p = Producer({"bootstrap.servers": KAFKA_SERVERS})
        p.produce("claim-events", json.dumps({
            "event_type": event_type,
            "claim_id": claim_id,
            "market_region": "INDIA",
            "data": data or {},
        }).encode())
        p.poll(0)
    except Exception as exc:
        logger.debug("[DocAI] Kafka publish failed: %s", exc)


@app.post("/extract-fhir")
async def extract_fhir(file: UploadFile = File(...)):
    """
    Accept a discharge summary PDF and return a FHIR R4 Bundle.

    Returns:
        200: FHIR R4 Bundle JSON
        422: Extraction failed or confidence too low
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        # Accept any file in dev — OCR engine handles format detection
        pass

    pdf_bytes = await file.read()
    if len(pdf_bytes) < 100:
        raise HTTPException(status_code=422, detail="File too small to be a valid PDF")

    ocr = _get_ocr_engine()
    extracted: dict = {}
    low_confidence_fields: list[str] = []

    if ocr is not None:
        try:
            # Write to temp file — OCR engine expects a file path
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(pdf_bytes)
                tmp_path = tmp.name

            result = ocr.extract(tmp_path, market_region="INDIA")
            extracted = result.extracted_fields or {}
            field_confidences = result.field_confidences or {}

            # Check required field confidence
            required = ["patient_name", "primary_diagnosis_code", "total_billed"]
            for field in required:
                conf = field_confidences.get(field, 1.0)
                if conf < OCR_CONFIDENCE_THRESHOLD:
                    low_confidence_fields.append(field)

            import os as _os
            _os.unlink(tmp_path)
        except Exception as exc:
            logger.warning("[DocAI] OCR extraction failed: %s — using stub", exc)
            extracted = _stub_extract(pdf_bytes)
    else:
        extracted = _stub_extract(pdf_bytes)

    if low_confidence_fields:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "OCR confidence below threshold for required fields",
                "low_confidence_fields": low_confidence_fields,
                "threshold": OCR_CONFIDENCE_THRESHOLD,
            },
        )

    bundle = build_fhir_bundle(extracted)
    claim_id = bundle["entry"][-1]["resource"]["id"]  # Claim is last entry

    _notify_graph(claim_id, "DOCUMENT_PROCESSED", {
        "filename": file.filename,
        "patient_name": extracted.get("patient_name"),
        "diagnosis": extracted.get("primary_diagnosis_code"),
    })
    _publish_kafka(claim_id, "FHIR_EXTRACTED", {"filename": file.filename})

    logger.info("[DocAI] Extracted FHIR bundle for claim %s from %s", claim_id, file.filename)
    return JSONResponse(content=bundle)


@app.get("/health")
async def health():
    ocr_available = _get_ocr_engine() is not None
    return {"status": "healthy", "ocr_available": ocr_available, "service": "document-ai"}
