"""
Session Management — Track active user sessions with device fingerprinting.
=====================================================================

Manages:
- Active session tracking (Redis-backed for performance)
- Device fingerprinting (device_id hash from UA + OS)
- Session listing & revocation per user
- Impossible travel detection (IP changes in short time)
- Graceful degradation when Redis unavailable

Session TTL: 7 days (configurable via REDIS_SESSION_TTL env var)
"""

from __future__ import annotations

import enum
import hashlib
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)


class SessionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    TERMINATED = "TERMINATED"
    BROKEN = "BROKEN"
    RESTARTED = "RESTARTED"

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

SESSION_TTL_SECONDS = int(os.getenv("REDIS_SESSION_TTL", "604800"))  # 7 days
IMPOSSIBLE_TRAVEL_WINDOW = int(os.getenv("IMPOSSIBLE_TRAVEL_WINDOW", "1800"))  # 30 min
IMPOSSIBLE_TRAVEL_DISTANCE_KM = float(os.getenv("IMPOSSIBLE_TRAVEL_DISTANCE_KM", "1000"))


# ─────────────────────────────────────────────────────────────────────────────
# Data Structures
# ─────────────────────────────────────────────────────────────────────────────

class Session:
    """Active user session with device fingerprinting info and state management."""

    def __init__(
        self,
        session_id: str,
        user_id: str,
        user_email: str,
        device_id: str,
        ip_address: str,
        device_type: str,
        user_agent: str = "",
        os_name: str = "",
        browser_name: str = "",
        browser_version: str = "",
        city: str = "",
        country: str = "",
        status: SessionStatus = SessionStatus.ACTIVE,
    ):
        self.session_id = session_id
        self.user_id = user_id
        self.user_email = user_email
        self.device_id = device_id
        self.ip_address = ip_address
        self.device_type = device_type
        self.user_agent = user_agent
        self.os_name = os_name
        self.browser_name = browser_name
        self.browser_version = browser_version
        self.city = city
        self.country = country
        self.created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
        self.last_seen = self.created_at
        self.status = status
        self.terminated_at = None
        self.termination_reason = None
        self.is_active = (self.status == SessionStatus.ACTIVE)

    def to_dict(self) -> dict:
        """Serialize to JSON-safe dict."""
        return {
            "id": self.session_id,
            "user_id": self.user_id,
            "user_email": self.user_email,
            "device_id": self.device_id,
            "ip_address": self.ip_address,
            "device_type": self.device_type,
            "user_agent": self.user_agent,
            "os_name": self.os_name,
            "browser_name": self.browser_name,
            "browser_version": self.browser_version,
            "city": self.city,
            "country": self.country,
            "created_at": self.created_at,
            "last_seen": self.last_seen,
            "status": self.status.value,
            "terminated_at": self.terminated_at,
            "termination_reason": self.termination_reason,
            "is_active": self.is_active,
        }

    @classmethod
    def from_dict(cls, data: dict) -> Session:
        """Deserialize from dict."""
        status = data.get("status", "ACTIVE")
        try:
            status_enum = SessionStatus(status)
        except ValueError:
            status_enum = SessionStatus.ACTIVE
        
        s = cls(
            session_id=data.get("id", ""),
            user_id=data.get("user_id", ""),
            user_email=data.get("user_email", ""),
            device_id=data.get("device_id", ""),
            ip_address=data.get("ip_address", ""),
            device_type=data.get("device_type", ""),
            user_agent=data.get("user_agent", ""),
            os_name=data.get("os_name", ""),
            browser_name=data.get("browser_name", ""),
            browser_version=data.get("browser_version", ""),
            city=data.get("city", ""),
            country=data.get("country", ""),
            status=status_enum,
        )
        s.created_at = data.get("created_at", s.created_at)
        s.last_seen = data.get("last_seen", s.last_seen)
        s.terminated_at = data.get("terminated_at", None)
        s.termination_reason = data.get("termination_reason", None)
        s.is_active = data.get("is_active", True)
        return s

    def terminate(self, reason: str = "") -> None:
        """Mark session as terminated."""
        self.status = SessionStatus.TERMINATED
        self.terminated_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
        self.termination_reason = reason
        self.is_active = False

    def mark_broken(self, reason: str = "") -> None:
        """Mark session as broken."""
        self.status = SessionStatus.BROKEN
        self.terminated_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
        self.termination_reason = reason
        self.is_active = False

    def restart(self) -> None:
        """Mark session as restarted."""
        self.status = SessionStatus.RESTARTED
        self.last_seen = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
        self.terminated_at = None
        self.termination_reason = None
        self.is_active = True


