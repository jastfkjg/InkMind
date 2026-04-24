"""OpenTelemetry：HTTP 自动插桩 + 导出（控制台或 OTLP）。由 OTEL_ENABLED 控制。

Prometheus：指标端点，监控关键性能指标。由 PROMETHEUS_ENABLED 控制。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

if TYPE_CHECKING:
    from fastapi import FastAPI


def setup_otel(app: "FastAPI") -> None:
    from app.config import settings

    if settings.prometheus_enabled:
        from app.observability.metrics import start_prometheus_server
        start_prometheus_server()

    if not settings.otel_enabled:
        return

    resource = Resource.create(
        {
            "service.name": settings.otel_service_name,
            "service.version": "1.0.0",
        }
    )
    provider = TracerProvider(resource=resource)

    endpoint = (settings.otel_exporter_otlp_endpoint or "").strip().rstrip("/")
    if endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        traces_url = endpoint if endpoint.endswith("/v1/traces") else f"{endpoint}/v1/traces"
        exporter = OTLPSpanExporter(endpoint=traces_url)
    else:
        exporter = ConsoleSpanExporter()

    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from app.database import engine
        
        SQLAlchemyInstrumentor().instrument(
            engine=engine,
            service=settings.otel_service_name,
        )
        print("SQLAlchemy instrumentation enabled")
    except ImportError:
        print("SQLAlchemy instrumentation not available (opentelemetry-instrumentation-sqlalchemy not installed)")
    except Exception as e:
        print(f"Failed to enable SQLAlchemy instrumentation: {e}")

    FastAPIInstrumentor().instrument_app(app)
    HTTPXClientInstrumentor().instrument()
