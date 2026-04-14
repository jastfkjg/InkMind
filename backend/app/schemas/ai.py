from typing import Literal

from pydantic import BaseModel, Field


class NovelNamingIn(BaseModel):
    category: Literal["character", "item", "skill", "other"] = Field(
        default="character",
        description="character=人物 item=物品 skill=功法/招式 other=其他",
    )
    description: str = Field(..., min_length=1, description="要命名的对象简要说明")
    hint: str | None = Field(default=None, description="风格、字数、避讳等补充")


class NovelNamingOut(BaseModel):
    text: str


class NovelAiChatIn(BaseModel):
    message: str = Field(..., min_length=1)
    history: list[dict[str, str]] = Field(
        default_factory=list,
        description="历史对话，每项含 role: user|assistant 与 content",
    )


class NovelAiChatOut(BaseModel):
    reply: str


class NovelChapterSummaryInspireIn(BaseModel):
    chapter_id: int | None = Field(default=None, description="当前章节 id；不提供则按「承接全书最后一章」理解")


class NovelChapterSummaryInspireOut(BaseModel):
    summary: str = Field(..., description="2～4 句本章概要草案")
