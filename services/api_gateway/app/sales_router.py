"""
Sales Router
============
All endpoints under /api/v1/sales/* — authenticated access for sales data management.
Also includes admin reporting endpoints at /api/v1/admin/sales/*.

Endpoints (Sales):
  GET    /api/v1/sales/agents                    — list sales agents
  POST   /api/v1/sales/agents                    — create sales agent
  GET    /api/v1/sales/agents/{agent_id}         — get agent details
  PATCH  /api/v1/sales/agents/{agent_id}         — update agent
  DELETE /api/v1/sales/agents/{agent_id}         — deactivate agent

  GET    /api/v1/sales/policies                  — list policy_sales (with filters)
  GET    /api/v1/sales/policies/{sale_id}        — get policy sale details
  POST   /api/v1/sales/policies                  — create/update policy_sale
  PATCH  /api/v1/sales/policies/{sale_id}        — update policy_sale
  POST   /api/v1/sales/convert-quote/{quote_id}  — convert quote to sale

  GET    /api/v1/sales/quotes                    — list quotes
  POST   /api/v1/sales/quotes                    — create quote
  GET    /api/v1/sales/quotes/{quote_id}         — get quote
  PATCH  /api/v1/sales/quotes/{quote_id}         — update quote

  GET    /api/v1/sales/commissions               — list commissions (with filters)
  GET    /api/v1/sales/commissions/{comm_id}     — get commission
  PATCH  /api/v1/sales/commissions/{comm_id}     — update commission (mark paid)

  POST   /api/v1/sales/attribution               — record attribution data

Endpoints (Admin Reporting):
  GET    /api/v1/admin/sales/summary             — aggregated sales metrics
  GET    /api/v1/admin/sales/agent-performance   — agent leaderboard
  GET    /api/v1/admin/sales/reconciliation      — policy-to-sale reconciliation
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text as sa_text

from services.api_gateway.app.auth import require_roles, CurrentUser
from shared.db_sync import get_sync_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/sales", tags=["Sales"])
admin_router = APIRouter(prefix="/api/v1/admin/sales", tags=["Sales Admin"])
_admin_only = require_roles("ADMIN")


# ── Pydantic Models ──────────────────────────────────────────────────────────────

class SalesAgentBase(BaseModel):
    email: str
    full_name: str
    phone: Optional[str] = None
    license_number: Optional[str] = None
    agency_name: Optional[str] = None
    market_region: str = "UAE"
    is_active: bool = True

class SalesAgentCreate(SalesAgentBase):
    pass

class SalesAgentResponse(SalesAgentBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PolicySaleBase(BaseModel):
    policy_id: str
    agent_id: Optional[str] = None
    member_id: Optional[str] = None
    sale_date: date
    effective_date: date
    channel: str = "DIRECT"
    premium_amount: float
    commission_amount: float = 0.0
    commission_pct: float = 0.0
    status: str = "BOUND"
    quote_id: Optional[str] = None
    binder_number: Optional[str] = None
    tenant_id: str = "default"

    @field_validator("channel")
    @classmethod
    def validate_channel(cls, v):
        valid = {"DIRECT", "BROKER", "TPA", "ONLINE", "REFERRAL", "WALK_IN"}
        if v.upper() not in valid:
            raise ValueError(f"Channel must be one of {sorted(valid)}")
        return v.upper()

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        valid = {"QUOTED", "BOUND", "CANCELLED", "LAPSED", "EXPIRED"}
        if v.upper() not in valid:
            raise ValueError(f"Status must be one of {sorted(valid)}")
        return v.upper()


class PolicySaleResponse(PolicySaleBase):
    id: str
    created_at: datetime
    updated_at: datetime
    policy_number: Optional[str] = None
    member_name: Optional[str] = None

    class Config:
        from_attributes = True


class QuoteBase(BaseModel):
    member_id: Optional[str] = None
    policy_id: Optional[str] = None
    premium_quoted: float
    effective_date_proposed: Optional[date] = None
    expiry_date: Optional[date] = None
    status: str = "DRAFT"

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        valid = {"DRAFT", "SENT", "ACCEPTED", "DECLINED", "CONVERTED"}
        if v.upper() not in valid:
            raise ValueError(f"Status must be one of {sorted(valid)}")
        return v.upper()


class QuoteResponse(QuoteBase):
    id: str
    quote_reference: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CommissionBase(BaseModel):
    policy_sale_id: str
    agent_id: str
    amount: float
    currency: str = "AED"
    status: str = "PENDING"

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        valid = {"PENDING", "PAID", "ADJUSTED", "DISPUTED"}
        if v.upper() not in valid:
            raise ValueError(f"Status must be one of {sorted(valid)}")
        return v.upper()


class CommissionResponse(CommissionBase):
    id: str
    created_at: datetime
    updated_at: datetime
    paid_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AttributionBase(BaseModel):
    policy_sale_id: str
    source: str
    campaign_id: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    utm_term: Optional[str] = None
    attribution_data: dict = Field(default_factory=dict)


class AttributionResponse(AttributionBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True


class SalesSummaryResponse(BaseModel):
    total_policies_sold: int
    total_premium: float
    total_commission: float
    average_commission_pct: float
    by_channel: dict
    by_status: dict
    by_region: dict
    policies_this_month: int
    premium_this_month: float


class AgentPerformanceResponse(BaseModel):
    agent_id: str
    agent_name: str
    total_sales: int
    total_premium: float
    total_commission: float
    average_commission_pct: float
    policies_this_month: int


# ── Helpers ───────────────────────────────────────────────────────────────────────

def _row_to_dict(row):
    result = {}
    for k, v in dict(row).items():
        if isinstance(v, Decimal):
            result[k] = float(v)
        elif k.endswith("_id") or isinstance(v, (datetime, date)):
            result[k] = v
        else:
            result[k] = v
    return result


# ── Sales Agents ──────────────────────────────────────────────────────────────────

@router.get("/agents", response_model=list[SalesAgentResponse],
            summary="List sales agents")
async def list_agents(
    is_active: Optional[bool] = Query(None),
    region: Optional[str] = Query(None),
    _: CurrentUser = Depends(_admin_only),
):
    """List all sales agents with optional filters."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        query = "SELECT * FROM sales_agents WHERE TRUE"
        params = {}
        if is_active is not None:
            query += " AND is_active = :is_active"
            params["is_active"] = is_active
        if region:
            query += " AND market_region = :region"
            params["region"] = region.upper()
        rows = db.execute(sa_text(query), params).mappings().all()
        return [SalesAgentResponse(**_row_to_dict(r)) for r in rows]


