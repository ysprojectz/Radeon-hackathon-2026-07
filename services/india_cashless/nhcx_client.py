"""
NHCX Client — India Cashless Pre-Authorization
================================================
RS256 JWT-authenticated client for the National Health Claims Exchange (NHCX)
v2.1 specification. Supports pre-auth submission, claim submission, and status
checks with exponential-backoff retry and idempotency keys.

For development/staging, point NHCX_BASE_URL at the mock-nhcx container.
For production, use the NHA sandbox or live NHCX endpoint with real credentials.
"""
from __future__ import annotations

import os
import time
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)


class NHCXClient:
    """
    Thin NHCX gateway client.

    Environment variables (all optional — fall back to mock):
        NHCX_BASE_URL          Base URL of the NHCX endpoint (default: mock)
        NHCX_CLIENT_ID         Participant ID issued by NHA
        NHCX_PRIVATE_KEY_PEM   RS256 private key PEM string (newlines as \\n)
        NHCX_CERT_PATH         Path to mTLS client cert (optional)
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        client_id: Optional[str] = None,
        private_key_pem: Optional[str] = None,
        cert_path: Optional[str] = None,
    ):
        self.base_url = (base_url or os.getenv("NHCX_BASE_URL", "http://mock-nhcx:8000")).rstrip("/")
        self.client_id = client_id or os.getenv("NHCX_CLIENT_ID", "dev-participant")
        self._private_key_pem = private_key_pem or os.getenv("NHCX_PRIVATE_KEY_PEM", "")
        self.cert = cert_path or os.getenv("NHCX_CERT_PATH")
        self._private_key = None

        if self._private_key_pem:
            try:
                from cryptography.hazmat.primitives import serialization
                self._private_key = serialization.load_pem_private_key(
                    self._private_key_pem.replace("\\n", "\n").encode(),
                    password=None,
                )
            except Exception as exc:
                logger.warning("[NHCX] Could not load private key — JWT auth disabled: %s", exc)

    # ── JWT ──────────────────────────────────────────────────────────────────

    def _generate_jwt(self) -> Optional[str]:
        if not self._private_key:
            return None
        try:
            import jwt  # PyJWT
            payload = {
                "iss": self.client_id,
                "sub": self.client_id,
                "iat": datetime.now(timezone.utc).replace(tzinfo=None),
                "exp": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=30),
                "jti": str(uuid.uuid4()),
            }
            return jwt.encode(payload, self._private_key, algorithm="RS256")
        except Exception as exc:
            logger.warning("[NHCX] JWT generation failed: %s", exc)
            return None

    def _headers(self, idempotency_key: Optional[str] = None) -> dict:
        headers: dict = {
            "Content-Type": "application/fhir+json",
            "X-Request-ID": str(uuid.uuid4()),
        }
        token = self._generate_jwt()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    # ── HTTP with retry ───────────────────────────────────────────────────────

    def _call(
        self,
        method: str,
        path: str,
        body: Optional[dict] = None,
        idempotency_key: Optional[str] = None,
        retries: int = 3,
    ) -> dict:
        url = f"{self.base_url}{path}"
        headers = self._headers(idempotency_key)
        kwargs: dict = {"headers": headers, "json": body, "timeout": 30}
        if self.cert:
            kwargs["cert"] = self.cert

        last_exc: Optional[Exception] = None
        for attempt in range(retries):
            try:
                resp = requests.request(method, url, **kwargs)
                if resp.status_code == 504:
                    wait = 2 ** attempt
                    logger.warning("[NHCX] 504 on attempt %d — retrying in %ds", attempt + 1, wait)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.exceptions.RequestException as exc:
                last_exc = exc
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)

        raise RuntimeError(f"NHCX call failed after {retries} attempts: {last_exc}") from last_exc

    # ── Public API ────────────────────────────────────────────────────────────

    def submit_preauth(self, claim_bundle: dict, idempotency_key: Optional[str] = None) -> dict:
        """Submit a FHIR CoverageEligibilityRequest for cashless pre-authorization."""
        key = idempotency_key or str(uuid.uuid4())
        logger.info("[NHCX] Submitting pre-auth (idempotency=%s)", key)
        return self._call("POST", "/pre-auth", claim_bundle, key)

    def submit_claim(self, claim_bundle: dict, idempotency_key: Optional[str] = None) -> dict:
        """Submit a FHIR Claim resource after treatment."""
        key = idempotency_key or str(uuid.uuid4())
        logger.info("[NHCX] Submitting claim (idempotency=%s)", key)
        return self._call("POST", "/claim", claim_bundle, key)

    def check_claim_status(self, claim_id: str) -> dict:
        """Poll NHCX for the current status of a submitted claim."""
        logger.info("[NHCX] Checking status for claim %s", claim_id)
        return self._call("GET", f"/claim-response/{claim_id}")

    def build_preauth_bundle(self, advance_claim: dict) -> dict:
        """
        Convert an ACOS advance claim dict into a minimal FHIR
        CoverageEligibilityRequest bundle for NHCX submission.
        """
        claim_id = advance_claim.get("claim_id", str(uuid.uuid4()))
        return {
            "resourceType": "Bundle",
            "type": "collection",
            "entry": [
                {
                    "resource": {
                        "resourceType": "CoverageEligibilityRequest",
                        "id": claim_id,
                        "status": "active",
                        "purpose": ["auth-requirements", "benefits"],
                        "patient": {
                            "reference": f"Patient/{advance_claim.get('member_number', 'unknown')}",
                            "display": advance_claim.get("patient_name", ""),
                        },
                        "created": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
                        "insurer": {"display": "TPA"},
                        "provider": {
                            "reference": f"Organization/{advance_claim.get('provider_code', 'unknown')}",
                            "display": advance_claim.get("provider_name", ""),
                        },
                        "insurance": [
                            {
                                "focal": True,
                                "coverage": {
                                    "reference": f"Coverage/{advance_claim.get('member_number', 'unknown')}"
                                },
                            }
                        ],
                        "item": [
                            {
                                "sequence": li.get("line_number", idx + 1),
                                "category": {
                                    "coding": [{"code": li.get("service_category", "CONSULTATION")}]
                                },
                                "productOrService": {
                                    "coding": [{"code": li.get("procedure_code", "")}]
                                },
                                "unitPrice": {
                                    "value": float(li.get("billed_amount", 0)),
                                    "currency": "INR",
                                },
                            }
                            for idx, li in enumerate(advance_claim.get("line_items", []))
                        ],
                        "extension": [
                            {
                                "url": "https://nhcx.nha.gov.in/fhir/StructureDefinition/preauth-reference",
                                "valueString": advance_claim.get("preauth_reference", ""),
                            },
                            {
                                "url": "https://nhcx.nha.gov.in/fhir/StructureDefinition/is-emergency",
                                "valueBoolean": advance_claim.get("is_emergency", False),
                            },
                        ],
                    }
                }
            ],
        }


# ── Module-level singleton ────────────────────────────────────────────────────

_client: Optional[NHCXClient] = None


def get_nhcx_client() -> NHCXClient:
    global _client
    if _client is None:
        _client = NHCXClient()
    return _client
