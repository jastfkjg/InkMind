from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_serializer


def _utc_dt(v: datetime) -> datetime:
    """Ensure datetime is treated as UTC in ISO format."""
    if v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


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

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()
