"""灵活的小说创作 Agent。

核心思想：
- 让模型自己决定如何行动（调用哪个工具、调用多少次、何时停止
- 使用 JSON 结构化输出，让模型清晰地表达意图
- 保留最大迭代次数和超时控制，确保前端响应时间可控

基于 learn-claude-code 的思想：
"智能体的能力来自模型训练，而不是外部代码编排。Harness（框架）提供环境和工具，模型提供智能和决策能力。"
"""

from __future__ import annotations

from collections.abc import Iterator
import json
import logging
import re
import time

from app.agent.base import BaseTool
from app.agent.tools import GenerateChapterTool
from app.llm.base import LLMProvider

log = logging.getLogger(__name__)


class FinishTool(BaseTool):
    """完成任务工具。让模型自己决定何时完成任务。"""

    name = "finish"
    description = (
        "完成任务。当你已经完成所有必要的步骤并准备好返回最终结果时，使用这个工具。"
        "注意：只有在你已经收集到足够的上下文信息并生成了章节正文后，才应该使用这个工具。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "完成任务的原因说明（可选）",
            },
        },
    }

    def run(self, reason: str = "") -> str:
        return f"任务已完成。原因：{reason or '模型决定完成任务。'}"


class AgentAction:
    """模型的行动意图。"""

    def __init__(
        self,
        action_type: str,
        tool_name: str | None = None,
        tool_params: dict | None = None,
        thought: str | None = None,
        finish_reason: str | None = None,
    ) -> None:
        self.action_type = action_type  # "tool_call", "finish", "retry"
        self.tool_name = tool_name
        self.tool_params = tool_params or {}
        self.thought = thought
        self.finish_reason = finish_reason


def _extract_json_from_text(text: str) -> dict | None:
    """从文本中提取 JSON 对象。
    
    支持多种格式：
    1. 纯 JSON：{"..."}
    2. 代码块中的 JSON：```json {...} ```
    3. Markdown 代码块：``` {...} ```
    """
    text = text.strip()
    
    json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text, re.IGNORECASE)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    
    json_match = re.search(r"(\{[\s\S]*\})", text)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    
    return None


def _parse_agent_response(text: str) -> AgentAction | None:
    """解析模型的响应，提取行动意图。
    
    期望的 JSON 格式：
    {
        "thought": "我需要先获取作品设定和前文情节...",
        "action": "tool_call",
        "tool": "get_novel_context",
        "params": {}
    }
    
    或者：
    {
        "thought": "我已经收集到足够的信息，现在可以完成任务了。",
        "action": "finish",
        "reason": "上下文已获取完成，准备生成正文"
    }
    """
    data = _extract_json_from_text(text)
    if data is None:
        return None
    
    action_type = data.get("action", "")
    thought = data.get("thought")
    
    if action_type == "finish":
        return AgentAction(
            action_type="finish",
            thought=thought,
            finish_reason=data.get("reason"),
        )
    
    if action_type == "tool_call":
        tool_name = data.get("tool")
        if not tool_name:
            return None
        
        return AgentAction(
            action_type="tool_call",
            tool_name=tool_name,
            tool_params=data.get("params", {}),
            thought=thought,
        )
    
    tool_name = data.get("tool")
    if tool_name:
        return AgentAction(
            action_type="tool_call",
            tool_name=tool_name,
            tool_params=data.get("params", {}),
            thought=thought,
        )
    
    return None


