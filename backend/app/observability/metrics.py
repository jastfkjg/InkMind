"""自定义指标定义，使用 Prometheus 客户端库。

主要监控指标：
- 请求量（Counter）：各 API 端点的请求次数
- 响应时间（Histogram）：各 API 端点的响应时间分布
- 错误率（Counter）：各 API 端点的错误次数
- LLM 相关指标：
  - llm_requests_total：LLM 请求总数
  - llm_requests_failed：LLM 失败请求数
  - llm_duration_seconds：LLM 请求响应时间
  - llm_tokens_total：LLM token 使用量
  - llm_tokens_input：LLM 输入 token 数
  - llm_tokens_output：LLM 输出 token 数
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from prometheus_client import Counter, Histogram, start_http_server

from app.config import settings

# 指标命名前缀
PREFIX = "inkmind"

# ==================== HTTP API 指标 ====================

# 请求总数
http_requests_total = Counter(
    f"{PREFIX}_http_requests_total",
    "Total number of HTTP requests",
    ["method", "endpoint", "status_code"],
)

# 请求持续时间（直方图）
http_request_duration_seconds = Histogram(
    f"{PREFIX}_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "endpoint"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 180.0],
)

# 活跃请求数
http_requests_in_flight = Counter(
    f"{PREFIX}_http_requests_in_flight",
    "Number of HTTP requests currently being processed",
    ["method", "endpoint"],
)

# ==================== AI/LLM 操作指标 ====================

# AI 操作类型枚举
AI_OPERATIONS = [
    "generate",        # AI 生成章节
    "rewrite",         # AI 改写
    "append",          # AI 追加
    "evaluate",        # AI 评估
    "expand",          # AI 扩写
    "polish",          # AI 润色
    "ask",             # AI 提问
    "naming",          # AI 起名
    "inspire",         # AI 灵感生成
    "summarize",       # AI 摘要
    "title_suggest",   # AI 标题建议
    "context_retrieve",# 上下文检索
]

# LLM 请求总数
llm_requests_total = Counter(
    f"{PREFIX}_llm_requests_total",
    "Total number of LLM API requests",
    ["provider", "model", "operation"],
)

# LLM 失败请求数
llm_requests_failed = Counter(
    f"{PREFIX}_llm_requests_failed",
    "Number of failed LLM API requests",
    ["provider", "model", "operation", "error_type"],
)

# LLM 请求持续时间
llm_request_duration_seconds = Histogram(
    f"{PREFIX}_llm_request_duration_seconds",
    "LLM request duration in seconds",
    ["provider", "model", "operation"],
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 180.0, 300.0],
)

# LLM Token 使用总量
llm_tokens_total = Counter(
    f"{PREFIX}_llm_tokens_total",
    "Total number of tokens used",
    ["provider", "model", "operation", "type"],
)

# LLM 输入 Token 数
llm_tokens_input = Counter(
    f"{PREFIX}_llm_tokens_input",
    "Number of input tokens",
    ["provider", "model", "operation"],
)

# LLM 输出 Token 数
llm_tokens_output = Counter(
    f"{PREFIX}_llm_tokens_output",
    "Number of output tokens",
    ["provider", "model", "operation"],
)

# ==================== 业务指标 ====================

# 章节创建数
chapters_created_total = Counter(
    f"{PREFIX}_chapters_created_total",
    "Total number of chapters created",
    ["source"],  # manual, ai_generate, batch
)

# 章节修改数
chapters_updated_total = Counter(
    f"{PREFIX}_chapters_updated_total",
    "Total number of chapters updated",
    ["source"],  # manual, ai_rewrite, ai_append, ai_expand, ai_polish
)

# 版本创建数
versions_created_total = Counter(
    f"{PREFIX}_versions_created_total",
    "Total number of chapter versions created",
    ["change_type"],  # manual, ai_generate, ai_rewrite, etc.
)

# 版本回滚数
versions_rollback_total = Counter(
    f"{PREFIX}_versions_rollback_total",
    "Total number of chapter version rollbacks",
)

# 导出版本
exports_total = Counter(
    f"{PREFIX}_exports_total",
    "Total number of novel exports",
    ["format"],  # txt, pdf, epub, docx
)

# ==================== 便捷函数 ====================


def increment_http_request(
    method: str,
    endpoint: str,
    status_code: int,
) -> None:
    """记录 HTTP 请求。"""
    http_requests_total.labels(
        method=method,
        endpoint=endpoint,
        status_code=str(status_code),
    ).inc()


def observe_http_duration(
    method: str,
    endpoint: str,
    duration: float,
) -> None:
    """记录 HTTP 请求持续时间。"""
    http_request_duration_seconds.labels(
        method=method,
        endpoint=endpoint,
    ).observe(duration)


def increment_llm_request(
    provider: str,
    model: str,
    operation: str,
) -> None:
    """记录 LLM 请求。"""
    llm_requests_total.labels(
        provider=provider,
        model=model,
        operation=operation,
    ).inc()


def increment_llm_failure(
    provider: str,
    model: str,
    operation: str,
    error_type: str,
) -> None:
    """记录 LLM 失败请求。"""
    llm_requests_failed.labels(
        provider=provider,
        model=model,
        operation=operation,
        error_type=error_type,
    ).inc()


def observe_llm_duration(
    provider: str,
    model: str,
    operation: str,
    duration: float,
) -> None:
    """记录 LLM 请求持续时间。"""
    llm_request_duration_seconds.labels(
        provider=provider,
        model=model,
        operation=operation,
    ).observe(duration)


def record_llm_tokens(
    provider: str,
    model: str,
    operation: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    total_tokens: int | None = None,
) -> None:
    """记录 LLM Token 使用量。"""
    if input_tokens is not None and input_tokens > 0:
        llm_tokens_input.labels(
            provider=provider,
            model=model,
            operation=operation,
        ).inc(input_tokens)
        llm_tokens_total.labels(
            provider=provider,
            model=model,
            operation=operation,
            type="input",
        ).inc(input_tokens)
    
    if output_tokens is not None and output_tokens > 0:
        llm_tokens_output.labels(
            provider=provider,
            model=model,
            operation=operation,
        ).inc(output_tokens)
        llm_tokens_total.labels(
            provider=provider,
            model=model,
            operation=operation,
            type="output",
        ).inc(output_tokens)
    
    if total_tokens is not None and total_tokens > 0:
        llm_tokens_total.labels(
            provider=provider,
            model=model,
            operation=operation,
            type="total",
        ).inc(total_tokens)


@contextmanager
def track_llm_request(
    provider: str,
    model: str,
    operation: str,
) -> Iterator[dict[str, Any]]:
    """追踪 LLM 请求的上下文管理器。
    
    用法：
    with track_llm_request(provider="openai", model="gpt-4", operation="generate") as track:
        # 执行 LLM 请求
        result = llm.complete(...)
        # 记录 token 使用量
        track["input_tokens"] = result.usage.prompt_tokens
        track["output_tokens"] = result.usage.completion_tokens
    """
    import time
    
    start_time = time.time()
    track_data: dict[str, Any] = {}
    
    try:
        increment_llm_request(provider, model, operation)
        yield track_data
        # 成功
        duration = time.time() - start_time
        observe_llm_duration(provider, model, operation, duration)
        
        # 记录 token 使用量
        if track_data:
            record_llm_tokens(
                provider=provider,
                model=model,
                operation=operation,
                input_tokens=track_data.get("input_tokens"),
                output_tokens=track_data.get("output_tokens"),
                total_tokens=track_data.get("total_tokens"),
            )
    except Exception as e:
        # 失败
        duration = time.time() - start_time
        observe_llm_duration(provider, model, operation, duration)
        error_type = type(e).__name__
        increment_llm_failure(provider, model, operation, error_type)
        raise


@contextmanager
def track_http_request(
    method: str,
    endpoint: str,
) -> Iterator[dict[str, Any]]:
    """追踪 HTTP 请求的上下文管理器。"""
    import time
    
    start_time = time.time()
    track_data: dict[str, Any] = {"status_code": 200}
    
    http_requests_in_flight.labels(method=method, endpoint=endpoint).inc()
    
    try:
        yield track_data
    finally:
        http_requests_in_flight.labels(method=method, endpoint=endpoint).dec()
        duration = time.time() - start_time
        observe_http_duration(method, endpoint, duration)
        increment_http_request(method, endpoint, track_data.get("status_code", 200))


# ==================== 启动 Prometheus 服务 ====================


def start_prometheus_server() -> None:
    """启动 Prometheus HTTP 服务器。"""
    if settings.prometheus_enabled:
        start_http_server(settings.prometheus_port)
        print(f"Prometheus metrics server started on port {settings.prometheus_port}")
        print(f"Metrics available at: http://localhost:{settings.prometheus_port}/metrics")
