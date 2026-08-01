"""
Payment Gateway Router
=======================
All endpoints under /api/v1/gateway/*.

Endpoints:
  GET    /api/v1/gateway/config              — list all gateway configs (masked)
  GET    /api/v1/gateway/config/{gateway}    — get single config (masked)
  PUT    /api/v1/gateway/config/{gateway}    — save credentials (ADMIN only)
  POST   /api/v1/gateway/config/{gateway}/test — test connection (ADMIN only)

  POST   /api/v1/gateway/payouts             — initiate payout (ADMIN / COMPLIANCE)
  GET    /api/v1/gateway/payouts             — list payout history
  GET    /api/v1/gateway/payouts/{id}        — get single payout

  POST   /api/v1/gateway/webhook/stripe      — Stripe webhook receiver
  POST   /api/v1/gateway/webhook/paytm       — PayTM webhook receiver
  POST   /api/v1/gateway/webhook/cashfree    — Cashfree webhook receiver
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from services.api_gateway.app.auth import CurrentUser, get_current_user, require_roles
from services.api_gateway.app import gateway_config_store as cfg_store

logger = logging.getLogger(__name__)

router    = APIRouter(prefix="/api/v1/gateway", tags=["Payment Gateways"])
_admin    = require_roles("ADMIN")
_disburse = require_roles("ADMIN", "COMPLIANCE_OFFICER")
_read     = get_current_user

VALID_GATEWAYS = {"stripe", "paytm", "cashfree"}
GATEWAY_ENV_PATTERN = "^(sandbox|preproduction|production)$"


def _sync_db():
    try:
        from shared.db_sync import get_sync_db
        return get_sync_db()
    except Exception:
        return None


def _tenant(user: CurrentUser) -> str:
    return user.tenant_id or "default"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_gateway(gateway: str) -> str:
    if gateway not in VALID_GATEWAYS:
        raise HTTPException(status_code=422, detail=f"gateway must be one of {sorted(VALID_GATEWAYS)}")
    return gateway


# ── Pydantic models ───────────────────────────────────────────────────────────

class StripeConfigInput(BaseModel):
    environment:           str  = Field(default="preproduction", pattern=GATEWAY_ENV_PATTERN)
    is_enabled:            bool = False
    stripe_publishable_key: str = Field(default="", max_length=120)
    stripe_secret_key:     str  = Field(default="", max_length=120)
    stripe_webhook_secret: str  = Field(default="", max_length=120)
    stripe_account_id:     str  = Field(default="", max_length=120)


class PaytmConfigInput(BaseModel):
    environment:      str  = Field(default="preproduction", pattern=GATEWAY_ENV_PATTERN)
    is_enabled:       bool = False
    paytm_merchant_id:  str = Field(default="", max_length=80)
    paytm_merchant_key: str = Field(default="", max_length=120)
    paytm_subwallet_guid: str = Field(default="", max_length=120)
    paytm_website:      str = Field(default="WEBSTAGING", max_length=80)
    paytm_industry_type: str = Field(default="Retail", max_length=40)
    paytm_channel_id:   str = Field(default="WEB", max_length=20)


class CashfreeConfigInput(BaseModel):
    environment: str = Field(default="preproduction", pattern=GATEWAY_ENV_PATTERN)
    is_enabled: bool = False
    cashfree_client_id: str = Field(default="", max_length=120)
    cashfree_client_secret: str = Field(default="", max_length=160)


class PayoutRequest(BaseModel):
    account_id:      str = Field(min_length=36, max_length=36)
    gateway:         str = Field(default="auto", pattern="^(stripe|paytm|cashfree|auto)$")
    amount_minor:    int = Field(gt=0, description="Amount in minor currency unit (fils/paise/cents)")
    currency:        str = Field(default="AED", min_length=3, max_length=3, pattern="^[A-Z]{3}$")
    claim_reference: Optional[str] = Field(default=None, max_length=50)
    customer_phone:  Optional[str] = Field(default=None, min_length=8, max_length=20)
    description:     str = Field(default="Insurance claim reimbursement", max_length=255)


class PaytmTransactionRequest(BaseModel):
    order_id:     str = Field(min_length=3, max_length=50)
    amount:       str = Field(pattern=r"^\d+(\.\d{1,2})?$")
    customer_id:  str = Field(min_length=2, max_length=64)
    callback_url: str = Field(min_length=10, max_length=255)
    currency:     str = Field(default="INR", min_length=3, max_length=3, pattern="^[A-Z]{3}$")


class CashfreeOrderRequest(BaseModel):
    order_amount: float = Field(gt=0)
    order_currency: str = Field(default="INR", min_length=3, max_length=3, pattern="^[A-Z]{3}$")
    order_id: str = Field(min_length=3, max_length=80)
    customer_id: str = Field(min_length=2, max_length=80)
    customer_phone: str = Field(min_length=8, max_length=20)
    return_url: str = Field(min_length=10, max_length=500)


# ── In-memory payout store (fallback when no DB) ──────────────────────────────
_MEMORY_PAYOUTS: dict[str, dict[str, Any]] = {}


# ── Config endpoints ──────────────────────────────────────────────────────────

@router.get("/config", summary="List all gateway configurations (credentials masked)")
async def list_gateway_configs(current_user: CurrentUser = Depends(_read)):
    db = _sync_db()
    try:
        return {"gateways": cfg_store.list_configs(db, _tenant(current_user))}
    finally:
        if db: db.close()


@router.get("/config/{gateway}", summary="Get gateway configuration (credentials masked)")
async def get_gateway_config(gateway: str, current_user: CurrentUser = Depends(_read)):
    _require_gateway(gateway)
    db = _sync_db()
    try:
        return cfg_store.get_config(db, _tenant(current_user), gateway)
    finally:
        if db: db.close()


@router.put("/config/stripe", summary="Save Stripe configuration (ADMIN only)")
async def save_stripe_config(body: StripeConfigInput, current_user: CurrentUser = Depends(_admin)):
    db = _sync_db()
    try:
        return cfg_store.save_config(db, _tenant(current_user), "stripe", body.model_dump(), actor=current_user.email)
    finally:
        if db: db.close()


@router.put("/config/paytm", summary="Save PayTM configuration (ADMIN only)")
async def save_paytm_config(body: PaytmConfigInput, current_user: CurrentUser = Depends(_admin)):
    db = _sync_db()
    try:
        return cfg_store.save_config(db, _tenant(current_user), "paytm", body.model_dump(), actor=current_user.email)
    finally:
        if db: db.close()


@router.put("/config/cashfree", summary="Save Cashfree verification configuration (ADMIN only)")
async def save_cashfree_config(body: CashfreeConfigInput, current_user: CurrentUser = Depends(_admin)):
    db = _sync_db()
    try:
        return cfg_store.save_config(db, _tenant(current_user), "cashfree", body.model_dump(), actor=current_user.email)
    finally:
        if db: db.close()


@router.post("/config/{gateway}/test", summary="Test gateway connection (ADMIN only)")
async def test_gateway_connection(gateway: str, current_user: CurrentUser = Depends(_admin)):
    _require_gateway(gateway)
    db  = _sync_db()
    tid = _tenant(current_user)
    try:
        cfg = cfg_store.get_config_with_secrets(db, tid, gateway)
    finally:
        if db: db.close()

    result: dict[str, Any] = {"gateway": gateway, "ok": False, "detail": ""}
    try:
        if gateway == "stripe":
            from services.api_gateway.app.gateway_clients.stripe_client import (
                test_connection, StripeClientError,
            )
            acct = test_connection(cfg.get("stripe_secret_key", ""))
            result.update({
                "ok":      True,
                "detail":  f"Connected — Stripe account {acct.get('id', '')} ({acct.get('country','')})",
                "account": {"id": acct.get("id"), "country": acct.get("country"), "email": acct.get("email")},
            })

        elif gateway == "paytm":
            from services.api_gateway.app.gateway_clients.paytm_client import (
                test_connection, PaytmClientError,
            )
            resp = test_connection(
                merchant_id=cfg.get("paytm_merchant_id", ""),
                merchant_key=cfg.get("paytm_merchant_key", ""),
                environment=cfg.get("environment", "sandbox"),
            )
            result.update({"ok": True, "detail": f"Connected — balance: {resp.get('balance', 'N/A')}"})

        elif gateway == "cashfree":
            if not cfg.get("cashfree_client_id") or not cfg.get("cashfree_client_secret"):
                raise RuntimeError("Cashfree client id and secret are not configured")
            result.update({
                "ok": True,
                "detail": "Configured — Cashfree verification endpoint https://sandbox.cashfree.com/verification/bank-account/async",
            })

    except Exception as exc:
        result.update({"ok": False, "detail": str(exc)})
        logger.warning("[GATEWAY] %s connection test FAILED: %s", gateway, exc)

    # Persist test result
    db2 = _sync_db()
    try:
        cfg_store.record_test_result(
            db2, tid, gateway,
            ok=result["ok"],
            error="" if result["ok"] else result["detail"],
        )
    finally:
        if db2: db2.close()

    return result


@router.post("/paytm/initiate-transaction", summary="Create a PayTM transaction token")
async def initiate_paytm_transaction(body: PaytmTransactionRequest, current_user: CurrentUser = Depends(_admin)):
    tid = _tenant(current_user)
    db = _sync_db()
    try:
        cfg = cfg_store.get_config_with_secrets(db, tid, "paytm")
    finally:
        if db:
            db.close()

    if not cfg.get("is_enabled"):
        raise HTTPException(status_code=409, detail="PayTM gateway is not enabled")
    if not cfg.get("is_ready"):
        raise HTTPException(status_code=409, detail="PayTM gateway is not ready — test connection first")

    from services.api_gateway.app.gateway_clients.paytm_client import initiate_transaction

    return initiate_transaction(
        merchant_id=cfg.get("paytm_merchant_id", ""),
        merchant_key=cfg.get("paytm_merchant_key", ""),
        website=cfg.get("paytm_website", "WEBSTAGING"),
        environment=cfg.get("environment", "sandbox"),
        order_id=body.order_id,
        amount=body.amount,
        customer_id=body.customer_id,
        callback_url=body.callback_url,
        currency=body.currency,
    )


@router.post("/cashfree/orders", summary="Create a Cashfree checkout order")
async def create_cashfree_checkout_order(body: CashfreeOrderRequest, current_user: CurrentUser = Depends(_admin)):
    tid = _tenant(current_user)
    db = _sync_db()
    try:
        cfg = cfg_store.get_config_with_secrets(db, tid, "cashfree")
    finally:
        if db:
            db.close()

    if not cfg.get("is_enabled"):
        raise HTTPException(status_code=409, detail="Cashfree gateway is not enabled")
    if not cfg.get("is_ready"):
        raise HTTPException(status_code=409, detail="Cashfree gateway is not ready — test configuration first")

    from services.api_gateway.app.gateway_clients.cashfree_client import create_order

    return create_order(
        client_id=cfg.get("cashfree_client_id", ""),
        client_secret=cfg.get("cashfree_client_secret", ""),
        environment=cfg.get("environment", "sandbox"),
        order_id=body.order_id,
        order_amount=body.order_amount,
        order_currency=body.order_currency,
        customer_id=body.customer_id,
        customer_phone=body.customer_phone,
        return_url=body.return_url,
    )


@router.get("/cashfree/orders/{order_id}/payments", summary="Get payments for a Cashfree checkout order")
async def get_cashfree_order_payments(order_id: str, current_user: CurrentUser = Depends(_admin)):
    tid = _tenant(current_user)
    db = _sync_db()
    try:
        cfg = cfg_store.get_config_with_secrets(db, tid, "cashfree")
    finally:
        if db:
            db.close()

    if not cfg.get("is_enabled"):
        raise HTTPException(status_code=409, detail="Cashfree gateway is not enabled")
    if not cfg.get("is_ready"):
        raise HTTPException(status_code=409, detail="Cashfree gateway is not ready — test configuration first")

    from services.api_gateway.app.gateway_clients.cashfree_client import get_order_payments

    return get_order_payments(
        client_id=cfg.get("cashfree_client_id", ""),
        client_secret=cfg.get("cashfree_client_secret", ""),
        environment=cfg.get("environment", "sandbox"),
        order_id=order_id,
    )


# ── Payout endpoints ──────────────────────────────────────────────────────────

@router.post("/payouts", status_code=status.HTTP_201_CREATED, summary="Initiate a payout (ADMIN / COMPLIANCE)")
async def initiate_payout(body: PayoutRequest, current_user: CurrentUser = Depends(_disburse)):
    tid = _tenant(current_user)
    db  = _sync_db()

    # Load gateway config with plaintext secrets
    try:
        if body.gateway == "auto":
            from services.api_gateway.app.account_store import get_account
            account = get_account(db, body.account_id, tenant_id=tid)
            region = account.get("market_region", "UAE").upper()
            
            import os, random
            ab_enabled = os.environ.get("AB_TESTING_ENABLED", "true").lower() == "true"
            
            if ab_enabled:
                body.gateway = random.choice(["stripe", "paytm"])
            else:
                body.gateway = "paytm" if region == "INDIA" else "stripe"

        cfg = cfg_store.get_config_with_secrets(db, tid, body.gateway)
    finally:
        if db: db.close()

    if not cfg.get("is_enabled"):
        raise HTTPException(status_code=409, detail=f"{body.gateway.title()} gateway is not enabled")
    if not cfg.get("is_ready"):
        raise HTTPException(status_code=409, detail=f"{body.gateway.title()} gateway is not ready — test connection first")

    payout_id = str(uuid.uuid4())
    now       = _now_iso()
    record: dict[str, Any] = {
        "id":              payout_id,
        "tenant_id":       tid,
        "account_id":      body.account_id,
        "gateway":         body.gateway,
        "environment":     cfg.get("environment", "sandbox"),
        "amount_minor":    body.amount_minor,
        "currency":        body.currency,
        "claim_reference": body.claim_reference,
        "status":          "PROCESSING",
        "gateway_txn_id":  None,
        "gateway_ref":     None,
        "failure_reason":  None,
        "initiated_at":    now,
        "completed_at":    None,
        "initiated_by":    current_user.email,
        "gateway_response": {},
    }

    try:
        if body.gateway == "stripe":
            record = await _execute_stripe_payout(cfg, body, record)
        elif body.gateway == "paytm":
            record = await _execute_paytm_payout(cfg, body, record)
        elif body.gateway == "cashfree":
            record = await _execute_cashfree_payout(cfg, body, record)
    except Exception as exc:
        record.update({"status": "FAILED", "failure_reason": str(exc)})
        logger.error("[GATEWAY] Payout %s failed: %s", payout_id, exc)

    # Persist to DB or memory
    _persist_payout(record)

    # Update the customer account gateway sync status
    _update_account_gateway_status(body.account_id, body.gateway, record["status"])

    return record


async def _execute_stripe_payout(cfg: dict, body: PayoutRequest, record: dict) -> dict:
    from services.api_gateway.app.gateway_clients.stripe_client import create_payout
    db = _sync_db()
    try:
        from services.api_gateway.app.account_store import get_account_gateway_record

        account = get_account_gateway_record(db, body.account_id, tenant_id=record["tenant_id"])
    finally:
        if db:
            db.close()

    bank_account_id = account.get("stripe_bank_account_id")
    if not bank_account_id:
        raise HTTPException(
            status_code=409,
            detail="Customer account is not synced to Stripe. Sync the account before initiating a Stripe payout.",
        )

    result = create_payout(
        secret_key=cfg["stripe_secret_key"],
        amount_minor=body.amount_minor,
        currency=body.currency,
        stripe_account_id=cfg.get("stripe_account_id", ""),
        bank_account_id=bank_account_id,
        description=body.description,
        metadata={"claim_reference": body.claim_reference or "", "payout_id": record["id"]},
    )
    record.update({
        "status":           _stripe_status(result.get("status", "")),
        "gateway_txn_id":   result.get("id"),
        "gateway_ref":      result.get("balance_transaction"),
        "gateway_response": result,
        "completed_at":     _now_iso() if result.get("status") == "paid" else None,
    })
    return record


async def _execute_paytm_payout(cfg: dict, body: PayoutRequest, record: dict) -> dict:
    from services.api_gateway.app.gateway_clients.paytm_client import create_payout
    # PayTM uses major units; convert fils/paise → major
    amount_major = f"{body.amount_minor / 100:.2f}"
    order_id     = f"PO-{record['id'][:8].upper()}"
    result = create_payout(
        merchant_id=cfg["paytm_merchant_id"],
        merchant_key=cfg["paytm_merchant_key"],
        environment=cfg.get("environment", "sandbox"),
        order_id=order_id,
        beneficiary_id=body.account_id,
        amount=amount_major,
        currency=body.currency,
        purpose=body.description,
        remarks=body.claim_reference or "",
    )
    paytm_status = result.get("status", "").upper()
    record.update({
        "status":           _paytm_status(paytm_status),
        "gateway_txn_id":   order_id,
        "gateway_ref":      result.get("txnId") or result.get("orderId"),
        "gateway_response": result,
        "completed_at":     _now_iso() if paytm_status == "SUCCESS" else None,
    })
    return record


async def _execute_cashfree_payout(cfg: dict, body: PayoutRequest, record: dict) -> dict:
    """Create a Cashfree checkout order for pre-production payout closure.

    Cashfree PG checkout is not a direct bank-payout rail. We still persist it in
    the payout ledger so sandbox/pre-production payment closure can be tracked
    by order id and completed by the Cashfree webhook.
    """
    from services.api_gateway.app.gateway_clients.cashfree_client import create_order

    if not body.customer_phone:
        raise HTTPException(status_code=422, detail="customer_phone is required for Cashfree checkout payouts")

    amount_major = body.amount_minor / 100
    order_id = f"ACOS-{record['id'][:12].upper()}"
    result = create_order(
        client_id=cfg.get("cashfree_client_id", ""),
        client_secret=cfg.get("cashfree_client_secret", ""),
        environment=cfg.get("environment", "sandbox"),
        order_id=order_id,
        order_amount=amount_major,
        order_currency=body.currency,
        customer_id=body.account_id,
        customer_phone=body.customer_phone,
        return_url=f"{os.getenv('FRONTEND_BASE_URL', 'http://localhost:3000')}/accounts?payout_id={record['id']}",
    )
    record.update({
        "status": "PROCESSING",
        "gateway_txn_id": order_id,
        "gateway_ref": result.get("payment_session_id") or result.get("cf_order_id"),
        "gateway_response": result,
    })
    return record


def _stripe_status(stripe_status: str) -> str:
    mapping = {"paid": "COMPLETED", "pending": "PROCESSING", "in_transit": "PROCESSING", "failed": "FAILED", "canceled": "CANCELLED"}
    return mapping.get(stripe_status.lower(), "PROCESSING")


def _paytm_status(paytm_status: str) -> str:
    mapping = {"SUCCESS": "COMPLETED", "PENDING": "PROCESSING", "FAILURE": "FAILED", "INITIATED": "PROCESSING"}
    return mapping.get(paytm_status.upper(), "PROCESSING")


def _persist_payout(record: dict) -> None:
    payout_id = record["id"]
    db = _sync_db()
    try:
        if db is not None:
            from sqlalchemy import text
            db.execute(text("""
                INSERT INTO gateway_payouts (
                    id, tenant_id, account_id, claim_reference, gateway, environment,
                    amount_minor, currency, gateway_txn_id, gateway_ref, gateway_response,
                    status, failure_reason, initiated_at, completed_at, initiated_by
                ) VALUES (
                    :id, :tenant_id, :account_id, :claim_reference, :gateway, :environment,
                    :amount_minor, :currency, :gateway_txn_id, :gateway_ref, :gateway_response::jsonb,
                    :status, :failure_reason, :initiated_at, :completed_at, :initiated_by
                )
            """), {**record, "gateway_response": __import__("json").dumps(record.get("gateway_response", {}))})
            db.commit()
            return
    except Exception as exc:
        logger.warning("Payout DB persist failed: %s", exc)
    finally:
        if db: db.close()
    _MEMORY_PAYOUTS[payout_id] = record


def _update_account_gateway_status(account_id: str, gateway: str, payout_status: str) -> None:
    if gateway not in {"stripe", "paytm", "cashfree"}:
        return
    sync_status = "SYNCED" if payout_status == "COMPLETED" else ("SYNC_FAILED" if payout_status == "FAILED" else "SYNCING")
    db = _sync_db()
    try:
        if db is not None:
            from services.api_gateway.app.account_store import mark_gateway_sync
            mark_gateway_sync(db, account_id, gateway=gateway, status_value=sync_status)
            return
        # Memory fallback
        from services.api_gateway.app.account_store import _MEMORY_ACCOUNTS, _gateway_summary
        if account_id in _MEMORY_ACCOUNTS:
            _MEMORY_ACCOUNTS[account_id][f"{gateway}_sync_status"] = sync_status
    except Exception as exc:
        logger.warning("Account gateway status update failed: %s", exc)
    finally:
        if db: db.close()


@router.get("/payouts", summary="List payout history")
async def list_payouts(
    page:            int = Query(1, ge=1),
    page_size:       int = Query(20, ge=1, le=100),
    gateway:         Optional[str] = None,
    payout_status:   Optional[str] = Query(None, alias="status"),
    claim_reference: Optional[str] = None,
    current_user:    CurrentUser   = Depends(_read),
):
    tid    = _tenant(current_user)
    db     = _sync_db()
    offset = (page - 1) * page_size
    try:
        if db is not None:
            from sqlalchemy import text
            clauses = ["tenant_id = :tid"]
            params: dict[str, Any] = {"tid": tid, "limit": page_size, "offset": offset}
            if gateway:
                clauses.append("gateway = :gw"); params["gw"] = gateway
            if payout_status:
                clauses.append("status = :st"); params["st"] = payout_status.upper()
            if claim_reference:
                clauses.append("claim_reference = :cr"); params["cr"] = claim_reference
            where = "WHERE " + " AND ".join(clauses)
            rows = db.execute(
                text(f"SELECT * FROM gateway_payouts {where} ORDER BY initiated_at DESC LIMIT :limit OFFSET :offset"),
                params,
            ).fetchall()
            total = db.execute(text(f"SELECT COUNT(*) FROM gateway_payouts {where}"), params).scalar() or 0
            return {"payouts": [dict(r._mapping) for r in rows], "total": int(total), "page": page, "page_size": page_size}
    finally:
        if db: db.close()

    # Memory fallback
    records = [r for r in _MEMORY_PAYOUTS.values() if r.get("tenant_id") == tid]
    if gateway:
        records = [r for r in records if r.get("gateway") == gateway]
    if payout_status:
        records = [r for r in records if r.get("status") == payout_status.upper()]
    if claim_reference:
        records = [r for r in records if r.get("claim_reference") == claim_reference]
    records.sort(key=lambda r: r.get("initiated_at", ""), reverse=True)
    total = len(records)
    return {"payouts": records[offset: offset + page_size], "total": total, "page": page, "page_size": page_size}


@router.get("/payouts/{payout_id}", summary="Get a single payout")
async def get_payout(payout_id: str, current_user: CurrentUser = Depends(_read)):
    db = _sync_db()
    try:
        if db is not None:
            from sqlalchemy import text
            row = db.execute(
                text("SELECT * FROM gateway_payouts WHERE id = :id AND tenant_id = :tid"),
                {"id": payout_id, "tid": _tenant(current_user)},
            ).first()
            if row is None:
                raise HTTPException(status_code=404, detail="Payout not found")
            return dict(row._mapping)
    finally:
        if db: db.close()
    rec = _MEMORY_PAYOUTS.get(payout_id)
    if not rec or rec.get("tenant_id") != _tenant(current_user):
        raise HTTPException(status_code=404, detail="Payout not found")
    return rec


# ── Webhook receivers ─────────────────────────────────────────────────────────

@router.post("/webhook/stripe", include_in_schema=False)
async def stripe_webhook(request: Request, stripe_signature: str = Header(None, alias="Stripe-Signature")):
    body = await request.body()
    db   = _sync_db()
    try:
        cfg = cfg_store.get_config_with_secrets(db, "default", "stripe")
    finally:
        if db: db.close()

    webhook_secret = cfg.get("stripe_webhook_secret", "")
    if webhook_secret:
        try:
            from services.api_gateway.app.gateway_clients.stripe_client import verify_webhook_signature
            event = verify_webhook_signature(body, stripe_signature or "", webhook_secret)
        except Exception as exc:
            logger.warning("[WEBHOOK/stripe] Signature verification failed: %s", exc)
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    else:
        try:
            import json
            event = json.loads(body)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid webhook payload")

    event_type = event.get("type", "")
    logger.info("[WEBHOOK/stripe] event=%s", event_type)

    if event_type == "payout.paid":
        _handle_stripe_payout_event(event, "COMPLETED")
    elif event_type in ("payout.failed", "payout.canceled"):
        _handle_stripe_payout_event(event, "FAILED")

    return {"received": True}


@router.post("/webhook/paytm", include_in_schema=False)
async def paytm_webhook(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    logger.info("[WEBHOOK/paytm] status=%s orderId=%s", payload.get("STATUS"), payload.get("ORDERID"))
    paytm_status = payload.get("STATUS", "").upper()
    order_id     = payload.get("ORDERID", "")
    if order_id and paytm_status in ("SUCCESS", "FAILED"):
        _handle_paytm_webhook(order_id, paytm_status)
    return {"received": True}


@router.post("/webhook/cashfree", include_in_schema=False)
async def cashfree_webhook(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    event_type = payload.get("type", "")
    payment_status = payload.get("data", {}).get("payment", {}).get("payment_status")
    order_id = (
        payload.get("data", {}).get("order", {}).get("order_id")
        or payload.get("data", {}).get("payment", {}).get("order_id")
        or payload.get("order_id")
    )
    logger.info("[WEBHOOK/cashfree] event=%s orderId=%s paymentStatus=%s", event_type, order_id, payment_status)
    if order_id and payment_status:
        _handle_cashfree_webhook(order_id, str(payment_status).upper())
    return {"received": True, "event_type": event_type, "order_id": order_id, "payment_status": payment_status}


def _handle_stripe_payout_event(event: dict, new_status: str) -> None:
    payout_obj = event.get("data", {}).get("object", {})
    txn_id     = payout_obj.get("id")
    if not txn_id:
        return
    if _update_payout_status_by_txn("stripe", txn_id, new_status):
        return
    for rec in _MEMORY_PAYOUTS.values():
        if rec.get("gateway_txn_id") == txn_id:
            rec["status"] = new_status
            if new_status == "COMPLETED":
                rec["completed_at"] = _now_iso()
            _update_account_gateway_status(rec["account_id"], "stripe", new_status)
            break


def _handle_paytm_webhook(order_id: str, paytm_status: str) -> None:
    new_status = "COMPLETED" if paytm_status == "SUCCESS" else "FAILED"
    if _update_payout_status_by_txn("paytm", order_id, new_status):
        return
    for rec in _MEMORY_PAYOUTS.values():
        if rec.get("gateway_txn_id") == order_id:
            rec["status"] = new_status
            if new_status == "COMPLETED":
                rec["completed_at"] = _now_iso()
            _update_account_gateway_status(rec["account_id"], "paytm", new_status)
            break


def _handle_cashfree_webhook(order_id: str, payment_status: str) -> None:
    new_status = "COMPLETED" if payment_status in {"SUCCESS", "PAID"} else (
        "FAILED" if payment_status in {"FAILED", "USER_DROPPED", "CANCELLED"} else "PROCESSING"
    )
    if new_status == "PROCESSING":
        return
    if _update_payout_status_by_txn("cashfree", order_id, new_status):
        return
    for rec in _MEMORY_PAYOUTS.values():
        if rec.get("gateway_txn_id") == order_id:
            rec["status"] = new_status
            if new_status == "COMPLETED":
                rec["completed_at"] = _now_iso()
            _update_account_gateway_status(rec["account_id"], "cashfree", new_status)
            break


def _update_payout_status_by_txn(gateway: str, gateway_txn_id: str, new_status: str) -> bool:
    db = _sync_db()
    try:
        if db is None:
            return False
        from sqlalchemy import text

        row = db.execute(
            text(
                """
                SELECT id, account_id
                FROM gateway_payouts
                WHERE gateway = :gateway AND gateway_txn_id = :gateway_txn_id
                ORDER BY initiated_at DESC
                LIMIT 1
                """
            ),
            {"gateway": gateway, "gateway_txn_id": gateway_txn_id},
        ).first()
        if row is None:
            return False
        completed_at = _now_iso() if new_status == "COMPLETED" else None
        failed_at = _now_iso() if new_status == "FAILED" else None
        db.execute(
            text(
                """
                UPDATE gateway_payouts
                SET status = :status,
                    completed_at = COALESCE(:completed_at, completed_at),
                    failed_at = COALESCE(:failed_at, failed_at)
                WHERE id = :id
                """
            ),
            {
                "status": new_status,
                "completed_at": completed_at,
                "failed_at": failed_at,
                "id": row.id,
            },
        )
        db.commit()
        _update_account_gateway_status(str(row.account_id), gateway, new_status)
        return True
    except Exception as exc:
        logger.warning("Payout webhook status update failed: %s", exc)
        return False
    finally:
        if db:
            db.close()
