"""
LLM Resilience Components — Retry Logic + Circuit Breaker + Response Cache
===========================================================================

This module provides enterprise-grade reliability components for LLM API calls:

1. RETRY LOGIC with exponential backoff
   - Start with 1s delay, double each retry (1s, 2s, 4s)
   - Max 3 retries before falling back
   - Only retry on transient errors (503/429/500, not 400/401)
   - Max total delay: ~7 seconds (acceptable for claims adjudication)

2. CIRCUIT BREAKER pattern
   - Track failure rate over rolling 10-minute window
   - If >50% failures, open circuit (skip provider, use fallback)
   - Half-open after 5 minutes to test recovery
   - Thread-safe with locking

3. RESPONSE CACHE for similar claims
   - Hash claim key fields (procedure codes, amounts, diagnosis)
   - Cache policy analysis results (not full settlement)
   - 24-hour TTL (policy clauses rarely change mid-day)
   - Redis-backed for production, in-memory fallback for dev

4. AUDIT LOGGING for monitoring
   - Log all retry attempts with timing
   - Log circuit breaker state changes
   - Log cache hits/misses
   - Log provider switches (Groq→Anthropic)

Usage in reasoning.py:
    from shared.llm_resilience import (
        with_retry, CircuitBreaker, LLMResponseCache, audit_llm_call
    )

    circuit_breaker = CircuitBreaker(provider="groq")
    cache = LLMResponseCache()

    @with_retry(max_retries=3, backoff_base=1.0)
    def _call_with_resilience(self, user_message: str) -> str:
        cache_key = cache.make_cache_key(claim_data)
        cached = cache.get(cache_key)
        if cached:
            return cached

        if circuit_breaker.is_open():
            raise CircuitBreakerOpen("Circuit breaker open — skipping Groq")

        try:
            response = self._call_groq(user_message)
            circuit_breaker.record_success()
            cache.set(cache_key, response)
            return response
        except Exception as e:
            circuit_breaker.record_failure()
            raise
"""
import os
import time
import json
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Callable, Any
from functools import wraps
from collections import deque
from threading import Lock

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# RETRY LOGIC WITH EXPONENTIAL BACKOFF
# ─────────────────────────────────────────────────────────────────────────────

class RetryableError(Exception):
    """Indicates an error that should trigger a retry."""
    pass


class NonRetryableError(Exception):
    """Indicates an error that should NOT trigger a retry (e.g., 400 Bad Request)."""
    pass


def is_retryable_error(exc: Exception) -> bool:
    """
    Determine if an exception is retryable based on error type and HTTP status.

    Retryable errors:
    - 503 Service Unavailable (Groq over capacity)
    - 429 Too Many Requests (rate limit)
    - 500 Internal Server Error (transient provider issue)
    - Timeout errors
    - Connection errors

    Non-retryable errors:
    - 400 Bad Request (malformed input)
    - 401 Unauthorized (invalid API key)
    - 404 Not Found (invalid endpoint)
    """
    # Check for explicit retry marker
    if isinstance(exc, RetryableError):
        return True
    if isinstance(exc, NonRetryableError):
        return False

    # Check for timeout
    if isinstance(exc, TimeoutError):
        return True

    # Check for HTTP errors in exception message or attributes
    exc_str = str(exc).lower()
    if "503" in exc_str or "over capacity" in exc_str:
        return True
    if "429" in exc_str or "rate limit" in exc_str:
        return True
    if "500" in exc_str:
        return True
    if "timeout" in exc_str:
        return True
    if "connection" in exc_str:
        return True

    # Check for status_code attribute (groq/anthropic SDK)
    if hasattr(exc, "status_code"):
        status = exc.status_code
        if status in (429, 500, 502, 503, 504):
            return True
        if status in (400, 401, 403, 404):
            return False

    # Default: retry for unknown errors (conservative approach)
    return True


