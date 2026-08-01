"""
Dual-Agent Cross-Validation
============================
Implements TRUE dual-LLM validation for the claims adjudication pipeline.

─────────────────────────────────────────────────────────────
AGENT ROLES
─────────────────────────────────────────────────────────────
Agent A — RulesEngine:       Deterministic rule evaluation (R1–R11).
                              → LineItemEvaluation per line, is_covered: bool

Agent B — Groq LLM:          Two-tier LLM policy clause analysis (primary).
                              → ClaimAIAnalysis per line, coverage_status: str

Agent C — Anthropic Claude:  Independent LLM cross-validator (secondary).
                              Only active when ANTHROPIC_API_KEY is configured.
                              Runs the same analysis as Agent B but completely
                              independently — no knowledge of B's result.
                              → A second ClaimAIAnalysis used for cross-checking.

─────────────────────────────────────────────────────────────
VALIDATION LOGIC
─────────────────────────────────────────────────────────────
Step 1 (always): Compare Agent A (Rules) vs Agent B (Groq) per line item.
Step 2 (when Anthropic configured):
        Compare Agent B (Groq) vs Agent C (Anthropic) per line item.
        Compute a cross-LLM agreement score.
        If the two LLMs disagree (score < 0.80) → "LLM_CONFLICT" trigger.

Final score = weighted average of Step 1 + Step 2 scores.
Agreement thresholds (configurable via admin config):
  • ≥ 0.98  → Perfect (auto-settle allowed)
  • ≥ 0.80  → Acceptable (AGENT_DISAGREEMENT warning)
  •  < 0.80  → Conflict (AGENT_CONFLICT → routes to HITL)
"""
from __future__ import annotations

import logging
import json
from dataclasses import dataclass, field
from typing import Optional, List

logger = logging.getLogger(__name__)

DENIAL_CODE_EXPLANATIONS = {
    "EL-001": "member eligibility did not pass",
    "PA-001": "required pre-authorization was missing or invalid",
    "EX-001": "the procedure or diagnosis matched a policy exclusion",
    "WP-001": "the claim appears to fall inside a waiting period",
    "AY-001": "AYUSH coverage requirements were not satisfied",
}


def _rules_verdict_text(verdict: str, denial_code: Optional[str]) -> str:
    if verdict == "COVERED":
        return (
            "Rules Engine marked this line as covered because none of the "
            "deterministic denial rules created a blocking denial code."
        )

    if denial_code:
        explanation = DENIAL_CODE_EXPLANATIONS.get(denial_code, "a deterministic denial rule failed")
        return f"Rules Engine denied this line under {denial_code}: {explanation}."

    return "Rules Engine denied this line because a deterministic coverage rule failed."


def _llm_verdict_text(verdict: str, confidence: object) -> str:
    confidence_text = f" Confidence reported by the LLM: {confidence}." if confidence not in (None, "?") else ""
    if verdict == "COVERED":
        return f"LLM policy analysis found policy language supporting coverage for this line.{confidence_text}"
    if verdict == "EXCLUDED":
        return f"LLM policy analysis found policy language that appears to exclude this line.{confidence_text}"
    if verdict == "CONDITIONAL":
        return (
            "LLM policy analysis found that this line may be payable only if a policy condition "
            f"is satisfied, such as authorization, documentation, network, limit, or eligibility requirements.{confidence_text}"
        )
    return (
        "LLM policy analysis could not clearly confirm whether this line is covered or excluded "
        f"from the available clause evidence.{confidence_text}"
    )


def _disagreement_impact_text(rules_verdict: str, llm_verdict: str) -> str:
    if rules_verdict == "COVERED" and llm_verdict == "EXCLUDED":
        return "Manual review is required because the rules path would pay the line, while the policy-language analysis suggests it may be excluded."
    if rules_verdict == "COVERED" and llm_verdict == "CONDITIONAL":
        return "Manual review should confirm the policy condition before payment, because the rules path found no hard denial but the LLM found requirements that may still apply."
    if rules_verdict == "COVERED" and llm_verdict == "AMBIGUOUS":
        return "Manual review should confirm the applicable policy clause, because the rules path can approve the line but the LLM could not reach a clear coverage decision."
    if rules_verdict == "EXCLUDED" and llm_verdict == "COVERED":
        return "Manual review is required because the rules path would deny the line, while the policy-language analysis indicates it may be covered."
    if rules_verdict == "EXCLUDED" and llm_verdict == "CONDITIONAL":
        return "Manual review should decide whether the failed rule is final or whether policy conditions, missing evidence, or an override could make the line payable."
    if rules_verdict == "EXCLUDED" and llm_verdict == "AMBIGUOUS":
        return "Manual review should validate the denial before finalizing it, because the rules path found a denial but the LLM could not clearly support or reject that outcome."
    return "Manual review should reconcile the two agent results before settlement."


