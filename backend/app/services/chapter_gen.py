import json
import re
from typing import Annotated, Any

from sqlalchemy.orm import Session

from app.agent.flexible_agent import FlexibleNovelAgent
from app.agent.memory import NovelMemory
from app.agent.react import ReActAgent
from app.agent.tools import (
    FinishTool,
    GenerateChapterTool,
    GetCharacterProfilesTool,
    GetNovelContextTool,
    GetPreviousChaptersTool,
)
from app.llm.base import LLMProvider
from app.llm.ndjson_stream import filter_think_chunks
from app.models import Chapter, Novel
from app.services.chapter_llm import (
    ensure_unique_chapter_title,
    finalize_suggested_title,
    list_existing_chapter_titles,
    messages_suggest_chapter_title,
)

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
    fixed_title: str | None = None,
    word_count: int | None = None,
) -> tuple[str, str]:
    """构建章节生成的 system prompt 和 user prompt。

    内部使用 NovelMemory 统一管理上下文检索（章节召回 + 人物召回）。
    """
    memory = NovelMemory(db, novel)

    word_count_req = ""
    if word_count and 500 <= word_count <= 4000:
        word_count_req = f"\n5. 正文长度尽量控制在 {word_count} 字左右（允许上下浮动 10%）。"

    if fixed_title:
        system = f"""你是一位专业中文小说作者。请根据作品背景、已有章节语境与本章概要，创作本章正文。
要求：
1. 使用自然流畅的现代汉语叙事，符合给定文风与类型。
2. 你必须只输出一个 JSON 对象（UTF-8），不要 markdown 代码块以外的解释文字。
3. JSON 只能有一个键 body，值为字符串：本章完整正文。
4. 正文中不要写章节标题、章节号或「本章」等结构标签。{word_count_req}"""

        title_line = f"\n【本章标题（已定，勿写入正文）】{fixed_title.strip()}"
    else:
        system = f"""你是一位专业中文小说作者。请根据作品背景、已有章节语境与本章概要，创作本章。
要求：
1. 使用自然流畅的现代汉语叙事，符合给定文风与类型。
2. 你必须只输出一个 JSON 对象（UTF-8），不要 markdown 代码块以外的解释文字。
3. JSON 必须包含两个字符串键：title（章节标题，不超过15字，勿加书名号）与 body（本章完整正文）。
4. 正文中不要写章节标题行、章节号或「本章」等结构标签。{word_count_req}"""
        title_line = ""
        if target_chapter and (target_chapter.title or "").strip():
            title_line = f"\n【当前章节已有标题（可改写或沿用模型生成的 title）】{target_chapter.title.strip()}"

    context = memory.build_context(chapter_summary)

    user = f"""{context}

【本章任务】
本章概要：{_clip(chapter_summary, _TASK_SUMMARY_MAX) or '（无）'}
{title_line}

请严格按 system 要求的 JSON 结构输出。"""

    return system, user


def run_react_chapter_generation(
    db: Session,
    novel: Novel,
    chapter_summary: str,
    target_chapter: Chapter | None,
    llm: LLMProvider,
    *,
    fixed_title: str | None = None,
    max_iterations: int = 8,
    new_sort_order: int | None = None,
    word_count: int | None = None,
):
    """使用 ReAct Agent 执行章节生成（推理-工具-生成循环）。

    流程：
    1. Agent 推理是否需要调用工具获取上下文
    2. 工具（获取作品设定/前文概要/人物）返回 Observation
    3. 循环直到 Agent 认为上下文足够，调用 generate_chapter 工具
    4. generate_chapter 工具流式输出正文内容（纯文本）

    Yields:
        str: 正文 chunks（实时流式输出）
        Chapter: 最终章节对象（生成完毕后）
    """
    from app.models import Chapter as ChapterModel
    from sqlalchemy import func, select

    tools = [
        GetPreviousChaptersTool(db, novel),
        GetCharacterProfilesTool(db, novel),
        GetNovelContextTool(db, novel),
        GenerateChapterTool(db, novel, llm, word_count=word_count),
    ]

    task = _build_react_task(chapter_summary, fixed_title, word_count=word_count)

    agent = ReActAgent(llm, tools, max_iterations=max_iterations)

    # 收集 chunks（流式输出为纯正文，过滤 think 标签）
    result_chunks: list[str] = []
    for chunk in filter_think_chunks(
        agent.run(
            task,
            stream=True,
            fallback_params={"chapter_summary": chapter_summary, "fixed_title": fixed_title, "word_count": word_count},
        )
    ):
        result_chunks.append(chunk)
        yield chunk  # 实时流式 yield 给调用者

    # run_stream() 输出纯正文，无需 JSON 解析
    body_text = _sanitize_generated_body("".join(result_chunks))
    
    if fixed_title is not None:
        # 用户手动填写并锁定了标题
        title_out = fixed_title
    elif target_chapter and (target_chapter.title or "").strip():
        # 章节已有标题，沿用旧标题（不调用 LLM，节省时间）
        title_out = target_chapter.title.strip()
    else:
        # 章节没有标题，需要生成
        title_out = _generate_chapter_title(
            db,
            llm,
            novel,
            target_chapter,
            chapter_summary=chapter_summary,
            body_text=body_text,
        )

    if target_chapter is None:
        if new_sort_order is not None:
            next_order = new_sort_order
        else:
            max_order = db.scalar(
                select(func.max(ChapterModel.sort_order)).where(ChapterModel.novel_id == novel.id)
            )
            next_order = (max_order or 0) + 1
        ch = ChapterModel(
            novel_id=novel.id,
            title=title_out,
            summary=chapter_summary.strip(),
            content=body_text,
            sort_order=next_order,
        )
        db.add(ch)
    else:
        target_chapter.summary = chapter_summary.strip()
        target_chapter.content = body_text
        target_chapter.title = title_out
        db.add(target_chapter)
        ch = target_chapter

    db.commit()
    db.refresh(ch)
    yield ch


