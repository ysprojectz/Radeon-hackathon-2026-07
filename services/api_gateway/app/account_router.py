"""Customer payout account API routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from services.api_gateway.app.auth import CurrentUser, WRITE_ROLES, get_current_user, require_roles
from services.api_gateway.app.account_store import (
    AccountCreate,
    AccountListResponse,
    AccountResponse,
    AccountUpdate,
    create_account,
    delete_account,
    get_account,
    get_account_gateway_record,
    list_accounts,
    mark_gateway_sync,
    update_account,
)
from services.api_gateway.app.bank_verification_service import (
    list_attempts,
    verify_account as run_bank_verification,
)

router = APIRouter(prefix="/api/v1/accounts", tags=["Customer Accounts"])

_account_read  = get_current_user
_account_write = require_roles(*WRITE_ROLES, "API_CONSUMER")
_account_admin = require_roles("ADMIN", "SENIOR_ADJUSTER", "COMPLIANCE_OFFICER")

# Roles that can query across all market regions.
# All other roles are locked to their own market_region.
_GLOBAL_VIEW_ROLES = {"ADMIN", "SENIOR_ADJUSTER", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"}


def _get_sync_db():
    try:
        from shared.db_sync import get_sync_db

        return get_sync_db()
    except Exception:
        return None


def _tenant(user: CurrentUser) -> str:
    return user.tenant_id or "default"


class VerificationRequest(BaseModel):
    status: str = Field(pattern="^(UNVERIFIED|PENDING|VERIFIED|FAILED|BLOCKED)$")
    notes: Optional[str] = None


class GatewaySyncRequest(BaseModel):
    gateway: str = Field(pattern="^(stripe|paytm|cashfree)$")
    status: str = Field(pattern="^(NOT_SYNCED|SYNCING|SYNCED|SYNC_FAILED)$")
    error: Optional[str] = None


@router.get("", response_model=AccountListResponse, summary="List customer payout accounts")
async def list_customer_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    market_region: Optional[str] = None,
    verification_status: Optional[str] = None,
    member_number: Optional[str] = None,
    search: Optional[str] = None,
    current_user: CurrentUser = Depends(_account_read),
):
    # Non-global roles are locked to their own market region.
    # Global roles (ADMIN, SENIOR_ADJUSTER, etc.) may supply an explicit filter or see all.
    if current_user.role not in _GLOBAL_VIEW_ROLES:
        effective_region = current_user.market_region or "UAE"
    else:
        effective_region = market_region  # None → no filter (all regions)

    db = _get_sync_db()
    try:
        return list_accounts(
            db,
            tenant_id=_tenant(current_user),
            page=page,
            page_size=page_size,
            market_region=effective_region,
            verification_status=verification_status,
            member_number=member_number,
            search=search,
        )
    finally:
        if db is not None:
            db.close()


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED, summary="Create payout account")
async def create_customer_account(
    body: AccountCreate,
    current_user: CurrentUser = Depends(_account_write),
):
    db = _get_sync_db()
    try:
        return create_account(db, body, actor=current_user.email, tenant_id=_tenant(current_user))
    finally:
        if db is not None:
            db.close()


@router.get("/{account_id}", response_model=AccountResponse, summary="Get payout account")
async def get_customer_account(
    account_id: str,
    current_user: CurrentUser = Depends(_account_read),
):
    db = _get_sync_db()
    try:
        return get_account(db, account_id, tenant_id=_tenant(current_user))
    finally:
        if db is not None:
            db.close()


@router.patch("/{account_id}", response_model=AccountResponse, summary="Update payout account")
async def update_customer_account(
    account_id: str,
    body: AccountUpdate,
    current_user: CurrentUser = Depends(_account_write),
):
    db = _get_sync_db()
    try:
        return update_account(db, account_id, body, actor=current_user.email, tenant_id=_tenant(current_user))
    finally:
        if db is not None:
            db.close()


@router.post("/{account_id}/verify", response_model=AccountResponse, summary="Set account verification status")
async def verify_customer_account(
    account_id: str,
    body: VerificationRequest,
    current_user: CurrentUser = Depends(_account_admin),
):
    patch = AccountUpdate(verification_status=body.status, notes=body.notes)
    db = _get_sync_db()
    try:
        return update_account(db, account_id, patch, actor=current_user.email, tenant_id=_tenant(current_user))
    finally:
        if db is not None:
            db.close()


@router.post("/{account_id}/bank-verification", response_model=AccountResponse, summary="Run bank account verification")
async def run_customer_account_bank_verification(
    account_id: str,
    current_user: CurrentUser = Depends(_account_admin),
):
    db = _get_sync_db()
    try:
        tenant_id = _tenant(current_user)
        run_bank_verification(db, account_id, tenant_id=tenant_id, actor=current_user.email)
        return get_account(db, account_id, tenant_id=tenant_id)
    finally:
        if db is not None:
            db.close()


@router.get("/{account_id}/bank-verification", summary="List bank verification attempts")
async def list_customer_account_bank_verifications(
    account_id: str,
    current_user: CurrentUser = Depends(_account_read),
):
    db = _get_sync_db()
    try:
        return {"attempts": list_attempts(db, account_id, tenant_id=_tenant(current_user))}
    finally:
        if db is not None:
            db.close()


@router.post("/{account_id}/gateway-sync", response_model=AccountResponse, summary="Update gateway sync status")
async def update_gateway_sync_status(
    account_id: str,
    body: GatewaySyncRequest,
    current_user: CurrentUser = Depends(_account_admin),
):
    db = _get_sync_db()
    try:
        tenant_id = _tenant(current_user)
        # If the request is to mark it as SYNCING or SYNCED, let's actually perform the sync
        external_account_id = None
        if body.status in ("SYNCING", "SYNCED"):
            account = get_account_gateway_record(db, account_id, tenant_id=tenant_id)
            
            from services.api_gateway.app.gateway_config_store import get_config_with_secrets
            cfg = get_config_with_secrets(db, tenant_id, body.gateway)
            if not cfg.get("is_enabled"):
                body.status = "SYNC_FAILED"
                body.error = f"{body.gateway.title()} gateway is not enabled"
            elif not cfg.get("is_ready"):
                body.status = "SYNC_FAILED"
                body.error = f"{body.gateway.title()} gateway is not ready — test connection first"
            
            try:
                if body.status == "SYNC_FAILED":
                    raise RuntimeError(body.error)
                if body.gateway == "stripe":
                    from services.api_gateway.app.gateway_clients.stripe_client import register_bank_account

                    raw_account_number = account.get("account_number") or account.get("iban")
                    routing_number = account.get("routing_number") or account.get("swift_bic") or account.get("ifsc_code") or ""
                    if not raw_account_number:
                        raise ValueError("Stripe sync requires an IBAN or decryptable account number")
                    result = register_bank_account(
                        secret_key=cfg.get("stripe_secret_key", ""),
                        account_id=cfg.get("stripe_account_id", ""),
                        country="AE" if account.get("market_region") != "INDIA" else "IN",
                        currency="AED" if account.get("market_region") != "INDIA" else "INR",
                        routing_number=routing_number,
                        account_number=raw_account_number,
                        account_holder_name=account.get("account_holder_name", "")
                    )
                    external_account_id = result.get("id")
                elif body.gateway == "paytm":
                    from services.api_gateway.app.gateway_clients.paytm_client import add_beneficiary
                    add_beneficiary(
                        merchant_id=cfg.get("paytm_merchant_id", ""),
                        merchant_key=cfg.get("paytm_merchant_key", ""),
                        environment=cfg.get("environment", "sandbox"),
                        beneficiary_id=account_id,
                        beneficiary_name=account.get("account_holder_name", ""),
                        bank_account_no=account.get("account_number") or account.get("iban") or "",
                        ifsc_code=account.get("ifsc_code", ""),
                        upi_vpa=account.get("upi_vpa", "")
                    )
                body.status = "SYNCED"
                body.error = None
            except Exception as e:
                import logging
                logging.getLogger(__name__).error("Gateway sync failed: %s", e)
                body.status = "SYNC_FAILED"
                body.error = str(e)
                
        return mark_gateway_sync(
            db,
            account_id,
            gateway=body.gateway,
            status_value=body.status,
            error=body.error,
            tenant_id=tenant_id,
            external_account_id=external_account_id,
        )
    finally:
        if db is not None:
            db.close()


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete payout account")
async def delete_customer_account(
    account_id: str,
    current_user: CurrentUser = Depends(_account_admin),
):
    db = _get_sync_db()
    try:
        delete_account(db, account_id, tenant_id=_tenant(current_user))
    finally:
        if db is not None:
            db.close()