def build_disagreement_reason(
    *,
    rules_verdict: str,
    llm_verdict: str,
    denial_code: Optional[str],
    confidence: object,
) -> str:
    return " ".join([
        _rules_verdict_text(rules_verdict, denial_code),
        _llm_verdict_text(llm_verdict, confidence),
        _disagreement_impact_text(rules_verdict, llm_verdict),
    ])


# ─────────────────────────────────────────────────────────────────────────────
# DATA CLASSES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class LineComparison:
    """Agreement result for a single claim line item."""
    line_number: int
    procedure_code: str
    rules_verdict: str                  # "COVERED" | "EXCLUDED"
    llm_verdict: str                    # "COVERED" | "EXCLUDED" | "CONDITIONAL" | "AMBIGUOUS"
    agreement: float                    # 0.0, 0.3, 0.5, or 1.0
    disagreement_reason: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "line_number":          self.line_number,
            "procedure_code":       self.procedure_code,
            "rules_verdict":        self.rules_verdict,
            "llm_verdict":          self.llm_verdict,
            "agreement":            round(self.agreement, 4),
            "disagreement_reason":  self.disagreement_reason,
        }


@dataclass
class DualAgentComparison:
    """Result of comparing all line items between Agent A, B (and optionally C)."""
    agreement_score: float                          # 0.0–1.0 weighted average
    line_comparisons: List[LineComparison] = field(default_factory=list)
    disagreement_items: List[int] = field(default_factory=list)   # line_numbers with agreement < 1.0
    trigger: Optional[str] = None                   # None | "AGENT_DISAGREEMENT" | "AGENT_CONFLICT" | "LLM_CONFLICT"

    # ── Dual-LLM cross-check fields (populated when Anthropic runs) ──────────
    llm_cross_check_available: bool = False
    llm_cross_agreement_score: Optional[float] = None   # Groq vs Anthropic score
    llm_cross_trigger: Optional[str] = None             # "LLM_CONFLICT" when Groq vs Claude disagree

    def to_dict(self) -> dict:
        return {
            "agreement_score":              round(self.agreement_score, 4),
            "line_comparisons":             [lc.to_dict() for lc in self.line_comparisons],
            "disagreement_items":           self.disagreement_items,
            "trigger":                      self.trigger,
            "llm_cross_check_available":    self.llm_cross_check_available,
            "llm_cross_agreement_score":    round(self.llm_cross_agreement_score, 4)
                                            if self.llm_cross_agreement_score is not None else None,
            "llm_cross_trigger":            self.llm_cross_trigger,
        }


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATOR
# ─────────────────────────────────────────────────────────────────────────────

