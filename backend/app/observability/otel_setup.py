"""OpenTelemetry：HTTP 自动插桩 + 导出（控制台或 OTLP）。由 OTEL_ENABLED 控制。"""

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

    FastAPIInstrumentor().instrument_app(app)
    HTTPXClientInstrumentor().instrument()
