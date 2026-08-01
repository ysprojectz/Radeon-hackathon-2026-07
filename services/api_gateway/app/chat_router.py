"""
ACOS Assistant — Chat Backend
================================
Capabilities:
  - Multi-intent: detects all relevant intents per query, merges context
  - Multi-turn: remembers claim references from full conversation history
  - Temporal filtering: understands "last week", "this month", "last 30 days", etc.
  - CSV export: generates downloadable CSV when the user asks to export data
  - Provider failover: retries next configured provider on failure
  - Clean output: short bullet answers with reasoning tags removed
"""

import csv
import io
import json
import logging
import re
from datetime import datetime, date, timedelta, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from services.api_gateway.app.auth import get_current_user, CurrentUser
from services.api_gateway.app import config_store
from shared.llm_provider_registry import get_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["chat"])

# ── Schemas ────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]

class ChatReportOption(BaseModel):
    id: str
    label: str
    description: str

class ChatReportOptions(BaseModel):
    report_types: list[ChatReportOption]
    date_ranges: list[ChatReportOption]
    default_report_type: str = "processed"
    default_date_range: str = "last_30_days"

class ChatDashboardOptions(BaseModel):
    action_id: str
    title: str
    description: str
    date_ranges: list[ChatReportOption]
    default_date_range: str = "last_30_days"

class ChatResponse(BaseModel):
    reply: str
    context_used: list[str] = []
    export_csv: Optional[str] = None       # populated when user asks to export
    export_filename: Optional[str] = None  # suggested filename for the download
    report_options: Optional[ChatReportOptions] = None
    dashboard_options: Optional[ChatDashboardOptions] = None


def _chat_allowed_for_user(current_user: CurrentUser) -> bool:
    cfg = config_store.load()
    if not cfg.get("chat_assistant_enabled", True):
        return False
    allowed_roles = {str(role).upper() for role in cfg.get("chat_assistant_roles", [])}
    allowed_markets = {str(market).upper() for market in cfg.get("chat_assistant_markets", [])}
    role_ok = not allowed_roles or current_user.role.upper() in allowed_roles
    market_ok = not allowed_markets or current_user.market_region.upper() in allowed_markets
    return role_ok and market_ok


@router.get("/chat/settings")
async def chat_settings(current_user: CurrentUser = Depends(get_current_user)):
    cfg = config_store.load()
    return {
        "enabled": _chat_allowed_for_user(current_user),
        "role": current_user.role,
        "market": current_user.market_region,
        "variant": cfg.get("chat_assistant_variant", "dashboard-copilot"),
    }

_SCOPE_REFUSAL_REPLY = (
    "- This looks outside the claims workspace.\n"
    "- I can help with claims, metrics, review queues, policies, exports, settings, integrations, and service health.\n"
    "- Ask with a claim reference, queue blocker, metric trend, payment issue, or admin setting."
)
_MAX_PROVIDER_MESSAGES = 12
_CHAT_PROVIDER_TIMEOUT_SECONDS = 8.0

# ── Claim reference pattern ────────────────────────────────────────────────────

_CLAIM_REF_RE = re.compile(
    r'\b([A-Z]{2,6}-\d{4,}-[A-Z0-9-]+|CLM-[A-Z0-9-]+)\b',
    re.IGNORECASE
)

# ── Intent signals ─────────────────────────────────────────────────────────────

_INTENT_SIGNALS: dict[str, list[str]] = {
    "kpi":    ["kpi", "dashboard", "total claims", "settlement rate", "denial rate",
               "auto-adjudication rate", "stats", "statistics", "how many claims",
               "overview", "metrics", "performance", "summary",
               "denial", "denied", "denials", "driver", "drivers",
               "high-risk", "high risk", "pending", "claim", "claims",
               "adjudication", "settlement", "settled", "trend",
               "by market", "by status", "exception", "exceptions"],
    "hitl":   ["hitl", "human review", "manual review", "pending review", "queue",
               "adjudicator", "overdue", "sla", "review queue", "awaiting",
               "review", "urgent", "worklist", "what should", "next review",
               "needs review", "prioritize", "priority"],
    "policy": ["policy", "coverage", "benefit", "clause", "deductible", "copay",
               "benefits", "exclusion", "preauth", "network tier", "allowed amount",
               "insured"],
    "health": ["system status", "service status", "api status", "llm status",
               "is the system", "uptime", "system health", "service health",
               "api health", "platform health", "system down", "service down",
               "system offline", "health check"],
    "audit":  ["audit", "audit trail", "event log", "audit log", "tamper",
               "event chain", "activity log"],
    "export": ["export", "download", "csv", "spreadsheet", "excel",
               "pull the data", "pull data", "get the data", "extract data"],
    "claims_list": ["high-risk", "high risk", "show claims", "list claims", "find claims",
                    "pending claims", "denied claims", "recent claims", "all claims",
                    "exception claims", "pending exceptions", "low confidence",
                    "risk claims", "flagged claims", "what claims", "which claims"],
}


def _score_intent(text_lower: str, keywords: list[str]) -> int:
    """Score intent by word-boundary matching single-word terms; substring for phrases."""
    score = 0
    for kw in keywords:
        if " " in kw:
            if kw in text_lower:
                score += 1
        else:
            if re.search(rf"\b{re.escape(kw)}\b", text_lower):
                score += 1
    return score

_TEMPORAL_SIGNALS = [
    "today", "yesterday", "last week", "this week", "past week",
    "last month", "this month", "past month", "last year", "this year",
    r"last \d+ days?", r"last \d+ weeks?", r"last \d+ months?",
    r"past \d+ days?", r"past \d+ weeks?", r"past \d+ months?",
]
_TEMPORAL_RE = re.compile(
    "|".join(f"({s})" for s in _TEMPORAL_SIGNALS),
    re.IGNORECASE
)

_FOLLOWUP_TERMS = [
    "it", "this", "that", "the claim", "the case", "status", "why", "what happened",
    "financial", "payment", "member responsibility", "audit", "timeline", "latest",
    "denial", "settlement", "provider", "patient",
]
_OFF_TOPIC_PATTERNS = [
    r"\b(weather|forecast|temperature)\b",
    r"\b(joke|poem|song|story|recipe|movie|capital of|who is|what is the meaning of life)\b",
    r"\b(python|javascript|typescript|react|next\.?js|fastapi|sql|docker|kubernetes)\b.*\b(code|script|function|bug|debug|implement|write|build)\b",
    r"\b(code|script|function|bug|debug|implement|write|build)\b.*\b(python|javascript|typescript|react|next\.?js|fastapi|sql|docker|kubernetes)\b",
    r"\b(resume|cover letter|email|essay|homework|translation)\b",
]
_OFF_TOPIC_RE = re.compile("|".join(f"({pattern})" for pattern in _OFF_TOPIC_PATTERNS), re.IGNORECASE)

_REPORT_TYPES = [
    ChatReportOption(id="processed", label="Claim Processed", description="Settled, adjudicated, denied, or completed claims."),
    ChatReportOption(id="pipeline", label="Pipeline", description="End-to-end processing status, timing, and confidence."),
    ChatReportOption(id="pending", label="Pending", description="Claims still awaiting processing or review."),
    ChatReportOption(id="denied", label="Denied", description="Denied, errored, or rejected claims."),
]
_REPORT_DATE_RANGES = [
    ChatReportOption(id="today", label="Today", description="Claims dated today."),
    ChatReportOption(id="last_7_days", label="Last 7 days", description="Claims from the last 7 days."),
    ChatReportOption(id="last_30_days", label="Last 30 days", description="Claims from the last 30 days."),
    ChatReportOption(id="last_90_days", label="Last 90 days", description="Claims from the last 90 days."),
    ChatReportOption(id="this_month", label="This month", description="Claims from the current month."),
    ChatReportOption(id="all_time", label="All time", description="All available claims."),
]
_REPORT_TYPE_IDS = {option.id for option in _REPORT_TYPES}
_REPORT_DATE_RANGE_IDS = {option.id for option in _REPORT_DATE_RANGES}
_DASHBOARD_ACTIONS = {
    "review_queue": {
        "title": "Claims Needing Review",
        "description": "Manual review worklist filtered by dashboard date range.",
    },
    "top_denials": {
        "title": "Top Denial Drivers",
        "description": "Denied-claim reasons ranked by volume and billed amount.",
    },
    "system_health": {
        "title": "System Health",
        "description": "Live service layer, database, Redis, and AI availability status.",
    },
}
_DASHBOARD_ACTION_IDS = set(_DASHBOARD_ACTIONS)
_PROCESSED_STATUSES = {"SETTLED", "HITL_APPROVED", "ADJUDICATED", "DENIED", "HITL_DENIED", "ERROR"}
_PENDING_STATUSES = {
    "RECEIVED", "INTAKE_PROCESSING", "INTAKE_COMPLETE", "POLICY_RETRIEVAL",
    "ADJUDICATING", "HITL_PENDING", "HITL_IN_REVIEW", "APPEALED",
    "PROCESSING", "RISK_REVIEW",
}
_DENIED_STATUSES = {"DENIED", "HITL_DENIED", "ERROR", "INTAKE_FAILED"}
_REVIEW_STATUSES = {"HITL_PENDING", "HITL_IN_REVIEW"}

