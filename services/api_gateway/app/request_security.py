from __future__ import annotations

from typing import Iterable, Optional
from urllib.parse import urlparse

NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
SENSITIVE_RESPONSE_HEADERS = {
    "Cache-Control": NO_STORE_CACHE_CONTROL,
    "Pragma": "no-cache",
    "Expires": "0",
    "X-Content-Type-Options": "nosniff",
}

_AUTH_COOKIE_NAMES = ("access_token", "refresh_token")
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def apply_sensitive_response_headers(response) -> None:
    # Prevent auth responses from being stored in browser or proxy caches.
    for key, value in SENSITIVE_RESPONSE_HEADERS.items():
        response.headers[key] = value


def extract_origin_candidate(origin: Optional[str], referer: Optional[str]) -> Optional[str]:
    # Normalise Origin or Referer to a bare scheme+host for comparison.
    raw_value = (origin or "").strip() or (referer or "").strip()
    if not raw_value:
        return None
    parsed = urlparse(raw_value)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return None


def build_request_origin(
    host: Optional[str],
    x_forwarded_proto: Optional[str] = None,
) -> Optional[str]:
    # Reconstruct the server's own origin so it can be added to the trusted set.
    host_value = (host or "").strip()
    if not host_value:
        return None
    proto = (x_forwarded_proto or "").strip() or "http"
    return f"{proto}://{host_value}"


def has_auth_cookies(cookie_header: Optional[str]) -> bool:
    # Returns True only when the request carries a known session cookie.
    cookie_value = (cookie_header or "").strip()
    if not cookie_value:
        return False
    return any(
        f"{cookie_name}=" in cookie_value
        for cookie_name in _AUTH_COOKIE_NAMES
    )


def validate_cookie_authenticated_origin(
    *,
    method: str,
    cookie_header: Optional[str],
    origin: Optional[str],
    referer: Optional[str],
    host: Optional[str],
    x_forwarded_proto: Optional[str],
    allowed_origins: Iterable[str],
) -> Optional[str]:
    # Returns an error string if the request origin is untrusted, None if it should proceed.
    if method.upper() not in _UNSAFE_METHODS:
        return None
    if not has_auth_cookies(cookie_header):
        return None

    source_origin = extract_origin_candidate(origin, referer)
    if not source_origin:
        return None

    trusted_origins = {o.strip() for o in allowed_origins if o and o.strip()}
    request_origin = build_request_origin(host=host, x_forwarded_proto=x_forwarded_proto)
    if request_origin:
        trusted_origins.add(request_origin)

    if source_origin not in trusted_origins:
        return f"Cross-origin cookie-authenticated request blocked from {source_origin}"

    return None
