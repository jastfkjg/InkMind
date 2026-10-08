"""子智能体执行器。

Qwen/Minimax/DeepSeek 等模型作为专业执行者，
只负责文本内容生成（章节正文、摘要、命名等），
由 ClaudeOrchestrator 调度。

设计原则：
- 子智能体不参与决策，只执行具体的生成任务
- 每个子智能体任务通过 TaskQueue 解耦
- 执行结果返回给 ClaudeOrchestrator 继续处理
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from sqlalchemy.orm import Session

from app.agent.memory import NovelMemory
from app.agent.task_queue import AgentTask, AgentTaskQueue, AgentTaskStatus, get_task_queue
from app.config import settings
from app.language import Language
from app.llm.base import LLMProvider, calc_max_tokens_from_word_count
from app.llm.providers import get_llm, resolve_llm_for_user
from app.llm.ndjson_stream import filter_think_chunks
from app.models import Chapter, Character, Novel, User
from app.prompts import get_prompt

log = logging.getLogger(__name__)

_BG_MAX = 2200
_WRITING_STYLE_MAX = 700
_SUMMARY_LINE_MAX = 320
_TASK_SUMMARY_MAX = 2800
_PLACEHOLDER_SUMMARY_RE = re.compile(
    r"(本章没有正文|没有正文|暂无正文|占位内容|待补充|无正文|无法生成摘要|未提供正文)"
)


def _clip(s: str | None, n: int) -> str:
    t = (s or "").strip()
    if len(t) <= n:
        return t
    return t[: n - 1] + "…"


def _stream_display_pieces(text: str) -> list[str]:
    if not text:
        return []
    return re.findall(r".{1,10}(?:[，。！？；：、,.!?;:]|$)|\s+|.{1,10}", text, flags=re.S)


def _strip_code_fence(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.MULTILINE)
        s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def _format_context_pack(pack: dict[str, Any]) -> str:
    novel = pack.get("novel", {}) if isinstance(pack.get("novel"), dict) else {}
    style = pack.get("style_constraints", {}) if isinstance(pack.get("style_constraints"), dict) else {}
    lines = [
        "【写作上下文包】",
        f"作品：{novel.get('title', '')}｜类型：{novel.get('genre', '')}",
        f"背景：{_clip(str(novel.get('background') or ''), _BG_MAX)}",
        f"风格：{_clip(str(style.get('voice') or novel.get('writing_style') or ''), _WRITING_STYLE_MAX)}",
    ]

    recent = pack.get("recent_chapter_summaries", [])
    if isinstance(recent, list) and recent:
        lines.append("最近章节：")
        for item in recent[:6]:
            if isinstance(item, dict):
                lines.append(
                    f"- 第{item.get('chapter_number', '?')}章《{item.get('title', '')}》："
                    f"{_clip(str(item.get('summary') or ''), _SUMMARY_LINE_MAX)}"
                )

    characters = pack.get("active_characters", [])
    if isinstance(characters, list) and characters:
        lines.append("活跃人物：")
        for item in characters[:10]:
            if isinstance(item, dict):
                profile = _clip(str(item.get("profile") or item.get("notes") or ""), 220)
                lines.append(f"- {item.get('name', '')}：{profile}")

    foreshadowing = pack.get("foreshadowing", [])
    if isinstance(foreshadowing, list) and foreshadowing:
        lines.append("待回收伏笔/线索：")
        for item in foreshadowing[:8]:
            if isinstance(item, dict):
                lines.append(f"- {item.get('title', '')}：{_clip(str(item.get('body') or ''), 220)}")

    forbidden = pack.get("forbidden_content", [])
    if isinstance(forbidden, list) and forbidden:
        lines.append("禁写/避免内容：")
        for item in forbidden[:8]:
            if isinstance(item, dict):
                lines.append(f"- {item.get('title', '')}：{_clip(str(item.get('body') or ''), 220)}")

    notes = style.get("notes", [])
    if isinstance(notes, list) and notes:
        lines.append("其他约束：")
        for note in notes[:6]:
            lines.append(f"- {_clip(str(note), 180)}")

    return "\n".join(line for line in lines if line.strip())


def _fallback_summary_from_context(context_pack: dict[str, Any], instruction: str = "") -> str:
    recent = context_pack.get("recent_chapter_summaries", [])
    last_title = ""
    last_summary = ""
    if isinstance(recent, list) and recent:
        last = recent[0] if isinstance(recent[0], dict) else {}
        last_title = str(last.get("title") or "")
        last_summary = str(last.get("summary") or "")

    foreshadowing = context_pack.get("foreshadowing", [])
    clue = ""
    if isinstance(foreshadowing, list) and foreshadowing:
        first = foreshadowing[0] if isinstance(foreshadowing[0], dict) else {}
        clue = str(first.get("title") or first.get("body") or "")

    base = instruction or last_summary or "承接上一章冲突，推动主角做出新的选择，并在结尾留下下一步悬念。"
    pieces = [
        f"承接上一章{f'《{last_title}》' if last_title else ''}的局势，围绕“{_clip(base, 120)}”展开。",
        "本章需要明确核心冲突、人物行动和情绪转折，让剧情从余波进入新的对抗。",
    ]
    if clue:
        pieces.append(f"可回收或推进线索：{_clip(clue, 120)}。")
    pieces.append("结尾保留一个清晰钩子，为后续正文生成提供方向。")
    return "".join(pieces)


def _infer_expand_target_word_count(instruction: str, current_length: int) -> int | None:
    text = instruction or ""
    explicit_numbers = [int(n) for n in re.findall(r"(\d{3,5})\s*(?:字|words?|字符)?", text, flags=re.IGNORECASE)]
    for value in explicit_numbers:
        if 800 <= value <= 5000:
            return value
    if re.search(r"(扩充|扩写|加长|拉长|目标字数|更长|丰富|丰满)", text):
        return min(5000, max(1600, int(current_length * 1.65)))
    return None


def _resolve_sub_agent_provider(explicit_provider: str | None = None) -> str:
    provider = explicit_provider or settings.default_llm_provider
    if provider in ("anthropic", "auto"):
        for fallback in ("qwen", "deepseek", "minimax", "openai"):
            key = getattr(settings, f"{fallback}_api_key", None) if fallback != "openai" else settings.openai_api_key
            if key:
                log.info(
                    "Sub-agent: %s is reserved for orchestrator, using %s for content generation",
                    provider,
                    fallback,
                )
                provider = fallback
                break
        else:
            provider = "openai"
    return provider

class SubAgentExecutor:
    """子智能体执行器。

    提供各种文本生成能力，由 ClaudeOrchestrator 通过 TaskQueue 调度。
    """

    def __init__(
        self,
        db: Session,
        novel: Novel,
        language: Language = "zh",
        user_id: int | None = None,
    ) -> None:
        self._db = db
        self._novel = novel
        self._language = language
        self._user_id = user_id

    def _resolve_llm(self, explicit_provider: str | None, action: str) -> LLMProvider:
        provider = _resolve_sub_agent_provider(explicit_provider)
        if self._user_id is None:
            from app.services import billing
            if billing.enabled():
                raise ValueError("收费后台任务必须关联用户。")
            return get_llm(provider)
        user = self._db.get(User, self._user_id)
        if user is None:
            from app.services import billing
            if billing.enabled():
                raise ValueError("后台任务的用户不存在，无法核对额度。")
            return get_llm(provider)
        return resolve_llm_for_user(
            user,
            provider,
            db=self._db,
            action=action,
        )

    async def _collect_streaming_text(
        self,
        task: AgentTask,
        chunks: Any,
        *,
        json_body_only: bool = False,
        progress_message: str = "正在生成正文...",
    ) -> str:
        raw_parts: list[str] = []
        body_streamer = _JsonBodyStreamer() if json_body_only else None
        for chunk in chunks:
            if task.status == AgentTaskStatus.CANCELLED:
                raise asyncio.CancelledError()
            raw_parts.append(chunk)
            visible = body_streamer.feed(chunk) if body_streamer else chunk
            if visible:
                task.progress_message = progress_message
                for piece in _stream_display_pieces(visible):
                    await task.publish_stream_event({"type": "delta", "content": piece})
                    if len(piece) >= 6:
                        await asyncio.sleep(0.004)
        return "".join(raw_parts)

    async def execute_generate_chapter(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        chapter_summary = params.get("chapter_summary", "")
        fixed_title = params.get("fixed_title")
        word_count = params.get("word_count")
        sub_provider = params.get("sub_agent_provider")
        context_pack = params.get("context_pack") if isinstance(params.get("context_pack"), dict) else None

        llm = self._resolve_llm(sub_provider, "AI助手生成章节")
        if context_pack:
            context = _format_context_pack(context_pack)
            style_constraints = context_pack.get("style_constraints", {})
            if not word_count and isinstance(style_constraints, dict):
                word_count = style_constraints.get("target_word_count")
        else:
            memory = NovelMemory(self._db, self._novel)
            context = memory.build_context(chapter_summary)

        word_count_req = ""
        if word_count and 500 <= word_count <= 4000:
            word_count_req = get_prompt("gen_word_count_req", self._language, count=word_count)

        if fixed_title:
            system = get_prompt("gen_system_fixed_title", self._language, word_count_req=word_count_req)
            title_line = get_prompt("gen_title_line_fixed", self._language, title=fixed_title.strip())
        else:
            system = get_prompt("gen_system_dynamic_title", self._language, word_count_req=word_count_req)
            title_line = ""

        summary_display = _clip(chapter_summary, _TASK_SUMMARY_MAX) or get_prompt("common_none", self._language)
        user = (
            context + "\n\n" +
            get_prompt("gen_user_task", self._language, summary=summary_display) +
            title_line + "\n\n" +
            get_prompt("gen_user_warning", self._language)
        )

        raw = (await self._collect_streaming_text(
            task,
            filter_think_chunks(
                llm.stream_complete(system, user, max_tokens=calc_max_tokens_from_word_count(word_count, language=self._language))
            ),
            json_body_only=True,
        )).strip()
        text = _strip_code_fence(raw)

        title_out = ""
        body_text = text
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                title_out = str(data.get("title") or "").strip()
                body_text = str(data.get("body") or "").strip()
        except json.JSONDecodeError:
            pass

        if fixed_title:
            title_out = fixed_title

        return {
            "title": title_out,
            "body": body_text,
            "word_count": len(body_text),
            "provider": sub_provider or settings.default_llm_provider,
        }

    async def execute_generate_summary(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        chapter_content = (params.get("chapter_content") or "").strip()
        chapter_title = (params.get("chapter_title") or "").strip()
        context_pack = params.get("context_pack") if isinstance(params.get("context_pack"), dict) else None
        instruction = str(
            params.get("chapter_summary_hint")
            or params.get("instruction")
            or params.get("summary_hint")
            or ""
        ).strip()

        llm = self._resolve_llm(params.get("sub_agent_provider"), "AI助手生成摘要")
        if chapter_content:
            system = get_prompt("summarize_body_system", self._language)
            title_display = chapter_title or get_prompt("common_none", self._language)
            user_msg = get_prompt(
                "summarize_body_user",
                self._language,
                title=title_display,
                content=chapter_content[:8000],
            )
        else:
            if not context_pack:
                memory = NovelMemory(self._db, self._novel)
                context_text = memory.build_context(instruction)
                context_pack = {}
            else:
                context_text = _format_context_pack(context_pack)
            system = (
                "你是小说章节规划助手。请基于作品上下文生成下一章的可执行章节摘要。"
                "不要声称缺少正文，不要输出占位内容。"
            )
            user_msg = (
                f"{context_text}\n\n"
                "【任务】生成下一章摘要，而不是总结已有正文。\n"
                f"用户/总指挥给出的方向：{instruction or '承接上一章自然推进'}\n\n"
                "要求：\n"
                "1. 120-260字。\n"
                "2. 包含本章核心冲突、人物行动、情绪/关系变化和结尾悬念。\n"
                "3. 可以给出标题倾向，但不要写成正文。\n"
                "4. 禁止输出“本章没有正文”“占位内容”“待补充”等无效内容。\n"
            )
        chunks = filter_think_chunks(llm.stream_complete(system, user_msg))
        if chapter_content:
            summary = (await self._collect_streaming_text(
                task,
                chunks,
                progress_message="正在生成章节摘要...",
            )).strip()
        else:
            raw_parts: list[str] = []
            for chunk in chunks:
                if task.status == AgentTaskStatus.CANCELLED:
                    raise asyncio.CancelledError()
                raw_parts.append(chunk)
            summary = "".join(raw_parts).strip()
        if not summary or _PLACEHOLDER_SUMMARY_RE.search(summary):
            summary = _fallback_summary_from_context(context_pack or {}, instruction)
        if not chapter_content:
            task.progress_message = "正在生成章节摘要..."
            for piece in _stream_display_pieces(summary):
                await task.publish_stream_event({"type": "delta", "content": piece})
                if len(piece) >= 6:
                    await asyncio.sleep(0.004)

        return {"summary": summary}

    async def execute_generate_batch_plan(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        total_summary = params.get("total_summary", "")
        chapter_count = params.get("chapter_count", 1)

        llm = self._resolve_llm(params.get("sub_agent_provider"), "AI助手批量规划")
        memory = NovelMemory(self._db, self._novel)
        context = memory.build_context(total_summary)

        from app.services.chapter_gen import plan_batch_chapters
        plan = plan_batch_chapters(
            self._db,
            self._novel,
            llm,
            total_summary=total_summary,
            chapter_count=chapter_count,
            language=self._language,
        )

        return {"chapters": plan}

    async def execute_revise_chapter(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        chapter_id = params.get("chapter_id")
        instruction = params.get("instruction", "")
        requested_word_count = params.get("word_count") or params.get("target_word_count")

        chapter = self._db.query(Chapter).filter(Chapter.id == chapter_id).first()
        if not chapter:
            return {"error": f"章节 {chapter_id} 不存在"}

        llm = self._resolve_llm(params.get("sub_agent_provider"), "AI助手改写章节")
        current_length = len(chapter.content or "")
        target_word_count = _infer_expand_target_word_count(str(requested_word_count or instruction), current_length)
        final_instruction = instruction
        if target_word_count:
            final_instruction = (
                f"{instruction}\n\n"
                f"【硬性长度要求】当前正文约 {current_length} 字，目标新版本至少 {target_word_count} 字。"
                "必须显著扩充正文，不要只替换场景或缩写原文；请保留原有主线，增加环境、动作、心理、对话和冲突推进细节。"
            )

        from app.services.chapter_llm import messages_revise_chapter_body
        system, user = messages_revise_chapter_body(self._novel, chapter, final_instruction, language=self._language)
        revised = (await self._collect_streaming_text(
            task,
            filter_think_chunks(llm.stream_complete(system, user, max_tokens=calc_max_tokens_from_word_count(target_word_count, language=self._language))),
        )).strip()
        if target_word_count and len(revised) < max(int(target_word_count * 0.85), int(current_length * 1.25)):
            retry_instruction = (
                f"{final_instruction}\n\n"
                f"上一次输出只有约 {len(revised)} 字，仍然偏短。请重新扩写，目标至少 {target_word_count} 字；"
                "不要改成另一个无关场景，不要删减原有剧情信息。"
            )
            system, user = messages_revise_chapter_body(self._novel, chapter, retry_instruction, language=self._language)
            revised = (await self._collect_streaming_text(
                task,
                filter_think_chunks(llm.stream_complete(system, user, max_tokens=calc_max_tokens_from_word_count(target_word_count, language=self._language))),
            )).strip()

        return {
            "revised_content": revised,
            "word_count": len(revised),
            "target_word_count": target_word_count,
        }

    async def execute_append_chapter(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        chapter_id = params.get("chapter_id")
        instruction = params.get("instruction", "")

        chapter = self._db.query(Chapter).filter(Chapter.id == chapter_id).first()
        if not chapter:
            return {"error": f"章节 {chapter_id} 不存在"}

        llm = self._resolve_llm(params.get("sub_agent_provider"), "AI助手续写章节")
        from app.services.chapter_llm import messages_append_chapter_body
        system, user = messages_append_chapter_body(self._novel, chapter, instruction, language=self._language)
        addition = (await self._collect_streaming_text(
            task,
            filter_think_chunks(llm.stream_complete(system, user)),
        )).strip()
        existing = (chapter.content or "").strip()
        appended = addition if not existing else existing.rstrip() + "\n\n" + addition

        return {"appended_content": appended}

    async def execute_naming(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        category = params.get("category", "character")
        description = params.get("description", "")
        hint = params.get("hint", "")

        llm = self._resolve_llm(params.get("sub_agent_provider"), "AI助手命名")
        from app.schemas.ai import NovelNamingIn
        from app.services.novel_ai import novel_naming_suggest
        body = NovelNamingIn(
            category=category,
            description=description or "未提供描述",
            hint=hint,
        )
        result = novel_naming_suggest(llm, self._novel, body, language=self._language)

        return {"names": result}


def register_sub_agent_handlers(
    queue: AgentTaskQueue,
    db: Session,
    novel: Novel,
    language: Language = "zh",
    user_id: int | None = None,
) -> SubAgentExecutor:
    executor = SubAgentExecutor(db, novel, language, user_id=user_id)

    queue.register_handler("generate_chapter", executor.execute_generate_chapter)
    queue.register_handler("generate_summary", executor.execute_generate_summary)
    queue.register_handler("generate_batch_plan", executor.execute_generate_batch_plan)
    queue.register_handler("revise_chapter", executor.execute_revise_chapter)
    queue.register_handler("append_chapter", executor.execute_append_chapter)
    queue.register_handler("naming", executor.execute_naming)

    return executor


class _JsonBodyStreamer:
    """Extract the JSON string field named body while chunks arrive."""

    def __init__(self) -> None:
        self._buffer = ""
        self._in_body = False
        self._escaping = False

    def feed(self, chunk: str) -> str:
        self._buffer += chunk
        if not self._in_body:
            marker_idx = self._buffer.find('"body"')
            if marker_idx < 0:
                self._buffer = self._buffer[-16:]
                return ""
            colon_idx = self._buffer.find(":", marker_idx + len('"body"'))
            if colon_idx < 0:
                self._buffer = self._buffer[marker_idx:]
                return ""
            quote_idx = self._buffer.find('"', colon_idx + 1)
            if quote_idx < 0:
                self._buffer = self._buffer[colon_idx:]
                return ""
            self._buffer = self._buffer[quote_idx + 1:]
            self._in_body = True

        out: list[str] = []
        consumed = 0
        for idx, ch in enumerate(self._buffer):
            consumed = idx + 1
            if self._escaping:
                if ch == "n":
                    out.append("\n")
                elif ch == "t":
                    out.append("\t")
                elif ch == "r":
                    out.append("\r")
                else:
                    out.append(ch)
                self._escaping = False
                continue
            if ch == "\\":
                self._escaping = True
                continue
            if ch == '"':
                self._in_body = False
                break
            out.append(ch)
        self._buffer = self._buffer[consumed:]
        return "".join(out)
