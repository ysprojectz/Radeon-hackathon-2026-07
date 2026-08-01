"""
Local Agent Tool Invocation — genuine LLM-driven function calling for the
Radeon-local reasoning path.

Built 2026-07-24 in direct response to an independent audit finding: the
pre-existing pipeline only exhibited deterministic pipeline orchestration
(Rules Engine -> Settlement Calc called by Python code), not the LLM itself
deciding to invoke tools. This module gives Agent B/Agent C real tools
they can choose to call mid-analysis, via
vLLM's OpenAI-compatible tool-calling support (Qwen2.5-Instruct models
support this natively; the vLLM server must be launched with
--enable-auto-tool-choice --tool-call-parser hermes — see
deploy/radeon/bootstrap_instance.sh).

Design principles:
  - Every tool wraps EXISTING ACOS logic (RulesEngine, DENIAL_CODE_EXPLANATIONS,
    the clause library) rather than reimplementing it — a second, divergent
    copy of e.g. the waiting-period date math would be a real correctness
    risk, not a convenience.
  - Additive and opt-in (LOCAL_LLM_TOOLS_ENABLED, default off) — must not
    change behavior for the already-verified non-tool dual-agent path.
  - Every executor is defensive: never raises past dispatch_tool_call() —
    a tool failure becomes a structured error string fed back to the model,
    not a crashed claim. An LLM that can call tools must never be able to
    take down adjudication for a claim by asking for something malformed.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# TOOL SCHEMAS (OpenAI-compatible `tools=[...]` format)
# ─────────────────────────────────────────────────────────────────────────────

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "check_waiting_period_status",
            "description": (
                "Check whether a specific diagnosis is still inside an IRDAI-mandated "
                "waiting period for this member (India market only). Use this whenever "
                "you are uncertain if a diagnosis like cataract, hernia, joint "
                "replacement, kidney stone, piles/fistula, sinusitis, or an ENT benign "
                "condition might be blocked by a waiting period the rules engine "
                "pre-evaluation may not have surfaced clearly. Do not guess the waiting "
                "period math yourself — call this tool."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "primary_diagnosis_code": {
                        "type": "string",
                        "description": "ICD-10 diagnosis code, e.g. 'M17.9'",
                    },
                },
                "required": ["primary_diagnosis_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_denial_code",
            "description": (
                "Get the plain-English meaning of a deterministic rules-engine denial "
                "code (e.g. EL-001, PA-001, EX-001, WP-001, AY-001) referenced in the "
                "rules-engine pre-evaluation, so your explanation to a human reviewer "
                "matches the platform's own official wording exactly."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "denial_code": {
                        "type": "string",
                        "description": "Denial code as it appears in the rules engine output, e.g. 'EX-001'",
                    },
                },
                "required": ["denial_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_additional_policy_clauses",
            "description": (
                "Search for policy or regulatory clauses beyond the ones already shown "
                "to you in TIER 1/TIER 2 above. Use this only if you genuinely believe "
                "a relevant clause exists but wasn't included in your initial context — "
                "for example if a line item's service category doesn't clearly match "
                "any clause you were given. Do not call this speculatively for every "
                "line item; the initial context is usually sufficient."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keyword(s) to search for, e.g. 'maternity', 'room rent', 'AYUSH'",
                    },
                    "tier": {
                        "type": "string",
                        "enum": ["REGIONAL", "COMPANY", "BOTH"],
                        "description": "Which tier to search — REGIONAL (Tier 1, regulatory) or COMPANY (Tier 2) or BOTH",
                    },
                },
                "required": ["query"],
            },
        },
    },
]

TOOL_NAMES = {t["function"]["name"] for t in TOOL_SCHEMAS}
MAX_TOOL_ROUNDS = 3  # bounded — prevents a runaway tool-call loop from ever hanging a claim


# ─────────────────────────────────────────────────────────────────────────────
# EXECUTION CONTEXT — everything a tool executor might need for one claim
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ToolExecutionContext:
    """Bundles the per-claim data tool executors need. Built once per
    analyze_claim() call, passed through to dispatch_tool_call()."""
    claim_data: dict
    market_region: str
    coverage_start: Optional[str] = None   # ISO date string, from the member record
    all_regional_clauses: list = field(default_factory=list)   # UNFILTERED — full tier 1 set
    all_company_clauses: list = field(default_factory=list)    # UNFILTERED — full tier 2 set


# ─────────────────────────────────────────────────────────────────────────────
# TOOL EXECUTORS — each wraps existing ACOS logic, never reimplements it
# ─────────────────────────────────────────────────────────────────────────────

def _parse_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value[:10]).date()
        except ValueError:
            return None
    return None


def _exec_check_waiting_period_status(args: dict, ctx: ToolExecutionContext) -> dict:
    """Reuses RulesEngine._check_waiting_period() directly — the exact same
    SPECIFIC_DISEASE_CODES table and date math the deterministic rules pass
    uses, so this can never silently diverge from what the rules engine
    itself would conclude."""
    from services.rules_engine.app.rules.evaluator import RuleContext, RulesEngine

    diagnosis_code = str(args.get("primary_diagnosis_code") or "").strip()
    if not diagnosis_code:
        return {"error": "primary_diagnosis_code is required"}

    if ctx.market_region != "INDIA":
        return {
            "applicable": False,
            "reason": f"Waiting-period rules in this tool are India-specific (IRDAI); market_region is {ctx.market_region}.",
        }

    service_date = _parse_date(ctx.claim_data.get("service_date"))
    coverage_start = _parse_date(ctx.coverage_start)
    if service_date is None or coverage_start is None:
        return {"error": "could not determine service_date or member coverage_start date"}

    rule_ctx = RuleContext(
        claim_reference=ctx.claim_data.get("claim_reference", ""),
        claim_type=ctx.claim_data.get("claim_type", "INPATIENT"),
        market_region=ctx.market_region,
        service_date=service_date,
        coverage_start=coverage_start,
        primary_diagnosis=diagnosis_code,
    )
    result = RulesEngine()._check_waiting_period(rule_ctx, procedure_code="")
    return {
        "applicable": True,
        "passed": result.passed,
        "reason": result.reason,
        "severity": getattr(result, "severity", None),
    }


def _exec_lookup_denial_code(args: dict, ctx: ToolExecutionContext) -> dict:
    """Reuses shared/dual_agent_validator.py's DENIAL_CODE_EXPLANATIONS — the
    exact same wording the platform's own consensus-comparison logic uses,
    so the LLM's explanation stays consistent with it."""
    from shared.dual_agent_validator import DENIAL_CODE_EXPLANATIONS

    code = str(args.get("denial_code") or "").strip().upper()
    if not code:
        return {"error": "denial_code is required"}
    explanation = DENIAL_CODE_EXPLANATIONS.get(code)
    if explanation is None:
        return {"found": False, "denial_code": code, "note": "not a recognized platform denial code"}
    return {"found": True, "denial_code": code, "explanation": explanation}


