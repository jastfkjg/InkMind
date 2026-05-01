"""ReAct 推理循环 Agent。"""

from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import logging
import re
import time

from app.agent.base import BaseTool
from app.agent.tools import GenerateChapterTool
from app.llm.base import LLMProvider

log = logging.getLogger(__name__)

_REACT_SYSTEM = """你是一个专注于小说创作的 AI 助手。你可以使用工具来获取信息并完成任务。

【可用工具】
{tool_descriptions}

【重要规则】
1. 你必须先调用工具获取必要的上下文信息，然后才能生成正文。
2. 工具调用总是可用的，不要认为工具不可用。
3. 你可以自由决定调用哪些工具、调用多少次。
4. 你可以一次调用多个工具（并行调用），它们会同时执行以节省时间。

【工作流程】
1. 获取作品基础设定（get_novel_context）、前文情节（get_previous_chapters）、相关人物（get_character_profiles）
   这些工具可以**并行调用**，一次返回多个 Action
2. 调用 generate_chapter 生成章节正文

【回复格式】
每次回复必须严格按以下格式之一：

**需要调用工具时：**
Thought: <解释你为什么要调用这些工具>
Action: <工具名>:<JSON参数对象>
Action: <工具名>:<JSON参数对象>
...

你可以一次列出多个 Action，它们会并行执行。

例如（并行调用多个工具）：
Thought: 我需要同时获取作品设定、前文情节和相关人物，这样可以节省时间。
Action: get_novel_context:{{}}
Action: get_previous_chapters:{{"limit": 3}}
Action: get_character_profiles:{{"chapter_summary": "本章概要..."}}

例如（单次调用）：
Thought: 我需要先了解作品的基础设定。
Action: get_novel_context:{{}}

【注意】
- generate_chapter 工具必须单独调用，不能与其他工具并行。
- 工具调用的 JSON 参数必须是有效的 JSON 格式。
- 如果觉得信息不够，继续调用其他工具，不要放弃。
"""

_REACT_USER_TEMPLATE = """任务：{task}

对话历史：
{history}

请根据上述信息，思考下一步应该怎么做。你可以一次调用多个工具（并行）以节省时间。"""


def _parse_response(text: str) -> tuple[str | None, list[dict], str | None]:
    """解析 ReAct 输出（支持并行调用）。

    返回 (thought, actions, final_content)：
    - 若为 Final 格式：thought=None, actions=[], final_content=内容
    - 若为 Action 格式：thought=思考, actions=[{tool, params}, ...], final_content=None
    - 无法解析：三者均为 None/[]
    """
    text = text.strip()

    final_match = re.search(r"(?:^|\n)\s*Final[:：]\s*(.*)$", text, re.DOTALL)
    if final_match:
        return None, [], final_match.group(1).strip()

    thought_match = re.search(r"(?:^|\n)\s*Thought[:：]\s*(.*?)(?=\n\s*Action[:：]|$)", text, re.DOTALL)
    thought = thought_match.group(1).strip() if thought_match else None

    action_pattern = r"(?:^|\n)\s*Action[:：]\s*([^:\s]+):(.+?)(?=\n\s*Action[:：]|$)"
    action_matches = re.findall(action_pattern, text, re.DOTALL)

    actions = []
    for tool_name, raw_params in action_matches:
        tool_name = tool_name.strip()
        raw_params = raw_params.strip()
        try:
            params = json.loads(raw_params)
        except json.JSONDecodeError:
            params = {}
        actions.append({"tool": tool_name, "params": params})

    if actions:
        return thought, actions, None

    return None, [], None


_ERROR_KEYWORDS = [
    "工具", "错误", "失败", "无法", "不可用", "请提供", "确认工具",
    "缺乏", "概要", "人物资料", "世界观", "主要人物", "前情提要",
    "重试", "调用失败", "执行失败",
]


