"""Agent 工具实现：数据检索 + 章节生成。"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.agent.base import BaseTool
from app.agent.memory import NovelMemory
from app.llm.base import calc_max_tokens_from_word_count
from app.models import Chapter, Novel
from app.prompts import get_prompt
from app.language import Language

if TYPE_CHECKING:
    from app.llm.base import LLMProvider

_BG_MAX = 2200
_WRITING_STYLE_MAX = 700
_SUMMARY_LINE_MAX = 320
_TASK_SUMMARY_MAX = 2800


def _clip(s: str | None, n: int) -> str:
    t = (s or "").strip()
    if len(t) <= n:
        return t
    return t[: n - 1] + "…"


class GetPreviousChaptersTool(BaseTool):
    """获取作品已完成的章节概要，帮助了解故事前文进展。"""

    name = "get_previous_chapters"
    description = "获取作品的前 N 章概要，用于了解故事进展。参数 limit 指定章节数量（默认3）。"

    def __init__(
        self, db: Session, novel: Novel, *,
        before_chapter: Chapter | None = None,
        before_sort_order: int | None = None,
    ) -> None:
        self._memory = NovelMemory(db, novel, before_chapter=before_chapter, before_sort_order=before_sort_order)

    def run(self, limit: int = 3) -> str:
        chapters = self._memory.get_relevant_chapters(limit)
        if not chapters:
            return "（尚无其他章节概要）"
        lines = []
        for ch in reversed(list(chapters)):
            lines.append(f"【{ch.title or '无标题'}】{_clip(ch.summary, _SUMMARY_LINE_MAX)}")
        return "\n\n".join(lines)


class GetCharacterProfilesTool(BaseTool):
    """获取作品人物的相关设定（根据关键词召回）。"""

    name = "get_character_profiles"
    description = (
        "获取本章可能涉及的人物设定。"
        "通过本章概要中的关键词与人物名称/设定的关键词匹配召回。"
    )

    def __init__(self, db: Session, novel: Novel) -> None:
        self._db = db
        self._novel = novel

    def run(self, chapter_summary: str = "") -> str:
        if not chapter_summary:
            return "（未提供概要，无法召回人物）"

        matched = NovelMemory(self._db, self._novel).get_relevant_characters(chapter_summary)
        if not matched:
            return "（无相关人物记录）"
        lines = []
        for char in matched:
            profile = _clip(char.profile, 400) or "（未填写）"
            notes = _clip(char.notes, 200)
            entry = f"【{char.name}】\n设定：{profile}"
            if notes:
                entry += f"\n备注：{notes}"
            lines.append(entry)
        return "\n\n".join(lines)


class GetNovelContextTool(BaseTool):
    """获取作品的基础设定（标题、类型、背景、文风）。"""

    name = "get_novel_context"
    description = "获取作品的基础设定，包括标题、类型、写作风格和世界观背景。"

    def __init__(self, db: Session, novel: Novel) -> None:
        self._db = db
        self._novel = novel

    def run(self) -> str:
        novel = self._novel
        bg = _clip(novel.background, _BG_MAX) or "（未填写）"
        ws = _clip(novel.writing_style, _WRITING_STYLE_MAX) or "未指定"
        genre = novel.genre or "未指定"
        return f"""【作品标题】{novel.title}
【类型】{genre}
【文风说明】{ws}
【背景/世界观】
{bg}"""


class GenerateChapterTool(BaseTool):
    """整合上下文后调用 LLM 生成章节正文（支持流式输出）。"""

    name = "generate_chapter"
    description = (
        "生成符合上下文的小说正文。接收本章概要（chapter_summary）和"
        "固定标题（fixed_title，可选），使用 NovelMemory 自动构建上下文，"
        "返回 JSON 格式的章节内容。"
    )

    def __init__(
        self,
        db: Session,
        novel: Novel,
        llm: "LLMProvider",
        *,
        word_count: int | None = None,
        language: Language = "zh",
        before_chapter: Chapter | None = None,
        before_sort_order: int | None = None,
    ) -> None:
        self._db = db
        self._novel = novel
        self._llm = llm
        self._word_count = word_count
        self._language = language
        self._memory = NovelMemory(db, novel, before_chapter=before_chapter, before_sort_order=before_sort_order)

    def run(self, chapter_summary: str = "", fixed_title: str | None = None) -> str:
        """执行章节生成，返回 JSON 格式的完整内容。"""
        context = self._memory.build_context(chapter_summary)

        word_count_req = ""
        if self._word_count and 500 <= self._word_count <= 4000:
            word_count_req = get_prompt("gen_word_count_req", self._language, count=self._word_count)

        if fixed_title:
            system = get_prompt("gen_system_fixed_title", self._language, word_count_req=word_count_req)
            title_line = get_prompt("gen_title_line_fixed", self._language, title=fixed_title.strip())
        else:
            system = get_prompt("gen_system_dynamic_title", self._language, word_count_req=word_count_req)
            title_line = ""

        user = (
            context + "\n\n" +
            get_prompt("gen_user_task", self._language, summary=chapter_summary) +
            title_line + "\n\n" +
            get_prompt("gen_user_warning", self._language)
        )

        max_tokens = calc_max_tokens_from_word_count(self._word_count, language=self._language)
        return self._llm.complete(system, user, max_tokens=max_tokens)

    def run_stream(self, chapter_summary: str = "", fixed_title: str | None = None) -> Iterator[str]:
        """执行章节生成，流式返回正文内容（纯文本，非 JSON）。"""
        context = self._memory.build_context(chapter_summary)

        word_count_req = ""
        if self._word_count and 500 <= self._word_count <= 4000:
            word_count_req = get_prompt("gen_word_count_req", self._language, count=self._word_count)

        if fixed_title:
            system = get_prompt("gen_system_fixed_title", self._language, word_count_req=word_count_req)
            title_line = get_prompt("gen_title_line_fixed", self._language, title=fixed_title.strip())
        else:
            system = get_prompt("gen_system_dynamic_title", self._language, word_count_req=word_count_req)
            title_line = ""

        user = (
            context + "\n\n" +
            get_prompt("gen_user_task", self._language, summary=chapter_summary) +
            title_line + "\n\n" +
            get_prompt("gen_user_warning", self._language)
        )

        max_tokens = calc_max_tokens_from_word_count(self._word_count, language=self._language)
        return self._llm.stream_complete(system, user, max_tokens=max_tokens)


class FinishTool(BaseTool):
    """完成任务工具。让模型自己决定何时完成任务。"""

    name = "finish"
    description = (
        "完成任务。当你已经完成所有必要的步骤并准备好返回最终结果时，使用这个工具。"
        "注意：只有在你已经收集到足够的上下文信息并生成了章节正文后，才应该使用这个工具。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "完成任务的原因说明（可选）",
            },
        },
    }

    def run(self, reason: str = "") -> str:
        return f"任务已完成。原因：{reason or '模型决定完成任务。'}"
