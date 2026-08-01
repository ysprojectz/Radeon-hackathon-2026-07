"""
Request/Response Logging Middleware for API Gateway.
Logs every request with method, path, status_code, latency_ms, user_id, tenant_id, trace_id.
Excludes sensitive paths: /auth/login, /auth/totp.
Outputs JSON structured logs to stdout.
"""

import json
import logging
import time
import uuid
from typing import Callable
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Handler to output to stdout with UTF-8 encoding
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that logs requests and responses in JSON format.
    
    Logs: method, path, status_code, latency_ms, user_id, tenant_id, trace_id
    Excludes sensitive paths: /auth/login, /auth/totp
    """
    
    # Sensitive paths to exclude from logging (to avoid logging passwords/secrets)
    SENSITIVE_PATHS = {"/auth/login", "/auth/totp"}
    
    def __init__(self, app: ASGIApp):
        super().__init__(app)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip logging for sensitive paths
        if request.url.path in self.SENSITIVE_PATHS:
            return await call_next(request)
        
        # Generate or get request ID
        request_id = str(uuid.uuid4())
        
        # Start timer
        start_time = time.time()
        
        # Process request first — auth middleware and endpoint handlers set request.state
        # during call_next, so we must read state values AFTER the call returns.
        response = await call_next(request)
        
        # Calculate latency
        latency_ms = (time.time() - start_time) * 1000
        
        # Extract user info from request state AFTER processing
        user_id = getattr(request.state, "user_id", None)
        tenant_id = getattr(request.state, "tenant_id", None)
        trace_id = getattr(request.state, "trace_id", request_id)
        
        # Prepare log entry
        log_entry = {
            "timestamp": time.time(),
            "level": "INFO",
            "message": "HTTP request processed",
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "latency_ms": round(latency_ms, 2),
            "request_id": request_id,
            "trace_id": trace_id,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "user_agent": request.headers.get("user-agent"),
            "ip": request.headers.get("x-forwarded-for", request.client.host if request.client else None)
        }
        
        # Log as JSON
        logger.info(json.dumps(log_entry, ensure_ascii=False))
        
        return response