def with_retry(max_retries: int = 3, backoff_base: float = 1.0):
    """
    Decorator to add exponential backoff retry logic to a function.

    Args:
        max_retries: Maximum number of retry attempts (default: 3)
        backoff_base: Base delay in seconds (default: 1.0)
                      Delays: 1s, 2s, 4s for max_retries=3

    Usage:
        @with_retry(max_retries=3, backoff_base=1.0)
        def call_llm_api(message: str) -> str:
            return client.chat.completions.create(...)

    Total max delay for 3 retries: 1s + 2s + 4s = 7s (acceptable)
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            attempt = 0
            last_exception = None

            while attempt <= max_retries:
                try:
                    if attempt > 0:
                        delay = backoff_base * (2 ** (attempt - 1))
                        logger.info(
                            "[RETRY] Attempt %d/%d for %s after %.1fs delay",
                            attempt, max_retries, func.__name__, delay
                        )
                        time.sleep(delay)

                    result = func(*args, **kwargs)

                    if attempt > 0:
                        logger.info(
                            "[RETRY] Success on attempt %d/%d for %s",
                            attempt, max_retries, func.__name__
                        )

                    return result

                except Exception as e:
                    last_exception = e

                    if not is_retryable_error(e):
                        logger.warning(
                            "[RETRY] Non-retryable error in %s: %s — aborting retries",
                            func.__name__, type(e).__name__
                        )
                        raise

                    if attempt >= max_retries:
                        logger.error(
                            "[RETRY] Max retries (%d) exceeded for %s — final error: %s",
                            max_retries, func.__name__, e
                        )
                        raise

                    logger.warning(
                        "[RETRY] Retryable error in %s (attempt %d/%d): %s",
                        func.__name__, attempt, max_retries, e
                    )
                    attempt += 1

            # Should never reach here, but just in case
            if last_exception:
                raise last_exception
            raise RuntimeError(f"Unexpected retry loop exit in {func.__name__}")

        return wrapper
    return decorator


# ─────────────────────────────────────────────────────────────────────────────
# CIRCUIT BREAKER PATTERN
# ─────────────────────────────────────────────────────────────────────────────

class CircuitBreakerOpen(Exception):
    """Raised when circuit breaker is open (too many failures)."""
    pass


class CircuitBreaker:
    """
    Circuit breaker for LLM API calls — prevents cascade failures.

    States:
    - CLOSED: Normal operation, requests pass through
    - OPEN: Too many failures (>50% in 10-minute window), requests blocked
    - HALF_OPEN: Testing recovery after cooldown period

    Usage:
        breaker = CircuitBreaker(provider="groq", window_minutes=10, failure_threshold=0.5)

        if breaker.is_open():
            raise CircuitBreakerOpen("Groq circuit breaker open")

        try:
            response = call_groq_api(...)
            breaker.record_success()
        except Exception as e:
            breaker.record_failure()
            raise
    """

    # States
    STATE_CLOSED = "CLOSED"
    STATE_OPEN = "OPEN"
    STATE_HALF_OPEN = "HALF_OPEN"

    def __init__(
        self,
        provider: str,
        window_minutes: int = 10,
        failure_threshold: float = 0.5,
        cooldown_minutes: int = 5,
    ):
        """
        Args:
            provider: Provider name (e.g., "groq", "anthropic")
            window_minutes: Rolling window for failure tracking (default: 10)
            failure_threshold: Failure rate to open circuit (default: 0.5 = 50%)
            cooldown_minutes: Time before testing recovery (default: 5)
        """
        self.provider = provider
        self.window_minutes = window_minutes
        self.failure_threshold = failure_threshold
        self.cooldown_minutes = cooldown_minutes

        self.state = self.STATE_CLOSED
        self.opened_at: Optional[datetime] = None

        # Rolling window of (timestamp, success: bool) tuples
        self._history: deque = deque()
        self._lock = Lock()

    def is_open(self) -> bool:
        """Check if circuit breaker is open (blocking requests)."""
        with self._lock:
            return self.state == self.STATE_OPEN

    def is_half_open(self) -> bool:
        """Check if circuit breaker is half-open (testing recovery)."""
        with self._lock:
            return self.state == self.STATE_HALF_OPEN

    def record_success(self):
        """Record a successful API call."""
        with self._lock:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            self._history.append((now, True))
            self._cleanup_old_entries(now)

            # If half-open and success → transition to closed
            if self.state == self.STATE_HALF_OPEN:
                logger.info(
                    "[CIRCUIT-BREAKER] %s: HALF_OPEN → CLOSED (recovery test passed)",
                    self.provider
                )
                self.state = self.STATE_CLOSED
                self.opened_at = None

    def record_failure(self):
        """Record a failed API call — may trigger circuit breaker opening."""
        with self._lock:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            self._history.append((now, False))
            self._cleanup_old_entries(now)

            # If half-open and failure → return to open
            if self.state == self.STATE_HALF_OPEN:
                logger.warning(
                    "[CIRCUIT-BREAKER] %s: HALF_OPEN → OPEN (recovery test failed)",
                    self.provider
                )
                self.state = self.STATE_OPEN
                self.opened_at = now
                return

            # Check if we should open the circuit
            if self.state == self.STATE_CLOSED:
                failure_rate = self._calculate_failure_rate()
                if failure_rate >= self.failure_threshold:
                    logger.error(
                        "[CIRCUIT-BREAKER] %s: CLOSED → OPEN (failure_rate=%.2f%%, threshold=%.2f%%)",
                        self.provider, failure_rate * 100, self.failure_threshold * 100
                    )
                    self.state = self.STATE_OPEN
                    self.opened_at = now

    def check_transition(self):
        """
        Check if circuit breaker should transition from OPEN → HALF_OPEN.
        Call this before each API request to test recovery.
        """
        with self._lock:
            if self.state != self.STATE_OPEN:
                return

            if self.opened_at is None:
                return

            now = datetime.now(timezone.utc).replace(tzinfo=None)
            elapsed = (now - self.opened_at).total_seconds() / 60  # minutes

            if elapsed >= self.cooldown_minutes:
                logger.info(
                    "[CIRCUIT-BREAKER] %s: OPEN → HALF_OPEN (testing recovery after %.1f min)",
                    self.provider, elapsed
                )
                self.state = self.STATE_HALF_OPEN

    def _calculate_failure_rate(self) -> float:
        """Calculate failure rate over the rolling window."""
        if not self._history:
            return 0.0

        total = len(self._history)
        failures = sum(1 for _, success in self._history if not success)
        return failures / total

    def _cleanup_old_entries(self, now: datetime):
        """Remove entries older than the rolling window."""
        cutoff = now - timedelta(minutes=self.window_minutes)
        while self._history and self._history[0][0] < cutoff:
            self._history.popleft()

    def get_stats(self) -> dict:
        """Get circuit breaker statistics for monitoring."""
        with self._lock:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            self._cleanup_old_entries(now)

            total = len(self._history)
            failures = sum(1 for _, success in self._history if not success)
            failure_rate = failures / total if total > 0 else 0.0

            return {
                "provider": self.provider,
                "state": self.state,
                "total_calls_in_window": total,
                "failures_in_window": failures,
                "failure_rate": round(failure_rate, 4),
                "failure_threshold": self.failure_threshold,
                "opened_at": self.opened_at.isoformat() if self.opened_at else None,
                "window_minutes": self.window_minutes,
                "cooldown_minutes": self.cooldown_minutes,
            }


# ─────────────────────────────────────────────────────────────────────────────
# LLM RESPONSE CACHE
# ─────────────────────────────────────────────────────────────────────────────

class LLMResponseCache:
    """
    Cache LLM policy analysis responses for similar claims.

    Cache key = hash(procedure_codes + billed_amounts + diagnosis + policy_id)
    Value = raw LLM response text (JSON string)
    TTL = 24 hours (policy clauses rarely change mid-day)

    Storage:
    - Production: Redis (shared across API instances)
    - Dev/test: In-memory dict (single process only)

    Usage:
        cache = LLMResponseCache()

        cache_key = cache.make_cache_key(claim_data)
        cached_response = cache.get(cache_key)
        if cached_response:
            return cached_response

        response = call_llm_api(...)
        cache.set(cache_key, response)
    """

    DEFAULT_TTL_HOURS = 24
    KEY_PREFIX = "llm_cache:"

    def __init__(self, ttl_hours: int = DEFAULT_TTL_HOURS):
        """
        Args:
            ttl_hours: Time-to-live in hours (default: 24)
        """
        self.ttl_hours = ttl_hours
        self.ttl_seconds = ttl_hours * 3600

        # Try to use Redis if available
        self._redis = None
        self._use_redis = False

        try:
            import redis
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
            self._redis = redis.from_url(redis_url, decode_responses=True)
            self._redis.ping()
            self._use_redis = True
            logger.info("[LLM-CACHE] Using Redis backend: %s", redis_url)
        except Exception as e:
            logger.warning(
                "[LLM-CACHE] Redis unavailable (%s) — using in-memory cache (dev mode only)",
                e
            )
            self._memory_cache: dict[str, tuple[str, datetime]] = {}
            self._cache_lock = Lock()

    def make_cache_key(self, claim_data: dict) -> str:
        """
        Generate cache key from claim data.

        Key components:
        - procedure_codes (sorted list)
        - billed_amounts (sorted list, rounded to 2 decimals)
        - primary_diagnosis_code
        - policy_id (or policy_number)
        - claim_type
        - market_region

        Returns:
            SHA-256 hash hex string (64 chars)
        """
        # Extract line items
        line_items = claim_data.get("line_items", [])

        # Sort procedure codes and amounts for consistent hashing
        procedures = sorted([li.get("procedure_code", "") for li in line_items])
        amounts = sorted([
            round(float(li.get("billed_amount", 0)), 2) for li in line_items
        ])

        # Build cache key components
        key_data = {
            "procedures": procedures,
            "amounts": amounts,
            "diagnosis": claim_data.get("primary_diagnosis_code", ""),
            "policy": claim_data.get("policy_number", ""),
            "claim_type": claim_data.get("claim_type", ""),
            "market": claim_data.get("market_region", ""),
        }

        # Hash to 64-char hex string
        key_json = json.dumps(key_data, sort_keys=True)
        key_hash = hashlib.sha256(key_json.encode()).hexdigest()

        return f"{self.KEY_PREFIX}{key_hash}"

    def get(self, cache_key: str) -> Optional[str]:
        """
        Retrieve cached LLM response.

        Returns:
            Cached response text (JSON string) or None if not found/expired
        """
        if self._use_redis:
            try:
                cached = self._redis.get(cache_key)
                if cached:
                    logger.info("[LLM-CACHE] Cache HIT: %s", cache_key[:24])
                    return cached
            except Exception as e:
                logger.warning("[LLM-CACHE] Redis get error: %s", e)
        else:
            with self._cache_lock:
                if cache_key in self._memory_cache:
                    value, expires_at = self._memory_cache[cache_key]
                    if datetime.now(timezone.utc).replace(tzinfo=None) < expires_at:
                        logger.info("[LLM-CACHE] Cache HIT (memory): %s", cache_key[:24])
                        return value
                    else:
                        # Expired — remove
                        del self._memory_cache[cache_key]

        logger.debug("[LLM-CACHE] Cache MISS: %s", cache_key[:24])
        return None

    def set(self, cache_key: str, response: str):
        """
        Store LLM response in cache.

        Args:
            cache_key: Cache key from make_cache_key()
            response: Raw LLM response text (JSON string)
        """
        if self._use_redis:
            try:
                self._redis.setex(cache_key, self.ttl_seconds, response)
                logger.info(
                    "[LLM-CACHE] Cached response: %s (TTL=%dh)",
                    cache_key[:24], self.ttl_hours
                )
            except Exception as e:
                logger.warning("[LLM-CACHE] Redis set error: %s", e)
        else:
            with self._cache_lock:
                expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=self.ttl_hours)
                self._memory_cache[cache_key] = (response, expires_at)
                logger.info(
                    "[LLM-CACHE] Cached response (memory): %s (TTL=%dh)",
                    cache_key[:24], self.ttl_hours
                )

    def clear(self):
        """Clear all cached responses (admin operation)."""
        if self._use_redis:
            try:
                keys = self._redis.keys(f"{self.KEY_PREFIX}*")
                if keys:
                    self._redis.delete(*keys)
                logger.info("[LLM-CACHE] Cleared %d cached responses (Redis)", len(keys))
            except Exception as e:
                logger.warning("[LLM-CACHE] Redis clear error: %s", e)
        else:
            with self._cache_lock:
                count = len(self._memory_cache)
                self._memory_cache.clear()
                logger.info("[LLM-CACHE] Cleared %d cached responses (memory)", count)


# ─────────────────────────────────────────────────────────────────────────────
# AUDIT LOGGING FOR MONITORING
# ─────────────────────────────────────────────────────────────────────────────

def audit_llm_call(
    trail,
    provider: str,
    event_type: str,
    description: str,
    event_data: dict,
):
    """
    Log LLM-related events to audit trail for monitoring.

    Args:
        trail: AuditTrail instance from services/audit_service/app/audit.py
        provider: Provider name (e.g., "groq", "anthropic")
        event_type: Event type (e.g., "LLM_RETRY_ATTEMPT", "CIRCUIT_BREAKER_OPENED")
        description: Human-readable description
        event_data: Structured event data (dict)

    Usage:
        audit_llm_call(
            trail, "groq", "LLM_RETRY_ATTEMPT",
            "Groq API retry attempt 1/3 after 503 error",
            {"attempt": 1, "max_retries": 3, "delay": 1.0, "error": "over capacity"}
        )
    """
    # Enrich event data with provider and timestamp
    enriched_data = {
        "provider": provider,
        "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
        **event_data,
    }

    trail.add(event_type, description, enriched_data)
    logger.info("[LLM-AUDIT] %s: %s — %s", provider, event_type, description)


# ─────────────────────────────────────────────────────────────────────────────
# MODULE-LEVEL INSTANCES (singletons per provider)
# ─────────────────────────────────────────────────────────────────────────────

# Circuit breakers per provider
_circuit_breakers: dict[str, CircuitBreaker] = {}
_breakers_lock = Lock()

def get_circuit_breaker(provider: str) -> CircuitBreaker:
    """Get or create circuit breaker for a provider (singleton per provider)."""
    with _breakers_lock:
        if provider not in _circuit_breakers:
            _circuit_breakers[provider] = CircuitBreaker(provider=provider)
            logger.info("[CIRCUIT-BREAKER] Created circuit breaker for %s", provider)
        return _circuit_breakers[provider]


# Response cache (shared across all providers)
_response_cache: Optional[LLMResponseCache] = None
_cache_lock_singleton = Lock()

def get_response_cache() -> LLMResponseCache:
    """Get or create response cache (singleton)."""
    global _response_cache
    with _cache_lock_singleton:
        if _response_cache is None:
            _response_cache = LLMResponseCache()
            logger.info("[LLM-CACHE] Created response cache")
        return _response_cache