@router.post("/agents", response_model=SalesAgentResponse,
             status_code=status.HTTP_201_CREATED,
             summary="Create sales agent")
async def create_agent(
    body: SalesAgentCreate,
    current_user: CurrentUser = Depends(_admin_only),
):
    """Create a new sales agent."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        try:
            result = db.execute(
                sa_text(
                    """INSERT INTO sales_agents
                       (id, email, full_name, phone, license_number,
                        agency_name, market_region, is_active, created_at, updated_at)
                       VALUES (uuid_generate_v4(), :email, :full_name, :phone,
                               :license_number, :agency_name, :market_region,
                               :is_active, NOW(), NOW())
                       RETURNING *"""
                ),
                {
                    "email": body.email,
                    "full_name": body.full_name,
                    "phone": body.phone,
                    "license_number": body.license_number,
                    "agency_name": body.agency_name,
                    "market_region": body.market_region.upper(),
                    "is_active": body.is_active,
                },
            ).mappings().first()
            db.commit()
            return SalesAgentResponse(**_row_to_dict(result))
        except Exception as e:
            db.rollback()
            if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                raise HTTPException(status_code=400, detail="Agent email already exists")
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/agents/{agent_id}", response_model=SalesAgentResponse,
            summary="Get agent details")
async def get_agent(
    agent_id: str,
    _: CurrentUser = Depends(_admin_only),
):
    """Get sales agent by ID."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        row = db.execute(
            sa_text("SELECT * FROM sales_agents WHERE id = CAST(:id AS uuid)"),
            {"id": agent_id},
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        return SalesAgentResponse(**_row_to_dict(row))


