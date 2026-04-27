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
from app.language import Language
from app.prompts import get_prompt

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
    language: Language = "zh",
) -> tuple[str, str]:
    """构建章节生成的 system prompt 和 user prompt。

    内部使用 NovelMemory 统一管理上下文检索（章节召回 + 人物召回）。
    """
    memory = NovelMemory(db, novel)

    word_count_req = ""
    if word_count and 500 <= word_count <= 4000:
        word_count_req = get_prompt("gen_word_count_req", language, count=word_count)

    if fixed_title:
        system = get_prompt("gen_system_fixed_title", language, word_count_req=word_count_req)
        title_line = get_prompt("gen_title_line_fixed", language, title=fixed_title.strip())
    else:
        system = get_prompt("gen_system_dynamic_title", language, word_count_req=word_count_req)
        title_line = ""
        if target_chapter and (target_chapter.title or "").strip():
            title_line = get_prompt("gen_title_line_existing", language, title=target_chapter.title.strip())

    context = memory.build_context(chapter_summary)

    summary_display = _clip(chapter_summary, _TASK_SUMMARY_MAX) or get_prompt("common_none", language)
    user = (
        context + "\n\n" +
        get_prompt("gen_user_task", language, summary=summary_display) +
        title_line + "\n\n" +
        get_prompt("gen_user_warning", language)
    )

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
    language: Language = "zh",
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
        GenerateChapterTool(db, novel, llm, word_count=word_count, language=language),
    ]

    task = _build_react_task(chapter_summary, fixed_title, word_count=word_count, language=language)

    agent = ReActAgent(llm, tools, max_iterations=max_iterations)

    result_chunks: list[str] = []
    for chunk in filter_think_chunks(
        agent.run(
            task,
            stream=True,
            fallback_params={"chapter_summary": chapter_summary, "fixed_title": fixed_title, "word_count": word_count, "language": language},
        )
    ):
        result_chunks.append(chunk)
        yield chunk

    body_text = _sanitize_generated_body("".join(result_chunks))
    
    if fixed_title is not None:
        title_out = fixed_title
    elif target_chapter and (target_chapter.title or "").strip():
        title_out = target_chapter.title.strip()
    else:
        title_out = _generate_chapter_title(
            db,
            llm,
            novel,
            target_chapter,
            chapter_summary=chapter_summary,
            body_text=body_text,
            language=language,
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


def _build_react_task(chapter_summary: str, fixed_title: str | None, word_count: int | None = None, *, language: Language = "zh") -> str:
    """构建 ReAct Agent 的任务描述。"""
    if fixed_title:
        title_req = get_prompt("react_title_req_fixed", language, title=fixed_title)
    else:
        title_req = get_prompt("react_title_req_dynamic", language)
    
    word_count_req = ""
    if word_count and 500 <= word_count <= 4000:
        word_count_req = get_prompt("react_word_count_req", language, count=word_count)
    
    return get_prompt(
        "react_task_intro", 
        language, 
        summary=chapter_summary, 
        title_req=title_req,
        word_count_req=word_count_req
    )


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
    language: Language = "zh",
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
        GenerateChapterTool(db, novel, llm, word_count=word_count, language=language),
        FinishTool(),
    ]

    task = _build_flexible_task(chapter_summary, fixed_title, word_count=word_count, language=language)

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
        fallback_params={"chapter_summary": chapter_summary, "fixed_title": fixed_title, "word_count": word_count, "language": language},
    ):
        all_chunks.append(chunk)
        if not (chunk.startswith("[思考]") or chunk.startswith("[调用工具]") or chunk.startswith("[工具结果]") or chunk.startswith("[完成]") or chunk.startswith("[开始生成正文]") or chunk.startswith("[系统]") or chunk.startswith("[错误]")):
            yield chunk

    body_chunks, status_messages = _filter_flexible_agent_output(all_chunks)
    
    body_text = _sanitize_generated_body("".join(body_chunks))
    
    if fixed_title is not None:
        title_out = fixed_title
    elif target_chapter and (target_chapter.title or "").strip():
        title_out = target_chapter.title.strip()
    else:
        title_out = _generate_chapter_title(
            db,
            llm,
            novel,
            target_chapter,
            chapter_summary=chapter_summary,
            body_text=body_text,
            language=language,
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


def _build_flexible_task(chapter_summary: str, fixed_title: str | None, word_count: int | None = None, *, language: Language = "zh") -> str:
    """构建 FlexibleNovelAgent 的任务描述。"""
    if fixed_title:
        title_req = get_prompt("flexible_title_req_fixed", language, title=fixed_title)
    else:
        title_req = get_prompt("flexible_title_req_dynamic", language)
    
    word_count_req = ""
    if word_count and 500 <= word_count <= 4000:
        word_count_req = get_prompt("flexible_word_count_req", language, count=word_count)
    
    return get_prompt(
        "flexible_task_intro", 
        language, 
        summary=chapter_summary, 
        title_req=title_req,
        word_count_req=word_count_req
    )


def _generate_chapter_title(
    db: Session,
    llm: LLMProvider,
    novel: Novel,
    target_chapter: Chapter | None,
    *,
    chapter_summary: str,
    body_text: str,
    language: Language = "zh",
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
    system, user = messages_suggest_chapter_title(novel, candidate, existing_titles=existing_titles, language=language)
    raw = "".join(filter_think_chunks(llm.stream_complete(system, user))).strip()
    return ensure_unique_chapter_title(finalize_suggested_title(raw), existing_titles, language=language)


def plan_batch_chapters(
    db: Session,
    novel: Novel,
    llm: LLMProvider,
    *,
    total_summary: str,
    chapter_count: int,
    after_chapter: Chapter | None = None,
    language: Language = "zh",
) -> list[dict[str, str]]:
    memory = NovelMemory(db, novel)
    context = memory.build_context(total_summary)
    existing_titles = list_existing_chapter_titles(
        db,
        novel.id,
        exclude_chapter_id=after_chapter.id if after_chapter else None,
    )

    system = get_prompt("batch_plan_system", language)
    existing_block = "\n".join(f"- {t}" for t in existing_titles[:80]) or get_prompt("batch_plan_no_existing", language)
    after_title = after_chapter.title.strip() if after_chapter and (after_chapter.title or "").strip() else get_prompt("batch_plan_current_chapter", language)
    
    total_summary_display = _clip(total_summary, _TASK_SUMMARY_MAX) or get_prompt("common_none", language)
    user = (
        context + "\n\n" +
        get_prompt("batch_plan_user_existing", language, existing_titles=existing_block) +
        get_prompt("batch_plan_user_position", language, after_title=after_title, chapter_count=chapter_count) +
        get_prompt("batch_plan_user_summary", language, total_summary=total_summary_display) +
        get_prompt("batch_plan_user_closing", language)
    )

    raw = "".join(filter_think_chunks(llm.stream_complete(system, user))).strip()
    return _parse_batch_plan(raw, chapter_count=chapter_count, existing_titles=existing_titles, language=language)


def _parse_batch_plan(
    raw: str,
    *,
    chapter_count: int,
    existing_titles: list[str] | None = None,
    language: Language = "zh",
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
        raw_title = finalize_suggested_title(str(item.get("title") or "").strip()) or get_prompt("common_chapter", language, i=i)
        title = ensure_unique_chapter_title(raw_title, seen_titles, language=language)
        summary = str(item.get("summary") or "").strip()
        if not summary:
            summary = get_prompt("batch_plan_default_summary", language, idx=i)
        plan.append({"title": title, "summary": summary})
        seen_titles.append(title)

    if not plan:
        raise ValueError("模型未返回可用的批量章节规划，请重试")

    while len(plan) < chapter_count:
        idx = len(plan) + 1
        title = ensure_unique_chapter_title(get_prompt("common_chapter", language, i=idx), seen_titles, language=language)
        plan.append(
            {
                "title": title,
                "summary": get_prompt("batch_plan_default_summary_alt", language, idx=idx),
            }
        )
        seen_titles.append(title)

    return plan


def run_direct_chapter_generation(
    db: Session,
    novel: Novel,
    chapter_summary: str,
    target_chapter: Chapter | None,
    llm: LLMProvider,
    *,
    fixed_title: str | None = None,
    new_sort_order: int | None = None,
    word_count: int | None = None,
    save_to_db: bool = True,
    language: Language = "zh",
) -> tuple[str, str] | tuple[str, str, Chapter]:
    """直接调用 LLM 生成章节，不经过 Agent 循环。

    适用于简单任务场景，减少 LLM 交互轮数。

    Args:
        save_to_db: 是否保存到数据库（False 表示预览模式）

    Returns:
        如果 save_to_db=True: (title, content, Chapter)
        如果 save_to_db=False: (title, content)
    """
    from app.models import Chapter as ChapterModel
    from sqlalchemy import func, select

    system, user = build_generation_prompt(
        db, novel, chapter_summary, target_chapter,
        fixed_title=fixed_title, word_count=word_count, language=language
    )

    raw = llm.complete(system, user)

    need_title = fixed_title is None
    title_out, body_text = parse_chapter_generation_json(raw, need_title=need_title)

    if fixed_title is not None:
        title_out = fixed_title
    elif target_chapter and (target_chapter.title or "").strip():
        title_out = target_chapter.title.strip()
    elif not title_out.strip():
        title_out = _generate_chapter_title(
            db, llm, novel, target_chapter,
            chapter_summary=chapter_summary, body_text=body_text, language=language
        )

    if not save_to_db:
        return title_out, body_text

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
    return title_out, body_text, ch
