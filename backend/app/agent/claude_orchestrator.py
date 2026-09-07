"""Claude 编排器 —— 项目总指挥。

使用 claude-agent-sdk 的 ClaudeSDKClient 实现 Claude 作为总指挥：
- 理解用户意图
- 管理项目状态（通过 @tool 定义的 MCP 工具读 DB）
- 拆解任务步骤
- 调度子智能体（Qwen/Minimax）执行内容生成
- 与用户对话（问偏好、确认继续、展示摘要）

核心流程：
1. 用户消息 → ClaudeSDKClient.query() → Claude 推理
2. Claude 调用 MCP 工具（get_novel_state / dispatch_generation_task / ask_user 等）
3. 工具结果 → Claude 继续推理 → 可能再调用工具或回复用户
4. 生成任务 → 写入 TaskQueue → 子智能体执行 → 结果返回 Claude
5. SDK 消息流 → 转换为 SSE 事件 → 前端实时展示
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    UserMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    ResultMessage,
    create_sdk_mcp_server,
)
from claude_agent_sdk.types import (
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
)

from app.agent.agent_tools import ALL_TOOLS, ALL_TOOL_NAMES, init_tool_context
from app.agent.sub_agent import register_sub_agent_handlers
from app.agent.task_queue import get_task_queue
from app.config import settings
from app.database import SessionLocal
from app.language import Language
from app.llm.anthropic_auth import resolve_claude_auth_mode
from app.llm.metered_llm import LLMUsageAccumulator
from app.llm.sse_stream import SseEvent, SseStreamBuilder, sse_agent_step, sse_error
from app.llm.token_counter import count_tokens
from app.models import Novel, User

log = logging.getLogger(__name__)

_SDK_CONNECT_TIMEOUT_SECONDS = 30.0
_SDK_QUERY_TIMEOUT_SECONDS = 30.0
_SDK_IDLE_TIMEOUT_SECONDS = 90.0
_SESSION_TTL_SECONDS = 1800.0
_MAX_CONCURRENT_SESSIONS = 10
_CLEANUP_INTERVAL_SECONDS = 300.0

_WRITING_PHASES: dict[str, str] = {
    "read_context": "读取作品状态",
    "chapter_summary": "生成本章摘要",
    "user_confirm": "用户确认",
    "chapter_content": "生成正文",
    "quality_check": "质量检查",
    "save_chapter": "保存章节",
}

_ORCHESTRATOR_SYSTEM_PROMPT = """你是 InkMind 的 AI 创作总监（项目总指挥）。你的职责是：

1. **理解用户意图**：分析用户的创作需求，判断需要执行什么操作
2. **管理项目状态**：通过工具读取小说的当前进度、章节、人物等
3. **拆解任务步骤**：将复杂的创作需求分解为可执行的步骤
4. **调度子智能体**：将内容生成任务派发给专业的执行模型
5. **与用户对话**：询问创作偏好、确认继续、展示摘要等

## 工作原则

- 你是**总指挥**，不直接生成小说正文，而是调度子智能体执行
- 先了解项目状态，再制定计划，最后执行
- 主动向用户确认关键决策（风格、方向、字数等）
- 生成任务提交后，轮询等待结果，然后向用户汇报
- 生成正文任务会由系统实时流式展示给用户；拿到任务结果后不要再把完整正文重复粘贴给用户，只需继续质检、保存或简短说明
- 用中文与用户交流
- **引用章节时务必使用 chapter_number 字段**（如"第3章"），不要使用 id 或 sort_order
- 不要向用户展示数据库章节 ID，例如"章节 ID: 51"。需要说明章节位置时，只说"第 N 章"或章节标题。

## 写作任务固定阶段

当用户要求"写一章 / 续写一章 / 生成下一章"等章节写作任务时，必须按固定阶段执行，不要自由跳步：

1. **读取作品状态**：优先调用 `get_writing_context_pack`，一次性取得最近章节摘要、活跃人物、伏笔、禁写内容、目标字数和风格约束。除非上下文包缺失关键信息，否则不要重复调用 `get_chapters` / `get_characters` / `get_memos`。
2. **生成本章摘要**：基于 WritingContextPack 调度 `generate_summary` 或自行整理本章概要，明确标题倾向、冲突、推进点和结尾悬念。
3. **用户确认**：调用 AskUserQuestion，请用户确认摘要方向，至少提供"按此生成正文"和"调整方向"两个选项。
4. **生成正文**：调度 `generate_chapter`，必须把 `context_pack`、`chapter_summary`、`fixed_title`（如已确定）和 `word_count` 传给子智能体。若用户没给字数，使用上下文包里的 `target_word_count`。
5. **质量检查**：保存前必须调用 `quality_check_chapter`，检查标题、摘要、正文长度、禁写内容和基本一致性。若只有 warning 可向用户说明后继续；error 必须修复。
6. **保存章节**：用户确认保存或明确要求自动保存时，调用 `save_chapter`，并使用上下文包里的 `next_sort_order`。

