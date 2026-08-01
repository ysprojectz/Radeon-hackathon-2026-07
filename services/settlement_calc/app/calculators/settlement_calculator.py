"""
Settlement Calculation Engine — DETERMINISTIC, NO AI, NO ML.
Pure arithmetic governed by policy-defined parameters.

Market-specific calculation models:
  GCC   — Copay-centric (DHA/CCHI-compliant)
          • Network-tier aware co-pay (rules engine feeds copay_pct per line item)
          • VAT on applicable services (UAE 5%, KSA 15%)
          • Deductible-first (if applicable)
          • Sub-limits (dental, optical, physio, etc.)
  India — IRDAI-compliant proportionate deduction model
          • Room rent cap → proportionate deduction on related charges
          • GIPSA package rate enforcement
          • Aggregate deductible
          • AYUSH / domiciliary sub-limits

Every calculation step is logged for full legal auditability.
"""
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Optional
from datetime import date


# ═══════════════════════════════════════════════════════════════
# DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════

@dataclass
class PolicyParams:
    """Policy parameters extracted from the policy and clauses."""
    policy_id: str
    tier: str
    market_region: str  # UAE, INDIA, KSA, etc.
    currency: str
    annual_limit: Decimal
    individual_deductible: Decimal = Decimal("0")
    oop_max: Decimal = Decimal("0")

    # GCC copay structure (network-tier aware — rules engine populates copay_pct on line items)
    outpatient_copay_pct: int = 20
    outpatient_copay_max_per_visit: Decimal = Decimal("50")
    inpatient_copay_flat: Decimal = Decimal("200")
    inpatient_copay_annual_max: Decimal = Decimal("500")
    pharmacy_copay_pct: int = 10
    diagnostic_copay_pct: int = 20
    diagnostic_copay_max_per_visit: Decimal = Decimal("50")
    emergency_copay_pct: int = 0
    # VAT settings (UAE 5%, KSA 15%) — only on non-essential medical services
    vat_applicable: bool = False
    vat_rate: float = 5.0
    # Services that are VAT-exempt in UAE/KSA (curative medical services).
    # UAE FTA: medical care + prescribed medicines are zero-rated for VAT.
    # PROCEDURE (blood draw, venipuncture etc.) and PHARMACY (prescription meds) are exempt.
    vat_exempt_categories: list = field(default_factory=lambda: [
        "CONSULTATION", "DIAGNOSTIC", "LAB", "SURGERY", "ICU", "INPATIENT", "EMERGENCY",
        "MATERNITY", "ROOM_RENT", "PROCEDURE", "PHARMACY",
    ])

    # India room rent structure
    room_rent_limit_type: str = "ANY"  # ANY, CAPPED, PROPORTIONATE
    room_rent_daily_limit: Decimal = Decimal("0")
    icu_rent_daily_limit: Decimal = Decimal("0")
    proportionate_deduction_applies: bool = False
    proportionate_exempt_categories: list = field(default_factory=lambda: [
        "DIAGNOSTIC", "LAB", "PHARMACY", "CONSUMABLES", "ICU"
    ])
    india_zonal_copay_pct: int = 0
    india_tds_rate_pct: Decimal = Decimal("10")
    india_consumables_gst_pct: Decimal = Decimal("0")

    # Sub-limits
    sub_limits: dict = field(default_factory=dict)
    # {"dental": 5000, "optical": 2000, "pharmacy_annual": 1500, "ambulance_per_event": 2500}

    # Member accumulators
    deductible_met: Decimal = Decimal("0")
    oop_met: Decimal = Decimal("0")
    inpatient_copay_ytd: Decimal = Decimal("0")


@dataclass
class LineItemInput:
    """Input for a single claim line item."""
    line_number: int
    procedure_code: str
    procedure_desc: str
    service_category: str  # CONSULTATION, DIAGNOSTIC, LAB, PHARMACY, SURGERY, ROOM_RENT, etc.
    billed_amount: Decimal
    units: Decimal = Decimal("1")
    days: int = 0
    is_covered: bool = True
    denial_code: Optional[str] = None
    denial_reason: Optional[str] = None
    fee_schedule_rate: Optional[Decimal] = None
    sub_limit_name: Optional[str] = None
    sub_limit_remaining: Optional[Decimal] = None
    # Market-specific fields from rules engine
    copay_pct_override: Optional[float] = None   # Network-tier copay from rules engine
    gipsa_package_rate: Optional[Decimal] = None  # India GIPSA negotiated rate
    room_rent_cap: Optional[Decimal] = None        # India room rent daily cap


