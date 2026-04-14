from app.llm.base import LLMProvider
from app.models import Novel
from app.schemas.ai import NovelNamingIn


def novel_naming_suggest(llm: LLMProvider, novel: Novel, body: NovelNamingIn) -> str:
    cat_label = {
        "character": "人物或角色",
        "item": "物品、器物或道具",
        "skill": "功法、武学、招式或技艺名称",
        "other": "其他命名需求",
    }[body.category]
    bg = (novel.background or "").strip()[:1500]
    genre = (novel.genre or "").strip() or "未指定"
    system = (
        "你是网络小说与世界观策划编辑，擅长为角色、物品、功法设计贴切且有辨识度的中文名称。"
        "只输出名称列表本身，不要前言、编号、书名号或解释；若需要多个备选，每行一个名称。"
    )
    hint = (body.hint or "").strip()
    user_msg = (
        f"【作品】{novel.title or '未命名'}\n【类型】{genre}\n【背景（节选）】\n{bg or '（未填写）'}\n\n"
        f"【类别】{cat_label}\n【命名对象】\n{body.description.strip()}\n\n"
        f"【补充要求】\n{hint or '（无）'}\n\n"
        "请给出若干备选中文名称（每行一个，3～10 个为宜）。"
    )
    return llm.complete(system, user_msg).strip()


def novel_writing_chat(
    llm: LLMProvider,
    novel: Novel,
    message: str,
    history: list[dict[str, str]],
) -> str:
    bg = (novel.background or "").strip()[:2000]
    ws = (novel.writing_style or "").strip()[:1200]
    system = (
        "你是专业的中文小说写作助手。用户正在创作一部小说，请根据作品设定回答写作相关问题，"
        "给出可执行的建议；不要编造用户未提供的剧情细节。"
        f"\n【作品标题】{novel.title or '未命名'}\n【类型】{novel.genre or '未指定'}\n"
        f"【背景】{bg or '（未填写）'}\n【文风】{ws or '（未填写）'}"
    )
    lines: list[str] = []
    for turn in history[-12:]:
        role = (turn.get("role") or "").strip()
        content = (turn.get("content") or "").strip()
        if not content:
            continue
        label = "用户" if role == "user" else "助手"
        lines.append(f"{label}：{content}")
    lines.append(f"用户：{message.strip()}")
    user_block = "\n\n".join(lines)
    return llm.complete(system, user_block).strip()
