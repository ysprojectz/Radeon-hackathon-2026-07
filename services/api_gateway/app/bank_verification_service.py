"""Bank account verification orchestration for payout accounts."""

from __future__ import annotations

import json
import re
import uuid
from difflib import SequenceMatcher
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import text

from services.api_gateway.app.account_store import get_account_gateway_record, update_account, AccountUpdate
from services.api_gateway.app.gateway_config_store import get_config_with_secrets

TRUE_STATUSES = {"VERIFIED", "PENDING", "FAILED"}


def _clean(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _holder_match_score(expected: str, actual: str) -> Optional[float]:
    expected_clean = _clean(expected).upper()
    actual_clean = _clean(actual).upper()
    if not expected_clean or not actual_clean:
        return None
    return round(SequenceMatcher(None, expected_clean, actual_clean).ratio(), 4)


def _iban_checksum_valid(iban: Optional[str]) -> bool:
    compact = re.sub(r"\s+", "", str(iban or "")).upper()
    if not re.match(r"^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$", compact):
        return False
    rearranged = compact[4:] + compact[:4]
    digits = ""
    for char in rearranged:
        digits += str(ord(char) - 55) if char.isalpha() else char
    remainder = 0
    for char in digits:
        remainder = (remainder * 10 + int(char)) % 97
    return remainder == 1


def _record_attempt(db: Any, attempt: dict[str, Any]) -> dict[str, Any]:
    if db is None:
        return attempt
    db.execute(
        text(
            """
            INSERT INTO account_verification_attempts (
                id, tenant_id, account_id, provider, environment, request_id, status,
                status_reason, rail_type, bank_name, branch_name, account_holder_name,
                holder_match_score, provider_reference, provider_response, created_by
            ) VALUES (
                CAST(:id AS uuid), :tenant_id, CAST(:account_id AS uuid), :provider, :environment, :request_id, :status,
                :status_reason, :rail_type, :bank_name, :branch_name, :account_holder_name,
                :holder_match_score, :provider_reference, CAST(:provider_response AS jsonb), :created_by
            )
            """
        ),
        {**attempt, "provider_response": json.dumps(attempt.get("provider_response") or {})},
    )
    db.commit()
    return attempt


def _latest_attempt(db: Any, account_id: str, tenant_id: str) -> Optional[dict[str, Any]]:
    if db is None:
        return None
    row = db.execute(
        text(
            """
            SELECT *
            FROM account_verification_attempts
            WHERE account_id = CAST(:account_id AS uuid)
              AND tenant_id = :tenant_id
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"account_id": account_id, "tenant_id": tenant_id},
    ).first()
    if row is None:
        return None
    data = dict(row._mapping)
    for key in ("id", "account_id", "created_at"):
        if data.get(key) is not None:
            data[key] = str(data[key])
    return data


def list_attempts(db: Any, account_id: str, tenant_id: str, limit: int = 5) -> list[dict[str, Any]]:
    if db is None:
        return []
    rows = db.execute(
        text(
            """
            SELECT *
            FROM account_verification_attempts
            WHERE account_id = CAST(:account_id AS uuid)
              AND tenant_id = :tenant_id
            ORDER BY created_at DESC
            LIMIT :limit
            """
        ),
        {"account_id": account_id, "tenant_id": tenant_id, "limit": limit},
    ).fetchall()
    attempts: list[dict[str, Any]] = []
    for row in rows:
        data = dict(row._mapping)
        for key in ("id", "account_id", "created_at"):
            if data.get(key) is not None:
                data[key] = str(data[key])
        attempts.append(data)
    return attempts


def _attempt_base(account: dict[str, Any], actor: str, provider: str, environment: str, rail_type: str) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "tenant_id": account.get("tenant_id", "default"),
        "account_id": str(account["id"]),
        "provider": provider,
        "environment": environment,
        "request_id": f"ACOS-BV-{uuid.uuid4().hex[:18].upper()}",
        "status": "PENDING",
        "status_reason": "",
        "rail_type": rail_type,
        "bank_name": account.get("bank_name"),
        "branch_name": None,
        "account_holder_name": account.get("account_holder_name"),
        "holder_match_score": None,
        "provider_reference": None,
        "provider_response": {},
        "created_by": actor,
    }


def verify_account(db: Any, account_id: str, *, tenant_id: str, actor: str) -> dict[str, Any]:
    account = get_account_gateway_record(db, account_id, tenant_id=tenant_id)
    market = str(account.get("market_region") or "").upper()

    if market == "INDIA":
        attempt = _verify_india_account(db, account, actor)
    else:
        attempt = _verify_gcc_account(db, account, actor)

    _record_attempt(db, attempt)
    update_account(
        db,
        account_id,
        AccountUpdate(verification_status=attempt["status"], notes=attempt.get("status_reason")),
        actor=actor,
        tenant_id=tenant_id,
    )
    return attempt


def _verify_india_account(db: Any, account: dict[str, Any], actor: str) -> dict[str, Any]:
    cfg = get_config_with_secrets(db, account.get("tenant_id", "default"), "paytm")
    attempt = _attempt_base(account, actor, "paytm", cfg.get("environment", "preproduction"), "UPI" if account.get("upi_vpa") else "BANK")

    if not (account.get("account_number") and account.get("ifsc_code")) and not account.get("upi_vpa"):
        attempt.update({"status": "PENDING", "status_reason": "India verification requires the full decryptable account number + IFSC or UPI/VPA. Legacy masked-only records must be recaptured before provider validation."})
        return attempt
    if not cfg.get("is_enabled") or not cfg.get("paytm_merchant_id") or not cfg.get("paytm_merchant_key") or not cfg.get("paytm_subwallet_guid"):
        cashfree_attempt = _verify_india_account_with_cashfree(db, account, actor)
        if cashfree_attempt is not None:
            return cashfree_attempt
        attempt.update({"status": "PENDING", "status_reason": "Paytm pre-production verification needs MID, merchant key, and subwallet GUID. Cashfree fallback is not enabled."})
        return attempt

    try:
        from services.api_gateway.app.gateway_clients.paytm_client import validate_beneficiary

        result = validate_beneficiary(
            merchant_id=cfg.get("paytm_merchant_id", ""),
            merchant_key=cfg.get("paytm_merchant_key", ""),
            environment=cfg.get("environment", "preproduction"),
            subwallet_guid=cfg.get("paytm_subwallet_guid", ""),
            order_id=attempt["request_id"],
            bank_account_no=account.get("account_number") or "",
            ifsc_code=account.get("ifsc_code") or "",
            upi_vpa=account.get("upi_vpa") or "",
        )
        status = str(result.get("status") or result.get("resultStatus") or "").upper()
        beneficiary_name = result.get("beneficiaryName") or result.get("accountHolderName") or result.get("name")
        attempt.update(
            {
                "status": "VERIFIED" if status == "SUCCESS" else ("PENDING" if status in {"ACCEPTED", "PENDING"} else "FAILED"),
                "status_reason": result.get("statusMessage") or result.get("resultMsg") or status or "Paytm verification response received",
                "account_holder_name": beneficiary_name or account.get("account_holder_name"),
                "holder_match_score": _holder_match_score(account.get("account_holder_name", ""), beneficiary_name or ""),
                "provider_reference": result.get("orderId") or result.get("txnId") or attempt["request_id"],
                "provider_response": result,
            }
        )
        return attempt
    except Exception as exc:
        cashfree_attempt = _verify_india_account_with_cashfree(db, account, actor, primary_error=str(exc))
        if cashfree_attempt is not None:
            return cashfree_attempt
        attempt.update({"status": "FAILED", "status_reason": str(exc), "provider_response": {"error": str(exc)}})
        return attempt


def _verify_india_account_with_cashfree(db: Any, account: dict[str, Any], actor: str, primary_error: str = "") -> Optional[dict[str, Any]]:
    cfg = get_config_with_secrets(db, account.get("tenant_id", "default"), "cashfree")
    if not cfg.get("is_enabled") or not cfg.get("cashfree_client_id") or not cfg.get("cashfree_client_secret"):
        return None
    if not (account.get("account_number") and account.get("ifsc_code")):
        return None
    attempt = _attempt_base(account, actor, "cashfree", cfg.get("environment", "preproduction"), "BANK")
    try:
        from services.api_gateway.app.gateway_clients.cashfree_client import verify_bank_account_async

        result = verify_bank_account_async(
            client_id=cfg.get("cashfree_client_id", ""),
            client_secret=cfg.get("cashfree_client_secret", ""),
            environment=cfg.get("environment", "preproduction"),
            bank_account=account.get("account_number") or "",
            ifsc=account.get("ifsc_code") or "",
            name=account.get("account_holder_name") or account.get("patient_name") or "",
            user_id=attempt["request_id"],
        )
        status_code = str(result.get("account_status_code") or result.get("account_status") or "").upper()
        final_status = "VERIFIED" if status_code in {"VALID", "VALID_ACCOUNT", "VALIDATION_SUCCESS", "VERIFIED"} else "PENDING"
        attempt.update(
            {
                "status": final_status,
                "status_reason": result.get("account_status_code") or result.get("account_status") or "Cashfree verification accepted",
                "provider_reference": str(result.get("reference_id") or attempt["request_id"]),
                "provider_response": {"primary_error": primary_error, **result} if primary_error else result,
            }
        )
        return attempt
    except Exception as exc:
        attempt.update({"status": "FAILED", "status_reason": f"Cashfree verification failed: {exc}", "provider_response": {"primary_error": primary_error, "cashfree_error": str(exc)}})
        return attempt


def _verify_gcc_account(db: Any, account: dict[str, Any], actor: str) -> dict[str, Any]:
    cfg = get_config_with_secrets(db, account.get("tenant_id", "default"), "stripe")
    attempt = _attempt_base(account, actor, "stripe", cfg.get("environment", "preproduction"), "IBAN")

    iban = account.get("iban")
    if not _iban_checksum_valid(iban):
        attempt.update({"status": "FAILED", "status_reason": "IBAN checksum validation failed", "provider_response": {"local_iban_checksum": "failed"}})
        return attempt

    attempt["provider_response"] = {"local_iban_checksum": "passed"}
    if not cfg.get("is_enabled") or not cfg.get("stripe_secret_key") or not cfg.get("stripe_account_id"):
        attempt.update({"status": "PENDING", "status_reason": "IBAN is structurally valid. Stripe pre-production credentials and connected account are required for provider validation."})
        return attempt

    try:
        from services.api_gateway.app.gateway_clients.stripe_client import register_bank_account

        country = str(account.get("market_region") or "UAE").upper()
        country_map = {"UAE": "AE", "KSA": "SA", "BAHRAIN": "BH", "OMAN": "OM", "QATAR": "QA", "KUWAIT": "KW"}
        currency_map = {"UAE": "AED", "KSA": "SAR", "BAHRAIN": "BHD", "OMAN": "OMR", "QATAR": "QAR", "KUWAIT": "KWD"}
        result = register_bank_account(
            secret_key=cfg.get("stripe_secret_key", ""),
            account_id=cfg.get("stripe_account_id", ""),
            country=country_map.get(country, "AE"),
            currency=currency_map.get(country, "AED"),
            routing_number=account.get("swift_bic") or "",
            account_number=iban or "",
            account_holder_name=account.get("account_holder_name") or "",
        )
        stripe_status = str(result.get("status") or "").lower()
        attempt.update(
            {
                "status": "VERIFIED" if stripe_status in {"validated", "verified"} else "PENDING",
                "status_reason": f"Stripe external account status: {stripe_status or 'new'}",
                "bank_name": result.get("bank_name") or account.get("bank_name"),
                "account_holder_name": result.get("account_holder_name") or account.get("account_holder_name"),
                "holder_match_score": _holder_match_score(account.get("account_holder_name", ""), result.get("account_holder_name") or ""),
                "provider_reference": result.get("id"),
                "provider_response": {**attempt["provider_response"], **result},
            }
        )
        return attempt
    except Exception as exc:
        attempt.update({"status": "PENDING", "status_reason": f"IBAN passed local checksum; Stripe provider validation pending/failed: {exc}", "provider_response": {**attempt["provider_response"], "stripe_error": str(exc)}})
        return attempt


def latest_attempt_for_account(db: Any, account_id: str, tenant_id: str) -> Optional[dict[str, Any]]:
    return _latest_attempt(db, account_id, tenant_id)
