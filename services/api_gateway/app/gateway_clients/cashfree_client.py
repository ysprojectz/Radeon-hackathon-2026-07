"""Cashfree Verification Suite client for bank account verification."""

from __future__ import annotations

from typing import Any, Optional

import httpx

SANDBOX_VERIFICATION_BASE = "https://sandbox.cashfree.com/verification"
PRODUCTION_VERIFICATION_BASE = "https://api.cashfree.com/verification"
SANDBOX_PG_BASE = "https://sandbox.cashfree.com/pg"
PRODUCTION_PG_BASE = "https://api.cashfree.com/pg"
CASHFREE_API_VERSION = "2025-01-01"
READ_TIMEOUT = 30.0


class CashfreeClientError(Exception):
    def __init__(self, message: str, code: Optional[str] = None, http_status: int = 0):
        super().__init__(message)
        self.code = code
        self.http_status = http_status


def _base_url(environment: str) -> str:
    return PRODUCTION_VERIFICATION_BASE if environment == "production" else SANDBOX_VERIFICATION_BASE


def _pg_base_url(environment: str) -> str:
    return PRODUCTION_PG_BASE if environment == "production" else SANDBOX_PG_BASE


def _headers(client_id: str, client_secret: str) -> dict[str, str]:
    if not client_id or not client_secret:
        raise CashfreeClientError("Cashfree client id and secret are required", code="unconfigured")
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-client-id": client_id,
        "x-client-secret": client_secret,
    }


def _raise_for_cashfree(resp: httpx.Response) -> dict[str, Any]:
    try:
        body = resp.json()
    except Exception:
        body = {}
    if not resp.is_success:
        message = body.get("message") or body.get("error") or f"HTTP {resp.status_code}"
        raise CashfreeClientError(message, code=body.get("code"), http_status=resp.status_code)
    return body


def verify_bank_account_async(
    *,
    client_id: str,
    client_secret: str,
    environment: str = "preproduction",
    bank_account: str,
    ifsc: str,
    name: str,
    user_id: str,
    phone: str = "9999999999",
) -> dict[str, Any]:
    payload = {
        "bank_account": bank_account,
        "ifsc": ifsc.upper(),
        "name": name,
        "user_id": user_id,
        "phone": phone,
    }
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.post(
            f"{_base_url(environment)}/bank-account/async",
            headers=_headers(client_id, client_secret),
            json=payload,
        )
    return _raise_for_cashfree(resp)


def create_order(
    *,
    client_id: str,
    client_secret: str,
    environment: str = "sandbox",
    order_id: str,
    order_amount: float,
    order_currency: str = "INR",
    customer_id: str,
    customer_phone: str,
    return_url: str,
) -> dict[str, Any]:
    payload = {
        "order_amount": order_amount,
        "order_currency": order_currency,
        "order_id": order_id,
        "customer_details": {
            "customer_id": customer_id,
            "customer_phone": customer_phone,
        },
        "order_meta": {
            "return_url": return_url,
        },
    }
    headers = {**_headers(client_id, client_secret), "x-api-version": CASHFREE_API_VERSION}
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.post(f"{_pg_base_url(environment)}/orders", headers=headers, json=payload)
    return _raise_for_cashfree(resp)


def get_order_payments(
    *,
    client_id: str,
    client_secret: str,
    environment: str = "sandbox",
    order_id: str,
) -> dict[str, Any] | list[dict[str, Any]]:
    headers = {**_headers(client_id, client_secret), "x-api-version": CASHFREE_API_VERSION}
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.get(f"{_pg_base_url(environment)}/orders/{order_id}/payments", headers=headers)
    return _raise_for_cashfree(resp)
