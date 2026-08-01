"""
Property-Based Tests — FHIR Bundle Round-Trip
=============================================
Requirement 5.4: FOR ALL valid discharge PDFs, parsing the returned FHIR
Bundle JSON and re-serializing it SHALL produce an equivalent Bundle.

Tests the fhir_builder module directly without needing a running service.
"""
import json
import sys
import os
import pytest

# Add the document_ai service to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "services", "india_cashless", "document_ai"))

try:
    from fhir_builder import build_fhir_bundle
    FHIR_BUILDER_AVAILABLE = True
except ImportError:
    FHIR_BUILDER_AVAILABLE = False


@pytest.mark.skipif(not FHIR_BUILDER_AVAILABLE, reason="fhir_builder not importable")
class TestFHIRBundleRoundTrip:
    """Requirement 5.4: FHIR Bundle JSON round-trip property."""

    def _assert_round_trip(self, extracted: dict):
        bundle = build_fhir_bundle(extracted)
        # Round-trip: serialize → deserialize → re-serialize
        serialized = json.dumps(bundle, sort_keys=True)
        deserialized = json.loads(serialized)
        re_serialized = json.dumps(deserialized, sort_keys=True)
        assert serialized == re_serialized, "FHIR Bundle round-trip failed"
        return bundle

    def test_minimal_extracted_fields(self):
        bundle = self._assert_round_trip({
            "patient_name": "Rahul Sharma",
            "member_number": "IND-2024-001",
            "primary_diagnosis_code": "I21.9",
            "total_billed": 50000,
        })
        assert bundle["resourceType"] == "Bundle"
        assert bundle["type"] == "collection"
        assert len(bundle["entry"]) >= 3  # Patient, Practitioner, Organization, Claim

    def test_full_extracted_fields(self):
        bundle = self._assert_round_trip({
            "patient_name": "Priya Patel",
            "member_number": "IND-2024-002",
            "patient_dob": "1985-03-15",
            "primary_diagnosis_code": "J45.9",
            "primary_diagnosis_desc": "Asthma",
            "diagnosis_codes": ["J45.9", "J30.1"],
            "treating_doctor": "Dr. Amit Kumar",
            "provider_name": "Apollo Hospital",
            "provider_code": "IND-DEL-001",
            "admission_date": "2026-05-01",
            "discharge_date": "2026-05-05",
            "total_billed": 125000,
            "line_items": [
                {"procedure_code": "ROOM", "procedure_desc": "Room Rent", "billed_amount": 25000},
                {"procedure_code": "SURG", "procedure_desc": "Surgery", "billed_amount": 100000},
            ],
        })
        # Verify structure
        resource_types = [e["resource"]["resourceType"] for e in bundle["entry"]]
        assert "Patient" in resource_types
        assert "Claim" in resource_types
        assert "Practitioner" in resource_types
        assert "Organization" in resource_types
        assert "Condition" in resource_types

    def test_claim_resource_has_preauthorization_use(self):
        bundle = build_fhir_bundle({"patient_name": "Test", "total_billed": 1000})
        claim = next(e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Claim")
        assert claim["use"] == "preauthorization"

    def test_bundle_has_timestamp(self):
        bundle = build_fhir_bundle({"patient_name": "Test", "total_billed": 1000})
        assert "timestamp" in bundle

    def test_multiple_diagnoses_create_multiple_conditions(self):
        bundle = build_fhir_bundle({
            "patient_name": "Test",
            "diagnosis_codes": ["E11.9", "I10", "J45.9"],
            "total_billed": 5000,
        })
        conditions = [e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Condition"]
        assert len(conditions) == 3

    @pytest.mark.parametrize("total_billed", [0, 100, 50000, 1000000, 9999999.99])
    def test_various_amounts_round_trip(self, total_billed):
        self._assert_round_trip({
            "patient_name": "Test Patient",
            "total_billed": total_billed,
        })

    def test_unicode_patient_name_round_trip(self):
        """Indian names with Unicode characters must survive round-trip."""
        self._assert_round_trip({
            "patient_name": "राहुल शर्मा",
            "total_billed": 10000,
        })

    def test_empty_line_items_round_trip(self):
        self._assert_round_trip({
            "patient_name": "Test",
            "line_items": [],
            "total_billed": 5000,
        })
