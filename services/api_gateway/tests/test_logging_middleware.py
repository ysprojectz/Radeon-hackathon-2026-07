"""
Test for Logging Middleware.
"""

import json
import logging
from io import StringIO
from unittest.mock import patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from services.api_gateway.app.logging_middleware import LoggingMiddleware


def test_logging_middleware_basic():
    app = FastAPI()
    app.add_middleware(LoggingMiddleware)

    @app.get("/test")
    async def test_endpoint():
        return {"message": "ok"}

    # Capture logs
    log_stream = StringIO()
    handler = logging.StreamHandler(log_stream)
    logger = logging.getLogger("services.api_gateway.app.logging_middleware")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False

    client = TestClient(app)
    response = client.get("/test")

    # Check response
    assert response.status_code == 200
    assert response.json() == {"message": "ok"}

    # Check logs
    logger.removeHandler(handler)
    handler.flush()
    log_contents = log_stream.getvalue().strip()
    
    # Should have one log entry
    assert log_contents
    
    # Parse JSON log
    log_entry = json.loads(log_contents)
    
    # Verify required fields
    assert log_entry["method"] == "GET"
    assert log_entry["path"] == "/test"
    assert log_entry["status_code"] == 200
    assert "latency_ms" in log_entry
    assert log_entry["latency_ms"] >= 0
    assert "request_id" in log_entry
    assert "trace_id" in log_entry
    assert log_entry["message"] == "HTTP request processed"


def test_logging_middleware_excludes_sensitive_paths():
    app = FastAPI()
    app.add_middleware(LoggingMiddleware)

    @app.post("/auth/login")
    async def login_endpoint():
        return {"token": "fake-token"}

    @app.post("/auth/totp")
    async def totp_endpoint():
        return {"verified": True}

    # Capture logs
    log_stream = StringIO()
    handler = logging.StreamHandler(log_stream)
    logger = logging.getLogger("services.api_gateway.app.logging_middleware")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False

    client = TestClient(app)
    
    # Test login endpoint
    response = client.post("/auth/login", json={"username": "test", "password": "secret"})
    assert response.status_code == 200
    
    # Test totp endpoint
    response = client.post("/auth/totp", json={"code": "123456"})
    assert response.status_code == 200

    # Check logs - should be empty since these paths are excluded
    logger.removeHandler(handler)
    handler.flush()
    log_contents = log_stream.getvalue().strip()
    
    # Should have no log entries for excluded paths
    assert not log_contents


def test_logging_middleware_includes_user_and_tenant_info():
    app = FastAPI()
    app.add_middleware(LoggingMiddleware)

    @app.get("/protected")
    async def protected_endpoint(request: Request):
        # Simulate user info being set by auth middleware
        request.state.user_id = "user-123"
        request.state.tenant_id = "tenant-456"
        request.state.trace_id = "trace-789"
        return {"message": "ok"}

    # Capture logs
    log_stream = StringIO()
    handler = logging.StreamHandler(log_stream)
    logger = logging.getLogger("services.api_gateway.app.logging_middleware")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False

    client = TestClient(app)
    response = client.get("/protected")

    # Check response
    assert response.status_code == 200

    # Check logs
    logger.removeHandler(handler)
    handler.flush()
    log_contents = log_stream.getvalue().strip()
    
    # Should have one log entry
    assert log_contents
    
    # Parse JSON log
    log_entry = json.loads(log_contents)
    
    # Verify user and tenant info
    assert log_entry["user_id"] == "user-123"
    assert log_entry["tenant_id"] == "tenant-456"
    assert log_entry["trace_id"] == "trace-789"