from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_serializer


def _utc_dt(v: datetime) -> datetime:
    """Ensure datetime is treated as UTC in ISO format."""
    if v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


class CharacterCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    profile: str = ""
    notes: str = ""


class CharacterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    profile: str | None = None
    notes: str | None = None


class CharacterOut(BaseModel):
    id: int
    novel_id: int
    name: str
    profile: str
    notes: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()
