"""
Prometheus Metrics Endpoint for API Gateway.
Exposes /metrics endpoint in prometheus text format.
"""

import re
import time
from typing import Dict, Optional
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
from starlette.types import ASGIApp

# HTTP request metrics
HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status", "tenant"]
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "endpoint"],
    buckets=[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
)

# Connection metrics
ACTIVE_CONNECTIONS = Gauge(
    "active_connections",
    "Number of active connections",
    ["type"]  # db, redis, etc.
)

# LLM metrics
LLM_REQUESTS_TOTAL = Counter(
    "llm_requests_total",
    "Total LLM requests",
    ["provider", "status"]
)

# Circuit breaker metrics
CIRCUIT_BREAKER_STATE = Gauge(
    "circuit_breaker_state",
    "Circuit breaker state (0=closed, 1=open, 2=half-open)",
    ["provider"]
)

# Rate limiting metrics
RATE_LIMITED_REQUESTS_TOTAL = Counter(
    "rate_limited_requests_total",
    "Total rate limited requests",
    ["endpoint"]
)

# Claim processing metrics
CLAIM_PROCESSING_DURATION_SECONDS = Histogram(
    "claim_processing_duration_seconds",
    "Claim processing duration in seconds",
    buckets=[0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]
)

# Claim lifecycle observability metrics. Labels are intentionally bounded:
# never put claim references, member IDs, patient data, or tenant IDs here.
CLAIM_LIFECYCLE_EVENTS_TOTAL = Counter(
    "claim_lifecycle_events_total",
    "Total claim lifecycle events emitted by canonical stage and result",
    ["stage", "event", "market", "result"],
)

CLAIMS_IN_STAGE = Gauge(
    "claims_in_stage",
    "Current number of claims in each canonical lifecycle stage",
    ["stage", "market"],
)

CLAIM_STAGE_DURATION_SECONDS = Histogram(
    "claim_stage_duration_seconds",
    "Observed claim lifecycle stage duration in seconds",
    ["stage", "market"],
    buckets=[0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 900, 1800, 3600, 7200, 21600, 86400],
)

CLAIM_CURRENT_STAGE_AGE_SECONDS = Gauge(
    "claim_current_stage_age_seconds",
    "Oldest current claim age in a lifecycle stage, aggregated without claim identifiers",
    ["stage", "market", "sla_state"],
)

HITL_QUEUE_DEPTH = Gauge(
    "hitl_queue_depth",
    "Current HITL queue depth by market and bounded priority bucket",
    ["market", "priority"],
)

CLAIM_DEAD_LETTERS_OPEN = Gauge(
    "claim_dead_letters_open",
    "Current open claim dead-letter records by stage and market",
    ["stage", "market"],
)

CLAIM_PROCESSING_SAGA_STALE_TOTAL = Counter(
    "claim_processing_saga_stale_total",
    "Total claim processing sagas detected as stale",
    ["stage", "market", "reason"],
)

_LABEL_TOKEN_RE = re.compile(r"[^a-z0-9_]+")

_ALLOWED_MARKETS = {
    "uae",
    "ksa",
    "bahrain",
    "oman",
    "qatar",
    "kuwait",
    "india",
    "unknown",
}

_MARKET_ALIASES = {
    "ae": "uae",
    "united_arab_emirates": "uae",
    "saudi_arabia": "ksa",
    "sa": "ksa",
    "in": "india",
}

_ALLOWED_STAGES = {
    "document_ingestion",
    "intake_enrichment",
    "rules_engine",
    "ai_reasoning",
    "dual_validation",
    "settlement",
    "validation",
    "hitl_routing",
    "persistence",
    "received",
    "intake",
    "validation",
    "ocr",
    "extraction",
    "policy",
    "rules",
    "llm_reasoning",
    "adjudication",
    "settlement",
    "hitl",
    "payment",
    "closed",
    "dead_letter",
    "unknown",
}

_STAGE_ALIASES = {
    "claim_received": "received",
    "received": "received",
    "intake_processing": "intake",
    "intake_complete": "intake",
    "intake_failed": "intake",
    "document_validation": "validation",
    "document_processed": "ocr",
    "ocr_completed": "ocr",
    "nlp_extraction_completed": "extraction",
    "policy_retrieval": "policy",
    "policy_retrieved": "policy",
    "clauses_identified": "policy",
    "rules_evaluated": "rules",
    "reasoning_completed": "llm_reasoning",
    "llm_analyzed": "llm_reasoning",
    "adjudicating": "adjudication",
    "adjudicated": "adjudication",
    "settlement_calculated": "settlement",
    "settlement_approved": "settlement",
    "settlement_overridden": "settlement",
    "hitl_pending": "hitl",
    "hitl_in_review": "hitl",
    "hitl_routed": "hitl",
    "hitl_decided": "hitl",
    "hitl_decision_made": "hitl",
    "hitl_approved": "closed",
    "hitl_denied": "closed",
    "settled": "closed",
    "denied": "closed",
    "appealed": "closed",
    "error": "dead_letter",
    "pipeline_result": "dead_letter",
}

