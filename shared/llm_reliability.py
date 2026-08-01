"""
LLM Reliability Layer — Circuit Breaker + Retry Logic + Response Caching
========================================================================
Improves stability for LLM API calls with comprehensive error handling.

FEATURES:
  1. Exponential backoff retry (1s → 2s → 4s, max 3 retries)
  2. Circuit breaker pattern (10-min rolling window, >50% failures → open)
  3. Response caching (24h TTL, hash-based on claim key fields)
  4. Metrics tracking (success rate, retry counts, circuit state)

USAGE:
    from shared.llm_reliability import ReliableLLMClient

    client = ReliableLLMClient()
    result = await client.call_with_retry(
        provider="groq",
        llm_call_fn=lambda: groq_client.chat.completions.create(...),
        claim_reference="CLM-UAE-2024-ABC123",
    )
"""
import asyncio
import hashlib
import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Callable, Optional, Dict, Tuple
from enum import Enum

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CIRCUIT BREAKER STATE
# ─────────────────────────────────────────────────────────────────────────────

class CircuitState(str, Enum):
    CLOSED = "CLOSED"         # Normal operation
    OPEN = "OPEN"             # Circuit open, skip provider
    HALF_OPEN = "HALF_OPEN"   # Testing recovery


@dataclass
class CircuitBreakerMetrics:
    """Per-provider circuit breaker state and metrics."""
    state: CircuitState = CircuitState.CLOSED
    failure_count: int = 0
    success_count: int = 0
    last_failure_time: Optional[float] = None
    opened_at: Optional[float] = None
    # Rolling 10-minute window of (timestamp, success) tuples
    history: deque = field(default_factory=lambda: deque(maxlen=100))

    def record_success(self):
        """Record successful call."""
        now = time.time()
        self.success_count += 1
        self.history.append((now, True))
        # Reset failure count on success
        if self.state == CircuitState.HALF_OPEN:
            logger.info("[Circuit Breaker] Success in HALF_OPEN state — closing circuit")
            self.state = CircuitState.CLOSED
            self.failure_count = 0

    def record_failure(self):
        """Record failed call."""
        now = time.time()
        self.failure_count += 1
        self.last_failure_time = now
        self.history.append((now, False))

    def get_failure_rate(self, window_seconds: int = 600) -> float:
        """
        Calculate failure rate over rolling window (default 10 minutes).
        Returns 0.0–1.0 (0% to 100%).
        """
        now = time.time()
        cutoff = now - window_seconds
        recent = [(ts, success) for ts, success in self.history if ts >= cutoff]
        if not recent:
            return 0.0
        failures = sum(1 for _, success in recent if not success)
        return failures / len(recent)

    def should_open(self, threshold: float = 0.5) -> bool:
        """Check if failure rate exceeds threshold (default 50%)."""
        return self.get_failure_rate() > threshold

    def should_attempt_recovery(self, recovery_timeout: float = 300) -> bool:
        """
        Check if circuit should attempt recovery (5 minutes after opening).
        """
        if self.state != CircuitState.OPEN:
            return False
        if self.opened_at is None:
            return False
        return (time.time() - self.opened_at) >= recovery_timeout


# ─────────────────────────────────────────────────────────────────────────────
# RESPONSE CACHE
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class CacheEntry:
    """Cached LLM response with TTL."""
    response: str
    cached_at: float
    hit_count: int = 0

    def is_expired(self, ttl_seconds: int = 86400) -> bool:
        """Check if entry expired (default 24 hours)."""
        return (time.time() - self.cached_at) > ttl_seconds


