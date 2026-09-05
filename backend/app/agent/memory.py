"""小说专项记忆管理：管理前文情节摘要、人物登场状态。"""

from __future__ import annotations

import re

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models import Character, Chapter, Novel

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
    return set(chinese_words + [word.casefold() for word in english_words])


def _mentions_name(text: str, name: str) -> bool:
    name = name.strip()
    if not name:
        return False
    if re.search(r"[\u4e00-\u9fff]", name):
        return name in text
    # English names are case-insensitive, but Ann must not match Joanne.
    return re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", text, re.IGNORECASE) is not None


class NovelMemory:
    """小说专项记忆：管理前文情节摘要、人物登场状态。

    提供上下文检索能力，支持：
    - 按时间顺序取最近 N 章概要（前文情节）
    - 按关键词召回相关人物（本章涉及的角色）
    - 统一构建生成上下文字符串

    before_chapter 排除当前章及后文（优先于 before_sort_order）；
    before_sort_order 用于在指定位置插入新章；through_chapter 包含续写锚点。
    不指定边界表示在全书末尾追加。
    """

    def __init__(
        self, db: Session, novel: Novel, *,
        before_chapter: Chapter | None = None,
        before_sort_order: int | None = None,
        through_chapter: Chapter | None = None,
    ) -> None:
        self._db = db
        self._novel = novel
        for chapter in (before_chapter, through_chapter):
            if chapter is not None and chapter.novel_id != novel.id:
                raise ValueError("上下文章节不属于当前作品")
        if through_chapter is not None and (before_chapter is not None or before_sort_order is not None):
            raise ValueError("不能同时指定前文与后文边界")
        self._before_chapter = before_chapter
        self._before_sort_order = before_sort_order
        self._through_chapter = through_chapter

    @property
    def novel(self) -> Novel:
        return self._novel

    def get_relevant_chapters(self, limit: int = _PREV_CHAPTER_COUNT) -> list[Chapter]:
        """返回写作位置之前最近的概要；追加写作未指定边界时取全书末尾。"""
        if limit <= 0:
            return []
        query = (
            self._db.query(Chapter)
            .filter(Chapter.novel_id == self._novel.id)
            .filter(Chapter.summary.isnot(None))
            .filter(Chapter.summary != "")
        )
        anchor = self._before_chapter or self._through_chapter
        if anchor is not None:
            # Match the editor's (sort_order, id) order, including ties.
            id_bound = Chapter.id <= anchor.id if self._through_chapter is not None else Chapter.id < anchor.id
            query = query.filter(or_(
                Chapter.sort_order < anchor.sort_order,
                and_(Chapter.sort_order == anchor.sort_order, id_bound),
            ))
        elif self._before_sort_order is not None:
            query = query.filter(Chapter.sort_order < self._before_sort_order)
        return (
            query.order_by(Chapter.sort_order.desc(), Chapter.id.desc())
            .limit(limit)
            .all()
        )

    def get_relevant_characters(self, chapter_summary: str) -> list[Character]:
        """根据本章概要，通过关键词匹配召回可能登场的人物。

        优先直接匹配人物姓名，再以设定关键词补充召回。
        """
        keywords = _extract_keywords(chapter_summary)
        if not chapter_summary.strip():
            return []

        all_chars = (
            self._db.query(Character)
            .filter(Character.novel_id == self._novel.id)
            .order_by(Character.id)
            .all()
        )

        matched: list[tuple[bool, int, Character]] = []
        for char in all_chars:
            char_keywords = _extract_keywords(f"{char.name} {char.profile}")
            overlap = keywords & char_keywords
            mentioned = _mentions_name(chapter_summary, char.name)
            if mentioned or overlap:
                matched.append((mentioned, len(overlap), char))

        matched.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return [char for _, _, char in matched]

    def build_lightweight_context(self) -> str:
        """构建轻量级上下文，仅包含作品元数据。

        用于 AI 对话等不需要完整上下文的场景，
        避免将大量内容注入主 Agent 上下文窗口。
        """
        genre = self._novel.genre or "未指定"
        bg_brief = _clip(self._novel.background, 200) or "（未填写）"

        chapter_count = (
            self._db.query(Chapter)
            .filter(Chapter.novel_id == self._novel.id)
            .count()
        )

        char_count = (
            self._db.query(Character)
            .filter(Character.novel_id == self._novel.id)
            .count()
        )

        return f"""【作品标题】{self._novel.title}
【类型】{genre}
【背景简介】{bg_brief}
【章节数】{chapter_count}
【人物数】{char_count}"""

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
