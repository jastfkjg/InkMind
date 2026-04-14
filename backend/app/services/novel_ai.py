from app.llm.base import LLMProvider
from app.models import Chapter, Novel
from app.schemas.ai import NovelNamingIn

_BG_NAMING = 1000
_BG_CHAT = 900
_WS_CHAT = 600
_BG_INSPIRE = 1800
_WS_INSPIRE = 800
_SUMMARY_PER_CHAPTER = 360
_MAX_PREVIOUS_CHAPTERS = 12


def novel_naming_messages(novel: Novel, body: NovelNamingIn) -> tuple[str, str]:
    cat_label = {
        "character": "人物或角色",
        "item": "物品、器物或道具",
        "skill": "功法、武学、招式或技艺名称",
        "other": "其他命名需求",
    }[body.category]
    bg = (novel.background or "").strip()[:_BG_NAMING]
    genre = (novel.genre or "").strip() or "未指定"
    system = (
        "你是网络小说与世界观策划编辑，擅长为角色、物品、功法设计贴切且有辨识度的中文名称。"
        "只输出名称列表本身，不要前言、编号、书名号或解释；若需要多个备选，每行一个名称。"
    )
    hint = (body.hint or "").strip()
    desc = body.description.strip()[:800]
    user_msg = (
        f"【作品】{novel.title or '未命名'}\n【类型】{genre}\n【背景（节选）】\n{bg or '（未填写）'}\n\n"
        f"【类别】{cat_label}\n【命名对象】\n{desc}\n\n"
        f"【补充要求】\n{hint or '（无）'}\n\n"
        "请给出若干备选中文名称（每行一个，3～10 个为宜）。"
    )
    return system, user_msg


def novel_naming_suggest(llm: LLMProvider, novel: Novel, body: NovelNamingIn) -> str:
    s, u = novel_naming_messages(novel, body)
    return llm.complete(s, u).strip()


def novel_writing_chat_messages(
    novel: Novel,
    message: str,
    history: list[dict[str, str]],
) -> tuple[str, str]:
    bg = (novel.background or "").strip()[:_BG_CHAT]
    ws = (novel.writing_style or "").strip()[:_WS_CHAT]
    system = (
        "你是专业的中文小说写作助手。用户正在创作一部小说，请根据作品设定回答写作相关问题，"
        "给出可执行的建议；不要编造用户未提供的剧情细节。"
        f"\n【作品标题】{novel.title or '未命名'}\n【类型】{novel.genre or '未指定'}\n"
        f"【背景】{bg or '（未填写）'}\n【文风】{ws or '（未填写）'}"
    )
    lines: list[str] = []
    for turn in history[-12:]:
        role = (turn.get("role") or "").strip()
        content = (turn.get("content") or "").strip()[:4000]
        if not content:
            continue
        label = "用户" if role == "user" else "助手"
        lines.append(f"{label}：{content}")
    lines.append(f"用户：{message.strip()}")
    user_block = "\n\n".join(lines)
    return system, user_block


def novel_writing_chat(
    llm: LLMProvider,
    novel: Novel,
    message: str,
    history: list[dict[str, str]],
) -> str:
    s, u = novel_writing_chat_messages(novel, message, history)
    return llm.complete(s, u).strip()


def novel_chapter_summary_inspire_messages(
    novel: Novel,
    previous_chapters: list[Chapter],
) -> tuple[str, str]:
    bg = (novel.background or "").strip()[:_BG_INSPIRE]
    genre = (novel.genre or "").strip() or "未指定"
    ws = (novel.writing_style or "").strip()[:_WS_INSPIRE]
    trimmed = previous_chapters[-_MAX_PREVIOUS_CHAPTERS:]
    lines: list[str] = []
    for i, ch in enumerate(trimmed, start=1):
        t = (ch.title or "").strip() or f"第{i}章"
        s = (ch.summary or "").strip()
        if not s:
            s = "（该章暂无概要）"
        elif len(s) > _SUMMARY_PER_CHAPTER:
            s = s[:_SUMMARY_PER_CHAPTER] + "…"
        lines.append(f"{i}. 《{t}》\n   概要：{s}")
    prev_block = "\n\n".join(lines) if lines else "（尚无已写章节——本章可作为开篇章。）"
    system = (
        "你是资深中文网络小说策划编辑。你的任务是根据全书设定与已写各章概要，为本章写出一份简短的「本章概要」草案。"
        "输出须为 2～4 句自然、连贯的中文，概括本章应写的情节走向或冲突与看点；不要写对白、不展开正文描写；"
        "不要加标题、编号、引号包裹的说明或任何前后缀。若前情不足，可合理推断承接方向，但不要编造与设定明显矛盾的内容。"
    )
    user_msg = (
        f"【作品标题】{novel.title or '未命名'}\n【类型】{genre}\n"
        f"【背景 / 世界观】\n{bg or '（未填写）'}\n\n【文风】\n{ws or '（未填写）'}\n\n"
        f"【本章之前各章概要（按顺序）】\n{prev_block}\n\n"
        "请只输出本章概要草案（2～4 句），直接可用于后续扩写正文。"
    )
    return system, user_msg


def novel_chapter_summary_inspire(
    llm: LLMProvider,
    novel: Novel,
    previous_chapters: list[Chapter],
) -> str:
    s, u = novel_chapter_summary_inspire_messages(novel, previous_chapters)
    return llm.complete(s, u).strip()
