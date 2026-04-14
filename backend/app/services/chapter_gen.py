import json
import re
from typing import Any

from sqlalchemy.orm import Session

from app.models import Chapter, Character, Novel


def _strip_code_fence(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.MULTILINE)
        s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def parse_chapter_generation_json(raw: str, *, need_title: bool) -> tuple[str, str]:
    """Parse LLM JSON. Returns (title, body). If not need_title, title is always ''."""
    text = _strip_code_fence(raw)
    data: Any
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return ("", text.strip())

    if not isinstance(data, dict):
        body = raw.strip()
        return ("", body)

    if need_title:
        title = str(data.get("title") or "").strip()
        body = str(data.get("body") or "").strip()
        return title, body
    body = str(data.get("body") or "").strip()
    return "", body


def build_generation_prompt(
    db: Session,
    novel: Novel,
    chapter_summary: str,
    target_chapter: Chapter | None,
    *,
    fixed_title: str | None,
) -> tuple[str, str]:
    chars = (
        db.query(Character)
        .filter(Character.novel_id == novel.id)
        .order_by(Character.id)
        .all()
    )
    chapters = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel.id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )

    char_lines = []
    for c in chars:
        extra = (c.notes or "").strip()
        extra_part = f" 其他：{extra}" if extra else ""
        char_lines.append(f"- {c.name}（性格/设定：{c.profile or '（未填）'}）{extra_part}")
    char_block = "\n".join(char_lines) if char_lines else "（暂无人物）"

    prev_snippets = []
    for ch in chapters:
        if target_chapter and ch.id == target_chapter.id:
            continue
        if ch.summary:
            prev_snippets.append(
                f"【{ch.title or '无标题'}】概要：{ch.summary or '无'}\n"
            )
    prev_block = "\n\n".join(prev_snippets[-6:]) if prev_snippets else "（尚无其他章节正文）"

    if fixed_title:
        system = """你是一位专业中文小说作者。请根据作品背景、人物设定、已有章节语境与本章概要，创作本章正文。
要求：
1. 使用自然流畅的现代汉语叙事，符合给定文风与类型。
2. 保持人物性格前后一致。
3. 你必须只输出一个 JSON 对象（UTF-8），不要 markdown 代码块以外的解释文字。
4. JSON 只能有一个键 body，值为字符串：本章完整正文。
5. 正文中不要写章节标题、章节号或「本章」等结构标签。"""

        title_line = f"\n【本章标题（已定，勿写入正文）】{fixed_title.strip()}"
    else:
        system = """你是一位专业中文小说作者。请根据作品背景、人物设定、已有章节语境与本章概要，创作本章。
要求：
1. 使用自然流畅的现代汉语叙事，符合给定文风与类型。
2. 保持人物性格前后一致。
3. 你必须只输出一个 JSON 对象（UTF-8），不要 markdown 代码块以外的解释文字。
4. JSON 必须包含两个字符串键：title（章节标题，不超过15字，勿加书名号）与 body（本章完整正文）。
5. 正文中不要写章节标题行、章节号或「本章」等结构标签。"""

        title_line = ""
        if target_chapter and (target_chapter.title or "").strip():
            title_line = f"\n【当前章节已有标题（可改写或沿用模型生成的 title）】{target_chapter.title.strip()}"

    user = f"""【作品标题】{novel.title}
【类型】{novel.genre or '未指定'}
【文风说明】{novel.writing_style or '未指定'}
【背景】
{novel.background or '（未填写）'}

【主要人物】
{char_block}

【已有章节语境（节选）】
{prev_block}

【本章任务】
本章概要：{chapter_summary}
{title_line}

请严格按 system 要求的 JSON 结构输出。"""

    return system, user
