"""
ABHA Service — Ayushman Bharat Health Account (ABDM) Integration
================================================================
Handles OTP-based patient identity verification and ABHA address linking
as required by the NHA ABDM mandate for cashless claims.

In development, NHCX_BASE_URL should point to mock-nhcx which stubs these
endpoints. For UAT/production, wire to the real ABDM sandbox.
"""
from __future__ import annotations

import logging
from typing import Optional

from services.india_cashless.nhcx_client import NHCXClient, get_nhcx_client

logger = logging.getLogger(__name__)


class ABHAService:
    """
    Wraps ABHA OTP generation and verification calls through the NHCXClient.

    Usage:
        svc = ABHAService()
        svc.generate_otp("john.doe@abdm")
        svc.verify_otp_and_link("john.doe@abdm", "123456")
    """

    def __init__(self, client: Optional[NHCXClient] = None):
        self._client = client or get_nhcx_client()

    def generate_otp(self, abha_address: str, auth_mode: str = "MOBILE") -> dict:
        """
        Trigger an OTP to the mobile number linked to the ABHA address.
        Returns the NHCX/ABDM response (transaction ID etc.).
        """
        logger.info("[ABHA] Generating OTP for %s (mode=%s)", abha_address, auth_mode)
        return self._client._call(
            "POST",
            "/abha/generate-otp",
            {
                "resourceType": "Parameters",
                "parameter": [
                    {"name": "abhaAddress", "valueString": abha_address},
                    {"name": "authMode", "valueString": auth_mode},
                ],
            },
        )

    def verify_otp_and_link(self, abha_address: str, otp: str) -> dict:
        """
        Verify the OTP and link the ABHA address to the current claim session.
        Returns the verified patient profile on success.
        """
        logger.info("[ABHA] Verifying OTP for %s", abha_address)
        return self._client._call(
            "POST",
            "/abha/verify-otp",
            {
                "resourceType": "Parameters",
                "parameter": [
                    {"name": "abhaAddress", "valueString": abha_address},
                    {"name": "otp", "valueString": otp},
                ],
            },
        )

    def get_patient_profile(self, abha_address: str) -> dict:
        """Fetch the FHIR Patient resource for a verified ABHA address."""
        logger.info("[ABHA] Fetching patient profile for %s", abha_address)
        return self._client._call("GET", f"/abha/patient/{abha_address}")


# ── Module-level singleton ────────────────────────────────────────────────────

_service: Optional[ABHAService] = None


def get_abha_service() -> ABHAService:
    global _service
    if _service is None:
        _service = ABHAService()
    return _service
