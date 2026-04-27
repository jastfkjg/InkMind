from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import (
    String,
    Text,
    Integer,
    ForeignKey,
    DateTime,
    Boolean,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

VersionChangeType = Literal[
    "manual",
    "ai_generate",
    "ai_rewrite",
    "ai_append",
    "selection_expand",
    "selection_polish",
    "rollback",
]

AgentMode = Literal["flexible", "react", "direct"]
TaskStatus = Literal["pending", "running", "paused", "completed", "failed", "cancelled"]
TaskType = Literal["single_chapter", "batch_chapters", "rewrite_chapter", "append_chapter"]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    preferred_llm_provider: Mapped[str | None] = mapped_column(String(128), nullable=True)
    llm_call_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    agent_mode: Mapped[str] = mapped_column(String(32), default="flexible")
    max_llm_iterations: Mapped[int] = mapped_column(Integer, default=10)
    max_tokens_per_task: Mapped[int] = mapped_column(Integer, default=50000)
    enable_auto_audit: Mapped[bool] = mapped_column(Boolean, default=True)
    preview_before_save: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_audit_min_score: Mapped[int] = mapped_column(Integer, default=60)

    novels: Mapped[list["Novel"]] = relationship("Novel", back_populates="owner", cascade="all, delete-orphan")
    llm_usage_events: Mapped[list["LLMUsageEvent"]] = relationship(
        "LLMUsageEvent", back_populates="user", cascade="all, delete-orphan"
    )


class Novel(Base):
    __tablename__ = "novels"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(512), default="未命名作品")
    background: Mapped[str] = mapped_column(Text, default="")
    genre: Mapped[str] = mapped_column(String(128), default="")
    writing_style: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    owner: Mapped["User"] = relationship("User", back_populates="novels")
    chapters: Mapped[list["Chapter"]] = relationship(
        "Chapter",
        back_populates="novel",
        cascade="all, delete-orphan",
        order_by="Chapter.sort_order",
    )
    characters: Mapped[list["Character"]] = relationship(
        "Character", back_populates="novel", cascade="all, delete-orphan"
    )
    memos: Mapped[list["NovelMemo"]] = relationship(
        "NovelMemo", back_populates="novel", cascade="all, delete-orphan"
    )


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    novel_id: Mapped[int] = mapped_column(ForeignKey("novels.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(512), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    novel: Mapped["Novel"] = relationship("Novel", back_populates="chapters")
    versions: Mapped[list["ChapterVersion"]] = relationship(
        "ChapterVersion", back_populates="chapter", cascade="all, delete-orphan"
    )


class ChapterVersion(Base):
    __tablename__ = "chapter_versions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(512), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    change_type: Mapped[str] = mapped_column(String(32), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="versions")


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    novel_id: Mapped[int] = mapped_column(ForeignKey("novels.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(256))
    profile: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    novel: Mapped["Novel"] = relationship("Novel", back_populates="characters")


class NovelMemo(Base):
    __tablename__ = "novel_memos"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    novel_id: Mapped[int] = mapped_column(ForeignKey("novels.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(512), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    novel: Mapped["Novel"] = relationship("Novel", back_populates="memos")


class LLMUsageEvent(Base):
    __tablename__ = "llm_usage_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(64), default="")
    action: Mapped[str] = mapped_column(String(128), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    user: Mapped["User"] = relationship("User", back_populates="llm_usage_events")


class BackgroundTask(Base):
    __tablename__ = "background_tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    novel_id: Mapped[int] = mapped_column(ForeignKey("novels.id", ondelete="CASCADE"), index=True)
    
    task_type: Mapped[str] = mapped_column(String(32), default="single_chapter")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    batch_plan_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    batch_count: Mapped[int] = mapped_column(Integer, default=1)
    current_index: Mapped[int] = mapped_column(Integer, default=0)
    completed_count: Mapped[int] = mapped_column(Integer, default=0)
    
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_message: Mapped[str | None] = mapped_column(String(512), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    
    novel: Mapped["Novel"] = relationship("Novel")
    task_items: Mapped[list["TaskItem"]] = relationship(
        "TaskItem", 
        back_populates="background_task", 
        cascade="all, delete-orphan",
        order_by="TaskItem.sort_order"
    )


class TaskItem(Base):
    __tablename__ = "task_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    background_task_id: Mapped[int] = mapped_column(ForeignKey("background_tasks.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True, index=True)
    
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    generated_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    
    background_task: Mapped["BackgroundTask"] = relationship("BackgroundTask", back_populates="task_items")
    chapter: Mapped["Chapter | None"] = relationship("Chapter")