# ── Date range parser ──────────────────────────────────────────────────────────

def _parse_date_range(text: str) -> tuple[date, date] | None:
    """
    Parses natural language date expressions and returns (start, end) as date objects.
    Returns None if no temporal expression is found.
    """
    t = text.lower()
    today = date.today()

    if "today" in t:
        return today, today
    if "yesterday" in t:
        d = today - timedelta(days=1)
        return d, d
    if "last week" in t or "past week" in t or "this week" in t:
        end = today - timedelta(days=1)
        start = end - timedelta(days=6)
        return start, end
    if "last month" in t or "past month" in t:
        end = today - timedelta(days=1)
        start = end - timedelta(days=29)
        return start, end
    if "this month" in t:
        start = today.replace(day=1)
        return start, today
    if "last year" in t:
        start = date(today.year - 1, 1, 1)
        end   = date(today.year - 1, 12, 31)
        return start, end
    if "this year" in t:
        return date(today.year, 1, 1), today

    # "last N days / weeks / months"
    m = re.search(r"(?:last|past)\s+(\d+)\s+(day|week|month)s?", t)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = timedelta(days=n if unit == "day" else n * 7 if unit == "week" else n * 30)
        return today - delta, today

    return None

def _date_range_label(start: date, end: date) -> str:
    if start == end:
        return start.strftime("%d %b %Y")
    return f"{start.strftime('%d %b %Y')} to {end.strftime('%d %b %Y')}"

def _in_range(date_str: Optional[str], start: date, end: date) -> bool:
    if not date_str:
        return False
    try:
        d = date.fromisoformat(str(date_str)[:10])
        return start <= d <= end
    except Exception:
        return False


def _contains_any(text_lower: str, terms: list[str]) -> bool:
    for term in terms:
        if " " in term:
            if term in text_lower:
                return True
        elif re.search(rf"\b{re.escape(term)}\b", text_lower):
            return True
    return False


def _is_claim_followup(last_message: str) -> bool:
    text_lower = last_message.lower()
    return _contains_any(text_lower, _FOLLOWUP_TERMS)


def _is_likely_off_topic(last_message: str) -> bool:
    """Catch common non-claims prompts that accidentally match broad keywords."""
    text_lower = last_message.lower().strip()
    if not text_lower:
        return True
    if not _OFF_TOPIC_RE.search(text_lower):
        return False
    return True


