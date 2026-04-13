from datetime import datetime

from pydantic import BaseModel, Field


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


class RelationshipCreate(BaseModel):
    character_a_id: int
    character_b_id: int
    description: str = ""


class RelationshipUpdate(BaseModel):
    description: str | None = None


class RelationshipOut(BaseModel):
    id: int
    novel_id: int
    character_a_id: int
    character_b_id: int
    description: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
