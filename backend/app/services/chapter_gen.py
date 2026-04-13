from sqlalchemy.orm import Session

from app.models import Chapter, Character, CharacterRelationship, Novel


def build_generation_prompt(
    db: Session,
    novel: Novel,
    chapter_summary: str,
    target_chapter: Chapter | None,
) -> tuple[str, str]:
    chars = (
        db.query(Character)
        .filter(Character.novel_id == novel.id)
        .order_by(Character.id)
        .all()
    )
    rels = (
        db.query(CharacterRelationship)
        .filter(CharacterRelationship.novel_id == novel.id)
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
        char_lines.append(f"- {c.name}: {c.profile or '（无简介）'}")
    char_block = "\n".join(char_lines) if char_lines else "（暂无人物）"

    rel_lines = []
    for r in rels:
        a = db.get(Character, r.character_a_id)
        b = db.get(Character, r.character_b_id)
        an = a.name if a else "?"
        bn = b.name if b else "?"
        rel_lines.append(f"- {an} 与 {bn}: {r.description or '（未说明）'}")
    rel_block = "\n".join(rel_lines) if rel_lines else "（暂无人物关系）"

    prev_snippets = []
    for ch in chapters:
        if target_chapter and ch.id == target_chapter.id:
            continue
        excerpt = (ch.content or "").strip()
        if len(excerpt) > 1200:
            excerpt = excerpt[:1200] + "…"
        if excerpt or ch.summary:
            prev_snippets.append(
                f"【{ch.title or '无标题'}】概要：{ch.summary or '无'}\n正文节选：{excerpt or '（空）'}"
            )
    prev_block = "\n\n".join(prev_snippets[-6:]) if prev_snippets else "（尚无其他章节正文）"

    system = """你是一位专业中文小说作者。请根据作品设定、人物与关系、已有章节语境与本章概要，写出本章正文。
要求：
1. 使用自然流畅的现代汉语叙事，符合给定文风与类型。
2. 保持人物性格与关系前后一致。
3. 只输出小说叙事正文；不要写章节标题、章节号、副标题或「本章」「第一节」等结构标签；正文第一行不要重复标题。"""

    title_hint = ""
    if target_chapter and (target_chapter.title or "").strip():
        title_hint = f"\n【当前章节标题（仅供参考，不要写入正文）】{target_chapter.title.strip()}"

    user = f"""【作品标题】{novel.title}
【类型】{novel.genre or '未指定'}
【文风说明】{novel.writing_style or '未指定'}
【全书大纲】
{novel.outline or '（未填写）'}

【主要人物】
{char_block}

【人物关系】
{rel_block}

【已有章节语境（节选）】
{prev_block}

【本章任务】
本章概要：{chapter_summary}
{title_hint}

请直接写出本章完整正文（不要包含章节标题行）。"""

    return system, user