# ─────────────────────────────────────────────────────────────────────────────
# Redis Connection
# ─────────────────────────────────────────────────────────────────────────────

def _get_redis():
    """Lazy Redis connection with error handling."""
    try:
        import redis

        from services.api_gateway.app.auth import resolve_redis_url

        url = resolve_redis_url()
        r = redis.Redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
        r.ping()
        return r
    except Exception as e:
        logger.warning("[SESSION-MGR] Redis unavailable: %s", e)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Device Fingerprinting
# ─────────────────────────────────────────────────────────────────────────────

def hash_device(user_agent: str, os_name: str) -> str:
    """Generate stable device ID hash from User-Agent + OS.

    This creates a unique fingerprint for each (browser, OS) pair.
    Two devices with identical UA and OS will have the same device_id.
    """
    key = f"{user_agent}#{os_name}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


# ─────────────────────────────────────────────────────────────────────────────
# Session CRUD Operations
# ─────────────────────────────────────────────────────────────────────────────

def create_session(
    user_id: str,
    user_email: str,
    device_id: str,
    ip_address: str,
    device_type: str,
    user_agent: str = "",
    os_name: str = "",
    browser_name: str = "",
    browser_version: str = "",
    city: str = "",
    country: str = "",
) -> str:
    """Create and store a new session. Returns session_id."""

    r = _get_redis()
    session_id = secrets.token_hex(16)

    session = Session(
        session_id=session_id,
        user_id=user_id,
        user_email=user_email,
        device_id=device_id,
        ip_address=ip_address,
        device_type=device_type,
        user_agent=user_agent,
        os_name=os_name,
        browser_name=browser_name,
        browser_version=browser_version,
        city=city,
        country=country,
    )

    if r:
        try:
            # Store session by ID
            key = f"session:{session_id}"
            r.setex(key, SESSION_TTL_SECONDS, json.dumps(session.to_dict()))

            # Track session in user's session list
            user_key = f"user_sessions:{user_email.lower()}"
            r.sadd(user_key, session_id)
            r.expire(user_key, SESSION_TTL_SECONDS)

            logger.info(
                "[SESSION-MGR] session created: %s for %s (%s)",
                session_id[:8],
                user_email,
                device_id,
            )
        except Exception as e:
            logger.error("[SESSION-MGR] failed to store session: %s", e)
    else:
        logger.warning("[SESSION-MGR] Redis unavailable; session not persisted")

    return session_id


def get_user_sessions(user_email: str) -> list[Session]:
    """Fetch all active sessions for a user."""

    r = _get_redis()
    if not r:
        return []

    try:
        user_key = f"user_sessions:{user_email.lower()}"
        session_ids = r.smembers(user_key)

        sessions = []
        for sid in session_ids:
            key = f"session:{sid}"
            data = r.get(key)
            if data:
                try:
                    session_data = json.loads(data)
                    sessions.append(Session.from_dict(session_data))
                except json.JSONDecodeError:
                    logger.warning("[SESSION-MGR] corrupted session data: %s", sid)
                    r.delete(key)

        return sessions
    except Exception as e:
        logger.error("[SESSION-MGR] failed to fetch sessions: %s", e)
        return []


def get_session(session_id: str) -> Optional[Session]:
    """Fetch a single session by ID."""

    r = _get_redis()
    if not r:
        return None

    try:
        key = f"session:{session_id}"
        data = r.get(key)
        if data:
            return Session.from_dict(json.loads(data))
    except Exception as e:
        logger.error("[SESSION-MGR] failed to fetch session: %s", e)

    return None


