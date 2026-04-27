from app.llm.base import LLMProvider
from app.models import Chapter, Novel
from app.schemas.ai import NovelNamingIn
from app.language import Language
from app.prompts import get_prompt

_BG_NAMING = 1000
_BG_CHAT = 900
_WS_CHAT = 600
_BG_INSPIRE = 1800
_WS_INSPIRE = 800
_SUMMARY_PER_CHAPTER = 360
_MAX_PREVIOUS_CHAPTERS = 12


def _get_naming_category_label(category: str, language: Language) -> str:
    key_map = {
        "character": "naming_category_character",
        "item": "naming_category_item",
        "skill": "naming_category_skill",
        "other": "naming_category_other",
    }
    return get_prompt(key_map.get(category, "naming_category_other"), language)


def novel_naming_messages(novel: Novel, body: NovelNamingIn, *, language: Language = "zh") -> tuple[str, str]:
    cat_label = _get_naming_category_label(body.category, language)
    bg = (novel.background or "").strip()[:_BG_NAMING]
    genre = (novel.genre or "").strip() or get_prompt("common_unspecified", language)
    
    system = get_prompt("naming_system", language)
    
    hint = (body.hint or "").strip()
    desc = body.description.strip()[:800]
    
    title = novel.title or get_prompt("common_untitled", language)
    bg_display = bg or get_prompt("common_not_filled", language)
    hint_display = hint or get_prompt("common_none", language)
    
    user_msg = (
        get_prompt("naming_user_intro", language, title=title, genre=genre, background=bg_display) +
        get_prompt("naming_user_category", language, category=cat_label, description=desc) +
        get_prompt("naming_user_hint", language, hint=hint_display) +
        get_prompt("naming_user_closing", language)
    )
    return system, user_msg


def novel_naming_suggest(llm: LLMProvider, novel: Novel, body: NovelNamingIn, *, language: Language = "zh") -> str:
    s, u = novel_naming_messages(novel, body, language=language)
    return llm.complete(s, u).strip()


def novel_writing_chat_messages(
    novel: Novel,
    message: str,
    history: list[dict[str, str]],
    *,
    language: Language = "zh",
) -> tuple[str, str]:
    bg = (novel.background or "").strip()[:_BG_CHAT]
    ws = (novel.writing_style or "").strip()[:_WS_CHAT]
    
    title = novel.title or get_prompt("common_untitled", language)
    genre = novel.genre or get_prompt("common_unspecified", language)
    bg_display = bg or get_prompt("common_not_filled", language)
    ws_display = ws or get_prompt("common_not_filled", language)
    
    system = get_prompt(
        "chat_system", 
        language, 
        title=title, 
        genre=genre, 
        background=bg_display,
        writing_style=ws_display
    )
    
    lines: list[str] = []
    for turn in history[-12:]:
        role = (turn.get("role") or "").strip()
        content = (turn.get("content") or "").strip()[:4000]
        if not content:
            continue
        label = get_prompt("chat_role_user", language) if role == "user" else get_prompt("chat_role_assistant", language)
        lines.append(f"{label}：{content}")
    
    user_label = get_prompt("chat_role_user", language)
    lines.append(f"{user_label}：{message.strip()}")
    user_block = "\n\n".join(lines)
    return system, user_block


def novel_writing_chat(
    llm: LLMProvider,
    novel: Novel,
    message: str,
    history: list[dict[str, str]],
    *,
    language: Language = "zh",
) -> str:
    s, u = novel_writing_chat_messages(novel, message, history, language=language)
    return llm.complete(s, u).strip()


def novel_chapter_summary_inspire_messages(
    novel: Novel,
    previous_chapters: list[Chapter],
    *,
    chapter_count: int = 1,
    language: Language = "zh",
) -> tuple[str, str]:
    bg = (novel.background or "").strip()[:_BG_INSPIRE]
    genre = (novel.genre or "").strip() or get_prompt("common_unspecified", language)
    ws = (novel.writing_style or "").strip()[:_WS_INSPIRE]
    trimmed = previous_chapters[-_MAX_PREVIOUS_CHAPTERS:]
    
    lines: list[str] = []
    for i, ch in enumerate(trimmed, start=1):
        t = (ch.title or "").strip() or get_prompt("common_chapter", language, i=i)
        s = (ch.summary or "").strip()
        if not s:
            s = get_prompt("common_no_summary", language)
        elif len(s) > _SUMMARY_PER_CHAPTER:
            s = s[:_SUMMARY_PER_CHAPTER] + "…"
        lines.append(get_prompt("summary_inspire_chapter_line", language, i=i, title=t, summary=s))
    
    prev_block = "\n\n".join(lines) if lines else get_prompt("summary_inspire_no_previous", language)
    
    if chapter_count <= 1:
        system = get_prompt("summary_inspire_system_single", language)
        closing = get_prompt("summary_inspire_closing_single", language)
    else:
        system = get_prompt("summary_inspire_system_multi", language)
        closing = get_prompt("summary_inspire_closing_multi", language, chapter_count=chapter_count)
    
    title = novel.title or get_prompt("common_untitled", language)
    bg_display = bg or get_prompt("common_not_filled", language)
    ws_display = ws or get_prompt("common_not_filled", language)
    
    user_msg = (
        get_prompt("summary_inspire_user_intro", language, title=title, genre=genre, background=bg_display, writing_style=ws_display) +
        get_prompt("summary_inspire_user_previous", language, previous_summaries=prev_block) +
        get_prompt("summary_inspire_user_chapter_count", language, chapter_count=chapter_count) +
        closing
    )
    return system, user_msg


def novel_chapter_summary_inspire(
    llm: LLMProvider,
    novel: Novel,
    previous_chapters: list[Chapter],
    *,
    chapter_count: int = 1,
    language: Language = "zh",
) -> str:
    s, u = novel_chapter_summary_inspire_messages(novel, previous_chapters, chapter_count=chapter_count, language=language)
    return llm.complete(s, u).strip()
