"""
Universal Completeness Validator — Market-Agnostic Safety Rules

This module implements mandatory completeness validation that applies to ALL markets
(India, UAE, KSA, Bahrain, etc.). These are universal safety rules that ensure the
system never auto-settles when any processing component fails.

Key Principle:
    If ANY component fails (Rules Engine, AI Reasoning, Citations, Settlement) → HITL
    Never auto-settle incomplete or failed processing.

Safe Confidence Calculation:
    - All required components complete → confidence = calculated confidence (max 100%)
    - Required AI reasoning skipped    → confidence = min(calculated, 80%)
    - Advisory AI not needed           → confidence = calculated confidence
    - Any component failed             → confidence = min(calculated, 75%) + MANDATORY HITL

Design:
    - Market-agnostic: applies equally to India, GCC, and all future markets
    - Non-waivable: these rules cannot be overridden by market-specific config
    - Defensive: fails closed (HITL) rather than open (auto-settle)
"""
import logging
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class ComponentStatus(str, Enum):
    """Status of a processing component."""
    COMPLETED = "COMPLETED"          # Component executed successfully
    SKIPPED = "SKIPPED"              # Component intentionally skipped (e.g., AI disabled)
    FAILED = "FAILED"                # Component failed with error
    NOT_STARTED = "NOT_STARTED"      # Component not yet executed


