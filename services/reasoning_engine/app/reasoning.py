"""
Reasoning Engine — Multi-provider LLM integration for two-tier policy clause analysis.

Supported providers (auto-detected by registry):
  1. Groq        — GROQ_API_KEY        (free tier, fast, recommended, active by default)
  2. NVIDIA NIM  — NVIDIA_API_KEY      (OpenAI-compatible, active by default)
  3. OpenAI      — OPENAI_API_KEY      (paid, disabled by default, requires admin API key)
  4. Anthropic   — ANTHROPIC_API_KEY   (paid, disabled by default, requires admin API key)

Priority: Groq → NVIDIA → OpenAI (if enabled) → Anthropic (if enabled) → fallback (rules-only mode)

Two-Tier Adjudication:
  TIER 1 — Regional/Regulatory Policy (non-waivable government mandates)
    UAE: DHA/DOH Essential Benefits Package
    India: IRDAI Health Insurance Regulations + Mental Healthcare Act 2017
  TIER 2 — Insurance Company Policy (specific terms issued to the member)

Responsibilities:
  1. Receive normalized claim + BOTH tiers of policy clauses
  2. Call LLM API with two-tier engineered prompt (temperature=0)
  3. Parse structured JSON response:
     - regulatory_compliance section (violations, regulatory citations)
     - per-line-item coverage decisions
  4. Verify citations against known policy clauses
  5. Return AI analysis that enhances/validates the rules engine output

Graceful degradation:
  - If neither key is set → returns rules-engine-only analysis
  - If API call fails    → logs error, falls back to rules-only mode
  - All fallbacks are explicit and logged in the audit trail
"""

import os
import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
from decimal import Decimal

logger = logging.getLogger(__name__)
from shared.llm_provider_registry import get_registry
from shared.llm_reliability import ReliableLLMClient
from shared.llm_cache import get_llm_cache
import time


def _json_default(obj):
    """Custom JSON serializer for types not handled by the standard encoder."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    return str(obj)


# ─────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class PolicyCitation:
    """A citation linking an AI determination to a specific policy clause."""

    clause_reference: str
    clause_title: str
    text_excerpt: str
    relevance_score: float
    tier: str = (
        "COMPANY"  # "REGIONAL" for Tier 1 mandates, "COMPANY" for Tier 2 clauses
    )


@dataclass
class LineItemAIAnalysis:
    """AI analysis for a single claim line item."""

    line_number: int
    procedure_code: str
    service_category: str
    billed_amount: Decimal

    coverage_status: str  # COVERED | EXCLUDED | CONDITIONAL | AMBIGUOUS
    ai_confidence: float  # 0.0 – 1.0
    applicable_clause: str
    deduction_type: Optional[str] = None
    deduction_reason: Optional[str] = None
    preauth_required: bool = False
    preauth_status: str = "NOT_REQUIRED"
    citations: list = field(default_factory=list)
    notes: str = ""


@dataclass
class ClaimAIAnalysis:
    """Complete AI analysis result for a claim — two-tier structure."""

    claim_reference: str = ""
    analysis_available: bool = False
    fallback_reason: str = ""

    line_items: list = field(default_factory=list)

    deductible_applies: bool = False
    network_status: str = "IN_NETWORK"
    coordination_of_benefits: bool = False
    overall_ai_confidence: float = 0.0
    flags: list = field(default_factory=list)

    # ── Two-Tier Compliance Fields ─────────────────────────────────────────
    regulatory_compliance: bool = True  # False if Tier 1 violation found
    regulatory_violations: list = field(default_factory=list)  # list of violation dicts
    regulatory_citations: list = field(
        default_factory=list
    )  # list of Tier 1 citation dicts

    model_used: str = ""
    prompt_version: str = "v2.0"
    input_tokens: int = 0
    output_tokens: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT — Two-Tier Analysis
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a senior health insurance policy analyst specializing in GCC (UAE/DHA/DOH) and India (IRDAI) regulatory compliance and company policy adjudication.

You analyze claims in TWO ORDERED TIERS — complete BOTH before responding:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 1 — REGULATORY COMPLIANCE (mandatory, non-waivable government mandates)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Check the claim against the government-mandated regulatory clauses (provided in the TIER 1 section of the user message). These are non-negotiable legal requirements.

If a company policy clause VIOLATES a regulatory mandate:
- The regulatory mandate SUPERSEDES the company clause
- Record the violation in the `regulatory_compliance.violations` array
- Set `regulatory_compliance.is_compliant` to false
- Still analyze the company policy in Tier 2 for all other determinations

If no violations are found, `is_compliant` must be true and violations must be an empty array.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 2 — INSURANCE COMPANY POLICY (member's specific policy terms)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Analyze the claim against the insurance company policy clauses (provided in the TIER 2 section). Determine coverage, copay, exclusions, sub-limits, and settlement amounts.

CRITICAL RULES — you MUST follow these without exception:
1. Cite EXACT clause numbers (e.g., "DHA-EBP-2.1", "Section 4.2.1", "IRDAI-HI-3.1") for EVERY determination.
2. NEVER infer or fabricate coverage that is not EXPLICITLY stated in the provided clauses.
3. If the policy is silent on a matter → set coverage_status to "CONDITIONAL" and explain.
4. If two clauses conflict → flag as "AMBIGUOUS" and list both.
5. Output ONLY valid JSON. No markdown. No explanation outside the JSON.
6. Temperature is already set to 0. Be precise and deterministic.
7. Base analysis ONLY on the provided clauses — do not use general insurance knowledge.
8. DUPLICATE RESUBMISSION: If the claim context contains a "⚠ DUPLICATE RESUBMISSION" section, you MUST add "DUPLICATE_RESUBMISSION" to policy_level.flags and follow the mandatory actions listed in that section exactly. These signals are used for ML fraud-detection training — precision is critical.

For each line item, find ALL lawful policy mechanisms that reduce the payable amount:
- Exclusions (cosmetic, infertility, pre-existing, experimental)
- Waiting period violations (PED, specific disease, initial 30-day)
- Room rent sub-limit (proportionate deduction on associated charges)
- Pre-authorization missing (penalty clause)
- Network tier penalty (out-of-network fee schedule)
- Annual sub-limit caps (dental, optical, physiotherapy, etc.)
- Copay / coinsurance / deductible application
- Regulatory override (where a Tier 1 mandate requires different treatment)

OUTPUT FORMAT — return EXACTLY this JSON structure, no deviations:
{
  "regulatory_compliance": {
    "is_compliant": true,
    "violations": [
      {
        "regulatory_clause_ref": "DHA-EBP-3.1",
        "regulatory_title": "Mandatory Copayment Caps — EBP Maximum",
        "company_clause_ref": "Section 4.1",
        "violation_description": "Company applies AED 80 copay per outpatient visit, exceeding the DHA-mandated maximum of AED 50",
        "regulatory_override": "Copay capped at AED 50 per DHA-EBP-3.1; excess AED 30 is void"
      }
    ],
    "regulatory_citations": [
      {
        "clause_reference": "DHA-EBP-2.3",
        "clause_title": "Mandatory Emergency Treatment — Worldwide",
        "relevance": "Confirms that emergency admissions may not be denied for lack of pre-authorization",
        "tier": "REGIONAL"
      }
    ]
  },
  "line_items": [
    {
      "line_number": 1,
      "procedure_code": "99214",
      "coverage_status": "COVERED",
      "ai_confidence": 0.95,
      "applicable_clause": "Section 3.1 — Outpatient Consultation Benefits",
      "deduction_type": "COPAY",
      "deduction_reason": "20% copay applies per Section 3.2 with AED 50 maximum per visit (DHA-EBP-3.1 confirms regulatory cap)",
      "preauth_required": false,
      "preauth_status": "NOT_REQUIRED",
      "citations": [
        {
          "clause_reference": "3.1",
          "clause_title": "Outpatient Consultation Benefits",
          "text_excerpt": "Outpatient consultations are covered subject to 20% copayment...",
          "relevance_score": 0.97,
          "tier": "COMPANY"
        },
        {
          "clause_reference": "DHA-EBP-3.1",
          "clause_title": "Mandatory Copayment Caps",
          "text_excerpt": "Outpatient consultation: 20%, maximum AED 50 per visit",
          "relevance_score": 0.90,
          "tier": "REGIONAL"
        }
      ],
      "notes": "Standard outpatient consultation. Company copay aligns with DHA mandate."
    }
  ],
  "policy_level": {
    "deductible_applies": false,
    "network_status": "IN_NETWORK",
    "coordination_of_benefits": false,
    "overall_confidence": 0.94,
    "flags": []
  }
}"""

