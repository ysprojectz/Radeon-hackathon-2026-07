"""
Test for Metrics Module.
"""

from unittest.mock import patch

from services.api_gateway.app.metrics import (
    HTTP_REQUESTS_TOTAL,
    HTTP_REQUEST_DURATION_SECONDS,
    ACTIVE_CONNECTIONS,
    LLM_REQUESTS_TOTAL,
    CIRCUIT_BREAKER_STATE,
    RATE_LIMITED_REQUESTS_TOTAL,
    CLAIM_PROCESSING_DURATION_SECONDS,
    update_db_connections,
    update_redis_connections,
    record_http_request,
    record_llm_request,
    set_circuit_breaker_state,
    record_rate_limited_request,
    record_claim_processing_duration
)


def test_metrics_initialization():
    """Test that metrics are properly initialized."""
    # Just test that we can access the metrics without errors
    assert HTTP_REQUESTS_TOTAL is not None
    assert HTTP_REQUEST_DURATION_SECONDS is not None
    assert ACTIVE_CONNECTIONS is not None
    assert LLM_REQUESTS_TOTAL is not None
    assert CIRCUIT_BREAKER_STATE is not None
    assert RATE_LIMITED_REQUESTS_TOTAL is not None
    assert CLAIM_PROCESSING_DURATION_SECONDS is not None


def test_update_db_connections():
    """Test updating DB connections gauge."""
    with patch.object(ACTIVE_CONNECTIONS.labels(type="db"), "set") as mock_set:
        update_db_connections(10)
        mock_set.assert_called_once_with(10)


def test_update_redis_connections():
    """Test updating Redis connections gauge."""
    with patch.object(ACTIVE_CONNECTIONS.labels(type="redis"), "set") as mock_set:
        update_redis_connections(5)
        mock_set.assert_called_once_with(5)


def test_record_http_request():
    """Test recording HTTP request metrics."""
    with patch.object(HTTP_REQUESTS_TOTAL.labels(method="GET", endpoint="/test", status="200", tenant="tenant1"), "inc") as mock_inc1, \
         patch.object(HTTP_REQUEST_DURATION_SECONDS.labels(method="GET", endpoint="/test"), "observe") as mock_observe:
        
        record_http_request("GET", "/test", 200, 0.5, "tenant1")
        
        mock_inc1.assert_called_once()
        mock_observe.assert_called_once_with(0.5)


def test_record_llm_request():
    """Test recording LLM request metrics."""
    with patch.object(LLM_REQUESTS_TOTAL.labels(provider="anthropic", status="success"), "inc") as mock_inc:
        record_llm_request("anthropic", "success")
        mock_inc.assert_called_once()


def test_set_circuit_breaker_state():
    """Test setting circuit breaker state."""
    with patch.object(CIRCUIT_BREAKER_STATE.labels(provider="test-provider"), "set") as mock_set:
        # Test closed state
        set_circuit_breaker_state("test-provider", "closed")
        mock_set.assert_called_with(0)
        
        # Test open state
        mock_set.reset_mock()
        set_circuit_breaker_state("test-provider", "open")
        mock_set.assert_called_with(1)
        
        # Test half-open state
        mock_set.reset_mock()
        set_circuit_breaker_state("test-provider", "half-open")
        mock_set.assert_called_with(2)


def test_record_rate_limited_request():
    """Test recording rate limited request."""
    with patch.object(RATE_LIMITED_REQUESTS_TOTAL.labels(endpoint="/api/test"), "inc") as mock_inc:
        record_rate_limited_request("/api/test")
        mock_inc.assert_called_once()


def test_record_claim_processing_duration():
    """Test recording claim processing duration."""
    with patch.object(CLAIM_PROCESSING_DURATION_SECONDS, "observe") as mock_observe:
        record_claim_processing_duration(5.5)
        mock_observe.assert_called_once_with(5.5)