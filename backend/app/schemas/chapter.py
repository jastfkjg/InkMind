from datetime import datetime

from pydantic import BaseModel, Field


class ChapterCreate(BaseModel):
    title: str = Field(default="", max_length=512)
    summary: str = ""
    content: str = ""
    sort_order: int = 0


class ChapterUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=512)
    summary: str | None = None
    content: str | None = None
    sort_order: int | None = None


class ChapterOut(BaseModel):
    id: int
    novel_id: int
    title: str
    summary: str
    content: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChapterGenerateIn(BaseModel):
    summary: str = Field(..., min_length=1, description="本章概要，用于生成正文")
    chapter_id: int | None = Field(
        default=None,
        description="若提供则写入该章节；否则新建一章",
    )
    llm_provider: str | None = Field(
        default=None,
        description="openai / anthropic / qwen / deepseek，留空则使用 DEFAULT_LLM_PROVIDER",
    )
