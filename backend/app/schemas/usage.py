from datetime import datetime, timezone

from pydantic import BaseModel, field_serializer


def _utc_dt(v: datetime) -> datetime:
    """Ensure datetime is treated as UTC in ISO format."""
    if v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


class LLMUsageItemOut(BaseModel):
    id: int
    provider: str
    action: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()


class LLMUsageListOut(BaseModel):
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    items: list[LLMUsageItemOut]
