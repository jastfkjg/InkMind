from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

from app.models import TaskStatus, TaskType


class TaskItemOut(BaseModel):
    id: int
    background_task_id: int
    chapter_id: int | None
    sort_order: int
    status: str
    title: str | None
    summary: str | None
    generated_title: str | None
    generated_content: str | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None

    class Config:
        from_attributes = True


class BackgroundTaskOut(BaseModel):
    id: int
    user_id: int
    novel_id: int
    task_type: str
    status: str
    title: str | None
    summary: str | None
    batch_count: int
    current_index: int
    completed_count: int
    error_message: str | None
    progress_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    total_tokens: int
    task_items: list[TaskItemOut] = []

    class Config:
        from_attributes = True


class CreateSingleTaskIn(BaseModel):
    novel_id: int
    chapter_id: int | None = None
    title: str | None = None
    summary: str
    fixed_title: str | None = None
    word_count: int | None = None
    task_type: Literal["single_chapter", "rewrite_chapter", "append_chapter"] = "single_chapter"


class CreateBatchTaskIn(BaseModel):
    novel_id: int
    after_chapter_id: int | None = None
    total_summary: str
    chapter_count: int = Field(..., ge=1, le=20)
    word_count: int | None = None


class BatchPlanChapter(BaseModel):
    title: str
    summary: str


class BatchPlanOut(BaseModel):
    chapters: list[BatchPlanChapter]


class TaskStatusUpdate(BaseModel):
    status: Literal["paused", "running", "cancelled"]
