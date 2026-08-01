"""
FHIR R4 Bundle Builder
======================
Maps OCR-extracted fields from the existing OCR engine into a valid
FHIR R4 Bundle containing Patient, Practitioner, Organization,
Condition, and Claim resources.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def build_fhir_bundle(extracted: dict[str, Any], claim_id: Optional[str] = None) -> dict:
    """
    Convert OCR extracted_fields dict into a FHIR R4 Bundle.

    Args:
        extracted: dict from OCR engine with keys like patient_name, dob,
                   diagnosis_codes, procedure_codes, treating_doctor, etc.
        claim_id:  optional pre-existing claim UUID

    Returns:
        FHIR R4 Bundle (type=collection)
    """
    cid = claim_id or _uuid()
    patient_id = _uuid()
    practitioner_id = _uuid()
    org_id = _uuid()

    # ── Patient ───────────────────────────────────────────────────────────
    patient_name = extracted.get("patient_name", "Unknown Patient")
    name_parts = patient_name.split(" ", 1)
    patient = {
        "resourceType": "Patient",
        "id": patient_id,
        "name": [{"use": "official", "family": name_parts[-1], "given": [name_parts[0]]}],
        "identifier": [
            {
                "system": "https://healthid.ndhm.gov.in",
                "value": extracted.get("member_number", "UNKNOWN"),
            }
        ],
    }
    if extracted.get("patient_dob") or extracted.get("date_of_birth"):
        patient["birthDate"] = str(extracted.get("patient_dob") or extracted.get("date_of_birth", ""))

    # ── Practitioner ──────────────────────────────────────────────────────
    doctor_name = extracted.get("treating_doctor", extracted.get("treating_physician", "Unknown Doctor"))
    doc_parts = str(doctor_name).split(" ", 1)
    practitioner = {
        "resourceType": "Practitioner",
        "id": practitioner_id,
        "name": [{"use": "official", "family": doc_parts[-1], "given": [doc_parts[0]]}],
    }

    # ── Organization (Hospital) ───────────────────────────────────────────
    hospital_name = extracted.get("provider_name", extracted.get("hospital_name", "Unknown Hospital"))
    organization = {
        "resourceType": "Organization",
        "id": org_id,
        "name": str(hospital_name),
        "identifier": [
            {
                "system": "https://facility.abdm.gov.in",
                "value": extracted.get("provider_code", "UNKNOWN"),
            }
        ],
    }

    # ── Conditions (Diagnoses) ────────────────────────────────────────────
    conditions = []
    diag_codes = extracted.get("diagnosis_codes", [])
    if not diag_codes and extracted.get("primary_diagnosis_code"):
        diag_codes = [extracted["primary_diagnosis_code"]]
    for code in diag_codes:
        conditions.append({
            "resourceType": "Condition",
            "id": _uuid(),
            "subject": {"reference": f"Patient/{patient_id}"},
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/icd-10",
                        "code": str(code),
                        "display": extracted.get("primary_diagnosis_desc", str(code)),
                    }
                ]
            },
            "clinicalStatus": {
                "coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active"}]
            },
        })

    # ── Claim ─────────────────────────────────────────────────────────────
    line_items = extracted.get("line_items", [])
    claim_items = []
    for idx, li in enumerate(line_items):
        claim_items.append({
            "sequence": idx + 1,
            "productOrService": {
                "coding": [{"code": str(li.get("procedure_code", "UNKNOWN"))}]
            },
            "unitPrice": {
                "value": float(li.get("billed_amount", 0)),
                "currency": "INR",
            },
        })

    total_billed = float(extracted.get("total_billed", 0))
    if not total_billed and claim_items:
        total_billed = sum(
            float(li.get("billed_amount", 0)) for li in line_items
        )

    claim = {
        "resourceType": "Claim",
        "id": cid,
        "status": "active",
        "use": "preauthorization",
        "patient": {"reference": f"Patient/{patient_id}"},
        "created": _now(),
        "provider": {"reference": f"Organization/{org_id}"},
        "priority": {"coding": [{"code": "normal"}]},
        "diagnosis": [
            {
                "sequence": i + 1,
                "diagnosisCodeableConcept": {
                    "coding": [{"system": "http://hl7.org/fhir/sid/icd-10", "code": str(code)}]
                },
            }
            for i, code in enumerate(diag_codes)
        ],
        "item": claim_items,
        "total": {"value": total_billed, "currency": "INR"},
    }

    if extracted.get("admission_date"):
        claim["billablePeriod"] = {
            "start": str(extracted["admission_date"]),
            "end": str(extracted.get("discharge_date", extracted["admission_date"])),
        }

    # ── Bundle ────────────────────────────────────────────────────────────
    entries = [
        {"resource": patient},
        {"resource": practitioner},
        {"resource": organization},
        *[{"resource": c} for c in conditions],
        {"resource": claim},
    ]

    return {
        "resourceType": "Bundle",
        "id": _uuid(),
        "type": "collection",
        "timestamp": _now(),
        "entry": entries,
    }