def _is_valid_final_content(content: str) -> bool:
    """检查 Final 内容是否看起来像是有效的小说正文。
    
    返回 True 表示内容有效，应该直接返回。
    返回 False 表示内容可能是错误信息，应该 fallback 到直接生成模式。
    """
    if not content or not content.strip():
        return False
    
    clean = content.strip()
    
    if len(clean) < 100:
        for keyword in _ERROR_KEYWORDS:
            if keyword in clean:
                return False
        return True
    
    error_count = 0
    for keyword in _ERROR_KEYWORDS:
        if keyword in clean:
            error_count += 1
            if error_count >= 3:
                return False
    
    chinese_count = len(re.findall(r"[\u4e00-\u9fff]", clean))
    if chinese_count < len(clean) * 0.3:
        return False
    
    return True


class ReActAgent:
    """ReAct（Reason + Act）推理循环 Agent。

    循环：
    1. LLM 生成 Thought
    2. 若有 Action，执行工具（支持并行调用），返回 Observation
    3. 若无 Action（Final），返回最终内容
    4. 超过 max_iterations 仍未完成时强制输出
    """

    def __init__(
        self,
        llm: LLMProvider,
        tools: list[BaseTool],
        *,
        max_iterations: int = 8,
        max_workers: int = 4,
        timeout_seconds: float = 180.0,
        max_tool_calls_per_tool: int = 3,
    ) -> None:
        self._llm = llm
        self._tools = {t.name: t for t in tools}
        self._max_iterations = max_iterations
        self._max_workers = max_workers
        self._timeout_seconds = timeout_seconds
        self._max_tool_calls_per_tool = max_tool_calls_per_tool

    def _build_system_prompt(self) -> str:
        tool_descs = []
        for tool in self._tools.values():
            params_str = json.dumps(tool.parameters, ensure_ascii=False, indent=2) if tool.parameters else "{}"
            tool_descs.append(f"- {tool.name}({params_str}): {tool.description}")
        return _REACT_SYSTEM.format(tool_descriptions="\n".join(tool_descs))

    def _execute_tools_parallel(
        self,
        actions: list[dict],
        fallback_params: dict[str, object] | None = None,
    ) -> tuple[list[tuple[str, str]], bool, Iterator[str] | None]:
        """并行执行多个工具。

        返回 (observations, should_return, stream_iterator)
        - observations: [(tool_name, result), ...]
        - should_return: True 表示应该直接返回（例如调用了 generate_chapter）
        - stream_iterator: 如果 should_return=True，这个是流式输出的迭代器
        """
        observations: list[tuple[str, str]] = []
        generate_actions = [a for a in actions if a.get("tool") == "generate_chapter"]

        if generate_actions:
            if len(actions) > 1:
                log.warning("generate_chapter 与其他工具并行调用，将优先执行 generate_chapter")
            
            action = generate_actions[0]
            tool = self._tools.get("generate_chapter")
            if tool and isinstance(tool, GenerateChapterTool):
                chapter_summary = action.get("params", {}).get("chapter_summary", "")
                fixed_title = action.get("params", {}).get("fixed_title")
                return [], True, tool.run_stream(chapter_summary, fixed_title)
            else:
                observations.append(("generate_chapter", "（错误：未知工具 generate_chapter）"))
                return observations, False, None

        def execute_single(action: dict) -> tuple[str, str]:
            tool_name = action.get("tool", "")
            params = action.get("params", {})
            
            tool = self._tools.get(tool_name)
            if tool is None:
                return tool_name, f"（错误：未知工具 {tool_name}）"
            
            try:
                result = tool.run(**params)
                return tool_name, result
            except Exception as e:
                log.exception("tool %s failed", tool_name)
                return tool_name, f"（工具执行失败：{e}）"

        with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
            future_to_action = {executor.submit(execute_single, action): action for action in actions}
            
            for future in as_completed(future_to_action):
                try:
                    tool_name, result = future.result()
                    observations.append((tool_name, result))
                except Exception as e:
                    log.exception("parallel tool execution failed")
                    action = future_to_action[future]
                    tool_name = action.get("tool", "unknown")
                    observations.append((tool_name, f"（执行失败：{e}）"))

        return observations, False, None

    def run(
        self,
        task: str,
        *,
        stream: bool = True,
        fallback_params: dict[str, object] | None = None,
    ) -> Iterator[str]:
        """执行 ReAct 循环。stream=True 时流式返回最终内容。
        
        支持并行工具调用：LLM 可以一次返回多个 Action，它们会并行执行以节省时间。
        """
        history: list[str] = []
        iteration = 0
        start_time = time.time()
        tool_status: dict[str, str] = {}

        while iteration < self._max_iterations:
            iteration += 1
            elapsed = time.time() - start_time

            if elapsed > self._timeout_seconds:
                log.warning("ReAct Agent 超时，强制完成。已用时间: %.1f秒", elapsed)
                yield from self._fallback_generate(fallback_params)
                return

            history_block = "\n\n".join(history) if history else "（无历史记录）"
            user_msg = _REACT_USER_TEMPLATE.format(task=task, history=history_block)

            try:
                response = self._llm.complete(self._build_system_prompt(), user_msg)
            except Exception as e:
                log.exception("LLM 调用失败")
                yield from self._fallback_generate(fallback_params)
                return

            thought, actions, final_content = _parse_response(response)

            if final_content is not None and not actions:
                if _is_valid_final_content(final_content):
                    yield final_content
                    return
                else:
                    log.warning("Final 内容看起来不像是有效的正文，fallback 到直接生成模式。内容预览: %s", final_content[:200] if final_content else "(空)")
                    yield from self._fallback_generate(fallback_params)
                    return

            if actions:
                has_generate_chapter = any(a.get("tool") == "generate_chapter" for a in actions)
                
                if not has_generate_chapter:
                    for action in actions:
                        tool_name = action.get("tool", "")
                        status = tool_status.get(tool_name)
                        
                        if status == "success":
                            log.warning(
                                "工具 %s 已成功调用过，不应再次调用。fallback 到直接生成模式",
                                tool_name
                            )
                            yield from self._fallback_generate(fallback_params)
                            return
                        elif status == "failed_retry":
                            log.warning(
                                "工具 %s 已失败两次，不应再调用。fallback 到直接生成模式",
                                tool_name
                            )
                            yield from self._fallback_generate(fallback_params)
                            return

                observations, should_return, stream_iter = self._execute_tools_parallel(actions, fallback_params)
                
                if should_return and stream_iter is not None:
                    for chunk in stream_iter:
                        yield chunk
                    return

                history_entries = []
                for i, (tool_name, result) in enumerate(observations):
                    is_error = "错误" in result or "失败" in result or "执行失败" in result
                    
                    if is_error:
                        current_status = tool_status.get(tool_name)
                        if current_status == "failed":
                            tool_status[tool_name] = "failed_retry"
                        elif current_status != "failed_retry":
                            tool_status[tool_name] = "failed"
                    else:
                        tool_status[tool_name] = "success"
                    
                    result_preview = result[:300] + "..." if len(result) > 300 else result
                    history_entries.append(f"Action: {tool_name}:{{...}}\nObservation: {result_preview}")
                
                if thought:
                    history.append(f"Thought: {thought}\n" + "\n".join(history_entries))
                else:
                    history.append("\n".join(history_entries))
            else:
                log.warning("failed to parse react output, fallback to generate_chapter")
                yield from self._fallback_generate(fallback_params)
                return

        log.warning("react loop exceeded max iterations, fallback to generate_chapter")
        yield from self._fallback_generate(fallback_params)

    def _fallback_generate(self, fallback_params: dict[str, object] | None = None) -> Iterator[str]:
        tool = next((t for t in self._tools.values() if isinstance(t, GenerateChapterTool)), None)
        if tool is None:
            return
        params = fallback_params or {}
        chapter_summary = str(params.get("chapter_summary") or "")
        fixed_title_raw = params.get("fixed_title")
        fixed_title = str(fixed_title_raw).strip() if fixed_title_raw else None
        yield from tool.run_stream(chapter_summary=chapter_summary, fixed_title=fixed_title)
