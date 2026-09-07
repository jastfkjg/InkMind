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
