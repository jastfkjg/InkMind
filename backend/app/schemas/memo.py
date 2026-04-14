from datetime import datetime

from pydantic import BaseModel, Field


class MemoCreate(BaseModel):
    title: str = Field(default="", max_length=512)
    body: str = ""


class MemoUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=512)
    body: str | None = None


class MemoOut(BaseModel):
    id: int
    novel_id: int
    title: str
    body: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