当用户要求"扩充到目标字数 / 扩写 / 加长"时，必须把 `word_count` 或明确的目标字数传给 `revise_chapter` / `generate_chapter` 任务；如果没有显式数字，使用上下文包的目标字数，且要求新版本明显长于旧版本。

WritingContextPack 在同一次写作任务后续步骤中应复用，不要重复读取相同章节、人物和备忘录。上下文包不足时才补充调用细粒度读取工具。

## ⚠️ 与用户交互的强制规则

**当你需要向用户提问、提供选项或获取确认时，必须使用 AskUserQuestion 工具，绝对不要在回复文本中直接列出选项。**

具体要求：
- 需要用户做选择时（如"选项一/选项二"、"A还是B"），必须用 AskUserQuestion 工具，将选项放在 options 参数中
- 需要用户确认时（如"是否继续？"），必须用 AskUserQuestion 工具
- 需要用户补充信息时，必须用 AskUserQuestion 工具
- 你的文本回复只用于陈述信息、汇报结果、解释情况，不用于呈现交互选项
- 如果回复中出现任何面向用户的问句，例如"你觉得这个方向如何？"、"是否继续？"、"要不要调整？"、"如果有其他想法也可以调整"，必须改用 AskUserQuestion 工具，并至少提供 2 个按钮选项
- 禁止在普通文本回复末尾追加开放式确认句；需要反馈时必须让 UI 展示按钮

AskUserQuestion 的正确用法：
- question: 要问用户的问题（如"你希望怎样处理？"）
- options: 2-4个选项，每个选项有 label（简短标签）和 description（详细说明）
- header: 问题的简短分类标签（如"续写方向"、"字数偏好"）
- multiSelect: 是否允许多选

示例 - 错误做法（禁止）：
❌ "选项一：直接保存这版，紧凑推进剧情 选项二：我让模型扩充到1000-1500字，增加更多对抗细节和描写 你倾向哪个？"

示例 - 正确做法（必须）：
✅ 调用 AskUserQuestion 工具：
  question: "你希望怎样处理这段内容？"
  header: "续写方向"
  options: [
    {label: "紧凑推进", description: "直接保存这版，紧凑推进剧情"},
    {label: "扩充细节", description: "扩充到2000-2500字，增加更多对抗细节和描写"}
  ]

## 可用操作

