"""
Pydantic v2 API schemas — request/response contracts for all services.
"""
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


# ═══════════════════════════════════════════
# CLAIM SCHEMAS
# ═══════════════════════════════════════════

class ClaimLineItemCreate(BaseModel):
    line_number: int
    procedure_code: str
    procedure_desc: Optional[str] = None
    service_category: str  # CONSULTATION, DIAGNOSTIC, LAB, PHARMACY, SURGERY, ROOM_RENT, etc.
    billed_amount: Decimal
    units: Decimal = Decimal("1")
    days: Optional[int] = None
    modifier_codes: Optional[list[str]] = None
    diagnosis_pointers: list[int] = [1]


class ClaimCreate(BaseModel):
    """Submit a new claim for adjudication."""
    claim_type: str  # INPATIENT, OUTPATIENT, DAYCARE, EMERGENCY, MATERNITY, DENTAL, OPTICAL, PHARMACY
    market_region: str  # UAE, KSA, INDIA, etc.
    currency: str  # AED, INR, SAR
    member_number: str
    patient_name: str
    patient_dob: date
    provider_code: str
    provider_name: str
    network_tier: str = "NETWORK"
    service_date: date
    admission_date: Optional[date] = None
    discharge_date: Optional[date] = None
    primary_diagnosis_code: str
    primary_diagnosis_desc: Optional[str] = None
    secondary_diagnosis_codes: Optional[list[str]] = None
    preauth_number: Optional[str] = None
    preauth_approved: Optional[bool] = None
    line_items: list[ClaimLineItemCreate]
    source_channel: str = "API"
    bank_account_holder: Optional[str] = None
    account_holder_name: Optional[str] = None
    account_type: Optional[str] = None
    bank_name: Optional[str] = None
    iban: Optional[str] = None
    swift_bic: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    upi_vpa: Optional[str] = None
    upi_provider: Optional[str] = None

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "claim_type": "OUTPATIENT",
            "market_region": "UAE",
            "currency": "AED",
            "member_number": "DAM-2024-100002",
            "patient_name": "Fatima Al Hashemi",
            "patient_dob": "1990-07-22",
            "provider_code": "UAE-003",
            "provider_name": "Burjeel Medical City",
            "network_tier": "NETWORK",
            "service_date": "2024-08-15",
            "primary_diagnosis_code": "J06.9",
            "primary_diagnosis_desc": "Acute upper respiratory infection",
            "line_items": [
                {"line_number": 1, "procedure_code": "99214", "procedure_desc": "Office visit", "service_category": "CONSULTATION", "billed_amount": 400.00},
                {"line_number": 2, "procedure_code": "71046", "procedure_desc": "Chest X-ray", "service_category": "DIAGNOSTIC", "billed_amount": 160.00},
            ],
        }
    })


class ClaimLineItemResponse(BaseModel):
    line_number: int
    procedure_code: str
    procedure_desc: Optional[str] = None
    service_category: str
    billed_amount: Decimal
    allowed_amount: Optional[Decimal] = None
    deductible_applied: Optional[Decimal] = None
    copay_amount: Optional[Decimal] = None
    coinsurance_amount: Optional[Decimal] = None
    plan_paid: Optional[Decimal] = None
    member_responsibility: Optional[Decimal] = None
    is_covered: Optional[bool] = None
    denial_code: Optional[str] = None
    denial_reason: Optional[str] = None
    sub_limit_applied: bool = False
    sub_limit_name: Optional[str] = None
    calculation_steps: Optional[list[dict]] = None
    clause_references: Optional[list[str]] = None


class ClaimResponse(BaseModel):
    id: str
    claim_reference: str
    status: str
    claim_type: str
    market_region: str
    currency: str
    member_number: str
    patient_name: str
    provider_name: str
    provider_code: str
    network_tier: str
    service_date: date
    admission_date: Optional[date] = None
    discharge_date: Optional[date] = None
    primary_diagnosis_code: str
    primary_diagnosis_desc: Optional[str] = None
    total_billed: Decimal
    total_allowed: Optional[Decimal] = None
    total_settlement: Optional[Decimal] = None
    total_member_responsibility: Optional[Decimal] = None
    confidence_score: Optional[Decimal] = None
    processing_time_ms: Optional[int] = None
    preauth_number: Optional[str] = None
    line_items: list[ClaimLineItemResponse] = []
    date_received: datetime
    date_adjudicated: Optional[datetime] = None
    date_settled: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class ClaimListResponse(BaseModel):
    claims: list[ClaimResponse]
    total: int
    page: int = 1
    page_size: int = 20


# ═══════════════════════════════════════════
# SETTLEMENT SCHEMAS
# ═══════════════════════════════════════════