_ALLOWED_EVENTS = {
    "entered",
    "completed",
    "failed",
    "blocked",
    "skipped",
    "retried",
    "stuck",
    "routed",
    "decided",
    "reopened",
    "dead_lettered",
    "claim_received",
    "document_processed",
    "rules_evaluated",
    "llm_analyzed",
    "settlement_calculated",
    "hitl_routed",
    "hitl_decided",
    "closed",
    "unknown",
}

_EVENT_ALIASES = {
    "ocr_completed": "document_processed",
    "nlp_extraction_completed": "document_processed",
    "reasoning_completed": "llm_analyzed",
    "hitl_decision_made": "hitl_decided",
    "settlement_approved": "closed",
    "settlement_overridden": "closed",
    "error_occurred": "failed",
}

_ALLOWED_RESULTS = {"success", "failure", "timeout", "skipped", "pending", "retry", "unknown"}
_RESULT_ALIASES = {
    "ok": "success",
    "completed": "success",
    "complete": "success",
    "done": "success",
    "error": "failure",
    "failed": "failure",
    "fail": "failure",
    "queued": "pending",
    "processing": "pending",
}

_ALLOWED_PRIORITIES = {"low", "medium", "high", "urgent", "unknown"}
_PRIORITY_ALIASES = {"critical": "urgent", "p0": "urgent", "p1": "high", "p2": "medium"}

_ALLOWED_SLA_STATES = {"healthy", "warning", "breached", "unknown"}
_SLA_STATE_ALIASES = {"ok": "healthy", "warn": "warning", "breach": "breached", "overdue": "breached"}

_ALLOWED_STALE_REASONS = {
    "no_event",
    "worker_timeout",
    "lock_expired",
    "retry_exhausted",
    "heartbeat_missing",
    "unknown",
}

_STALE_REASON_ALIASES = {
    "timeout": "worker_timeout",
    "stale_lock": "lock_expired",
    "dead_worker": "heartbeat_missing",
}


def _safe_label(
    value: object,
    allowed: set[str],
    aliases: Optional[dict[str, str]] = None,
    default: str = "unknown",
) -> str:
    """Normalize a metric label into a bounded allow-list."""
    if value is None:
        return default

    token = _LABEL_TOKEN_RE.sub("_", str(value).strip().lower()).strip("_")
    token = token[:64] if token else default
    aliases = aliases or {}
    token = aliases.get(token, token)
    return token if token in allowed else default


