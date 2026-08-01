"""Customer payout account storage and validation."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import text

logger = logging.getLogger(__name__)

ACCOUNT_TYPES = {"SAVINGS", "CURRENT", "CHECKING", "NRE", "NRO", "WALLET", "UPI", "OTHER"}
CAPTURE_SOURCES = {"OCR_AUTO", "OCR_REVIEWED", "MANUAL", "ADVANCE_PROCESSING", "PATIENT_PORTAL"}
VERIFICATION_STATUSES = {"UNVERIFIED", "PENDING", "VERIFIED", "FAILED", "BLOCKED"}
GATEWAY_SYNC_STATUSES = {"NOT_SYNCED", "SYNCING", "SYNCED", "SYNC_FAILED"}
MARKETS = {"UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT", "INDIA"}

IBAN_RE = re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
SWIFT_RE = re.compile(r"^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$")
UPI_RE = re.compile(r"^[A-Za-z0-9.\-_]{3,50}@[A-Za-z]{3,20}$")
DIGITS_RE = re.compile(r"\D+")

_MEMORY_ACCOUNTS: dict[str, dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_blank(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def _normalize_upper(value: Optional[str]) -> Optional[str]:
    stripped = _normalize_blank(value)
    return stripped.upper() if stripped else None


def _mask_account_number(account_number: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    digits = DIGITS_RE.sub("", account_number or "")
    if not digits:
        return None, None, None
    if len(digits) < 4 or len(digits) > 18:
        raise HTTPException(status_code=422, detail="Account number must contain 4 to 18 digits")

    fingerprint_secret = os.getenv("ACCOUNT_FINGERPRINT_SECRET", os.getenv("JWT_SECRET_KEY", "local-dev"))
    fingerprint = hashlib.sha256(f"{fingerprint_secret}:{digits}".encode()).hexdigest()
    last4 = digits[-4:]

    encryption_key = os.getenv("ACCOUNT_ENCRYPTION_KEY")
    if encryption_key:
        try:
            from cryptography.fernet import Fernet

            encrypted = "fernet:" + Fernet(encryption_key.encode()).encrypt(digits.encode()).decode()
            return encrypted, last4, fingerprint
        except Exception as exc:
            logger.warning("Account encryption failed; storing masked token only: %s", exc)

    return f"masked:{last4}", last4, fingerprint


def _decrypt_account_number(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    if token.startswith("fernet:"):
        encryption_key = os.getenv("ACCOUNT_ENCRYPTION_KEY")
        if not encryption_key:
            return None
        try:
            from cryptography.fernet import Fernet

            return Fernet(encryption_key.encode()).decrypt(token[7:].encode()).decode()
        except Exception as exc:
            logger.warning("Account number decryption failed: %s", exc)
            return None
    if token.startswith("masked:"):
        return None
    return token


def _mask_iban(value: Optional[str]) -> Optional[str]:
    compact = _normalize_upper(value)
    if not compact:
        return None
    return compact if len(compact) <= 8 else f"{compact[:4]}{'*' * max(len(compact) - 8, 0)}{compact[-4:]}"


def _mask_vpa(value: Optional[str]) -> Optional[str]:
    vpa = _normalize_blank(value)
    if not vpa or "@" not in vpa:
        return vpa
    local, provider = vpa.split("@", 1)
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}***@{provider}"


class AccountBase(BaseModel):
    tenant_id: str = Field(default="default", min_length=1, max_length=80)
    member_number: str = Field(min_length=2, max_length=50)
    claim_reference: Optional[str] = Field(default=None, max_length=50)
    patient_name: str = Field(min_length=2, max_length=255)
    market_region: str = "UAE"
    account_holder_name: str = Field(min_length=2, max_length=255)
    account_type: str = "SAVINGS"
    bank_name: Optional[str] = Field(default=None, max_length=255)
    iban: Optional[str] = Field(default=None, max_length=34)
    swift_bic: Optional[str] = Field(default=None, max_length=11)
    account_number: Optional[str] = Field(default=None, max_length=32)
    ifsc_code: Optional[str] = Field(default=None, max_length=11)
    upi_vpa: Optional[str] = Field(default=None, max_length=255)
    upi_provider: Optional[str] = Field(default=None, max_length=50)
    routing_number: Optional[str] = Field(default=None, max_length=20)
    sort_code: Optional[str] = Field(default=None, max_length=10)
    bsb_number: Optional[str] = Field(default=None, max_length=10)
    branch_address: Optional[str] = None
    capture_source: str = "MANUAL"
    ocr_confidence: Optional[float] = Field(default=None, ge=0, le=1)
    raw_ocr_text: Optional[str] = None
    is_primary: bool = True
    notes: Optional[str] = None

    @field_validator("market_region", mode="before")
    @classmethod
    def normalize_market(cls, value: str) -> str:
        normalized = _normalize_upper(value) or "UAE"
        if normalized == "SAUDI":
            normalized = "KSA"
        if normalized not in MARKETS:
            raise ValueError(f"market_region must be one of {sorted(MARKETS)}")
        return normalized

    @field_validator("account_type", mode="before")
    @classmethod
    def normalize_account_type(cls, value: str) -> str:
        normalized = _normalize_upper(value) or "SAVINGS"
        if normalized not in ACCOUNT_TYPES:
            raise ValueError(f"account_type must be one of {sorted(ACCOUNT_TYPES)}")
        return normalized

    @field_validator("capture_source", mode="before")
    @classmethod
    def normalize_capture_source(cls, value: str) -> str:
        normalized = _normalize_upper(value) or "MANUAL"
        if normalized not in CAPTURE_SOURCES:
            raise ValueError(f"capture_source must be one of {sorted(CAPTURE_SOURCES)}")
        return normalized

    @model_validator(mode="after")
    def normalize_payment_rails(self):
        self.tenant_id = self.tenant_id.strip() or "default"
        self.member_number = self.member_number.strip()
        self.claim_reference = _normalize_upper(self.claim_reference)
        self.patient_name = self.patient_name.strip()
        self.account_holder_name = self.account_holder_name.strip()
        self.bank_name = _normalize_blank(self.bank_name)
        self.iban = _normalize_upper(self.iban)
        self.swift_bic = _normalize_upper(self.swift_bic)
        self.ifsc_code = _normalize_upper(self.ifsc_code)
        self.upi_vpa = _normalize_blank(self.upi_vpa)
        self.upi_provider = _normalize_blank(self.upi_provider)
        self.routing_number = _normalize_blank(self.routing_number)
        self.sort_code = _normalize_blank(self.sort_code)
        self.bsb_number = _normalize_blank(self.bsb_number)
        self.branch_address = _normalize_blank(self.branch_address)
        self.notes = _normalize_blank(self.notes)

        if self.iban and not IBAN_RE.match(self.iban.replace(" ", "")):
            raise ValueError("iban must be a valid ISO 13616 value")
        if self.swift_bic and not SWIFT_RE.match(self.swift_bic):
            raise ValueError("swift_bic must be 8 or 11 characters")
        if self.ifsc_code and not IFSC_RE.match(self.ifsc_code):
            raise ValueError("ifsc_code must be a valid 11-character IFSC")
        if self.upi_vpa and not UPI_RE.match(self.upi_vpa):
            raise ValueError("upi_vpa must be a valid UPI/VPA address")

        if self.market_region == "INDIA":
            if not ((self.account_number and self.ifsc_code) or self.upi_vpa):
                raise ValueError("India accounts require account number + IFSC or a UPI/VPA")
        elif self.market_region in {"UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT"}:
            if not self.iban:
                raise ValueError("GCC accounts require an IBAN")

        return self


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    account_holder_name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    account_type: Optional[str] = None
    bank_name: Optional[str] = Field(default=None, max_length=255)
    iban: Optional[str] = Field(default=None, max_length=34)
    swift_bic: Optional[str] = Field(default=None, max_length=11)
    account_number: Optional[str] = Field(default=None, max_length=32)
    ifsc_code: Optional[str] = Field(default=None, max_length=11)
    upi_vpa: Optional[str] = Field(default=None, max_length=255)
    upi_provider: Optional[str] = Field(default=None, max_length=50)
    verification_status: Optional[str] = None
    is_primary: Optional[bool] = None
    notes: Optional[str] = None

    @field_validator("account_type", mode="before")
    @classmethod
    def normalize_account_type(cls, value: Optional[str]) -> Optional[str]:
        normalized = _normalize_upper(value)
        if normalized and normalized not in ACCOUNT_TYPES:
            raise ValueError(f"account_type must be one of {sorted(ACCOUNT_TYPES)}")
        return normalized

    @field_validator("verification_status", mode="before")
    @classmethod
    def normalize_verification_status(cls, value: Optional[str]) -> Optional[str]:
        normalized = _normalize_upper(value)
        if normalized and normalized not in VERIFICATION_STATUSES:
            raise ValueError(f"verification_status must be one of {sorted(VERIFICATION_STATUSES)}")
        return normalized


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tenant_id: str = "default"
    member_number: str
    claim_reference: Optional[str] = None
    patient_name: str
    market_region: str
    account_holder_name: str
    account_type: str
    bank_name: Optional[str] = None
    iban: Optional[str] = None
    swift_bic: Optional[str] = None
    account_number_last4: Optional[str] = None
    ifsc_code: Optional[str] = None
    upi_vpa: Optional[str] = None
    upi_provider: Optional[str] = None
    capture_source: str
    ocr_confidence: Optional[float] = None
    is_primary: bool
    verification_status: str
    verified_at: Optional[str] = None
    verified_by: Optional[str] = None
    gateway_summary: str
    stripe_sync_status: str
    paytm_sync_status: str
    cashfree_sync_status: str = "NOT_SYNCED"
    created_at: str
    updated_at: str
    created_by: Optional[str] = None
    notes: Optional[str] = None
    latest_verification_attempt: Optional[dict[str, Any]] = None


class AccountListResponse(BaseModel):
    accounts: list[AccountResponse]
    total: int
    page: int
    page_size: int
    summary: dict[str, int]


def _gateway_summary(record: dict[str, Any]) -> str:
    statuses = [
        record.get("stripe_sync_status") or "NOT_SYNCED",
        record.get("paytm_sync_status") or "NOT_SYNCED",
        record.get("cashfree_sync_status") or "NOT_SYNCED",
    ]
    if all(status == "SYNCED" for status in statuses):
        return "FULLY_SYNCED"
    if any(status == "SYNCED" for status in statuses):
        return "PARTIAL_SYNC"
    if any(status == "SYNC_FAILED" for status in statuses):
        return "SYNC_FAILED"
    return "NOT_SYNCED"


def _row_to_record(row: Any) -> dict[str, Any]:
    data = dict(row._mapping if hasattr(row, "_mapping") else row)
    for key in ("id", "created_at", "updated_at", "verified_at"):
        if data.get(key) is not None:
            data[key] = str(data[key])
    if isinstance(data.get("latest_verification_attempt"), str):
        try:
            import json
            data["latest_verification_attempt"] = json.loads(data["latest_verification_attempt"])
        except Exception:
            data["latest_verification_attempt"] = None
    data.setdefault("stripe_sync_status", "NOT_SYNCED")
    data.setdefault("paytm_sync_status", "NOT_SYNCED")
    data.setdefault("cashfree_sync_status", "NOT_SYNCED")
    data["gateway_summary"] = data.get("gateway_summary") or _gateway_summary(data)
    data["account_number_last4"] = data.get("account_number_last4")
    if not data["account_number_last4"] and str(data.get("account_number_enc") or "").startswith("masked:"):
        data["account_number_last4"] = str(data["account_number_enc"]).split(":", 1)[1]
    return data


def get_account_gateway_record(db: Any, account_id: str, tenant_id: Optional[str] = None) -> dict[str, Any]:
    """Return internal account fields needed for gateway sync and payout execution."""
    if db is None:
        record = _MEMORY_ACCOUNTS.get(account_id)
        if not record or (tenant_id and record.get("tenant_id", "default") != tenant_id):
            raise HTTPException(status_code=404, detail="Account not found")
        data = dict(record)
    else:
        tenant_clause = "AND tenant_id = :tenant_id" if tenant_id else ""
        row = db.execute(
            text(
                f"""
                SELECT *
                FROM customer_accounts
                WHERE id = :id
                {tenant_clause}
                """
            ),
            {"id": account_id, "tenant_id": tenant_id},
        ).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Account not found")
        data = _row_to_record(row)

    data["account_number"] = _decrypt_account_number(data.get("account_number_enc"))
    return data


def _response_from_record(record: dict[str, Any]) -> AccountResponse:
    safe = dict(record)
    safe.pop("account_number_enc", None)
    safe.pop("account_fingerprint", None)
    safe["iban"] = _mask_iban(safe.get("iban"))
    safe["upi_vpa"] = _mask_vpa(safe.get("upi_vpa"))
    return AccountResponse(**safe)


def _require_db(db: Any):
    if db is None:
        raise HTTPException(status_code=503, detail="Database persistence is unavailable")


def create_account(db: Any, payload: AccountCreate, actor: str, tenant_id: Optional[str] = None) -> AccountResponse:
    account_number_enc, account_number_last4, account_fingerprint = _mask_account_number(payload.account_number)
    account_id = str(uuid.uuid4())
    now = _now_iso()
    data = payload.model_dump(exclude={"account_number"})
    data["tenant_id"] = tenant_id or data.get("tenant_id") or "default"
    record = {
        **data,
        "id": account_id,
        "account_number_enc": account_number_enc,
        "account_number_last4": account_number_last4,
        "account_fingerprint": account_fingerprint,
        "verification_status": "UNVERIFIED",
        "verified_at": None,
        "verified_by": None,
        "stripe_sync_status": "NOT_SYNCED",
        "paytm_sync_status": "NOT_SYNCED",
        "cashfree_sync_status": "NOT_SYNCED",
        "created_at": now,
        "updated_at": now,
        "created_by": actor,
    }

    if db is None:
        if payload.is_primary:
            for candidate in _MEMORY_ACCOUNTS.values():
                if (
                    candidate.get("tenant_id", "default") == record["tenant_id"]
                    and candidate.get("member_number") == payload.member_number
                ):
                    candidate["is_primary"] = False
        _MEMORY_ACCOUNTS[account_id] = record
        return _response_from_record({**record, "gateway_summary": _gateway_summary(record)})

    if payload.is_primary:
        db.execute(
            text("UPDATE customer_accounts SET is_primary = false WHERE tenant_id = :tenant_id AND member_number = :member_number"),
            {"tenant_id": record["tenant_id"], "member_number": payload.member_number},
        )

    db.execute(
        text(
            """
            INSERT INTO customer_accounts (
                id, tenant_id, member_number, claim_reference, patient_name, market_region,
                account_holder_name, account_type, bank_name, iban, swift_bic,
                account_number_enc, account_number_last4, account_fingerprint,
                ifsc_code, upi_vpa, upi_provider, routing_number, sort_code,
                bsb_number, branch_address, capture_source, ocr_confidence,
                raw_ocr_text, is_primary, verification_status, created_by, notes
            ) VALUES (
                :id, :tenant_id, :member_number, :claim_reference, :patient_name, :market_region,
                :account_holder_name, :account_type, :bank_name, :iban, :swift_bic,
                :account_number_enc, :account_number_last4, :account_fingerprint,
                :ifsc_code, :upi_vpa, :upi_provider, :routing_number, :sort_code,
                :bsb_number, :branch_address, :capture_source, :ocr_confidence,
                :raw_ocr_text, :is_primary, :verification_status, :created_by, :notes
            )
            """
        ),
        record,
    )
    db.commit()
    return get_account(db, account_id)


def get_account(db: Any, account_id: str, tenant_id: Optional[str] = None) -> AccountResponse:
    if db is None:
        record = _MEMORY_ACCOUNTS.get(account_id)
        if not record or (tenant_id and record.get("tenant_id", "default") != tenant_id):
            raise HTTPException(status_code=404, detail="Account not found")
        return _response_from_record({**record, "gateway_summary": _gateway_summary(record)})

    tenant_clause = "AND ca.tenant_id = :tenant_id" if tenant_id else ""
    params = {"id": account_id, "tenant_id": tenant_id}
    row = db.execute(
        text(
            f"""
            SELECT ca.*, v.gateway_summary,
                   (
                       SELECT jsonb_build_object(
                           'id', ava.id,
                           'provider', ava.provider,
                           'environment', ava.environment,
                           'status', ava.status,
                           'status_reason', ava.status_reason,
                           'rail_type', ava.rail_type,
                           'bank_name', ava.bank_name,
                           'branch_name', ava.branch_name,
                           'account_holder_name', ava.account_holder_name,
                           'holder_match_score', ava.holder_match_score,
                           'provider_reference', ava.provider_reference,
                           'created_at', ava.created_at
                       )
                       FROM account_verification_attempts ava
                       WHERE ava.account_id = ca.id
                       ORDER BY ava.created_at DESC
                       LIMIT 1
                   ) AS latest_verification_attempt
            FROM customer_accounts ca
            LEFT JOIN v_account_summary v ON v.id = ca.id
            WHERE ca.id = :id
            {tenant_clause}
            """
        ),
        params,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return _response_from_record(_row_to_record(row))


def list_accounts(
    db: Any,
    *,
    tenant_id: str = "default",
    page: int = 1,
    page_size: int = 20,
    market_region: Optional[str] = None,
    verification_status: Optional[str] = None,
    member_number: Optional[str] = None,
    search: Optional[str] = None,
) -> AccountListResponse:
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    offset = (page - 1) * page_size
    market_region = _normalize_upper(market_region)
    verification_status = _normalize_upper(verification_status)
    member_number = _normalize_blank(member_number)
    search = _normalize_blank(search)

    if db is None:
        records = [r for r in _MEMORY_ACCOUNTS.values() if r.get("tenant_id", "default") == tenant_id]
        if market_region:
            records = [r for r in records if r.get("market_region") == market_region]
        if verification_status:
            records = [r for r in records if r.get("verification_status") == verification_status]
        if member_number:
            records = [r for r in records if r.get("member_number") == member_number]
        if search:
            s = search.lower()
            records = [
                r for r in records
                if s in str(r.get("patient_name", "")).lower()
                or s in str(r.get("account_holder_name", "")).lower()
                or s in str(r.get("member_number", "")).lower()
                or s in str(r.get("claim_reference", "")).lower()
            ]
        total = len(records)
        page_records = records[offset:offset + page_size]
        accounts = [_response_from_record({**r, "gateway_summary": _gateway_summary(r)}) for r in page_records]
        return AccountListResponse(accounts=accounts, total=total, page=page, page_size=page_size, summary=_summary(records))

    clauses = []
    clauses.append("ca.tenant_id = :tenant_id")
    params: dict[str, Any] = {"limit": page_size, "offset": offset, "tenant_id": tenant_id}
    if market_region:
        clauses.append("ca.market_region = :market_region")
        params["market_region"] = market_region
    if verification_status:
        clauses.append("ca.verification_status = :verification_status")
        params["verification_status"] = verification_status
    if member_number:
        clauses.append("ca.member_number = :member_number")
        params["member_number"] = member_number
    if search:
        clauses.append(
            "(ca.patient_name ILIKE :search OR ca.account_holder_name ILIKE :search OR "
            "ca.member_number ILIKE :search OR ca.claim_reference ILIKE :search)"
        )
        params["search"] = f"%{search}%"
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    rows = db.execute(
        text(
            f"""
            SELECT ca.*, v.gateway_summary,
                   (
                       SELECT jsonb_build_object(
                           'id', ava.id,
                           'provider', ava.provider,
                           'environment', ava.environment,
                           'status', ava.status,
                           'status_reason', ava.status_reason,
                           'rail_type', ava.rail_type,
                           'bank_name', ava.bank_name,
                           'branch_name', ava.branch_name,
                           'account_holder_name', ava.account_holder_name,
                           'holder_match_score', ava.holder_match_score,
                           'provider_reference', ava.provider_reference,
                           'created_at', ava.created_at
                       )
                       FROM account_verification_attempts ava
                       WHERE ava.account_id = ca.id
                       ORDER BY ava.created_at DESC
                       LIMIT 1
                   ) AS latest_verification_attempt
            FROM customer_accounts ca
            LEFT JOIN v_account_summary v ON v.id = ca.id
            {where}
            ORDER BY ca.updated_at DESC, ca.created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).fetchall()
    total = db.execute(text(f"SELECT COUNT(*) FROM customer_accounts ca {where}"), params).scalar() or 0
    summary_rows = db.execute(
        text(
            f"""
            SELECT ca.verification_status, COUNT(*) AS count
            FROM customer_accounts ca
            {where}
            GROUP BY ca.verification_status
            """
        ),
        params,
    ).fetchall()
    summary = {status_name: 0 for status_name in VERIFICATION_STATUSES}
    for row in summary_rows:
        summary[str(row[0])] = int(row[1])
    return AccountListResponse(
        accounts=[_response_from_record(_row_to_record(row)) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
        summary=summary,
    )


def _summary(records: list[dict[str, Any]]) -> dict[str, int]:
    summary = {status_name: 0 for status_name in VERIFICATION_STATUSES}
    for record in records:
        status_name = record.get("verification_status", "UNVERIFIED")
        summary[status_name] = summary.get(status_name, 0) + 1
    return summary


def update_account(db: Any, account_id: str, patch: AccountUpdate, actor: str, tenant_id: Optional[str] = None) -> AccountResponse:
    existing = get_account(db, account_id, tenant_id=tenant_id)
    patch_data = patch.model_dump(exclude_unset=True)
    if not patch_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    account_number = patch_data.pop("account_number", None)
    if account_number:
        enc, last4, fingerprint = _mask_account_number(account_number)
        patch_data["account_number_enc"] = enc
        patch_data["account_number_last4"] = last4
        patch_data["account_fingerprint"] = fingerprint

    if "iban" in patch_data and patch_data["iban"]:
        patch_data["iban"] = patch_data["iban"].replace(" ", "").upper()
    if "swift_bic" in patch_data and patch_data["swift_bic"]:
        patch_data["swift_bic"] = patch_data["swift_bic"].upper()
    if "ifsc_code" in patch_data and patch_data["ifsc_code"]:
        patch_data["ifsc_code"] = patch_data["ifsc_code"].upper()

    if patch_data.get("verification_status") == "VERIFIED":
        patch_data["verified_at"] = _now_iso()
        patch_data["verified_by"] = actor
    elif patch_data.get("verification_status") in {"FAILED", "BLOCKED", "UNVERIFIED"}:
        patch_data["verified_at"] = None
        patch_data["verified_by"] = None

    if db is None:
        record = _MEMORY_ACCOUNTS[account_id]
        if patch_data.get("is_primary"):
            for candidate in _MEMORY_ACCOUNTS.values():
                if candidate.get("member_number") == record.get("member_number"):
                    candidate["is_primary"] = False
        record.update(patch_data)
        record["updated_at"] = _now_iso()
        _MEMORY_ACCOUNTS[account_id] = record
        return _response_from_record({**record, "gateway_summary": _gateway_summary(record)})

    if patch_data.get("is_primary"):
        db.execute(
            text("UPDATE customer_accounts SET is_primary = false WHERE tenant_id = :tenant_id AND member_number = :member_number AND id <> :id"),
            {"tenant_id": getattr(existing, "tenant_id", "default"), "member_number": existing.member_number, "id": account_id},
        )

    assignments = ", ".join(f"{key} = :{key}" for key in patch_data)
    tenant_clause = "AND tenant_id = :_tenant_id" if tenant_id else ""
    params = {**patch_data, "id": account_id, "_tenant_id": tenant_id}
    db.execute(
        text(f"UPDATE customer_accounts SET {assignments} WHERE id = :id {tenant_clause}"),
        params,
    )
    db.commit()
    return get_account(db, account_id, tenant_id=tenant_id)


def delete_account(db: Any, account_id: str, tenant_id: Optional[str] = None) -> None:
    if db is None:
        record = _MEMORY_ACCOUNTS.get(account_id)
        if not record or (tenant_id and record.get("tenant_id", "default") != tenant_id):
            raise HTTPException(status_code=404, detail="Account not found")
        del _MEMORY_ACCOUNTS[account_id]
        return

    where_tenant = "AND tenant_id = :tenant_id" if tenant_id else ""
    result = db.execute(
        text(f"DELETE FROM customer_accounts WHERE id = :id {where_tenant}"),
        {"id": account_id, "tenant_id": tenant_id},
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Account not found")


def mark_gateway_sync(
    db: Any,
    account_id: str,
    gateway: str,
    status_value: str,
    error: Optional[str] = None,
    tenant_id: Optional[str] = None,
    external_account_id: Optional[str] = None,
) -> AccountResponse:
    gateway = _normalize_blank(gateway)
    status_value = _normalize_upper(status_value) or "NOT_SYNCED"
    if gateway not in {"stripe", "paytm", "cashfree"}:
        raise HTTPException(status_code=422, detail="gateway must be 'stripe', 'paytm', or 'cashfree'")
    if status_value not in GATEWAY_SYNC_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {sorted(GATEWAY_SYNC_STATUSES)}")

    now = _now_iso() if status_value == "SYNCED" else None
    patch = {
        f"{gateway}_sync_status": status_value,
        f"{gateway}_synced_at": now,
        f"{gateway}_sync_error": error,
    }
    if gateway == "stripe" and external_account_id:
        patch["stripe_bank_account_id"] = external_account_id
    if db is None:
        record = _MEMORY_ACCOUNTS.get(account_id)
        if not record or (tenant_id and record.get("tenant_id", "default") != tenant_id):
            raise HTTPException(status_code=404, detail="Account not found")
        _MEMORY_ACCOUNTS[account_id].update(patch)
        _MEMORY_ACCOUNTS[account_id]["updated_at"] = _now_iso()
        return _response_from_record({**_MEMORY_ACCOUNTS[account_id], "gateway_summary": _gateway_summary(_MEMORY_ACCOUNTS[account_id])})

    db.execute(
        text(
            f"""
            UPDATE customer_accounts
            SET {gateway}_sync_status = :sync_status,
                {gateway}_synced_at = :synced_at,
                {gateway}_sync_error = :sync_error
                {", stripe_bank_account_id = :external_account_id" if gateway == "stripe" and external_account_id else ""}
            WHERE id = :id
            {"AND tenant_id = :tenant_id" if tenant_id else ""}
            """
        ),
        {
            "sync_status": status_value,
            "synced_at": now,
            "sync_error": error,
            "external_account_id": external_account_id,
            "id": account_id,
            "tenant_id": tenant_id,
        },
    )
    db.commit()
    return get_account(db, account_id, tenant_id=tenant_id)


def account_payload_from_claim(claim_data: dict[str, Any], *, claim_reference: Optional[str], actor: str) -> Optional[AccountCreate]:
    account_holder = _normalize_blank(claim_data.get("bank_account_holder")) or _normalize_blank(claim_data.get("account_holder_name"))
    iban = _normalize_blank(claim_data.get("iban"))
    account_number = _normalize_blank(claim_data.get("account_number"))
    ifsc_code = _normalize_blank(claim_data.get("ifsc_code"))
    upi_vpa = _normalize_blank(claim_data.get("upi_vpa"))
    capture_source = _normalize_upper(claim_data.get("account_capture_source")) or "OCR_AUTO"
    if not any([iban, account_number, upi_vpa]):
        return None

    try:
        return AccountCreate(
            member_number=claim_data.get("member_number") or "UNKNOWN",
            claim_reference=claim_reference,
            patient_name=claim_data.get("patient_name") or account_holder or "Unknown Patient",
            market_region=claim_data.get("market_region") or "UAE",
            account_holder_name=account_holder or claim_data.get("patient_name") or "Unknown Account Holder",
            account_type=claim_data.get("account_type") or ("UPI" if upi_vpa and not account_number else "SAVINGS"),
            bank_name=claim_data.get("bank_name"),
            iban=iban,
            swift_bic=claim_data.get("swift_bic"),
            account_number=account_number,
            ifsc_code=ifsc_code,
            upi_vpa=upi_vpa,
            upi_provider=claim_data.get("upi_provider"),
            capture_source=capture_source,
            ocr_confidence=claim_data.get("account_ocr_confidence") or claim_data.get("_ocr_confidence"),
            raw_ocr_text=claim_data.get("account_raw_ocr_text"),
            notes=f"Auto-captured from claim by {actor}",
        )
    except Exception as exc:
        logger.info("Skipping account auto-capture: %s", exc)
        return None


def create_account_from_claim_if_present(db: Any, claim_data: dict[str, Any], *, claim_reference: Optional[str], actor: str, tenant_id: str = "default") -> Optional[AccountResponse]:
    payload = account_payload_from_claim(claim_data, claim_reference=claim_reference, actor=actor)
    if payload is None:
        return None
    try:
        return create_account(db, payload, actor, tenant_id=tenant_id)
    except Exception as exc:
        logger.warning("Account auto-capture failed for claim %s: %s", claim_reference, exc)
        return None