_FLEXIBLE_SYSTEM_PROMPT = """你是一位专业的小说作者，正在使用一套创作工具来帮助你创作章节。

## 可用工具

{tool_descriptions}

## 输出格式要求

你必须始终以 JSON 格式输出你的意图。你可以选择两种行动类型：

### 1. 调用工具 (tool_call)

当你需要获取信息或执行某个操作时，使用此格式：

```json
{{
    "thought": "解释你为什么要调用这个工具，以及你期望从中学到什么",
    "action": "tool_call",
    "tool": "工具名称",
    "params": {{
        "参数名1": "参数值1",
        "参数名2": "参数值2"
    }}
}}
```

### 2. 完成任务 (finish)

**重要：只有在以下情况下才能使用 finish：**
- 你已经调用了 get_novel_context 获取了作品基础设定
- 你已经调用了 get_previous_chapters 获取了前文情节
- 你已经调用了 get_character_profiles 获取了相关人物设定（如果本章涉及人物）
- 你已经调用了 generate_chapter 生成了章节正文

或者，如果你认为上下文已经足够且已经生成了正文，可以使用：

```json
{{
    "thought": "解释你为什么认为任务已经完成",
    "action": "finish",
    "reason": "可选的完成原因说明"
}}
```

## 工作流程建议

虽然你可以自由决定行动顺序，但建议遵循以下流程以获得最佳结果：

1. **获取作品基础设定**：调用 get_novel_context
2. **了解前文情节**：调用 get_previous_chapters（可指定 limit 参数获取更多章节）
3. **获取人物设定**：调用 get_character_profiles（传入本章概要以召回相关人物）
4. **生成章节正文**：调用 generate_chapter（传入 chapter_summary 和可选的 fixed_title）
5. **完成任务**：调用 finish

## 重要规则

1. **你可以自由决定工具调用顺序和次数**，但请确保收集到足够的上下文后再生成正文
2. **generate_chapter 工具生成正文后，你应该调用 finish 来完成任务**
3. **不要在没有生成正文的情况下就调用 finish**
4. **你最多可以调用 {max_iterations} 次工具**，超过后会强制完成
5. **请确保你的输出始终是有效的 JSON 格式**，否则会被要求重试

## 工具详细说明

- `get_novel_context`：获取作品的基础设定（标题、类型、写作风格、世界观背景）
- `get_previous_chapters(limit=3)`：获取作品的前 N 章概要，用于了解故事进展
- `get_character_profiles(chapter_summary="...")`：根据本章概要召回可能涉及的人物设定
- `generate_chapter(chapter_summary="...", fixed_title=null)`：生成章节正文（支持流式输出）
- `finish(reason="...")`：完成任务（只能在生成正文后调用）

记住：你的目标是创作出高质量的小说章节。在开始创作之前，请确保你已经充分了解了作品设定、前文情节和相关人物。
"""


_FLEXIBLE_USER_PROMPT = """## 任务

{task}

## 当前状态

当前已执行的步骤：
{history_summary}

剩余工具调用次数：{remaining_iterations}

## 下一步

请根据当前状态，决定你的下一步行动。

如果你认为已经收集到足够的上下文并生成了正文，请调用 finish。
如果你还需要获取更多信息，请调用相应的工具。

请以 JSON 格式输出你的意图。
"""


def _build_tool_description(tool: BaseTool) -> str:
    """构建工具的描述字符串。"""
    params_str = json.dumps(tool.parameters, ensure_ascii=False, indent=2) if tool.parameters else "{}"
    return f"- **{tool.name}**\n  描述：{tool.description}\n  参数：{params_str}"


def _build_history_summary(history: list[str]) -> str:
    """构建历史摘要字符串。"""
    if not history:
        return "尚未执行任何步骤。"
    
    return "\n".join(f"步骤 {i+1}: {item}" for i, item in enumerate(history))