class DualAgentValidator:
    """
    Two-stage cross-validator.

    Stage 1 — Rules Engine vs Groq LLM (deterministic + LLM comparison, always runs).
    Stage 2 — Groq vs Anthropic Claude (independent LLM cross-check, runs when
               Anthropic is configured — TRUE dual-AI-agent validation).

    Usage in pipeline.py Step 3b:
        # Always available
        dual_validator.compare(evaluated_items, ai_analysis, config)

        # With Anthropic cross-check:
        dual_validator.configure_anthropic(api_key, model)
        dual_validator.compare(
            evaluated_items, ai_analysis, config,
            anthropic_analysis=anthropic_analysis,
        )
    """

    # Verdict-pair → agreement weight
    # Rules verdict (COVERED/EXCLUDED) × LLM verdict (COVERED/EXCLUDED/CONDITIONAL/AMBIGUOUS)
    VERDICT_MATRIX: dict[tuple[str, str], float] = {
        ("COVERED",  "COVERED"):      1.0,   # Perfect agreement
        ("EXCLUDED", "EXCLUDED"):     1.0,   # Perfect agreement
        ("COVERED",  "CONDITIONAL"):  0.5,   # Partial — LLM sees conditions
        ("EXCLUDED", "CONDITIONAL"):  0.5,   # Partial — rules deny but LLM uncertain
        ("COVERED",  "AMBIGUOUS"):    0.3,   # Weak — LLM is unsure on a covered item
        ("EXCLUDED", "AMBIGUOUS"):    0.3,   # Weak — LLM is unsure on a denied item
        ("COVERED",  "EXCLUDED"):     0.0,   # Hard disagreement — rules cover, LLM excludes
        ("EXCLUDED", "COVERED"):      0.0,   # Hard disagreement — rules deny, LLM covers
    }

    # LLM vs LLM agreement (Groq vs Anthropic — both return the 4-value enum)
    LLM_CROSS_MATRIX: dict[tuple[str, str], float] = {
        ("COVERED",      "COVERED"):      1.0,
        ("EXCLUDED",     "EXCLUDED"):     1.0,
        ("CONDITIONAL",  "CONDITIONAL"):  1.0,
        ("AMBIGUOUS",    "AMBIGUOUS"):    1.0,
        ("COVERED",      "CONDITIONAL"):  0.6,   # Groq confident, Claude cautious
        ("COVERED",      "AMBIGUOUS"):    0.4,
        ("EXCLUDED",     "CONDITIONAL"):  0.6,
        ("EXCLUDED",     "AMBIGUOUS"):    0.4,
        ("CONDITIONAL",  "COVERED"):      0.6,
        ("CONDITIONAL",  "EXCLUDED"):     0.6,
        ("CONDITIONAL",  "AMBIGUOUS"):    0.7,
        ("AMBIGUOUS",    "COVERED"):      0.4,
        ("AMBIGUOUS",    "EXCLUDED"):     0.4,
        ("AMBIGUOUS",    "CONDITIONAL"):  0.7,
        ("COVERED",      "EXCLUDED"):     0.0,   # Hard cross-LLM disagreement
        ("EXCLUDED",     "COVERED"):      0.0,
    }

    # Default thresholds (overridden by config)
    DEFAULT_AGREE_THRESHOLD    = 0.98
    DEFAULT_CONFLICT_THRESHOLD = 0.80

    def compare(
        self,
        evaluated_items: list,          # list[LineItemEvaluation] from RulesEngine
        ai_analysis: object,            # ClaimAIAnalysis dataclass from Groq ReasoningEngine
        config: dict,
        anthropic_analysis: object = None,  # ClaimAIAnalysis from Anthropic (Stage 2)
    ) -> DualAgentComparison:
        """
        Stage 1: Compare Rules Engine output vs Groq LLM output for every line item.
        Stage 2: If anthropic_analysis provided, compare Groq vs Anthropic (cross-LLM).

        Returns a DualAgentComparison with aggregate scores and per-line breakdown.
        """
        agree_threshold    = float(config.get("dual_agent_agreement_threshold",    self.DEFAULT_AGREE_THRESHOLD))
        conflict_threshold = float(config.get("dual_agent_conflict_threshold",     self.DEFAULT_CONFLICT_THRESHOLD))

        # ── Stage 1: Rules Engine vs Groq ────────────────────────────────────
        # Build lookup: line_number → Groq LLM analysis item
        groq_items = []
        if ai_analysis and hasattr(ai_analysis, "line_items") and ai_analysis.line_items:
            groq_items = ai_analysis.line_items

        def _field(item, field_name, default=None):
            """Support both dataclass objects and plain dicts."""
            if isinstance(item, dict):
                return item.get(field_name, default)
            return getattr(item, field_name, default)

        groq_map: dict[int, object] = {
            _field(item, "line_number", idx): item
            for idx, item in enumerate(groq_items)
        }

        comparisons: list[LineComparison] = []
        for ev in evaluated_items:
            rules_verdict = "COVERED" if ev.is_covered else "EXCLUDED"
            groq_item     = groq_map.get(ev.line_number)
            groq_verdict  = _field(groq_item, "coverage_status", "AMBIGUOUS") if groq_item else "AMBIGUOUS"

            # Normalise to the 4 known verdicts
            groq_verdict = groq_verdict.upper() if groq_verdict else "AMBIGUOUS"
            if groq_verdict not in ("COVERED", "EXCLUDED", "CONDITIONAL", "AMBIGUOUS"):
                groq_verdict = "AMBIGUOUS"

            agreement = self.VERDICT_MATRIX.get((rules_verdict, groq_verdict), 0.0)

            reason: Optional[str] = None
            if agreement < 1.0:
                conf = _field(groq_item, "ai_confidence", "?") if groq_item else "?"
                reason = build_disagreement_reason(
                    rules_verdict=rules_verdict,
                    llm_verdict=groq_verdict,
                    denial_code=ev.denial_code,
                    confidence=conf,
                )

            comparisons.append(LineComparison(
                line_number=ev.line_number,
                procedure_code=ev.procedure_code,
                rules_verdict=rules_verdict,
                llm_verdict=groq_verdict,
                agreement=agreement,
                disagreement_reason=reason,
            ))

        n = len(comparisons)
        if n == 0:
            return DualAgentComparison(
                agreement_score=1.0,
                line_comparisons=[],
                disagreement_items=[],
                trigger=None,
            )

        stage1_score = sum(c.agreement for c in comparisons) / n
        disagree_lines = [c.line_number for c in comparisons if c.agreement < 1.0]

        # ── Stage 2: Groq vs Anthropic cross-check (when available) ──────────
        llm_cross_available = False
        llm_cross_score: Optional[float] = None
        llm_cross_trigger: Optional[str] = None

        if anthropic_analysis and hasattr(anthropic_analysis, "line_items") \
                and anthropic_analysis.line_items and anthropic_analysis.analysis_available:
            llm_cross_available = True
            ant_items  = anthropic_analysis.line_items
            ant_map: dict[int, object] = {
                _field(item, "line_number", idx): item
                for idx, item in enumerate(ant_items)
            }

            cross_scores: list[float] = []
            for ev in evaluated_items:
                groq_item = groq_map.get(ev.line_number)
                ant_item  = ant_map.get(ev.line_number)
                if groq_item is None or ant_item is None:
                    continue

                g_verdict = (_field(groq_item, "coverage_status", "AMBIGUOUS") or "AMBIGUOUS").upper()
                a_verdict = (_field(ant_item,  "coverage_status", "AMBIGUOUS") or "AMBIGUOUS").upper()
                if g_verdict not in ("COVERED", "EXCLUDED", "CONDITIONAL", "AMBIGUOUS"):
                    g_verdict = "AMBIGUOUS"
                if a_verdict not in ("COVERED", "EXCLUDED", "CONDITIONAL", "AMBIGUOUS"):
                    a_verdict = "AMBIGUOUS"

                cross_agreement = self.LLM_CROSS_MATRIX.get((g_verdict, a_verdict), 0.0)
                cross_scores.append(cross_agreement)

            if cross_scores:
                llm_cross_score = sum(cross_scores) / len(cross_scores)
                if llm_cross_score < conflict_threshold:
                    llm_cross_trigger = "LLM_CONFLICT"
                elif llm_cross_score < agree_threshold:
                    llm_cross_trigger = "LLM_DISAGREEMENT"

                logger.info(
                    "[DUAL-AGENT] Groq vs Anthropic cross-check: score=%.3f trigger=%s",
                    llm_cross_score, llm_cross_trigger,
                )

        # ── Final combined score ──────────────────────────────────────────────
        # Weight: if Anthropic cross-check available → 60% Stage1 + 40% Stage2
        # Otherwise → 100% Stage1
        if llm_cross_available and llm_cross_score is not None:
            final_score = 0.60 * stage1_score + 0.40 * llm_cross_score
        else:
            final_score = stage1_score

        # ── Trigger selection ─────────────────────────────────────────────────
        # LLM_CONFLICT (cross-LLM disagreement) takes priority over Rules vs LLM disagreement
        trigger: Optional[str] = None
        if llm_cross_trigger == "LLM_CONFLICT":
            trigger = "LLM_CONFLICT"            # Two independent LLMs disagree → must review
        elif final_score < conflict_threshold:
            trigger = "AGENT_CONFLICT"
        elif final_score < agree_threshold:
            trigger = "AGENT_DISAGREEMENT"

        logger.info(
            "[DUAL-AGENT] Stage1=%.3f%s trigger=%s",
            stage1_score,
            f" Stage2(Groq↔Claude)=%.3f" % llm_cross_score if llm_cross_score is not None else "",
            trigger,
        )

        return DualAgentComparison(
            agreement_score=final_score,
            line_comparisons=comparisons,
            disagreement_items=disagree_lines,
            trigger=trigger,
            llm_cross_check_available=llm_cross_available,
            llm_cross_agreement_score=llm_cross_score,
            llm_cross_trigger=llm_cross_trigger,
        )
