"""
Optional OpenTelemetry helpers.

Tracing is enabled only when OpenTelemetry packages are installed and
ENABLE_OPENTELEMETRY=true. The rest of the application can call these helpers
without taking a hard runtime dependency on the OTEL stack.
"""
from __future__ import annotations

import contextlib
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_ENABLED = os.getenv("ENABLE_OPENTELEMETRY", "false").lower() == "true"
_TRACER = None
_TRACE_API = None
_FASTAPI_INSTRUMENTOR = None
_HTTPX_INSTRUMENTOR = None
_REDIS_INSTRUMENTOR = None
_POSTGRESQL_INSTRUMENTOR = None


def configure_tracing(service_name: str = "claims-api-gateway") -> bool:
    """Initialize OTEL provider/exporter if available and enabled.
    
    Supports OTLP exporter via OTEL_EXPORTER_OTLP_ENDPOINT environment variable.
    Configures sampling rate via OTEL_TRACES_SAMPLER_ARG (default 0.1 for 10%).
    """
    global _TRACER, _TRACE_API, _FASTAPI_INSTRUMENTOR, _HTTPX_INSTRUMENTOR, _REDIS_INSTRUMENTOR, _POSTGRESQL_INSTRUMENTOR
    if not _ENABLED or _TRACER is not None:
        return _TRACER is not None

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.trace.sampling import TraceIdRatioBased
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        from opentelemetry.instrumentation.redis import RedisInstrumentor
        from opentelemetry.instrumentation.postgresql import PostgreSQLInstrumentor

        # Get sampling rate from environment (default 10%)
        sampling_rate = float(os.getenv("OTEL_TRACES_SAMPLER_ARG", "0.1"))
        
        # Configure resource
        resource = Resource.create({
            "service.name": service_name,
            "service.version": os.getenv("SERVICE_VERSION", "1.0.0"),
            "deployment.environment": os.getenv("ENVIRONMENT", "development")
        })

        # Configure provider with sampling
        provider = TracerProvider(
            resource=resource,
            sampler=TraceIdRatioBased(sampling_rate)
        )

        # Configure exporter - OTLP if endpoint provided, otherwise console
        otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        if otlp_endpoint:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
            exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
        else:
            from opentelemetry.sdk.trace.export import ConsoleSpanExporter
            exporter = ConsoleSpanExporter()
            
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        _TRACE_API = trace
        _TRACER = trace.get_tracer(service_name)
        _FASTAPI_INSTRUMENTOR = FastAPIInstrumentor
        _HTTPX_INSTRUMENTOR = HTTPXClientInstrumentor
        _REDIS_INSTRUMENTOR = RedisInstrumentor
        _POSTGRESQL_INSTRUMENTOR = PostgreSQLInstrumentor
        
        logger.info("OpenTelemetry tracing enabled for %s with sampling rate %s", service_name, sampling_rate)
        if otlp_endpoint:
            logger.info("Exporting traces to OTLP endpoint: %s", otlp_endpoint)
        else:
            logger.info("Exporting traces to console")
            
        return True
    except Exception as exc:
        logger.warning("OpenTelemetry unavailable; tracing disabled: %s", exc)
        _TRACER = None
        _TRACE_API = None
        _FASTAPI_INSTRUMENTOR = None
        _HTTPX_INSTRUMENTOR = None
        _REDIS_INSTRUMENTOR = None
        _POSTGRESQL_INSTRUMENTOR = None
        return False


def instrument_fastapi(app) -> bool:
    """Attach FastAPI instrumentation when OTEL is enabled."""
    if configure_tracing() and _FASTAPI_INSTRUMENTOR is not None:
        try:
            _FASTAPI_INSTRUMENTOR.instrument_app(app)
            return True
        except Exception as exc:
            logger.debug("FastAPI OTEL instrumentation skipped: %s", exc)
    return False


def start_span(name: str, attributes: Optional[Dict[str, Any]] = None):
    """Return a context manager for an optional current span."""
    if _TRACER is None:
        return contextlib.nullcontext()
    return _TRACER.start_as_current_span(name, attributes=attributes or {})


def annotate_current_span(**attributes: Any) -> None:
    """Attach attributes to the current span when tracing is active."""
    if _TRACE_API is None:
        return
    try:
        span = _TRACE_API.get_current_span()
        if span:
            for key, value in attributes.items():
                if value is not None:
                    span.set_attribute(key, value)
    except Exception:
        pass


def get_trace_context() -> dict[str, Optional[str]]:
    """Return trace_id/span_id for the current span if available."""
    if _TRACE_API is None:
        return {"trace_id": None, "span_id": None}

    try:
        span = _TRACE_API.get_current_span()
        if not span:
            return {"trace_id": None, "span_id": None}
        ctx = span.get_span_context()
        if not getattr(ctx, "is_valid", False):
            return {"trace_id": None, "span_id": None}
        return {
            "trace_id": format(ctx.trace_id, "032x"),
            "span_id": format(ctx.span_id, "016x"),
        }
    except Exception:
        return {"trace_id": None, "span_id": None}