class ResponseCache:
    """
    In-memory LLM response cache with TTL.
    Production should use Redis for shared cache across instances.
    """

    def __init__(self, ttl_seconds: int = 86400, max_entries: int = 10000):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._cache: Dict[str, CacheEntry] = {}
        self._hit_count = 0
        self._miss_count = 0

    def _generate_key(self, claim_data: dict) -> str:
        """
        Generate cache key from claim data.
        Hash procedure codes + amounts + diagnosis + market.
        """
        key_fields = {
            "market_region": claim_data.get("market_region"),
            "claim_type": claim_data.get("claim_type"),
            "primary_diagnosis_code": claim_data.get("primary_diagnosis_code"),
            "line_items": [
                {
                    "procedure_code": li.get("procedure_code"),
                    "billed_amount": float(li.get("billed_amount", 0)),
                    "service_category": li.get("service_category"),
                }
                for li in claim_data.get("line_items", [])
            ],
        }
        key_json = json.dumps(key_fields, sort_keys=True, default=str)
        return hashlib.sha256(key_json.encode()).hexdigest()

    def get(self, claim_data: dict) -> Optional[str]:
        """Retrieve cached response if available and not expired."""
        key = self._generate_key(claim_data)
        entry = self._cache.get(key)
        if entry is None:
            self._miss_count += 1
            return None
        if entry.is_expired(self.ttl_seconds):
            del self._cache[key]
            self._miss_count += 1
            return None
        entry.hit_count += 1
        self._hit_count += 1
        return entry.response

    def set(self, claim_data: dict, response: str):
        """Cache LLM response."""
        key = self._generate_key(claim_data)
        # Evict oldest entry if cache full
        if len(self._cache) >= self.max_entries:
            oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k].cached_at)
            del self._cache[oldest_key]
        self._cache[key] = CacheEntry(response=response, cached_at=time.time())

    def get_stats(self) -> dict:
        """Return cache statistics."""
        total = self._hit_count + self._miss_count
        hit_rate = (self._hit_count / total) if total > 0 else 0.0
        return {
            "cache_size": len(self._cache),
            "hit_count": self._hit_count,
            "miss_count": self._miss_count,
            "hit_rate": round(hit_rate, 4),
        }

    def clear_expired(self):
        """Remove all expired entries."""
        expired = [k for k, v in self._cache.items() if v.is_expired(self.ttl_seconds)]
        for k in expired:
            del self._cache[k]
        return len(expired)


# ─────────────────────────────────────────────────────────────────────────────
# RELIABLE LLM CLIENT
# ─────────────────────────────────────────────────────────────────────────────

