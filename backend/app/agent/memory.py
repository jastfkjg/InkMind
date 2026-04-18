"""小说专项记忆管理：管理前文情节摘要、人物登场状态。"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.models import Character, Chapter, Novel

if TYPE_CHECKING:
    pass

_BG_MAX = 2200
_WRITING_STYLE_MAX = 700
_SUMMARY_LINE_MAX = 320
_TASK_SUMMARY_MAX = 2800
_PREV_CHAPTER_COUNT = 3


def _clip(s: str | None, n: int) -> str:
    t = (s or "").strip()
    if len(t) <= n:
        return t
    return t[: n - 1] + "…"


def _extract_keywords(text: str) -> set[str]:
    """从文本中提取关键词（2字及以上的中文词 + 英文单词）。"""
    chinese_words = re.findall(r"[\u4e00-\u9fff]{2,}", text)
    english_words = re.findall(r"[a-zA-Z]{2,}", text)
    return set(chinese_words + english_words)


class NovelMemory:
    """小说专项记忆：管理前文情节摘要、人物登场状态。

    提供上下文检索能力，支持：
    - 按时间顺序取最近 N 章概要（前文情节）
    - 按关键词召回相关人物（本章涉及的角色）
    - 统一构建生成上下文字符串
    """

    def __init__(self, db: Session, novel: Novel) -> None:
        self._db = db
        self._novel = novel

    @property
    def novel(self) -> Novel:
        return self._novel

    def get_relevant_chapters(self, limit: int = _PREV_CHAPTER_COUNT) -> list[Chapter]:
        """返回最近 limit 章已完成的章节（按 sort_order 倒序）。"""
        return (
            self._db.query(Chapter)
            .filter(Chapter.novel_id == self._novel.id)
            .filter(Chapter.summary.isnot(None))
            .filter(Chapter.summary != "")
            .order_by(Chapter.sort_order.desc(), Chapter.id.desc())
            .limit(limit)
            .all()
        )

    def get_relevant_characters(self, chapter_summary: str) -> list[Character]:
        """根据本章概要，通过关键词匹配召回可能登场的人物。

        匹配逻辑：人物 name 或 profile 中包含本章概要的任意一个关键词，即召回。
        """
        keywords = _extract_keywords(chapter_summary)
        if not keywords:
            return []

        all_chars = (
            self._db.query(Character)
            .filter(Character.novel_id == self._novel.id)
            .all()
        )

        matched: list[tuple[int, Character]] = []
        for char in all_chars:
            char_keywords = _extract_keywords(f"{char.name} {char.profile}")
            overlap = keywords & char_keywords
            if overlap:
                matched.append((len(overlap), char))

        matched.sort(key=lambda x: x[0], reverse=True)
        return [char for _, char in matched]

    def build_context(self, chapter_summary: str) -> str:
        """构建完整的生成上下文字符串。

        包含：作品基础设定 + 前 N 章情节概要 + 本章涉及的人物设定。
        """
        prev_chapters = self.get_relevant_chapters(_PREV_CHAPTER_COUNT)
        prev_block_lines = []
        for ch in reversed(prev_chapters):
            line = f"【{ch.title or '无标题'}】概要：{_clip(ch.summary, _SUMMARY_LINE_MAX)}"
            prev_block_lines.append(line)
        prev_block = "\n\n".join(prev_block_lines) if prev_block_lines else "（尚无其他章节概要）"

        relevant_chars = self.get_relevant_characters(chapter_summary)
        char_block_lines = []
        for char in relevant_chars:
            profile_text = _clip(char.profile, 400) or "（未填写）"
            notes_text = _clip(char.notes, 200)
            char_block_lines.append(
                f"【{char.name}】\n设定：{profile_text}"
                + (f"\n备注：{notes_text}" if notes_text else "")
            )
        char_block = "\n\n".join(char_block_lines) if char_block_lines else "（无相关人物记录）"

        bg = _clip(self._novel.background, _BG_MAX) or "（未填写）"
        ws = _clip(self._novel.writing_style, _WRITING_STYLE_MAX) or "未指定"
        genre = self._novel.genre or "未指定"

        return f"""【作品标题】{self._novel.title}
【类型】{genre}
【文风说明】{ws}

【背景/世界观】
{bg}

【前文情节概要】
{prev_block}

【本章涉及人物】
{char_block}

【本章概要】
{_clip(chapter_summary, _TASK_SUMMARY_MAX) or '（无）'}"""
