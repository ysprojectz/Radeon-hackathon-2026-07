"""
Security Headers Middleware for API Gateway.
Adds security headers to all HTTP responses.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from starlette.types import ASGIApp


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware that adds security headers to all responses.
    
    Headers added:
    - Content-Security-Policy (strict-dynamic, default-src 'self')
    - Strict-Transport-Security (max-age=31536000; includeSubDomains; preload)
    - X-Content-Type-Options: nosniff
    - X-Frame-Options: DENY
    - X-XSS-Protection: 1; mode=block
    - Referrer-Policy: strict-origin-when-cross-origin
    - Permissions-Policy: geolocation=(), microphone=(), camera=()
    """
    
    def __init__(self, app: ASGIApp):
        super().__init__(app)
        self.security_headers = {
            "Content-Security-Policy": "default-src 'self'; script-src 'self' 'strict-dynamic' 'unsafe-inline' http: https:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-XSS-Protection": "1; mode=block",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
        }
    
    async def dispatch(self, request, call_next):
        response: Response = await call_next(request)
        
        # Add security headers to response
        for header, value in self.security_headers.items():
            response.headers[header] = value
            
        return response