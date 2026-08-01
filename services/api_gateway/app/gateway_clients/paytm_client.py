"""
PayTM Payout Client
====================
Connects to the PayTM Business Payout API via httpx.

PayTM Payout API overview
--------------------------
Base URLs:
  Sandbox / Pre-production : https://staging-autopay.paytm.com
  Production               : https://autopay.paytm.com

Authentication
--------------
Every request body is HMAC-SHA256 signed using the Merchant Key.
The checksum is sent as the `checksum` field in the JSON body.

Workflow
--------
1.  test_connection()         — Balance inquiry to verify credentials
2.  add_beneficiary()         — Register patient bank account as a beneficiary
3.  create_payout()           — Initiate a payout to the beneficiary
4.  get_payout_status()       — Poll transaction status

All amounts are in *major* units (INR, not paise) — PayTM requires this.

Raises PaytmClientError on configuration or API errors.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

SANDBOX_BASE    = "https://staging-autopay.paytm.com"
PRODUCTION_BASE = "https://autopay.paytm.com"
SANDBOX_BENEFICIARY_VALIDATION_BASE = "https://staging-dashboard.paytm.com"
PRODUCTION_BENEFICIARY_VALIDATION_BASE = "https://dashboard.paytm.com"
STAGING_PAYMENT_BASE = "https://securestage.paytmpayments.com"
PRODUCTION_PAYMENT_BASE = "https://secure.paytmpayments.com"
CONNECT_TIMEOUT = 8.0
READ_TIMEOUT    = 30.0


class PaytmClientError(Exception):
    def __init__(self, message: str, code: Optional[str] = None, http_status: int = 0):
        super().__init__(message)
        self.code        = code
        self.http_status = http_status


# ── Checksum / signature ──────────────────────────────────────────────────────

def _generate_checksum(params: dict[str, Any], merchant_key: str) -> str:
    """
    PayTM checksum algorithm:
      1. Sort params alphabetically by key
      2. Concatenate as key1=value1|key2=value2|...
      3. Append |<merchant_key> at the end
      4. HMAC-SHA256 of the concatenated string
    """
    if not merchant_key:
        raise PaytmClientError("PayTM merchant key is not configured", code="unconfigured")
    parts  = [f"{k}={v}" for k, v in sorted(params.items()) if k != "checksum"]
    signed = "|".join(parts) + "|" + merchant_key
    return hmac.new(merchant_key.encode(), signed.encode(), hashlib.sha256).hexdigest()


def _verify_checksum(params: dict[str, Any], merchant_key: str) -> bool:
    expected = _generate_checksum({k: v for k, v in params.items() if k != "checksumhash"}, merchant_key)
    return hmac.compare_digest(expected, params.get("checksumhash", ""))


def _base_url(environment: str) -> str:
    return PRODUCTION_BASE if environment == "production" else SANDBOX_BASE


def _payment_base_url(environment: str) -> str:
    return PRODUCTION_PAYMENT_BASE if environment == "production" else STAGING_PAYMENT_BASE


def _beneficiary_validation_base_url(environment: str) -> str:
    return PRODUCTION_BENEFICIARY_VALIDATION_BASE if environment == "production" else SANDBOX_BENEFICIARY_VALIDATION_BASE


def _generate_body_signature(body: dict[str, Any], merchant_key: str) -> str:
    """Generate a deterministic signature over the PayTM initiate-transaction body."""
    if not merchant_key:
        raise PaytmClientError("PayTM merchant key is not configured", code="unconfigured")
    serialized = json.dumps(body, separators=(",", ":"), sort_keys=True)
    return hmac.new(merchant_key.encode(), serialized.encode(), hashlib.sha256).hexdigest()


def _raise_for_paytm(resp: httpx.Response) -> dict[str, Any]:
    body: dict[str, Any] = {}
    try:
        body = resp.json()
    except Exception:
        pass
    if not resp.is_success:
        raise PaytmClientError(f"HTTP {resp.status_code}", code="http_error", http_status=resp.status_code)
    status = body.get("status", "").upper()
    if status == "FAILURE":
        msg  = body.get("errorInfo", {}).get("message", "PayTM payout failed")
        code = body.get("errorInfo", {}).get("code", "FAILURE")
        raise PaytmClientError(msg, code=code, http_status=resp.status_code)
    return body


def _raise_for_payment(resp: httpx.Response) -> dict[str, Any]:
    body: dict[str, Any] = {}
    try:
        body = resp.json()
    except Exception:
        pass
    if not resp.is_success:
        raise PaytmClientError(f"HTTP {resp.status_code}", code="http_error", http_status=resp.status_code)
    result = body.get("body", {}).get("resultInfo", {})
    status = str(result.get("resultStatus", "")).upper()
    if status and status != "S":
        raise PaytmClientError(
            result.get("resultMsg", "PayTM transaction initiation failed"),
            code=result.get("resultCode", status),
            http_status=resp.status_code,
        )
    return body


# ── Connection / balance check ────────────────────────────────────────────────

def test_connection(
    *,
    merchant_id:  str,
    merchant_key: str,
    environment:  str = "sandbox",
) -> dict[str, Any]:
    """
    Calls the PayTM Balance API to verify credentials.
    Returns the balance response dict on success.
    """
    if not merchant_id or not merchant_key:
        raise PaytmClientError("PayTM merchant credentials are not configured", code="unconfigured")

    params: dict[str, Any] = {
        "merchantId": merchant_id,
        "requestId":  str(uuid.uuid4()),
    }
    params["checksum"] = _generate_checksum(params, merchant_key)

    url = f"{_base_url(environment)}/payout/v1/getBalance"
    with httpx.Client(timeout=httpx.Timeout(CONNECT_TIMEOUT)) as client:
        resp = client.post(
            url,
            json={"details": params},
            headers={"Content-Type": "application/json"},
        )
    return _raise_for_paytm(resp)


def initiate_transaction(
    *,
    merchant_id: str,
    merchant_key: str,
    website: str = "WEBSTAGING",
    environment: str = "sandbox",
    order_id: str,
    amount: str,
    customer_id: str,
    callback_url: str,
    currency: str = "INR",
) -> dict[str, Any]:
    """
    Create a PayTM All-in-One/JS Checkout transaction token.
    The request follows PayTM's Initiate Transaction API:
    body contains the payment fields and head.signature signs that body.
    """
    if not merchant_id or not merchant_key:
        raise PaytmClientError("PayTM merchant credentials are not configured", code="unconfigured")
    body = {
        "requestType": "Payment",
        "mid": merchant_id,
        "websiteName": website or "WEBSTAGING",
        "orderId": order_id,
        "txnAmount": {"value": str(amount), "currency": currency},
        "userInfo": {"custId": customer_id},
        "callbackUrl": callback_url,
    }
    request_body = {
        "body": body,
        "head": {"signature": _generate_body_signature(body, merchant_key)},
    }
    url = f"{_payment_base_url(environment)}/theia/api/v1/initiateTransaction"
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.post(
            url,
            params={"mid": merchant_id, "orderId": order_id},
            json=request_body,
            headers={"Content-Type": "application/json"},
        )
    return _raise_for_payment(resp)


# ── Beneficiary registration ──────────────────────────────────────────────────

def add_beneficiary(
    *,
    merchant_id:        str,
    merchant_key:       str,
    environment:        str = "sandbox",
    beneficiary_id:     str,      # unique ID in your system (e.g. account UUID)
    beneficiary_name:   str,
    email:              str = "",
    phone:              str = "",
    bank_account_no:    str = "",
    ifsc_code:          str = "",
    upi_vpa:            str = "",
) -> dict[str, Any]:
    """
    Register a bank account / UPI VPA as a PayTM beneficiary.
    Either (bank_account_no + ifsc_code) or upi_vpa must be provided.
    Returns the beneficiary registration response.
    """
    if not merchant_id or not merchant_key:
        raise PaytmClientError("PayTM merchant credentials are not configured", code="unconfigured")
    if not (bank_account_no and ifsc_code) and not upi_vpa:
        raise PaytmClientError("Provide bank_account_no + ifsc_code OR upi_vpa", code="missing_payment_rail")

    params: dict[str, Any] = {
        "merchantId":      merchant_id,
        "beneficiaryId":   beneficiary_id,
        "beneficiaryName": beneficiary_name,
        "requestId":       str(uuid.uuid4()),
    }
    if email:
        params["beneficiaryEmail"] = email
    if phone:
        params["beneficiaryMobile"] = phone
    if bank_account_no and ifsc_code:
        params["beneficiaryAccountNo"]   = bank_account_no
        params["beneficiaryIfscCode"]    = ifsc_code.upper()
    elif upi_vpa:
        params["beneficiaryVpa"] = upi_vpa

    params["checksum"] = _generate_checksum(params, merchant_key)

    url = f"{_base_url(environment)}/payout/v1/addBeneficiary"
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.post(
            url,
            json={"details": params},
            headers={"Content-Type": "application/json"},
        )
    return _raise_for_paytm(resp)


def validate_beneficiary(
    *,
    merchant_id: str,
    merchant_key: str,
    environment: str = "sandbox",
    subwallet_guid: str,
    order_id: str,
    beneficiary_phone_no: str = "",
    bank_account_no: str = "",
    ifsc_code: str = "",
    upi_vpa: str = "",
    callback_url: str = "",
) -> dict[str, Any]:
    """
    Validate beneficiary details through PayTM pre-production/production penny-drop.

    PayTM's documented staging endpoint is:
      https://staging-dashboard.paytm.com/bpay/api/v1/beneficiary/validate

    The endpoint requires x-mid and x-checksum headers. Not every merchant has
    bank/UPI validation enabled; callers should treat ACCEPTED/PENDING as a
    pending compliance result until a final callback/status is available.
    """
    if not merchant_id or not merchant_key:
        raise PaytmClientError("PayTM merchant credentials are not configured", code="unconfigured")
    if not subwallet_guid:
        raise PaytmClientError("PayTM subwallet GUID is required for beneficiary validation", code="missing_subwallet")

    body: dict[str, Any] = {
        "subwalletGuid": subwallet_guid,
        "orderId": order_id,
        "skipCache": True,
    }
    if callback_url:
        body["callbackUrl"] = callback_url
    if beneficiary_phone_no:
        body["beneficiaryPhoneNo"] = beneficiary_phone_no
    if bank_account_no and ifsc_code:
        body["beneficiaryAccountNo"] = bank_account_no
        body["beneficiaryIfsc"] = ifsc_code.upper()
    if upi_vpa:
        body["beneficiaryVpa"] = upi_vpa

    checksum = _generate_body_signature(body, merchant_key)
    url = f"{_beneficiary_validation_base_url(environment)}/bpay/api/v1/beneficiary/validate"
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.post(
            url,
            json=body,
            headers={
                "Content-Type": "application/json",
                "x-mid": merchant_id,
                "x-checksum": checksum,
            },
        )
    return _raise_for_paytm(resp)


# ── Payout initiation ─────────────────────────────────────────────────────────

def create_payout(
    *,
    merchant_id:    str,
    merchant_key:   str,
    environment:    str = "sandbox",
    order_id:       str,        # unique order/payout reference
    beneficiary_id: str,        # registered beneficiary ID
    amount:         str,        # string, major units e.g. "1500.00"
    currency:       str = "INR",
    purpose:        str = "Insurance Claim Reimbursement",
    remarks:        str = "",
) -> dict[str, Any]:
    """
    Initiate a PayTM payout to a registered beneficiary.
    Returns the PayTM transaction response including `orderId` and `status`.
    """
    if not merchant_id or not merchant_key:
        raise PaytmClientError("PayTM merchant credentials are not configured", code="unconfigured")

    params: dict[str, Any] = {
        "merchantId":     merchant_id,
        "orderId":        order_id,
        "beneficiaryId":  beneficiary_id,
        "amount":         str(amount),
        "currency":       currency,
        "purpose":        purpose,
        "requestId":      str(uuid.uuid4()),
    }
    if remarks:
        params["remarks"] = remarks[:255]
    params["checksum"] = _generate_checksum(params, merchant_key)

    url = f"{_base_url(environment)}/payout/v1/disburse"
    with httpx.Client(timeout=httpx.Timeout(READ_TIMEOUT)) as client:
        resp = client.post(
            url,
            json={"details": params},
            headers={"Content-Type": "application/json"},
        )
    return _raise_for_paytm(resp)


# ── Status check ──────────────────────────────────────────────────────────────

def get_payout_status(
    *,
    merchant_id:  str,
    merchant_key: str,
    environment:  str = "sandbox",
    order_id:     str,
) -> dict[str, Any]:
    """Poll status of an existing PayTM payout by orderId."""
    params: dict[str, Any] = {
        "merchantId": merchant_id,
        "orderId":    order_id,
        "requestId":  str(uuid.uuid4()),
    }
    params["checksum"] = _generate_checksum(params, merchant_key)

    url = f"{_base_url(environment)}/payout/v1/getTxnStatus"
    with httpx.Client(timeout=httpx.Timeout(CONNECT_TIMEOUT)) as client:
        resp = client.post(
            url,
            json={"details": params},
            headers={"Content-Type": "application/json"},
        )
    return _raise_for_paytm(resp)
