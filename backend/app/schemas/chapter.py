from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_serializer


def _utc_dt(v: datetime) -> datetime:
    """Ensure datetime is treated as UTC in ISO format."""
    if v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


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

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()


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
    lock_title: bool = Field(
        default=False,
        description="为 true 时强制沿用 title；否则即便当前章节原本有标题，也允许模型重新拟题",
    )
    word_count: int | None = Field(
        default=None,
        ge=500,
        le=4000,
        description="期望生成的正文字数（500-4000字），模型会尽量接近但不保证严格符合",
    )


class ChapterBatchGenerateIn(BaseModel):
    chapter_count: int = Field(
        ...,
        ge=1,
        le=20,
        description="批量生成章节数，最高 20 章",
    )
    total_summary: str = Field(..., min_length=1, description="接下来若干章的总概要")
    after_chapter_id: int | None = Field(
        default=None,
        description="从该章节之后插入生成；为空则追加到全书末尾",
    )
    word_count: int | None = Field(
        default=None,
        ge=500,
        le=4000,
        description="期望生成的每章正文字数（500-4000字），模型会尽量接近但不保证严格符合",
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


class ChapterVersionOut(BaseModel):
    id: int
    chapter_id: int
    version_number: int
    title: str
    summary: str
    content: str
    change_type: str
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()


class ChapterVersionDiffOut(BaseModel):
    diff_html: str
    diff_text: str
    added_count: int
    removed_count: int
    changed_count: int
    old_version: ChapterVersionOut | None = None
    new_version: ChapterVersionOut | None = None
    current_version: dict | None = None


class ChapterRollbackIn(BaseModel):
    version_id: int = Field(..., description="要回滚到的版本ID")
    save_current: bool = Field(
        default=True,
        description="是否保存当前版本作为历史版本后再回滚",
    )


class ChapterPreviewOut(BaseModel):
    title: str = Field(..., description="生成的章节标题")
    content: str = Field(..., description="生成的章节正文")
    summary: str = Field(..., description="本章概要")
    evaluate_result: ChapterEvaluateOut | None = Field(
        default=None,
        description="自动审核结果（如果启用了自动审核）",
    )
    needs_revision: bool = Field(
        default=False,
        description="是否需要修改（自动审核分数低于阈值时为 True）",
    )


class ChapterConfirmIn(BaseModel):
    chapter_id: int | None = Field(
        default=None,
        description="若提供则写入该章节；否则新建一章",
    )
    title: str = Field(..., description="章节标题")
    content: str = Field(..., description="章节正文")
    summary: str = Field(..., description="本章概要")
