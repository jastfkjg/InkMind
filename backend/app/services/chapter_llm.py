import re
from typing import Literal

from sqlalchemy.orm import Session

from app.llm.base import LLMProvider
from app.models import Chapter, Novel

_REVISE_CONTENT_MAX = 10000
_APPEND_EXISTING_MAX = 12000
_SUMMARY_INPUT_MAX = 8000
_SUGGEST_EXCERPT_MAX = 900
_SELECTION_MAX = 8000
_SELECTION_CTX_MAX = 12000


def messages_selection_ai(
    novel: Novel,
    chapter: Chapter,
    *,
    chapter_content_full: str,
    selected_text: str,
    mode: Literal["expand", "polish"],
) -> tuple[str, str]:
    """选区扩写 / 润色。chapter_content_full 为当前编辑器中的章节全文。"""
    sel = (selected_text or "").strip()[:_SELECTION_MAX]
    overview = (
        f"【作品】{novel.title or '未命名'}\n"
        f"【类型】{novel.genre or '未指定'}\n"
        f"【文风】{(novel.writing_style or '未指定')[:1600]}\n"
        f"【章节标题】{chapter.title or '（无）'}\n"
        f"【本章概要】\n{(chapter.summary or '（无）')[:2000]}\n"
    )
    full_ctx = (chapter_content_full or "").strip()[:_SELECTION_CTX_MAX]
    if mode == "expand":
        system = (
            "你是小说作者。用户选中了文中一段文字，请对其进行扩写。"
            "保持与全书类型、文风一致、情节连贯；增加细节、描写或节奏，使片段更丰满。"
            "只输出扩写后的正文片段，不要解释、不要前后缀、不要引用说明。"
        )
        user_msg = f"""{overview}
【全文节选供上下文参考】
{full_ctx or '（无）'}

【选中片段】
{sel}

请只输出扩写后的正文片段，不要包含标题或说明。"""
    else:
        system = (
            "你是小说编辑。用户选中了文中一段文字，请对其进行润色。"
            "保持原意与叙事节奏，优化句式、用词与节奏；避免口水套话与模板化表达。"
            "只输出润色后的正文片段，不要解释、不要前后缀。"
        )
        user_msg = f"""{overview}
【全文节选供上下文参考】
{full_ctx or '（无）'}

【选中片段】
{sel}

请只输出润色后的正文片段。"""
    return system, user_msg


def summarize_chapter_body(llm: LLMProvider, title: str, content: str) -> str:
    system = (
        "你是文学编辑。请用尽量简短的 1～4 句简体中文概括本章正文要点，"
        "不要加标题、编号或引号，不要评价文笔。"
    )
    body = (content or "").strip()
    if not body:
        return ""
    user_msg = f"章节标题：{title or '（无）'}\n\n正文：\n{body[:_SUMMARY_INPUT_MAX]}"
    return llm.complete(system, user_msg).strip()


def messages_revise_chapter_body(
    novel: Novel,
    chapter: Chapter,
    instruction: str,
) -> tuple[str, str]:
    system = (
        "你是小说作者与编辑。根据用户的修改要求，改写本章正文。"
        "保持与作品类型、文风及前文语境一致；只输出改写后的完整正文，不要前言或解释。"
    )
    ct = (chapter.content or "")[:_REVISE_CONTENT_MAX]
    user_msg = f"""【类型】{novel.genre or '未指定'}
【文风】{(novel.writing_style or '未指定')[:1600]}
【章节标题】{chapter.title or '（无）'}

【当前正文】
{ct or '（空）'}

【修改要求】
{instruction.strip()}

请输出修改后的完整正文。"""
    return system, user_msg


def revise_chapter_body(
    llm: LLMProvider,
    novel: Novel,
    chapter: Chapter,
    instruction: str,
) -> str:
    s, u = messages_revise_chapter_body(novel, chapter, instruction)
    return llm.complete(s, u).strip()


