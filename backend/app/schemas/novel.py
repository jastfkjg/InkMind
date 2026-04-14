from datetime import datetime

from pydantic import BaseModel, Field


class NovelCreate(BaseModel):
    title: str = Field(default="未命名作品", max_length=512)
    background: str = ""
    genre: str = Field(default="", max_length=128)
    writing_style: str = ""


class NovelUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=512)
    background: str | None = None
    genre: str | None = Field(default=None, max_length=128)
    writing_style: str | None = None


class NovelOut(BaseModel):
    id: int
    user_id: int
    title: str
    background: str
    genre: str
    writing_style: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
