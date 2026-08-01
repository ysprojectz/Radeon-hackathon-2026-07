"""
Rules Engine — Deterministic policy rule evaluation.
No ML. No LLM. Pure logic.

Evaluates (common):
1. Member eligibility on date of service
2. Procedure coverage per policy clause
3. Exclusion matching
4. Pre-authorization compliance
5. Fee schedule rate lookup
6. Sub-limit checks
7. Waiting period enforcement (India)

Market-specific rule sets:
  GCC  → R7: Essential benefits floor (DHA/DOH/CCHI mandates)
         R8: Co-pay by network tier
         R9: High-value / DRG-based claim routing
  INDIA → R7: Room rent cap (% of sum insured)
          R8: GIPSA rate compliance
          R9: Cashless vs reimbursement protocol
          R10: AYUSH treatment coverage
          R11: Domiciliary hospitalization rules
"""
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional


@dataclass
class RuleContext:
    """All data needed to evaluate rules for a single claim."""
    claim_reference: str
    claim_type: str       # INPATIENT, OUTPATIENT, DAYCARE, EMERGENCY, etc.
    market_region: str    # UAE, KSA, BAHRAIN, OMAN, QATAR, KUWAIT, INDIA
    service_date: date
    admission_date: Optional[date] = None
    discharge_date: Optional[date] = None

    # Member
    member_number: str = ""
    member_dob: date = date(1990, 1, 1)
    coverage_start: date = date(2024, 1, 1)
    coverage_end: Optional[date] = None
    is_member_active: bool = True

    # Provider
    provider_code: str = ""
    network_tier: str = "NETWORK"   # NETWORK | OUT_OF_NETWORK | DIRECT_BILLING
    fee_schedule: dict = field(default_factory=dict)

    # Diagnosis
    primary_diagnosis: str = ""
    secondary_diagnoses: list = field(default_factory=list)

    # Pre-authorization
    preauth_number: Optional[str] = None
    preauth_approved: Optional[bool] = None

    # Policy
    policy_tier: str = ""
    requires_preauth_inpatient: bool = True
    requires_preauth_daycare: bool = True

    # Waiting periods (mostly India)
    ped_waiting_months: int = 6
    maternity_waiting_months: int = 12
    specific_disease_waiting_months: int = 24
    initial_waiting_days: int = 30
    pre_existing_conditions: list = field(default_factory=list)

    # Policy clauses (structured)
    exclusions: list = field(default_factory=list)
    sub_limits: dict = field(default_factory=dict)

    # ── GCC-specific fields ────────────────────────────────────────────────
    # Co-pay percentages by network tier (0–100)
    copay_in_network_pct: float = 10.0          # e.g. 10% for in-network
    copay_out_of_network_pct: float = 20.0      # e.g. 20% for out-of-network
    copay_direct_billing_pct: float = 0.0       # 0% for direct-billing (insurer pays provider)
    annual_deductible: Decimal = Decimal("0")
    deductible_met: bool = False
    essential_benefits_floor: bool = True        # DHA/DOH mandates minimum cover
    vat_applicable: bool = False                 # UAE/KSA VAT on some services
    vat_rate: float = 5.0                        # 5% UAE, 15% KSA

    # ── India-specific fields ─────────────────────────────────────────────
    room_rent_limit_pct: float = 1.0             # % of sum insured per day (common: 1%)
    room_rent_daily_cap: Decimal = Decimal("0")  # absolute cap in INR (0 = use pct)
    icu_rent_limit_pct: float = 2.0              # % of sum insured per day for ICU
    icu_rent_daily_cap: Decimal = Decimal("0")   # absolute cap for ICU
    sum_insured: Decimal = Decimal("0")
    is_cashless: bool = False                    # cashless (TPA settles) vs reimbursement
    tpa_name: str = ""
    gipsa_package_rate: Optional[Decimal] = None  # negotiated GIPSA rate for the procedure
    is_ayush: bool = False                        # AYUSH (Ayurveda, Yoga, etc.)
    is_domiciliary: bool = False                  # domiciliary hospitalization

    # ── Market Tiering (India IRDAI/GIPSA) ────────────────────────────────
    city_tier: str = "TIER_1"                     # TIER_1 (Metro), TIER_2, TIER_3
    hospital_grade: str = "GRADE_A"               # GRADE_A, GRADE_B, GRADE_C
    market_reference: dict = field(default_factory=dict) # Standard GIPSA rates from library
    # ── Admin-configurable threshold overrides ──────────────────────────────
    # These defaults match the hardcoded values in the original rules — no
    # behaviour change until admin explicitly adjusts them via the Rules Engine
    # config tab in the admin panel.
    gcc_drg_threshold:    int = 30000             # GCC DRG high-value routing threshold (AED/SAR)
    preauth_penalty_pct:  int = 30                # % penalty when pre-auth missing (Section 6.1)
    ayush_min_days:       int = 1                 # AYUSH min hospitalization days (IRDAI)
    domiciliary_min_days: int = 3                 # Domiciliary min treatment duration (Section 12)


