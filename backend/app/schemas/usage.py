from datetime import datetime

from pydantic import BaseModel


class LLMUsageItemOut(BaseModel):
    id: int
    provider: str
    action: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    created_at: datetime

    model_config = {"from_attributes": True}


class LLMUsageListOut(BaseModel):
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    items: list[LLMUsageItemOut]