@dataclass
class LineItemResult:
    """Output for a single claim line item settlement."""
    line_number: int
    procedure_code: str
    service_category: str
    billed_amount: Decimal
    allowed_amount: Decimal
    deductible_applied: Decimal = Decimal("0")
    copay_amount: Decimal = Decimal("0")
    coinsurance_amount: Decimal = Decimal("0")
    plan_paid: Decimal = Decimal("0")
    member_responsibility: Decimal = Decimal("0")
    is_covered: bool = True
    denial_code: Optional[str] = None
    denial_reason: Optional[str] = None
    sub_limit_applied: bool = False
    sub_limit_name: Optional[str] = None
    proportionate_deduction_applied: bool = False
    proportionate_ratio: Optional[Decimal] = None
    calculation_steps: list = field(default_factory=list)
    clause_references: list = field(default_factory=list)


@dataclass
class SettlementResult:
    """Complete settlement result for a claim."""
    claim_reference: str
    currency: str
    market_region: str
    total_billed: Decimal
    total_allowed: Decimal
    total_deductible: Decimal
    total_copay: Decimal
    total_coinsurance_member: Decimal
    total_plan_payment: Decimal
    total_member_responsibility: Decimal
    line_items: list  # list[LineItemResult]
    total_vat: Decimal = Decimal("0")
    total_gst: Decimal = Decimal("0")
    total_tds: Decimal = Decimal("0")
    net_payout: Decimal = Decimal("0")
    confidence_score: Decimal = Decimal("98.5")
    calculation_breakdown: dict = field(default_factory=dict)


@dataclass
class _IndiaCalculationState:
    """Internal state for India settlement calculation."""
    running_deductible: Decimal
    total_billed: Decimal = Decimal("0")
    total_allowed: Decimal = Decimal("0")
    pre_deductible_total: Decimal = Decimal("0")
    prop_ratio: Decimal = Decimal("1")
    prop_deduction_applies: bool = False
    results: list[LineItemResult] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════
# SETTLEMENT CALCULATOR
# ═══════════════════════════════════════════════════════════════