@router.patch("/agents/{agent_id}", response_model=SalesAgentResponse,
              summary="Update agent")
async def update_agent(
    agent_id: str,
    body: SalesAgentBase,
    current_user: CurrentUser = Depends(_admin_only),
):
    """Update sales agent details."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        update_fields = []
        params = {"id": agent_id}
        for field, value in body.model_dump(exclude_none=True).items():
            if field == "market_region":
                update_fields.append(f"{field} = :{field}_val")
                params[f"{field}_val"] = value.upper()
            else:
                update_fields.append(f"{field} = :{field}")
                params[field] = value
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        update_fields.append("updated_at = NOW()")
        query = f"UPDATE sales_agents SET {', '.join(update_fields)} WHERE id = CAST(:id AS uuid) RETURNING *"
        row = db.execute(sa_text(query), params).mappings().first()
        db.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        return SalesAgentResponse(**_row_to_dict(row))


# ── Policy Sales ──────────────────────────────────────────────────────────────────

@router.get("/policies", response_model=list[PolicySaleResponse],
            summary="List policy sales")
async def list_policy_sales(
    agent_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    _: CurrentUser = Depends(_admin_only),
):
    """List policy sales with optional filters."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        query = """
            SELECT ps.*, p.policy_number, m.first_name || ' ' || m.last_name as member_name
            FROM policy_sales ps
            LEFT JOIN policies p ON p.id = ps.policy_id
            LEFT JOIN members m ON m.id = ps.member_id
            WHERE TRUE
        """
        params = {}
        if agent_id:
            query += " AND ps.agent_id = CAST(:agent_id AS uuid)"
            params["agent_id"] = agent_id
        if status:
            query += " AND ps.status = :status"
            params["status"] = status.upper()
        if channel:
            query += " AND ps.channel = :channel"
            params["channel"] = channel.upper()
        if start_date:
            query += " AND ps.sale_date >= :start_date"
            params["start_date"] = start_date
        if end_date:
            query += " AND ps.sale_date <= :end_date"
            params["end_date"] = end_date
        rows = db.execute(sa_text(query), params).mappings().all()
        return [PolicySaleResponse(**_row_to_dict(r)) for r in rows]


@router.get("/policies/{sale_id}", response_model=PolicySaleResponse,
            summary="Get policy sale details")
async def get_policy_sale(
    sale_id: str,
    _: CurrentUser = Depends(_admin_only),
):
    """Get policy sale by ID."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        row = db.execute(
            sa_text("""
                SELECT ps.*, p.policy_number, m.first_name || ' ' || m.last_name as member_name
                FROM policy_sales ps
                LEFT JOIN policies p ON p.id = ps.policy_id
                LEFT JOIN members m ON m.id = ps.member_id
                WHERE ps.id = CAST(:id AS uuid)
            """),
            {"id": sale_id},
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Policy sale not found")
        return PolicySaleResponse(**_row_to_dict(row))


@router.post("/policies", response_model=PolicySaleResponse,
             status_code=status.HTTP_201_CREATED,
             summary="Create policy sale")