@dataclass
class RuleResult:
    """Result of a single rule evaluation."""
    rule_name: str
    passed: bool
    reason: str
    applied_values: dict = field(default_factory=dict)
    severity: str = "INFO"  # INFO, WARNING, BLOCK


@dataclass
class LineItemEvaluation:
    """Complete rule evaluation for a single claim line item."""
    line_number: int
    procedure_code: str
    service_category: str
    billed_amount: Decimal
    is_covered: bool = True
    denial_code: Optional[str] = None
    denial_reason: Optional[str] = None
    fee_schedule_rate: Optional[Decimal] = None
    copay_applies: bool = False
    copay_pct: float = 0.0
    sub_limit_name: Optional[str] = None
    sub_limit_remaining: Optional[Decimal] = None
    rule_results: list = field(default_factory=list)  # list[RuleResult]
    hitl_recommended: bool = False
    hitl_reason: Optional[str] = None
    market_adjustments: dict = field(default_factory=dict)  # market-specific metadata


class RulesEngine:
    """
    Deterministic rules engine — market-aware.
    Each rule is an independent, testable method.
    Market-specific rule sets are dispatched by context.market_region.
    """

    VERSION = "v2.0.0"

    # ── Known exclusion mappings ──────────────────────────────────────────────
    COSMETIC_CODES = {"15780", "15781", "15788", "15789", "17360", "11920", "11921"}
    WEIGHT_MANAGEMENT_CODES = {"43770", "43775", "43842", "43843", "43845", "43846"}
    INFERTILITY_CODES = {"58970", "58974", "58976", "89250", "89251", "89253", "89254"}

    # India — specific disease waiting periods (IRDAI mandated)
    SPECIFIC_DISEASE_CODES = {
        "CATARACT":       ["H25", "H26", "H28"],
        "HERNIA":         ["K40", "K41", "K42", "K43", "K44", "K45", "K46"],
        "JOINT_REPLACEMENT": ["M16", "M17"],
        "KIDNEY_STONE":   ["N20", "N21", "N22", "N23"],
        "PILES_FISTULA":  ["K60", "K61", "K62"],
        "SINUSITIS":      ["J01", "J32"],
        "ENT_BENIGN":     ["J33", "J34", "J35", "J36", "J38", "J39"],
    }

    # GCC — DHA Essential Benefits Package (always covered, no exclusion allowed)
    GCC_ESSENTIAL_BENEFIT_CATEGORIES = {
        "EMERGENCY", "INPATIENT", "OUTPATIENT", "MATERNITY",
        "DIAGNOSTIC", "LAB", "PHARMACY",
    }

    # India — AYUSH service categories
    INDIA_AYUSH_CATEGORIES = {"AYURVEDA", "YOGA", "NATUROPATHY", "UNANI", "SIDDHA", "HOMEOPATHY"}

    # GCC regions
    GCC_REGIONS = {"UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT"}

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC API
    # ─────────────────────────────────────────────────────────────────────────

    def evaluate_claim(
        self, context: RuleContext, line_items: list[dict]
    ) -> list[LineItemEvaluation]:
        """
        Evaluate all rules for each line item.
        Dispatches market-specific rules based on context.market_region.
        Returns evaluated line items ready for settlement calculation.
        """
        results = []
        is_gcc   = context.market_region in self.GCC_REGIONS
        is_india = context.market_region == "INDIA"

        # Claim-level rules (evaluated once, applied to all line items)
        eligibility = self._check_eligibility(context)
        preauth     = self._check_preauthorization(context)

        for item in line_items:
            eval_result = LineItemEvaluation(
                line_number      = item["line_number"],
                procedure_code   = item["procedure_code"],
                service_category = item.get("service_category", "OTHER"),
                billed_amount    = Decimal(str(item["billed_amount"])),
            )

            # ── R1: Eligibility ──────────────────────────────────────────────
            eval_result.rule_results.append(eligibility)
            if not eligibility.passed:
                eval_result.is_covered   = False
                eval_result.denial_code  = "EL-001"
                eval_result.denial_reason = eligibility.reason
                results.append(eval_result)
                continue

            # ── R2: Pre-authorization ────────────────────────────────────────
            eval_result.rule_results.append(preauth)
            if not preauth.passed and preauth.severity == "BLOCK":
                eval_result.is_covered   = False
                eval_result.denial_code  = "PA-001"
                eval_result.denial_reason = preauth.reason
                results.append(eval_result)
                continue

            # ── R3: Exclusion check ──────────────────────────────────────────
            exclusion_result = self._check_exclusions(
                item["procedure_code"],
                context.primary_diagnosis,
                context.exclusions,
            )
            eval_result.rule_results.append(exclusion_result)
            if not exclusion_result.passed:
                # GCC: essential benefits cannot be excluded (regulatory override)
                if is_gcc and eval_result.service_category.upper() in self.GCC_ESSENTIAL_BENEFIT_CATEGORIES:
                    override = RuleResult(
                        "ESSENTIAL_BENEFITS_OVERRIDE", True,
                        "GCC essential benefit — exclusion overridden by DHA/DOH mandate",
                        severity="WARNING",
                    )
                    eval_result.rule_results.append(override)
                    eval_result.hitl_recommended = True
                    eval_result.hitl_reason = "Essential benefit override: manual review required"
                else:
                    eval_result.is_covered    = False
                    eval_result.denial_code   = "EX-001"
                    eval_result.denial_reason  = exclusion_result.reason
                    if "medical necessity" in exclusion_result.reason.lower():
                        eval_result.hitl_recommended = True
                        eval_result.hitl_reason = "Excluded procedure: medical necessity review"
                    results.append(eval_result)
                    continue

            # ── R4 (India): Waiting period check ────────────────────────────
            if is_india:
                waiting = self._check_waiting_period(context, item["procedure_code"])
                eval_result.rule_results.append(waiting)
                if not waiting.passed:
                    eval_result.is_covered    = False
                    eval_result.denial_code   = "WP-001"
                    eval_result.denial_reason  = waiting.reason
                    results.append(eval_result)
                    continue

            # ── R5: Fee schedule lookup ──────────────────────────────────────
            fee_result = self._lookup_fee_schedule(
                item["procedure_code"], context.fee_schedule, context.network_tier)
            eval_result.rule_results.append(fee_result)
            if fee_result.applied_values.get("rate"):
                eval_result.fee_schedule_rate = Decimal(str(fee_result.applied_values["rate"]))

            # ── R6: Sub-limit check ──────────────────────────────────────────
            sublimit_result = self._check_sub_limits(
                item.get("service_category", ""), context.sub_limits)
            eval_result.rule_results.append(sublimit_result)
            if sublimit_result.applied_values.get("sub_limit_name"):
                eval_result.sub_limit_name = sublimit_result.applied_values["sub_limit_name"]
                eval_result.sub_limit_remaining = Decimal(
                    str(sublimit_result.applied_values.get("remaining", 0)))

            # ── GCC-specific rules ────────────────────────────────────────────
            if is_gcc:
                # R7: Essential benefits floor
                eb_result = self._check_gcc_essential_benefits(
                    eval_result.service_category, context)
                eval_result.rule_results.append(eb_result)
                if not eb_result.passed:
                    eval_result.hitl_recommended = True
                    eval_result.hitl_reason = eb_result.reason

                # R8: Co-pay by network tier
                copay_result = self._apply_gcc_copay(
                    eval_result.billed_amount, context)
                eval_result.rule_results.append(copay_result)
                eval_result.copay_applies = True
                eval_result.copay_pct     = copay_result.applied_values.get("copay_pct", 0)
                eval_result.market_adjustments["copay_pct"]     = eval_result.copay_pct
                eval_result.market_adjustments["network_tier"]  = context.network_tier

                # R9: GCC high-value DRG routing
                drg_result = self._check_gcc_drg_routing(
                    eval_result.billed_amount, context)
                eval_result.rule_results.append(drg_result)
                if drg_result.applied_values.get("hitl_recommended"):
                    eval_result.hitl_recommended = True
                    eval_result.hitl_reason = drg_result.reason

            # ── India-specific rules ──────────────────────────────────────────
            if is_india:
                # R7: Room rent cap
                if eval_result.service_category.upper() in ("ROOM_RENT", "ICU"):
                    rr_result = self._check_india_room_rent_cap(
                        eval_result.billed_amount, eval_result.service_category, context)
                    eval_result.rule_results.append(rr_result)
                    if rr_result.applied_values.get("capped_amount"):
                        eval_result.market_adjustments["room_rent_cap"] = str(
                            rr_result.applied_values["capped_amount"])
                        eval_result.market_adjustments["room_rent_excess"] = str(
                            rr_result.applied_values.get("excess", 0))

                # R8: GIPSA rate compliance
                gipsa_result = self._check_india_gipsa_rate(
                    eval_result.billed_amount, context, eval_result.procedure_code)
                eval_result.rule_results.append(gipsa_result)
                if gipsa_result.applied_values.get("gipsa_rate"):
                    eval_result.market_adjustments["gipsa_rate"] = str(
                        gipsa_result.applied_values["gipsa_rate"])

                # R9: Cashless vs reimbursement protocol
                cashless_result = self._check_india_cashless_protocol(context)
                eval_result.rule_results.append(cashless_result)
                eval_result.market_adjustments["is_cashless"] = context.is_cashless
                eval_result.market_adjustments["tpa_name"]    = context.tpa_name

                # R10: AYUSH coverage
                if eval_result.service_category.upper() in self.INDIA_AYUSH_CATEGORIES:
                    ayush_result = self._check_india_ayush(
                        eval_result.service_category, context)
                    eval_result.rule_results.append(ayush_result)
                    if not ayush_result.passed:
                        eval_result.is_covered    = False
                        eval_result.denial_code   = "AY-001"
                        eval_result.denial_reason  = ayush_result.reason
                        results.append(eval_result)
                        continue

                # R11: Domiciliary hospitalization
                if context.is_domiciliary:
                    dom_result = self._check_india_domiciliary(context)
                    eval_result.rule_results.append(dom_result)
                    if not dom_result.passed:
                        eval_result.hitl_recommended = True
                        eval_result.hitl_reason = dom_result.reason

            results.append(eval_result)

        return results

    # ─────────────────────────────────────────────────────────────────────────
    # COMMON RULES
    # ─────────────────────────────────────────────────────────────────────────

    def _check_eligibility(self, ctx: RuleContext) -> RuleResult:
        if not ctx.is_member_active:
            return RuleResult("ELIGIBILITY", False, "Member is not active", severity="BLOCK")
        if ctx.service_date < ctx.coverage_start:
            return RuleResult("ELIGIBILITY", False,
                f"Service date {ctx.service_date} is before coverage start {ctx.coverage_start}",
                severity="BLOCK")
        if ctx.coverage_end and ctx.service_date > ctx.coverage_end:
            return RuleResult("ELIGIBILITY", False,
                f"Service date {ctx.service_date} is after coverage end {ctx.coverage_end}",
                severity="BLOCK")
        return RuleResult("ELIGIBILITY", True, "Member is eligible on date of service")

    def _check_preauthorization(self, ctx: RuleContext) -> RuleResult:
        requires_preauth = (
            (ctx.claim_type == "INPATIENT" and ctx.requires_preauth_inpatient)
            or (ctx.claim_type == "DAYCARE" and ctx.requires_preauth_daycare)
        )
        if not requires_preauth:
            return RuleResult("PREAUTHORIZATION", True,
                "Pre-authorization not required for this claim type")
        if ctx.preauth_number and ctx.preauth_approved:
            return RuleResult("PREAUTHORIZATION", True,
                f"Pre-authorization {ctx.preauth_number} approved",
                applied_values={"preauth_number": ctx.preauth_number})
        if ctx.preauth_number and not ctx.preauth_approved:
            return RuleResult("PREAUTHORIZATION", False,
                f"Pre-authorization {ctx.preauth_number} was denied", severity="BLOCK")
        if ctx.claim_type == "EMERGENCY":
            return RuleResult("PREAUTHORIZATION", True,
                "Emergency — pre-authorization waived (24-hour notification required)",
                severity="WARNING")
        return RuleResult("PREAUTHORIZATION", False,
            f"Pre-authorization required but not obtained. {ctx.preauth_penalty_pct}% penalty may apply per Section 6.1.",
            severity="WARNING", applied_values={"penalty_pct": ctx.preauth_penalty_pct})

    def _check_exclusions(self, procedure_code: str, diagnosis_code: str, exclusions: list) -> RuleResult:
        if procedure_code in self.COSMETIC_CODES:
            return RuleResult("EXCLUSION", False,
                f"Excluded: Procedure {procedure_code} classified as cosmetic/aesthetic per Section 5.1. Medical necessity exception may apply.")
        if procedure_code in self.WEIGHT_MANAGEMENT_CODES:
            return RuleResult("EXCLUSION", False,
                f"Excluded: Procedure {procedure_code} classified as weight management/bariatric per Section 5.1")
        if procedure_code in self.INFERTILITY_CODES:
            return RuleResult("EXCLUSION", False,
                f"Excluded: Procedure {procedure_code} classified as infertility treatment per Section 5.1")
        for excl in exclusions:
            excluded_codes = excl.get("structured_data", {}).get("excluded_procedure_codes", [])
            if procedure_code in excluded_codes:
                return RuleResult("EXCLUSION", False,
                    f"Excluded per {excl.get('section_reference', 'policy')}: {excl.get('title', 'Excluded service')}")
        return RuleResult("EXCLUSION", True, "No exclusions apply")

    def _check_waiting_period(self, ctx: RuleContext, procedure_code: str) -> RuleResult:
        """India: waiting period enforcement per IRDAI Health Insurance Regulations."""
        months_elapsed = (
            (ctx.service_date.year - ctx.coverage_start.year) * 12
            + (ctx.service_date.month - ctx.coverage_start.month)
        )
        if (ctx.service_date - ctx.coverage_start).days < ctx.initial_waiting_days:
            if ctx.claim_type != "EMERGENCY":
                return RuleResult("WAITING_PERIOD", False,
                    f"Initial waiting period of {ctx.initial_waiting_days} days not satisfied. "
                    f"{(ctx.service_date - ctx.coverage_start).days} days elapsed.",
                    severity="BLOCK")
        for disease, icd_prefixes in self.SPECIFIC_DISEASE_CODES.items():
            if any(ctx.primary_diagnosis.startswith(p) for p in icd_prefixes):
                if months_elapsed < ctx.specific_disease_waiting_months:
                    return RuleResult("WAITING_PERIOD", False,
                        f"Specific disease waiting period ({ctx.specific_disease_waiting_months} months) "
                        f"for {disease} not satisfied. {months_elapsed} months elapsed.",
                        severity="BLOCK")
        if ctx.primary_diagnosis in ctx.pre_existing_conditions:
            if months_elapsed < ctx.ped_waiting_months:
                return RuleResult("WAITING_PERIOD", False,
                    f"PED waiting period ({ctx.ped_waiting_months} months) not satisfied. "
                    f"{months_elapsed} months elapsed.",
                    severity="BLOCK")
        return RuleResult("WAITING_PERIOD", True, "All waiting periods satisfied")

    def _lookup_fee_schedule(self, procedure_code: str, fee_schedule: dict, network_tier: str) -> RuleResult:
        if procedure_code in fee_schedule:
            rate = fee_schedule[procedure_code]
            return RuleResult("FEE_SCHEDULE", True, f"Rate found: {rate}",
                applied_values={"rate": rate, "network_tier": network_tier})
        return RuleResult("FEE_SCHEDULE", True, "No fee schedule rate — using billed amount",
            applied_values={"rate": None})

    def _check_sub_limits(self, service_category: str, sub_limits: dict) -> RuleResult:
        category_map = {
            "DENTAL": "dental", "OPTICAL": "optical",
            "AMBULANCE": "ambulance_per_hospitalization",
            "ALTERNATIVE_MEDICINE": "alternative_medicine",
            "PHYSIOTHERAPY": "physiotherapy", "MENTAL_HEALTH": "mental_health",
        }
        sub_limit_key = category_map.get(service_category.upper())
        if sub_limit_key and sub_limit_key in sub_limits:
            limit_info = sub_limits[sub_limit_key]
            remaining = limit_info.get("remaining", limit_info.get("annual_limit", 0))
            return RuleResult("SUB_LIMIT", True, f"Sub-limit: {sub_limit_key}",
                applied_values={"sub_limit_name": sub_limit_key, "remaining": remaining})
        return RuleResult("SUB_LIMIT", True, "No sub-limit applies", applied_values={})

    # ─────────────────────────────────────────────────────────────────────────
    # GCC-SPECIFIC RULES
    # ─────────────────────────────────────────────────────────────────────────

    def _check_gcc_essential_benefits(self, service_category: str, ctx: RuleContext) -> RuleResult:
        """
        GCC R7: DHA/DOH/CCHI Essential Benefits Package.

        RULE: If a service IS in the EBP, it CANNOT be excluded by company policy
              → pass=True (positive signal; exclusion override handled in R3).
        If a service is OUTSIDE the EBP, the DHA/DOH mandate simply does not apply
        to it; company policy governs → pass=True (informational only, no HITL).

        IMPORTANT: pass=False is NOT used here because being outside the EBP is NOT
        a policy violation — it merely means the service is unregulated by the EBP
        floor.  Flagging outside-EBP services as HITL caused ~70% of claims to route
        to human review incorrectly.
        """
        if not ctx.essential_benefits_floor:
            return RuleResult("ESSENTIAL_BENEFITS", True,
                "Essential benefits floor not applicable for this policy tier")

        if service_category.upper() in self.GCC_ESSENTIAL_BENEFIT_CATEGORIES:
            return RuleResult("ESSENTIAL_BENEFITS", True,
                f"Service category '{service_category}' is within GCC Essential Benefits Package — "
                "company may not exclude this service",
                applied_values={"essential": True, "category": service_category})

        # Outside EBP — company policy terms govern; the DHA/DOH mandate is not triggered.
        # Return passed=True so the pipeline continues without forcing HITL.
        return RuleResult("ESSENTIAL_BENEFITS", True,
            f"Service category '{service_category}' is outside Essential Benefits Package — "
            "company policy applies (DHA/DOH EBP mandate not triggered)",
            severity="INFO",
            applied_values={"essential": False, "category": service_category})

    def _apply_gcc_copay(self, billed_amount: Decimal, ctx: RuleContext) -> RuleResult:
        """
        GCC R8: Apply co-pay percentage based on network tier.
        UAE DHA: In-network 10%, Out-of-network 20%, Direct billing 0%
        KSA CCHI: varies by plan tier
        """
        tier = ctx.network_tier.upper()
        if tier in ("DIRECT_BILLING", "DIRECT"):
            copay_pct = ctx.copay_direct_billing_pct
        elif tier in ("OUT_OF_NETWORK", "OUT", "NON_NETWORK", "NON_LISTED", "NON-LISTED", "UNLISTED"):
            copay_pct = ctx.copay_out_of_network_pct
        else:
            copay_pct = ctx.copay_in_network_pct  # default: in-network

        copay_amount = (billed_amount * Decimal(str(copay_pct))) / Decimal("100")
        return RuleResult("GCC_COPAY", True,
            f"Co-pay: {copay_pct}% ({ctx.network_tier} network)",
            applied_values={
                "copay_pct":    copay_pct,
                "copay_amount": float(copay_amount),
                "network_tier": ctx.network_tier,
            })

    def _check_gcc_drg_routing(self, billed_amount: Decimal, ctx: RuleContext) -> RuleResult:
        """
        GCC R9: Route high-value claims to HITL for DRG-based validation.
        DRG (Diagnosis-Related Group) billing is standard in UAE/KSA hospitals.
        Claims above thresholds should be validated against DRG rate tables.
        """
        if ctx.claim_type == "INPATIENT" and billed_amount > Decimal(str(ctx.gcc_drg_threshold)):
            return RuleResult("GCC_DRG_ROUTING", True,
                f"High-value inpatient claim ({billed_amount}) flagged for DRG validation (threshold: {ctx.gcc_drg_threshold})",
                applied_values={"hitl_recommended": True, "drg_validation_required": True},
                severity="WARNING")
        return RuleResult("GCC_DRG_ROUTING", True,
            "Claim within standard thresholds — DRG routing not required",
            applied_values={"hitl_recommended": False})

    # ─────────────────────────────────────────────────────────────────────────
    # INDIA-SPECIFIC RULES
    # ─────────────────────────────────────────────────────────────────────────

    def _check_india_room_rent_cap(self, billed_amount: Decimal, category: str, ctx: RuleContext) -> RuleResult:
        """
        India R7: Room rent cannot exceed the policy's room rent sub-limit.
        Standard: 1% (Normal) / 2% (ICU) of sum insured per day (IRDAI recommendation).
        """
        is_icu = category.upper() == "ICU"
        
        # Determine cap
        if is_icu:
            if ctx.icu_rent_daily_cap > Decimal("0"):
                cap = ctx.icu_rent_daily_cap
            else:
                cap = (ctx.sum_insured * Decimal(str(ctx.icu_rent_limit_pct))) / Decimal("100")
            label = "ICU Rent"
        else:
            if ctx.room_rent_daily_cap > Decimal("0"):
                cap = ctx.room_rent_daily_cap
            else:
                cap = (ctx.sum_insured * Decimal(str(ctx.room_rent_limit_pct))) / Decimal("100")
            label = "Room Rent"

        if ctx.sum_insured <= Decimal("0") and cap <= Decimal("0"):
            return RuleResult(f"INDIA_{category.upper()}", True, f"No {label} cap configured")

        if billed_amount <= cap:
            return RuleResult(f"INDIA_{category.upper()}", True,
                f"{label} {billed_amount} is within daily cap {cap}",
                applied_values={"daily_cap": float(cap), "capped_amount": float(billed_amount)})

        # Proportionate deduction trigger
        excess = billed_amount - cap
        return RuleResult(f"INDIA_{category.upper()}", True,
            f"{label} {billed_amount} exceeds daily cap {cap} by {excess}. "
            "Proportionate deduction will apply to associated charges.",
            severity="WARNING",
            applied_values={
                "daily_cap":    float(cap),
                "capped_amount": float(cap),
                "excess":       float(excess),
                "proportionate_reduction_pct": float((excess / billed_amount) * 100),
            })

    def _check_india_gipsa_rate(self, billed_amount: Decimal, ctx: RuleContext, procedure_code: str) -> RuleResult:
        """
        India R8: GIPSA (General Insurance Public Sector Association) rate compliance.
        Cashless claims under GIPSA empanelment cannot exceed negotiated package rates.
        If specific negotiated rate is missing, falls back to Market Reference Library.
        """
        # 1. Use specific negotiated rate if provided in context
        gipsa_rate = ctx.gipsa_package_rate

        # 2. Fallback to Market Reference Library
        if gipsa_rate is None and ctx.market_reference:
            # market_reference expected structure: {"packages": [{"procedure_code": "TURP", "rates": {"TIER_1": {"GRADE_A": 75000}}}]}
            packages = ctx.market_reference.get("packages", [])
            pkg = next((p for p in packages if p["procedure_code"] == procedure_code), None)
            if pkg:
                rates = pkg.get("rates", {})
                tier_rates = rates.get(ctx.city_tier, {})
                market_rate = tier_rates.get(ctx.hospital_grade)
                if market_rate:
                    gipsa_rate = Decimal(str(market_rate))

        if not gipsa_rate:
            return RuleResult("INDIA_GIPSA", True,
                f"No GIPSA package rate found for {procedure_code} (Market Ref: {'Available' if ctx.market_reference else 'Missing'}) — proceeding with billed amount")

        if billed_amount <= gipsa_rate:
            return RuleResult("INDIA_GIPSA", True,
                f"Billed amount {billed_amount} is within GIPSA package rate {gipsa_rate} (Tier: {ctx.city_tier}, Grade: {ctx.hospital_grade})",
                applied_values={"gipsa_rate": float(gipsa_rate), "city_tier": ctx.city_tier, "hospital_grade": ctx.hospital_grade})

        excess = billed_amount - gipsa_rate
        return RuleResult("INDIA_GIPSA", True,
            f"Billed {billed_amount} exceeds GIPSA package rate {gipsa_rate} by {excess}. "
            f"Excess amount is member responsibility. (Tier: {ctx.city_tier}, Grade: {ctx.hospital_grade})",
            severity="WARNING",
            applied_values={
                "gipsa_rate":     float(gipsa_rate),
                "excess":         float(excess),
                "allowed_amount": float(gipsa_rate),
                "city_tier":      ctx.city_tier,
                "hospital_grade": ctx.hospital_grade,
            })

    def _check_india_cashless_protocol(self, ctx: RuleContext) -> RuleResult:
        """
        India R9: Cashless claims require TPA pre-authorization.
        Reimbursement claims require original documents within 30 days.
        """
        if ctx.is_cashless:
            if ctx.preauth_number and ctx.preauth_approved:
                return RuleResult("INDIA_CASHLESS", True,
                    f"Cashless authorization {ctx.preauth_number} verified via TPA {ctx.tpa_name}",
                    applied_values={"cashless": True, "tpa": ctx.tpa_name})
            return RuleResult("INDIA_CASHLESS", False,
                "Cashless claim: TPA authorization required but not found. "
                "Claim may be converted to reimbursement basis.",
                severity="WARNING",
                applied_values={"cashless": False, "requires_conversion": True})

        # Reimbursement: document submission reminder
        return RuleResult("INDIA_CASHLESS", True,
            "Reimbursement claim: original documents required within 30 days of discharge",
            applied_values={"cashless": False, "document_submission_days": 30})

    def _check_india_ayush(self, service_category: str, ctx: RuleContext) -> RuleResult:
        """
        India R10: AYUSH (Ayurveda, Yoga, Naturopathy, Unani, Siddha, Homeopathy).
        IRDAI mandates AYUSH coverage in empanelled hospitals only.
        Minimum hospitalization: 1 day required.
        """
        # Check if minimum 1-day hospitalization is met
        if ctx.claim_type not in ("INPATIENT", "DAYCARE"):
            return RuleResult("INDIA_AYUSH", False,
                f"AYUSH {service_category} requires minimum {ctx.ayush_min_days}-day inpatient/daycare admission. "
                "Outpatient AYUSH consultations are not covered.",
                severity="BLOCK")

        # Check AYUSH sub-limit in policy (from sub_limits)
        ayush_limit = ctx.sub_limits.get("ayush", {})
        if not ayush_limit and not ctx.sub_limits.get("alternative_medicine"):
            return RuleResult("INDIA_AYUSH", True,
                f"AYUSH {service_category} covered: no sub-limit found — standard annual limit applies")

        remaining = ayush_limit.get("remaining", ayush_limit.get("annual_limit", 0))
        return RuleResult("INDIA_AYUSH", True,
            f"AYUSH {service_category} covered: sub-limit remaining {remaining}",
            applied_values={"sub_limit_name": "ayush", "remaining": remaining})

    def _check_india_domiciliary(self, ctx: RuleContext) -> RuleResult:
        """
        India R11: Domiciliary hospitalization.
        Covered only if: (a) condition requires treatment at home due to non-availability
        of hospital beds OR (b) condition makes hospitalization impossible.
        Minimum 3-day continuous treatment required.
        """
        if not ctx.admission_date or not ctx.discharge_date:
            return RuleResult("INDIA_DOMICILIARY", False,
                "Domiciliary claim: admission and discharge dates required for duration check",
                severity="WARNING")

        duration = (ctx.discharge_date - ctx.admission_date).days
        if duration < ctx.domiciliary_min_days:
            return RuleResult("INDIA_DOMICILIARY", False,
                f"Domiciliary hospitalization: minimum {ctx.domiciliary_min_days}-day treatment required. "
                f"Duration submitted: {duration} day(s). Refer to policy Section 12.",
                severity="WARNING")

        return RuleResult("INDIA_DOMICILIARY", True,
            f"Domiciliary hospitalization: {duration}-day treatment qualifies. "
            "Subject to medical certificate from treating physician.",
            applied_values={"duration_days": duration})
