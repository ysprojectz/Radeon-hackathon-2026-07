"""
Calculation Agent — Claude-powered settlement verification and sanitization.

Uses Anthropic Claude (claude-sonnet-4-6) with tool_use to:
  1. Sanitize calculation inputs before they reach the deterministic calculator.
  2. Verify the calculator's output: cross-check arithmetic, detect anomalies,
     flag values that exceed policy limits or violate market-specific rules.
  3. Return a structured CalculationVerification with a confidence delta and
     an APPROVE | FLAG_FOR_REVIEW | REJECT recommendation.

Pipeline position: Step 5b — runs after SettlementCalculator (Step 5) and
before confidence scoring (Step 6).
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

@dataclass
class AnomalyFlag:
    line_number: Optional[int]
    field: str
    description: str
    severity: str  # "INFO" | "WARNING" | "ERROR"


@dataclass
class CalculationVerification:
    """Structured result returned by the Calculation Agent."""
    is_correct: bool
    confidence: float                               # 0.0 – 1.0
    recommendation: str                             # "APPROVE" | "FLAG_FOR_REVIEW" | "REJECT"
    anomalies: list[AnomalyFlag] = field(default_factory=list)
    corrections: list[dict] = field(default_factory=list)
    agent_available: bool = True
    fallback_reason: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "is_correct":      self.is_correct,
            "confidence":      round(self.confidence, 4),
            "recommendation":  self.recommendation,
            "anomalies": [
                {
                    "line":        a.line_number,
                    "field":       a.field,
                    "description": a.description,
                    "severity":    a.severity,
                }
                for a in self.anomalies
            ],
            "corrections":     self.corrections,
            "agent_available": self.agent_available,
            "fallback_reason": self.fallback_reason,
        }

    @property
    def confidence_delta(self) -> Decimal:
        """Signed adjustment to pipeline confidence score (+5 to -15)."""
        if self.recommendation == "APPROVE":
            return Decimal("5")
        if self.recommendation == "FLAG_FOR_REVIEW":
            return Decimal("-5")
        return Decimal("-15")   # REJECT


# ---------------------------------------------------------------------------
# Input sanitizer — runs BEFORE the deterministic calculator
# ---------------------------------------------------------------------------

class CalculationSanitizer:
    """
    Pure-Python input sanitizer — no LLM required.
    Validates and clamps all inputs so the calculator always receives
    safe, well-formed values.
    """

    MAX_BILLED   = Decimal("10_000_000")   # 10 M upper sanity bound
    MAX_COPAY_PCT = 100
    MAX_VAT_RATE  = 25.0                   # %

    @staticmethod
    def _to_decimal(value, field_name: str, default: Decimal = Decimal("0")) -> Decimal:
        if value is None:
            return default
        try:
            d = Decimal(str(value))
            if not d.is_finite():
                logger.warning("[SANITIZER] %s is non-finite (%s) → replaced with %s",
                               field_name, value, default)
                return default
            return d
        except (InvalidOperation, ValueError, TypeError):
            logger.warning("[SANITIZER] %s is not numeric (%r) → replaced with %s",
                           field_name, value, default)
            return default

    def sanitize_policy_params(self, params: dict) -> dict:
        out = dict(params)

        for key in (
            "annual_limit", "individual_deductible", "oop_max",
            "outpatient_copay_max_per_visit", "inpatient_copay_flat",
            "inpatient_copay_annual_max", "diagnostic_copay_max_per_visit",
            "room_rent_daily_cap", "sum_insured",
        ):
            if key in out:
                out[key] = max(Decimal("0"), self._to_decimal(out[key], key))

        if out.get("annual_limit", Decimal("0")) <= 0:
            logger.warning("[SANITIZER] annual_limit ≤ 0 → reset to 1,000,000")
            out["annual_limit"] = Decimal("1_000_000")

        for key in (
            "outpatient_copay_pct", "pharmacy_copay_pct",
            "diagnostic_copay_pct", "emergency_copay_pct",
        ):
            if key in out:
                out[key] = max(0, min(self.MAX_COPAY_PCT, int(out[key])))

        if "vat_rate" in out:
            out["vat_rate"] = max(0.0, min(self.MAX_VAT_RATE, float(out["vat_rate"])))

        if "room_rent_limit_pct" in out:
            out["room_rent_limit_pct"] = max(0.0, min(100.0, float(out["room_rent_limit_pct"])))

        return out

    def sanitize_line_item(self, item: dict, line_number: int) -> dict:
        out = dict(item)

        billed = self._to_decimal(out.get("billed_amount"), f"line {line_number} billed_amount")
        if billed <= 0:
            logger.warning("[SANITIZER] line %d billed_amount ≤ 0 → set to 0.01", line_number)
            billed = Decimal("0.01")
        if billed > self.MAX_BILLED:
            logger.warning("[SANITIZER] line %d billed_amount %s exceeds MAX → clamped", line_number, billed)
            billed = self.MAX_BILLED
        out["billed_amount"] = billed

        if "fee_schedule_rate" in out and out["fee_schedule_rate"] is not None:
            rate = self._to_decimal(out["fee_schedule_rate"], f"line {line_number} fee_schedule_rate")
            out["fee_schedule_rate"] = max(Decimal("0"), rate)

        if "copay_pct_override" in out and out["copay_pct_override"] is not None:
            out["copay_pct_override"] = max(0.0, min(100.0, float(out["copay_pct_override"])))

        if not out.get("service_category"):
            out["service_category"] = "CONSULTATION"

        return out

    def sanitize_claim_inputs(
        self,
        policy_params: dict,
        line_items: list[dict],
    ) -> tuple[dict, list[dict], list[AnomalyFlag]]:
        """
        Sanitize all inputs.
        Returns (clean_params, clean_items, anomalies).
        """
        anomalies: list[AnomalyFlag] = []

        orig_params  = dict(policy_params)
        clean_params = self.sanitize_policy_params(policy_params)
        for k in clean_params:
            if str(clean_params.get(k)) != str(orig_params.get(k)):
                anomalies.append(AnomalyFlag(
                    line_number=None, field=k,
                    description=(
                        f"policy_params.{k} sanitized: "
                        f"{orig_params.get(k)!r} → {clean_params[k]!r}"
                    ),
                    severity="WARNING",
                ))

        clean_items: list[dict] = []
        for i, item in enumerate(line_items):
            ln   = item.get("line_number", i + 1)
            orig = dict(item)
            cleaned = self.sanitize_line_item(item, ln)
            clean_items.append(cleaned)
            for k in ("billed_amount", "fee_schedule_rate", "copay_pct_override", "service_category"):
                if str(cleaned.get(k)) != str(orig.get(k)):
                    anomalies.append(AnomalyFlag(
                        line_number=ln, field=k,
                        description=(
                            f"line {ln}.{k} sanitized: "
                            f"{orig.get(k)!r} → {cleaned[k]!r}"
                        ),
                        severity="WARNING",
                    ))

        return clean_params, clean_items, anomalies


# ---------------------------------------------------------------------------
# Claude tool definition
# ---------------------------------------------------------------------------

_VERIFY_TOOL = {
    "name": "verify_settlement",
    "description": (
        "Submit a structured verification of a health insurance settlement calculation. "
        "Check every arithmetic step, validate policy-rule compliance, and flag anomalies."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "is_correct": {
                "type": "boolean",
                "description": "True if the settlement arithmetic is correct and policy-compliant.",
            },
            "confidence": {
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0,
                "description": "Agent confidence that the settlement is correct (0–1).",
            },
            "anomalies": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "line_number": {"type": ["integer", "null"]},
                        "field":       {"type": "string"},
                        "description": {"type": "string"},
                        "severity": {
                            "type": "string",
                            "enum": ["INFO", "WARNING", "ERROR"],
                        },
                    },
                    "required": ["field", "description", "severity"],
                },
                "description": "Detected anomalies.  Empty list if none found.",
            },
            "corrections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "line_number":    {"type": ["integer", "null"]},
                        "field":          {"type": "string"},
                        "computed_value": {"type": "string"},
                        "reported_value": {"type": "string"},
                        "delta":          {"type": "string"},
                    },
                    "required": ["field", "computed_value", "reported_value", "delta"],
                },
                "description": "Re-computed values that differ from the reported settlement.",
            },
            "recommendation": {
                "type": "string",
                "enum": ["APPROVE", "FLAG_FOR_REVIEW", "REJECT"],
                "description": (
                    "APPROVE — arithmetic correct and within policy limits. "
                    "FLAG_FOR_REVIEW — minor discrepancies or warnings present. "
                    "REJECT — material arithmetic errors or policy violations detected."
                ),
            },
        },
        "required": [
            "is_correct", "confidence", "anomalies", "corrections", "recommendation"
        ],
    },
}

_SYSTEM_PROMPT = """\
You are a specialist health-insurance settlement auditor.