@dataclass
class ProcessingCompleteness:
    """
    Tracks completion status of all processing components.

    This is the single source of truth for "did the system fully process this claim?"
    """
    # Core processing components (all MUST complete for auto-settlement)
    rules_engine_status: ComponentStatus
    ai_reasoning_status: ComponentStatus
    policy_citations_status: ComponentStatus
    settlement_calculation_status: ComponentStatus

    # Error details (populated when status=FAILED)
    rules_engine_error: Optional[str] = None
    ai_reasoning_error: Optional[str] = None
    policy_citations_error: Optional[str] = None
    settlement_calculation_error: Optional[str] = None

    # Metadata
    rules_engine_items_evaluated: int = 0
    ai_reasoning_citations_found: int = 0
    policy_citations_count: int = 0
    settlement_line_items_calculated: int = 0

    _STATUS_FIELDS = (
        "rules_engine_status",
        "ai_reasoning_status",
        "policy_citations_status",
        "settlement_calculation_status",
    )

    def canonicalize_statuses(self) -> dict:
        """
        Normalize component statuses before validation decisions.

        This keeps legacy string payloads and DB-loaded JSON from bypassing
        completeness safety checks because they are not already ComponentStatus
        enum instances.
        """
        normalized_fields: list[str] = []
        unknown_fields: list[str] = []

        for field_name in self._STATUS_FIELDS:
            original = getattr(self, field_name)
            if isinstance(original, ComponentStatus):
                continue

            canonical_value = str(original or "").strip().upper()
            try:
                canonical_status = ComponentStatus(canonical_value)
            except ValueError:
                canonical_status = ComponentStatus.FAILED
                unknown_fields.append(field_name)
                error_field = field_name.replace("_status", "_error")
                if not getattr(self, error_field, None):
                    setattr(self, error_field, f"Unknown component status: {original!r}")

            setattr(self, field_name, canonical_status)
            normalized_fields.append(field_name)

        return {
            "normalized_fields": normalized_fields,
            "unknown_fields": unknown_fields,
            "normalized_count": len(normalized_fields),
            "unknown_count": len(unknown_fields),
        }

    @property
    def all_completed(self) -> bool:
        """True only if ALL components completed successfully."""
        return all([
            self.rules_engine_status == ComponentStatus.COMPLETED,
            self.ai_reasoning_status == ComponentStatus.COMPLETED,
            self.policy_citations_status == ComponentStatus.COMPLETED,
            self.settlement_calculation_status == ComponentStatus.COMPLETED,
        ])

    @property
    def any_failed(self) -> bool:
        """True if ANY component failed."""
        return any([
            self.rules_engine_status == ComponentStatus.FAILED,
            self.ai_reasoning_status == ComponentStatus.FAILED,
            self.policy_citations_status == ComponentStatus.FAILED,
            self.settlement_calculation_status == ComponentStatus.FAILED,
        ])

    @property
    def any_skipped(self) -> bool:
        """True if ANY component was skipped."""
        return any([
            self.rules_engine_status == ComponentStatus.SKIPPED,
            self.ai_reasoning_status == ComponentStatus.SKIPPED,
            self.policy_citations_status == ComponentStatus.SKIPPED,
            self.settlement_calculation_status == ComponentStatus.SKIPPED,
        ])

    @property
    def completion_percentage(self) -> int:
        """Calculate completion percentage (0-100)."""
        statuses = [
            self.rules_engine_status,
            self.ai_reasoning_status,
            self.policy_citations_status,
            self.settlement_calculation_status,
        ]
        completed_count = sum(1 for s in statuses if s == ComponentStatus.COMPLETED)
        return int((completed_count / len(statuses)) * 100)

    @property
    def failure_reasons(self) -> list[str]:
        """Get list of all failure reasons."""
        reasons = []
        if self.rules_engine_status == ComponentStatus.FAILED and self.rules_engine_error:
            reasons.append(f"Rules Engine: {self.rules_engine_error}")
        if self.ai_reasoning_status == ComponentStatus.FAILED and self.ai_reasoning_error:
            reasons.append(f"AI Reasoning: {self.ai_reasoning_error}")
        if self.policy_citations_status == ComponentStatus.FAILED and self.policy_citations_error:
            reasons.append(f"Policy Citations: {self.policy_citations_error}")
        if self.settlement_calculation_status == ComponentStatus.FAILED and self.settlement_calculation_error:
            reasons.append(f"Settlement Calculation: {self.settlement_calculation_error}")
        return reasons

    def to_dict(self) -> dict:
        """Convert to dictionary for API response and database storage."""
        return {
            "all_completed": self.all_completed,
            "any_failed": self.any_failed,
            "any_skipped": self.any_skipped,
            "completion_percentage": self.completion_percentage,
            "components": {
                "rules_engine": {
                    "status": self.rules_engine_status.value,
                    "error": self.rules_engine_error,
                    "items_evaluated": self.rules_engine_items_evaluated,
                },
                "ai_reasoning": {
                    "status": self.ai_reasoning_status.value,
                    "error": self.ai_reasoning_error,
                    "citations_found": self.ai_reasoning_citations_found,
                },
                "policy_citations": {
                    "status": self.policy_citations_status.value,
                    "error": self.policy_citations_error,
                    "citations_count": self.policy_citations_count,
                },
                "settlement_calculation": {
                    "status": self.settlement_calculation_status.value,
                    "error": self.settlement_calculation_error,
                    "line_items_calculated": self.settlement_line_items_calculated,
                },
            },
            "failure_reasons": self.failure_reasons,
        }