def _normalize_messages(messages: list[dict]) -> list[dict]:
    cleaned: list[dict] = []
    for message in messages:
        role = str(message.get("role") or "").strip().lower()
        content = str(message.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        cleaned.append({"role": role, "content": content})
    return cleaned[-_MAX_PROVIDER_MESSAGES:]


def _is_report_setup_request(last_message: str) -> bool:
    text_lower = last_message.lower()
    if "report_type=" in text_lower or "date_range=" in text_lower:
        return False
    return bool(re.search(r"\b(generate|create|prepare|download|export|make)\b.*\breports?\b|\breports?\b.*\b(generate|create|prepare|download|export|make)\b", text_lower))


def _parse_report_generation(last_message: str) -> tuple[str, str] | None:
    text_lower = last_message.lower()
    type_match = re.search(r"(?:report_type|type|category)\s*=\s*([a-z0-9_-]+)", text_lower)
    range_match = re.search(r"(?:date_range|range|period)\s*=\s*([a-z0-9_-]+)", text_lower)
    if not type_match or not range_match:
        return None

    report_type = type_match.group(1)
    date_range_id = range_match.group(1)
    if report_type not in _REPORT_TYPE_IDS or date_range_id not in _REPORT_DATE_RANGE_IDS:
        return None
    return report_type, date_range_id


def _build_report_options() -> ChatReportOptions:
    return ChatReportOptions(
        report_types=_REPORT_TYPES,
        date_ranges=_REPORT_DATE_RANGES,
    )


def _parse_dashboard_setup_request(last_message: str) -> str | None:
    text_lower = last_message.lower()
    if "dashboard_action=" in text_lower or "date_range=" in text_lower:
        return None
    if re.search(r"\b(list|show|view|display|which|what)\b.*\b(claims?\s+needing\s+review|manual\s+review|review\s+queue|pending\s+review)", text_lower):
        return "review_queue"
    if re.search(r"\b(claims?\s+needing\s+review|manual\s+review\s+worklist|pending\s+review\s+claims?)\b", text_lower):
        return "review_queue"
    if re.search(r"\b(top|leading|main|major)\b.*\b(denial|denials|denied)\b", text_lower):
        return "top_denials"
    if re.search(r"\b(denial\s+drivers?|top\s+denials?|denied\s+reasons?)\b", text_lower):
        return "top_denials"
    if re.search(r"\b(system|service|platform|api)\b.*\b(health|status|availability)\b", text_lower):
        return "system_health"
    return None


def _parse_dashboard_action_generation(last_message: str) -> tuple[str, str] | None:
    text_lower = last_message.lower()
    action_match = re.search(r"(?:dashboard_action|action)\s*=\s*([a-z0-9_-]+)", text_lower)
    range_match = re.search(r"(?:date_range|range|period)\s*=\s*([a-z0-9_-]+)", text_lower)
    if not action_match or not range_match:
        return None

    action_id = action_match.group(1)
    date_range_id = range_match.group(1)
    if action_id not in _DASHBOARD_ACTION_IDS or date_range_id not in _REPORT_DATE_RANGE_IDS:
        return None
    return action_id, date_range_id


def _build_dashboard_options(action_id: str) -> ChatDashboardOptions:
    action = _DASHBOARD_ACTIONS[action_id]
    return ChatDashboardOptions(
        action_id=action_id,
        title=action["title"],
        description=action["description"],
        date_ranges=_REPORT_DATE_RANGES,
    )


def _report_date_range(date_range_id: str) -> tuple[tuple[date, date] | None, str]:
    today = date.today()
    if date_range_id == "today":
        return (today, today), "today"
    if date_range_id == "last_7_days":
        return (today - timedelta(days=6), today), "last 7 days"
    if date_range_id == "last_30_days":
        return (today - timedelta(days=29), today), "last 30 days"
    if date_range_id == "last_90_days":
        return (today - timedelta(days=89), today), "last 90 days"
    if date_range_id == "this_month":
        start = today.replace(day=1)
        return (start, today), "this month"
    return None, "all time"


def _infer_date_range_id(text: str, default: str = "last_30_days") -> str:
    text_lower = text.lower()
    if any(term in text_lower for term in ["today", "right now", "current", "currently", "now"]):
        return "today"
    if "last 7" in text_lower or "past 7" in text_lower or "this week" in text_lower or "last week" in text_lower:
        return "last_7_days"
    if "last 90" in text_lower or "past 90" in text_lower or "quarter" in text_lower:
        return "last_90_days"
    if "this month" in text_lower:
        return "this_month"
    if "all time" in text_lower or "all-time" in text_lower:
        return "all_time"
    return default

# ── Intent + claim ref detection ──────────────────────────────────────────────

def _detect_intents(
    full_history: list[dict], last_message: str
) -> tuple[list[str], list[str], tuple[date, date] | None]:
    """
    Returns (active_intents, claim_refs_from_history, date_range_or_None).
    """
    all_text = " ".join(m.get("content", "") for m in full_history)
    claim_refs = list(dict.fromkeys(
        ref.upper() for ref in _CLAIM_REF_RE.findall(all_text)
    ))
    last_claim_refs = list(dict.fromkeys(
        ref.upper() for ref in _CLAIM_REF_RE.findall(last_message)
    ))

    intents: list[str] = []
    if last_claim_refs or (claim_refs and _is_claim_followup(last_message)):
        intents.append("claim_lookup")

    text_lower = last_message.lower()
    if _is_likely_off_topic(last_message):
        return ["out_of_scope"], claim_refs, _parse_date_range(last_message)

    scores = {
        intent: _score_intent(text_lower, kws)
        for intent, kws in _INTENT_SIGNALS.items()
    }
    for intent, score in sorted(scores.items(), key=lambda x: -x[1]):
        if score > 0 and intent not in intents:
            intents.append(intent)

    # claims_list wins over generic kpi when the query is about listing/finding claims
    if "claims_list" in intents and "kpi" in intents:
        intents.remove("kpi")

    if not intents:
        intents = ["out_of_scope"]

    date_range = _parse_date_range(last_message)

    return intents, claim_refs, date_range

# ── Helpers ────────────────────────────────────────────────────────────────────

def _safe_float(v: Any) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _as_ratio(value: Any) -> float:
    """Normalize confidence-like values stored either as 0-1 or 0-100."""
    score = _safe_float(value)
    return score / 100 if score > 1 else score


def _load_claims_from_db(
    db_available: bool,
    date_range: tuple[date, date] | None = None,
    statuses: Optional[list[str]] = None,
    limit: int = 500,
) -> list[dict]:
    if not db_available:
        return []

    try:
        from shared.db_sync import get_sync_session
        where = ["1=1"]
        params: dict[str, Any] = {"limit": limit}
        if date_range:
            start, end = date_range
            where.append("DATE(COALESCE(c.date_received, c.service_date)) BETWEEN :start AND :end")
            params.update({"start": start, "end": end})
        if statuses:
            status_keys = []
            for idx, status in enumerate(statuses):
                key = f"status_{idx}"
                status_keys.append(f":{key}")
                params[key] = status
            where.append(f"c.status::text IN ({', '.join(status_keys)})")

        with get_sync_session() as sess:
            if not sess:
                return []
            rows = sess.execute(
                text(f"""
                    SELECT
                        c.claim_reference, c.status::text AS status, c.claim_type::text AS claim_type,
                        c.market_region::text AS market_region, c.currency::text AS currency,
                        c.patient_name, c.member_number, c.provider_name, c.service_date,
                        c.date_received, c.total_billed, c.total_settlement,
                        c.total_member_responsibility, c.confidence_score, c.processing_time_ms,
                        c.primary_diagnosis_code,
                        s.total_plan_payment, s.total_member_responsibility AS settlement_member_responsibility,
                        hr.trigger_reason AS hitl_trigger_reason, hr.sla_deadline
                    FROM claims c
                    LEFT JOIN settlements s ON s.claim_id = c.id
                    LEFT JOIN hitl_reviews hr ON hr.claim_id = c.id AND hr.status = 'PENDING'
                    WHERE {' AND '.join(where)}
                    ORDER BY c.date_received DESC
                    LIMIT :limit
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.debug("DB claims context lookup failed: %s", exc)
        return []

    claims: list[dict] = []
    for row in rows:
        item = dict(row._mapping)
        for key, value in list(item.items()):
            if hasattr(value, "isoformat"):
                item[key] = value.isoformat()
        if item.get("hitl_trigger_reason"):
            item["hitl_status"] = "HITL_PENDING"
        if item.get("settlement_member_responsibility") is not None:
            item["total_member_responsibility"] = item["settlement_member_responsibility"]
        claims.append(item)
    return claims


def _collect_report_claims(
    claims_store: dict,
    db_available: bool,
    date_range: tuple[date, date] | None,
) -> list[dict]:
    claims = list(claims_store.values())
    seen_refs = {str(c.get("claim_reference") or "").upper() for c in claims}

    if db_available:
        for db_claim in _load_claims_from_db(db_available, date_range=date_range, limit=5000):
            ref = str(db_claim.get("claim_reference") or "").upper()
            if ref and ref not in seen_refs:
                claims.append(db_claim)
                seen_refs.add(ref)

    if date_range:
        start, end = date_range
        claims = [
            c for c in claims
            if _in_range(c.get("date_received") or c.get("service_date"), start, end)
        ]

    return claims


def _filter_report_claims(report_type: str, claims: list[dict]) -> list[dict]:
    if report_type == "processed":
        return [c for c in claims if str(c.get("status") or "").upper() in _PROCESSED_STATUSES]
    if report_type == "pending":
        return [c for c in claims if str(c.get("status") or "").upper() in _PENDING_STATUSES]
    if report_type == "denied":
        return [c for c in claims if str(c.get("status") or "").upper() in _DENIED_STATUSES]
    return claims


def _report_type_label(report_type: str) -> str:
    return next((option.label for option in _REPORT_TYPES if option.id == report_type), report_type)


def _claims_to_report_csv(report_type: str, claims: list[dict], period_label: str) -> str:
    output = io.StringIO()
    writer = csv.writer(output)

    if report_type == "pipeline":
        headers = [
            "Reference", "Status", "Patient", "Market", "Claim Type", "Provider",
            "Date Received", "Service Date", "Total Billed", "Settlement",
            "Confidence (%)", "Processing Time (ms)", "HITL Reason", "SLA Deadline",
        ]
    elif report_type == "pending":
        headers = [
            "Reference", "Status", "Patient", "Member Number", "Provider",
            "Date Received", "Service Date", "Total Billed", "Confidence (%)",
            "Pending Reason", "SLA Deadline",
        ]
    elif report_type == "denied":
        headers = [
            "Reference", "Status", "Patient", "Member Number", "Provider",
            "Date Received", "Service Date", "Total Billed", "Denial Reason",
            "Diagnosis", "Market",
        ]
    else:
        headers = [
            "Reference", "Status", "Patient", "Member Number", "Provider",
            "Date Received", "Service Date", "Claim Type", "Market", "Currency",
            "Total Billed", "Plan Payment", "Member Responsibility", "Confidence (%)",
        ]

    writer.writerow([f"{_report_type_label(report_type)} Report"])
    writer.writerow(["Period", period_label])
    writer.writerow([])
    writer.writerow(headers)

    for c in claims:
        s = c.get("settlement") or {}
        confidence = f"{_as_ratio(c.get('confidence_score')) * 100:.1f}"
        plan_payment = _safe_float(c.get("total_settlement") or c.get("total_plan_payment") or s.get("total_plan_payment"))
        member_resp = _safe_float(c.get("total_member_responsibility") or s.get("total_member_responsibility"))
        common = {
            "ref": c.get("claim_reference", ""),
            "status": c.get("status", ""),
            "patient": c.get("patient_name", ""),
            "member": c.get("member_number", ""),
            "provider": c.get("provider_name", ""),
            "received": str(c.get("date_received") or "")[:10],
            "service": str(c.get("service_date") or "")[:10],
            "billed": f"{_safe_float(c.get('total_billed')):.2f}",
            "confidence": confidence,
        }

        if report_type == "pipeline":
            writer.writerow([
                common["ref"], common["status"], common["patient"], c.get("market_region", ""),
                c.get("claim_type", ""), common["provider"], common["received"], common["service"],
                common["billed"], f"{plan_payment:.2f}", common["confidence"],
                c.get("processing_time_ms", ""), c.get("hitl_trigger_reason") or c.get("hitl_reason") or "",
                c.get("sla_deadline", ""),
            ])
        elif report_type == "pending":
            writer.writerow([
                common["ref"], common["status"], common["patient"], common["member"],
                common["provider"], common["received"], common["service"], common["billed"],
                common["confidence"], c.get("hitl_trigger_reason") or c.get("hitl_reason") or c.get("denial_reason") or "",
                c.get("sla_deadline", ""),
            ])
        elif report_type == "denied":
            writer.writerow([
                common["ref"], common["status"], common["patient"], common["member"],
                common["provider"], common["received"], common["service"], common["billed"],
                c.get("denial_reason") or c.get("hitl_trigger_reason") or "",
                c.get("primary_diagnosis_code", ""), c.get("market_region", ""),
            ])
        else:
            writer.writerow([
                common["ref"], common["status"], common["patient"], common["member"],
                common["provider"], common["received"], common["service"], c.get("claim_type", ""),
                c.get("market_region", ""), c.get("currency", ""), common["billed"],
                f"{plan_payment:.2f}", f"{member_resp:.2f}", common["confidence"],
            ])

    return output.getvalue()


def _generate_report_csv(
    report_type: str,
    date_range_id: str,
    claims_store: dict,
    db_available: bool,
) -> tuple[str, str, str, int]:
    date_range, period_label = _report_date_range(date_range_id)
    claims = _collect_report_claims(claims_store, db_available, date_range)
    claims = _filter_report_claims(report_type, claims)
    report_label = _report_type_label(report_type)
    csv_text = _claims_to_report_csv(report_type, claims, period_label)
    filename = f"{report_type}_report_{date_range_id}_{date.today().strftime('%Y%m%d')}.csv"
    reply = f"- Report: {report_label} for {period_label}.\n- Claims included: {len(claims)}.\n- Download ready: {filename}"
    return csv_text, filename, reply, len(claims)


def _claim_date_value(claim: dict) -> str:
    return str(claim.get("date_received") or claim.get("service_date") or "")


def _claim_display_ref(claim: dict) -> str:
    return str(claim.get("claim_reference") or "Unreferenced claim")


def _claim_display_currency(claim: dict) -> str:
    return str(claim.get("currency") or "AED")


def _generate_review_queue_reply(
    claims_store: dict,
    db_available: bool,
    date_range_id: str,
) -> tuple[str, list[str]]:
    date_range, period_label = _report_date_range(date_range_id)
    claims = _collect_report_claims(claims_store, db_available, date_range)
    review_claims = [
        claim for claim in claims
        if str(claim.get("status") or "").upper() in _REVIEW_STATUSES
    ]
    review_claims.sort(
        key=lambda claim: (
            str(claim.get("sla_deadline") or "9999"),
            _claim_date_value(claim),
        )
    )

    if not review_claims:
        return (
            f"- Manual review queue: clear for {period_label}.\n- No claims need action in this range.",
            [f"Review Queue ({period_label})"],
        )

    lines = [f"Manual review queue for {period_label}: {len(review_claims)} claims."]
    for claim in review_claims[:3]:
        currency = _claim_display_currency(claim)
        lines.append(
            f"{_claim_display_ref(claim)} | {claim.get('status', 'UNKNOWN')} | "
            f"{currency} {_safe_float(claim.get('total_billed')):,.2f} billed | "
            f"Due {claim.get('sla_deadline') or 'not set'} | "
            f"{claim.get('hitl_trigger_reason') or claim.get('hitl_reason') or claim.get('denial_reason') or 'Manual review required'}"
        )

    return "\n".join(lines[:4]), [f"Review Queue ({len(review_claims)} claims)"]


def _generate_top_denials_reply(
    claims_store: dict,
    db_available: bool,
    date_range_id: str,
) -> tuple[str, list[str]]:
    date_range, period_label = _report_date_range(date_range_id)
    claims = _collect_report_claims(claims_store, db_available, date_range)
    denied_claims = _filter_report_claims("denied", claims)

    if not denied_claims:
        return (
            f"- Denials: none found for {period_label}.\n- No denial drivers to rank in this range.",
            [f"Top Denials ({period_label})"],
        )

    drivers: dict[str, dict[str, float]] = {}
    for claim in denied_claims:
        reason = str(
            claim.get("denial_reason")
            or claim.get("hitl_trigger_reason")
            or claim.get("hitl_reason")
            or "Unspecified denial reason"
        ).strip()
        entry = drivers.setdefault(reason, {"count": 0, "billed": 0.0})
        entry["count"] += 1
        entry["billed"] += _safe_float(claim.get("total_billed"))

    ranked = sorted(
        drivers.items(),
        key=lambda item: (-item[1]["count"], -item[1]["billed"], item[0].lower()),
    )

    lines = [f"Top denial drivers for {period_label}: {len(denied_claims)} denied claims."]
    for reason, stats in ranked[:3]:
        lines.append(
            f"{reason}: {int(stats['count'])} claims | AED {stats['billed']:,.2f} billed"
        )

    return "\n".join(lines[:4]), [f"Top Denials ({len(denied_claims)} claims)"]


def _generate_system_health_reply(date_range_id: str, db_available: bool = False) -> tuple[str, list[str]]:
    _, period_label = _report_date_range(date_range_id)
    ctx, src = _fetch_health_context(db_available)
    health_lines = [
        re.sub(r"^\s+", "", line).strip()
        for line in ctx.splitlines()
        if line.strip() and not line.strip().startswith("[")
    ]

    if not health_lines:
        return (
            f"- Service health is point-in-time.\n- Selected range: {period_label}.\n- Health details are unavailable.",
            src,
        )

    lines = [f"Service health is point-in-time; selected range: {period_label}."]
    lines.extend(health_lines[:3])
    return "\n".join(lines[:4]), src


def _generate_dashboard_action_reply(
    action_id: str,
    date_range_id: str,
    claims_store: dict,
    db_available: bool,
) -> tuple[str, list[str]]:
    if action_id == "review_queue":
        return _generate_review_queue_reply(claims_store, db_available, date_range_id)
    if action_id == "top_denials":
        return _generate_top_denials_reply(claims_store, db_available, date_range_id)
    return _generate_system_health_reply(date_range_id, db_available)

# ── CSV generation ─────────────────────────────────────────────────────────────

def _claims_to_csv(claims: list[dict], label: str) -> str:
    """Converts a list of claim dicts to a CSV string."""
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "Reference", "Patient Name", "Member Number", "Claim Type", "Status",
        "Market", "Currency", "Provider", "Service Date", "Date Received",
        "Total Billed", "Plan Payment", "Member Responsibility",
        "Confidence Score (%)", "Denial Reason",
    ])

    for c in claims:
        s = c.get("settlement") or {}
        conf = _as_ratio(c.get("confidence_score")) * 100
        writer.writerow([
            c.get("claim_reference", ""),
            c.get("patient_name", ""),
            c.get("member_number", ""),
            c.get("claim_type", ""),
            c.get("status", ""),
            c.get("market_region", ""),
            c.get("currency", ""),
            c.get("provider_name", ""),
            str(c.get("service_date", ""))[:10],
            str(c.get("date_received", ""))[:10],
            f"{_safe_float(c.get('total_billed')):.2f}",
            f"{_safe_float(c.get('total_settlement') or s.get('total_plan_payment')):.2f}",
            f"{_safe_float(c.get('total_member_responsibility') or s.get('total_member_responsibility')):.2f}",
            f"{conf:.1f}",
            c.get("denial_reason") or "",
        ])

    return output.getvalue()

# ── Context fetchers ───────────────────────────────────────────────────────────

def _fetch_claim_context(
    refs: list[str], claims_store: dict, db_available: bool
) -> tuple[str, list[str]]:
    blocks, sources = [], []
    for ref in refs[:3]:
        ref_upper = ref.upper()
        claim = claims_store.get(ref_upper) or claims_store.get(ref)

        if not claim and db_available:
            try:
                from shared.db_sync import get_sync_session
                with get_sync_session() as sess:
                    if sess:
                        row = sess.execute(
                            text("""
                                SELECT c.claim_reference, c.status, c.claim_type,
                                       c.market_region, c.currency, c.patient_name,
                                       c.member_number, c.provider_name, c.service_date,
                                       c.total_billed, c.total_settlement,
                                       c.total_member_responsibility, c.confidence_score,
                                       c.primary_diagnosis_code, c.date_received,
                                       s.total_plan_payment, s.total_copay, s.total_deductible
                                FROM claims c
                                LEFT JOIN settlements s ON s.claim_id = c.id
                                WHERE UPPER(c.claim_reference) = :ref
                                LIMIT 1
                            """),
                            {"ref": ref_upper}
                        ).fetchone()
                        if row:
                            claim = dict(row._mapping)
            except Exception as e:
                logger.debug("DB claim lookup failed: %s", e)

        if not claim:
            blocks.append(f"[Claim {ref_upper}]\nNot found in system.")
            continue

        s = claim.get("settlement") or {}
        block = (
            f"[Claim {ref_upper}]\n"
            f"Status: {claim.get('status', 'Unknown')}\n"
            f"Patient: {claim.get('patient_name', 'N/A')}\n"
            f"Member: {claim.get('member_number', 'N/A')}\n"
            f"Provider: {claim.get('provider_name', 'N/A')}\n"
            f"Service Date: {claim.get('service_date', 'N/A')}\n"
            f"Claim Type: {claim.get('claim_type', 'N/A')}\n"
            f"Market: {claim.get('market_region', 'N/A')} | Currency: {claim.get('currency', 'N/A')}\n"
            f"Diagnosis: {claim.get('primary_diagnosis_code', 'N/A')}\n"
            f"Total Billed: {_safe_float(claim.get('total_billed') or s.get('total_billed')):.2f}\n"
            f"Plan Payment: {_safe_float(claim.get('total_settlement') or s.get('total_plan_payment')):.2f}\n"
            f"Member Responsibility: {_safe_float(claim.get('total_member_responsibility') or s.get('total_member_responsibility')):.2f}\n"
            f"Confidence Score: {_as_ratio(claim.get('confidence_score')) * 100:.1f}%\n"
            f"Received: {claim.get('date_received', 'N/A')}"
        )

        line_items = claim.get("line_items") or []
        if line_items:
            block += f"\nLine Items ({len(line_items)} procedures):"
            for li in line_items[:5]:
                block += (
                    f"\n  {li.get('procedure_code','?')} | "
                    f"Billed {_safe_float(li.get('billed_amount')):.2f} | "
                    f"Allowed {_safe_float(li.get('allowed_amount')):.2f} | "
                    f"Status: {li.get('coverage_status','?')}"
                )

        denial = claim.get("denial_reason") or s.get("denial_reason")
        if denial:
            block += f"\nDenial Reason: {denial}"

        audit = (claim.get("audit_trail") or [])[-5:]
        if audit:
            block += "\nAudit Trail (latest 5):"
            for a in audit:
                block += (
                    f"\n  {a.get('timestamp','?')[:19]} | "
                    f"{a.get('event_type','?')} | "
                    f"{a.get('description','')[:100]}"
                )

        blocks.append(block)
        sources.append(f"Claim {ref_upper}")

    return "\n\n".join(blocks), sources


def _fetch_kpi_context(
    claims_store: dict,
    db_available: bool,
    date_range: tuple[date, date] | None = None,
) -> tuple[str, list[str]]:
    all_claims = list(claims_store.values())
    source_label = "in-memory claims store"
    if not all_claims:
        all_claims = _load_claims_from_db(db_available, date_range=date_range)
        source_label = "database"

    # Apply date filter when a range is given
    if date_range:
        start, end = date_range
        filtered = [
            c for c in all_claims
            if _in_range(c.get("date_received") or c.get("service_date"), start, end)
        ]
        period_label = _date_range_label(start, end)
    else:
        filtered = all_claims
        period_label = "all time"

    total = len(filtered)
    by_status: dict[str, int] = {}
    settled_amount = 0.0
    conf_sum = 0.0
    conf_count = 0
    auto_adj = 0
    proc_times: list[float] = []

    for c in filtered:
        st = c.get("status", "UNKNOWN")
        by_status[st] = by_status.get(st, 0) + 1
        s = c.get("settlement") or {}
        settled_amount += _safe_float(s.get("total_plan_payment") or c.get("total_settlement"))
        conf = _as_ratio(c.get("confidence_score"))
        if conf > 0:
            conf_sum += conf
            conf_count += 1
        if st in ("SETTLED", "HITL_APPROVED") and conf >= 0.85:
            auto_adj += 1
        pt = c.get("processing_time_ms") or c.get("avg_processing_time_ms")
        if pt:
            proc_times.append(_safe_float(pt))

    denial_count = by_status.get("DENIED", 0) + by_status.get("HITL_DENIED", 0)
    denial_rate  = (denial_count / total * 100) if total > 0 else 0
    auto_rate    = (auto_adj / total * 100) if total > 0 else 0
    avg_conf     = (conf_sum / conf_count * 100) if conf_count > 0 else 0
    avg_ms       = sum(proc_times) / len(proc_times) if proc_times else 0
    hitl_pending = by_status.get("HITL_PENDING", 0)

    status_lines = "\n".join(f"  {k}: {v}" for k, v in sorted(by_status.items()))

    block = (
        f"[KPI Summary — Period: {period_label} | As of {datetime.now(timezone.utc).replace(tzinfo=None).strftime('%d %b %Y %H:%M')} UTC]\n"
        f"Total Claims: {total}\n"
        f"Manual Review Pending: {hitl_pending}\n"
        f"Denial Rate: {denial_rate:.1f}%\n"
        f"Automation Rate: {auto_rate:.1f}%\n"
        f"Total Settled Amount: AED {settled_amount:,.2f}\n"
        f"Average Confidence Score: {avg_conf:.1f}%\n"
        f"Average Processing Time: {avg_ms:.0f}ms\n"
        f"Claims by Status:\n{status_lines}\n"
        f"Source: {source_label} ({len(all_claims)} total, {total} in period)"
    )
    label = f"Metrics Summary ({period_label})" if date_range else "Dashboard Metrics (live)"
    return block, [label]


def _fetch_claims_list_context(
    claims_store: dict,
    db_available: bool,
    date_range: tuple[date, date] | None,
    query_lower: str,
) -> tuple[str, list[str]]:
    """Returns a short list of claims matching the query intent (high-risk, pending, denied, etc.)."""
    claims = _collect_report_claims(claims_store, db_available, date_range)

    if any(kw in query_lower for kw in ["high-risk", "high risk", "risk", "low confidence", "flagged"]):
        filtered = sorted(
            [c for c in claims if _as_ratio(c.get("confidence_score", 1)) < 0.75 or c.get("hitl_trigger_reason")],
            key=lambda x: _as_ratio(x.get("confidence_score", 1)),
        )[:6]
        label = "High-Risk Claims"
    elif any(kw in query_lower for kw in ["exception", "exceptions", "pending exception"]):
        filtered = [
            c for c in claims
            if c.get("hitl_trigger_reason") or str(c.get("status", "")).upper() in _REVIEW_STATUSES
        ][:6]
        label = "Exception Claims"
    elif any(kw in query_lower for kw in ["denied", "denial", "rejected"]):
        filtered = _filter_report_claims("denied", claims)[:6]
        label = "Denied Claims"
    elif any(kw in query_lower for kw in ["pending", "awaiting", "processing"]):
        filtered = _filter_report_claims("pending", claims)[:6]
        label = "Pending Claims"
    else:
        filtered = sorted(claims, key=lambda c: c.get("date_received") or "", reverse=True)[:6]
        label = "Recent Claims"

    if not filtered:
        return f"[{label}]\nNo claims found matching this filter.", [label]

    lines = [f"[{label} — {len(filtered)} shown of {len(claims)} total]"]
    for c in filtered:
        conf = _as_ratio(c.get("confidence_score", 0)) * 100
        ref = _claim_display_ref(c)
        currency = _claim_display_currency(c)
        reason = (
            c.get("hitl_trigger_reason") or c.get("denial_reason") or ""
        )
        line = (
            f"{ref} | {c.get('status', '?')} | "
            f"{c.get('patient_name', 'N/A')} | "
            f"{currency} {_safe_float(c.get('total_billed')):,.0f} billed | "
            f"Conf: {conf:.0f}%"
        )
        if reason:
            line += f" | {reason[:60]}"
        lines.append(line)

    return "\n".join(lines), [label]


def _fetch_claims_for_export(
    claims_store: dict,
    db_available: bool,
    date_range: tuple[date, date] | None,
) -> tuple[list[dict], str]:
    """Returns (claims_list, period_label) for CSV generation."""
    all_claims = list(claims_store.values())
    if not all_claims:
        all_claims = _load_claims_from_db(db_available, date_range=date_range, limit=2000)
    if date_range:
        start, end = date_range
        claims = [
            c for c in all_claims
            if _in_range(c.get("date_received") or c.get("service_date"), start, end)
        ]
        label = _date_range_label(start, end)
    else:
        claims = all_claims
        label = "all time"
    return claims, label


def _fetch_hitl_context(claims_store: dict, db_available: bool) -> tuple[str, list[str]]:
    hitl = [c for c in claims_store.values() if c.get("status") == "HITL_PENDING"]
    if not hitl:
        hitl = _load_claims_from_db(db_available, statuses=["HITL_PENDING"], limit=100)
    if not hitl:
        return "[Review Queue]\nNo claims currently pending manual review.", ["Review Queue"]

    lines = [f"[Review Queue — {len(hitl)} pending]"]
    for c in sorted(hitl, key=lambda x: x.get("sla_deadline") or "9999"):
        conf = _as_ratio(c.get("confidence_score")) * 100
        lines.append(
            f"  {c.get('claim_reference')} | "
            f"Patient: {c.get('patient_name','N/A')} | "
            f"Billed: {_safe_float(c.get('total_billed')):.0f} | "
            f"Confidence: {conf:.1f}% | "
            f"Due: {c.get('sla_deadline','N/A')} | "
            f"Trigger: {c.get('hitl_trigger_reason') or c.get('denial_reason') or 'N/A'}"
        )
        if len(lines) > 9:
            lines.append(f"  ... and {len(hitl) - 8} more")
            break
    return "\n".join(lines), [f"Review Queue ({len(hitl)} pending)"]


def _fetch_policy_context(db_available: bool) -> tuple[str, list[str]]:
    if not db_available:
        return "[Policy Library]\nDatabase not available.", []
    try:
        from shared.db_sync import get_sync_session
        with get_sync_session() as sess:
            if not sess:
                return "[Policy Library]\nDB session unavailable.", []
            rows = sess.execute(
                text("""
                    SELECT p.policy_number, p.carrier_name, p.market_region, p.tier,
                           p.annual_limit, p.currency,
                           pc.clause_type, pc.section_reference, pc.title, pc.full_text
                    FROM policies p
                    LEFT JOIN policy_clauses pc ON pc.policy_id = p.id AND pc.is_active = true
                    ORDER BY p.market_region, pc.clause_type
                    LIMIT 40
                """)
            ).fetchall()
            if not rows:
                return "[Policy Library]\nNo policies found.", []
            lines = [f"[Policy Library — {len(rows)} clauses]"]
            current_policy = None
            for r in rows:
                d = dict(r._mapping)
                if d["policy_number"] != current_policy:
                    current_policy = d["policy_number"]
                    lines.append(
                        f"\nPolicy: {d['policy_number']} | {d['carrier_name']} | "
                        f"{d['market_region']} | Tier: {d['tier']} | "
                        f"Annual Limit: {d['currency']} {_safe_float(d['annual_limit']):,.0f}"
                    )
                if d.get("title"):
                    excerpt = (d.get("full_text") or "")[:200]
                    lines.append(
                        f"  [{d.get('clause_type','?')}] "
                        f"Section {d.get('section_reference','?')} — "
                        f"{d['title']}: {excerpt}..."
                    )
            return "\n".join(lines), ["Policy Library (live clauses)"]
    except Exception as e:
        return f"[Policy Library]\nError fetching clauses: {e}", []


def _fetch_health_context(db_available: bool = False) -> tuple[str, list[str]]:
    """Check service health via direct internal probes (no HTTP self-call)."""
    import os as _os
    lines = ["[Service Health]"]
    lines.append("  Service layer: running")

    # Database probe
    if db_available:
        try:
            from shared.db_sync import get_sync_session
            with get_sync_session() as sess:
                if sess:
                    sess.execute(text("SELECT 1"))
                    lines.append("  Database: connected")
                else:
                    lines.append("  Database: session unavailable")
        except Exception as _e:
            lines.append(f"  Database: error ({type(_e).__name__})")
    else:
        lines.append("  Database: not reachable")

    # Redis probe
    try:
        import redis as _redis
        _r = _redis.Redis(
            host=_os.getenv("REDIS_HOST", "localhost"),
            port=int(_os.getenv("REDIS_PORT", "6379")),
            socket_connect_timeout=2,
        )
        _r.ping()
        lines.append("  Redis: connected")
    except Exception:
        lines.append("  Redis: unavailable")

    # AI provider probe (key presence only; no network call)
    try:
        from services.api_gateway.app import main as _gw
        _cfg = _gw.config_store.load() if hasattr(_gw, "config_store") else {}
    except Exception:
        _cfg = {}
    _has_llm = bool(
        _cfg.get("groq_api_key") or _os.getenv("GROQ_API_KEY")
        or _cfg.get("openai_api_key") or _os.getenv("OPENAI_API_KEY")
        or _cfg.get("anthropic_api_key") or _os.getenv("ANTHROPIC_API_KEY")
        or _cfg.get("nvidia_api_key") or _os.getenv("NVIDIA_API_KEY")
    )
    lines.append(f"  AI assistant: {'configured' if _has_llm else 'not configured - rules-only answers active'}")

    return "\n".join(lines), ["Service Health (live)"]

# ── System prompt ──────────────────────────────────────────────────────────────

_SYSTEM = f"""You are the ACOS Assistant embedded in a health insurance adjudication platform.
You have been given live operational data. Answer solely from that data.

SCOPE — you answer ONLY questions about:
- Claims (status, financials, adjudication results, specific claim references)
- Metrics and dashboards (total claims, settlement rate, denial rate, automation rate)
- Review queue (manual review items, due-time countdowns, overdue reviews)
- Policies and coverage rules (clauses, deductibles, exclusions, benefit limits)
- Audit trail and event logs
- Data exports (CSV downloads of claims data)
- System and service health (service layer, database, Redis, AI availability)
- Platform technical support (admin settings, configuration, integrations, service/data flow issues)

Reject off-topic requests even if they contain a matched intent keyword such as claim, KPI, queue, policy, audit, export, health, status, report, or download.
For example, requests for coding help, weather, general knowledge, jokes, writing unrelated emails, or explanations unrelated to this claims platform are outside scope.
If any part of the user request is outside this scope, reply with exactly:
"{_SCOPE_REFUSAL_REPLY}"

Rules:
- Write in professional English. Use basic structured formatting for readability.
- Use **bold** for key metrics, status names, and claim references.
- Use bullet points (- or *) for lists of items.
- For structured data (like claim details or metrics), use a simple key | value format (e.g. "Status | SETTLED").
- Lead directly with the answer. No greetings, no filler phrases.
- Be concise. Default to 3-4 precise points or a small table.
- Do not reveal reasoning, chain-of-thought, or retrieval steps.
- Never output tags such as <think>, <analysis>, <reasoning>, or XML wrappers.
- Never mention formatting rules or how you are composing the answer.
- Format currency with its symbol (AED, INR, USD). Round to 2 decimal places.
- Format percentages to 1 decimal place. Dates as DD MMM YYYY.
- For claim lookups: state status, key financials, and any critical flags first.
- For metric queries: highlight the most operationally important rates first.
- For review queue: list items by due-time urgency, most urgent first.
- If data is missing from the context, say exactly what is unavailable.
- Never invent figures, statuses, or interpretations not present in the retrieved data.

Today: {{today}}
"""

# ── Output sanitisation ────────────────────────────────────────────────────────

_REASONING_BLOCK_RE = re.compile(
    r"<(?:think|analysis|reasoning)\b[^>]*>.*?</(?:think|analysis|reasoning)>",
    re.IGNORECASE | re.DOTALL,
)

_INLINE_REASONING_TAG_RE = re.compile(r"</?(?:think|analysis|reasoning)\b[^>]*>", re.IGNORECASE)
_OPEN_REASONING_TAG_RE = re.compile(r"<(?:think|analysis|reasoning)\b[^>]*>", re.IGNORECASE)

_REASONING_LINE_RE = re.compile(
    r"^\s*(?:okay|alright|let me|i(?:'m| am)? going to|i(?:'m| am)? checking|looking at|"
    r"the user asked|the request is|the prompt is|i need to|we need to|"
    r"make sure to|need to keep it|just focus on|the key point here is|"
    r"the rest of the data|formatting instruction)\b.*$",
    re.IGNORECASE,
)

_SANITIZE_RULES = [
    (re.compile(r'^#{1,6}\s*', re.MULTILINE), ''),
    # (re.compile(r'\*{1,3}([^*\n]+)\*{1,3}'), r'\1'), # ALLOW BOLD
    (re.compile(r'_{1,2}([^_\n]+)_{1,2}'), r'\1'),
    (re.compile(r'`([^`\n]*)`'), r'\1'),
    (re.compile(r'```[\w]*\n?', re.MULTILINE), ''),
    # (re.compile(r'^\s*[-*•·]\s+', re.MULTILINE), ''), # ALLOW LISTS
    (re.compile(r'^\s*\d+\.\s+', re.MULTILINE), ''),
    (re.compile(r'^[-_*]{3,}\s*$', re.MULTILINE), ''),
    (re.compile(r'^(Based on (the )?(provided |retrieved )?context,?\s*)', re.IGNORECASE), ''),
    (re.compile(r'^(According to (the )?(provided |retrieved )?context,?\s*)', re.IGNORECASE), ''),
    (re.compile(r'^(Here is (a |the )?summary:?\s*)', re.IGNORECASE), ''),
    (re.compile(r'^(Sure[,!]?\s*)', re.IGNORECASE), ''),
    (re.compile(r'^(Certainly[,!]?\s*)', re.IGNORECASE), ''),
    (re.compile(r'^(Of course[,!]?\s*)', re.IGNORECASE), ''),
    (re.compile(r'^(Great[,!]?\s*)', re.IGNORECASE), ''),
    (re.compile(r'\n{3,}'), '\n\n'),
]

def _compress_lines(text: str, max_lines: int = 10) -> str:
    lines = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or _REASONING_LINE_RE.match(line):
            continue
        lines.append(line)

    if not lines:
        return ""

    if len(lines) == 1 and len(lines[0]) > 240:
        lines = [
            segment.strip()
            for segment in re.split(r'(?<=[.!?])\s+', lines[0])
            if segment.strip()
        ]

    return "\n".join(lines[:max_lines]).strip()


def _friendly_reply_line(line: str) -> str:
    replacements = [
        (re.compile(r"\bHITL\b", re.IGNORECASE), "manual review"),
        (re.compile(r"\bSLA\b", re.IGNORECASE), "due time"),
        (re.compile(r"\bKPIs?\b", re.IGNORECASE), "metrics"),
        (re.compile(r"\bAPI\b"), "service"),
        (re.compile(r"\bLLM\b", re.IGNORECASE), "AI assistant"),
        (re.compile(r"\bauto-adjudicated\b", re.IGNORECASE), "automated"),
        (re.compile(r"\bauto-adjudication\b", re.IGNORECASE), "automation"),
        (re.compile(r"\s+[·|]\s+"), " - "),
    ]
    value = line.strip()
    for pattern, replacement in replacements:
        value = pattern.sub(replacement, value)
    return re.sub(r"\s{2,}", " ", value).strip()


def _bullet_reply(lines: list[str], max_lines: int = 4) -> str:
    seen: set[str] = set()
    selected: list[str] = []
    for raw in lines:
        for piece in re.split(r"\s+·\s+", raw):
            line = re.sub(r"^\s*[-*•·\d.)]+\s*", "", piece).strip()
            if not line:
                continue
            if len(line) > 260:
                fragments = [fragment.strip() for fragment in re.split(r"(?<=[.!?])\s+", line) if fragment.strip()]
            else:
                fragments = [line]
            for fragment in fragments:
                friendly = _friendly_reply_line(fragment)
                if not friendly or _REASONING_LINE_RE.match(friendly):
                    continue
                key = re.sub(r"[^a-z0-9]+", " ", friendly.lower()).strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                selected.append(friendly)
                if len(selected) >= max_lines:
                    return "\n".join(f"- {item}" for item in selected)
    return "\n".join(f"- {item}" for item in selected)


def _sanitize_reply(text: str) -> str:
    if not text:
        return "- No information is available for this query.\n- Try a claim reference, metrics summary, review queue, policy clause, or service health check."
    text = text.strip()
    text = _REASONING_BLOCK_RE.sub("", text)
    open_tag_match = _OPEN_REASONING_TAG_RE.search(text)
    if open_tag_match:
        text = text[:open_tag_match.start()]
    text = _INLINE_REASONING_TAG_RE.sub("", text)
    for pattern, replacement in _SANITIZE_RULES:
        text = pattern.sub(replacement, text)
    text = _compress_lines(text, max_lines=4)
    text = text.strip()
    if not text:
        return "- No concise answer is available for this query.\n- Try a more specific question."
    bullet_text = _bullet_reply(text.splitlines(), max_lines=4)
    return bullet_text or "- No concise answer is available for this query.\n- Try a more specific question."


def _build_context_fallback_reply(
    context_parts: list[str],
    intents: Optional[list[str]] = None,
    export_filename: Optional[str] = None,
) -> str:
    intents = intents or []
    ranked_parts: list[tuple[int, str]] = []
    health_parts: list[str] = []
    claim_parts: list[str] = []

    for idx, part in enumerate(context_parts):
        first_line = next((line.strip() for line in part.splitlines() if line.strip()), "")
        priority = 100 + idx

        if "health" in intents and "Service Health" in first_line:
            priority = 0 + idx
            health_parts.append(part)
        elif "claim_lookup" in intents and "Claim" in first_line:
            priority = 5 + idx
            claim_parts.append(part)
        elif "hitl" in intents and ("Review Queue" in first_line or "HITL" in first_line):
            priority = 10 + idx
        elif "kpi" in intents and "KPI" in first_line:
            priority = 15 + idx
        elif "policy" in intents and "Policy" in first_line:
            priority = 20 + idx
        elif "export" in intents and "Export Summary" in first_line:
            priority = 25 + idx

        ranked_parts.append((priority, part))

    lines: list[str] = []

    candidate_parts = sorted(ranked_parts, key=lambda item: item[0])
    if "health" in intents and health_parts:
        candidate_parts = [(0, part) for part in health_parts]
    elif "claim_lookup" in intents and claim_parts:
        candidate_parts = [(0, part) for part in claim_parts]

    for _, part in candidate_parts:
        for raw_line in part.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("[") and line.endswith("]"):
                continue
            if line.startswith("Policy:"):
                continue
            line = re.sub(r"^\s*[-*•·]\s+", "", line)
            line = re.sub(r"^\s*\d+\.\s+", "", line)
            line = re.sub(r"\s{2,}", " ", line).strip()
            if not line:
                continue
            if line not in lines:
                lines.append(line)

    if export_filename and all(export_filename not in line for line in lines):
        lines.append(f"File ready for download: {export_filename}")

    if not lines:
        return "- No data is available for this query.\n- Try a claim reference, metrics summary, review queue, policy clause, or service health check."

    # Filter out internal plumbing lines that look like error messages
    allowed_status_terms = [
        "claims", "kpi", "hitl", "policy", "audit", "export",
        "api", "database", "redis", "llm", "provider", "service",
    ]
    lines = [
        line for line in lines
        if not re.search(r"\b(unreachable|starting|unavailable|error|failed|exception)\b", line, re.IGNORECASE)
        or any(kw in line.lower() for kw in allowed_status_terms)
    ]

    if not lines:
        return "- AI assistant keys are not configured.\n- Live data is still available.\n- Ask about a claim reference, metrics summary, or review queue."

    return _bullet_reply(lines, max_lines=4)

# ── Provider chain (failover) ──────────────────────────────────────────────────

def _build_provider_chain(registry_info) -> list[dict]:
    import os as _os
    try:
        from services.api_gateway.app import main as gw
        cfg = gw.config_store.load() if hasattr(gw, "config_store") else {}
    except Exception:
        cfg = {}

    def _key(cfg_field: str, env_var: str) -> str:
        # Prefer config_store value; fall back to env var so a null disk entry
        # never silently disables a provider whose key is set in .env.prod.
        return (cfg.get(cfg_field) or _os.getenv(env_var, "")) or ""

    chain: list[dict] = []
    if registry_info.is_available:
        chain.append({
            "provider": registry_info.provider_name,
            "api_key":  registry_info.api_key,
            "model":    registry_info.model_name,
        })

    candidates = [
        ("groq",      _key("groq_api_key",      "GROQ_API_KEY"),      cfg.get("llm_model",      "qwen/qwen3-32b"),                              cfg.get("groq_enabled",      True)),
        ("nvidia",    _key("nvidia_api_key",    "NVIDIA_API_KEY"),    cfg.get("nvidia_model",   "nvidia/llama-3.1-nemotron-ultra-253b-v1"),      cfg.get("nvidia_enabled",    False)),
        ("openai",    _key("openai_api_key",    "OPENAI_API_KEY"),    cfg.get("openai_model",   "gpt-4o"),                                       cfg.get("openai_enabled",    False)),
        ("anthropic", _key("anthropic_api_key", "ANTHROPIC_API_KEY"), cfg.get("anthropic_model","claude-sonnet-4-5"),                            cfg.get("anthropic_enabled", False)),
    ]
    for name, key, model, enabled in candidates:
        key_str = (key or "").strip()
        if enabled and key_str and not any(p["provider"] == name for p in chain):
            chain.append({"provider": name, "api_key": key_str, "model": model})

    return chain

# ── LLM caller ────────────────────────────────────────────────────────────────

async def _call_provider(provider: dict, system: str, messages: list[dict]) -> str:
    name = provider["provider"]
    key  = provider["api_key"]
    model = provider["model"]

    base_urls = {
        "groq":   "https://api.groq.com/openai/v1",
        "nvidia": "https://integrate.api.nvidia.com/v1",
        "openai": "https://api.openai.com/v1",
    }
    if name in base_urls:
        return await _call_openai_compat(key, model, system, messages, base_urls[name])
    if name == "anthropic":
        return await _call_anthropic(key, model, system, messages)
    raise ValueError(f"Unknown provider: {name}")


async def _call_openai_compat(
    api_key: str, model: str, system: str,
    messages: list[dict], base_url: str
) -> str:
    import httpx
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}] + messages,
        "temperature": 0.0,
        "max_tokens": 400,
        "stop": ["<think>", "<analysis>", "<reasoning>"],
    }
    async with httpx.AsyncClient(timeout=_CHAT_PROVIDER_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


async def _call_anthropic(api_key: str, model: str, system: str, messages: list[dict]) -> str:
    import httpx
    async with httpx.AsyncClient(timeout=_CHAT_PROVIDER_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 400,
                "system": system,
                "messages": messages,
                "stop_sequences": ["<think>", "<analysis>", "<reasoning>"],
            },
        )
        resp.raise_for_status()
        return resp.json()["content"][0]["text"].strip()


async def _call_llm_with_failover(
    provider_chain: list[dict], system: str, messages: list[dict]
) -> str:
    last_error: Exception = RuntimeError("No providers configured.")
    for provider in provider_chain:
        try:
            result = await _call_provider(provider, system, messages)
            if result:
                return result
        except Exception as exc:
            logger.warning("[chat] Provider %s failed: %s — trying next", provider["provider"], exc)
            last_error = exc
    raise last_error

# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if not _chat_allowed_for_user(current_user):
        raise HTTPException(status_code=403, detail="Chat assistant is disabled for this role or market")

    registry      = get_registry()
    registry_info = registry.get_provider_info()
    provider_chain = _build_provider_chain(registry_info)

    try:
        from services.api_gateway.app import main as gw
        claims_store: dict = gw.claims_store
        db_available: bool = gw._db_available
    except Exception:
        claims_store = {}
        db_available = False

    messages_raw = _normalize_messages(
        [{"role": m.role, "content": m.content} for m in body.messages]
    )
    last_user = next(
        (m["content"] for m in reversed(messages_raw) if m["role"] == "user"), ""
    )

    selected_report = _parse_report_generation(last_user)
    if selected_report:
        report_type, date_range_id = selected_report
        report_csv, report_filename, reply, row_count = _generate_report_csv(
            report_type,
            date_range_id,
            claims_store,
            db_available,
        )
        return ChatResponse(
            reply=reply,
            context_used=[f"{_report_type_label(report_type)} Report ({row_count} claims)"],
            export_csv=report_csv,
            export_filename=report_filename,
        )

    selected_dashboard_action = _parse_dashboard_action_generation(last_user)
    if selected_dashboard_action:
        action_id, date_range_id = selected_dashboard_action
        reply, context_used = _generate_dashboard_action_reply(
            action_id,
            date_range_id,
            claims_store,
            db_available,
        )
        return ChatResponse(
            reply=reply,
            context_used=context_used,
        )

    dashboard_action = _parse_dashboard_setup_request(last_user)
    if dashboard_action:
        date_range_id = _infer_date_range_id(last_user)
        reply, context_used = _generate_dashboard_action_reply(
            dashboard_action,
            date_range_id,
            claims_store,
            db_available,
        )
        return ChatResponse(
            reply=reply,
            context_used=context_used,
        )

    if _is_report_setup_request(last_user):
        return ChatResponse(
            reply="Choose the report type and date range, then click Generate.",
            context_used=[],
            report_options=_build_report_options(),
        )

    intents, claim_refs, date_range = _detect_intents(messages_raw, last_user)

    # ── Scope guard — reject anything outside claims/KPI domain ───────────────
    if intents == ["out_of_scope"]:
        return ChatResponse(
            reply=_SCOPE_REFUSAL_REPLY,
            context_used=[],
        )

    # ── Context retrieval ──────────────────────────────────────────────────────
    context_parts: list[str] = []
    context_used:  list[str] = []
    export_csv:    Optional[str] = None
    export_filename: Optional[str] = None

    for intent in intents:
        if intent == "claim_lookup" and claim_refs:
            ctx, src = _fetch_claim_context(claim_refs, claims_store, db_available)
            context_parts.append(ctx)
            context_used.extend(src)

        elif intent == "kpi":
            ctx, src = _fetch_kpi_context(claims_store, db_available, date_range)
            context_parts.append(ctx)
            context_used.extend(src)

        elif intent == "hitl":
            ctx, src = _fetch_hitl_context(claims_store, db_available)
            context_parts.append(ctx)
            context_used.extend(src)

        elif intent == "policy":
            ctx, src = _fetch_policy_context(db_available)
            context_parts.append(ctx)
            context_used.extend(src)

        elif intent == "health":
            ctx, src = _fetch_health_context(db_available)
            context_parts.append(ctx)
            context_used.extend(src)

        elif intent == "audit" and not claim_refs:
            ctx, src = _fetch_kpi_context(claims_store, db_available, date_range)
            context_parts.append(ctx)
            context_used.extend(src)

        elif intent == "claims_list":
            ctx, src = _fetch_claims_list_context(claims_store, db_available, date_range, last_user.lower())
            context_parts.append(ctx)
            context_used.extend(src)

        elif intent == "export":
            claims_for_export, period_label = _fetch_claims_for_export(
                claims_store, db_available, date_range
            )
            if claims_for_export:
                export_csv = _claims_to_csv(claims_for_export, period_label)
                date_tag = date_range[0].strftime("%Y%m%d") if date_range else "all"
                export_filename = f"claims_export_{date_tag}.csv"
                context_parts.append(
                    f"[Export Summary]\n"
                    f"Period: {period_label}\n"
                    f"Claims included: {len(claims_for_export)}\n"
                    f"File ready for download: {export_filename}"
                )
                context_used.append(f"CSV Export ({len(claims_for_export)} claims)")
            else:
                context_parts.append(
                    f"[Export Summary]\nNo claims found for the requested period."
                )

    if context_parts:
        return ChatResponse(
            reply=_build_context_fallback_reply(context_parts, intents, export_filename),
            context_used=list(dict.fromkeys(context_used)),
            export_csv=export_csv,
            export_filename=export_filename,
        )

    if not provider_chain:
        fallback = _build_context_fallback_reply(context_parts, intents, export_filename)
        if not context_parts:
            fallback = (
                "- AI assistant keys are not configured.\n"
                "- Add a provider key in Admin > Control Settings to enable model-backed answers.\n"
                "- Live data is still available: ask about a claim reference, metrics summary, review queue, or policy clause."
            )
        return ChatResponse(
            reply=fallback,
            context_used=list(dict.fromkeys(context_used)),
            export_csv=export_csv,
            export_filename=export_filename,
        )

    system = _SYSTEM.format(today=datetime.now(timezone.utc).replace(tzinfo=None).strftime("%d %b %Y"))
    if context_parts:
        merged = "\n\n".join(context_parts)
        system += f"\n\n--- RETRIEVED DATA ---\n{merged}\n--- END DATA ---"

    try:
        raw_reply = await _call_llm_with_failover(provider_chain, system, messages_raw)
        reply = _sanitize_reply(raw_reply)
        return ChatResponse(
            reply=reply,
            context_used=list(dict.fromkeys(context_used)),
            export_csv=export_csv,
            export_filename=export_filename,
        )
    except Exception as exc:
        logger.error("[chat] All providers failed: %s", exc, exc_info=True)
        return ChatResponse(
            reply=_build_context_fallback_reply(context_parts, intents, export_filename),
            context_used=list(dict.fromkeys(context_used)),
            export_csv=export_csv,
            export_filename=export_filename,
        )