Verify the arithmetic and policy compliance of a claims settlement produced by a
deterministic calculator.  Be systematic and precise.

## Verification checklist

### Per line item
1. allowed_amount = min(billed_amount, fee_schedule_rate)  [if fee schedule is set]
2. copay must not exceed allowed_amount
3. plan_payment = allowed_amount − deductible_share − copay  (must be ≥ 0)
4. member_responsibility = billed_amount − plan_payment       (must be ≥ 0)
5. No monetary field may be negative.

### GCC market rules
- Outpatient copay is percentage-based with a per-visit cap (typical AED 50)
- Inpatient copay is a flat admission fee (typical AED 200), NOT a percentage
- Emergency copay = 0
- VAT (5 % UAE / 15 % KSA) is exempt for PHARMACY, CONSULTATION, PROCEDURE
- Total plan_payment ≤ annual_limit

### India market rules
- Proportionate deduction ratio = eligible_room_rent / actual_room_rent (must be 0–1)
- Ratio must NOT be applied to diagnostics, pharmacy, or consumables
- Aggregate deductible is distributed proportionally across covered items
- plan_payment ≤ GIPSA rate where applicable
- Total plan_payment ≤ sum_insured

### Anomaly thresholds
- Any single line item > 30 % of annual_limit → WARNING
- plan_payment > allowed_amount → ERROR
- copay > 50 % of billed_amount → WARNING
- member_responsibility > billed_amount → ERROR
- allowed_amount > billed_amount → ERROR