class UniversalCompletenessValidator:
    """
    Universal validator for claim processing completeness.

    This validator enforces market-agnostic safety rules that prevent auto-settlement
    when any processing component fails or is incomplete.

    Usage:
        validator = UniversalCompletenessValidator()

        # Track component status during pipeline execution
        completeness = ProcessingCompleteness(
            rules_engine_status=ComponentStatus.COMPLETED,
            ai_reasoning_status=ComponentStatus.COMPLETED,
            policy_citations_status=ComponentStatus.COMPLETED,
            settlement_calculation_status=ComponentStatus.COMPLETED,
        )

        # Validate completeness and get safe confidence
        result = validator.validate(
            completeness=completeness,
            calculated_confidence=Decimal("92.5"),
            claim_reference="CLM-UAE-2026-ABC123",
        )

        # Check if HITL is required
        if result.requires_hitl:
            hitl_status = "HITL_PENDING"
            hitl_reason = result.hitl_trigger
    """

    # Confidence caps based on completeness
    CONFIDENCE_CAP_ALL_COMPLETE = 100  # No cap when all components complete
    CONFIDENCE_CAP_AI_SKIPPED = 80     # Cap at 80% when AI reasoning skipped
    CONFIDENCE_CAP_ANY_FAILED = 75     # Cap at 75% when any component failed

    def __init__(self):
        self.logger = logger

    def validate(
        self,
        completeness: ProcessingCompleteness,
        calculated_confidence: Decimal,
        claim_reference: str,
        ai_reasoning_optional: bool = False,
    ) -> "ValidationResult":
        """
        Validate claim processing completeness and calculate safe confidence.

        Args:
            completeness: Component completion status tracking
            calculated_confidence: Confidence score calculated by pipeline (0-100)
            claim_reference: Claim reference for logging

        Returns:
            ValidationResult with safe confidence, HITL flag, and trigger reason
        """
        canonicalization = completeness.canonicalize_statuses()
        if canonicalization["normalized_count"]:
            self.logger.info(
                "[COMPLETENESS] %s — Canonicalized component statuses | normalized=%s unknown=%s",
                claim_reference,
                canonicalization["normalized_fields"],
                canonicalization["unknown_fields"],
            )

        # Start with calculated confidence
        safe_confidence = calculated_confidence
        requires_hitl = False
        hitl_trigger = None
        validation_warnings = []
        confidence_cap_applied = False
        confidence_cap_reason = None
        confidence_cap_limit = None
        confidence_before_cap = calculated_confidence

        # RULE 1: Any component failed → cap confidence at 75% + MANDATORY HITL
        if completeness.any_failed:
            cap_limit = Decimal(str(self.CONFIDENCE_CAP_ANY_FAILED))
            safe_confidence = min(safe_confidence, Decimal(str(self.CONFIDENCE_CAP_ANY_FAILED)))
            confidence_cap_applied = calculated_confidence > safe_confidence
            confidence_cap_reason = "COMPONENT_FAILURE"
            confidence_cap_limit = cap_limit
            requires_hitl = True
            hitl_trigger = "INCOMPLETE_PROCESSING"

            failure_summary = "; ".join(completeness.failure_reasons)
            validation_warnings.append(
                f"Processing failed: {failure_summary}"
            )

            self.logger.warning(
                "[COMPLETENESS] %s — Component failure detected → HITL mandatory | "
                "Failures: %s | Safe confidence capped at %d%%",
                claim_reference,
                failure_summary,
                self.CONFIDENCE_CAP_ANY_FAILED,
            )

        # RULE 2: AI reasoning skipped → cap confidence at 80% when AI was required.
        # In rules-first advisory mode, routine claims intentionally skip LLM. That
        # is not incomplete processing, so it must not reduce confidence.
        elif completeness.ai_reasoning_status == ComponentStatus.SKIPPED and not ai_reasoning_optional:
            original_confidence = safe_confidence
            cap_limit = Decimal(str(self.CONFIDENCE_CAP_AI_SKIPPED))
            safe_confidence = min(safe_confidence, cap_limit)
            confidence_cap_applied = original_confidence > safe_confidence
            confidence_cap_reason = "AI_REASONING_SKIPPED"
            confidence_cap_limit = cap_limit

            if original_confidence > safe_confidence:
                validation_warnings.append(
                    f"AI reasoning skipped — confidence capped from "
                    f"{original_confidence:.1f}% to {safe_confidence:.1f}%"
                )
                self.logger.info(
                    "[COMPLETENESS] %s — AI reasoning skipped → "
                    "confidence capped from %.1f%% to %.1f%% | "
                    "May auto-settle if confidence above threshold",
                    claim_reference,
                    float(original_confidence),
                    float(safe_confidence),
                )
            else:
                validation_warnings.append(
                    f"AI reasoning skipped — {self.CONFIDENCE_CAP_AI_SKIPPED}% maximum applies; "
                    f"calculated confidence remains {safe_confidence:.1f}%"
                )
                self.logger.info(
                    "[COMPLETENESS] %s — AI reasoning skipped → "
                    "%d%% maximum applies; calculated confidence remains %.1f%% | "
                    "May auto-settle if confidence above threshold",
                    claim_reference,
                    self.CONFIDENCE_CAP_AI_SKIPPED,
                    float(safe_confidence),
                )

        elif completeness.ai_reasoning_status == ComponentStatus.SKIPPED and ai_reasoning_optional:
            self.logger.info(
                "[COMPLETENESS] %s — Advisory AI not required for this claim; "
                "confidence remains %.1f%%",
                claim_reference,
                float(safe_confidence),
            )

        # RULE 3: All required components completed → no cap, full confidence
        elif completeness.all_completed:
            self.logger.info(
                "[COMPLETENESS] %s — All components completed successfully | "
                "Full confidence: %.1f%% | "
                "Completion: Rules(%d items), AI(%d citations), Citations(%d), Settlement(%d items)",
                claim_reference,
                float(safe_confidence),
                completeness.rules_engine_items_evaluated,
                completeness.ai_reasoning_citations_found,
                completeness.policy_citations_count,
                completeness.settlement_line_items_calculated,
            )

        # RULE 4: Partial completion (some skipped but none failed) → log warning
        else:
            validation_warnings.append(
                f"Partial processing: {completeness.completion_percentage}% complete"
            )

            self.logger.warning(
                "[COMPLETENESS] %s — Partial processing detected | "
                "Completion: %d%% | Components: RE=%s, AI=%s, Cites=%s, Settlement=%s",
                claim_reference,
                completeness.completion_percentage,
                completeness.rules_engine_status.value,
                completeness.ai_reasoning_status.value,
                completeness.policy_citations_status.value,
                completeness.settlement_calculation_status.value,
            )

        return ValidationResult(
            safe_confidence=safe_confidence,
            requires_hitl=requires_hitl,
            hitl_trigger=hitl_trigger,
            completeness=completeness,
            validation_warnings=validation_warnings,
            confidence_cap_applied=confidence_cap_applied,
            confidence_cap_reason=confidence_cap_reason,
            confidence_cap_limit=confidence_cap_limit,
            confidence_before_cap=confidence_before_cap,
            canonicalization=canonicalization,
        )


