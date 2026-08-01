"""
Domain models for the Claims Adjudication Engine.
Modeled after Daman National Health Insurance (UAE/GCC) and Star Health Insurance (India).
"""
import enum
import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import (
    String, Text, Numeric, Date, DateTime, Enum as SAEnum, ForeignKey,
    Index, Boolean, Integer, CheckConstraint
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from shared.database import Base
from typing import Optional


# ════════════════════════════════════════════
# ENUMS
# ════════════════════════════════════════════

class ClaimStatus(str, enum.Enum):
    RECEIVED = "RECEIVED"
    INTAKE_PROCESSING = "INTAKE_PROCESSING"
    INTAKE_COMPLETE = "INTAKE_COMPLETE"
    INTAKE_FAILED = "INTAKE_FAILED"
    POLICY_RETRIEVAL = "POLICY_RETRIEVAL"
    ADJUDICATING = "ADJUDICATING"
    ADJUDICATED = "ADJUDICATED"
    HITL_PENDING = "HITL_PENDING"
    HITL_IN_REVIEW = "HITL_IN_REVIEW"
    SETTLED = "SETTLED"
    APPEALED = "APPEALED"
    DENIED = "DENIED"
    ERROR = "ERROR"


class ClaimType(str, enum.Enum):
    INPATIENT = "INPATIENT"
    OUTPATIENT = "OUTPATIENT"
    DAYCARE = "DAYCARE"
    EMERGENCY = "EMERGENCY"
    MATERNITY = "MATERNITY"
    DENTAL = "DENTAL"
    OPTICAL = "OPTICAL"
    PHARMACY = "PHARMACY"


class PolicyTier(str, enum.Enum):
    BASIC = "BASIC"              # Daman Basic / Star Health Assure
    ENHANCED_SILVER = "ENHANCED_SILVER"  # Daman Smart Silver
    ENHANCED_GOLD = "ENHANCED_GOLD"      # Daman Smart Gold / Star Comprehensive
    PREMIER = "PREMIER"          # Daman Premier / Star Super Star
    THIQA = "THIQA"              # UAE Nationals only (Daman Thiqa)


class MarketRegion(str, enum.Enum):
    UAE = "UAE"
    KSA = "KSA"
    BAHRAIN = "BAHRAIN"
    OMAN = "OMAN"
    QATAR = "QATAR"
    KUWAIT = "KUWAIT"
    INDIA = "INDIA"


class Currency(str, enum.Enum):
    AED = "AED"
    SAR = "SAR"
    INR = "INR"
    BHD = "BHD"
    OMR = "OMR"
    QAR = "QAR"
    KWD = "KWD"


class NetworkTier(str, enum.Enum):
    NETWORK = "NETWORK"
    NON_NETWORK = "NON_NETWORK"
    CENTRES_OF_EXCELLENCE = "CENTRES_OF_EXCELLENCE"


class ClauseType(str, enum.Enum):
    BENEFIT = "BENEFIT"
    EXCLUSION = "EXCLUSION"
    LIMITATION = "LIMITATION"
    DEFINITION = "DEFINITION"
    GENERAL_PROVISION = "GENERAL_PROVISION"
    COPAY_COINSURANCE = "COPAY_COINSURANCE"
    DEDUCTIBLE = "DEDUCTIBLE"
    PREAUTHORIZATION = "PREAUTHORIZATION"
    SUB_LIMIT = "SUB_LIMIT"
    WAITING_PERIOD = "WAITING_PERIOD"
    COORDINATION_OF_BENEFITS = "COORDINATION_OF_BENEFITS"
    ROOM_RENT = "ROOM_RENT"


class AuditEventType(str, enum.Enum):
    CLAIM_RECEIVED = "CLAIM_RECEIVED"
    CLAIM_STATUS_CHANGE = "CLAIM_STATUS_CHANGE"
    OCR_COMPLETED = "OCR_COMPLETED"
    NLP_EXTRACTION_COMPLETED = "NLP_EXTRACTION_COMPLETED"
    POLICY_RETRIEVED = "POLICY_RETRIEVED"
    CLAUSES_IDENTIFIED = "CLAUSES_IDENTIFIED"
    REASONING_COMPLETED = "REASONING_COMPLETED"
    RULES_EVALUATED = "RULES_EVALUATED"
    SETTLEMENT_CALCULATED = "SETTLEMENT_CALCULATED"
    CONFIDENCE_SCORED = "CONFIDENCE_SCORED"
    HITL_ROUTED = "HITL_ROUTED"
    HITL_DECISION_MADE = "HITL_DECISION_MADE"
    SETTLEMENT_APPROVED = "SETTLEMENT_APPROVED"
    SETTLEMENT_OVERRIDDEN = "SETTLEMENT_OVERRIDDEN"
    REPORT_GENERATED = "REPORT_GENERATED"
    NOTIFICATION_SENT = "NOTIFICATION_SENT"
    APPEAL_RECEIVED = "APPEAL_RECEIVED"
    ERROR_OCCURRED = "ERROR_OCCURRED"


class HITLStatus(str, enum.Enum):
    PENDING = "PENDING"
    ASSIGNED = "ASSIGNED"
    IN_REVIEW = "IN_REVIEW"
    COMPLETED = "COMPLETED"
    ESCALATED = "ESCALATED"


class HITLDecision(str, enum.Enum):
    APPROVE_AI = "APPROVE_AI"
    OVERRIDE_AMOUNT = "OVERRIDE_AMOUNT"
    DENY_CLAIM = "DENY_CLAIM"
    ESCALATE = "ESCALATE"
    REQUEST_INFO = "REQUEST_INFO"


class HITLTrigger(str, enum.Enum):
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    MEDIUM_CONFIDENCE = "MEDIUM_CONFIDENCE"
    HIGH_VALUE = "HIGH_VALUE"
    POLICY_AMBIGUITY = "POLICY_AMBIGUITY"
    FRAUD_RISK = "FRAUD_RISK"
    NEW_CODE = "NEW_CODE"
    APPEAL = "APPEAL"
    # Dual-agent cross-validation triggers
    AGENT_DISAGREEMENT = "AGENT_DISAGREEMENT"   # Rules vs LLM disagree (80–97%)
    AGENT_CONFLICT     = "AGENT_CONFLICT"       # Rules vs LLM hard conflict (< 80%)


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    ADJUSTER = "ADJUSTER"
    SENIOR_ADJUSTER = "SENIOR_ADJUSTER"
    MEDICAL_DIRECTOR = "MEDICAL_DIRECTOR"
    COMPLIANCE_OFFICER = "COMPLIANCE_OFFICER"
    API_CONSUMER = "API_CONSUMER"


class SessionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    TERMINATED = "TERMINATED"
    BROKEN = "BROKEN"
    RESTARTED = "RESTARTED"


# ════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════

class Policy(Base):
    """
    Insurance policy document — modeled after Daman Enhanced Plans (GCC)
    and Star Health Comprehensive/Assure Plans (India).
    """
    __tablename__ = "policies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    policy_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    policy_name: Mapped[str] = mapped_column(String(255), nullable=False)
    carrier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    tier: Mapped[PolicyTier] = mapped_column(SAEnum(PolicyTier), nullable=False)
    market_region: Mapped[MarketRegion] = mapped_column(SAEnum(MarketRegion), nullable=False)
    currency: Mapped[Currency] = mapped_column(SAEnum(Currency), nullable=False)

    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    termination_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Benefit structure (GCC/India specific)
    annual_limit: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    individual_deductible: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    family_deductible: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    oop_max_individual: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    oop_max_family: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)

    # Co-pay structure (very common in GCC)
    outpatient_copay_pct: Mapped[int] = mapped_column(Integer, default=20)  # 20% typical in Daman
    outpatient_copay_max: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)  # AED 50 cap
    inpatient_copay_flat: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)  # AED 200 per admission
    inpatient_copay_annual_max: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)  # AED 500/yr cap
    pharmacy_copay_pct: Mapped[int] = mapped_column(Integer, default=30)  # 30% for Daman Basic
    diagnostic_copay_pct: Mapped[int] = mapped_column(Integer, default=20)

    # Room rent (critical for India market — Star Health uses sub-limits)
    room_rent_limit_type: Mapped[str] = mapped_column(String(20), default="ANY")  # ANY, CAPPED, PROPORTIONATE
    room_rent_daily_limit: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)

    # Pre-existing disease waiting period (India: 2-4 years, GCC: 6 months typical)
    ped_waiting_period_months: Mapped[int] = mapped_column(Integer, default=6)
    maternity_waiting_period_months: Mapped[int] = mapped_column(Integer, default=24)

    # Network
    network_name: Mapped[str] = mapped_column(String(100), default="STANDARD")
    requires_preauth_inpatient: Mapped[bool] = mapped_column(Boolean, default=True)
    requires_preauth_daycare: Mapped[bool] = mapped_column(Boolean, default=True)

    # Metadata
    document_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    version: Mapped[int] = mapped_column(Integer, default=1)
    benefit_summary: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    clauses: Mapped[list["PolicyClause"]] = relationship(back_populates="policy", cascade="all, delete-orphan")
    members: Mapped[list["Member"]] = relationship(back_populates="policy")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PolicyClause(Base):
    """Structured clause extracted from policy for deterministic rule evaluation."""
    __tablename__ = "policy_clauses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    policy_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("policies.id"), nullable=False)
    clause_type: Mapped[ClauseType] = mapped_column(SAEnum(ClauseType), nullable=False)
    section_reference: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    full_text: Mapped[str] = mapped_column(Text, nullable=False)
    structured_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    applicable_claim_types: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    applicable_procedure_codes: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    applicable_diagnosis_codes: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    policy: Mapped["Policy"] = relationship(back_populates="clauses")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (Index("idx_clauses_policy_type", "policy_id", "clause_type"),)