Always call the verify_settlement tool with your findings.
"""


# ---------------------------------------------------------------------------
# Calculation Agent
# ---------------------------------------------------------------------------

class CalculationAgent:
    """
    Claude-powered settlement verification agent.
    Degrades gracefully when ANTHROPIC_API_KEY is absent.
    """

    MODEL = "claude-sonnet-4-6"

    def __init__(self) -> None:
        self._client   = None
        self._available = False
        # Gated on ANTHROPIC_ENABLED too, not just the API key being present —
        # every other provider in this codebase respects an ENABLED flag
        # independent of whether a key happens to be set in the environment;
        # this one didn't, so a host that exports ANTHROPIC_API_KEY for an
        # unrelated reason would silently activate cloud calls here regardless
        # of the "disabled" setting elsewhere (flagged by independent audit,
        # fixed 2026-07-24).
        anthropic_enabled = os.getenv("ANTHROPIC_ENABLED", "false").lower() == "true"
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if anthropic_enabled and api_key:
            try:
                import anthropic  # noqa: PLC0415
                self._client    = anthropic.Anthropic(api_key=api_key)
                self._available = True
                logger.info("[CALC-AGENT] Ready (model=%s)", self.MODEL)
            except ImportError:
                logger.warning("[CALC-AGENT] anthropic package not installed — agent disabled")
        elif api_key and not anthropic_enabled:
            logger.info("[CALC-AGENT] ANTHROPIC_API_KEY is set but ANTHROPIC_ENABLED is false — running arithmetic-only mode")
        else:
            logger.info("[CALC-AGENT] ANTHROPIC_API_KEY not set — running arithmetic-only mode")

    @property
    def available(self) -> bool:
        return self._available

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def verify(
        self,
        settlement,            # SettlementResult dataclass
        policy_params: dict,
        market_region: str,
    ) -> CalculationVerification:
        if not self._available or self._client is None:
            return self._arithmetic_verify(settlement, market_region)
        try:
            return self._claude_verify(settlement, policy_params, market_region)
        except Exception as exc:
            logger.warning("[CALC-AGENT] Claude call failed (%s) — falling back to arithmetic", exc)
            return self._arithmetic_verify(settlement, market_region)

    # ------------------------------------------------------------------
    # Claude path
    # ------------------------------------------------------------------

    def _build_payload(self, settlement, policy_params: dict, market_region: str) -> str:
        import json

        def s(v):
            return str(v) if v is not None else None

        def attr(obj, *names, default=None):
            for name in names:
                value = getattr(obj, name, None)
                if value is not None:
                    return value
            return default

        lines_out = []
        for li in (getattr(settlement, "line_items", None) or []):
            if isinstance(li, dict):
                lines_out.append(li)
            else:
                lines_out.append({
                    "line_number":           getattr(li, "line_number", None),
                    "procedure_code":        getattr(li, "procedure_code", None),
                    "service_category":      getattr(li, "service_category", None),
                    "billed_amount":         s(getattr(li, "billed_amount", None)),
                    "allowed_amount":        s(getattr(li, "allowed_amount", None)),
                    "fee_schedule_rate":     s(getattr(li, "fee_schedule_rate", None)),
                    "copay_amount":          s(getattr(li, "copay_amount", None)),
                    "copay_pct":             getattr(li, "copay_pct", None),
                    "deductible_applied":    s(getattr(li, "deductible_applied", None)),
                    "plan_payment":          s(attr(li, "plan_payment", "plan_paid")),
                    "member_responsibility": s(getattr(li, "member_responsibility", None)),
                    "sub_limit_excess":      s(getattr(li, "sub_limit_excess", None)),
                })

        return json.dumps(
            {
                "market_region": market_region,
                "currency":      getattr(settlement, "currency", "AED"),
                "policy": {
                    "annual_limit":          s(policy_params.get("annual_limit")),
                    "individual_deductible": s(policy_params.get("individual_deductible")),
                    "vat_applicable":        policy_params.get("vat_applicable", False),
                    "vat_rate":              policy_params.get("vat_rate", 5.0),
                    "tier":                  policy_params.get("tier", ""),
                },
                "totals": {
                    "total_billed":               s(getattr(settlement, "total_billed", None)),
                    "total_allowed":              s(getattr(settlement, "total_allowed", None)),
                    "total_copay":                s(getattr(settlement, "total_copay", None)),
                    "total_deductible_applied":   s(getattr(settlement, "total_deductible_applied", None)),
                    "total_plan_payment":         s(getattr(settlement, "total_plan_payment", None)),
                    "total_member_responsibility": s(getattr(settlement, "total_member_responsibility", None)),
                },
                "line_items": lines_out,
            },
            indent=2,
            default=str,
        )

    def _claude_verify(
        self,
        settlement,
        policy_params: dict,
        market_region: str,
    ) -> CalculationVerification:
        payload = self._build_payload(settlement, policy_params, market_region)

        response = self._client.messages.create(
            model=self.MODEL,
            max_tokens=2048,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},  # prompt caching
                }
            ],
            tools=[_VERIFY_TOOL],
            tool_choice={"type": "tool", "name": "verify_settlement"},
            messages=[{"role": "user", "content": payload}],
        )

        tool_result = None
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "verify_settlement":
                tool_result = block.input
                break

        if tool_result is None:
            logger.warning("[CALC-AGENT] Claude did not invoke verify_settlement — arithmetic fallback")
            return self._arithmetic_verify(settlement, market_region)

        anomalies = [
            AnomalyFlag(
                line_number=a.get("line_number"),
                field=a.get("field", "unknown"),
                description=a.get("description", ""),
                severity=a.get("severity", "INFO"),
            )
            for a in (tool_result.get("anomalies") or [])
        ]

        logger.info(
            "[CALC-AGENT] is_correct=%s confidence=%.2f recommendation=%s anomalies=%d",
            tool_result.get("is_correct"),
            tool_result.get("confidence", 0),
            tool_result.get("recommendation"),
            len(anomalies),
        )

        return CalculationVerification(
            is_correct=bool(tool_result.get("is_correct", False)),
            confidence=float(tool_result.get("confidence", 0.5)),
            recommendation=tool_result.get("recommendation", "FLAG_FOR_REVIEW"),
            anomalies=anomalies,
            corrections=tool_result.get("corrections") or [],
            agent_available=True,
        )

    # ------------------------------------------------------------------
    # Arithmetic-only fallback (no LLM)
    # ------------------------------------------------------------------

    def _arithmetic_verify(
        self,
        settlement,
        market_region: str,
    ) -> CalculationVerification:
        anomalies: list[AnomalyFlag] = []
        ZERO = Decimal("0")
        EPS  = Decimal("0.02")          # 2-cent rounding tolerance

        try:
            total_billed  = Decimal(str(getattr(settlement, "total_billed",               0) or 0))
            total_allowed = Decimal(str(getattr(settlement, "total_allowed",              0) or 0))
            total_plan    = Decimal(str(getattr(settlement, "total_plan_payment",         0) or 0))
            total_member  = Decimal(str(getattr(settlement, "total_member_responsibility",0) or 0))

            if abs((total_plan + total_member) - total_billed) > EPS:
                anomalies.append(AnomalyFlag(
                    line_number=None, field="totals",
                    description=(
                        f"plan_payment ({total_plan}) + member_responsibility ({total_member})"
                        f" ≠ total_billed ({total_billed})"
                    ),
                    severity="ERROR",
                ))

            if total_allowed > total_billed + EPS:
                anomalies.append(AnomalyFlag(
                    line_number=None, field="total_allowed",
                    description=f"total_allowed ({total_allowed}) > total_billed ({total_billed})",
                    severity="ERROR",
                ))

            for li in (getattr(settlement, "line_items", None) or []):
                ln      = getattr(li, "line_number",           None)
                billed  = Decimal(str(getattr(li, "billed_amount",         0) or 0))
                allowed = Decimal(str(getattr(li, "allowed_amount",        0) or 0))
                copay   = Decimal(str(getattr(li, "copay_amount",          0) or 0))
                plan_raw = getattr(li, "plan_payment", None)
                if plan_raw is None:
                    plan_raw = getattr(li, "plan_paid", 0)
                plan    = Decimal(str(plan_raw or 0))
                member  = Decimal(str(getattr(li, "member_responsibility", 0) or 0))

                if allowed > billed + EPS:
                    anomalies.append(AnomalyFlag(
                        line_number=ln, field="allowed_amount",
                        description=f"allowed_amount ({allowed}) > billed_amount ({billed})",
                        severity="ERROR",
                    ))
                if copay > allowed + EPS:
                    anomalies.append(AnomalyFlag(
                        line_number=ln, field="copay_amount",
                        description=f"copay ({copay}) > allowed_amount ({allowed})",
                        severity="ERROR",
                    ))
                if plan < ZERO - EPS:
                    anomalies.append(AnomalyFlag(
                        line_number=ln, field="plan_payment",
                        description=f"plan_payment is negative: {plan}",
                        severity="ERROR",
                    ))
                if member < ZERO - EPS:
                    anomalies.append(AnomalyFlag(
                        line_number=ln, field="member_responsibility",
                        description=f"member_responsibility is negative: {member}",
                        severity="ERROR",
                    ))
                if abs((plan + member) - billed) > EPS:
                    anomalies.append(AnomalyFlag(
                        line_number=ln, field="line_totals",
                        description=(
                            f"plan ({plan}) + member ({member}) ≠ billed ({billed})"
                            f"  Δ={abs(plan + member - billed)}"
                        ),
                        severity="WARNING",
                    ))
                if billed > 0 and copay / billed > Decimal("0.50"):
                    anomalies.append(AnomalyFlag(
                        line_number=ln, field="copay_pct",
                        description=f"copay ({copay}) is >50 % of billed ({billed}) — unusual",
                        severity="WARNING",
                    ))

        except Exception as exc:
            logger.warning("[CALC-AGENT] Arithmetic verification error: %s", exc)
            anomalies.append(AnomalyFlag(
                line_number=None, field="arithmetic_check",
                description=f"Verification error: {exc}",
                severity="WARNING",
            ))

        errors   = [a for a in anomalies if a.severity == "ERROR"]
        warnings = [a for a in anomalies if a.severity == "WARNING"]
        is_correct = not errors

        if errors:
            confidence, recommendation = 0.30, "REJECT"
        elif warnings:
            confidence, recommendation = 0.65, "FLAG_FOR_REVIEW"
        else:
            confidence, recommendation = 0.85, "APPROVE"

        return CalculationVerification(
            is_correct=is_correct,
            confidence=confidence,
            recommendation=recommendation,
            anomalies=anomalies,
            corrections=[],
            agent_available=False,
            fallback_reason="arithmetic-only mode (Claude unavailable)",
        )


# ---------------------------------------------------------------------------
# Module-level singletons
# ---------------------------------------------------------------------------

_sanitizer: Optional[CalculationSanitizer] = None
_agent:     Optional[CalculationAgent]     = None


def get_sanitizer() -> CalculationSanitizer:
    global _sanitizer
    if _sanitizer is None:
        _sanitizer = CalculationSanitizer()
    return _sanitizer


def get_calculation_agent() -> CalculationAgent:
    global _agent
    if _agent is None:
        _agent = CalculationAgent()
    return _agent
