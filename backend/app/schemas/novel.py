from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_serializer


def _utc_dt(v: datetime) -> datetime:
    """Ensure datetime is treated as UTC in ISO format."""
    if v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


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

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()
