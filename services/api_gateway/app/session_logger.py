"""
Login Session Logger
====================
Fire-and-forget async utility for recording login/logout events.

All DB writes happen in background tasks (asyncio.create_task) so login
and logout response latency is NOT affected.

Captures per session:
  - IP address (respects X-Forwarded-For from nginx)
  - User-Agent parsed into browser / version / OS / device type
  - Country + city via ip-api.com (background HTTP call, free, no API key)
  - Market region, JWT jti fingerprint
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
from typing import Optional

logger = logging.getLogger(__name__)

# ── User-agent parser ────────────────────────────────────────────────────────

def _parse_ua(ua_string: str) -> dict:
    """Parse user-agent string into structured fields (local, zero latency)."""
    if not ua_string:
        return {"browser_name": None, "browser_version": None, "os_name": None, "device_type": "other"}
    try:
        import user_agents
        ua = user_agents.parse(ua_string)
        if ua.is_bot:
            device_type = "bot"
        elif ua.is_mobile:
            device_type = "mobile"
        elif ua.is_tablet:
            device_type = "tablet"
        elif ua.is_pc:
            device_type = "desktop"
        else:
            device_type = "other"
        return {
            "browser_name":    ua.browser.family or None,
            "browser_version": ua.browser.version_string or None,
            "os_name":         ua.os.family or None,
            "device_type":     device_type,
        }
    except Exception:
        return {"browser_name": None, "browser_version": None, "os_name": None, "device_type": "other"}


# ── Geolocation via ip-api.com (background, free, no API key) ────────────────

async def _geo_lookup(ip: str) -> tuple[Optional[str], Optional[str]]:
    """Return (country, city). Runs in background — never blocks login."""
    if not ip or ip in ("127.0.0.1", "::1", "testclient", "localhost"):
        return "Local", None
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(
                f"http://ip-api.com/json/{ip}",
                params={"fields": "status,country,city"},
            )
            if r.status_code == 200:
                d = r.json()
                if d.get("status") == "success":
                    return d.get("country"), d.get("city")
    except Exception:
        pass
    return None, None


# ── DB helpers ────────────────────────────────────────────────────────────────

def _build_dsn() -> Optional[str]:
    """Build a plain asyncpg DSN from DATABASE_URL or individual env vars."""
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        # SQLAlchemy-style URL — asyncpg needs plain postgresql://
        return url.replace("postgresql+asyncpg://", "postgresql://")
    host  = os.getenv("DB_HOST", "db")
    port  = os.getenv("DB_PORT", "5432")
    name  = os.getenv("DB_NAME", "claims_engine")
    user  = os.getenv("DB_USER", "claims_admin")
    pwd   = os.getenv("DB_PASSWORD", "")
    return f"postgresql://{user}:{pwd}@{host}:{port}/{name}"


# ── Public API ────────────────────────────────────────────────────────────────

def generate_jti() -> str:
    """Generate a unique JWT token fingerprint (16-byte hex)."""
    return secrets.token_hex(16)


async def _do_log_login(
    user_email: str,
    user_role: str,
    ip_address: str,
    user_agent_str: str,
    market: str,
    jti: Optional[str],
) -> None:
    """Internal coroutine — runs in background task."""
    try:
        ua = _parse_ua(user_agent_str)
        country, city = await _geo_lookup(ip_address)
        dsn = _build_dsn()
        if not dsn:
            return
        import asyncpg
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute(
                """
                INSERT INTO login_sessions
                    (user_email, user_role, ip_address, user_agent,
                     browser_name, browser_version, os_name, device_type,
                     country, city, market, session_jti, login_at, is_active)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),TRUE)
                """,
                user_email, user_role, ip_address, user_agent_str or "",
                ua["browser_name"], ua["browser_version"], ua["os_name"], ua["device_type"],
                country, city, market, jti,
            )
        finally:
            await conn.close()
    except Exception as exc:
        logger.debug("[SESSION_LOGGER] login insert failed: %s", exc)


async def _do_log_logout(jti: Optional[str], user_email: str) -> None:
    """Mark session inactive on logout — matches by JTI."""
    if not jti and not user_email:
        return
    try:
        dsn = _build_dsn()
        if not dsn:
            return
        import asyncpg
        conn = await asyncpg.connect(dsn)
        try:
            if jti:
                await conn.execute(
                    "UPDATE login_sessions SET is_active=FALSE, logout_at=NOW() "
                    "WHERE session_jti=$1 AND is_active=TRUE",
                    jti,
                )
            else:
                # Fallback: close the most recent active session for this user.
                # PostgreSQL does not support ORDER BY/LIMIT in UPDATE directly;
                # use a subquery to identify the target row first.
                await conn.execute(
                    """
                    UPDATE login_sessions SET is_active=FALSE, logout_at=NOW()
                    WHERE id = (
                        SELECT id FROM login_sessions
                        WHERE user_email=$1 AND is_active=TRUE
                        ORDER BY login_at DESC
                        LIMIT 1
                    )
                    """,
                    user_email,
                )
        finally:
            await conn.close()
    except Exception as exc:
        logger.debug("[SESSION_LOGGER] logout update failed: %s", exc)


def log_login(
    user_email: str,
    user_role: str,
    ip_address: str,
    user_agent_str: str,
    market: str,
    jti: Optional[str] = None,
) -> None:
    """Fire-and-forget: schedule login session recording in the background."""
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(
            _do_log_login(user_email, user_role, ip_address, user_agent_str, market, jti)
        )
    except RuntimeError:
        pass  # No running event loop — silently skip (test environments)


def log_logout(jti: Optional[str], user_email: str = "") -> None:
    """Fire-and-forget: schedule logout session update in the background."""
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(_do_log_logout(jti, user_email))
    except RuntimeError:
        pass