def _build_react_task(chapter_summary: str, fixed_title: str | None, word_count: int | None = None) -> str:
    """构建 ReAct Agent 的任务描述。"""
    title_req = f"本章标题已指定为「{fixed_title}」，请在生成正文时不要写入标题。" if fixed_title else "标题将在生成后自动提取或由用户指定。"
    
    word_count_req = ""
    if word_count and 500 <= word_count <= 4000:
        word_count_req = f"\n6. 正文长度尽量控制在 {word_count} 字左右（允许上下浮动 10%）。"
    
    return f"""请为小说创作本章正文。

【本章概要】
{chapter_summary}

【要求】
1. {title_req}
2. 正文应符合作品设定、文风和类型。
3. 情节需与前文衔接自然，人物言行符合其设定。
4. 请先使用工具获取必要的上下文信息（作品设定、前文情节、人物设定），然后生成正文。
5. 最终输出直接是小说正文内容，不需要任何 JSON 包装。{word_count_req}"""


def _sanitize_generated_body(raw: str) -> str:
    text = _strip_code_fence(raw)
    final_match = re.search(r"(?:^|\n)\s*Final[:：]\s*(.*)$", text, re.DOTALL)
    if final_match:
        text = final_match.group(1)

    lines = text.splitlines()
    while lines and re.match(r"^\s*(Thought|Action|Observation)[:：]", lines[0]):
        lines.pop(0)

    return "\n".join(lines).strip()


def _filter_flexible_agent_output(chunks: list[str]) -> tuple[list[str], list[str]]:
    """过滤 FlexibleNovelAgent 的输出，分离正文内容和状态信息。
    
    返回: (正文内容 chunks, 状态信息列表)
    """
    body_chunks: list[str] = []
    status_messages: list[str] = []
    
    for chunk in chunks:
        if chunk.startswith("[思考]") or chunk.startswith("[调用工具]") or chunk.startswith("[工具结果]") or chunk.startswith("[完成]") or chunk.startswith("[开始生成正文]") or chunk.startswith("[系统]") or chunk.startswith("[错误]"):
            status_messages.append(chunk.strip())
        else:
            body_chunks.append(chunk)
    
    return body_chunks, status_messages