- 读取作品信息、章节列表、人物设定、备忘录
- 调度章节生成、摘要生成、批量规划、改写、续写、命名等任务
- 向用户提问以获取确认或偏好（必须使用 AskUserQuestion 工具）
- 将生成结果保存为正式章节
"""


@dataclass
class OrchestratorSession:
    session_id: str
    novel_id: int
    user_id: int
    sdk_client: ClaudeSDKClient | None = None
    pending_question: dict[str, Any] | None = None
    pending_task_ids: list[str] = field(default_factory=list)
    question_queue: asyncio.Queue[dict[str, Any] | None] = field(default_factory=asyncio.Queue)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def touch(self) -> None:
        self.updated_at = time.time()

    def is_expired(self) -> bool:
        return time.time() - self.updated_at > _SESSION_TTL_SECONDS

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "novel_id": self.novel_id,
            "user_id": self.user_id,
            "pending_question": self.pending_question,
            "pending_task_ids": self.pending_task_ids,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


_active_sessions: dict[str, OrchestratorSession] = {}
_pending_user_input_events: dict[str, asyncio.Event] = {}
_pending_user_input_answers: dict[str, dict[str, str]] = {}
_cleanup_task: asyncio.Task | None = None


async def _disconnect_session_client(session: OrchestratorSession) -> None:
    if session.sdk_client is not None:
        try:
            await session.sdk_client.disconnect()
        except Exception as e:
            log.warning("Failed to disconnect SDK client: %s", e)
        session.sdk_client = None


async def interrupt_orchestrator_session(session: OrchestratorSession, reason: str = "任务已中断") -> None:
    _cancel_pending_questions(session, reason)
    queue = get_task_queue()
    for task_id in list(session.pending_task_ids):
        try:
            await queue.cancel(task_id)
        except Exception:
            log.exception("cancel pending task failed task_id=%s", task_id)
    session.pending_task_ids.clear()
    await _disconnect_session_client(session)
    session.touch()


async def close_orchestrator_session(session: OrchestratorSession, reason: str = "会话已关闭") -> None:
    await interrupt_orchestrator_session(session, reason)
    _active_sessions.pop(session.session_id, None)


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)
        try:
            expired = [
                sid for sid, s in _active_sessions.items()
                if s.is_expired() and s.pending_question is None
            ]
            for sid in expired:
                session = _active_sessions.pop(sid, None)
                if session and session.sdk_client is not None:
                    try:
                        await session.sdk_client.disconnect()
                    except Exception:
                        pass
                log.info("Session expired and cleaned up: %s", sid)
            if expired:
                log.info("Cleaned up %d expired sessions", len(expired))
        except Exception:
            log.exception("Session cleanup error")


def _ensure_cleanup_running() -> None:
    global _cleanup_task
    if _cleanup_task is not None and not _cleanup_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
        _cleanup_task = loop.create_task(_cleanup_loop())
    except RuntimeError:
        pass


def _resolve_user_input(question_id: str, answers: dict[str, str]) -> bool:
    if question_id not in _pending_user_input_events:
        return False
    _pending_user_input_answers[question_id] = answers
    _pending_user_input_events[question_id].set()
    return True


def _cancel_pending_questions(session: OrchestratorSession, reason: str = "") -> None:
    if session.pending_question:
        qid = session.pending_question.get("question_id")
        if qid and qid in _pending_user_input_events:
            _pending_user_input_answers[qid] = {"": reason or "cancelled"}
            _pending_user_input_events[qid].set()
        session.pending_question = None


def _build_mcp_server(novel_id: int, session_id: str = "") -> dict[str, Any]:
    init_tool_context(SessionLocal, novel_id, session_id)
    return create_sdk_mcp_server(
        name="inkmind",
        version="1.0.0",
        tools=ALL_TOOLS,
    )


async def _can_use_tool(
    tool_name: str,
    input_data: dict[str, Any],
    context: ToolPermissionContext,
) -> PermissionResultAllow | PermissionResultDeny:
    if tool_name == "AskUserQuestion":
        question_id = str(uuid.uuid4())
        event = asyncio.Event()
        _pending_user_input_events[question_id] = event

        questions = input_data.get("questions", [])
        if not isinstance(questions, list):
            questions = []
        first_q = questions[0] if questions and isinstance(questions[0], dict) else {}

        def normalize_options(raw: Any) -> list[dict[str, str]]:
            if not isinstance(raw, list):
                return []
            normalized: list[dict[str, str]] = []
            for item in raw:
                if isinstance(item, str):
                    label = item.strip()
                    if label:
                        normalized.append({"label": label, "description": ""})
                elif isinstance(item, dict):
                    label = str(item.get("label") or "").strip()
                    if label:
                        normalized.append({
                            "label": label,
                            "description": str(item.get("description") or ""),
                        })
            return normalized

        session_id = ""
        for sid, sess in _active_sessions.items():
            if sess.sdk_client is not None:
                session_id = sid
                break

        q_event = {
            "type": "ask_user_question",
            "question_id": question_id,
            "session_id": session_id,
            "questions": questions,
            "question": first_q.get("question", ""),
            "options": normalize_options(first_q.get("options", [])),
            "header": first_q.get("header", ""),
            "multi_select": first_q.get("multiSelect", False),
        }

        if session_id and session_id in _active_sessions:
            await _active_sessions[session_id].question_queue.put(q_event)
        else:
            for sess in _active_sessions.values():
                await sess.question_queue.put(q_event)
                break

        await event.wait()

        answers = _pending_user_input_answers.pop(question_id, {})
        _pending_user_input_events.pop(question_id, None)

        return PermissionResultAllow(
            updated_input={
                "questions": questions,
                "answers": answers,
            }
        )

    return PermissionResultAllow(updated_input=input_data)


async def _drain_sdk_messages(
    client: ClaudeSDKClient,
    output_queue: asyncio.Queue[Any | None],
) -> None:
    try:
        async for message in client.receive_response():
            await output_queue.put(message)
    except Exception as e:
        log.exception("SDK receive_response error")
        await output_queue.put({"_error": str(e)})
    finally:
        await output_queue.put(None)


def _tool_result_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
        nested = content.get("content")
        if nested is not None:
            return _tool_result_text(nested)
        return ""
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            text = _tool_result_text(item)
            if text:
                parts.append(text)
        return "\n".join(parts)
    text = getattr(content, "text", None)
    if isinstance(text, str):
        return text
    nested = getattr(content, "content", None)
    if nested is not None:
        return _tool_result_text(nested)
    return ""


def _parse_tool_json(text: str) -> dict[str, Any] | None:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict):
        return data
    return None


async def _pre_tool_use_hook(
    input_data: Any,
    tool_use_id: str | None,
    context: Any,
) -> dict[str, Any]:
    return {"continue_": True}


_FEEDBACK_QUESTION_RE = re.compile(
    r"(你觉得|您觉得|是否|要不要|需不需要|是否继续|是否保存|希望.*吗|可以调整|其他想法|方向如何|确认|继续|调整)"
)


def _build_synthetic_feedback_question(text: str) -> dict[str, Any] | None:
    normalized = text.strip()
    if not normalized:
        return None
    tail = normalized[-180:]
    if "?" not in tail and "？" not in tail and not _FEEDBACK_QUESTION_RE.search(tail):
        return None
    if not _FEEDBACK_QUESTION_RE.search(tail):
        return None
    question = tail
    sentence_parts = re.split(r"(?<=[。！？!?])", tail)
    if sentence_parts:
        question = "".join(sentence_parts[-2:]).strip() or tail
    return {
        "type": "ask_user_question",
        "question_id": f"synthetic_{uuid.uuid4().hex[:12]}",
        "session_id": "",
        "synthetic": True,
        "questions": [
            {
                "question": question,
                "header": "继续方向",
                "options": [
                    {"label": "按此继续", "description": "认可当前方向，让 AI 继续推进"},
                    {"label": "调整方向", "description": "补充你的想法后再继续"},
                ],
            }
        ],
        "question": question,
        "options": [
            {"label": "按此继续", "description": "认可当前方向，让 AI 继续推进"},
            {"label": "调整方向", "description": "补充你的想法后再继续"},
        ],
        "header": "继续方向",
        "multi_select": False,
    }


def _task_stream_intro(task_type: str) -> str:
    if task_type == "generate_summary":
        return "\n\n### 章节摘要\n\n"
    if task_type == "generate_chapter":
        return "\n\n### 正文草稿\n\n"
    if task_type == "revise_chapter":
        return "\n\n### 改写草稿\n\n"
    if task_type == "append_chapter":
        return "\n\n### 续写草稿\n\n"
    return "\n\n### 生成内容\n\n"


def _display_text_chunks(text: str) -> list[str]:
    if not text:
        return []
    chunks = re.findall(r".{1,8}(?:[，。！？；：、,.!?;:]|$)|\s+|.{1,8}", text, flags=re.S)
    return [chunk for chunk in chunks if chunk]


async def _stream_display_text(builder: SseStreamBuilder, text: str) -> AsyncIterator[SseEvent]:
    chunks = _display_text_chunks(text)
    for idx, chunk in enumerate(chunks):
        yield builder.build_text_delta(chunk)
        if idx < len(chunks) - 1:
            await asyncio.sleep(0.012)


def _extract_completed_task_text(data: dict[str, Any]) -> tuple[str, str, str] | None:
    if data.get("status") != "completed":
        return None
    task_id = str(data.get("task_id") or "")
    task_type = str(data.get("task_type") or "")
    result = data.get("result")
    if not task_id or not task_type or not isinstance(result, dict):
        return None
    text = ""
    if task_type == "generate_summary":
        text = str(result.get("summary") or "")
    elif task_type == "generate_chapter":
        text = str(result.get("body") or "")
    elif task_type == "revise_chapter":
        text = str(result.get("revised_content") or "")
    elif task_type == "append_chapter":
        text = str(result.get("appended_content") or "")
    text = text.strip()
    if not text:
        return None
    return task_id, task_type, text


async def _stream_task_display_text(
    builder: SseStreamBuilder,
    task_id: str,
    task_type: str,
    text: str,
) -> AsyncIterator[SseEvent]:
    yield builder.build_task_text_delta(
        _task_stream_intro(task_type),
        task_id=task_id,
        task_type=task_type,
    )
    for chunk in _display_text_chunks(text):
        yield builder.build_task_text_delta(chunk, task_id=task_id, task_type=task_type)
        await asyncio.sleep(0.006)


_CLAUDE_MODEL_ENV_NAMES = (
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
)


def _build_claude_cli_env(agent_config: dict[str, str | None]) -> dict[str, str]:
    """Build an isolated Claude CLI environment for the selected connection."""
    api_key = (agent_config.get("api_key") or "").strip()
    base_url = (agent_config.get("base_url") or "").strip()
    model = (agent_config.get("model") or "").strip()

    # Empty values intentionally mask credentials/model mappings inherited by
    # the Electron or backend process from another provider configuration.
    env = {
        "ANTHROPIC_API_KEY": "",
        "ANTHROPIC_AUTH_TOKEN": "",
        "ANTHROPIC_BASE_URL": base_url,
        **{name: "" for name in _CLAUDE_MODEL_ENV_NAMES},
    }
    auth_mode = resolve_claude_auth_mode(
        base_url, agent_config.get("claude_auth_mode")
    )
    if api_key:
        env["ANTHROPIC_AUTH_TOKEN" if auth_mode == "auth_token" else "ANTHROPIC_API_KEY"] = api_key
    if model:
        for name in _CLAUDE_MODEL_ENV_NAMES:
            env[name] = model
    return env


def _build_agent_options(novel_id: int, session_id: str = "", user: User | None = None) -> ClaudeAgentOptions:
    from claude_agent_sdk.types import HookMatcher
    from app.llm.providers import resolve_agent_llm_for_user
    mcp_server = _build_mcp_server(novel_id, session_id)

    db = SessionLocal()
    try:
        agent_config = resolve_agent_llm_for_user(user, db)
    finally:
        db.close()

    env_overrides = _build_claude_cli_env(agent_config)

    options_kwargs: dict[str, Any] = {
        # None loads Claude Code's user/project/local settings, whose env can
        # override this connection (e.g. a stale localhost gateway).
        "setting_sources": [],
        "system_prompt": _ORCHESTRATOR_SYSTEM_PROMPT,
        "mcp_servers": {"inkmind": mcp_server},
        "allowed_tools": ALL_TOOL_NAMES + ["AskUserQuestion"],
        "disallowed_tools": ["Edit", "Write", "MultiEdit", "NotebookEdit"],
        "permission_mode": settings.agent_permission_mode,
        "max_turns": settings.agent_max_turns,
        "can_use_tool": _can_use_tool,
        "hooks": {"PreToolUse": [HookMatcher(matcher=None, hooks=[_pre_tool_use_hook])]},
        "stderr": lambda line: log.warning("Claude CLI stderr: %s", line),
    }
    options_kwargs["env"] = env_overrides
    if settings.claude_cli_path:
        options_kwargs["cli_path"] = settings.claude_cli_path
    if agent_config.get("model"):
        options_kwargs["model"] = agent_config["model"]
    elif settings.anthropic_model:
        options_kwargs["model"] = settings.anthropic_model
    return ClaudeAgentOptions(**options_kwargs)


def _orchestrator_usage_provider() -> str:
    if settings.anthropic_api_key:
        return "anthropic"
    if settings.deepseek_api_key:
        return "deepseek"
    return "anthropic"


def _normalize_tool_name(tool_name: str | None) -> str:
    return (tool_name or "").replace("InkMind::", "").replace("mcp__inkmind__", "")


def _phase_for_tool_call(tool_name: str, params: dict[str, Any] | None = None) -> str | None:
    name = _normalize_tool_name(tool_name)
    if name in {"get_writing_context_pack", "get_novel_state", "get_chapters", "get_characters", "get_memos"}:
        return "read_context"
    if name == "dispatch_generation_task":
        task_type = (params or {}).get("task_type")
        if task_type == "generate_summary":
            return "chapter_summary"
        if task_type == "generate_chapter":
            return "chapter_content"
    if name in {"quality_check_chapter"}:
        return "quality_check"
    if name == "save_chapter":
        return "save_chapter"
    if name == "AskUserQuestion":
        return "user_confirm"
    return None


def _looks_like_chapter_writing_request(message: str) -> bool:
    return any(
        keyword in message
        for keyword in (
            "写一章",
            "生成一章",
            "续写一章",
            "下一章",
            "新章节",
            "保存章节",
            "write a chapter",
            "next chapter",
        )
    )


class ClaudeOrchestrator:
    """Claude 编排器。

    使用 claude-agent-sdk 的 ClaudeSDKClient 实现 Claude 作为项目总指挥。
    """

    def __init__(
        self,
        db_session_factory: Any,
        novel: Novel,
        user: User,
        language: Language = "zh",
    ) -> None:
        self._db_session_factory = db_session_factory
        self._novel = novel
        self._user = user
        self._language = language
        self._queue = get_task_queue()
        register_sub_agent_handlers(
            self._queue, db_session_factory(), novel, language, user_id=user.id
        )

    def create_session(self) -> OrchestratorSession:
        _evict_if_needed()
        session_id = f"osess_{uuid.uuid4().hex[:12]}"
        session = OrchestratorSession(
            session_id=session_id,
            novel_id=self._novel.id,
            user_id=self._user.id,
        )
        _active_sessions[session_id] = session
        _ensure_cleanup_running()
        return session

    def get_session(self, session_id: str) -> OrchestratorSession | None:
        return _active_sessions.get(session_id)

    def _record_orchestrator_usage(
        self,
        session: OrchestratorSession,
        user_message: str,
        assistant_text: str,
    ) -> None:
        provider = _orchestrator_usage_provider()
        db = self._db_session_factory()
        try:
            accumulator = LLMUsageAccumulator(db, session.user_id, provider, "AI助手")
            accumulator.accumulate(
                count_tokens(f"{_ORCHESTRATOR_SYSTEM_PROMPT}\n{user_message}", provider),
                count_tokens(assistant_text, provider),
            )
            accumulator.flush()
        except Exception:
            db.rollback()
            log.exception("record orchestrator usage failed user_id=%s", session.user_id)
        finally:
            db.close()

    async def chat(
        self,
        session: OrchestratorSession,
        user_message: str,
    ) -> AsyncIterator[SseEvent]:
        builder = SseStreamBuilder(workflow_id=session.session_id)
        phase_status: dict[str, str] = {}
        is_chapter_writing = _looks_like_chapter_writing_request(user_message.lower())

        def build_phase(phase_id: str, status: str, detail: str | None = None) -> SseEvent | None:
            if phase_status.get(phase_id) == status and not detail:
                return None
            phase_status[phase_id] = status
            return builder.build_phase_step(
                phase_id,
                status,
                title=_WRITING_PHASES.get(phase_id, phase_id),
                detail=detail,
            )

        yield builder.build_user_message(user_message)
        yield builder.build_status("running")
        _ensure_cleanup_running()
        if is_chapter_writing:
            event = build_phase("read_context", "running", "准备上下文包")
            if event:
                yield event

        try:
            init_tool_context(SessionLocal, session.novel_id, session.session_id)
            if session.sdk_client is None:
                yield builder.build_tool_call_step(
                    tool_name="agent_connect",
                    thought="连接 AI 总指挥",
                )
                options = _build_agent_options(session.novel_id, session.session_id, user=self._user)
                client = ClaudeSDKClient(options=options)
                await asyncio.wait_for(
                    client.connect(),
                    timeout=_SDK_CONNECT_TIMEOUT_SECONDS,
                )
                session.sdk_client = client
                yield builder.build_tool_result_step("agent_connect", "连接已建立")
            else:
                client = session.sdk_client

            session.touch()

            yield builder.build_tool_call_step(
                tool_name="agent_query",
                thought="发送用户请求",
            )
            await asyncio.wait_for(
                client.query(user_message),
                timeout=_SDK_QUERY_TIMEOUT_SECONDS,
            )

            yield builder.build_tool_result_step("agent_query", "请求已发送，等待模型响应")

            full_text = ""
            msg_id = str(uuid.uuid4())
            _, start_event = builder.build_assistant_message_start("")
            yield start_event

            pending_tool_calls: dict[str, str] = {}
            pending_tool_phases: dict[str, str] = {}
            sdk_queue: asyncio.Queue[Any | None] = asyncio.Queue()
            task_stream_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
            submission_queue = await self._queue.subscribe_submissions(session.session_id)
            drain_task = asyncio.create_task(_drain_sdk_messages(client, sdk_queue))
            task_stream_tasks: dict[str, asyncio.Task] = {}
            introduced_task_streams: set[str] = set()
            displayed_task_results: set[str] = set()
            last_activity_at = time.monotonic()
            waiting_for_user = False

            async def forward_task_stream(task_id: str) -> None:
                stream = await self._queue.subscribe_stream(task_id)
                if stream is None:
                    return
                try:
                    while True:
                        item = await stream.get()
                        if item.get("type") == "closed":
                            break
                        await task_stream_queue.put(item)
                finally:
                    await self._queue.unsubscribe_stream(task_id, stream)

            async def emit_pending_task_stream_events() -> AsyncIterator[SseEvent]:
                while not submission_queue.empty():
                    task = submission_queue.get_nowait()
                    if task.task_id not in session.pending_task_ids:
                        session.pending_task_ids.append(task.task_id)
                    if (
                        task.task_id not in task_stream_tasks
                        and task.task_type in {"generate_summary", "generate_chapter", "revise_chapter", "append_chapter"}
                    ):
                        task_stream_tasks[task.task_id] = asyncio.create_task(forward_task_stream(task.task_id))

                while not task_stream_queue.empty():
                    item = task_stream_queue.get_nowait()
                    if item.get("type") == "delta":
                        content = str(item.get("content") or "")
                        if content:
                            task_id = str(item.get("task_id") or "")
                            task_type = str(item.get("task_type") or "")
                            if task_id and task_id not in introduced_task_streams:
                                introduced_task_streams.add(task_id)
                                yield builder.build_task_text_delta(
                                    _task_stream_intro(task_type),
                                    task_id=task_id,
                                    task_type=task_type,
                                )
                            yield builder.build_task_text_delta(content, task_id=task_id, task_type=task_type)
                    elif item.get("type") == "error":
                        err = str(item.get("error") or "")
                        if err:
                            yield builder.build_tool_result_step("sub_agent_stream", err[:200])

            try:
                while True:
                    if (not waiting_for_user and session.pending_question is None
                            and time.monotonic() - last_activity_at > _SDK_IDLE_TIMEOUT_SECONDS):
                        raise asyncio.TimeoutError("模型长时间未返回有效响应")
                    emitted_task_event = False
                    async for event in emit_pending_task_stream_events():
                        emitted_task_event = True
                        last_activity_at = time.monotonic()
                        yield event
                    if emitted_task_event:
                        await asyncio.sleep(0)

                    while not session.question_queue.empty():
                        q_event = session.question_queue.get_nowait()
                        if q_event and q_event.get("type") == "ask_user_question":
                            session.pending_question = q_event
                            waiting_for_user = True
                            last_activity_at = time.monotonic()
                            session.touch()
                            event = build_phase("chapter_summary", "done")
                            if event:
                                yield event
                            event = build_phase("user_confirm", "running", "等待用户确认")
                            if event:
                                yield event
                            yield builder.build_question(
                                q_event.get("question", ""),
                                question_id=q_event.get("question_id"),
                                options=q_event.get("options"),
                                header=q_event.get("header"),
                                allow_custom=True,
                                multi_select=q_event.get("multi_select", False),
                                questions=q_event.get("questions"),
                            )
                            yield builder.build_status("waiting_for_user")

                    try:
                        message = await asyncio.wait_for(sdk_queue.get(), timeout=0.1)
                    except asyncio.TimeoutError:
                        if (
                            not waiting_for_user
                            and session.pending_question is None
                            and time.monotonic() - last_activity_at > _SDK_IDLE_TIMEOUT_SECONDS
                        ):
                            raise asyncio.TimeoutError("模型长时间未返回有效响应")
                        continue

                    if message is None:
                        for _ in range(3):
                            await asyncio.sleep(0)
                            async for event in emit_pending_task_stream_events():
                                yield event
                        break

                    waiting_for_user = session.pending_question is not None
                    if isinstance(message, (AssistantMessage, UserMessage, ResultMessage)):
                        last_activity_at = time.monotonic()
                    session.touch()

                    if isinstance(message, dict) and "_error" in message:
                        yield builder.build_error(message["_error"])
                        break

                    log.debug("SDK message type=%s", type(message).__name__)

                    if isinstance(message, AssistantMessage):
                        if getattr(message, "error", None):
                            err_text = ""
                            for block in message.content:
                                if isinstance(block, TextBlock):
                                    err_text += block.text
                            err_msg = err_text.strip() or f"Assistant error: {message.error}"
                            log.warning("SDK AssistantMessage error: %s", err_msg)
                            yield builder.build_error(err_msg)
                            break
                        for block in message.content:
                            if isinstance(block, TextBlock):
                                full_text += block.text
                                async for event in _stream_display_text(builder, block.text):
                                    yield event
                            elif isinstance(block, ToolUseBlock):
                                tool_name = block.name
                                tool_input = block.input
                                tool_id = block.id
                                log.info("ToolUseBlock: name=%s, input_keys=%s", tool_name, list(tool_input.keys()) if isinstance(tool_input, dict) else "non-dict")
                                pending_tool_calls[tool_id] = tool_name
                                phase_id = _phase_for_tool_call(tool_name, tool_input if isinstance(tool_input, dict) else None)
                                if phase_status.get("user_confirm") == "running" and phase_id != "user_confirm":
                                    event = build_phase("user_confirm", "done")
                                    if event:
                                        yield event
                                if phase_id:
                                    pending_tool_phases[tool_id] = phase_id
                                    event = build_phase(phase_id, "running")
                                    if event:
                                        yield event
                                yield builder.build_tool_call_step(
                                    tool_name=tool_name,
                                    params=tool_input if isinstance(tool_input, dict) else None,
                                    thought=f"调用 {tool_name}",
                                )

                    elif isinstance(message, UserMessage):
                        if isinstance(message.content, list):
                            for block in message.content:
                                if isinstance(block, ToolResultBlock):
                                    tool_use_id = block.tool_use_id
                                    result_text = _tool_result_text(block.content)
                                    preview = result_text[:200] if result_text else ""

                                    tracked_tool = pending_tool_calls.pop(tool_use_id, None)
                                    tracked_phase = pending_tool_phases.pop(tool_use_id, None)
                                    if tracked_tool and "save_chapter" in tracked_tool and preview:
                                        try:
                                            result_data = _parse_tool_json(result_text)
                                            if result_data.get("success"):
                                                yield builder.build_chapter_saved(
                                                    chapter_id=result_data["chapter_id"],
                                                    chapter_number=result_data.get("chapter_number"),
                                                    title=result_data.get("title", ""),
                                                    novel_id=session.novel_id,
                                                    word_count=result_data.get("word_count", 0),
                                                )
                                        except (AttributeError, KeyError):
                                            pass

                                    if tracked_tool and "delete_chapter" in tracked_tool and preview:
                                        try:
                                            result_data = _parse_tool_json(result_text)
                                            if result_data.get("success"):
                                                yield builder.build_chapter_deleted(
                                                    chapter_id=result_data["chapter_id"],
                                                    title=result_data.get("title", ""),
                                                    novel_id=session.novel_id,
                                                )
                                        except (AttributeError, KeyError):
                                            pass

                                    result_tool_name = tracked_tool or f"tool_{tool_use_id[:8]}"
                                    normalized_result_tool = _normalize_tool_name(result_tool_name)
                                    result_data = _parse_tool_json(result_text) if preview else None
                                    if normalized_result_tool == "poll_task_result" and isinstance(result_data, dict):
                                        completed = _extract_completed_task_text(result_data)
                                        if completed:
                                            task_id, task_type, content = completed
                                            if task_id not in introduced_task_streams and task_id not in displayed_task_results:
                                                displayed_task_results.add(task_id)
                                                async for event in _stream_task_display_text(builder, task_id, task_type, content):
                                                    yield event
                                            if task_id in session.pending_task_ids:
                                                session.pending_task_ids.remove(task_id)
                                    elif normalized_result_tool == "poll_multiple_tasks" and isinstance(result_data, dict):
                                        items = result_data.get("tasks") or result_data.get("items") or result_data.get("results") or []
                                        if isinstance(items, list):
                                            for item in items:
                                                if not isinstance(item, dict):
                                                    continue
                                                completed = _extract_completed_task_text(item)
                                                if completed:
                                                    task_id, task_type, content = completed
                                                    if task_id not in introduced_task_streams and task_id not in displayed_task_results:
                                                        displayed_task_results.add(task_id)
                                                        async for event in _stream_task_display_text(builder, task_id, task_type, content):
                                                            yield event
                                                    if task_id in session.pending_task_ids:
                                                        session.pending_task_ids.remove(task_id)

                                    if _normalize_tool_name(result_tool_name) == "dispatch_generation_task" and preview:
                                        result_data = result_data or _parse_tool_json(result_text) or {}
                                        task_id = str(result_data.get("task_id") or "")
                                        task_type = str(result_data.get("task_type") or "")
                                        if task_id and task_id not in session.pending_task_ids:
                                            session.pending_task_ids.append(task_id)
                                        if (
                                            task_id
                                            and task_id not in task_stream_tasks
                                            and task_type in {"generate_summary", "generate_chapter", "revise_chapter", "append_chapter"}
                                        ):
                                            task_stream_tasks[task_id] = asyncio.create_task(forward_task_stream(task_id))
                                    yield builder.build_tool_result_step(
                                        tool_name=result_tool_name,
                                        result_preview=preview,
                                    )
                                    phase_id = tracked_phase or _phase_for_tool_call(result_tool_name)
                                    if phase_id:
                                        detail = None
                                        if phase_id == "read_context":
                                            detail = "上下文包已准备"
                                        elif phase_id == "chapter_content":
                                            detail = "正文生成完成"
                                        elif phase_id == "quality_check":
                                            detail = "检查完成"
                                        elif phase_id == "save_chapter":
                                            detail = "章节已保存"
                                        event = build_phase(phase_id, "done", detail)
                                        if event:
                                            yield event

                    elif isinstance(message, ResultMessage):
                        if message.is_error:
                            err_msg = message.result or "Agent 执行出错"
                            if message.errors:
                                err_msg = "; ".join(message.errors)
                            yield builder.build_error(err_msg)

            finally:
                drain_task.cancel()
                for task in task_stream_tasks.values():
                    task.cancel()
                await self._queue.unsubscribe_submissions(session.session_id, submission_queue)
                try:
                    await drain_task
                except asyncio.CancelledError:
                    pass
                for task in task_stream_tasks.values():
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass

            synthetic_question = None
            if session.pending_question is None:
                synthetic_question = _build_synthetic_feedback_question(full_text)
            if synthetic_question:
                self._record_orchestrator_usage(session, user_message, full_text)
                session.pending_question = synthetic_question
                yield builder.build_question(
                    synthetic_question.get("question", ""),
                    question_id=synthetic_question.get("question_id"),
                    options=synthetic_question.get("options"),
                    header=synthetic_question.get("header"),
                    allow_custom=True,
                    multi_select=False,
                    questions=synthetic_question.get("questions"),
                )
                yield builder.build_status("waiting_for_user")
                yield builder.build_done()
                return

            self._record_orchestrator_usage(session, user_message, full_text)
            yield builder.build_status("idle")
            yield builder.build_done()

        except Exception as e:
            log.exception("ClaudeOrchestrator chat error")
            if isinstance(e, asyncio.TimeoutError):
                failed_client = session.sdk_client
                session.sdk_client = None
                yield builder.build_error("AI 助手等待响应超时，请检查助手模型连接后重试。")
                if failed_client is not None:
                    try:
                        await asyncio.wait_for(failed_client.disconnect(), timeout=5.0)
                    except Exception:
                        log.warning("Timed out SDK client cleanup failed")
            else:
                yield builder.build_error(f"Agent 调用失败: {e}")
            yield builder.build_status("idle")
            yield builder.build_done()

    async def answer_question(
        self,
        session: OrchestratorSession,
        question_id: str,
        answer: str,
        selected_option: str | None = None,
    ) -> dict[str, Any]:
        pending = session.pending_question
        session.pending_question = None
        is_synthetic = bool(pending and pending.get("synthetic"))

        answers: dict[str, str] = {}
        if pending and pending.get("questions"):
            try:
                parsed = json.loads(answer)
            except (TypeError, json.JSONDecodeError):
                parsed = None

            if isinstance(parsed, dict):
                answers = {str(k): str(v) for k, v in parsed.items() if str(v).strip()}
            else:
                answer_text = selected_option or answer
                for q in pending["questions"]:
                    q_text = q.get("question", "") if isinstance(q, dict) else ""
                    answers[q_text] = answer_text
        else:
            answer_text = selected_option or answer
            answers[""] = answer_text

        resolved = False if is_synthetic else _resolve_user_input(question_id, answers)
        if not resolved:
            _cancel_pending_questions(session, "问题已过期")

        session.touch()
        return {"status": "ok", "resolved": resolved, "synthetic": is_synthetic}

    async def close_session(self, session: OrchestratorSession) -> None:
        await close_orchestrator_session(session)

    async def interrupt_session(self, session: OrchestratorSession) -> None:
        await interrupt_orchestrator_session(session)


def _evict_if_needed() -> None:
    if len(_active_sessions) < _MAX_CONCURRENT_SESSIONS:
        return
    sorted_sessions = sorted(
        _active_sessions.items(),
        key=lambda x: x[1].updated_at,
    )
    while len(_active_sessions) >= _MAX_CONCURRENT_SESSIONS and sorted_sessions:
        sid, session = sorted_sessions.pop(0)
        if session.pending_question is None:
            _cancel_pending_questions(session, "会话被淘汰")
            if session.sdk_client is not None:
                try:
                    asyncio.create_task(session.sdk_client.disconnect())
                except Exception:
                    pass
            _active_sessions.pop(sid, None)
            log.info("Evicted oldest session: %s", sid)