def _exec_search_additional_policy_clauses(args: dict, ctx: ToolExecutionContext) -> dict:
    """Simple case-insensitive substring search over the claim's full
    (unfiltered) clause set — deliberately not a new retrieval mechanism,
    just a way for the model to look past pipeline.py's pre-filter (top-N by
    relevance score) when it has a specific reason to believe something
    relevant was cut. Capped at 5 results to protect context window."""
    query = str(args.get("query") or "").strip().lower()
    if not query:
        return {"error": "query is required"}
    tier = str(args.get("tier") or "BOTH").upper()

    def matches(clause: dict) -> bool:
        haystack = " ".join([
            str(clause.get("title", "")),
            str(clause.get("full_text", "")),
            str(clause.get("section_reference", "")),
        ]).lower()
        return query in haystack

    results = []
    if tier in ("REGIONAL", "BOTH"):
        for clause in ctx.all_regional_clauses:
            if matches(clause):
                results.append({
                    "tier": "REGIONAL",
                    "section_reference": clause.get("section_reference"),
                    "title": clause.get("title"),
                    "excerpt": str(clause.get("full_text", ""))[:400],
                })
    if tier in ("COMPANY", "BOTH"):
        for clause in ctx.all_company_clauses:
            if matches(clause):
                results.append({
                    "tier": "COMPANY",
                    "section_reference": clause.get("section_reference"),
                    "title": clause.get("title"),
                    "excerpt": str(clause.get("full_text", ""))[:400],
                })

    return {"query": query, "tier": tier, "result_count": len(results[:5]), "results": results[:5]}


_EXECUTORS: dict[str, Callable[[dict, ToolExecutionContext], dict]] = {
    "check_waiting_period_status": _exec_check_waiting_period_status,
    "lookup_denial_code": _exec_lookup_denial_code,
    "search_additional_policy_clauses": _exec_search_additional_policy_clauses,
}


def dispatch_tool_call(name: str, raw_arguments: str, ctx: ToolExecutionContext) -> str:
    """
    Execute one tool call and return a JSON string suitable for a `tool`-role
    message. NEVER raises — every failure mode (unknown tool, malformed JSON
    arguments, an executor's own exception) becomes a structured error
    result fed back to the model, so a bad tool call degrades the analysis
    for one turn rather than crashing the claim.
    """
    if name not in _EXECUTORS:
        logger.warning("[Tool Call] Unknown tool requested: %s", name)
        return json.dumps({"error": f"unknown tool '{name}'", "available_tools": sorted(TOOL_NAMES)})

    try:
        args = json.loads(raw_arguments) if raw_arguments else {}
        if not isinstance(args, dict):
            raise ValueError("tool arguments must be a JSON object")
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("[Tool Call] Malformed arguments for %s: %s", name, e)
        return json.dumps({"error": f"malformed arguments: {e}"})

    try:
        result = _EXECUTORS[name](args, ctx)
        logger.info("[Tool Call] %s(%s) -> %s", name, args, str(result)[:200])
        return json.dumps(result, default=str)
    except Exception as e:
        logger.error("[Tool Call] %s executor raised: %s", name, e, exc_info=True)
        return json.dumps({"error": f"tool execution failed: {type(e).__name__}: {e}"})
