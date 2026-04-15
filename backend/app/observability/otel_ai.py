"""AI/LLM 路径的手动 Span（流式场景需在生成器内打点；未启用 OTEL 时为 no-op）。"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from opentelemetry import trace

from app.config import settings

TRACER_NAME = "inkmind.ai"


def _tracer():
    return trace.get_tracer(TRACER_NAME, "1.0.0")


def _norm_attrs(**attrs: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in attrs.items():
        if v is None:
            continue
        if isinstance(v, (bool, int, float, str)):
            out[k] = v
        else:
            out[k] = str(v)
    return out


@contextmanager
def ai_span(name: str, **attributes: Any) -> Iterator[Any]:
    """创建子 Span，自动记录耗时；OTEL 未启用时无开销。"""
    if not settings.otel_enabled:
        yield None
        return
    with _tracer().start_as_current_span(name, attributes=_norm_attrs(**attributes)) as span:
        yield span