class Member(Base):
    """Insured member — supports both GCC (Emirates ID) and India (Aadhaar) identifiers."""
    __tablename__ = "members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    member_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    emirates_id: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)  # GCC
    aadhaar_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)  # India (hashed)

    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    date_of_birth: Mapped[date] = mapped_column(Date, nullable=False)
    gender: Mapped[str] = mapped_column(String(10), nullable=False)
    nationality: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Encrypted contact
    email_encrypted: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    phone_encrypted: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Policy
    policy_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("policies.id"), nullable=True)
    group_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    relationship_to_subscriber: Mapped[str] = mapped_column(String(20), default="SELF")
    market_region: Mapped[MarketRegion] = mapped_column(SAEnum(MarketRegion), default=MarketRegion.UAE)

    # Accumulators (current benefit year)
    deductible_met: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    oop_met: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    inpatient_copay_ytd: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)  # Track against annual cap
    benefit_year_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Coverage dates
    coverage_start: Mapped[date] = mapped_column(Date, nullable=False)
    coverage_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    policy: Mapped[Optional["Policy"]] = relationship(back_populates="members")
    claims: Mapped[list["Claim"]] = relationship(back_populates="member")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class Provider(Base):
    """Healthcare provider — hospitals, clinics, pharmacies."""
    __tablename__ = "providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    facility_type: Mapped[str] = mapped_column(String(50), nullable=False)  # HOSPITAL, CLINIC, PHARMACY, LAB
    license_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Location
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    emirate_state: Mapped[str] = mapped_column(String(100), nullable=False)  # Abu Dhabi, Dubai, Maharashtra, etc.
    country: Mapped[str] = mapped_column(String(50), nullable=False)
    market_region: Mapped[MarketRegion] = mapped_column(SAEnum(MarketRegion), nullable=False)

    # Network
    network_tier: Mapped[NetworkTier] = mapped_column(SAEnum(NetworkTier), default=NetworkTier.NETWORK)
    is_coe: Mapped[bool] = mapped_column(Boolean, default=False)  # Centre of Excellence (Daman)

    # Fee schedule
    fee_schedule: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # {"99213": 350.00, "99214": 500.00, ...} — allowed amounts by procedure code

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Claim(Base):
    """Central claim entity — supports both GCC and Indian claim formats."""
    __tablename__ = "claims"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_reference: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    status: Mapped[ClaimStatus] = mapped_column(SAEnum(ClaimStatus), default=ClaimStatus.RECEIVED, index=True)
    claim_type: Mapped[ClaimType] = mapped_column(SAEnum(ClaimType), nullable=False)
    market_region: Mapped[MarketRegion] = mapped_column(SAEnum(MarketRegion), nullable=False)
    currency: Mapped[Currency] = mapped_column(SAEnum(Currency), nullable=False)

    # Member
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id"), nullable=False)
    patient_name: Mapped[str] = mapped_column(String(255), nullable=False)
    patient_dob: Mapped[date] = mapped_column(Date, nullable=False)
    member_number: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # Provider
    provider_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("providers.id"), nullable=True)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_code: Mapped[str] = mapped_column(String(20), nullable=False)
    network_tier: Mapped[NetworkTier] = mapped_column(SAEnum(NetworkTier), default=NetworkTier.NETWORK)

    # Dates
    admission_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # Inpatient
    discharge_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    date_received: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    date_adjudicated: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    date_settled: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Diagnosis
    primary_diagnosis_code: Mapped[str] = mapped_column(String(10), nullable=False)  # ICD-10
    primary_diagnosis_desc: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    secondary_diagnosis_codes: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # Financials
    total_billed: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    total_allowed: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    total_settlement: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    total_member_responsibility: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)

    # Pre-authorization
    preauth_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    preauth_approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # AI metadata
    confidence_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    processing_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Policy
    policy_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("policies.id"), nullable=True)

    # Raw
    raw_document_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    extracted_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    source_channel: Mapped[str] = mapped_column(String(50), default="API")

    # Account Capture
    bank_account_holder: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    account_holder_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    account_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    bank_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    iban: Mapped[Optional[str]] = mapped_column(String(34), nullable=True)
    swift_bic: Mapped[Optional[str]] = mapped_column(String(11), nullable=True)
    account_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    ifsc_code: Mapped[Optional[str]] = mapped_column(String(11), nullable=True)
    upi_vpa: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    upi_provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Relationships
    member: Mapped["Member"] = relationship(back_populates="claims")
    line_items: Mapped[list["ClaimLineItem"]] = relationship(back_populates="claim", cascade="all, delete-orphan")
    settlement: Mapped["Settlement | None"] = relationship(back_populates="claim", uselist=False)
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="claim")
    hitl_reviews: Mapped[list["HITLReview"]] = relationship(back_populates="claim")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_claims_status_date", "status", "date_received"),
        Index("idx_claims_member", "member_number", "service_date"),
    )