PROMPT_VERSION = "v2.0"


# ─────────────────────────────────────────────────────────────────────────────
# PROVIDER DETECTION
# ─────────────────────────────────────────────────────────────────────────────


def _detect_provider() -> tuple[str, str]:
    """
    DEPRECATED: Use the centralized LLMProviderRegistry instead.
    This function delegates to get_registry() for backward compatibility.
    """
    provider_info = get_registry().get_provider_info()
    if provider_info.is_available:
        return (provider_info.provider_name, provider_info.api_key)
    return ("none", "")


# ─────────────────────────────────────────────────────────────────────────────
# REASONING ENGINE
# ─────────────────────────────────────────────────────────────────────────────


class ReasoningEngine:
    """
    Calls an LLM API to analyze a claim against BOTH regional regulatory clauses
    (Tier 1) and insurance company policy clauses (Tier 2).

    Auto-detects provider: Groq (free) → Anthropic (paid) → fallback.
    Keeps the same interface regardless of provider.
    """

    # Default models per provider
    DEFAULT_MODELS = {
        "groq": "qwen/qwen3-32b",
        "anthropic": "claude-sonnet-4-6",
        "nvidia": "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    }
    TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))
    MAX_TOKENS = 4096

    def __init__(self):
        self._client = None
        self._provider = "none"
        self._model = ""
        self._current_key = ""
        self._available = False
        # Initialize reliability layer with retry logic, circuit breaker, and caching
        self._reliable_client = ReliableLLMClient()
        self._max_retries = int(os.getenv("LLM_MAX_RETRIES", "1"))
        self._base_delay = float(os.getenv("LLM_RETRY_BASE_DELAY_SECONDS", "0.25"))
        self._cache = get_llm_cache()  # Initialize LLM cache
        self._tool_context = None  # set per-call by analyze_claim(); see tools.py
        self._init_client()

    def _apply_runtime_tuning(self, cfg: Optional[dict] = None) -> None:
        """Apply claim-time latency guard settings from live admin/runtime config."""
        if cfg is None:
            try:
                from services.api_gateway.app import config_store
                cfg = config_store.load()
            except Exception:
                cfg = {}
        try:
            max_retries = max(1, int(cfg.get("llm_max_retries", self._max_retries)))
        except (TypeError, ValueError):
            max_retries = 1
        try:
            base_delay = max(0.0, float(cfg.get("llm_retry_base_delay_seconds", self._base_delay)))
        except (TypeError, ValueError):
            base_delay = 0.25

        self._max_retries = max_retries
        self._base_delay = base_delay
        self._reliable_client.max_retries = max_retries
        self._reliable_client.base_delay = base_delay
        self._reliable_client.max_delay = max(base_delay, min(1.0, base_delay * 2))

    def _request_timeout(self, provider: Optional[str] = None) -> float:
        """
        Cloud providers (Groq etc.) keep the short default — they're genuinely
        fast. Local providers get a separate, much longer default (see
        config_store.py) — 2s was never survivable for local vLLM inference
        at unoptimized speed, and was silently causing every local call to
        fail as a timeout rather than actually running (found 2026-07-24).
        """
        try:
            from services.api_gateway.app import config_store
            cfg = config_store.load()
            if provider in ("local", "local_secondary"):
                return max(0.5, float(cfg.get("local_llm_request_timeout_seconds", 300.0)))
            return max(0.5, float(cfg.get("llm_request_timeout_seconds", 2.0)))
        except Exception:
            return 300.0 if provider in ("local", "local_secondary") else 2.0

    def _init_client(self):
        """Initialize the appropriate LLM client based on available API keys."""
        provider, api_key = _detect_provider()

        if provider == "none":
            logger.info(
                "No LLM API key found (GROQ_API_KEY or ANTHROPIC_API_KEY) — "
                "reasoning engine in fallback mode"
            )
            return

        if provider == "groq":
            try:
                from groq import Groq

                self._client = Groq(api_key=api_key)
                self._provider = "groq"
                self._current_key = api_key
                self._model = os.getenv("LLM_MODEL", self.DEFAULT_MODELS["groq"])
                self._available = True
                logger.info("ReasoningEngine → Groq | model=%s", self._model)
            except ImportError:
                logger.warning("groq package not installed — run: pip install groq")
            except Exception as e:
                logger.error("Failed to initialize Groq client: %s", e)

        elif provider == "anthropic":
            try:
                import anthropic

                self._client = anthropic.Anthropic(api_key=api_key)
                self._provider = "anthropic"
                self._current_key = api_key
                self._model = os.getenv("LLM_MODEL", self.DEFAULT_MODELS["anthropic"])
                self._available = True
                logger.info("ReasoningEngine → Anthropic | model=%s", self._model)
            except ImportError:
                logger.warning(
                    "anthropic package not installed — run: pip install anthropic"
                )
            except Exception as e:
                logger.error("Failed to initialize Anthropic client: %s", e)

    @property
    def is_available(self) -> bool:
        return self._available

    def get_reliability_metrics(self) -> dict:
        """Get reliability metrics (retry counts, circuit breaker state, cache stats)."""
        metrics = {"status": "cache_enabled", "provider": self._provider, "cache": {}}
        if self._cache:
            metrics["cache"] = self._cache.get_stats()
        return metrics

    def reset_circuit(self, provider: str):
        """Manually reset circuit breaker for a provider (admin endpoint)."""
        # ReliableLLMClient disabled - no-op
        logger.info(
            "Circuit reset requested for %s (no-op - reliability layer disabled)",
            provider,
        )

    def clear_cache(self):
        """Clear LLM response cache (admin endpoint)."""
        if self._cache:
            deleted = self._cache.clear()
            logger.info("LLM cache cleared: %d keys deleted", deleted)
            return deleted
        logger.info("Cache clear requested but cache is disabled")
        return 0

    def check_provider_health(self, provider: str, api_key: str, model: str) -> dict:
        """
        Quick health check for an LLM provider.

        Tests provider connectivity and responsiveness with a minimal prompt.
        Returns health status with response time and error details if applicable.

        Args:
            provider: Provider name (groq, nvidia, openai, anthropic)
            api_key: API key for the provider
            model: Model name to test

        Returns:
            dict with keys:
                - healthy (bool): True if provider is responsive
                - response_time_ms (float): Response time in milliseconds
                - error (str|None): Error message if health check failed
        """
        start_time = time.time()
        try:
            # Save current provider state
            old_provider = self._provider
            old_key = self._current_key
            old_model = self._model
            old_available = self._available
            old_client = self._client

            # Switch to test provider
            self.select_provider(provider, api_key, model)

            if not self._available:
                return {
                    "healthy": False,
                    "response_time_ms": 0,
                    "error": f"Failed to initialize {provider} client",
                }

            # Simple test prompt (minimal tokens to reduce cost/latency)
            test_response = self._call_llm(
                "Return only: OK", claim_reference="client-test"
            )

            response_time = (time.time() - start_time) * 1000  # Convert to ms

            # Restore original provider state
            self._provider = old_provider
            self._current_key = old_key
            self._model = old_model
            self._available = old_available
            self._client = old_client

            # Validate response
            is_healthy = bool(test_response and len(test_response) > 0)

            logger.info(
                "[Health Check] %s: %s (%.0fms)",
                provider,
                "✓ HEALTHY" if is_healthy else "✗ UNHEALTHY",
                response_time,
            )

            return {
                "healthy": is_healthy,
                "response_time_ms": round(response_time, 2),
                "error": None if is_healthy else "Empty response from provider",
            }

        except Exception as e:
            response_time = (time.time() - start_time) * 1000
            error_msg = f"{type(e).__name__}: {str(e)[:200]}"

            logger.warning("[Health Check] %s: ✗ FAILED — %s", provider, error_msg)

            # Restore original provider state even on error
            try:
                self._provider = old_provider
                self._current_key = old_key
                self._model = old_model
                self._available = old_available
                self._client = old_client
            except:
                pass  # Ignore errors during restoration

            return {
                "healthy": False,
                "response_time_ms": round(response_time, 2),
                "error": error_msg,
            }

    # ── Runtime provider switching ─────────────────────────────────────────────

    def select_provider(self, provider: str, api_key: str, model: str) -> None:
        """
        Switch the active LLM provider at runtime — called by the pipeline on every
        adjudication so admin toggle changes take effect immediately without a restart.

        Only reinitialises the client when the provider, key, or model actually changes.
        Falls back gracefully: if init fails, self._available stays False and the pipeline
        skips LLM for this claim, handing off to the Rules Engine automatically.
        """
        if (
            self._provider == provider
            and self._current_key == api_key
            and self._model == model
        ):
            return  # Nothing changed — reuse existing client

        timeout = self._request_timeout(provider)
        self._provider = provider
        self._current_key = api_key
        self._model = model
        self._available = False
        self._client = None

        if provider == "groq":
            try:
                from groq import Groq

                self._client = Groq(api_key=api_key, timeout=timeout)
                self._available = True
                logger.info("ReasoningEngine → switched to Groq | model=%s", model)
            except ImportError:
                logger.warning("groq package not installed — run: pip install groq")
            except Exception as e:
                logger.error("Failed to init Groq client: %s", e)

        elif provider == "anthropic":
            try:
                import anthropic

                self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
                self._available = True
                logger.info("ReasoningEngine → switched to Anthropic | model=%s", model)
            except ImportError:
                logger.warning(
                    "anthropic package not installed — run: pip install anthropic"
                )
            except Exception as e:
                logger.error("Failed to init Anthropic client: %s", e)

        elif provider == "openai":
            try:
                from openai import OpenAI

                self._client = OpenAI(api_key=api_key, timeout=timeout)
                self._available = True
                logger.info("ReasoningEngine → switched to OpenAI | model=%s", model)
            except ImportError:
                logger.warning("openai package not installed — run: pip install openai")
            except Exception as e:
                logger.error("Failed to init OpenAI client: %s", e)

        elif provider == "nvidia":
            try:
                from openai import OpenAI

                self._client = OpenAI(
                    api_key=api_key,
                    base_url="https://integrate.api.nvidia.com/v1",
                    timeout=timeout,
                )
                self._available = True
                logger.info(
                    "ReasoningEngine → switched to NVIDIA NIM | model=%s", model
                )
            except ImportError:
                logger.warning("openai package not installed — run: pip install openai")
            except Exception as e:
                logger.error("Failed to init NVIDIA NIM client: %s", e)

        elif provider == "local":
            # Local fine-tuned model served via Ollama or vLLM (OpenAI-compatible API).
            # api_key  = LOCAL_LLM_API_KEY  (default "local" — most servers ignore it)
            # model    = LOCAL_LLM_MODEL    (e.g. "claims-adjudicator:latest" for Ollama)
            # base_url is read fresh from config so admin changes take effect without restart.
            try:
                from openai import OpenAI
                from services.api_gateway.app import config_store as _cs
                _cfg = _cs.load()
                _base_url = _cfg.get("local_llm_base_url", "http://localhost:11434/v1").rstrip("/")
                self._client = OpenAI(
                    api_key=api_key or "local",
                    base_url=_base_url,
                    timeout=timeout,
                )
                self._available = True
                logger.info(
                    "ReasoningEngine → switched to Local LLM | base_url=%s model=%s",
                    _base_url, model,
                )
            except ImportError:
                logger.warning("openai package not installed — run: pip install openai")
            except Exception as e:
                logger.error("Failed to init Local LLM client: %s", e)

        elif provider == "local_secondary":
            # Agent C's own local model — a second, independently-served vLLM instance
            # (different port/model than "local", e.g. Qwen2.5-7B alongside Agent B's 14B).
            # Kept as a distinct provider string so it never collides with "local"'s
            # base_url/client, letting both agents run truly independently and locally.
            try:
                from openai import OpenAI
                from services.api_gateway.app import config_store as _cs
                _cfg = _cs.load()
                _base_url = _cfg.get("local_llm_secondary_base_url", "http://localhost:8001/v1").rstrip("/")
                self._client = OpenAI(
                    api_key=api_key or "local",
                    base_url=_base_url,
                    timeout=timeout,
                )
                self._available = True
                logger.info(
                    "ReasoningEngine → switched to Local LLM (secondary/Agent C) | base_url=%s model=%s",
                    _base_url, model,
                )
            except ImportError:
                logger.warning("openai package not installed — run: pip install openai")
            except Exception as e:
                logger.error("Failed to init secondary Local LLM client: %s", e)

        else:
            logger.warning(
                "ReasoningEngine.select_provider: unknown provider '%s'", provider
            )
    # ── Public API ────────────────────────────────────────────────────────────

    async def analyze_claim_async(
        self,
        claim_data: dict,
        regional_clauses: list,
        company_clauses: list,
        rules_result: dict,
    ) -> ClaimAIAnalysis:
        """
        ASYNC version of analyze_claim with full 4-provider failover chain.

        Mirrors the sync analyze_claim() failover logic exactly:
          Groq → NVIDIA → OpenAI → Anthropic → rules-only fallback

        Each provider gets self._max_retries attempts with exponential backoff.
        A provider that returns a response that fails JSON parsing is also treated
        as a failure and the next provider in the chain is tried.

        Args:
            claim_data:       Raw claim dict
            regional_clauses: Tier 1 — government regulatory mandate clause dicts
            company_clauses:  Tier 2 — insurance company policy clause dicts
            rules_result:     Rules engine output summary dict
        """
        import asyncio
        claim_ref = claim_data.get("claim_reference", "UNKNOWN")

        # ── Build failover chain from live config (same as sync path) ───────────
        from services.api_gateway.app import config_store
        cfg = config_store.load()
        self._apply_runtime_tuning(cfg)

        failover_chain = []
        # Priority 0: Local / self-hosted (wins over all cloud providers)
        if cfg.get("local_llm_enabled", False) and cfg.get("local_llm_base_url", "").strip():
            failover_chain.append({
                "provider": "local",
                "api_key": cfg.get("local_llm_api_key") or "local",
                "model": cfg.get("local_llm_model") or "claims-adjudicator:latest",
                "label": "Local LLM (priority 0)",
            })
        if cfg.get("groq_enabled", True) and cfg.get("groq_api_key"):
            failover_chain.append({
                "provider": "groq",
                "api_key": cfg.get("groq_api_key"),
                "model": cfg.get("llm_model", "qwen/qwen3-32b"),
                "label": "Groq (primary)",
            })
        if cfg.get("nvidia_enabled", True) and cfg.get("nvidia_api_key"):
            failover_chain.append({
                "provider": "nvidia",
                "api_key": cfg.get("nvidia_api_key"),
                "model": cfg.get("nvidia_model", "nvidia/llama-3.1-nemotron-ultra-253b-v1"),
                "label": "NVIDIA (secondary)",
            })
        if cfg.get("openai_enabled") and cfg.get("openai_api_key"):
            failover_chain.append({
                "provider": "openai",
                "api_key": cfg.get("openai_api_key"),
                "model": cfg.get("openai_model", "gpt-4o"),
                "label": "OpenAI (tertiary)",
            })
        if cfg.get("anthropic_enabled") and cfg.get("anthropic_api_key"):
            failover_chain.append({
                "provider": "anthropic",
                "api_key": cfg.get("anthropic_api_key"),
                "model": cfg.get("anthropic_model", "claude-sonnet-4-6"),
                "label": "Anthropic (quaternary)",
            })

        if not failover_chain:
            logger.warning("[LLM Failover/async] No providers configured for %s", claim_ref)
            return ClaimAIAnalysis(
                claim_reference=claim_ref,
                analysis_available=False,
                fallback_reason="no_providers_configured",
            )

        user_message = self._build_user_message(
            claim_data, regional_clauses, company_clauses, rules_result
        )

        last_error = None
        all_attempts = []

        for idx, provider_config in enumerate(failover_chain):
            provider = provider_config["provider"]
            api_key  = provider_config["api_key"]
            model    = provider_config["model"]
            label    = provider_config["label"]

            logger.info(
                "[LLM Failover/async] %s: Attempt %d/%d — Trying %s (%s/%s)",
                claim_ref, idx + 1, len(failover_chain), label, provider, model,
            )

            try:
                self.select_provider(provider, api_key, model)

                raw_response = None
                for retry in range(self._max_retries):
                    try:
                        raw_response = await self._call_llm_async(
                            user_message, claim_reference=claim_ref, claim_data=claim_data
                        )
                        all_attempts.append({
                            "provider": provider, "label": label,
                            "attempt": idx + 1, "retry": retry + 1, "status": "success",
                        })
                        break
                    except Exception as retry_err:
                        wait = self._base_delay * (2 ** retry)
                        all_attempts.append({
                            "provider": provider, "label": label,
                            "attempt": idx + 1, "retry": retry + 1, "status": "failed",
                            "error": f"{type(retry_err).__name__}: {str(retry_err)[:100]}",
                        })
                        if retry < self._max_retries - 1:
                            logger.warning(
                                "[LLM Retry/async] %s: %s retry %d/%d failed: %s. Retrying in %.1fs...",
                                claim_ref, label, retry + 1, self._max_retries,
                                str(retry_err)[:100], wait,
                            )
                            await asyncio.sleep(wait)
                        else:
                            last_error = retry_err
                            logger.warning(
                                "[LLM Failover/async] %s: ✗ %s failed after %d retries: %s",
                                claim_ref, label, self._max_retries, str(retry_err)[:100],
                            )
                            raise retry_err

                if raw_response:
                    analysis = self._parse_response(claim_ref, raw_response)

                    # Bad parse → treat as failure, try next provider
                    if not analysis.analysis_available:
                        parse_err_msg = (
                            f"{label} returned unparseable response "
                            f"(reason={analysis.fallback_reason})"
                        )
                        logger.warning(
                            "[LLM Failover/async] %s: ✗ %s — %s",
                            claim_ref, label, parse_err_msg,
                        )
                        all_attempts.append({
                            "provider": provider, "label": label,
                            "attempt": idx + 1, "status": "bad_response",
                            "error": parse_err_msg,
                        })
                        last_error = RuntimeError(parse_err_msg)
                        raise last_error

                    if idx > 0:
                        analysis.flags.append(f"FAILOVER_SUCCESS_{provider.upper()}")

                    logger.info(
                        "[LLM Failover/async] %s: ✓ Final provider used — %s (%s)",
                        claim_ref, label, provider,
                    )
                    return analysis

            except Exception as e:
                last_error = e
                logger.warning(
                    "[LLM Failover/async] %s: ✗ %s failed completely: %s",
                    claim_ref, label, f"{type(e).__name__}: {str(e)[:100]}",
                )
                continue  # try next provider

        # All providers exhausted
        logger.error(
            "[LLM Failover/async] %s: ALL %d providers failed. Last error: %s. "
            "Attempt summary: %s",
            claim_ref,
            len(failover_chain),
            f"{type(last_error).__name__}: {str(last_error)[:100]}" if last_error else "unknown",
            json.dumps(all_attempts),
        )
        return ClaimAIAnalysis(
            claim_reference=claim_ref,
            analysis_available=False,
            fallback_reason=(
                f"all_{len(failover_chain)}_providers_failed: "
                f"{type(last_error).__name__ if last_error else 'unknown'}"
            ),
        )

    def analyze_claim(
        self,
        claim_data: dict,
        regional_clauses: list,
        company_clauses: list,
        rules_result: dict,
        force_provider: Optional[tuple] = None,
    ) -> ClaimAIAnalysis:
        """
        Analyze a claim against BOTH tiers of policy clauses with automatic multi-provider failover.

        Failover chain: Groq → NVIDIA → OpenAI → Anthropic → Rules-only mode
        Each provider is tried in priority order until one succeeds or all fail.

        Args:
            claim_data:       Raw claim dict
            regional_clauses: Tier 1 — government regulatory mandate clause dicts
                              (e.g. UAE DHA/DOH EBP, India IRDAI mandates)
            company_clauses:  Tier 2 — insurance company policy clause dicts
                              (specific to the member's purchased policy)
            rules_result:     Rules engine output summary dict
            force_provider:   Optional (provider, api_key, model) tuple. When set, skips
                              building the config-derived failover chain entirely and tries
                              only this one provider — no failover. Required for Agent C's
                              shadow call: without this, this method used to silently rebuild
                              its own failover chain from config and always retry "local"
                              (Agent B's endpoint) first, regardless of what the caller had
                              already select_provider()'d — meaning the "secondary" analysis
                              was actually calling Agent B a second time, not Agent C, and
                              the resulting agreement score was comparing Agent B against
                              itself (found + fixed 2026-07-24).

        Returns:
            ClaimAIAnalysis with per-line-item coverage findings,
            regulatory compliance verdict, and citations for both tiers.
        """
        claim_ref = claim_data.get("claim_reference", "UNKNOWN")

        # ═══════════════════════════════════════════════════════════════════════
        # PHASE 1: BUILD FAILOVER CHAIN
        # ═══════════════════════════════════════════════════════════════════════
        # Build priority-ordered list of all available LLM providers
        # Priority: Groq (free, fast) → NVIDIA (powerful) → OpenAI → Anthropic
        # If all fail, fall back to rules-only mode
        # ═══════════════════════════════════════════════════════════════════════

        from services.api_gateway.app import config_store

        cfg = config_store.load()
        self._apply_runtime_tuning(cfg)

        if force_provider is not None:
            f_provider, f_api_key, f_model = force_provider
            failover_chain = [
                {
                    "provider": f_provider,
                    "api_key": f_api_key,
                    "model": f_model,
                    "label": f"Forced provider ({f_provider}, no failover)",
                }
            ]
        else:
            failover_chain = []

            # Priority 0: Local / self-hosted (Ollama, vLLM, LM Studio — OpenAI-compatible)
            # Wins over ALL cloud providers when enabled + URL present.
            if cfg.get("local_llm_enabled", False) and cfg.get("local_llm_base_url", "").strip():
                failover_chain.append(
                    {
                        "provider": "local",
                        "api_key": cfg.get("local_llm_api_key") or "local",
                        "model": cfg.get("local_llm_model") or "claims-adjudicator:latest",
                        "label": "Local LLM (priority 0)",
                    }
                )

            # Priority 1: Groq (free tier, fast, recommended)
            if cfg.get("groq_enabled", True) and cfg.get("groq_api_key"):
                failover_chain.append(
                    {
                        "provider": "groq",
                        "api_key": cfg.get("groq_api_key"),
                        "model": cfg.get("llm_model", "qwen/qwen3-32b"),
                        "label": "Groq (primary)",
                    }
                )

            # Priority 2: NVIDIA NIM (powerful fallback)
            if cfg.get("nvidia_enabled", True) and cfg.get("nvidia_api_key"):
                failover_chain.append(
                    {
                        "provider": "nvidia",
                        "api_key": cfg.get("nvidia_api_key"),
                        "model": cfg.get(
                            "nvidia_model", "nvidia/llama-3.1-nemotron-ultra-253b-v1"
                        ),
                        "label": "NVIDIA (secondary)",
                    }
                )

            # Priority 3: OpenAI (if configured)
            if cfg.get("openai_enabled") and cfg.get("openai_api_key"):
                failover_chain.append(
                    {
                        "provider": "openai",
                        "api_key": cfg.get("openai_api_key"),
                        "model": cfg.get("openai_model", "gpt-4o"),
                        "label": "OpenAI (tertiary)",
                    }
                )

            # Priority 4: Anthropic (if configured)
            if cfg.get("anthropic_enabled") and cfg.get("anthropic_api_key"):
                failover_chain.append(
                    {
                        "provider": "anthropic",
                        "api_key": cfg.get("anthropic_api_key"),
                        "model": cfg.get("anthropic_model", "claude-sonnet-4-5"),
                        "label": "Anthropic (quaternary)",
                    }
                )

        if not failover_chain:
            logger.warning(
                "[LLM Failover] No providers configured for %s — rules-only mode",
                claim_ref,
            )
            return ClaimAIAnalysis(
                claim_reference=claim_ref,
                analysis_available=False,
                fallback_reason="no_providers_configured",
            )

        # ═══════════════════════════════════════════════════════════════════════
        # PHASE 2: CACHE CHECK
        # ═══════════════════════════════════════════════════════════════════════
        # Agent C's forced/shadow call always bypasses cache — the whole point of an
        # independent cross-check is a fresh call; a cache keyed only on
        # claim+clauses (not provider) could otherwise silently return Agent B's
        # already-cached response and defeat the cross-validation entirely.
        cache_enabled = cfg.get("llm_cache_enabled", True) and force_provider is None
        all_clauses = regional_clauses + company_clauses
        cache_key = None
        cache_start = None

        if cache_enabled and self._cache and self._cache.enabled:
            cache_start = time.time()
            cache_key = self._cache.get_cache_key(claim_data, all_clauses)
            cached_response = self._cache.get(cache_key)

            if cached_response:
                cache_time = time.time() - cache_start
                logger.info(
                    "[LLM Cache] %s: Cache HIT (%.2fs saved, typical LLM call ~15-20s)",
                    claim_ref,
                    cache_time,
                )
                try:
                    analysis = self._parse_cached_response(claim_ref, cached_response)
                    analysis.flags.append("CACHE_HIT")
                    return analysis
                except Exception as e:
                    logger.warning(
                        "[LLM Cache] %s: Failed to parse cached response: %s (falling through to LLM call)",
                        claim_ref,
                        e,
                    )

        user_message = self._build_user_message(
            claim_data, regional_clauses, company_clauses, rules_result
        )

        # Build tool-execution context for this claim (services/reasoning_engine/app/tools.py).
        # Cheap to build unconditionally — the tool-calling path itself only engages when
        # local_llm_tools_enabled is true AND the provider ends up being local, checked
        # inside _call_local(). See tools.py's module docstring for the design rationale.
        self._tool_context = None
        try:
            from services.reasoning_engine.app.tools import ToolExecutionContext
            self._tool_context = ToolExecutionContext(
                claim_data=claim_data,
                market_region=rules_result.get("market_region", claim_data.get("market_region", "")),
                coverage_start=rules_result.get("_member_coverage_start"),
                all_regional_clauses=regional_clauses,
                all_company_clauses=company_clauses,
            )
        except Exception as e:
            logger.debug("[Tools] Could not build ToolExecutionContext (tools will be unavailable this call): %s", e)

        # ═══════════════════════════════════════════════════════════════════════
        # PHASE 3: MULTI-PROVIDER FAILOVER WITH RETRY LOGIC
        # ═══════════════════════════════════════════════════════════════════════
        # Try each provider in the failover chain with exponential backoff retries
        # Each provider gets 3 retry attempts before moving to the next provider
        # ═══════════════════════════════════════════════════════════════════════

        last_error = None
        all_attempts = []  # Track all attempts for audit trail

        for idx, provider_config in enumerate(failover_chain):
            provider = provider_config["provider"]
            api_key = provider_config["api_key"]
            model = provider_config["model"]
            label = provider_config["label"]

            logger.info(
                "[LLM Failover] %s: Attempt %d/%d — Trying %s (%s/%s)",
                claim_ref,
                idx + 1,
                len(failover_chain),
                label,
                provider,
                model,
            )

            try:
                # Switch to this provider
                self.select_provider(provider, api_key, model)

                # Try with retries (3 attempts per provider)
                # NOTE: ReliableLLMClient's own response cache (shared/llm_reliability.py)
                # is keyed on claim_data alone, with no provider identity at all — and
                # this ReasoningEngine instance is shared between the primary and
                # secondary/Agent-C calls. Passing claim_data=None for a forced call
                # disables both the cache lookup and the cache write for it (see
                # call_with_retry's `if self._cache and claim_data:` guard), so Agent
                # C's call can never be silently served Agent B's cached response —
                # found + fixed 2026-07-24, the actual reason the agreement score was
                # always exactly 1.0 even after routing was corrected.
                raw_response = None
                for retry in range(self._max_retries):
                    try:
                        raw_response = self._call_llm(
                            user_message,
                            claim_reference=claim_ref,
                            claim_data=None if force_provider is not None else claim_data,
                        )
                        logger.info(
                            "[LLM Failover] %s: ✓ SUCCESS with %s (attempt %d/%d, retry %d/%d)",
                            claim_ref,
                            label,
                            idx + 1,
                            len(failover_chain),
                            retry + 1,
                            self._max_retries,
                        )
                        all_attempts.append(
                            {
                                "provider": provider,
                                "label": label,
                                "attempt": idx + 1,
                                "retry": retry + 1,
                                "status": "success",
                            }
                        )
                        break  # Success — exit retry loop
                    except Exception as retry_err:
                        wait_time = self._base_delay * (2**retry)  # 1s, 2s, 4s
                        all_attempts.append(
                            {
                                "provider": provider,
                                "label": label,
                                "attempt": idx + 1,
                                "retry": retry + 1,
                                "status": "failed",
                                "error": f"{type(retry_err).__name__}: {str(retry_err)[:100]}",
                            }
                        )
                        if retry < self._max_retries - 1:
                            logger.warning(
                                "[LLM Retry] %s: %s retry %d/%d failed: %s. Retrying in %.1fs...",
                                claim_ref,
                                label,
                                retry + 1,
                                self._max_retries,
                                str(retry_err)[:100],
                                wait_time,
                            )
                            time.sleep(wait_time)
                        else:
                            # Last retry failed for this provider
                            last_error = retry_err
                            logger.warning(
                                "[LLM Failover] %s: ✗ %s failed after %d retries: %s",
                                claim_ref,
                                label,
                                self._max_retries,
                                str(retry_err)[:100],
                            )
                            raise retry_err  # Trigger next provider in chain

                if raw_response:
                    analysis = self._parse_response(claim_ref, raw_response)

                    # If the provider returned content but it couldn't be parsed
                    # (empty body, thinking-only output, malformed JSON), treat it
                    # as a failure and fall through to the next provider.
                    if not analysis.analysis_available:
                        parse_err_msg = (
                            f"{label} returned unparseable response "
                            f"(reason={analysis.fallback_reason})"
                        )
                        logger.warning(
                            "[LLM Failover] %s: ✗ %s — %s",
                            claim_ref, label, parse_err_msg,
                        )
                        all_attempts.append({
                            "provider": provider,
                            "label": label,
                            "attempt": idx + 1,
                            "status": "bad_response",
                            "error": parse_err_msg,
                        })
                        last_error = RuntimeError(parse_err_msg)
                        raise last_error  # fall through to next provider

                    # Good parse — add failover metadata to flags
                    if idx > 0:
                        analysis.flags.append(f"FAILOVER_SUCCESS_{provider.upper()}")

                    # Cache the successful response
                    if (
                        cache_enabled
                        and self._cache
                        and self._cache.enabled
                        and cache_key
                    ):
                        try:
                            cache_value = self._to_cache_dict(analysis)
                            stored = self._cache.set(cache_key, cache_value)
                            if stored:
                                logger.info(
                                    "[LLM Cache] %s: Response cached for future use",
                                    claim_ref,
                                )
                        except Exception as cache_err:
                            logger.warning(
                                "[LLM Cache] %s: Failed to cache response: %s",
                                claim_ref,
                                cache_err,
                            )

                    logger.info(
                        "[LLM Failover] %s: ✓ Final provider used — %s (%s)",
                        claim_ref, label, provider,
                    )
                    return analysis

            except Exception as e:
                last_error = e
                logger.warning(
                    "[LLM Failover] %s: ✗ %s failed completely: %s",
                    claim_ref,
                    label,
                    f"{type(e).__name__}: {str(e)[:100]}",
                )
                # Continue to next provider in chain
                continue

        # ═══════════════════════════════════════════════════════════════════════
        # PHASE 4: ALL PROVIDERS FAILED — RULES-ONLY FALLBACK
        # ═══════════════════════════════════════════════════════════════════════
        logger.error(
            "[LLM Failover] %s: ALL %d providers failed. "
            "Last error: %s. Falling back to rules-only mode.",
            claim_ref,
            len(failover_chain),
            f"{type(last_error).__name__}: {str(last_error)[:100]}"
            if last_error
            else "unknown",
        )
        logger.error(
            "[LLM Failover] %s: Attempt summary: %s",
            claim_ref,
            json.dumps(all_attempts, indent=2),
        )

        return ClaimAIAnalysis(
            claim_reference=claim_ref,
            analysis_available=False,
            fallback_reason=f"all_{len(failover_chain)}_providers_failed: {type(last_error).__name__ if last_error else 'unknown'}",
        )

    # ── Prompt Construction ───────────────────────────────────────────────────

    def _build_user_message(
        self,
        claim_data: dict,
        regional_clauses: list,
        company_clauses: list,
        rules_result: dict,
    ) -> str:
        """Build the two-tier user message with clearly labeled sections."""

        # ── Tier 1: Regional regulatory clauses ──
        tier1_lines = []
        for clause in regional_clauses[:15]:  # Limit to 15 to protect context window
            regulatory_body = clause.get("structured_data", {}).get(
                "regulatory_body", clause.get("regulatory_note", "REGULATORY")
            )
            tier1_lines.append(
                f"[{clause.get('section_reference', 'N/A')}] {clause.get('title', '')} "
                f"[MANDATORY — {clause.get('regulatory_note', 'REGULATORY')}]\n"
                f"{clause.get('full_text', '')[:600]}"
            )

        # ── Tier 2: Company policy clauses ──
        tier2_lines = []
        for clause in company_clauses[:20]:  # Limit to 20
            tier2_lines.append(
                f"[{clause.get('section_reference', 'N/A')}] {clause.get('title', '')}\n"
                f"{clause.get('full_text', '')[:500]}"
            )

        # ── Duplicate Resubmission Signal (ML training context) ──────────────────
        dup_section = ""
        if claim_data.get("is_duplicate") and claim_data.get("duplicate_of_ref"):
            _orig_status = claim_data.get("duplicate_orig_status", "UNKNOWN")
            _orig_rejection = claim_data.get("duplicate_orig_rejection", "")
            _orig_date = claim_data.get("duplicate_orig_date", "N/A")
            _prior_hitl = _orig_status == "HITL_PENDING"
            _prior_rejected = _orig_status in ("ERROR", "REJECTED")

            dup_section = (
                f"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"⚠  DUPLICATE RESUBMISSION — ENHANCED SCRUTINY REQUIRED\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"This claim is a CONFIRMED RE-SUBMISSION of original claim "
                f"{claim_data['duplicate_of_ref']}.\n"
                f"Original submission date : {_orig_date}\n"
                f"Original claim status    : {_orig_status}\n"
                + (
                    f"Prior rejection/review reason: {_orig_rejection}\n"
                    if _orig_rejection
                    else ""
                )
                + "\nMANDATORY ACTIONS — apply ALL that are relevant:\n"
                '1. Add "DUPLICATE_RESUBMISSION" to policy_level.flags.\n'
                + (
                    "2. Original was REJECTED/ERROR — the prior policy violation still applies "
                    "UNLESS this submission contains new clinical justification that was absent before. "
                    "If no new justification is evident, re-confirm the denial and also add "
                    '"PRIOR_REJECTION_STANDS" to policy_level.flags.\n'
                    if _prior_rejected
                    else ""
                )
                + (
                    "2. Original is in HITL_PENDING — a human review is already open for this claim. "
                    'Add "HITL_REVIEW_ALREADY_OPEN" to policy_level.flags.\n'
                    if _prior_hitl
                    else ""
                )
                + "3. If any line-item amounts DIFFER from what is expected for the listed CPT codes, "
                'add "AMOUNT_DISCREPANCY" to policy_level.flags and document the discrepancy '
                "in the affected line item's notes field.\n"
                "4. These flags feed the fraud-detection ML pipeline — be precise and deterministic.\n"
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            )

        return f"""CLAIM DETAILS:
{
            json.dumps(
                {
                    "claim_type": claim_data.get("claim_type"),
                    "market_region": claim_data.get("market_region"),
                    "currency": claim_data.get("currency"),
                    "service_date": str(claim_data.get("service_date", "")),
                    "primary_diagnosis": claim_data.get("primary_diagnosis_code"),
                    "primary_diagnosis_desc": claim_data.get("primary_diagnosis_desc"),
                    "preauth_number": claim_data.get("preauth_number"),
                    "preauth_approved": claim_data.get("preauth_approved"),
                    "network_tier": claim_data.get("network_tier", "NETWORK"),
                    "line_items": claim_data.get("line_items", []),
                },
                indent=2,
                default=_json_default,
            )
        }

RULES ENGINE PRE-EVALUATION:
{json.dumps(rules_result, indent=2, default=_json_default)}
{dup_section}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 1 — REGULATORY MANDATES (Government / Mandatory — Non-Waivable)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
            chr(10).join(tier1_lines)
            if tier1_lines
            else "No regional regulatory clauses available for this market region."
        }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 2 — INSURANCE COMPANY POLICY CLAUSES (Member's Specific Policy)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{chr(10).join(tier2_lines) if tier2_lines else "No company policy clauses available."}

Analyze the claim in two steps:
1. Check Tier 1 regulatory mandates — identify any violations (company policy overridden by law).
2. Analyze Tier 2 company policy clauses — determine coverage and deductions for each line item.
Return ONLY the specified JSON format."""

    # ── LLM API Calls ─────────────────────────────────────────────────────────

    def _call_llm(
        self,
        user_message: str,
        claim_reference: Optional[str] = None,
        claim_data: Optional[dict] = None,
    ) -> str:
        """Dispatch to the correct provider with reliability layer (retry, circuit breaker, caching)."""

        def llm_call_fn():
            if self._provider == "groq":
                return self._call_groq(user_message)
            elif self._provider == "anthropic":
                return self._call_anthropic(user_message)
            elif self._provider == "openai":
                return self._call_openai(user_message)
            elif self._provider == "nvidia":
                return self._call_nvidia(user_message)
            elif self._provider in ("local", "local_secondary"):
                return self._call_local(user_message)
            raise RuntimeError(f"Unknown provider: {self._provider}")

        response, metrics = self._reliable_client.call_with_retry(
            provider=self._provider,
            llm_call_fn=llm_call_fn,
            claim_reference=claim_reference or "test-call",
            claim_data=claim_data,
        )

        if response is None:
            raise RuntimeError(
                f"LLM call failed after retries: provider={self._provider}, claim={claim_reference}"
            )

        return response

    def _call_groq(self, user_message: str) -> str:
        """Call Groq chat completions API (OpenAI-compatible)."""
        # Append /no_think to disable Qwen3 thinking tokens — they break JSON parsing
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message + "\n/no_think"},
        ]
        response = self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            temperature=self.TEMPERATURE,
            max_tokens=self.MAX_TOKENS,
        )
        return response.choices[0].message.content

    def _call_anthropic(self, user_message: str) -> str:
        """Call Anthropic messages API."""
        response = self._client.messages.create(
            model=self._model,
            max_tokens=self.MAX_TOKENS,
            temperature=self.TEMPERATURE,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        # Log token usage for audit trail
        logger.info(
            "[Anthropic] model=%s, input_tokens=%d, output_tokens=%d",
            self._model,
            response.usage.input_tokens,
            response.usage.output_tokens,
        )
        return response.content[0].text

    def _call_openai(self, user_message: str) -> str:
        """Call OpenAI chat completions API (same interface as Groq)."""
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=self.TEMPERATURE,
            max_tokens=self.MAX_TOKENS,
        )
        return response.choices[0].message.content

    def _call_nvidia(self, user_message: str) -> str:
        """
        Call NVIDIA NIM API (OpenAI-compatible via integrate.api.nvidia.com).

        NVIDIA LIMITATION: This model returns None when system messages are included.
        Workaround: Merge system prompt into user message with clear separator.
        """
        if self._client is None:
            raise RuntimeError(
                "NVIDIA client not initialized - call select_provider() first"
            )
        if not self._available:
            raise RuntimeError(
                "NVIDIA provider not available - check API key and network"
            )

        # WORKAROUND: Merge system prompt into user message
        # NVIDIA llama-3.1-nemotron-ultra returns None with system role
        combined_message = f"{SYSTEM_PROMPT}\n\n{'=' * 80}\nUSER REQUEST:\n{'=' * 80}\n\n{user_message}"

        logger.debug(
            "[NVIDIA] Calling model=%s with %d char message (system merged)",
            self._model,
            len(combined_message),
        )

        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "user", "content": combined_message},
            ],
            temperature=self.TEMPERATURE,
            max_tokens=self.MAX_TOKENS,
        )

        if not response or not hasattr(response, "choices") or not response.choices:
            raise RuntimeError(f"Invalid NVIDIA API response: {type(response)}")

        content = response.choices[0].message.content
        if not content:
            raise RuntimeError("NVIDIA API returned empty content")

        logger.debug("[NVIDIA] Response received: %d chars", len(content))
        return content

    def _call_local(self, user_message: str) -> str:
        """
        Call a locally-served fine-tuned model via OpenAI-compatible API.

        Works with:
          - Ollama  (ollama serve → http://localhost:11434/v1)
          - vLLM    (vllm serve  → http://localhost:8080/v1)
          - llama.cpp server     → http://localhost:8080/v1
          - Any OpenAI-compatible endpoint

        The client is already initialised in select_provider("local", ...) pointing
        to LOCAL_LLM_BASE_URL.  No API key is required for local servers — the
        placeholder "local" is sent and ignored by Ollama/vLLM.
        """
        if self._client is None:
            raise RuntimeError("Local LLM client not initialized — call select_provider() first")
        if not self._available:
            raise RuntimeError("Local LLM provider not available — check LOCAL_LLM_BASE_URL and model name")

        if self._tools_enabled_for_this_call():
            return self._call_local_with_tools(user_message)

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ]

        logger.debug(
            "[Local LLM] Calling model=%s with %d char message",
            self._model, len(user_message),
        )

        response = self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            temperature=self.TEMPERATURE,
            max_tokens=self.MAX_TOKENS,
        )

        if not response or not hasattr(response, "choices") or not response.choices:
            raise RuntimeError(f"Local LLM returned invalid response: {type(response)}")

        content = response.choices[0].message.content
        if not content:
            raise RuntimeError("Local LLM returned empty content — check model is loaded and responding")

        logger.debug("[Local LLM] Response received: %d chars", len(content))
        return content

    def _tools_enabled_for_this_call(self) -> bool:
        """True only when LOCAL_LLM_TOOLS_ENABLED is set AND analyze_claim()
        successfully built a ToolExecutionContext for this claim. Additive/
        opt-in by design — see tools.py's module docstring."""
        if getattr(self, "_tool_context", None) is None:
            return False
        try:
            from services.api_gateway.app import config_store
            return bool(config_store.load().get("local_llm_tools_enabled", False))
        except Exception:
            return False

    def _call_local_with_tools(self, user_message: str) -> str:
        """
        Genuine LLM-driven tool invocation for the local path (vLLM +
        Qwen2.5-Instruct, launched with --enable-auto-tool-choice
        --tool-call-parser hermes — see deploy/radeon/bootstrap_instance.sh).

        Bounded to MAX_TOOL_ROUNDS round-trips so a model that keeps asking
        for tools can never hang a claim indefinitely. Every tool call is
        executed via tools.dispatch_tool_call(), which never raises — a bad
        tool call degrades one turn of the conversation, not the whole call.

        LIVE-GPU VERIFIED 2026-07-24 (instance u-9581-6bb2323d): confirmed
        via server-side vLLM request-log counts (the same tamper-proof method
        used for the Agent B/C dual-agent fix) that this method genuinely
        round-trips — Qwen2.5-14B-Instruct-AWQ actually emits real tool_calls
        through the hermes parser for both lookup_denial_code and
        check_waiting_period_status, the tool executes against the real
        RulesEngine, and the model correctly incorporates the true result
        into its final answer (verified against known-correct waiting-period
        math, not just "a response came back").
        """
        from services.reasoning_engine.app.tools import (
            MAX_TOOL_ROUNDS,
            TOOL_SCHEMAS,
            dispatch_tool_call,
        )

        tool_system_note = (
            "\n\nYou have tools available (check_waiting_period_status, lookup_denial_code, "
            "search_additional_policy_clauses). Use them only when genuinely uncertain — "
            "most claims can be analyzed correctly from the context already given. When you "
            "are done using tools, return ONLY the final JSON analysis as instructed above — "
            "never mix prose with the JSON, and never leave a tool call unresolved."
        )
        messages: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT + tool_system_note},
            {"role": "user", "content": user_message},
        ]

        for round_num in range(MAX_TOOL_ROUNDS + 1):
            # Only the last round omits tools entirely — that's what forces a
            # final plain-text answer (the model literally cannot return
            # tool_calls if no tools were offered), rather than needing a
            # separate forced-final-call branch after the loop.
            offer_tools = round_num < MAX_TOOL_ROUNDS
            extra = {"tools": TOOL_SCHEMAS, "tool_choice": "auto"} if offer_tools else {}

            response = self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                temperature=self.TEMPERATURE,
                max_tokens=self.MAX_TOKENS,
                **extra,
            )

            if not response or not hasattr(response, "choices") or not response.choices:
                raise RuntimeError(f"Local LLM returned invalid response: {type(response)}")

            message = response.choices[0].message
            tool_calls = getattr(message, "tool_calls", None) if offer_tools else None

            if not tool_calls:
                content = message.content
                if not content:
                    raise RuntimeError("Local LLM returned empty content — check model is loaded and responding")
                logger.debug(
                    "[Local LLM + Tools] Final response after %d tool round(s): %d chars",
                    round_num, len(content),
                )
                return content

            logger.info(
                "[Local LLM + Tools] Round %d: model requested %d tool call(s)",
                round_num + 1, len(tool_calls),
            )
            messages.append({
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in tool_calls
                ],
            })
            for tc in tool_calls:
                result_json = dispatch_tool_call(tc.function.name, tc.function.arguments, self._tool_context)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_json,
                })

        # Unreachable in practice: the final loop iteration never offers tools,
        # so it always returns via the `if not tool_calls` branch above. Kept
        # as a defensive guard, not a real code path.
        raise RuntimeError(
            "_call_local_with_tools exited its loop without a final response — this should be unreachable"
        )

    # ── Async LLM API Calls ───────────────────────────────────────────────────

    async def _call_llm_async(
        self,
        user_message: str,
        claim_reference: Optional[str] = None,
        claim_data: Optional[dict] = None,
    ) -> str:
        """Async dispatch with reliability layer (retry, circuit breaker, caching)."""
        import asyncio

        def llm_call_fn():
            if self._provider == "groq":
                # For async providers, we need to run the async call in sync context
                # This is a bit complex - for now, use the sync versions for reliability
                return self._call_groq(user_message)
            elif self._provider == "anthropic":
                return self._call_anthropic(user_message)
            elif self._provider == "openai":
                return self._call_openai(user_message)
            elif self._provider == "nvidia":
                return self._call_nvidia(user_message)
            elif self._provider in ("local", "local_secondary"):
                return self._call_local(user_message)
            raise RuntimeError(f"Unknown provider: {self._provider}")

        # Run the reliable client call in a thread pool to maintain async context
        loop = asyncio.get_event_loop()
        response, metrics = await loop.run_in_executor(
            None,
            lambda: self._reliable_client.call_with_retry(
                provider=self._provider,
                llm_call_fn=llm_call_fn,
                claim_reference=claim_reference or "async-test-call",
                claim_data=claim_data,
            ),
        )

        if response is None:
            raise RuntimeError(
                f"Async LLM call failed after retries: provider={self._provider}, claim={claim_reference}"
            )

        return response

    async def _call_groq_async(self, user_message: str) -> str:
        """Async call to Groq chat completions API using httpx."""
        try:
            import httpx
        except ImportError:
            raise RuntimeError(
                "httpx package required for async LLM calls — run: pip install httpx"
            )

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._current_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_message + "\n/no_think"},
                    ],
                    "temperature": self.TEMPERATURE,
                    "max_tokens": self.MAX_TOKENS,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

    async def _call_anthropic_async(self, user_message: str) -> str:
        """Async call to Anthropic messages API using httpx."""
        try:
            import httpx
        except ImportError:
            raise RuntimeError(
                "httpx package required for async LLM calls — run: pip install httpx"
            )

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self._current_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "max_tokens": self.MAX_TOKENS,
                    "temperature": self.TEMPERATURE,
                    "system": SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": user_message}],
                },
            )
            response.raise_for_status()
            data = response.json()
            logger.info(
                "[Anthropic] model=%s, input_tokens=%d, output_tokens=%d (async)",
                self._model,
                data["usage"]["input_tokens"],
                data["usage"]["output_tokens"],
            )
            return data["content"][0]["text"]

    async def _call_openai_async(self, user_message: str) -> str:
        """Async call to OpenAI chat completions API using httpx."""
        try:
            import httpx
        except ImportError:
            raise RuntimeError(
                "httpx package required for async LLM calls — run: pip install httpx"
            )

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._current_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                    "temperature": self.TEMPERATURE,
                    "max_tokens": self.MAX_TOKENS,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

    async def _call_nvidia_async(self, user_message: str) -> str:
        """Async call to NVIDIA NIM API using httpx."""
        try:
            import httpx
        except ImportError:
            raise RuntimeError(
                "httpx package required for async LLM calls — run: pip install httpx"
            )

        if not self._available:
            raise RuntimeError(
                "NVIDIA provider not available - check API key and network"
            )

        # WORKAROUND: Merge system prompt into user message (NVIDIA limitation)
        combined_message = f"{SYSTEM_PROMPT}\n\n{'=' * 80}\nUSER REQUEST:\n{'=' * 80}\n\n{user_message}"

        logger.debug(
            "[NVIDIA] Calling model=%s with %d char message (system merged, async)",
            self._model,
            len(combined_message),
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._current_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "user", "content": combined_message},
                    ],
                    "temperature": self.TEMPERATURE,
                    "max_tokens": self.MAX_TOKENS,
                },
            )
            response.raise_for_status()
            data = response.json()

            if not data.get("choices") or not data["choices"][0].get("message", {}).get(
                "content"
            ):
                raise RuntimeError("NVIDIA API returned empty content")

            content = data["choices"][0]["message"]["content"]
            logger.debug("[NVIDIA] Response received: %d chars (async)", len(content))
            return content

    # ── Cache Serialization ───────────────────────────────────────────────────

    def _to_cache_dict(self, analysis: ClaimAIAnalysis) -> dict:
        """Convert ClaimAIAnalysis to cacheable dict."""
        return {
            "claim_reference": analysis.claim_reference,
            "analysis_available": analysis.analysis_available,
            "fallback_reason": analysis.fallback_reason,
            "line_items": [
                {
                    "line_number": li.line_number,
                    "procedure_code": li.procedure_code,
                    "service_category": li.service_category,
                    "billed_amount": float(li.billed_amount),
                    "coverage_status": li.coverage_status,
                    "ai_confidence": li.ai_confidence,
                    "applicable_clause": li.applicable_clause,
                    "deduction_type": li.deduction_type,
                    "deduction_reason": li.deduction_reason,
                    "preauth_required": li.preauth_required,
                    "preauth_status": li.preauth_status,
                    "citations": [
                        {
                            "clause_reference": c.clause_reference,
                            "clause_title": c.clause_title,
                            "text_excerpt": c.text_excerpt,
                            "relevance_score": c.relevance_score,
                            "tier": c.tier,
                        }
                        for c in li.citations
                    ],
                    "notes": li.notes,
                }
                for li in analysis.line_items
            ],
            "deductible_applies": analysis.deductible_applies,
            "network_status": analysis.network_status,
            "coordination_of_benefits": analysis.coordination_of_benefits,
            "overall_ai_confidence": analysis.overall_ai_confidence,
            "flags": analysis.flags,
            "regulatory_compliance": analysis.regulatory_compliance,
            "regulatory_violations": analysis.regulatory_violations,
            "regulatory_citations": analysis.regulatory_citations,
            "model_used": analysis.model_used,
            "prompt_version": analysis.prompt_version,
            "input_tokens": analysis.input_tokens,
            "output_tokens": analysis.output_tokens,
        }

    def _parse_cached_response(
        self, claim_reference: str, cached: dict
    ) -> ClaimAIAnalysis:
        """Parse cached dict back to ClaimAIAnalysis."""
        line_items = []
        for item in cached.get("line_items", []):
            citations = [
                PolicyCitation(
                    clause_reference=c.get("clause_reference", ""),
                    clause_title=c.get("clause_title", ""),
                    text_excerpt=c.get("text_excerpt", ""),
                    relevance_score=float(c.get("relevance_score", 0.0)),
                    tier=c.get("tier", "COMPANY"),
                )
                for c in item.get("citations", [])
            ]

            line_items.append(
                LineItemAIAnalysis(
                    line_number=item.get("line_number", 0),
                    procedure_code=item.get("procedure_code", ""),
                    service_category=item.get("service_category", ""),
                    billed_amount=Decimal(str(item.get("billed_amount", 0))),
                    coverage_status=item.get("coverage_status", "AMBIGUOUS"),
                    ai_confidence=float(item.get("ai_confidence", 0.5)),
                    applicable_clause=item.get("applicable_clause", ""),
                    deduction_type=item.get("deduction_type"),
                    deduction_reason=item.get("deduction_reason"),
                    preauth_required=bool(item.get("preauth_required", False)),
                    preauth_status=item.get("preauth_status", "NOT_REQUIRED"),
                    citations=citations,
                    notes=item.get("notes", ""),
                )
            )

        return ClaimAIAnalysis(
            claim_reference=claim_reference,
            analysis_available=cached.get("analysis_available", True),
            fallback_reason=cached.get("fallback_reason", ""),
            line_items=line_items,
            deductible_applies=cached.get("deductible_applies", False),
            network_status=cached.get("network_status", "IN_NETWORK"),
            coordination_of_benefits=cached.get("coordination_of_benefits", False),
            overall_ai_confidence=cached.get("overall_ai_confidence", 0.0),
            flags=cached.get("flags", []),
            regulatory_compliance=cached.get("regulatory_compliance", True),
            regulatory_violations=cached.get("regulatory_violations", []),
            regulatory_citations=cached.get("regulatory_citations", []),
            model_used=cached.get("model_used", ""),
            prompt_version=cached.get("prompt_version", PROMPT_VERSION),
            input_tokens=cached.get("input_tokens", 0),
            output_tokens=cached.get("output_tokens", 0),
        )

    # ── Response Parsing ──────────────────────────────────────────────────────

    def _parse_response(
        self, claim_reference: str, raw_response: str
    ) -> ClaimAIAnalysis:
        """Parse LLM JSON response into ClaimAIAnalysis — two-tier structure."""
        import re
        text = raw_response.strip()

        # Strip <think>/<thinking> blocks (Qwen3, o1-style models) before finding JSON
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
        text = re.sub(r"<thinking>.*?</thinking>", "", text, flags=re.DOTALL)
        text = text.strip()

        # Strip markdown code fences (some models add them despite instructions)
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:])
        if text.endswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[:-1])

        # Extract JSON object if there's preamble text
        start = text.find("{")
        if start > 0:
            text = text[start:]
        end = text.rfind("}")
        if end != -1 and end < len(text) - 1:
            text = text[: end + 1]
        text = text.strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            logger.error(
                "Failed to parse LLM response as JSON for %s: %s", claim_reference, e
            )
            logger.debug("Raw response snippet: %s", raw_response[:500])
            return ClaimAIAnalysis(
                claim_reference=claim_reference,
                analysis_available=False,
                fallback_reason=f"JSON parse error: {e}",
            )

        # ── Parse Tier 1 regulatory_compliance section ──
        reg_section = data.get("regulatory_compliance", {})
        is_compliant = bool(reg_section.get("is_compliant", True))
        regulatory_violations = reg_section.get("violations", [])
        regulatory_citations_raw = reg_section.get("regulatory_citations", [])

        regulatory_citations = [
            {
                "clause_reference": rc.get("clause_reference", ""),
                "clause_title": rc.get("clause_title", ""),
                "relevance": rc.get("relevance", ""),
                "tier": "REGIONAL",
            }
            for rc in regulatory_citations_raw
            if isinstance(rc, dict)
        ]

        # ── Parse Tier 2 line items ──
        line_items = []
        for item in data.get("line_items", []):
            if not isinstance(item, dict):
                continue

            citations = [
                PolicyCitation(
                    clause_reference=c.get("clause_reference", ""),
                    clause_title=c.get("clause_title", ""),
                    text_excerpt=c.get("text_excerpt", ""),
                    relevance_score=float(c.get("relevance_score", 0.0)),
                    tier=c.get("tier", "COMPANY"),
                )
                for c in item.get("citations", [])
                if isinstance(c, dict)
            ]

            billed_raw = item.get("billed_amount", 0)
            try:
                billed_decimal = Decimal(str(billed_raw))
            except Exception:
                billed_decimal = Decimal("0")

            line_items.append(
                LineItemAIAnalysis(
                    line_number=item.get("line_number", 0),
                    procedure_code=item.get("procedure_code", ""),
                    service_category=item.get("service_category", ""),
                    billed_amount=billed_decimal,
                    coverage_status=item.get("coverage_status", "AMBIGUOUS"),
                    ai_confidence=float(item.get("ai_confidence", 0.5)),
                    applicable_clause=item.get("applicable_clause", ""),
                    deduction_type=item.get("deduction_type"),
                    deduction_reason=item.get("deduction_reason"),
                    preauth_required=bool(item.get("preauth_required", False)),
                    preauth_status=item.get("preauth_status", "NOT_REQUIRED"),
                    citations=citations,
                    notes=item.get("notes", ""),
                )
            )

        # ── Policy-level fields ──
        policy_level = data.get("policy_level", {})
        confidences = [li.ai_confidence for li in line_items if li.ai_confidence]
        overall_conf = sum(confidences) / len(confidences) if confidences else 0.0

        return ClaimAIAnalysis(
            claim_reference=claim_reference,
            analysis_available=True,
            line_items=line_items,
            deductible_applies=policy_level.get("deductible_applies", False),
            network_status=policy_level.get("network_status", "IN_NETWORK"),
            coordination_of_benefits=policy_level.get(
                "coordination_of_benefits", False
            ),
            overall_ai_confidence=policy_level.get("overall_confidence", overall_conf),
            flags=policy_level.get("flags", []),
            # Two-tier compliance fields
            regulatory_compliance=is_compliant,
            regulatory_violations=regulatory_violations,
            regulatory_citations=regulatory_citations,
            model_used=self._model,
            prompt_version=PROMPT_VERSION,
        )


# Module-level singleton
_engine_instance: Optional[ReasoningEngine] = None


def get_reasoning_engine() -> ReasoningEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = ReasoningEngine()
    return _engine_instance
