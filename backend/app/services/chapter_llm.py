import re
from typing import Literal

from sqlalchemy.orm import Session

from app.llm.base import LLMProvider
from app.models import Chapter, Novel
from app.language import Language
from app.prompts import get_prompt

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
    language: Language = "zh",
) -> tuple[str, str]:
    """选区扩写 / 润色。chapter_content_full 为当前编辑器中的章节全文。"""
    sel = (selected_text or "").strip()[:_SELECTION_MAX]
    
    title = novel.title or get_prompt("common_untitled", language)
    genre = novel.genre or get_prompt("common_unspecified", language)
    writing_style = novel.writing_style or get_prompt("common_unspecified", language)
    chapter_title = chapter.title or get_prompt("common_none", language)
    chapter_summary = chapter.summary or get_prompt("common_none", language)
    
    overview = get_prompt(
        "selection_overview", 
        language, 
        title=title, 
        genre=genre, 
        writing_style=writing_style[:1600],
        chapter_title=chapter_title,
        chapter_summary=chapter_summary[:2000]
    )
    
    full_ctx = (chapter_content_full or "").strip()[:_SELECTION_CTX_MAX]
    full_ctx_display = full_ctx or get_prompt("common_none", language)
    
    if mode == "expand":
        system = get_prompt("selection_expand_system", language)
        user_msg = (
            overview +
            get_prompt("selection_full_context", language, context=full_ctx_display) +
            get_prompt("selection_selected", language, selected=sel) +
            get_prompt("selection_expand_closing", language)
        )
    else:
        system = get_prompt("selection_polish_system", language)
        user_msg = (
            overview +
            get_prompt("selection_full_context", language, context=full_ctx_display) +
            get_prompt("selection_selected", language, selected=sel) +
            get_prompt("selection_polish_closing", language)
        )
    return system, user_msg


def summarize_chapter_body(llm: LLMProvider, title: str, content: str, *, language: Language = "zh") -> str:
    system = get_prompt("summarize_body_system", language)
    body = (content or "").strip()
    if not body:
        return ""
    
    title_display = title or get_prompt("common_none", language)
    user_msg = get_prompt("summarize_body_user", language, title=title_display, content=body[:_SUMMARY_INPUT_MAX])
    return llm.complete(system, user_msg).strip()


def messages_revise_chapter_body(
    novel: Novel,
    chapter: Chapter,
    instruction: str,
    *,
    language: Language = "zh",
) -> tuple[str, str]:
    system = get_prompt("revise_system", language)
    ct = (chapter.content or "")[:_REVISE_CONTENT_MAX]
    
    genre = novel.genre or get_prompt("common_unspecified", language)
    writing_style = novel.writing_style or get_prompt("common_unspecified", language)
    chapter_title = chapter.title or get_prompt("common_none", language)
    content_display = ct or get_prompt("revise_empty_note", language)
    
    user_msg = (
        get_prompt("revise_user_intro", language, genre=genre, writing_style=writing_style[:1600], chapter_title=chapter_title) +
        get_prompt("revise_user_current", language, content=content_display) +
        get_prompt("revise_user_instruction", language, instruction=instruction.strip()) +
        get_prompt("revise_user_closing", language)
    )
    return system, user_msg


def revise_chapter_body(
    llm: LLMProvider,
    novel: Novel,
    chapter: Chapter,
    instruction: str,
    *,
    language: Language = "zh",
) -> str:
    s, u = messages_revise_chapter_body(novel, chapter, instruction, language=language)
    return llm.complete(s, u).strip()


def messages_append_chapter_body(
    novel: Novel,
    chapter: Chapter,
    instruction: str,
    *,
    language: Language = "zh",
) -> tuple[str, str]:
    system = get_prompt("append_system", language)
    existing = (chapter.content or "").strip()[:_APPEND_EXISTING_MAX]
    
    genre = novel.genre or get_prompt("common_unspecified", language)
    writing_style = novel.writing_style or get_prompt("common_unspecified", language)
    chapter_title = chapter.title or get_prompt("common_none", language)
    
    if not existing:
        existing_display = get_prompt("append_user_empty", language)
    else:
        existing_display = existing
    
    user_msg = (
        get_prompt("append_user_intro", language, genre=genre, writing_style=writing_style[:1600], chapter_title=chapter_title) +
        get_prompt("append_user_existing", language, content=existing_display) +
        get_prompt("append_user_instruction", language, instruction=instruction.strip()) +
        get_prompt("append_user_closing", language)
    )
    return system, user_msg


def append_chapter_body(
    llm: LLMProvider,
    novel: Novel,
    chapter: Chapter,
    instruction: str,
    *,
    language: Language = "zh",
) -> str:
    s, u = messages_append_chapter_body(novel, chapter, instruction, language=language)
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
    language: Language = "zh",
) -> tuple[str, str]:
    system = get_prompt("title_suggest_system", language)
    
    excerpt = (chapter.content or "").strip()
    if len(excerpt) > _SUGGEST_EXCERPT_MAX:
        excerpt = excerpt[:_SUGGEST_EXCERPT_MAX] + "…"
    
    hint_s = (hint or "").strip()
    existing_block = "\n".join(f"- {t}" for t in (existing_titles or [])[:50]) or get_prompt("batch_plan_no_existing", language)
    
    title = novel.title or get_prompt("common_untitled", language)
    genre = novel.genre or get_prompt("common_unspecified", language)
    summary = chapter.summary or get_prompt("common_none", language)
    excerpt_display = excerpt or get_prompt("title_suggest_no_content", language)
    hint_display = hint_s or get_prompt("common_none", language)
    
    user_msg = (
        get_prompt("title_suggest_user_intro", language, title=title, genre=genre) +
        get_prompt("title_suggest_user_existing", language, existing_titles=existing_block) +
        get_prompt("title_suggest_user_summary", language, summary=summary[:800]) +
        get_prompt("title_suggest_user_excerpt", language, excerpt=excerpt_display) +
        get_prompt("title_suggest_user_hint", language, hint=hint_display)
    )
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


def ensure_unique_chapter_title(title: str, existing_titles: list[str] | None = None, *, language: Language = "zh") -> str:
    candidate = (title or "").strip() or get_prompt("common_new_chapter", language)
    existing_titles = existing_titles or []
    existing_norm = {_normalize_title(t) for t in existing_titles if (t or "").strip()}
    if _normalize_title(candidate) not in existing_norm:
        return candidate[:512]

    base = re.sub(r"[（(]\d+[)）]\s*$", "", candidate).strip() or get_prompt("common_new_chapter", language)
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
    language: Language = "zh",
) -> str:
    s, u = messages_suggest_chapter_title(novel, chapter, hint, existing_titles=existing_titles, language=language)
    raw = llm.complete(s, u).strip()
    return ensure_unique_chapter_title(finalize_suggested_title(raw), existing_titles, language=language)
