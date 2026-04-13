from app.llm.base import LLMProvider
from app.models import Chapter, Novel


def suggest_chapter_title(
    llm: LLMProvider,
    novel: Novel,
    chapter_summary: str,
    content: str,
) -> str:
    system = (
        "你是文学编辑。根据书名、本章概要与正文，拟一个简短章节标题（不超过 18 个字）。"
        "不要书名号、引号、「第X章」或编号。只输出标题本身，不要其他说明。"
    )
    user_msg = f"""【书名】{novel.title}
【本章概要】
{chapter_summary[:1200]}

【正文节选】
{(content or '')[:3500]}"""
    raw = llm.complete(system, user_msg).strip()
    for sep in ("\n", "。", "："):
        if sep in raw:
            raw = raw.split(sep)[0].strip()
    if len(raw) > 40:
        raw = raw[:40]
    return raw.strip().strip('"\'「」《》')


def summarize_chapter_body(llm: LLMProvider, title: str, content: str) -> str:
    system = (
        "你是文学编辑。请用 2～4 句简体中文概括本章正文要点（剧情、冲突或情绪），"
        "不要加标题、编号或引号，不要评价文笔。"
    )
    body = (content or "").strip()
    if not body:
        return ""
    user_msg = f"章节标题：{title or '（无）'}\n\n正文：\n{body[:14000]}"
    return llm.complete(system, user_msg).strip()


def revise_chapter_body(
    llm: LLMProvider,
    novel: Novel,
    chapter: Chapter,
    instruction: str,
) -> str:
    system = (
        "你是小说作者与编辑。根据用户的修改要求，改写本章正文。"
        "保持与作品类型、文风及前文语境一致；只输出改写后的完整正文，不要前言或解释。"
    )
    user_msg = f"""【类型】{novel.genre or '未指定'}
【文风】{novel.writing_style or '未指定'}
【章节标题】{chapter.title or '（无）'}

【当前正文】
{chapter.content or '（空）'}

【修改要求】
{instruction.strip()}

请输出修改后的完整正文。"""
    return llm.complete(system, user_msg).strip()


def append_chapter_body(
    llm: LLMProvider,
    novel: Novel,
    chapter: Chapter,
    instruction: str,
) -> str:
    system = (
        "你是小说作者。根据用户要求，在现有正文**之后**撰写新增内容。"
        "保持与作品类型、文风一致；不要复述或重复已有段落。"
        "只输出要追加的新正文，不要包含「已有正文」中的句子。"
    )
    existing = (chapter.content or "").strip()
    user_msg = f"""【类型】{novel.genre or '未指定'}
【文风】{(novel.writing_style or '未指定')[:2000]}
【章节标题】{chapter.title or '（无）'}

【已有正文】
{existing or '（尚无正文，请直接按下列要求撰写开篇段落）'}

【追加要求】
{instruction.strip()}

请只输出要接在文末的新增正文。"""
    addition = llm.complete(system, user_msg).strip()
    if not existing:
        return addition
    return existing.rstrip() + "\n\n" + addition
