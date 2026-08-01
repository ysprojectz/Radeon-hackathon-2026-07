"""
Mock NHCX Service
=================
Simulates the NHA National Health Claims Exchange gateway for development
and staging. Mirrors claimaura/services/mock-nhcx/app.py with added
/claim and /claim-response/{id} endpoints and /abha stubs.

Replace NHCX_BASE_URL with the real NHA sandbox for UAT/production.
"""
from __future__ import annotations

import asyncio
import random
import uuid

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, Optional

app = FastAPI(title="Mock NHCX Service", version="1.0.0")


class FHIRBundle(BaseModel):
    resourceType: Optional[str] = None
    model_config = {"extra": "allow"}


@app.post("/pre-auth")
async def pre_auth(bundle: Optional[Dict[str, Any]] = None):
    """Simulate NHCX CoverageEligibilityRequest — 10% timeout, 5% error, 85% approve."""
    rand = random.random()
    if rand < 0.10:
        await asyncio.sleep(2)
        raise HTTPException(status_code=504, detail="Gateway Timeout")
    if rand < 0.15:
        raise HTTPException(
            status_code=400,
            detail={"resourceType": "OperationOutcome",
                    "issue": [{"severity": "error", "code": "processing",
                               "diagnostics": "Invalid FHIR bundle structure"}]},
        )
    auth_ref = f"NHCX-PREAUTH-{uuid.uuid4().hex[:8].upper()}"
    return {
        "resourceType": "EligibilityResponse",
        "status": "active",
        "outcome": "complete",
        "disposition": "Pre-authorization approved",
        "preAuthRef": auth_ref,
    }


@app.post("/claim")
async def submit_claim(bundle: Optional[Dict[str, Any]] = None):
    """Simulate NHCX Claim submission."""
    claim_ref = f"NHCX-CLM-{uuid.uuid4().hex[:8].upper()}"
    return {
        "resourceType": "ClaimResponse",
        "status": "active",
        "outcome": "complete",
        "claimRef": claim_ref,
        "disposition": "Claim received and queued for adjudication",
    }


@app.get("/claim-response/{claim_id}")
async def claim_status(claim_id: str):
    """Simulate NHCX claim status check."""
    return {
        "resourceType": "ClaimResponse",
        "id": claim_id,
        "status": "active",
        "outcome": "complete",
        "disposition": "Claim adjudicated",
    }


# ── ABHA stubs ────────────────────────────────────────────────────────────────

@app.post("/abha/generate-otp")
async def abha_generate_otp(body: Optional[Dict[str, Any]] = None):
    return {"txnId": str(uuid.uuid4()), "message": "OTP sent to registered mobile"}


@app.post("/abha/verify-otp")
async def abha_verify_otp(body: Optional[Dict[str, Any]] = None):
    return {
        "txnId": str(uuid.uuid4()),
        "status": "SUCCESS",
        "abhaProfile": {
            "ABHANumber": f"91-{random.randint(1000,9999)}-{random.randint(1000,9999)}-{random.randint(1000,9999)}",
            "name": "Test Patient",
            "gender": "M",
            "mobile": "9999999999",
        },
    }


@app.get("/abha/patient/{abha_address}")
async def abha_patient(abha_address: str):
    return {
        "resourceType": "Patient",
        "id": abha_address.replace("@", "-"),
        "name": [{"text": "Test Patient"}],
        "identifier": [{"system": "https://healthid.ndhm.gov.in", "value": abha_address}],
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "mock-nhcx"}