async def create_policy_sale(
    body: PolicySaleBase,
    current_user: CurrentUser = Depends(_admin_only),
):
    """Create a new policy sale record."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        try:
            result = db.execute(
                sa_text(
                    """INSERT INTO policy_sales
                       (id, policy_id, agent_id, member_id, sale_date, effective_date,
                        channel, premium_amount, commission_amount, commission_pct,
                        status, binder_number, signed_at, tenant_id, created_at, updated_at)
                       VALUES (uuid_generate_v4(), CAST(:policy_id AS uuid),
                               CAST(:agent_id AS uuid), CAST(:member_id AS uuid),
                               :sale_date, :effective_date, :channel,
                               :premium_amount, :commission_amount, :commission_pct,
                               :status, :binder_number, NOW(), :tenant_id, NOW(), NOW())
                       RETURNING *"""
                ),
                {
                    "policy_id": body.policy_id,
                    "agent_id": body.agent_id,
                    "member_id": body.member_id,
                    "sale_date": body.sale_date,
                    "effective_date": body.effective_date,
                    "channel": body.channel,
                    "premium_amount": body.premium_amount,
                    "commission_amount": body.commission_amount,
                    "commission_pct": body.commission_pct,
                    "status": body.status,
                    "binder_number": body.binder_number,
                    "tenant_id": body.tenant_id,
                },
            ).mappings().first()
            db.commit()
            return PolicySaleResponse(**_row_to_dict(result))
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=str(e))


@router.patch("/policies/{sale_id}", response_model=PolicySaleResponse,
              summary="Update policy sale")
async def update_policy_sale(
    sale_id: str,
    body: PolicySaleBase,
    current_user: CurrentUser = Depends(_admin_only),
):
    """Update policy sale details."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        update_fields = []
        params = {"id": sale_id}
        for field, value in body.model_dump(exclude_none=True).items():
            if field in ["policy_id", "agent_id", "member_id"]:
                update_fields.append(f"{field} = CAST(:{field} AS uuid)")
            elif field == "channel":
                update_fields.append(f"{field} = :{field}_val")
                params[f"{field}_val"] = value.upper()
            elif field == "status":
                update_fields.append(f"{field} = :{field}_val")
                params[f"{field}_val"] = value.upper()
            else:
                update_fields.append(f"{field} = :{field}")
                params[field] = value
        update_fields.append("updated_at = NOW()")
        query = f"UPDATE policy_sales SET {', '.join(update_fields)} WHERE id = CAST(:id AS uuid) RETURNING *"
        row = db.execute(sa_text(query), params).mappings().first()
        db.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Policy sale not found")
        return PolicySaleResponse(**_row_to_dict(row))


@router.post("/convert-quote/{quote_id}", response_model=PolicySaleResponse,
             summary="Convert quote to sale")
async def convert_quote_to_sale(
    quote_id: str,
    current_user: CurrentUser = Depends(_admin_only),
):
    """Convert an accepted quote to a policy sale."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        quote = db.execute(
            sa_text("SELECT * FROM quotes WHERE id = CAST(:id AS uuid)"),
            {"id": quote_id},
        ).mappings().first()
        if not quote:
            raise HTTPException(status_code=404, detail="Quote not found")
        if quote["status"] != "ACCEPTED":
            raise HTTPException(status_code=400, detail="Quote must be ACCEPTED to convert")
        result = db.execute(
            sa_text(
                """INSERT INTO policy_sales
                   (id, policy_id, agent_id, member_id, sale_date, effective_date,
                    channel, premium_amount, commission_amount, commission_pct,
                    status, quote_id, binder_number, signed_at, tenant_id, created_at, updated_at)
                   VALUES (uuid_generate_v4(), CAST(:policy_id AS uuid),
                           CAST(:agent_id AS uuid), CAST(:member_id AS uuid),
                           :sale_date, :effective_date, :channel,
                           :premium_amount, :commission_amount, :commission_pct,
                           'BOUND', :quote_id, :binder_number, NOW(), :tenant_id, NOW(), NOW())
                   RETURNING *"""
            ),
            {
                "policy_id": quote["policy_id"],
                "agent_id": None,
                "member_id": quote["member_id"],
                "sale_date": date.today(),
                "effective_date": quote["effective_date_proposed"] or date.today(),
                "channel": "DIRECT",
                "premium_amount": quote["premium_quoted"],
                "commission_amount": quote["premium_quoted"] * Decimal("0.05"),
                "commission_pct": 5.0,
                "quote_id": quote_id,
                "binder_number": f"BIND-{quote['quote_reference']}",
                "tenant_id": "default",
            },
        ).mappings().first()
        db.execute(
            sa_text("UPDATE quotes SET status = 'CONVERTED', converted_to_sale_id = CAST(:sale_id AS uuid) WHERE id = CAST(:id AS uuid)"),
            {"sale_id": result["id"], "id": quote_id},
        )
        db.commit()
        return PolicySaleResponse(**_row_to_dict(result))


# ── Quotes ───────────────────────────────────────────────────────────────────────

@router.get("/quotes", response_model=list[QuoteResponse],
            summary="List quotes")
async def list_quotes(
    status: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    _: CurrentUser = Depends(_admin_only),
):
    """List all quotes with optional filters."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        query = "SELECT * FROM quotes WHERE TRUE"
        params = {}
        if status:
            query += " AND status = :status"
            params["status"] = status.upper()
        if member_id:
            query += " AND member_id = CAST(:member_id AS uuid)"
            params["member_id"] = member_id
        rows = db.execute(sa_text(query), params).mappings().all()
        return [QuoteResponse(**_row_to_dict(r)) for r in rows]


