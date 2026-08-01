"""
Reference data cache for policies, members, providers, and regulatory fixtures.

Backed by Redis when available, with in-memory fallback. This reduces repeated
JSON parsing across app restarts and multi-process deployments.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Callable, Dict

logger = logging.getLogger(__name__)

_CACHE_PREFIX = "reference_data:"
_CACHE_TTL_SECONDS = int(os.getenv("REFERENCE_DATA_CACHE_TTL_SECONDS", "3600"))
_memory_cache: Dict[str, Any] = {}
_lock = threading.Lock()
_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis
        from services.api_gateway.app.auth import resolve_redis_url

        redis_url = resolve_redis_url()
        _redis_client = redis.Redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
        _redis_client.ping()
        return _redis_client
    except Exception as exc:
        logger.debug("Reference data Redis cache unavailable: %s", exc)
        _redis_client = None
        return None


def _cache_key(path: Path) -> str:
    return f"{_CACHE_PREFIX}{path.resolve()}"


def load_json(path: Path, loader: Callable[[], Any]) -> Any:
    """
    Load JSON from cache or fallback loader.

    Cache is invalidated automatically when the source file mtime changes.
    """
    path = Path(path)
    cache_key = _cache_key(path)
    version = str(int(path.stat().st_mtime)) if path.exists() else "missing"

    with _lock:
        entry = _memory_cache.get(cache_key)
        if entry and entry.get("version") == version:
            return entry["payload"]

    redis_client = _get_redis()
    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                parsed = json.loads(cached)
                if parsed.get("version") == version:
                    payload = parsed.get("payload")
                    with _lock:
                        _memory_cache[cache_key] = {"version": version, "payload": payload}
                    return payload
        except Exception as exc:
            logger.debug("Reference data Redis get failed for %s: %s", path, exc)

    payload = loader()
    with _lock:
        _memory_cache[cache_key] = {"version": version, "payload": payload}

    if redis_client:
        try:
            redis_client.setex(
                cache_key,
                _CACHE_TTL_SECONDS,
                json.dumps({"version": version, "payload": payload}, default=str),
            )
        except Exception as exc:
            logger.debug("Reference data Redis set failed for %s: %s", path, exc)

    return payload