class ReliableLLMClient:
    """
    Wraps LLM API calls with retry logic, circuit breaker, and caching.

    Usage:
        client = ReliableLLMClient()
        result = client.call_with_retry(
            provider="groq",
            llm_call_fn=lambda: groq_api_call(),
            claim_reference="CLM-UAE-2024-ABC",
            claim_data={"line_items": [...]},  # for caching
        )
    """

    # Retryable error codes (503, 429, 500 only)
    RETRYABLE_STATUS_CODES = {503, 429, 500}
    RETRYABLE_ERROR_TYPES = {"ServiceUnavailableError", "RateLimitError", "APITimeoutError", "InternalServerError"}

    def __init__(
        self,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 4.0,
        circuit_failure_threshold: float = 0.5,
        circuit_recovery_timeout: float = 300,
        enable_cache: bool = True,
        cache_ttl: int = 86400,
    ):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.circuit_failure_threshold = circuit_failure_threshold
        self.circuit_recovery_timeout = circuit_recovery_timeout
        self.enable_cache = enable_cache

        # Per-provider circuit breakers
        self._circuits: Dict[str, CircuitBreakerMetrics] = {}
        # Response cache
        self._cache = ResponseCache(ttl_seconds=cache_ttl) if enable_cache else None

    def _get_circuit(self, provider: str) -> CircuitBreakerMetrics:
        """Get or create circuit breaker for provider."""
        if provider not in self._circuits:
            self._circuits[provider] = CircuitBreakerMetrics()
        return self._circuits[provider]

    def _is_retryable_error(self, error: Exception) -> bool:
        """Check if error is retryable (503/429/500 only)."""
        error_type = type(error).__name__
        if error_type in self.RETRYABLE_ERROR_TYPES:
            return True
        # Check status code attribute
        if hasattr(error, "status_code"):
            return error.status_code in self.RETRYABLE_STATUS_CODES
        # Check response attribute (for requests-style errors)
        if hasattr(error, "response") and hasattr(error.response, "status_code"):
            return error.response.status_code in self.RETRYABLE_STATUS_CODES
        return False

    def call_with_retry(
        self,
        provider: str,
        llm_call_fn: Callable[[], str],
        claim_reference: str,
        claim_data: Optional[dict] = None,
        fallback_fn: Optional[Callable[[], str]] = None,
    ) -> Tuple[Optional[str], dict]:
        """
        Call LLM with retry logic, circuit breaker, and caching.

        Args:
            provider: Provider name (groq, anthropic, etc.)
            llm_call_fn: Function that makes the LLM API call
            claim_reference: Claim reference for logging
            claim_data: Claim data dict for cache key generation
            fallback_fn: Optional fallback function if all retries fail

        Returns:
            (response_text, metrics_dict) tuple
        """
        circuit = self._get_circuit(provider)
        metrics = {
            "provider": provider,
            "cache_hit": False,
            "retries": 0,
            "circuit_state": circuit.state.value,
            "fallback_used": False,
        }

        # Check cache first
        if self._cache and claim_data:
            cached = self._cache.get(claim_data)
            if cached:
                logger.info("[LLM Cache] Cache hit for %s", claim_reference)
                metrics["cache_hit"] = True
                circuit.record_success()  # Cache hit counts as success
                return cached, metrics

        # Check circuit breaker state
        if circuit.state == CircuitState.OPEN:
            if circuit.should_attempt_recovery(self.circuit_recovery_timeout):
                logger.info("[Circuit Breaker] %s: Attempting recovery (HALF_OPEN)", provider)
                circuit.state = CircuitState.HALF_OPEN
                metrics["circuit_state"] = CircuitState.HALF_OPEN.value
            else:
                logger.warning(
                    "[Circuit Breaker] %s: Circuit OPEN — skipping provider (failure_rate=%.1f%%)",
                    provider, circuit.get_failure_rate() * 100
                )
                metrics["circuit_state"] = CircuitState.OPEN.value
                if fallback_fn:
                    metrics["fallback_used"] = True
                    return fallback_fn(), metrics
                return None, metrics

        # Retry loop with exponential backoff
        last_error = None
        for attempt in range(self.max_retries):
            try:
                response = llm_call_fn()
                # Success
                circuit.record_success()
                metrics["retries"] = attempt
                # Cache response
                if self._cache and claim_data and response:
                    self._cache.set(claim_data, response)
                logger.info(
                    "[LLM Retry] %s: Success on attempt %d/%d for %s",
                    provider, attempt + 1, self.max_retries, claim_reference
                )
                return response, metrics

            except Exception as e:
                last_error = e
                is_retryable = self._is_retryable_error(e)
                error_type = type(e).__name__

                logger.warning(
                    "[LLM Retry] %s: Attempt %d/%d failed for %s — %s: %s (retryable=%s)",
                    provider, attempt + 1, self.max_retries, claim_reference,
                    error_type, str(e)[:100], is_retryable
                )

                # Don't retry non-retryable errors (400, 401, etc.)
                if not is_retryable:
                    logger.error(
                        "[LLM Retry] %s: Non-retryable error (%s) — failing immediately",
                        provider, error_type
                    )
                    circuit.record_failure()
                    metrics["retries"] = attempt
                    break

                # Record failure
                circuit.record_failure()

                # Check if we should open circuit
                if circuit.should_open(self.circuit_failure_threshold):
                    logger.error(
                        "[Circuit Breaker] %s: Opening circuit (failure_rate=%.1f%% > %.1f%%)",
                        provider, circuit.get_failure_rate() * 100,
                        self.circuit_failure_threshold * 100
                    )
                    circuit.state = CircuitState.OPEN
                    circuit.opened_at = time.time()
                    metrics["circuit_state"] = CircuitState.OPEN.value
                    break

                # Exponential backoff (1s → 2s → 4s)
                if attempt < self.max_retries - 1:
                    delay = min(self.base_delay * (2 ** attempt), self.max_delay)
                    logger.info("[LLM Retry] %s: Waiting %.1fs before retry...", provider, delay)
                    time.sleep(delay)

        # All retries failed
        metrics["retries"] = self.max_retries
        logger.error(
            "[LLM Retry] %s: All %d retries failed for %s — last error: %s",
            provider, self.max_retries, claim_reference,
            str(last_error)[:200] if last_error else "unknown"
        )

        # Try fallback
        if fallback_fn:
            logger.info("[LLM Retry] %s: Attempting fallback for %s", provider, claim_reference)
            metrics["fallback_used"] = True
            try:
                return fallback_fn(), metrics
            except Exception as fb_err:
                logger.error("[LLM Retry] %s: Fallback also failed: %s", provider, fb_err)

        return None, metrics

    def get_metrics(self) -> dict:
        """Return reliability metrics for all providers."""
        metrics = {}
        for provider, circuit in self._circuits.items():
            metrics[provider] = {
                "state": circuit.state.value,
                "failure_rate": round(circuit.get_failure_rate(), 4),
                "total_failures": circuit.failure_count,
                "total_successes": circuit.success_count,
                "last_failure": (
                    datetime.fromtimestamp(circuit.last_failure_time).isoformat()
                    if circuit.last_failure_time else None
                ),
                "opened_at": (
                    datetime.fromtimestamp(circuit.opened_at).isoformat()
                    if circuit.opened_at else None
                ),
            }
        if self._cache:
            metrics["cache"] = self._cache.get_stats()
        return metrics

    def reset_circuit(self, provider: str):
        """Manually reset circuit breaker (admin endpoint)."""
        if provider in self._circuits:
            self._circuits[provider] = CircuitBreakerMetrics()
            logger.info("[Circuit Breaker] %s: Circuit manually reset", provider)

    def clear_cache(self):
        """Clear response cache (admin endpoint)."""
        if self._cache:
            old_size = len(self._cache._cache)
            self._cache._cache.clear()
            logger.info("[LLM Cache] Cache cleared (%d entries removed)", old_size)