class SettlementCalculator:
    """
    Deterministic settlement calculator.
    Same inputs ALWAYS produce same outputs. No randomness, no ML, no external APIs.
    
    Supports:
    - GCC copay model (Daman-style): percentage + flat copays with caps
    - India room rent proportionate model (Star Health-style): room rent ratio applied to related charges
    - Deductible-first model (Star Assure-style): aggregate deductible before coverage kicks in
    """

    VERSION = "v1.0.0"

    def _d(self, val) -> Decimal:
        """Coerce val to a non-negative Decimal rounded to 2 d.p."""
        if isinstance(val, Decimal):
            if not val.is_finite():
                return Decimal("0")
            return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        try:
            d = Decimal(str(val))
            if not d.is_finite():
                return Decimal("0")
            return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except (InvalidOperation, ValueError, TypeError):
            return Decimal("0")

    def calculate(
        self,
        claim_reference: str,
        claim_type: str,
        line_items: list[LineItemInput],
        policy: PolicyParams,
        actual_room_rent_per_day: Optional[Decimal] = None,
    ) -> SettlementResult:
        """
        Main entry point. Routes to the appropriate market-specific calculator.
        """
        if policy.market_region in ("UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT"):
            return self._calculate_gcc(claim_reference, claim_type, line_items, policy)
        elif policy.market_region == "INDIA":
            return self._calculate_india(
                claim_reference, claim_type, line_items, policy, actual_room_rent_per_day
            )
        else:
            raise ValueError(f"Unsupported market region: {policy.market_region}")

    # ─────────────────────────────────────────────────────
    # GCC CALCULATOR (Daman-style)
    # ─────────────────────────────────────────────────────

    def _calculate_gcc(
        self,
        claim_reference: str,
        claim_type: str,
        line_items: list[LineItemInput],
        policy: PolicyParams,
    ) -> SettlementResult:
        """
        GCC copay model:
        - Outpatient: % copay with per-visit cap
        - Inpatient: flat copay per admission with annual cap
        - Emergency: typically no copay
        - Pharmacy: separate % copay
        - No deductible for most plans
        """
        results = []
        running_inpatient_copay = policy.inpatient_copay_ytd
        running_deductible = policy.deductible_met
        inpatient_copay_applied_this_claim = False  # Flat copay applies ONCE per admission
        total_billed = Decimal("0")
        total_allowed = Decimal("0")
        total_copay = Decimal("0")
        total_plan = Decimal("0")
        total_member = Decimal("0")
        total_vat = Decimal("0")

        for item in line_items:
            steps = []

            if not item.is_covered:
                result = LineItemResult(
                    line_number=item.line_number,
                    procedure_code=item.procedure_code,
                    service_category=item.service_category,
                    billed_amount=self._d(item.billed_amount),
                    allowed_amount=Decimal("0"),
                    member_responsibility=self._d(item.billed_amount),
                    is_covered=False,
                    denial_code=item.denial_code,
                    denial_reason=item.denial_reason,
                    calculation_steps=[{"step": "DENIED", "reason": item.denial_reason}],
                )
                results.append(result)
                total_billed += self._d(item.billed_amount)
                total_member += self._d(item.billed_amount)
                continue

            billed = self._d(item.billed_amount)
            total_billed += billed

            # Step 1: Determine allowed amount (fee schedule or billed, whichever is less)
            if item.fee_schedule_rate and item.fee_schedule_rate > 0:
                allowed = min(billed, self._d(item.fee_schedule_rate))
                steps.append({"step": "ALLOWED_AMOUNT", "operation": "min(billed, fee_schedule)", "billed": str(billed), "fee_schedule": str(item.fee_schedule_rate), "result": str(allowed)})
            else:
                allowed = billed
                steps.append({"step": "ALLOWED_AMOUNT", "operation": "billed (no fee schedule override)", "result": str(allowed)})

            # Step 2: Apply deductible (if applicable — rare in GCC but exists in some plans)
            deductible_applied = Decimal("0")
            if policy.individual_deductible > 0 and running_deductible < policy.individual_deductible:
                remaining_ded = policy.individual_deductible - running_deductible
                deductible_applied = min(allowed, remaining_ded)
                running_deductible += deductible_applied
                steps.append({"step": "DEDUCTIBLE", "remaining_before": str(remaining_ded), "applied": str(deductible_applied), "deductible_met_after": str(running_deductible)})

            after_deductible = allowed - deductible_applied

            # Step 3: Calculate copay based on service category and claim type
            copay = Decimal("0")

            if claim_type == "EMERGENCY":
                copay = self._d(after_deductible * policy.emergency_copay_pct / 100)
                steps.append({"step": "COPAY_EMERGENCY", "rate": f"{policy.emergency_copay_pct}%", "copay": str(copay)})

            elif claim_type in ("INPATIENT", "DAYCARE"):
                # Flat copay per admission, capped annually — apply ONCE per claim
                if not inpatient_copay_applied_this_claim and running_inpatient_copay < policy.inpatient_copay_annual_max:
                    remaining_cap = policy.inpatient_copay_annual_max - running_inpatient_copay
                    copay = min(policy.inpatient_copay_flat, remaining_cap)
                    running_inpatient_copay += copay
                    inpatient_copay_applied_this_claim = True
                    steps.append({"step": "COPAY_INPATIENT", "flat": str(policy.inpatient_copay_flat), "annual_cap": str(policy.inpatient_copay_annual_max), "ytd_before": str(policy.inpatient_copay_ytd), "applied": str(copay)})
                elif inpatient_copay_applied_this_claim:
                    steps.append({"step": "COPAY_INPATIENT", "note": "Already applied for this admission", "applied": "0"})
                else:
                    steps.append({"step": "COPAY_INPATIENT", "note": "Annual cap already reached", "applied": "0"})

            elif claim_type in ("OUTPATIENT", "PHARMACY", "MATERNITY"):
                # Use network-tier override from rules engine if available
                if item.copay_pct_override is not None:
                    copay_pct = item.copay_pct_override
                    raw_copay = self._d(after_deductible * Decimal(str(copay_pct)) / 100)
                    # Apply per-visit cap based on service category even with network override
                    _cap = Decimal("0")
                    if item.service_category == "CONSULTATION" and policy.outpatient_copay_max_per_visit > 0:
                        _cap = policy.outpatient_copay_max_per_visit
                    elif item.service_category in ("DIAGNOSTIC", "LAB") and policy.diagnostic_copay_max_per_visit > 0:
                        _cap = policy.diagnostic_copay_max_per_visit
                    copay = min(raw_copay, _cap) if _cap > 0 else raw_copay
                    steps.append({"step": "COPAY_NETWORK_TIER", "rate": f"{copay_pct}%", "source": "rules_engine_override", "raw_copay": str(raw_copay), "cap": str(_cap), "copay": str(copay)})
                elif item.service_category == "PHARMACY":
                    copay_pct = policy.pharmacy_copay_pct
                    copay = self._d(after_deductible * copay_pct / 100)
                    steps.append({"step": "COPAY_PHARMACY", "rate": f"{copay_pct}%", "copay": str(copay)})
                elif item.service_category in ("DIAGNOSTIC", "LAB"):
                    copay_pct = policy.diagnostic_copay_pct
                    raw_copay = self._d(after_deductible * copay_pct / 100)
                    copay = min(raw_copay, policy.diagnostic_copay_max_per_visit) if policy.diagnostic_copay_max_per_visit > 0 else raw_copay
                    steps.append({"step": "COPAY_DIAGNOSTIC", "rate": f"{copay_pct}%", "raw": str(raw_copay), "cap": str(policy.diagnostic_copay_max_per_visit), "final": str(copay)})
                elif item.service_category == "CONSULTATION":
                    copay_pct = policy.outpatient_copay_pct
                    raw_copay = self._d(after_deductible * copay_pct / 100)
                    copay = min(raw_copay, policy.outpatient_copay_max_per_visit) if policy.outpatient_copay_max_per_visit > 0 else raw_copay
                    steps.append({"step": "COPAY_CONSULTATION", "rate": f"{copay_pct}%", "raw": str(raw_copay), "cap": str(policy.outpatient_copay_max_per_visit), "final": str(copay)})

            # Step 4: Apply sub-limits
            sub_limit_applied = False
            sub_limit_name = None
            plan_responsibility = after_deductible - copay

            if item.sub_limit_name and item.sub_limit_remaining is not None:
                if plan_responsibility > item.sub_limit_remaining:
                    excess = plan_responsibility - self._d(item.sub_limit_remaining)
                    plan_responsibility = self._d(item.sub_limit_remaining)
                    copay += excess  # Member pays the excess over sub-limit
                    sub_limit_applied = True
                    sub_limit_name = item.sub_limit_name
                    steps.append({"step": "SUB_LIMIT", "name": item.sub_limit_name, "remaining": str(item.sub_limit_remaining), "excess_to_member": str(excess)})

            # Step 5: VAT Tracking (UAE 5%, KSA 15%)
            # NOTE: Provider-billed amounts ALREADY include VAT at source.
            # We track estimated VAT for reporting/compliance but do NOT add it
            # to settlement amounts (would double-count and inflate plan payment).
            # For VAT-exempt services (PHARMACY, CONSULTATION, etc.), VAT is zero.
            vat_amount = Decimal("0")
            if policy.vat_applicable and item.service_category.upper() not in policy.vat_exempt_categories:
                # Estimate VAT portion already embedded in the billed amount
                # Formula: if billed includes VAT, then VAT = billed × (rate / (100 + rate))
                # Example: AED 105 at 5% VAT → VAT portion = 105 × (5/105) = 5.00
                vat_rate_decimal = Decimal(str(policy.vat_rate))
                vat_amount = self._d(billed * vat_rate_decimal / (Decimal("100") + vat_rate_decimal))
                steps.append({
                    "step": "VAT_TRACKING",
                    "rate": f"{policy.vat_rate}%",
                    "billed_amount": str(billed),
                    "estimated_vat_portion": str(vat_amount),
                    "note": f"VAT already included in billed amount (tracking for compliance reporting)",
                })
            elif policy.vat_applicable:
                steps.append({
                    "step": "VAT_EXEMPT",
                    "service_category": item.service_category,
                    "note": f"{item.service_category} is VAT-exempt per {policy.market_region} regulations",
                })

            # Step 6: Final amounts
            # Plan pays what's left after copay (no VAT addition since billed amount already includes it)
            plan_paid = self._d(plan_responsibility)
            # Safety guard: plan can never pay more than what was billed
            plan_paid = min(plan_paid, billed)
            member_resp = max(Decimal("0"), self._d(billed - plan_paid))

            total_allowed += allowed
            total_copay += copay
            total_plan += plan_paid
            total_member += member_resp
            total_vat += vat_amount

            steps.append({"step": "FINAL", "billed": str(billed), "allowed": str(allowed), "deductible": str(deductible_applied), "copay": str(copay), "vat_tracked": str(vat_amount), "plan_paid": str(plan_paid), "member": str(member_resp)})

            results.append(LineItemResult(
                line_number=item.line_number,
                procedure_code=item.procedure_code,
                service_category=item.service_category,
                billed_amount=billed,
                allowed_amount=allowed,
                deductible_applied=deductible_applied,
                copay_amount=copay,
                plan_paid=plan_paid,
                member_responsibility=member_resp,
                is_covered=True,
                sub_limit_applied=sub_limit_applied,
                sub_limit_name=sub_limit_name,
                calculation_steps=steps,
            ))

        return SettlementResult(
            claim_reference=claim_reference,
            currency=policy.currency,
            market_region=policy.market_region,
            total_billed=self._d(total_billed),
            total_allowed=self._d(total_allowed),
            total_deductible=self._d(sum(r.deductible_applied for r in results)),
            total_copay=self._d(total_copay),
            total_coinsurance_member=Decimal("0"),
            total_plan_payment=self._d(total_plan),
            total_member_responsibility=self._d(total_member),
            total_vat=self._d(total_vat),
            line_items=results,
            calculation_breakdown={
                "model": "GCC_COPAY",
                "policy_tier": policy.tier,
                "inpatient_copay_ytd_after": str(running_inpatient_copay),
                "deductible_met_after": str(running_deductible),
            },
        )

    def _calculate_india_ratio(
        self, policy: PolicyParams, actual_room_rent_per_day: Optional[Decimal]
    ) -> tuple[Decimal, bool]:
        """Calculate the proportionate deduction ratio if actual room rent exceeds limit."""
        prop_ratio = Decimal("1")
        prop_deduction_applies = False

        if (
            policy.room_rent_limit_type == "PROPORTIONATE"
            and policy.room_rent_daily_limit > 0
            and actual_room_rent_per_day is not None
            and actual_room_rent_per_day > policy.room_rent_daily_limit
        ):
            # Use 4 decimal places (66.67% style) for IRDAI-standard rounding.
            # Guard: actual_room_rent_per_day must be > 0 to avoid ZeroDivisionError.
            if actual_room_rent_per_day > 0:
                raw_ratio = (policy.room_rent_daily_limit / actual_room_rent_per_day).quantize(
                    Decimal("0.0001"), rounding=ROUND_HALF_UP
                )
                # Clamp ratio to [0, 1] — a ratio > 1 would inflate allowed amounts
                prop_ratio = max(Decimal("0"), min(Decimal("1"), raw_ratio))
                prop_deduction_applies = True

        return prop_ratio, prop_deduction_applies

    def _process_india_line_items(
        self, line_items: list[LineItemInput], policy: PolicyParams, state: _IndiaCalculationState
    ) -> None:
        """Process each line item and apply proportionate deduction where applicable."""
        for item in line_items:
            steps = []

            if not item.is_covered:
                result = LineItemResult(
                    line_number=item.line_number,
                    procedure_code=item.procedure_code,
                    service_category=item.service_category,
                    billed_amount=self._d(item.billed_amount),
                    allowed_amount=Decimal("0"),
                    member_responsibility=self._d(item.billed_amount),
                    is_covered=False,
                    denial_code=item.denial_code,
                    denial_reason=item.denial_reason,
                    calculation_steps=[{"step": "DENIED", "reason": item.denial_reason}],
                )
                state.results.append(result)
                state.total_billed += self._d(item.billed_amount)
                continue

            billed = self._d(item.billed_amount)
            state.total_billed += billed

            # GIPSA package rate cap (India cashless — allowed cannot exceed negotiated rate)
            if item.gipsa_package_rate and item.gipsa_package_rate > 0:
                if billed > self._d(item.gipsa_package_rate):
                    steps.append({
                        "step": "GIPSA_CAP",
                        "billed": str(billed),
                        "gipsa_rate": str(item.gipsa_package_rate),
                        "excess_to_member": str(self._d(billed - item.gipsa_package_rate)),
                        "note": "Billed exceeds GIPSA package rate — excess is member responsibility",
                    })
                    billed = self._d(item.gipsa_package_rate)  # Use GIPSA rate as effective billed

            # Apply proportionate deduction
            if state.prop_deduction_applies:
                if item.service_category == "ROOM_RENT":
                    # Room rent: cap at eligible amount
                    if item.days and item.days > 0:
                        allowed = self._d(policy.room_rent_daily_limit * item.days)
                    else:
                        allowed = self._d(billed * state.prop_ratio)
                    steps.append({
                        "step": "ROOM_RENT_CAP",
                        "billed": str(billed),
                        "eligible_per_day": str(policy.room_rent_daily_limit),
                        "days": item.days,
                        "allowed": str(allowed),
                    })
                elif item.service_category == "ICU":
                    # ICU: cap at eligible amount (usually higher than normal room)
                    if item.days and item.days > 0 and policy.icu_rent_daily_limit > 0:
                        allowed = self._d(policy.icu_rent_daily_limit * item.days)
                    else:
                        allowed = billed
                    steps.append({
                        "step": "ICU_RENT_CAP",
                        "billed": str(billed),
                        "eligible_per_day": str(policy.icu_rent_daily_limit),
                        "days": item.days,
                        "allowed": str(allowed),
                    })
                elif item.service_category in policy.proportionate_exempt_categories:
                    # Exempt categories: no deduction
                    allowed = billed
                    steps.append({
                        "step": "PROPORTIONATE_EXEMPT",
                        "category": item.service_category,
                        "reason": "Category exempt from proportionate deduction",
                        "allowed": str(allowed),
                    })
                else:
                    # Subject to proportionate deduction
                    allowed = self._d(billed * state.prop_ratio)
                    steps.append({
                        "step": "PROPORTIONATE_DEDUCTION",
                        "billed": str(billed),
                        "ratio": str(state.prop_ratio),
                        "formula": f"{billed} × {state.prop_ratio}",
                        "allowed": str(allowed),
                    })
            else:
                # No proportionate deduction
                if item.service_category == "ROOM_RENT" and policy.room_rent_limit_type == "CAPPED":
                    if item.days and item.days > 0:
                        max_room = self._d(policy.room_rent_daily_limit * item.days)
                        allowed = min(billed, max_room)
                        steps.append({"step": "ROOM_RENT_CAPPED", "billed": str(billed), "cap": str(max_room), "allowed": str(allowed)})
                    else:
                        allowed = billed
                elif item.service_category == "ICU" and policy.icu_rent_daily_limit > 0:
                    if item.days and item.days > 0:
                        max_icu = self._d(policy.icu_rent_daily_limit * item.days)
                        allowed = min(billed, max_icu)
                        steps.append({"step": "ICU_RENT_CAPPED", "billed": str(billed), "cap": str(max_icu), "allowed": str(allowed)})
                    else:
                        allowed = billed
                else:
                    allowed = billed
                    steps.append({"step": "ALLOWED", "amount": str(allowed)})

            # Apply sub-limits
            sub_limit_applied = False
            if item.sub_limit_name and item.sub_limit_remaining is not None:
                if allowed > self._d(item.sub_limit_remaining):
                    allowed = self._d(item.sub_limit_remaining)
                    sub_limit_applied = True
                    steps.append({"step": "SUB_LIMIT", "name": item.sub_limit_name, "capped_to": str(allowed)})

            state.total_allowed += allowed
            state.pre_deductible_total += allowed

            state.results.append(LineItemResult(
                line_number=item.line_number,
                procedure_code=item.procedure_code,
                service_category=item.service_category,
                billed_amount=billed,
                allowed_amount=allowed,
                is_covered=True,
                sub_limit_applied=sub_limit_applied,
                sub_limit_name=item.sub_limit_name,
                proportionate_deduction_applied=(
                    state.prop_deduction_applies
                    and item.service_category not in policy.proportionate_exempt_categories
                    and item.service_category not in ("ROOM_RENT", "ICU")  # Room/ICU uses cap, not ratio
                ),
                proportionate_ratio=state.prop_ratio if (state.prop_deduction_applies and item.service_category not in policy.proportionate_exempt_categories and item.service_category not in ("ROOM_RENT", "ICU")) else None,
                calculation_steps=steps,
            ))

    def _apply_india_deductible(self, policy: PolicyParams, state: _IndiaCalculationState) -> Decimal:
        """Apply the aggregate deductible and distribute it across line items."""
        total_deductible_applied = Decimal("0")
        if policy.individual_deductible > 0:
            remaining_ded = policy.individual_deductible - state.running_deductible
            if remaining_ded > 0:
                deductible_to_apply = min(state.pre_deductible_total, remaining_ded)
                total_deductible_applied = self._d(deductible_to_apply)
                state.running_deductible += deductible_to_apply

                # Distribute deductible across line items proportionally
                if state.pre_deductible_total > 0:
                    for r in state.results:
                        if r.is_covered and r.allowed_amount > 0:
                            proportion = r.allowed_amount / state.pre_deductible_total
                            r.deductible_applied = self._d(deductible_to_apply * proportion)
                            r.calculation_steps.append({
                                "step": "DEDUCTIBLE_ALLOCATION",
                                "proportion": str(self._d(proportion)),
                                "deductible_share": str(r.deductible_applied),
                            })
        return total_deductible_applied

    def _calculate_india_final_amounts(
        self, policy: PolicyParams, state: _IndiaCalculationState
    ) -> tuple[Decimal, Decimal]:
        """Calculate final per-line amounts (Copay, Plan Paid, Member Responsibility)."""
        total_copay_applied = Decimal("0")
        for r in state.results:
            if r.is_covered:
                # Admissible after deductible
                admissible = max(Decimal("0"), r.allowed_amount - r.deductible_applied)
                
                # Apply Zonal Copay
                if policy.india_zonal_copay_pct > 0:
                    r.copay_amount = self._d(admissible * Decimal(str(policy.india_zonal_copay_pct)) / 100)
                    total_copay_applied += r.copay_amount
                    r.calculation_steps.append({
                        "step": "ZONAL_COPAY",
                        "rate": f"{policy.india_zonal_copay_pct}%",
                        "admissible": str(admissible),
                        "copay": str(r.copay_amount),
                    })

                # Guard: plan_paid and member_responsibility must never be negative
                r.plan_paid = max(
                    Decimal("0"),
                    self._d(admissible - r.copay_amount),
                )
                r.member_responsibility = max(
                    Decimal("0"),
                    self._d(r.billed_amount - r.plan_paid),
                )
                r.calculation_steps.append({
                    "step": "FINAL",
                    "billed": str(r.billed_amount),
                    "allowed": str(r.allowed_amount),
                    "deductible": str(r.deductible_applied),
                    "copay": str(r.copay_amount),
                    "plan_paid": str(r.plan_paid),
                    "member": str(r.member_responsibility),
                })
        
        total_plan = self._d(sum(r.plan_paid for r in state.results))
        total_member = self._d(sum(r.member_responsibility for r in state.results))
        return total_plan, total_member, total_copay_applied

    def _calculate_india_tds_gst(
        self, policy: PolicyParams, state: _IndiaCalculationState, total_plan: Decimal
    ) -> tuple[Decimal, Decimal, Decimal]:
        """Calculate TDS, GST, and net payout for India claims."""
        total_tds = self._d(total_plan * policy.india_tds_rate_pct / 100)
        
        total_gst = Decimal("0")
        for r in state.results:
            if r.is_covered and r.service_category.upper() == "CONSUMABLES":
                gst_rate = Decimal(str(getattr(policy, 'india_consumables_gst_pct', 0)))
                if gst_rate > 0:
                    r_gst = self._d(r.billed_amount * gst_rate / (Decimal("100") + gst_rate))
                    total_gst += r_gst
                    r.calculation_steps.append({
                        "step": "GST_TRACKING",
                        "rate": f"{gst_rate}%",
                        "billed": str(r.billed_amount),
                        "estimated_gst": str(r_gst)
                    })

        net_payout = self._d(total_plan - total_tds)
        return total_tds, total_gst, net_payout

    # ─────────────────────────────────────────────────────
    # INDIA CALCULATOR (Star Health-style)
    # ─────────────────────────────────────────────────────

    def _calculate_india(
        self,
        claim_reference: str,
        claim_type: str,
        line_items: list[LineItemInput],
        policy: PolicyParams,
        actual_room_rent_per_day: Optional[Decimal] = None,
    ) -> SettlementResult:
        """
        India proportionate deduction model:
        1. If actual room rent > eligible room rent, compute ratio
        2. Apply ratio to all charges that vary by room category
        3. Exempt charges that don't vary (diagnostics, medicines, consumables)
        4. Then apply deductible if applicable
        """
        # Step 1: Calculate proportionate deduction ratio
        prop_ratio, prop_deduction_applies = self._calculate_india_ratio(
            policy, actual_room_rent_per_day
        )

        state = _IndiaCalculationState(
            running_deductible=policy.deductible_met,
            prop_ratio=prop_ratio,
            prop_deduction_applies=prop_deduction_applies,
        )

        # Step 2: Process each line item
        self._process_india_line_items(line_items, policy, state)

        # Step 3: Apply aggregate deductible (if applicable)
        total_deductible_applied = self._apply_india_deductible(policy, state)

        # Step 4: Calculate final per-line amounts
        total_plan, total_member, total_copay_applied = self._calculate_india_final_amounts(
            policy, state
        )

        # Step 5: TDS & GST Calculation
        total_tds, total_gst, net_payout = self._calculate_india_tds_gst(
            policy, state, total_plan
        )

        return SettlementResult(
            claim_reference=claim_reference,
            currency=policy.currency,
            market_region=policy.market_region,
            total_billed=self._d(state.total_billed),
            total_allowed=self._d(state.total_allowed),
            total_deductible=self._d(total_deductible_applied),
            total_copay=self._d(total_copay_applied),
            total_coinsurance_member=Decimal("0"),
            total_plan_payment=total_plan,
            total_member_responsibility=total_member,
            total_vat=Decimal("0"),
            total_gst=total_gst,
            total_tds=total_tds,
            net_payout=net_payout,
            line_items=state.results,
            calculation_breakdown={
                "model": "INDIA_PROPORTIONATE",
                "policy_tier": policy.tier,
                "proportionate_deduction": prop_deduction_applies,
                "proportionate_ratio": str(prop_ratio) if prop_deduction_applies else None,
                "actual_room_rent_per_day": str(actual_room_rent_per_day) if actual_room_rent_per_day else None,
                "eligible_room_rent_per_day": str(policy.room_rent_daily_limit),
                "eligible_icu_rent_per_day": str(policy.icu_rent_daily_limit),
                "zonal_copay_pct": policy.india_zonal_copay_pct,
                "tds_rate_pct": str(policy.india_tds_rate_pct),
                "consumables_gst_pct": str(getattr(policy, 'india_consumables_gst_pct', 0)),
                "deductible_met_after": str(state.running_deductible),
            },
        )
