"""灵活的小说创作 Agent。

核心思想：
- 让模型自己决定如何行动（调用哪个工具、调用多少次、何时停止
- 使用 JSON 结构化输出，让模型清晰地表达意图
- 保留最大迭代次数和超时控制，确保前端响应时间可控
- 支持并行工具调用，一次可以调用多个工具以节省时间

基于 learn-claude-code 的思想：
"智能体的能力来自模型训练，而不是外部代码编排。Harness（框架）提供环境和工具，模型提供智能和决策能力。"
"""

from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import logging
import re
import time

from app.agent.base import BaseTool
from app.agent.tools import FinishTool, GenerateChapterTool
from app.llm.base import LLMProvider
from app.prompts import get_prompt
from app.language import Language

log = logging.getLogger(__name__)


class AgentAction:
    """模型的行动意图。
    
    支持单个工具调用或并行多个工具调用。
    """

    def __init__(
        self,
        action_type: str,
        tool_name: str | None = None,
        tool_params: dict | None = None,
        tool_calls: list[dict] | None = None,
        thought: str | None = None,
        finish_reason: str | None = None,
    ) -> None:
        self.action_type = action_type  # "tool_call", "finish", "retry"
        self.tool_name = tool_name  # 单个工具调用时的工具名（向后兼容）
        self.tool_params = tool_params or {}  # 单个工具调用时的参数（向后兼容）
        self.tool_calls = tool_calls or []  # 多个工具调用时的列表，每个元素是 {"tool": "...", "params": {}}
        self.thought = thought
        self.finish_reason = finish_reason
        
        if not self.tool_calls and self.tool_name:
            self.tool_calls = [{"tool": self.tool_name, "params": self.tool_params}]
    
    @property
    def is_parallel(self) -> bool:
        """是否是并行工具调用（多个工具）。"""
        return len(self.tool_calls) > 1


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
    
    支持的 JSON 格式：
    
    【并行调用多个工具】
    {
        "thought": "我需要同时获取作品设定、前文情节和相关人物，这样可以节省时间。",
        "action": "tool_call",
        "tools": [
            {"tool": "get_novel_context", "params": {}},
            {"tool": "get_previous_chapters", "params": {"limit": 3}},
            {"tool": "get_character_profiles", "params": {"chapter_summary": "..."}}
        ]
    }
    
    【单个工具调用（向后兼容）】
    {
        "thought": "我需要先获取作品设定和前文情节...",
        "action": "tool_call",
        "tool": "get_novel_context",
        "params": {}
    }
    
    【完成任务】
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
        tools = data.get("tools")
        if tools and isinstance(tools, list):
            tool_calls = []
            for tool_item in tools:
                if isinstance(tool_item, dict):
                    tool_name = tool_item.get("tool")
                    if tool_name:
                        tool_calls.append({
                            "tool": tool_name,
                            "params": tool_item.get("params", {})
                        })
            if tool_calls:
                return AgentAction(
                    action_type="tool_call",
                    tool_calls=tool_calls,
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

当你需要获取信息或执行某个操作时，使用此格式。

**你可以一次调用多个工具（并行调用）**，它们会同时执行以节省时间。这是推荐的方式，特别是在需要获取多个信息时。

#### 并行调用多个工具（推荐）

```json
{{
    "thought": "解释你为什么要调用这些工具，以及你期望从中学到什么",
    "action": "tool_call",
    "tools": [
        {{
            "tool": "get_novel_context",
            "params": {{}}
        }},
        {{
            "tool": "get_previous_chapters",
            "params": {{
                "limit": 3
            }}
        }},
        {{
            "tool": "get_character_profiles",
            "params": {{
                "chapter_summary": "本章概要内容"
            }}
        }}
    ]
}}
```

#### 单个工具调用（向后兼容）

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

1. **并行获取上下文**（推荐）：
   同时调用 get_novel_context、get_previous_chapters 和 get_character_profiles
   这样可以节省大量时间！

2. **生成章节正文**：调用 generate_chapter

3. **完成任务**：调用 finish

## 重要规则

1. **你可以自由决定工具调用顺序和次数**，但请确保收集到足够的上下文后再生成正文
2. **推荐并行调用多个工具**（使用 tools 数组格式），这样可以节省时间
3. **generate_chapter 工具必须单独调用**，不能与其他工具并行（因为它是流式输出）
4. **generate_chapter 工具生成正文后，你应该调用 finish 来完成任务**
5. **不要在没有生成正文的情况下就调用 finish**
6. **你最多可以调用 {max_iterations} 次工具**，超过后会强制完成
7. **请确保你的输出始终是有效的 JSON 格式**，否则会被要求重试

## 工具详细说明

- `get_novel_context`：获取作品的基础设定（标题、类型、写作风格、世界观背景）
- `get_previous_chapters(limit=3)`：获取作品的前 N 章概要，用于了解故事进展
- `get_character_profiles(chapter_summary="...")`：根据本章概要召回可能涉及的人物设定
- `generate_chapter(chapter_summary="...", fixed_title=null)`：生成章节正文（支持流式输出）
- `finish(reason="...")`：完成任务（只能在生成正文后调用）

**并行调用示例**（推荐）：
```json
{{
    "thought": "我需要同时获取作品设定、前文情节和相关人物，这样可以节省时间。",
    "action": "tool_call",
    "tools": [
        {{"tool": "get_novel_context", "params": {{}}}},
        {{"tool": "get_previous_chapters", "params": {{"limit": 3}}}},
        {{"tool": "get_character_profiles", "params": {{"chapter_summary": "本章概要"}}}}
    ]
}}
```

记住：你的目标是创作出高质量的小说章节。**并行调用多个工具可以大大节省时间**！
"""


_FLEXIBLE_USER_PROMPT = """## 任务

{task}

## 当前状态

当前已执行的步骤：
{history_summary}

剩余工具调用次数：{remaining_iterations}

## 下一步

请根据当前状态，决定你的下一步行动。

**建议**：如果需要获取多个信息，可以使用并行调用（tools 数组格式）来节省时间。

如果你认为已经收集到足够的上下文并生成了正文，请调用 finish。
如果你还需要获取更多信息，请调用相应的工具。

请以 JSON 格式输出你的意图。
"""


def _build_tool_description(tool: BaseTool) -> str:
    """构建工具的描述字符串。"""
    params_str = json.dumps(tool.parameters, ensure_ascii=False, indent=2) if tool.parameters else "{}"
    return f"- **{tool.name}**\n  描述：{tool.description}\n  参数：{params_str}"


def _build_history_summary(history: list[dict]) -> str:
    """构建历史摘要字符串。
    
    history 中的每个元素是一个字典，包含：
    - type: "tool_call", "tool_result", "thought", "finish", "error"
    - tool_name: 工具名（如果是工具调用）
    - params: 参数（如果是工具调用）
    - result: 结果（如果是工具结果）
    - content: 内容（如果是思考、完成或错误）
    """
    if not history:
        return "尚未执行任何步骤。"
    
    lines = []
    for i, item in enumerate(history):
        step_num = i + 1
        item_type = item.get("type", "")
        
        if item_type == "tool_call":
            tool_name = item.get("tool_name", "unknown")
            params = item.get("params", {})
            if params:
                params_str = json.dumps(params, ensure_ascii=False)
                lines.append(f"步骤 {step_num}: 调用工具 {tool_name}，参数: {params_str}")
            else:
                lines.append(f"步骤 {step_num}: 调用工具 {tool_name}")
        
        elif item_type == "tool_result":
            tool_name = item.get("tool_name", "unknown")
            result = item.get("result", "")
            result_preview = result[:200] + "..." if len(result) > 200 else result
            lines.append(f"步骤 {step_num}: 工具 {tool_name} 返回结果（预览）: {result_preview}")
        
        elif item_type == "thought":
            content = item.get("content", "")
            lines.append(f"步骤 {step_num}: 思考: {content}")
        
        elif item_type == "error":
            content = item.get("content", "")
            lines.append(f"步骤 {step_num}: 错误: {content}")
        
        else:
            lines.append(f"步骤 {step_num}: {item}")
    
    return "\n".join(lines)


class FlexibleNovelAgent:
    """灵活的小说创作 Agent。

    核心特点：
    1. 让模型自己决定如何行动（调用哪个工具、调用多少次、何时停止）
    2. 使用 JSON 结构化输出，让模型清晰地表达意图
    3. 支持并行工具调用，一次可以调用多个工具以节省时间
    4. 保留最大迭代次数和超时控制，确保前端响应时间可控
    5. 添加 finish 工具，让模型自己决定何时完成任务

    与旧版 ReActAgent 的区别：
    - 不再硬编码 ReAct 格式（Thought: ...\nAction: ...）
    - 使用 JSON 格式，更清晰、更易于解析
    - 支持并行工具调用
    """

    def __init__(
        self,
        llm: LLMProvider,
        tools: list[BaseTool],
        *,
        max_iterations: int = 10,
        timeout_seconds: float = 180.0,
        max_workers: int = 4,
        max_parse_failures: int = 3,
        max_tool_calls_per_tool: int = 3,
    ) -> None:
        """初始化 Agent。

        Args:
            llm: LLM 提供商
            tools: 可用工具列表
            max_iterations: 最大工具调用次数（默认 10 次）
            timeout_seconds: 超时时间（默认 180 秒）
            max_workers: 并行工具调用的最大线程数（默认 4）
            max_parse_failures: 最大解析失败次数（默认 3 次，超过后 fallback）
            max_tool_calls_per_tool: 每个工具最多调用次数（默认 3 次，超过后 fallback）
        """
        self._llm = llm
        self._tools = {t.name: t for t in tools}
        self._max_iterations = max_iterations
        self._timeout_seconds = timeout_seconds
        self._max_workers = max_workers
        self._max_parse_failures = max_parse_failures
        self._max_tool_calls_per_tool = max_tool_calls_per_tool

    def _build_system_prompt(self) -> str:
        """构建系统提示词。"""
        tool_descriptions = "\n\n".join(
            _build_tool_description(tool) for tool in self._tools.values()
        )
        return _FLEXIBLE_SYSTEM_PROMPT.format(
            tool_descriptions=tool_descriptions,
            max_iterations=self._max_iterations,
        )
    
    def _execute_tool_call(
        self,
        tool_call: dict,
        fallback_params: dict[str, object] | None,
        has_generated_content: bool,
        history: list[dict],
    ) -> tuple[bool, Iterator[str] | None, list[dict]]:
        """执行单个工具调用。
        
        返回: (should_return, stream_iterator, updated_history)
        - should_return: True 表示应该直接返回
        - stream_iterator: 如果 should_return=True，这个是流式输出的迭代器
        - updated_history: 更新后的历史记录
        """
        tool_name = tool_call.get("tool", "")
        params = tool_call.get("params", {})
        
        updated_history = list(history)
        
        if tool_name == "finish":
            if not has_generated_content:
                log.warning("模型在未生成内容的情况下尝试调用 finish 工具。要求继续。")
                return False, None, updated_history
            
            return True, iter(["[完成] 任务结束。\n"]), updated_history
        
        tool = self._tools.get(tool_name)
        if tool is None:
            error_msg = f"未知工具: {tool_name}"
            log.warning(error_msg)
            updated_history.append({
                "type": "error",
                "content": f"调用未知工具 {tool_name}"
            })
            return False, None, updated_history
        
        if isinstance(tool, GenerateChapterTool):
            chapter_summary = params.get("chapter_summary", "")
            fixed_title = params.get("fixed_title")
            
            updated_history.append({
                "type": "tool_call",
                "tool_name": tool_name,
                "params": params
            })
            
            def generate_stream():
                yield "[开始生成正文]\n"
                try:
                    for chunk in tool.run_stream(chapter_summary, fixed_title):
                        yield chunk
                except Exception as e:
                    log.exception("generate_chapter 工具执行失败")
                    yield f"[错误] 生成正文失败: {e}\n"
            
            return True, generate_stream(), updated_history
        
        try:
            updated_history.append({
                "type": "tool_call",
                "tool_name": tool_name,
                "params": params
            })
            
            observation = tool.run(**params)
            
            updated_history.append({
                "type": "tool_result",
                "tool_name": tool_name,
                "result": observation
            })
            
            return False, None, updated_history
            
        except Exception as e:
            log.exception("工具 %s 执行失败", tool_name)
            updated_history.append({
                "type": "error",
                "content": f"{tool_name} 执行失败: {e}"
            })
            return False, None, updated_history
    
    def _execute_parallel_tools(
        self,
        tool_calls: list[dict],
    ) -> tuple[list[dict], bool]:
        """并行执行多个工具调用（非 generate_chapter 类型）。
        
        返回: (history_entries, has_generate_chapter)
        - history_entries: 要添加到历史的条目列表
        - has_generate_chapter: 是否包含 generate_chapter（需要特殊处理）
        """
        history_entries: list[dict] = []
        
        generate_calls = [tc for tc in tool_calls if tc.get("tool") == "generate_chapter"]
        finish_calls = [tc for tc in tool_calls if tc.get("tool") == "finish"]
        other_calls = [tc for tc in tool_calls if tc.get("tool") not in ("generate_chapter", "finish")]
        
        if generate_calls:
            if len(tool_calls) > 1:
                log.warning("generate_chapter 与其他工具并行调用，generate_chapter 必须单独处理")
            return history_entries, True
        
        if finish_calls:
            log.warning("finish 与其他工具并行调用，finish 必须单独处理")
            return history_entries, False
        
        def execute_single(tool_call: dict) -> dict:
            tool_name = tool_call.get("tool", "")
            params = tool_call.get("params", {})
            
            tool = self._tools.get(tool_name)
            if tool is None:
                return {
                    "type": "error",
                    "content": f"调用未知工具 {tool_name}"
                }
            
            try:
                observation = tool.run(**params)
                return {
                    "type": "tool_result",
                    "tool_name": tool_name,
                    "result": observation
                }
            except Exception as e:
                log.exception("工具 %s 执行失败", tool_name)
                return {
                    "type": "error",
                    "content": f"{tool_name} 执行失败: {e}"
                }
        
        with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
            future_to_call = {executor.submit(execute_single, tc): tc for tc in other_calls}
            
            for future in as_completed(future_to_call):
                try:
                    result = future.result()
                    history_entries.append(result)
                except Exception as e:
                    log.exception("并行工具执行失败")
                    tool_call = future_to_call[future]
                    tool_name = tool_call.get("tool", "unknown")
                    history_entries.append({
                        "type": "error",
                        "content": f"{tool_name} 执行失败: {e}"
                    })
        
        return history_entries, False

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
        history: list[dict] = []
        iteration = 0
        start_time = time.time()
        has_generated_content = False
        parse_failures = 0
        tool_status: dict[str, str] = {}

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
                parse_failures += 1
                log.warning(
                    "无法解析模型响应（第 %d 次），响应: %s",
                    parse_failures,
                    response[:200] if response else "(空)"
                )
                
                if parse_failures >= self._max_parse_failures:
                    log.warning(
                        "解析失败次数超过限制 (%d 次)，fallback 到直接生成模式",
                        self._max_parse_failures
                    )
                    yield from self._fallback_generate(fallback_params, history)
                    return
                
                history.append({
                    "type": "error",
                    "content": f"无法解析模型响应，将重试（第 {parse_failures} 次）"
                })
                continue

            if action.thought:
                history.append({
                    "type": "thought",
                    "content": action.thought
                })

            if action.action_type == "finish":
                if not has_generated_content:
                    log.warning("模型在未生成内容的情况下尝试完成任务。要求继续。")
                    yield "[系统] 检测到你还没有生成章节正文。请先调用 generate_chapter 工具生成正文，然后再调用 finish。\n"
                    history.append({
                        "type": "error",
                        "content": "尝试在未生成内容时完成任务，被要求继续"
                    })
                    continue

                if action.finish_reason:
                    yield f"[完成] {action.finish_reason}\n"
                else:
                    yield "[完成] 任务结束。\n"
                return

            if action.action_type == "tool_call":
                if not action.tool_calls:
                    history.append({
                        "type": "error",
                        "content": "无效的工具调用"
                    })
                    continue
                
                has_generate_chapter = any(tc.get("tool") == "generate_chapter" for tc in action.tool_calls)
                
                if not has_generate_chapter:
                    for tool_call in action.tool_calls:
                        tool_name = tool_call.get("tool", "")
                        if tool_name in ("generate_chapter", "finish"):
                            continue
                        
                        status = tool_status.get(tool_name)
                        
                        if status == "success":
                            log.warning(
                                "工具 %s 已成功调用过，不应再次调用。fallback 到直接生成模式",
                                tool_name
                            )
                            yield from self._fallback_generate(fallback_params, history)
                            return
                        elif status == "failed_retry":
                            log.warning(
                                "工具 %s 已失败两次，不应再调用。fallback 到直接生成模式",
                                tool_name
                            )
                            yield from self._fallback_generate(fallback_params, history)
                            return
                
                if len(action.tool_calls) == 1:
                    tool_call = action.tool_calls[0]
                    tool_name = tool_call.get("tool", "")
                    params = tool_call.get("params", {})
                    
                    if tool_name == "finish":
                        if not has_generated_content:
                            log.warning("模型在未生成内容的情况下尝试调用 finish 工具。要求继续。")
                            yield "[系统] 检测到你还没有生成章节正文。请先调用 generate_chapter 工具生成正文。\n"
                            history.append({
                                "type": "error",
                                "content": "尝试在未生成内容时调用 finish，被要求继续"
                            })
                            continue
                        
                        if params and "reason" in params:
                            yield f"[完成] {params['reason']}\n"
                        else:
                            yield "[完成] 任务结束。\n"
                        return
                    
                    tool = self._tools.get(tool_name)
                    if tool is None:
                        error_msg = f"未知工具: {tool_name}"
                        log.warning(error_msg)
                        yield f"[错误] {error_msg}\n"
                        history.append({
                            "type": "error",
                            "content": f"调用未知工具 {tool_name}"
                        })
                        continue
                    
                    if isinstance(tool, GenerateChapterTool):
                        yield f"[开始生成正文]\n"
                        chapter_summary = params.get("chapter_summary", "")
                        fixed_title = params.get("fixed_title")
                        
                        history.append({
                            "type": "tool_call",
                            "tool_name": tool_name,
                            "params": params
                        })
                        
                        try:
                            for chunk in tool.run_stream(chapter_summary, fixed_title):
                                yield chunk
                            has_generated_content = True
                            history.append({
                                "type": "tool_result",
                                "tool_name": tool_name,
                                "result": "正文已生成（流式输出）"
                            })
                            continue
                        except Exception as e:
                            log.exception("generate_chapter 工具执行失败")
                            yield f"[错误] 生成正文失败: {e}\n"
                            if has_generated_content:
                                yield "[系统] 已生成部分内容，任务结束。\n"
                                return
                            history.append({
                                "type": "error",
                                "content": f"generate_chapter 执行失败: {e}"
                            })
                            continue
                    
                    try:
                        if params:
                            params_str = json.dumps(params, ensure_ascii=False)
                            yield f"[调用工具] {tool_name} 参数: {params_str}\n"
                        else:
                            yield f"[调用工具] {tool_name}\n"
                        
                        history.append({
                            "type": "tool_call",
                            "tool_name": tool_name,
                            "params": params
                        })
                        
                        observation = tool.run(**params)
                        
                        yield f"[工具结果] {tool_name} 执行完成\n"
                        
                        tool_status[tool_name] = "success"
                        
                        history.append({
                            "type": "tool_result",
                            "tool_name": tool_name,
                            "result": observation
                        })
                        
                    except Exception as e:
                        log.exception("工具 %s 执行失败", tool_name)
                        error_msg = f"工具 {tool_name} 执行失败: {e}"
                        yield f"[错误] {error_msg}\n"
                        
                        current_status = tool_status.get(tool_name)
                        if current_status == "failed":
                            tool_status[tool_name] = "failed_retry"
                        elif current_status != "failed_retry":
                            tool_status[tool_name] = "failed"
                        
                        history.append({
                            "type": "error",
                            "content": f"{tool_name} 执行失败: {e}"
                        })
                
                else:
                    yield "[并行调用工具]\n"
                    for tool_call in action.tool_calls:
                        tool_name = tool_call.get("tool", "")
                        params = tool_call.get("params", {})
                        if params:
                            params_str = json.dumps(params, ensure_ascii=False)
                            yield f"  - {tool_name}: {params_str}\n"
                        else:
                            yield f"  - {tool_name}\n"
                    
                    has_generate = any(tc.get("tool") == "generate_chapter" for tc in action.tool_calls)
                    if has_generate:
                        log.warning("generate_chapter 不能与其他工具并行调用，将单独处理")
                        for tool_call in action.tool_calls:
                            if tool_call.get("tool") == "generate_chapter":
                                history.append({
                                    "type": "tool_call",
                                    "tool_name": "generate_chapter",
                                    "params": tool_call.get("params", {})
                                })
                                tool = self._tools.get("generate_chapter")
                                if tool and isinstance(tool, GenerateChapterTool):
                                    chapter_summary = tool_call.get("params", {}).get("chapter_summary", "")
                                    fixed_title = tool_call.get("params", {}).get("fixed_title")
                                    yield "[开始生成正文]\n"
                                    try:
                                        for chunk in tool.run_stream(chapter_summary, fixed_title):
                                            yield chunk
                                        has_generated_content = True
                                        tool_status["generate_chapter"] = "success"
                                        history.append({
                                            "type": "tool_result",
                                            "tool_name": "generate_chapter",
                                            "result": "正文已生成（流式输出）"
                                        })
                                    except Exception as e:
                                        log.exception("generate_chapter 工具执行失败")
                                        current_status = tool_status.get("generate_chapter")
                                        if current_status == "failed":
                                            tool_status["generate_chapter"] = "failed_retry"
                                        elif current_status != "failed_retry":
                                            tool_status["generate_chapter"] = "failed"
                                        yield f"[错误] 生成正文失败: {e}\n"
                        continue
                    
                    history_entries, _ = self._execute_parallel_tools(action.tool_calls)
                    
                    for entry in history_entries:
                        tool_name = entry.get("tool_name", "unknown")
                        if entry.get("type") == "error":
                            current_status = tool_status.get(tool_name)
                            if current_status == "failed":
                                tool_status[tool_name] = "failed_retry"
                            elif current_status != "failed_retry":
                                tool_status[tool_name] = "failed"
                            yield f"[错误] {entry.get('content')}\n"
                        elif entry.get("type") == "tool_result":
                            tool_status[tool_name] = "success"
                            yield f"[工具结果] {tool_name} 执行完成\n"
                    
                    history.extend(history_entries)
                    
                    yield "[并行调用完成]\n"

            else:
                log.warning("未知的行动类型: %s", action.action_type)
                history.append({
                    "type": "error",
                    "content": f"未知行动类型: {action.action_type}"
                })

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