@router.post("/quotes", response_model=QuoteResponse,
             status_code=status.HTTP_201_CREATED,
             summary="Create quote")
async def create_quote(
    body: QuoteBase,
    _: CurrentUser = Depends(_admin_only),
):
    """Create a new quote."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        result = db.execute(
            sa_text(
                """INSERT INTO quotes
                   (id, quote_reference, member_id, policy_id, premium_quoted,
                    effective_date_proposed, expiry_date, status, created_at, updated_at)
                   VALUES (uuid_generate_v4(), 'Q' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || LPAD((FLOOR(RANDOM() * 1000000))::text, 6, '0'),
                           CAST(:member_id AS uuid), CAST(:policy_id AS uuid),
                           :premium_quoted, :effective_date_proposed, :expiry_date,
                           :status, NOW(), NOW())
                   RETURNING *"""
            ),
            {
                "member_id": body.member_id,
                "policy_id": body.policy_id,
                "premium_quoted": body.premium_quoted,
                "effective_date_proposed": body.effective_date_proposed or date.today(),
                "expiry_date": body.expiry_date,
                "status": body.status.upper(),
            },
        ).mappings().first()
        db.commit()
        return QuoteResponse(**_row_to_dict(result))


# ── Commissions ───────────────────────────────────────────────────────────────────

@router.get("/commissions", response_model=list[CommissionResponse],
            summary="List commissions")
async def list_commissions(
    agent_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    _: CurrentUser = Depends(_admin_only),
):
    """List all commissions with optional filters."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        query = "SELECT * FROM commissions WHERE TRUE"
        params = {}
        if agent_id:
            query += " AND agent_id = CAST(:agent_id AS uuid)"
            params["agent_id"] = agent_id
        if status:
            query += " AND status = :status"
            params["status"] = status.upper()
        rows = db.execute(sa_text(query), params).mappings().all()
        return [CommissionResponse(**_row_to_dict(r)) for r in rows]


@router.patch("/commissions/{comm_id}", response_model=CommissionResponse,
              summary="Update commission")