@dataclass
class ValidationResult:
    """
    Result of completeness validation.

    This is used by the pipeline to determine:
    1. What confidence score to use (safe_confidence, not calculated_confidence)
    2. Whether to force HITL routing (requires_hitl=True → always HITL)
    3. What trigger reason to log in audit trail (hitl_trigger)
    """
    safe_confidence: Decimal           # Confidence score capped based on completeness
    requires_hitl: bool                 # True = MANDATORY HITL, cannot auto-settle
    hitl_trigger: Optional[str]        # Trigger reason (e.g., "INCOMPLETE_PROCESSING")
    completeness: ProcessingCompleteness  # Full completeness tracking
    validation_warnings: list[str]     # Human-readable warnings for audit/UI
    confidence_cap_applied: bool = False
    confidence_cap_reason: Optional[str] = None
    confidence_cap_limit: Optional[Decimal] = None
    confidence_before_cap: Optional[Decimal] = None
    canonicalization: Optional[dict] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            "safe_confidence": float(self.safe_confidence),
            "requires_hitl": self.requires_hitl,
            "hitl_trigger": self.hitl_trigger,
            "completeness": self.completeness.to_dict(),
            "validation_warnings": self.validation_warnings,
            "confidence_cap": {
                "applied": self.confidence_cap_applied,
                "reason": self.confidence_cap_reason,
                "limit": float(self.confidence_cap_limit) if self.confidence_cap_limit is not None else None,
                "before": float(self.confidence_before_cap) if self.confidence_before_cap is not None else None,
                "after": float(self.safe_confidence),
            },
            "canonicalization": self.canonicalization or {
                "normalized_fields": [],
                "unknown_fields": [],
                "normalized_count": 0,
                "unknown_count": 0,
            },
        }
