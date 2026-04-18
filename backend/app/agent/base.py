"""Agent 工具基类。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseTool(ABC):
    """所有 Agent 工具的抽象基类。"""

    name: str = ""
    description: str = ""
    parameters: dict[str, Any] = {}

    @abstractmethod
    def run(self, **kwargs) -> str:
        """执行工具逻辑，返回结果字符串。"""
        raise NotImplementedError
