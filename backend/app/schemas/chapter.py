from datetime import datetime
from typing import Literal

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


class ChapterReviseIn(BaseModel):
    instruction: str = Field(..., min_length=1, description="对当前章节的修改说明")
    llm_provider: str | None = Field(
        default=None,
        description="留空则使用用户偏好或全局默认",
    )
    mode: Literal["rewrite", "append"] = Field(
        default="rewrite",
        description="rewrite=整体改写正文；append=仅在文末追加新内容",
    )


class ChapterSuggestTitleIn(BaseModel):
    hint: str | None = Field(default=None, description="对标题方向的补充说明，可空")


class ChapterSuggestTitleOut(BaseModel):
    title: str


class ChapterGenerateIn(BaseModel):
    summary: str = Field(..., min_length=1, description="本章概要，用于生成正文")
    chapter_id: int | None = Field(
        default=None,
        description="若提供则写入该章节；否则新建一章",
    )
    title: str | None = Field(
        default=None,
        description="若填写则固定为该章节标题，仅生成正文；留空则模型同时返回标题与正文（JSON）",
    )


class ChapterEvaluateIssue(BaseModel):
    aspect: str = Field(..., description="问题点简述")
    detail: str = Field(..., description="为何不理想")


class ChapterEvaluateOut(BaseModel):
    issues: list[ChapterEvaluateIssue] = Field(default_factory=list)
    de_ai_score: int = Field(
        ...,
        ge=0,
        le=100,
        description="去 AI 化分数：越高越接近自然人类文风，越少套话与机械感",
    )


class ChapterEvaluateIn(BaseModel):
    llm_provider: str | None = Field(
        default=None,
        description="留空则使用用户偏好或全局默认",
    )
    title: str | None = Field(default=None, description="评估时使用的章节标题；为空则用数据库中的值")
    summary: str | None = Field(default=None, description="评估时使用的本章概要；为空则用数据库中的值")
    content: str | None = Field(
        default=None,
        description="评估时使用的正文；为空则用数据库中的值。写作页应传当前编辑器内容。",
    )


class ChapterSelectionAiIn(BaseModel):
    """正文选区：扩写或润色。chapter_content 为当前编辑器全文，用于校验选区。"""
    mode: Literal["expand", "polish"] = Field(..., description="expand=扩写；polish=润色")
    selected_text: str = Field(..., min_length=1, max_length=8000, description="选中的片段")
    chapter_content: str = Field(
        ...,
        description="当前章节完整正文（与编辑器一致），服务端校验选区是否属于该文本",
    )
    llm_provider: str | None = Field(
        default=None,
        description="留空则使用用户偏好或全局默认",
    )