async def update_commission(
    comm_id: str,
    status: str = Query(...),
    payment_reference: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(_admin_only),
):
    """Update commission status (e.g., mark as paid)."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        valid_status = {"PENDING", "PAID", "ADJUSTED", "DISPUTED"}
        if status.upper() not in valid_status:
            raise HTTPException(status_code=400, detail=f"Status must be one of {sorted(valid_status)}")
        set_clause = "status = :status, updated_at = NOW()"
        params = {"id": comm_id, "status": status.upper()}
        if status.upper() == "PAID":
            set_clause += ", paid_at = NOW()"
        if payment_reference:
            set_clause += ", payment_reference = :payment_reference"
            params["payment_reference"] = payment_reference
        result = db.execute(
            sa_text(f"UPDATE commissions SET {set_clause} WHERE id = CAST(:id AS uuid) RETURNING *"),
            params,
        ).mappings().first()
        db.commit()
        if not result:
            raise HTTPException(status_code=404, detail="Commission not found")
        return CommissionResponse(**_row_to_dict(result))


# ── Attribution ──────────────────────────────────────────────────────────────────

@router.post("/attribution", response_model=AttributionResponse,
             status_code=status.HTTP_201_CREATED,
             summary="Record attribution")
async def record_attribution(
    body: AttributionBase,
    _: CurrentUser = Depends(_admin_only),
):
    """Record marketing attribution for a policy sale."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        result = db.execute(
            sa_text(
                """INSERT INTO sales_attribution
                   (id, policy_sale_id, source, campaign_id, utm_source,
                    utm_medium, utm_campaign, utm_content, utm_term, attribution_data, created_at)
                   VALUES (uuid_generate_v4(), CAST(:policy_sale_id AS uuid),
                           :source, :campaign_id, :utm_source, :utm_medium,
                           :utm_campaign, :utm_content, :utm_term,
                           CAST(:attribution_data AS jsonb), NOW())
                   RETURNING *"""
            ),
            {
                "policy_sale_id": body.policy_sale_id,
                "source": body.source,
                "campaign_id": body.campaign_id,
                "utm_source": body.utm_source,
                "utm_medium": body.utm_medium,
                "utm_campaign": body.utm_campaign,
                "utm_content": body.utm_content,
                "utm_term": body.utm_term,
                "attribution_data": body.attribution_data,
            },
        ).mappings().first()
        db.commit()
        return AttributionResponse(**_row_to_dict(result))


# ── Admin Reporting ───────────────────────────────────────────────────────────────

@admin_router.get("/summary", response_model=SalesSummaryResponse,
                  summary="Sales summary report")