class SettlementResponse(BaseModel):
    id: str
    claim_reference: str
    currency: str
    total_billed: Decimal
    total_allowed: Decimal
    total_deductible: Decimal
    total_copay: Decimal
    total_coinsurance_member: Decimal
    total_plan_payment: Decimal
    total_member_responsibility: Decimal
    confidence_score: Decimal
    model_version: str
    rules_engine_version: str
    was_hitl_reviewed: bool = False
    hitl_override_amount: Optional[Decimal] = None
    hitl_justification: Optional[str] = None
    calculation_breakdown: dict = {}
    policy_citations: list[dict] = []
    line_items: list[ClaimLineItemResponse] = []
    created_at: datetime


# ═══════════════════════════════════════════
# POLICY SCHEMAS
# ═══════════════════════════════════════════

class PolicyCreate(BaseModel):
    policy_number: str
    policy_name: str
    carrier_name: str
    tier: str
    market_region: str
    currency: str
    effective_date: date
    termination_date: Optional[date] = None
    annual_limit: Decimal
    individual_deductible: Decimal = Decimal("0")
    outpatient_copay_pct: int = 20
    outpatient_copay_max: Decimal = Decimal("50")
    inpatient_copay_flat: Decimal = Decimal("200")
    inpatient_copay_annual_max: Decimal = Decimal("500")
    pharmacy_copay_pct: int = 10
    diagnostic_copay_pct: int = 20
    room_rent_limit_type: str = "ANY"
    room_rent_daily_limit: Decimal = Decimal("0")
    ped_waiting_period_months: int = 6
    maternity_waiting_period_months: int = 24


class PolicyResponse(BaseModel):
    id: str
    policy_number: str
    policy_name: str
    carrier_name: str
    tier: str
    market_region: str
    currency: str
    effective_date: date
    termination_date: Optional[date] = None
    annual_limit: Decimal
    status: str
    benefit_summary: Optional[dict] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ═══════════════════════════════════════════
# MEMBER SCHEMAS
# ═══════════════════════════════════════════

class MemberResponse(BaseModel):
    id: str
    member_number: str
    first_name: str
    last_name: str
    date_of_birth: date
    gender: str
    nationality: Optional[str] = None
    market_region: str
    policy_id: Optional[str] = None
    group_number: Optional[str] = None
    coverage_start: date
    coverage_end: Optional[date] = None
    is_active: bool
    deductible_met: Decimal
    oop_met: Decimal
    model_config = ConfigDict(from_attributes=True)


# ═══════════════════════════════════════════
# HITL SCHEMAS
# ═══════════════════════════════════════════

class HITLQueueItem(BaseModel):
    id: str
    claim_reference: str
    claim_type: str
    patient_name: str
    provider_name: str
    total_billed: Decimal
    ai_settlement_amount: Decimal
    ai_confidence: Decimal
    trigger_reason: str
    status: str
    priority: int
    assigned_to: Optional[str] = None
    sla_deadline: datetime
    created_at: datetime
    pending_days_since: int = 0


class HITLDecisionCreate(BaseModel):
    decision: str  # APPROVE_AI, OVERRIDE_AMOUNT, DENY_CLAIM, ESCALATE, REQUEST_INFO
    override_amount: Optional[Decimal] = None
    justification: str
    reviewer_notes: Optional[str] = None


class HITLQueueResponse(BaseModel):
    items: list[HITLQueueItem]
    total: int
    pending_count: int
    overdue_count: int


# ═══════════════════════════════════════════
# AUDIT SCHEMAS
# ═══════════════════════════════════════════

class AuditLogEntry(BaseModel):
    id: str
    event_type: str
    timestamp: datetime
    actor_type: str
    actor_id: Optional[str] = None
    description: str
    event_data: dict = {}
    service_name: str
    entry_hash: str


class AuditTrailResponse(BaseModel):
    claim_reference: str
    entries: list[AuditLogEntry]
    chain_valid: bool
    total_entries: int


# ═══════════════════════════════════════════
# DASHBOARD / ANALYTICS
# ═══════════════════════════════════════════

class DashboardKPIs(BaseModel):
    total_claims: int
    claims_today: int
    avg_processing_time_ms: int
    auto_adjudication_rate: float  # percentage
    avg_confidence_score: float
    total_settled_amount: Decimal
    pending_hitl_count: int
    overdue_hitl_count: int
    denial_rate: float
    top_denial_reasons: list[dict] = []
    claims_by_status: dict = {}
    claims_by_market: dict = {}
    native_observability: dict = {}


# ═══════════════════════════════════════════
# COMMON
# ═══════════════════════════════════════════

class HealthResponse(BaseModel):
    service: str
    status: str = "healthy"
    version: str
    uptime_seconds: float


class ErrorResponse(BaseModel):
    error: str
    detail: str
    request_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ═══════════════════════════════════════════
# POLICY DOCUMENT UPLOAD (Two-Tier Architecture)
# ═══════════════════════════════════════════

class PolicyDocumentUploadResponse(BaseModel):
    """Response from POST /api/v1/policies/{policy_id}/document"""
    policy_id: str
    policy_number: str
    document_hash: str
    page_count: int
    clauses_extracted: int
    clauses_inserted: int
    ocr_engine_used: str
    llm_model_used: str
    processing_time_ms: int
    warnings: list[str] = []
    message: str = "Policy document processed successfully"