def messages_append_chapter_body(
    novel: Novel,
    chapter: Chapter,
    instruction: str,
) -> tuple[str, str]:
    system = (
        "你是小说作者。根据用户要求，在现有正文之后撰写新增内容。"
        "保持与作品类型、文风一致；不要复述或重复已有段落。"
        "只输出要追加的新正文，不要包含「已有正文」中的句子。"
    )
    existing = (chapter.content or "").strip()[:_APPEND_EXISTING_MAX]
    user_msg = f"""【类型】{novel.genre or '未指定'}
【文风】{(novel.writing_style or '未指定')[:1600]}
【章节标题】{chapter.title or '（无）'}

【已有正文】
{existing or '（尚无正文，请直接按下列要求撰写开篇段落）'}

【追加要求】
{instruction.strip()}

请只输出要接在文末的新增正文。"""
    return system, user_msg


def append_chapter_body(
    llm: LLMProvider,
    novel: Novel,
    chapter: Chapter,
    instruction: str,
) -> str:
    s, u = messages_append_chapter_body(novel, chapter, instruction)
    addition = llm.complete(s, u).strip()
    existing = (chapter.content or "").strip()
    if not existing:
        return addition
    return existing.rstrip() + "\n\n" + addition


def messages_suggest_chapter_title(
    novel: Novel,
    chapter: Chapter,
    hint: str = "",
    *,
    existing_titles: list[str] | None = None,
) -> tuple[str, str]:
    system = (
        "你是文学编辑。请根据作品信息与本章内容，给出唯一一个合适的章节标题。"
        "标题不得与本书已有章节标题重复。"
        "只输出标题本身：不超过18个汉字，不要书名号、引号、编号或任何解释。"
    )
    excerpt = (chapter.content or "").strip()
    if len(excerpt) > _SUGGEST_EXCERPT_MAX:
        excerpt = excerpt[:_SUGGEST_EXCERPT_MAX] + "…"
    hint_s = (hint or "").strip()
    existing_block = "\n".join(f"- {t}" for t in (existing_titles or [])[:50]) or "（无）"
    user_msg = f"""【作品】{novel.title or '未命名'}
【类型】{novel.genre or '未指定'}
【已有章节标题（禁止重名）】
{existing_block}
【本章摘要】{(chapter.summary or '（无）')[:800]}
【本章正文节选】
{excerpt or '（尚无正文）'}
【用户补充说明】{hint_s or '（无）'}"""
    return system, user_msg


def finalize_suggested_title(raw: str) -> str:
    one = raw.splitlines()[0].strip() if raw else ""
    one = one.strip("「」『』\"'《》 ")
    return one[:512] if one else raw[:512]


def list_existing_chapter_titles(
    db: Session,
    novel_id: int,
    *,
    exclude_chapter_id: int | None = None,
) -> list[str]:
    rows = (
        db.query(Chapter.id, Chapter.title)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    out: list[str] = []
    seen: set[str] = set()
    for chapter_id, title in rows:
        if exclude_chapter_id is not None and chapter_id == exclude_chapter_id:
            continue
        clean = (title or "").strip()
        if not clean:
            continue
        norm = _normalize_title(clean)
        if norm in seen:
            continue
        seen.add(norm)
        out.append(clean)
    return out


def ensure_unique_chapter_title(title: str, existing_titles: list[str] | None = None) -> str:
    candidate = (title or "").strip() or "新章"
    existing_titles = existing_titles or []
    existing_norm = {_normalize_title(t) for t in existing_titles if (t or "").strip()}
    if _normalize_title(candidate) not in existing_norm:
        return candidate[:512]

    base = re.sub(r"[（(]\d+[)）]\s*$", "", candidate).strip() or "新章"
    n = 2
    while True:
        deduped = f"{base}（{n}）"
        if _normalize_title(deduped) not in existing_norm:
            return deduped[:512]
        n += 1


def _normalize_title(title: str) -> str:
    text = (title or "").strip().lower()
    text = text.strip("「」『』\"'《》 ")
    return re.sub(r"\s+", "", text)


def suggest_chapter_title(
    llm: LLMProvider,
    novel: Novel,
    chapter: Chapter,
    hint: str = "",
    *,
    existing_titles: list[str] | None = None,
) -> str:
    s, u = messages_suggest_chapter_title(novel, chapter, hint, existing_titles=existing_titles)
    raw = llm.complete(s, u).strip()
    return ensure_unique_chapter_title(finalize_suggested_title(raw), existing_titles)
