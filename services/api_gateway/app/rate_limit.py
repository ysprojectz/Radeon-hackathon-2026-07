"""
Rate Limiting
=============
Token-bucket rate limits via slowapi (wraps `limits` library).

Tiers
-----
  ADJUDICATION  — expensive AI + DB writes  → 30 req / minute
  STANDARD      — reads + HITL decisions    → 120 req / minute
  HEALTH        — health / status probes    → 300 req / minute

The key function uses the client IP so each caller gets their own bucket.
In production, swap to an API-key-based key function for per-tenant limits.
"""
from __future__ import annotations

import os
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from services.api_gateway.app.auth import resolve_redis_url

# ── Limiter instance (shared across the app) ───────────────────────────────────

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200/minute"],   # global fallback
    storage_uri=resolve_redis_url(),  # use Redis in prod
)

# ── Per-route limit strings ────────────────────────────────────────────────────

LIMIT_ADJUDICATION = os.getenv("RATE_LIMIT_ADJUDICATION", "30/minute")
LIMIT_STANDARD     = os.getenv("RATE_LIMIT_STANDARD",     "120/minute")
LIMIT_HEALTH       = os.getenv("RATE_LIMIT_HEALTH",       "300/minute")


# ── 429 handler ───────────────────────────────────────────────────────────────

def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> Response:
    """Return a clean JSON 429 instead of slowapi's plain-text default."""
    return JSONResponse(
        status_code=429,
        content={
            "error":   "rate_limit_exceeded",
            "detail":  f"Too many requests — limit: {exc.limit}",
            "retry_after": getattr(exc, "retry_after", None),
        },
        headers={"Retry-After": str(getattr(exc, "retry_after", 60))},
    )
