"""
Stripe Payout Client
====================
Connects to the Stripe REST API directly via httpx (no stripe-python SDK
dependency required — works in any environment that has httpx installed).

Workflow for insurance claim reimbursements
-------------------------------------------
1. test_connection()         — verify the secret key is valid (GET /v1/account)
2. register_bank_account()   — attach the patient's bank account as an
                               ExternalAccount on the connected Stripe account
3. create_payout()           — create a Stripe Transfer or Payout to the
                               registered external account

All amounts are in the currency's *minor unit* (fils, paise, cents).

Environment
-----------
sandbox / preproduction → https://api.stripe.com  with test keys  (pk_test_ / sk_test_)
production              → https://api.stripe.com  with live keys  (pk_live_ / sk_live_)

The client raises StripeClientError on configuration or API errors.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_API_VERSION = "2026-02-25.clover"
CONNECT_TIMEOUT = 8.0
READ_TIMEOUT    = 30.0


class StripeClientError(Exception):
    def __init__(self, message: str, code: Optional[str] = None, http_status: int = 0):
        super().__init__(message)
        self.code        = code
        self.http_status = http_status


def _headers(secret_key: str) -> dict[str, str]:
    return {
        "Authorization":  f"Bearer {secret_key}",
        "Content-Type":   "application/x-www-form-urlencoded",
        "Stripe-Version": STRIPE_API_VERSION,
    }


def _raise_for_stripe(resp: httpx.Response) -> dict[str, Any]:
    body: dict[str, Any] = {}
    try:
        body = resp.json()
    except Exception:
        pass
    if not resp.is_success:
        err   = body.get("error", {})
        msg   = err.get("message", f"HTTP {resp.status_code}")
        code  = err.get("code", err.get("type", "stripe_error"))
        raise StripeClientError(msg, code=code, http_status=resp.status_code)
    return body


# ── Connection test ───────────────────────────────────────────────────────────

def test_connection(secret_key: str) -> dict[str, Any]:
    """
    Calls GET /v1/account to verify the secret key.
    Returns the Stripe account object on success.
    Raises StripeClientError on failure.
    """
    if not secret_key:
        raise StripeClientError("Stripe secret key is not configured", code="unconfigured")
    with httpx.Client(timeout=httpx.Timeout(CONNECT_TIMEOUT)) as client:
        resp = client.get(f"{STRIPE_API_BASE}/account", headers=_headers(secret_key))
    return _raise_for_stripe(resp)


# ── External bank account registration ───────────────────────────────────────

def register_bank_account(
    *,
    secret_key:     str,
    account_id:     str,       # Stripe connected account ID (acct_***)
    account_number: str,       # full account number (NOT masked)
    routing_number: str,
    account_holder_name: str,
    country:        str = "AE",
    currency:       str = "AED",
) -> dict[str, Any]:
    """
    Create an ExternalAccount (bank account) on the Stripe connected account.
    Returns the ExternalAccount object including `id` (ba_***).
    """
    if not secret_key:
        raise StripeClientError("Stripe secret key is not configured", code="unconfigured")
    payload = {
        "external_account[object]":              "bank_account",
        "external_account[country]":             country,
        "external_account[currency]":            currency.lower(),
        "external_account[account_number]":      account_number,
        "external_account[routing_number]":      routing_number,
        "external_account[account_holder_name]": account_holder_name,
        "external_account[account_holder_type]": "individual",
    }
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.post(
            f"{STRIPE_API_BASE}/accounts/{account_id}/external_accounts",
            headers=_headers(secret_key),
            data=payload,
        )
    return _raise_for_stripe(resp)


# Backwards-compatible alias used by older account sync code paths.
create_external_account = register_bank_account


# ── Payout / Transfer ─────────────────────────────────────────────────────────

def create_payout(
    *,
    secret_key:          str,
    amount_minor:        int,      # amount in minor currency unit
    currency:            str,      # ISO 4217 e.g. "AED", "INR"
    stripe_account_id:   str,      # acct_*** (connected account)
    bank_account_id:     str,      # ba_*** returned by register_bank_account
    description:         str = "",
    metadata:            Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """
    Initiate a Stripe Payout to a registered external bank account.
    Returns the Stripe Payout object including `id` (po_***) and `status`.
    """
    if not secret_key:
        raise StripeClientError("Stripe secret key is not configured", code="unconfigured")

    payload: dict[str, Any] = {
        "amount":      str(amount_minor),
        "currency":    currency.lower(),
        "method":      "standard",
        "destination": bank_account_id,
    }
    if description:
        payload["description"] = description[:512]
    if metadata:
        for k, v in metadata.items():
            payload[f"metadata[{k}]"] = str(v)[:500]

    # Use Stripe-Account header to act on behalf of the connected account
    hdrs = {**_headers(secret_key), "Stripe-Account": stripe_account_id}
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.post(f"{STRIPE_API_BASE}/payouts", headers=hdrs, data=payload)
    return _raise_for_stripe(resp)


# ── Retrieve payout status ────────────────────────────────────────────────────

def get_payout_status(*, secret_key: str, stripe_account_id: str, payout_id: str) -> dict[str, Any]:
    """Poll the status of an existing Stripe Payout."""
    hdrs = {**_headers(secret_key), "Stripe-Account": stripe_account_id}
    with httpx.Client(timeout=httpx.Timeout(CONNECT_TIMEOUT)) as client:
        resp = client.get(f"{STRIPE_API_BASE}/payouts/{payout_id}", headers=hdrs)
    return _raise_for_stripe(resp)


# ── Webhook signature verification ───────────────────────────────────────────

def verify_webhook_signature(payload: bytes, sig_header: str, webhook_secret: str) -> dict[str, Any]:
    """
    Verify Stripe webhook signature using HMAC-SHA256.
    Raises StripeClientError if invalid.
    Returns the decoded event dict.
    """
    import hashlib
    import hmac
    import json
    import time

    parts  = {p.split("=")[0]: p.split("=")[1] for p in sig_header.split(",") if "=" in p}
    ts     = parts.get("t")
    v1_sig = parts.get("v1")
    if not ts or not v1_sig:
        raise StripeClientError("Missing Stripe signature header fields", code="invalid_signature")

    # Reject timestamps older than 5 minutes
    if abs(time.time() - int(ts)) > 300:
        raise StripeClientError("Stripe webhook timestamp too old", code="timestamp_expired")

    signed_payload = f"{ts}.{payload.decode()}".encode()
    expected = hmac.new(webhook_secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, v1_sig):
        raise StripeClientError("Stripe webhook signature mismatch", code="invalid_signature")

    return json.loads(payload)