def revoke_session(session_id: str, user_email: str) -> bool:
    """Revoke a session (logout from device)."""

    r = _get_redis()
    if not r:
        return False

    try:
        key = f"session:{session_id}"
        r.delete(key)

        user_key = f"user_sessions:{user_email.lower()}"
        r.srem(user_key, session_id)

        logger.info(
            "[SESSION-MGR] session revoked: %s for %s", session_id[:8], user_email
        )
        return True
    except Exception as e:
        logger.error("[SESSION-MGR] failed to revoke session: %s", e)
        return False


def revoke_all_sessions(user_email: str) -> bool:
    """Revoke all sessions for a user (e.g., on password change)."""

    r = _get_redis()
    if not r:
        return False

    try:
        user_key = f"user_sessions:{user_email.lower()}"
        session_ids = r.smembers(user_key)

        for sid in session_ids:
            key = f"session:{sid}"
            r.delete(key)

        r.delete(user_key)

        logger.info(
            "[SESSION-MGR] all sessions revoked for %s (%d sessions)",
            user_email,
            len(session_ids),
        )
        return True
    except Exception as e:
        logger.error("[SESSION-MGR] failed to revoke all sessions: %s", e)
        return False


def update_session_last_seen(session_id: str, ip_address: str = "") -> bool:
    """Update session's last_seen timestamp (called on each request)."""

    r = _get_redis()
    if not r:
        return False

    try:
        key = f"session:{session_id}"
        data = r.get(key)
        if data:
            session = Session.from_dict(json.loads(data))
            session.last_seen = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
            if ip_address:
                session.ip_address = ip_address
            r.setex(key, SESSION_TTL_SECONDS, json.dumps(session.to_dict()))
            return True
    except Exception as e:
        logger.error("[SESSION-MGR] failed to update session: %s", e)

    return False


# ─────────────────────────────────────────────────────────────────────────────
# Security Analysis
# ─────────────────────────────────────────────────────────────────────────────

def check_impossible_travel(user_email: str, new_ip: str) -> dict:
    """Detect impossible travel (IP change in short time over large distance).

    Returns:
        {
            "flagged": bool,
            "reason": str,
            "last_ip": str,
            "last_seen": str,
            "time_since_last": int (seconds)
        }
    """

    sessions = get_user_sessions(user_email)
    if not sessions:
        return {
            "flagged": False,
            "reason": "First login",
            "last_ip": None,
            "last_seen": None,
            "time_since_last": None,
        }

    # Get most recent session
    last_session = sorted(sessions, key=lambda s: s.last_seen)[-1]
    last_ip = last_session.ip_address

    if last_ip == new_ip:
        return {
            "flagged": False,
            "reason": "Same IP",
            "last_ip": last_ip,
            "last_seen": last_session.last_seen,
            "time_since_last": None,
        }

    # Calculate time since last activity
    try:
        last_seen = datetime.fromisoformat(last_session.last_seen.rstrip("Z"))
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        time_delta = (now - last_seen).total_seconds()

        # Flag if IP changed in < IMPOSSIBLE_TRAVEL_WINDOW
        if time_delta < IMPOSSIBLE_TRAVEL_WINDOW:
            logger.warning(
                "[SESSION-MGR] impossible travel detected for %s: %s → %s in %d sec",
                user_email,
                last_ip,
                new_ip,
                int(time_delta),
            )
            return {
                "flagged": True,
                "reason": f"IP changed in {int(time_delta)}s (threshold: {IMPOSSIBLE_TRAVEL_WINDOW}s)",
                "last_ip": last_ip,
                "last_seen": last_session.last_seen,
                "time_since_last": int(time_delta),
            }
    except Exception as e:
        logger.error("[SESSION-MGR] failed to check impossible travel: %s", e)

    return {
        "flagged": False,
        "reason": "Time window OK",
        "last_ip": last_ip,
        "last_seen": last_session.last_seen,
        "time_since_last": None,
    }
