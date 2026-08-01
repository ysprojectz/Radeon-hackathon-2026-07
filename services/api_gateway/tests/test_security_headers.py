"""
Test for Security Headers Middleware.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from services.api_gateway.app.security_headers import SecurityHeadersMiddleware


def test_security_headers_middleware():
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/test")
    async def test_endpoint():
        return {"message": "ok"}

    client = TestClient(app)
    response = client.get("/test")

    # Check that the response has the expected security headers
    expected_headers = {
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'strict-dynamic' 'unsafe-inline' http: https:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
    }

    for header, expected_value in expected_headers.items():
        assert header in response.headers
        assert response.headers[header] == expected_value