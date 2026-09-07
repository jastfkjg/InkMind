from typing import Literal

from pydantic import BaseModel

ConnectionStatus = Literal[
    "ok", "unconfigured", "authentication", "permission", "not_supported",
    "timeout", "rate_limit", "unavailable",
]


class LLMConnectionCheckRequest(BaseModel):
    target: Literal["generation", "agent"]

    model_config = {"extra": "forbid"}


class LLMConnectionCheckResponse(BaseModel):
    status: ConnectionStatus


ProbeMode = Literal["models", "model"]


class LLMProbeRequest(BaseModel):
    target: Literal["generation", "agent"]
    mode: ProbeMode
    model_config = {"extra": "forbid"}


class LLMDraftProbeRequest(BaseModel):
    provider: str
    protocol: Literal["openai", "anthropic"]
    base_url: str
    default_model: str = ""
    api_key: str | None = None
    custom_llm_id: int | None = None
    mode: ProbeMode
    model_config = {"extra": "forbid"}


class LLMProbeResponse(BaseModel):
    mode: ProbeMode
    status: str
    models: list[str] = []
    http_status: int | None = None
