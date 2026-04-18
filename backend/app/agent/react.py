"""ReAct 推理循环 Agent。"""

from __future__ import annotations

from collections.abc import Iterator
import json
import logging
import re

from app.agent.base import BaseTool
from app.agent.tools import GenerateChapterTool
from app.llm.base import LLMProvider

log = logging.getLogger(__name__)

_REACT_SYSTEM = """你是一个专注于小说创作的 AI 助手。你可以使用工具来获取信息并完成任务。

可用工具：
{tool_descriptions}

每次回复必须严格按以下两种格式之一：

**需要更多信息时：**
Thought: <思考接下来需要调用哪个工具，以及传入什么参数>
Action: <工具名>:<JSON参数对象>
（等待 Observation 后继续）

**信息足够，可以生成正文时：**
Final: <你认为应该直接输出的最终内容>

注意事项：
- 只有在收集到足够的上下文（作品设定、前文情节概要、人物设定、本章概要）后，才输出 Final
- Final 应该是小说正文内容，直接输出，不要加任何格式标记
- 如果无法完成任务，说明原因并输出 Final: <说明>
"""

_REACT_USER_TEMPLATE = """任务：{task}

对话历史：
{history}

请根据上述信息，思考下一步应该怎么做。"""


def _parse_response(text: str) -> tuple[str | None, str | None, str | None]:
    """解析 ReAct 输出。

    返回 (thought, action, final_content)：
    - 若为 Final 格式：thought=None, action=None, final_content=内容
    - 若为 Action 格式：thought=思考, action=工具名:JSON, final_content=None
    - 无法解析：三者均为 None
    """
    text = text.strip()

    final_match = re.search(r"(?:^|\n)\s*Final[:：]\s*(.*)$", text, re.DOTALL)
    if final_match:
        return None, None, final_match.group(1).strip()

    action_pattern = r"(?:^|\n)\s*Thought[:：]\s*(.*?)\n\s*Action[:：]\s*([^:\s]+):(.+)$"
    action_match = re.search(action_pattern, text, re.DOTALL)
    if action_match:
        thought = action_match.group(1).strip()
        tool_name = action_match.group(2).strip()
        raw_params = action_match.group(3).strip()
        try:
            params = json.loads(raw_params)
        except json.JSONDecodeError:
            params = {}
        return thought, tool_name, json.dumps({"tool": tool_name, "params": params}, ensure_ascii=False)

    return None, None, None


class ReActAgent:
    """ReAct（Reason + Act）推理循环 Agent。

    循环：
    1. LLM 生成 Thought
    2. 若有 Action，执行工具，返回 Observation
    3. 若无 Action（Final），返回最终内容
    4. 超过 max_iterations 仍未完成时强制输出
    """

    def __init__(
        self,
        llm: LLMProvider,
        tools: list[BaseTool],
        *,
        max_iterations: int = 8,
    ) -> None:
        self._llm = llm
        self._tools = {t.name: t for t in tools}
        self._max_iterations = max_iterations

    def _build_system_prompt(self) -> str:
        tool_descs = []
        for tool in self._tools.values():
            params_str = json.dumps(tool.parameters, ensure_ascii=False, indent=2) if tool.parameters else "{}"
            tool_descs.append(f"- {tool.name}({params_str}): {tool.description}")
        return _REACT_SYSTEM.format(tool_descriptions="\n".join(tool_descs))

    def run(
        self,
        task: str,
        *,
        stream: bool = True,
        fallback_params: dict[str, object] | None = None,
    ) -> Iterator[str]:
        """执行 ReAct 循环。stream=True 时流式返回最终内容。"""
        history: list[str] = []
        iteration = 0

        while iteration < self._max_iterations:
            iteration += 1

            history_block = "\n\n".join(history) if history else "（无历史记录）"
            user_msg = _REACT_USER_TEMPLATE.format(task=task, history=history_block)

            response = self._llm.complete(self._build_system_prompt(), user_msg)
            thought, action_str, final_content = _parse_response(response)

            if final_content is not None and action_str is None:
                # Final 模式，直接返回结果
                yield final_content
                return

            if action_str is not None:
                try:
                    parsed = json.loads(action_str)
                    tool_name = parsed.get("tool", "")
                    params = parsed.get("params", {})
                except json.JSONDecodeError:
                    tool_name = ""
                    params = {}

                tool = self._tools.get(tool_name)
                if tool is None:
                    observation = f"（错误：未知工具 {tool_name}）"
                elif isinstance(tool, GenerateChapterTool):
                    # generate_chapter 工具：直接流式输出内容，不再继续循环
                    chapter_summary = params.get("chapter_summary", "")
                    fixed_title = params.get("fixed_title")
                    for chunk in tool.run_stream(chapter_summary, fixed_title):
                        yield chunk
                    return
                else:
                    try:
                        observation = tool.run(**params)
                    except Exception as e:
                        log.exception("tool %s failed", tool_name)
                        observation = f"（工具执行失败：{e}）"

                history.append(
                    f"Thought: {thought or ''}\nAction: {action_str}\nObservation: {observation}"
                )
            else:
                # 无法解析 LLM 输出时，直接回退到正文生成工具，避免把中间推理暴露给用户
                log.warning("failed to parse react output, fallback to generate_chapter")
                yield from self._fallback_generate(fallback_params)
                return

        # 超过最大迭代次数
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
