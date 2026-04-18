"""Agent 模块：ReAct 推理循环 + Memory 管理 + Tools。"""

from __future__ import annotations

from app.agent.base import BaseTool
from app.agent.memory import NovelMemory
from app.agent.react import ReActAgent
from app.agent.tools import (
    GenerateChapterTool,
    GetCharacterProfilesTool,
    GetNovelContextTool,
    GetPreviousChaptersTool,
    build_generation_prompt,
)

__all__ = [
    "BaseTool",
    "NovelMemory",
    "ReActAgent",
    "GetPreviousChaptersTool",
    "GetCharacterProfilesTool",
    "GetNovelContextTool",
    "GenerateChapterTool",
    "build_generation_prompt",
]