async def get_sales_summary(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    channel: Optional[str] = Query(None),
    _: CurrentUser = Depends(_admin_only),
):
    """Get aggregated sales metrics."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        params = {}
        where_clause = "WHERE TRUE"
        if start_date:
            where_clause += " AND ps.sale_date >= :start_date"
            params["start_date"] = start_date
        if end_date:
            where_clause += " AND ps.sale_date <= :end_date"
            params["end_date"] = end_date
        if channel:
            where_clause += " AND ps.channel = :channel"
            params["channel"] = channel.upper()

        summary_query = f"""
            SELECT COUNT(*) as total_policies,
                   COALESCE(SUM(ps.premium_amount), 0) as total_premium,
                   COALESCE(SUM(ps.commission_amount), 0) as total_commission,
                   CASE WHEN SUM(ps.premium_amount) > 0
                        THEN (SUM(ps.commission_amount) / NULLIF(SUM(ps.premium_amount), 0) * 100)
                        ELSE 0 END as avg_commission_pct
            FROM policy_sales ps
            {where_clause}
        """
        summary = db.execute(sa_text(summary_query), params).mappings().first()

        channel_query = f"""
            SELECT ps.channel,
                   COUNT(*) as count,
                   COALESCE(SUM(ps.premium_amount), 0) as premium,
                   COALESCE(SUM(ps.commission_amount), 0) as commission
            FROM policy_sales ps
            {where_clause}
            GROUP BY ps.channel
        """
        channels_result = db.execute(sa_text(channel_query), params).mappings().all()
        by_channel = {r["channel"]: {"count": r["count"], "premium": float(r["premium"]),
                                     "commission": float(r["commission"])} for r in channels_result}

        status_query = f"""
            SELECT ps.status,
                   COUNT(*) as count,
                   COALESCE(SUM(ps.premium_amount), 0) as premium
            FROM policy_sales ps
            {where_clause}
            GROUP BY ps.status
        """
        status_result = db.execute(sa_text(status_query), params).mappings().all()
        by_status = {r["status"]: {"count": r["count"], "premium": float(r["premium"])}
                     for r in status_result}

        region_query = f"""
            SELECT p.market_region,
                   COUNT(*) as count,
                   COALESCE(SUM(ps.premium_amount), 0) as premium
            FROM policy_sales ps
            JOIN policies p ON p.id = ps.policy_id
            {where_clause}
            GROUP BY p.market_region
        """
        region_result = db.execute(sa_text(region_query), params).mappings().all()
        by_region = {r["market_region"]: {"count": r["count"], "premium": float(r["premium"])}
                     for r in region_result}

        this_month_query = f"""
            SELECT COUNT(*) as count,
                   COALESCE(SUM(ps.premium_amount), 0) as premium
            FROM policy_sales ps
            {where_clause}
            AND DATE_TRUNC('month', ps.sale_date) = DATE_TRUNC('month', CURRENT_DATE)
        """
        this_month = db.execute(sa_text(this_month_query), params).mappings().first()

        return SalesSummaryResponse(
            total_policies_sold=int(summary["total_policies"]),
            total_premium=float(summary["total_premium"]),
            total_commission=float(summary["total_commission"]),
            average_commission_pct=float(summary["avg_commission_pct"]),
            by_channel=by_channel,
            by_status=by_status,
            by_region=by_region,
            policies_this_month=int(this_month["count"]),
            premium_this_month=float(this_month["premium"]),
        )


@admin_router.get("/agent-performance", response_model=list[AgentPerformanceResponse],
                  summary="Agent performance leaderboard")
async def get_agent_performance(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(_admin_only),
):
    """Get agent performance leaderboard."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        params = {}
        where_clause = "WHERE TRUE"
        if start_date:
            where_clause += " AND ps.sale_date >= :start_date"
            params["start_date"] = start_date
        if end_date:
            where_clause += " AND ps.sale_date <= :end_date"
            params["end_date"] = end_date

        query = f"""
            SELECT sa.id, sa.full_name as agent_name,
                   COUNT(ps.id) as total_sales,
                   COALESCE(SUM(ps.premium_amount), 0) as total_premium,
                   COALESCE(SUM(ps.commission_amount), 0) as total_commission,
                   CASE WHEN SUM(ps.premium_amount) > 0
                        THEN (SUM(ps.commission_amount) / NULLIF(SUM(ps.premium_amount), 0) * 100)
                        ELSE 0 END as avg_commission_pct,
                   COUNT(CASE WHEN DATE_TRUNC('month', ps.sale_date) = DATE_TRUNC('month', CURRENT_DATE)
                         THEN 1 END) as policies_this_month
            FROM sales_agents sa
            LEFT JOIN policy_sales ps ON ps.agent_id = sa.id {where_clause}
            GROUP BY sa.id, sa.full_name
            ORDER BY total_commission DESC
        """
        rows = db.execute(sa_text(query), params).mappings().all()
        result = []
        for r in rows:
            d = dict(r)
            d["total_premium"] = float(d["total_premium"])
            d["total_commission"] = float(d["total_commission"])
            d["average_commission_pct"] = float(d.pop("avg_commission_pct"))
            d["total_sales"] = int(d["total_sales"])
            d["policies_this_month"] = int(d["policies_this_month"])
            result.append(AgentPerformanceResponse(**d))
        return result


@admin_router.get("/reconciliation", summary="Policy-to-sale reconciliation")
async def get_reconciliation(
    current_user: CurrentUser = Depends(_admin_only),
):
    """Check for policies without corresponding sales records."""
    with get_sync_session() as db:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        missing = db.execute(
            sa_text(
                """SELECT p.id, p.policy_number, p.policy_name, p.effective_date,
                          p.market_region, m.member_number
                   FROM policies p
                   LEFT JOIN policy_sales ps ON ps.policy_id = p.id
                   LEFT JOIN members m ON m.policy_id = p.id AND m.relationship_to_subscriber = 'SELF'
                   WHERE ps.id IS NULL"""
            )
        ).mappings().all()
        orphaned = db.execute(
            sa_text(
                """SELECT ps.id, ps.policy_id, ps.premium_amount
                   FROM policy_sales ps
                   LEFT JOIN policies p ON p.id = ps.policy_id
                   WHERE p.id IS NULL"""
            )
        ).mappings().all()
        return {
            "policies_without_sales": len(missing),
            "missing_sales": [dict(r) for r in missing],
            "orphaned_sales": len(orphaned),
            "orphaned_sales_records": [dict(r) for r in orphaned],
        }