class FlexibleNovelAgent:
    """灵活的小说创作 Agent。

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
    """

    def __init__(
        self,
        llm: LLMProvider,
        tools: list[BaseTool],
        *,
        max_iterations: int = 10,
        timeout_seconds: float = 180.0,
    ) -> None:
        """初始化 Agent。

        Args:
            llm: LLM 提供商
            tools: 可用工具列表
            max_iterations: 最大工具调用次数（默认 10 次）
            timeout_seconds: 超时时间（默认 180 秒）
        """
        self._llm = llm
        self._tools = {t.name: t for t in tools}
        self._max_iterations = max_iterations
        self._timeout_seconds = timeout_seconds

    def _build_system_prompt(self) -> str:
        """构建系统提示词。"""
        tool_descriptions = "\n\n".join(
            _build_tool_description(tool) for tool in self._tools.values()
        )
        return _FLEXIBLE_SYSTEM_PROMPT.format(
            tool_descriptions=tool_descriptions,
            max_iterations=self._max_iterations,
        )

    def run(
        self,
        task: str,
        *,
        stream: bool = True,
        fallback_params: dict[str, object] | None = None,
    ) -> Iterator[str]:
        """执行 Agent 循环。

        Args:
            task: 任务描述
            stream: 是否流式输出最终内容
            fallback_params: 降级参数（用于无法解析时的 fallback）

        Yields:
            str: 思考过程、工具调用信息或生成的正文内容
        """
        history: list[str] = []
        iteration = 0
        start_time = time.time()
        has_generated_content = False

        system_prompt = self._build_system_prompt()

        while iteration < self._max_iterations:
            iteration += 1
            elapsed = time.time() - start_time

            if elapsed > self._timeout_seconds:
                log.warning("Agent 超时，强制完成。已用时间: %.1f秒", elapsed)
                yield from self._fallback_generate(fallback_params, history)
                return

            remaining = self._max_iterations - iteration + 1
            history_summary = _build_history_summary(history)

            user_prompt = _FLEXIBLE_USER_PROMPT.format(
                task=task,
                history_summary=history_summary,
                remaining_iterations=remaining,
            )

            try:
                response = self._llm.complete(system_prompt, user_prompt)
            except Exception as e:
                log.exception("LLM 调用失败")
                if has_generated_content:
                    yield f"\n[系统：LLM 调用失败，但已生成部分内容，任务结束。错误: {e}]\n"
                    return
                yield from self._fallback_generate(fallback_params, history)
                return

            action = _parse_agent_response(response)

            if action is None:
                log.warning("无法解析模型响应，重试。响应: %s", response[:200] if response else "(空)")
                history.append(f"[无法解析响应，将重试]")
                continue

            if action.thought:
                yield f"[思考] {action.thought}\n"

            if action.action_type == "finish":
                if not has_generated_content:
                    log.warning("模型在未生成内容的情况下尝试完成任务。要求继续。")
                    yield "[系统] 检测到你还没有生成章节正文。请先调用 generate_chapter 工具生成正文，然后再调用 finish。\n"
                    history.append("[尝试在未生成内容时完成任务，被要求继续]")
                    continue

                if action.finish_reason:
                    yield f"[完成] {action.finish_reason}\n"
                else:
                    yield "[完成] 任务结束。\n"
                return

            if action.action_type == "tool_call":
                tool_name = action.tool_name
                if tool_name is None:
                    history.append("[无效的工具调用]")
                    continue

                if tool_name == "finish":
                    if not has_generated_content:
                        log.warning("模型在未生成内容的情况下尝试调用 finish 工具。要求继续。")
                        yield "[系统] 检测到你还没有生成章节正文。请先调用 generate_chapter 工具生成正文。\n"
                        history.append("[尝试在未生成内容时调用 finish，被要求继续]")
                        continue
                    
                    if action.tool_params and "reason" in action.tool_params:
                        yield f"[完成] {action.tool_params['reason']}\n"
                    else:
                        yield "[完成] 任务结束。\n"
                    return

                tool = self._tools.get(tool_name)
                if tool is None:
                    error_msg = f"未知工具: {tool_name}"
                    log.warning(error_msg)
                    yield f"[错误] {error_msg}\n"
                    history.append(f"[调用未知工具 {tool_name}]")
                    continue

                if isinstance(tool, GenerateChapterTool):
                    yield f"[开始生成正文]\n"
                    chapter_summary = action.tool_params.get("chapter_summary", "")
                    fixed_title = action.tool_params.get("fixed_title")

                    try:
                        for chunk in tool.run_stream(chapter_summary, fixed_title):
                            yield chunk
                        has_generated_content = True
                        history.append(f"[调用 generate_chapter 生成正文]")
                        continue
                    except Exception as e:
                        log.exception("generate_chapter 工具执行失败")
                        yield f"[错误] 生成正文失败: {e}\n"
                        if has_generated_content:
                            yield "[系统] 已生成部分内容，任务结束。\n"
                            return
                        history.append(f"[generate_chapter 执行失败: {e}]")
                        continue

                try:
                    if action.tool_params:
                        params_str = json.dumps(action.tool_params, ensure_ascii=False)
                        yield f"[调用工具] {tool_name} 参数: {params_str}\n"
                    else:
                        yield f"[调用工具] {tool_name}\n"

                    observation = tool.run(**action.tool_params)

                    yield f"[工具结果] {tool_name} 执行完成\n"

                    history.append(f"[调用 {tool_name}]")

                except Exception as e:
                    log.exception("工具 %s 执行失败", tool_name)
                    error_msg = f"工具 {tool_name} 执行失败: {e}"
                    yield f"[错误] {error_msg}\n"
                    history.append(f"[{tool_name} 执行失败: {e}]")

            else:
                log.warning("未知的行动类型: %s", action.action_type)
                history.append(f"[未知行动类型: {action.action_type}]")

        log.warning("Agent 超过最大迭代次数，强制完成。已执行 %d 次迭代", iteration)
        yield f"[系统] 超过最大工具调用次数({self._max_iterations})，强制完成。\n"

        if not has_generated_content:
            yield from self._fallback_generate(fallback_params, history)

    def _fallback_generate(
        self,
        fallback_params: dict[str, object] | None,
        history: list[str],
    ) -> Iterator[str]:
        """降级生成：直接调用 generate_chapter 工具。"""
        log.warning("Agent 降级到直接生成模式")
        yield "[系统] 切换到直接生成模式...\n"

        tool = next((t for t in self._tools.values() if isinstance(t, GenerateChapterTool)), None)
        if tool is None:
            yield "[错误] 无法找到生成章节的工具。\n"
            return

        params = fallback_params or {}
        chapter_summary = str(params.get("chapter_summary") or "")
        fixed_title_raw = params.get("fixed_title")
        fixed_title = str(fixed_title_raw).strip() if fixed_title_raw else None

        try:
            for chunk in tool.run_stream(chapter_summary=chapter_summary, fixed_title=fixed_title):
                yield chunk
        except Exception as e:
            log.exception("降级生成失败")
            yield f"[错误] 生成失败: {e}\n"
