from app.llm.base import LLMProvider
from app.models import Chapter, Novel

_REVISE_CONTENT_MAX = 10000
_APPEND_EXISTING_MAX = 12000
_SUMMARY_INPUT_MAX = 8000
_SUGGEST_EXCERPT_MAX = 900


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
) -> tuple[str, str]:
    system = (
        "你是文学编辑。请根据作品信息与本章内容，给出唯一一个合适的章节标题。"
        "只输出标题本身：不超过18个汉字，不要书名号、引号、编号或任何解释。"
    )
    excerpt = (chapter.content or "").strip()
    if len(excerpt) > _SUGGEST_EXCERPT_MAX:
        excerpt = excerpt[:_SUGGEST_EXCERPT_MAX] + "…"
    hint_s = (hint or "").strip()
    user_msg = f"""【作品】{novel.title or '未命名'}
【类型】{novel.genre or '未指定'}
【本章摘要】{(chapter.summary or '（无）')[:800]}
【本章正文节选】
{excerpt or '（尚无正文）'}
【用户补充说明】{hint_s or '（无）'}"""
    return system, user_msg


def finalize_suggested_title(raw: str) -> str:
    one = raw.splitlines()[0].strip() if raw else ""
    one = one.strip("「」『』\"'《》 ")
    return one[:512] if one else raw[:512]


def suggest_chapter_title(
    llm: LLMProvider,
    novel: Novel,
    chapter: Chapter,
    hint: str = "",
) -> str:
    s, u = messages_suggest_chapter_title(novel, chapter, hint)
    raw = llm.complete(s, u).strip()
    return finalize_suggested_title(raw)