def _non_negative_number(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return max(0, number)


def _non_negative_counter_amount(value: object) -> float:
    number = _non_negative_number(value)
    return number if number > 0 else 1


def _stage_label(stage: object) -> str:
    return _safe_label(stage, _ALLOWED_STAGES, _STAGE_ALIASES)


def _event_label(event: object) -> str:
    return _safe_label(event, _ALLOWED_EVENTS, _EVENT_ALIASES)


def _market_label(market: object) -> str:
    return _safe_label(market, _ALLOWED_MARKETS, _MARKET_ALIASES)


def _result_label(result: object) -> str:
    return _safe_label(result, _ALLOWED_RESULTS, _RESULT_ALIASES)


def _priority_label(priority: object) -> str:
    return _safe_label(priority, _ALLOWED_PRIORITIES, _PRIORITY_ALIASES)


def _sla_state_label(sla_state: object) -> str:
    return _safe_label(sla_state, _ALLOWED_SLA_STATES, _SLA_STATE_ALIASES)


def _stale_reason_label(reason: object) -> str:
    return _safe_label(reason, _ALLOWED_STALE_REASONS, _STALE_REASON_ALIASES)


def record_claim_lifecycle_event(
    stage: str,
    event: str,
    market: str = "unknown",
    result: str = "success",
    amount=1,
):
    """Record a bounded claim lifecycle event counter."""
    CLAIM_LIFECYCLE_EVENTS_TOTAL.labels(
        stage=_stage_label(stage),
        event=_event_label(event),
        market=_market_label(market),
        result=_result_label(result),
    ).inc(_non_negative_counter_amount(amount))


def set_claims_in_stage(stage: str, count, market: str = "unknown"):
    """Set the aggregate number of claims in a canonical lifecycle stage."""
    CLAIMS_IN_STAGE.labels(
        stage=_stage_label(stage),
        market=_market_label(market),
    ).set(_non_negative_number(count))


def observe_claim_stage_duration(stage: str, duration_seconds, market: str = "unknown"):
    """Observe elapsed time for a canonical lifecycle stage."""
    CLAIM_STAGE_DURATION_SECONDS.labels(
        stage=_stage_label(stage),
        market=_market_label(market),
    ).observe(_non_negative_number(duration_seconds))


def set_claim_current_stage_age(
    stage: str,
    age_seconds,
    market: str = "unknown",
    sla_state: str = "unknown",
):
    """Set oldest open claim age for a stage without claim-level labels."""
    CLAIM_CURRENT_STAGE_AGE_SECONDS.labels(
        stage=_stage_label(stage),
        market=_market_label(market),
        sla_state=_sla_state_label(sla_state),
    ).set(_non_negative_number(age_seconds))


def set_hitl_queue_depth(
    count,
    market: str = "unknown",
    priority: str = "unknown",
):
    """Set current HITL queue depth by bounded market and priority."""
    HITL_QUEUE_DEPTH.labels(
        market=_market_label(market),
        priority=_priority_label(priority),
    ).set(_non_negative_number(count))


def set_claim_dead_letters_open(
    count,
    stage: str = "unknown",
    market: str = "unknown",
):
    """Set current open dead-letter count by canonical failure stage."""
    CLAIM_DEAD_LETTERS_OPEN.labels(
        stage=_stage_label(stage),
        market=_market_label(market),
    ).set(_non_negative_number(count))


def record_processing_saga_stale(
    stage: str,
    market: str = "unknown",
    reason: str = "unknown",
    amount=1,
):
    """Record a stale claim-processing saga using bounded labels."""
    CLAIM_PROCESSING_SAGA_STALE_TOTAL.labels(
        stage=_stage_label(stage),
        market=_market_label(market),
        reason=_stale_reason_label(reason),
    ).inc(_non_negative_counter_amount(amount))


def update_db_connections(count: int):
    """Update active DB connections gauge."""
    ACTIVE_CONNECTIONS.labels(type="db").set(count)


def update_redis_connections(count: int):
    """Update active Redis connections gauge."""
    ACTIVE_CONNECTIONS.labels(type="redis").set(count)


def record_http_request(method: str, endpoint: str, status_code: int, duration: float, tenant: str = "unknown"):
    """Record HTTP request metrics."""
    HTTP_REQUESTS_TOTAL.labels(
        method=method,
        endpoint=endpoint,
        status=status_code,
        tenant=tenant
    ).inc()
    
    HTTP_REQUEST_DURATION_SECONDS.labels(
        method=method,
        endpoint=endpoint
    ).observe(duration)


def record_llm_request(provider: str, status: str):
    """Record LLM request metrics."""
    LLM_REQUESTS_TOTAL.labels(provider=provider, status=status).inc()


def set_circuit_breaker_state(provider: str, state: str):
    """Set circuit breaker state (open/closed/half-open)."""
    state_map = {"closed": 0, "open": 1, "half-open": 2}
    CIRCUIT_BREAKER_STATE.labels(provider=provider).set(state_map.get(state, 0))


def record_rate_limited_request(endpoint: str):
    """Record rate limited request."""
    RATE_LIMITED_REQUESTS_TOTAL.labels(endpoint=endpoint).inc()


def record_claim_processing_duration(duration: float):
    """Record claim processing duration."""
    CLAIM_PROCESSING_DURATION_SECONDS.observe(duration)


async def metrics_endpoint(request):
    """Prometheus metrics endpoint handler."""
    return Response(
        generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )


def setup_metrics(app: ASGIApp):
    """Setup metrics endpoint on the FastAPI app."""
    app.add_route("/metrics", metrics_endpoint, methods=["GET"])
    app.add_route("/api/v1/metrics", metrics_endpoint, methods=["GET"])
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        start_time = time.time()
        
        # Get path for metrics
        path = request.url.path
        
        # Try to use route path if available to avoid cardinality explosion on path params
        # But for starlette middleware, it's tricky to get the exact route path before execution
        
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception:
            status_code = 500
            raise
        finally:
            duration = time.time() - start_time
            
            # Simple route path approximation
            route_path = path
            
            # Get tenant if authenticated (optional, default to unknown)
            tenant = "unknown"
            if hasattr(request.state, "user") and request.state.user:
                tenant = request.state.user.tenant_id
                
            record_http_request(
                method=request.method,
                endpoint=route_path,
                status_code=status_code,
                duration=duration,
                tenant=tenant
            )
            
        return response