class ClaimLineItem(Base):
    """Individual service line on a claim."""
    __tablename__ = "claim_line_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("claims.id"), nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Service
    procedure_code: Mapped[str] = mapped_column(String(10), nullable=False)  # CPT / local codes
    procedure_desc: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    modifier_codes: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    diagnosis_pointers: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    service_category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # CONSULTATION, DIAGNOSTIC, LAB, PHARMACY, SURGERY, ROOM_RENT, ICU, etc.

    # Quantities
    units: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=1)
    days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # For room rent

    # Financials
    billed_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    allowed_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    deductible_applied: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    copay_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    coinsurance_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    plan_paid: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    member_responsibility: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Coverage
    is_covered: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    denial_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    denial_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    clause_references: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # Sub-limits
    sub_limit_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    sub_limit_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    claim: Mapped["Claim"] = relationship(back_populates="line_items")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Settlement(Base):
    """Final settlement record."""
    __tablename__ = "settlements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("claims.id"), unique=True, nullable=False)

    total_billed: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    total_allowed: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    total_deductible: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    total_copay: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    total_coinsurance_member: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    total_plan_payment: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    total_member_responsibility: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    currency: Mapped[Currency] = mapped_column(SAEnum(Currency), nullable=False)
    policy_citations: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    confidence_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    model_version: Mapped[str] = mapped_column(String(50), nullable=False, default="v1.0.0")
    rules_engine_version: Mapped[str] = mapped_column(String(50), nullable=False, default="v1.0.0")

    was_hitl_reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    hitl_override_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    hitl_justification: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Dual-Agent Cross-Validation ─────────────────────────────────────────
    agent_agreement_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    agent_disagreement_items: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    calculation_breakdown: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    report_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    claim: Mapped["Claim"] = relationship(back_populates="settlement")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class AuditLog(Base):
    """Immutable audit trail with hash chain."""
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("claims.id"), nullable=True)
    event_type: Mapped[AuditEventType] = mapped_column(SAEnum(AuditEventType), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    event_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    service_name: Mapped[str] = mapped_column(String(50), nullable=False)
    previous_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    entry_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    claim: Mapped["Claim | None"] = relationship(back_populates="audit_logs")

    __table_args__ = (
        Index("idx_audit_claim", "claim_id"),
        Index("idx_audit_type", "event_type"),
    )


class HITLReview(Base):
    """Human-in-the-loop review queue."""
    __tablename__ = "hitl_reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("claims.id"), nullable=False)
    status: Mapped[HITLStatus] = mapped_column(SAEnum(HITLStatus), default=HITLStatus.PENDING, index=True)
    trigger_reason: Mapped[HITLTrigger] = mapped_column(SAEnum(HITLTrigger), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=5)

    ai_settlement_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    ai_confidence: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    decision: Mapped[HITLDecision | None] = mapped_column(SAEnum(HITLDecision), nullable=True)
    override_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    justification: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sla_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    claim: Mapped["Claim"] = relationship(back_populates="hitl_reviews")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class User(Base):
    """System users — adjusters, admins, API consumers."""
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False)
    market_region: Mapped[MarketRegion] = mapped_column(SAEnum(MarketRegion), default=MarketRegion.UAE)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    login_sessions: Mapped[list["UserLoginSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserLoginSession(Base):
    """Track user login sessions with state, location, IP, device metadata."""
    __tablename__ = "user_login_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[SessionStatus] = mapped_column(SAEnum(SessionStatus), default=SessionStatus.ACTIVE, index=True)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)
    user_agent: Mapped[str] = mapped_column(Text, nullable=False)
    device_type: Mapped[str] = mapped_column(String(50), nullable=False)
    os_name: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    browser_name: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    browser_version: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    location_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    session_metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    terminated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    termination_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="login_sessions")

    __table_args__ = (
        Index("idx_session_user", "user_id"),
        Index("idx_session_status", "status"),
        Index("idx_session_created", "created_at"),
    )
