"""
Runtime Config Store
====================
Loads / saves a JSON file so admin-panel changes survive server restarts.

Priority (highest → lowest):
  1. config.json on disk  (written by admin panel)
  2. Environment variables (initial defaults)

The file is written atomically (write temp → rename) to prevent corruption.
Thread-safe: a single threading.Lock guards all reads/writes.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_MARKETS = ["UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT", "INDIA"]
_SCREEN_IDS = [
    "dashboard", "reports", "hitl", "claims", "claim-journey", "accounts", "submit",
    "settings", "master-settings", "admin-console", "admin-settings", "admin-policies",
    "admin-audit", "admin-integrations", "admin-operations",
]


def default_access_groups() -> list[dict[str, Any]]:
    return [
        {
            "id": "claims-admins",
            "name": "System Administrators",
            "description": "Owns platform setup, users, policies, service settings, and operational overrides.",
            "roleScope": ["ADMIN"],
            "marketScope": list(_MARKETS),
            "screenAccess": list(_SCREEN_IDS),
            "isActive": True,
        },
        {
            "id": "claims-operations",
            "name": "Claims Operations",
            "description": "Handles daily adjudication, review queue triage, settlement checks, and due-time follow-up.",
            "roleScope": ["ADJUSTER", "SENIOR_ADJUSTER"],
            "marketScope": ["UAE", "KSA", "INDIA"],
            "screenAccess": ["dashboard", "hitl", "claims", "claim-journey", "accounts", "submit", "settings"],
            "isActive": True,
        },
        {
            "id": "clinical-review",
            "name": "Clinical Review",
            "description": "Reviews medical necessity, policy interpretation, and high-value clinical decisions.",
            "roleScope": ["MEDICAL_DIRECTOR"],
            "marketScope": list(_MARKETS),
            "screenAccess": ["dashboard", "hitl", "claims", "claim-journey", "settings"],
            "isActive": True,
        },
        {
            "id": "compliance-audit",
            "name": "Compliance and Audit",
            "description": "Reviews regulatory exceptions, audit trails, policy governance, and market controls.",
            "roleScope": ["COMPLIANCE_OFFICER"],
            "marketScope": list(_MARKETS),
            "screenAccess": ["dashboard", "reports", "claims", "claim-journey", "settings"],
            "isActive": True,
        },
        {
            "id": "integration-access",
            "name": "Integration Access",
            "description": "Limits service accounts used for exports, intake automation, and reporting connections.",
            "roleScope": ["API_CONSUMER"],
            "marketScope": list(_MARKETS),
            "screenAccess": [],
            "isActive": True,
        },
    ]

# ── File location: same dir as main.py / adjacent to docker volume mount ──────
_CONFIG_PATH = Path(os.getenv("RUNTIME_CONFIG_PATH", "/opt/claims-engine/config.json"))

# Fall back to /tmp for local Docker dev (app root is read-only in container)
if not _CONFIG_PATH.parent.exists():
    _CONFIG_PATH = Path("/tmp/claims_config.json")

_lock = threading.Lock()


def _defaults() -> dict[str, Any]:
    """Build defaults from environment variables (mirrors main.py constants)."""
    _e = os.getenv
    return {
        "access_token_ttl_minutes":  int(_e("ACCESS_TOKEN_TTL_MINUTES") or _e("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60")),
        "refresh_token_ttl_days":    int(_e("REFRESH_TOKEN_TTL_DAYS") or _e("JWT_REFRESH_TOKEN_EXPIRE_DAYS",   "7")),
        "enable_swagger_ui":         _e("ENABLE_SWAGGER_UI",     "false").lower() == "true",
        "enable_demo_endpoints":     _e("ENABLE_DEMO_ENDPOINTS",  "false").lower() == "true",
        "llm_model":                 _e("LLM_MODEL",             "qwen/qwen3-32b"),
        "groq_api_key":              _e("GROQ_API_KEY",          "") or None,
        "anthropic_api_key":         _e("ANTHROPIC_API_KEY",     "") or None,
        "cors_allowed_origins":      [
            o.strip() for o in _e(
                "CORS_ALLOWED_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000"
            ).split(",") if o.strip()
        ],
        "enable_db_persistence":     _e("ENABLE_DB_PERSISTENCE", "true").lower() == "true",
        "redis_url":                 _e("REDIS_URL",             "redis://redis:6379/0"),
        "rate_limit_adjudication":   "30/minute",
        "rate_limit_standard":       "120/minute",
        "rate_limit_health":         "300/minute",
        # ── Adjudication confidence thresholds ──────────────────────────────
        # Scores are 0–100.  Billed amounts are in the claim's native currency.
        "hitl_low_confidence_threshold":    int(_e("HITL_LOW_CONFIDENCE_THRESHOLD",    "80")),
        "hitl_medium_confidence_threshold": int(_e("HITL_MEDIUM_CONFIDENCE_THRESHOLD", "95")),
        "hitl_medium_value_threshold":      int(_e("HITL_MEDIUM_VALUE_THRESHOLD",      "50000")),
        "hitl_high_value_threshold":        int(_e("HITL_HIGH_VALUE_THRESHOLD",        "100000")),
        # ── Two-tier confidence weights ──────────────────────────────────────
        # T1 (regulatory) weight + T2 (company policy) weight must sum to 1.0
        "confidence_weight_t1":  float(_e("CONFIDENCE_WEIGHT_T1", "0.40")),
        "confidence_weight_t2":  float(_e("CONFIDENCE_WEIGHT_T2", "0.60")),
        # ── Multi-Agent Shadow Mode ──────────────────────────────────────────
        # When enabled, Agent C (shadow) runs the same analysis as Agent B independently.
        # If the two agents disagree on regulatory violations → AGENT_CONFLICT HITL trigger.
        "multi_agent_enabled":             _e("MULTI_AGENT_ENABLED",             "true").lower() == "true",
        # ── Dual-Agent Cross-Validation ──────────────────────────────────────
        # Compares RulesEngine (Agent A, deterministic) vs ReasoningEngine (Agent B, LLM).
        # agreement_score = weighted average of per-line verdict matching (0.0–1.0).
        "dual_agent_enabled":              _e("DUAL_AGENT_ENABLED",              "true").lower() == "true",
        "dual_agent_agreement_threshold":  float(_e("DUAL_AGENT_AGREEMENT_THRESHOLD",  "0.98")),
        "dual_agent_conflict_threshold":   float(_e("DUAL_AGENT_CONFLICT_THRESHOLD",   "0.80")),
        # ── Conditional Dual-Agent Execution (Performance Optimization) ──────
        # When enabled, secondary LLM only runs when confidence < threshold OR value > threshold
        "dual_agent_conditional":          _e("DUAL_AGENT_CONDITIONAL",          "true").lower() == "true",
        "dual_agent_confidence_threshold": int(_e("DUAL_AGENT_CONFIDENCE_THRESHOLD",    "80")),
        "dual_agent_value_threshold":      int(_e("DUAL_AGENT_VALUE_THRESHOLD",         "50000")),
        # ── Parallel LLM Execution (Phase 2 Performance Optimization) ────────
        # When enabled, primary + secondary LLMs run in parallel (async) instead of sequential
        # Speedup: 8-10s sequential → 4-5s parallel
        "dual_agent_parallel_enabled":     _e("DUAL_AGENT_PARALLEL_ENABLED",     "true").lower() == "true",
        # ── LLM Master Control ───────────────────────────────────────────────
        # When false: pipeline skips Steps 3 (LLM) and 3b (dual-agent) entirely.
        # Toggle is instant — config is re-read on every adjudication call.
        "llm_enabled":                        _e("LLM_ENABLED", "true").lower() == "true",
        # ── Per-provider toggles ─────────────────────────────────────────────
        # Priority: Local (0th, highest) → Groq (1st) → NVIDIA (2nd) → OpenAI (3rd) → Anthropic (4th)
        # Local: fine-tuned model served via Ollama or vLLM (OpenAI-compatible endpoint)
        # Set LOCAL_LLM_ENABLED=true and LOCAL_LLM_BASE_URL to your serving endpoint.
        "local_llm_enabled":                  _e("LOCAL_LLM_ENABLED",   "false").lower() == "true",
        "local_llm_base_url":                 _e("LOCAL_LLM_BASE_URL",  "http://localhost:11434/v1"),
        "local_llm_model":                    _e("LOCAL_LLM_MODEL",     "claims-adjudicator:latest"),
        # No API key needed for local — set LOCAL_LLM_API_KEY only if your server requires one
        "local_llm_api_key":                  _e("LOCAL_LLM_API_KEY",   "local") or "local",
        # Agent C — second, independent local model (separate vLLM server/port).
        # Keeps Agent C's cross-validation 100% on-device instead of falling back to a cloud
        # provider when the primary agent is already local (see SKILL.md non-negotiable #2).
        "local_llm_secondary_enabled":         _e("LOCAL_LLM_SECONDARY_ENABLED",   "false").lower() == "true",
        "local_llm_secondary_base_url":        _e("LOCAL_LLM_SECONDARY_BASE_URL",  "http://localhost:8001/v1"),
        "local_llm_secondary_model":           _e("LOCAL_LLM_SECONDARY_MODEL",     "claims-adjudicator-secondary:latest"),
        "local_llm_secondary_api_key":         _e("LOCAL_LLM_SECONDARY_API_KEY",   "local") or "local",
        # Genuine LLM-driven tool invocation for the local path (services/reasoning_engine/app/tools.py).
        # OFF by default — additive/opt-in, must not change behavior for the already-verified
        # non-tool dual-agent flow. Requires the vLLM server launched with
        # --enable-auto-tool-choice --tool-call-parser hermes (see deploy/radeon/bootstrap_instance.sh).
        "local_llm_tools_enabled":             _e("LOCAL_LLM_TOOLS_ENABLED", "false").lower() == "true",
        "groq_enabled":                       _e("GROQ_ENABLED",      "true").lower() == "true",
        "nvidia_enabled":                     _e("NVIDIA_ENABLED",    "true").lower() == "true",
        "nvidia_api_key":                     _e("NVIDIA_API_KEY",    "") or None,
        "nvidia_model":                       _e("NVIDIA_MODEL",      "nvidia/llama-3.1-nemotron-ultra-253b-v1"),
        # OpenAI and Anthropic: disabled by default, require API key pasted in admin settings
        "openai_enabled":                     _e("OPENAI_ENABLED",    "false").lower() == "true",
        "openai_api_key":                     _e("OPENAI_API_KEY",    "") or None,
        "openai_model":                       _e("OPENAI_MODEL",      "gpt-4o"),
        "anthropic_enabled":                  _e("ANTHROPIC_ENABLED", "false").lower() == "true",
        "anthropic_model":                    _e("ANTHROPIC_MODEL",   "claude-sonnet-4-5"),
        # ── Claim Approval ───────────────────────────────────────────────────
        "claim_auto_approve_threshold":       float(_e("CLAIM_AUTO_APPROVE_THRESHOLD", "95")),
        "claim_auto_approve_max_amount":      int(_e("CLAIM_AUTO_APPROVE_MAX_AMOUNT",  "50000")),
        "claim_approval_llm_model":           _e("CLAIM_APPROVAL_LLM_MODEL", "qwen/qwen3-32b"),
        "claim_auto_approve_thresholds_by_market": {
            "UAE":   {"currency": "AED", "max_amount": int(_e("CLAIM_AUTO_APPROVE_MAX_AMOUNT_UAE", "50000"))},
            "INDIA": {"currency": "INR", "max_amount": int(_e("CLAIM_AUTO_APPROVE_MAX_AMOUNT_INDIA", "1000000"))},
            "KSA":   {"currency": "SAR", "max_amount": int(_e("CLAIM_AUTO_APPROVE_MAX_AMOUNT_KSA", "50000"))},
        },
        # ── Chat Assistance Controls ─────────────────────────────────────────
        "chat_assistant_enabled":              _e("CHAT_ASSISTANT_ENABLED", "true").lower() == "true",
        "chat_assistant_roles": [
            role.strip().upper()
            for role in _e(
                "CHAT_ASSISTANT_ROLES",
                "ADMIN,ADJUSTER,SENIOR_ADJUSTER,MEDICAL_DIRECTOR,COMPLIANCE_OFFICER",
            ).split(",") if role.strip()
        ],
        "chat_assistant_markets": [
            market.strip().upper()
            for market in _e(
                "CHAT_ASSISTANT_MARKETS",
                "UAE,INDIA,KSA,BAHRAIN,OMAN,QATAR,KUWAIT",
            ).split(",") if market.strip()
        ],
        "chat_assistant_variant":              _e("CHAT_ASSISTANT_VARIANT", "dashboard-copilot").strip().lower() or "dashboard-copilot",
        # ── SLA Controls ─────────────────────────────────────────────────────
        "sla_settings_by_market": {
            "UAE":   {"enabled": True, "hours": int(_e("SLA_HOURS_UAE", "8"))},
            "INDIA": {"enabled": True, "hours": int(_e("SLA_HOURS_INDIA", "12"))},
            "KSA":   {"enabled": True, "hours": int(_e("SLA_HOURS_KSA", "8"))},
        },
        # ── Tax / VAT rates ──────────────────────────────────────────────────
        "vat_rate_uae":                       float(_e("VAT_RATE_UAE",   "5.0")),
        "vat_rate_ksa":                       float(_e("VAT_RATE_KSA",   "15.0")),
        "gst_rate_india":                     float(_e("GST_RATE_INDIA", "0.0")),
        "india_consumables_gst_pct":          float(_e("INDIA_CONSUMABLES_GST_PCT", "12.0")),
        "india_tds_rate_pct":                 float(_e("INDIA_TDS_RATE_PCT", "10.0")),
        "india_zonal_copay_pct":              int(_e("INDIA_ZONAL_COPAY_PCT", "0")),
        # ── Rules Engine Configurable Parameters ─────────────────────────────
        # GCC Market
        "re_gcc_copay_in_network_pct":        int(_e("RE_GCC_COPAY_IN_NETWORK_PCT",        "10")),
        "re_gcc_copay_out_of_network_pct":    int(_e("RE_GCC_COPAY_OUT_NETWORK_PCT",        "20")),
        "re_gcc_copay_direct_billing_pct":    int(_e("RE_GCC_COPAY_DIRECT_BILLING_PCT",     "0")),
        "re_gcc_drg_threshold":               int(_e("RE_GCC_DRG_THRESHOLD",               "30000")),
        "re_preauth_penalty_pct":             int(_e("RE_PREAUTH_PENALTY_PCT",              "30")),
        # India Market
        "re_india_room_rent_limit_pct":       float(_e("RE_INDIA_ROOM_RENT_LIMIT_PCT",     "1.0")),
        "re_india_icu_rent_limit_pct":        float(_e("RE_INDIA_ICU_RENT_LIMIT_PCT",      "2.0")),
        "re_india_ayush_min_days":            int(_e("RE_INDIA_AYUSH_MIN_DAYS",            "1")),
        "re_india_domiciliary_min_days":      int(_e("RE_INDIA_DOMICILIARY_MIN_DAYS",      "3")),
        # ── Async Processing (Performance Optimization) ───────────────────────────
        # When enabled, LLM reasoning and settlement calculation run in parallel via asyncio.gather()
        # Total time = max(llm_time, settlement_time) instead of sum(llm_time, settlement_time)
        # Typical speedup: 15-20 seconds → 8-10 seconds for claims with LLM enabled
        "async_processing_enabled":           _e("ASYNC_PROCESSING_ENABLED", "true").lower() == "true",
        # ── Membership DB Sync (MVP Scaffold) ────────────────────────────────
        "membership_sync_configs": {
            "UAE": {"enabled": False, "endpoint_url": "", "auth_token": ""},
            "INDIA": {"enabled": False, "endpoint_url": "", "auth_token": ""},
            "KSA": {"enabled": False, "endpoint_url": "", "auth_token": ""}
        },
        # ── Clause Filtering (Performance Optimization) ───────────────────────────
        # Reduces LLM prompt size by ~60-70% (35 clauses → 10) by filtering to
        # only the most relevant clauses based on claim diagnosis + procedures.
        # Saves 3-5 seconds per LLM call + reduces token costs.
        "clause_filtering_enabled":           _e("CLAUSE_FILTERING_ENABLED", "true").lower() == "true",
        "max_clauses_per_tier":               int(_e("MAX_CLAUSES_PER_TIER", "5")),
        # ── LLM Response Cache (Performance Optimization) ─────────────────────────
        # Redis-backed cache for duplicate/similar claims (15-20s savings, 60-70% hit rate expected)
        # Cache key based on claim signature: type + diagnosis + procedures + market + policy clauses
        # Graceful fallback if Redis unavailable
        "llm_cache_enabled":                  _e("LLM_CACHE_ENABLED", "true").lower() == "true",
        "llm_cache_ttl_hours":                int(_e("LLM_CACHE_TTL_HOURS", "24")),
        # ── Claim-time LLM latency guard ─────────────────────────────────────────
        # Claim adjudication must stay fast even when a configured LLM provider is
        # slow, unreachable, or using a bad key. Keep retries conservative here;
        # provider health checks can use deeper diagnostics separately.
        "llm_request_timeout_seconds":        float(_e("LLM_REQUEST_TIMEOUT_SECONDS", "2.0")),
        # Separate, much more generous default for local providers — 2s is
        # tuned for fast cloud APIs (Groq) and is not survivable for local
        # vLLM inference at unoptimized baseline speed (a full two-tier
        # response can take several minutes; measured up to ~510s on the
        # Radeon instance 2026-07-24). 300s comfortably covers realistic
        # cases without silently failing most local calls; Phase 3
        # optimization work should bring real latency down well under this,
        # not the other way around. See SKILL.md §5/§6.
        "local_llm_request_timeout_seconds":  float(_e("LOCAL_LLM_REQUEST_TIMEOUT_SECONDS", "300.0")),
        "llm_max_retries":                    int(_e("LLM_MAX_RETRIES", "1")),
        "llm_retry_base_delay_seconds":       float(_e("LLM_RETRY_BASE_DELAY_SECONDS", "0.25")),
        # ── Rules-first advisory LLM mode ────────────────────────────────────────
        # Normal claims should finish with deterministic rules + settlement only.
        # LLM runs only when a claim has ambiguity/complexity signals or a reviewer
        # explicitly requests AI re-verification.
        "llm_advisory_only":                  _e("LLM_ADVISORY_ONLY", "true").lower() == "true",
        "llm_run_on_routine_claims":          _e("LLM_RUN_ON_ROUTINE_CLAIMS", "false").lower() == "true",
        "llm_advisory_value_threshold":       int(_e("LLM_ADVISORY_VALUE_THRESHOLD", "50000")),
        "llm_advisory_line_item_threshold":   int(_e("LLM_ADVISORY_LINE_ITEM_THRESHOLD", "5")),
        "llm_advisory_ocr_confidence_floor":  float(_e("LLM_ADVISORY_OCR_CONFIDENCE_FLOOR", "0.85")),
        # ── Adaptive LLM Model Selection (Performance + Quality Optimization) ─────
        # Smart routing: simple claims → Groq (fast/free), complex claims → NVIDIA (quality)
        # Reduces costs by 75% while maintaining quality on complex claims
        "llm_model_selection_adaptive":       _e("LLM_MODEL_SELECTION_ADAPTIVE", "true").lower() == "true",
        "llm_complexity_threshold":           int(_e("LLM_COMPLEXITY_THRESHOLD", "5")),
        "access_groups":                      default_access_groups(),
    }


# ── In-process cache (avoid file I/O on every request) ─────────────────────────
_cache: dict[str, Any] | None = None


_API_KEY_FIELDS = {
    "groq_api_key", "nvidia_api_key", "openai_api_key", "anthropic_api_key",
}


def load() -> dict[str, Any]:
    """Return the current config (file → defaults merge, cached)."""
    global _cache
    with _lock:
        if _cache is not None:
            return dict(_cache)
        cfg = _defaults()
        if _CONFIG_PATH.exists():
            try:
                on_disk = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
                for k, v in on_disk.items():
                    # Never let a null/empty disk value overwrite a real API key
                    # that was already sourced from the environment variable.
                    if k in _API_KEY_FIELDS and not v and cfg.get(k):
                        continue
                    cfg[k] = v
            except Exception as exc:
                logger.warning("config_store: failed to read %s: %s", _CONFIG_PATH, exc)
        _cache = cfg
        return dict(cfg)


def _load_no_lock() -> dict[str, Any]:
    """Internal: load without acquiring the lock (caller holds it)."""
    cfg = _defaults()
    if _CONFIG_PATH.exists():
        try:
            on_disk = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
            cfg.update(on_disk)
        except Exception:
            pass
    return cfg


def save(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge *patch* into current config, persist to disk, invalidate cache. Returns the updated full config."""
    global _cache
    with _lock:
        cfg = _load_no_lock()
        cfg.update(patch)
        _write_atomic(cfg)
        _cache = cfg
        return dict(cfg)


def _write_atomic(cfg: dict[str, Any]) -> None:
    """Write config to a temp file then rename — prevents partial writes."""
    try:
        _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=_CONFIG_PATH.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, default=str)
            os.replace(tmp, _CONFIG_PATH)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:
        logger.error("config_store: failed to write %s: %s", _CONFIG_PATH, exc)
        raise


def invalidate() -> None:
    """Force a reload from disk on the next load() call."""
    global _cache
    with _lock:
        _cache = None


def mask_secret(value: str | None) -> str | None:
    """Return a masked version: 'sk-abc...xyz' → 'sk-abc••••••••xyz'"""
    if not value:
        return None
    if len(value) <= 8:
        return "••••••••"
    return value[:4] + "••••••••" + value[-4:]