def run_flexible_chapter_generation(
    db: Session,
    novel: Novel,
    chapter_summary: str,
    target_chapter: Chapter | None,
    llm: LLMProvider,
    *,
    fixed_title: str | None = None,
    max_iterations: int = 12,
    timeout_seconds: float = 180.0,
    new_sort_order: int | None = None,
    word_count: int | None = None,
):
    """使用 FlexibleNovelAgent 执行章节生成。

    核心特点：
    1. 让模型自己决定如何行动（调用哪个工具、调用多少次、何时停止）
    2. 使用 JSON 结构化输出，让模型清晰地表达意图
    3. 保留最大迭代次数和超时控制，确保前端响应时间可控
    4. 添加 finish 工具，让模型自己决定何时完成任务

    与旧版 ReActAgent 的区别：
    - 不再硬编码 ReAct 格式（Thought: ...\nAction: ...）
    - 不再硬编码 GenerateChapterTool 调用后直接返回
    - 让模型通过 finish 工具自己决定何时停止
    - 使用 JSON 格式，更清晰、更易于解析

    Yields:
        str: 正文 chunks（实时流式输出）
        Chapter: 最终章节对象（生成完毕后）
    """
    from app.models import Chapter as ChapterModel
    from sqlalchemy import func, select

    tools = [
        GetPreviousChaptersTool(db, novel),
        GetCharacterProfilesTool(db, novel),
        GetNovelContextTool(db, novel),
        GenerateChapterTool(db, novel, llm, word_count=word_count),
        FinishTool(),
    ]

    task = _build_flexible_task(chapter_summary, fixed_title, word_count=word_count)

    agent = FlexibleNovelAgent(
        llm, 
        tools, 
        max_iterations=max_iterations,
        timeout_seconds=timeout_seconds,
    )

    all_chunks: list[str] = []
    for chunk in agent.run(
        task,
        stream=True,
        fallback_params={"chapter_summary": chapter_summary, "fixed_title": fixed_title, "word_count": word_count},
    ):
        all_chunks.append(chunk)
        if not (chunk.startswith("[思考]") or chunk.startswith("[调用工具]") or chunk.startswith("[工具结果]") or chunk.startswith("[完成]") or chunk.startswith("[开始生成正文]") or chunk.startswith("[系统]") or chunk.startswith("[错误]")):
            yield chunk

    body_chunks, status_messages = _filter_flexible_agent_output(all_chunks)
    
    body_text = _sanitize_generated_body("".join(body_chunks))
    
    if fixed_title is not None:
        # 用户手动填写并锁定了标题
        title_out = fixed_title
    elif target_chapter and (target_chapter.title or "").strip():
        # 章节已有标题，沿用旧标题（不调用 LLM，节省时间）
        title_out = target_chapter.title.strip()
    else:
        # 章节没有标题，需要生成
        title_out = _generate_chapter_title(
            db,
            llm,
            novel,
            target_chapter,
            chapter_summary=chapter_summary,
            body_text=body_text,
        )

    if target_chapter is None:
        if new_sort_order is not None:
            next_order = new_sort_order
        else:
            max_order = db.scalar(
                select(func.max(ChapterModel.sort_order)).where(ChapterModel.novel_id == novel.id)
            )
            next_order = (max_order or 0) + 1
        ch = ChapterModel(
            novel_id=novel.id,
            title=title_out,
            summary=chapter_summary.strip(),
            content=body_text,
            sort_order=next_order,
        )
        db.add(ch)
    else:
        target_chapter.summary = chapter_summary.strip()
        target_chapter.content = body_text
        target_chapter.title = title_out
        db.add(target_chapter)
        ch = target_chapter

    db.commit()
    db.refresh(ch)
    yield ch


def _build_flexible_task(chapter_summary: str, fixed_title: str | None, word_count: int | None = None) -> str:
    """构建 FlexibleNovelAgent 的任务描述。"""
    title_req = f"本章标题已指定为「{fixed_title}」，请在生成正文时不要写入标题。" if fixed_title else "标题将在生成后自动提取或由用户指定。"
    
    word_count_req = ""
    if word_count and 500 <= word_count <= 4000:
        word_count_req = f"\n- 正文长度尽量控制在 {word_count} 字左右（允许上下浮动 10%）。"
    
    return f"""请为小说创作本章正文。

【本章概要】
{chapter_summary}

【任务目标】
1. {title_req}
2. 正文应符合作品设定、文风和类型。
3. 情节需与前文衔接自然，人物言行符合其设定。
4. 请根据需要调用工具获取必要的上下文信息（作品设定、前文情节、人物设定）。
5. 在收集到足够的上下文信息后，调用 generate_chapter 工具生成正文。
6. 生成正文后，调用 finish 工具完成任务。{word_count_req}

【工作流程建议】
虽然你可以自由决定行动顺序，但建议遵循以下流程：
1. 调用 get_novel_context 获取作品基础设定
2. 调用 get_previous_chapters 获取前文情节
3. 调用 get_character_profiles 获取相关人物设定
4. 调用 generate_chapter 生成章节正文
5. 调用 finish 完成任务

【重要规则】
1. 只有在调用 generate_chapter 生成正文后，才能调用 finish
2. 不要在没有生成正文的情况下就调用 finish
3. 你最多可以调用 {max_iterations} 次工具，请合理规划
4. 请确保你的输出始终是有效的 JSON 格式"""


def _generate_chapter_title(
    db: Session,
    llm: LLMProvider,
    novel: Novel,
    target_chapter: Chapter | None,
    *,
    chapter_summary: str,
    body_text: str,
) -> str:
    if not body_text.strip():
        return (target_chapter.title or "").strip() if target_chapter else ""

    existing_titles = list_existing_chapter_titles(
        db,
        novel.id,
        exclude_chapter_id=target_chapter.id if target_chapter else None,
    )
    candidate = Chapter(
        novel_id=novel.id,
        title=(target_chapter.title or "") if target_chapter else "",
        summary=chapter_summary.strip(),
        content=body_text,
        sort_order=target_chapter.sort_order if target_chapter else 0,
    )
    system, user = messages_suggest_chapter_title(novel, candidate, existing_titles=existing_titles)
    raw = "".join(filter_think_chunks(llm.stream_complete(system, user))).strip()
    return ensure_unique_chapter_title(finalize_suggested_title(raw), existing_titles)


def plan_batch_chapters(
    db: Session,
    novel: Novel,
    llm: LLMProvider,
    *,
    total_summary: str,
    chapter_count: int,
    after_chapter: Chapter | None = None,
) -> list[dict[str, str]]:
    memory = NovelMemory(db, novel)
    context = memory.build_context(total_summary)
    existing_titles = list_existing_chapter_titles(
        db,
        novel.id,
        exclude_chapter_id=after_chapter.id if after_chapter else None,
    )

    system = (
        "你是资深中文长篇小说策划编辑。请把用户给出的后续总概要拆分成逐章计划。\n"
        "【重要】禁止输出思考过程、推理步骤或 think 标签。\n"
        "你必须只输出合法 JSON 对象，结构为 {\"chapters\": [{\"title\": \"...\", \"summary\": \"...\"}]}。\n"
        "chapters 数组长度必须严格等于用户要求的章节数。\n"
        "每章都要有不重复的标题与摘要；标题不得与已存在章节重名；summary 用 2～4 句概括本章主要推进。\n"
        "当章节数较多时，要注意整体节奏递进，让前几章偏铺垫，中间推动冲突，结尾形成阶段性结果。"
    )
    existing_block = "\n".join(f"- {t}" for t in existing_titles[:80]) or "（无）"
    after_title = after_chapter.title.strip() if after_chapter and (after_chapter.title or "").strip() else "当前章节"
    user = f"""{context}

【已有章节标题（禁止重名）】
{existing_block}

【生成位置】
从《{after_title}》之后开始，连续规划 {chapter_count} 章。

【后续总概要】
{_clip(total_summary, _TASK_SUMMARY_MAX) or '（无）'}

请严格输出 JSON。"""

    raw = "".join(filter_think_chunks(llm.stream_complete(system, user))).strip()
    return _parse_batch_plan(raw, chapter_count=chapter_count, existing_titles=existing_titles)


def _parse_batch_plan(
    raw: str,
    *,
    chapter_count: int,
    existing_titles: list[str] | None = None,
) -> list[dict[str, str]]:
    text = _strip_code_fence(raw)
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError("模型返回的批量章节规划格式不正确，请重试") from e

    if not isinstance(data, dict) or not isinstance(data.get("chapters"), list):
        raise ValueError("模型返回的批量章节规划格式不正确，请重试")

    plan: list[dict[str, str]] = []
    seen_titles = list(existing_titles or [])
    for i, item in enumerate(data.get("chapters") or [], start=1):
        if len(plan) >= chapter_count:
            break
        if not isinstance(item, dict):
            continue
        raw_title = finalize_suggested_title(str(item.get("title") or "").strip()) or f"第{i}章"
        title = ensure_unique_chapter_title(raw_title, seen_titles)
        summary = str(item.get("summary") or "").strip()
        if not summary:
            summary = f"围绕后续主线推进第{i}章剧情，并与前文自然衔接。"
        plan.append({"title": title, "summary": summary})
        seen_titles.append(title)

    if not plan:
        raise ValueError("模型未返回可用的批量章节规划，请重试")

    while len(plan) < chapter_count:
        idx = len(plan) + 1
        title = ensure_unique_chapter_title(f"第{idx}章", seen_titles)
        plan.append(
            {
                "title": title,
                "summary": f"承接后续总概要，推进第{idx}章剧情，并形成明确的场景与冲突。",
            }
        )
        seen_titles.append(title)

    return plan
