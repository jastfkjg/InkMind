"""工作流系统基础类型定义。

定义了工作流的核心概念：
- WorkflowPhaseType: 阶段类型枚举
- WorkflowStatus: 工作流状态枚举
- PhaseResult: 阶段执行结果
- Subagent: 子智能体基类
- Orchestrator: 主智能体基类
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Iterator, Optional

from sqlalchemy.orm import Session

from app.llm.base import LLMProvider
from app.language import Language
from app.models import Novel, User


class WorkflowPhaseType(str, Enum):
    """工作流阶段类型。"""

    NOVEL_SETUP = "novel_setup"
    OUTLINE_PLANNING = "outline_planning"
    CHARACTER_DESIGN = "character_design"
    CHAPTER_SUMMARY = "chapter_summary"
    CHAPTER_CONTENT = "chapter_content"
    POLISH = "polish"


class WorkflowStatus(str, Enum):
    """工作流执行状态。"""

    PENDING = "pending"
    RUNNING = "running"
    WAITING_USER_CONFIRM = "waiting_user_confirm"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class PhaseResult:
    """阶段执行结果。

    包含 Subagent 执行后的结果，需要展示给用户确认或修改。
    """

    phase_type: WorkflowPhaseType
    status: WorkflowStatus
    success: bool = False

    generated_content: dict[str, Any] = field(default_factory=dict)

    suggestions: list[str] = field(default_factory=list)

    error_message: str | None = None

    started_at: datetime | None = None
    completed_at: datetime | None = None

    raw_output: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "phase_type": self.phase_type.value,
            "status": self.status.value,
            "success": self.success,
            "generated_content": self.generated_content,
            "suggestions": self.suggestions,
            "error_message": self.error_message,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


@dataclass
class WorkflowState:
    """工作流状态。

    持久化存储工作流的当前状态，支持中断和恢复。
    """

    workflow_id: str
    novel_id: int
    user_id: int

    current_phase: WorkflowPhaseType
    status: WorkflowStatus

    phase_results: dict[WorkflowPhaseType, PhaseResult] = field(default_factory=dict)

    context: dict[str, Any] = field(default_factory=dict)

    user_modifications: dict[WorkflowPhaseType, dict[str, Any]] = field(default_factory=dict)

    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    target_chapter: int | None = None
    target_chapter_count: int | None = None

    def get_phase_result(self, phase: WorkflowPhaseType) -> PhaseResult | None:
        return self.phase_results.get(phase)

    def save_phase_result(self, result: PhaseResult) -> None:
        self.phase_results[result.phase_type] = result
        self.updated_at = datetime.now()

    def save_user_modification(self, phase: WorkflowPhaseType, modification: dict[str, Any]) -> None:
        if phase not in self.user_modifications:
            self.user_modifications[phase] = {}
        self.user_modifications[phase].update(modification)
        self.updated_at = datetime.now()

    def get_effective_content(self, phase: WorkflowPhaseType) -> dict[str, Any]:
        result = self.get_phase_result(phase)
        if not result:
            return {}

        content = dict(result.generated_content)

        if phase in self.user_modifications:
            content.update(self.user_modifications[phase])

        return content

    def to_dict(self) -> dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "novel_id": self.novel_id,
            "user_id": self.user_id,
            "current_phase": self.current_phase.value,
            "status": self.status.value,
            "phase_results": {k.value: v.to_dict() for k, v in self.phase_results.items()},
            "context": self.context,
            "user_modifications": {k.value: v for k, v in self.user_modifications.items()},
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "target_chapter": self.target_chapter,
            "target_chapter_count": self.target_chapter_count,
        }


class Subagent(ABC):
    """子智能体基类。

    每个 Subagent 专注于完成一个特定阶段的任务。
    Subagent 只负责执行，不做决策，决策由 Orchestrator 负责。
    """

    phase_type: WorkflowPhaseType

    def __init__(
        self,
        db: Session,
        novel: Novel,
        user: User,
        llm: LLMProvider,
        language: Language = "zh",
    ):
        self._db = db
        self._novel = novel
        self._user = user
        self._llm = llm
        self._language = language

    @abstractmethod
    def execute(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> PhaseResult:
        """执行阶段任务。

        Args:
            context: 来自之前阶段的上下文信息
            user_modifications: 用户对之前结果的修改（如果有）

        Returns:
            PhaseResult: 执行结果
        """
        raise NotImplementedError

    def execute_stream(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> Iterator[str]:
        """流式执行阶段任务。

        默认实现是调用 execute 并返回结果，
        子类可以覆盖此方法以提供真正的流式输出。
        """
        result = self.execute(context, user_modifications)
        if result.success:
            yield f"[阶段完成] {self.phase_type.value}\n"
            if result.generated_content:
                for key, value in result.generated_content.items():
                    if isinstance(value, str) and len(value) < 500:
                        yield f"[{key}] {value[:200]}...\n"
                    else:
                        yield f"[{key}] <已生成>\n"
        else:
            yield f"[错误] {result.error_message or '执行失败'}\n"


class Orchestrator(ABC):
    """主智能体基类。

    Orchestrator 负责：
    1. 工作流调度：决定当前处于哪个阶段，下一步进入哪个阶段
    2. 用户交互：展示阶段结果，收集用户修改和确认
    3. 结果汇总：整合各阶段的输出
    4. 状态管理：管理工作流状态的持久化
    """

    def __init__(
        self,
        db: Session,
        novel: Novel,
        user: User,
        llm: LLMProvider,
        language: Language = "zh",
    ):
        self._db = db
        self._novel = novel
        self._user = user
        self._llm = llm
        self._language = language
        self._state: WorkflowState | None = None

    @abstractmethod
    def get_workflow_phases(self) -> list[WorkflowPhaseType]:
        """获取工作流的阶段顺序。

        返回一个列表，定义了工作流的执行顺序。
        例如：[NOVEL_SETUP, OUTLINE_PLANNING, CHARACTER_DESIGN, CHAPTER_SUMMARY, CHAPTER_CONTENT]
        """
        raise NotImplementedError

    @abstractmethod
    def determine_current_phase(self, state: WorkflowState) -> WorkflowPhaseType:
        """根据当前状态确定当前应该执行的阶段。

        这是 Orchestrator 的核心决策逻辑。
        可以根据：
        - 已完成的阶段
        - 用户的修改
        - 工作流的目标
        来决定下一步。
        """
        raise NotImplementedError

    @abstractmethod
    def can_proceed_to_next_phase(
        self,
        current_phase: WorkflowPhaseType,
        phase_result: PhaseResult,
        user_confirm: bool,
        user_modifications: dict[str, Any] | None,
    ) -> tuple[bool, str]:
        """判断是否可以进入下一阶段。

        Args:
            current_phase: 当前阶段
            phase_result: 阶段执行结果
            user_confirm: 用户是否确认
            user_modifications: 用户的修改（如果有）

        Returns:
            (是否可以进入下一阶段, 原因说明)
        """
        raise NotImplementedError

    @abstractmethod
    def get_next_phase(
        self,
        current_phase: WorkflowPhaseType,
        state: WorkflowState,
    ) -> WorkflowPhaseType | None:
        """获取下一阶段。

        返回 None 表示工作流结束。
        """
        raise NotImplementedError

    @abstractmethod
    def create_subagent(self, phase_type: WorkflowPhaseType) -> Subagent:
        """为指定阶段创建 Subagent。"""
        raise NotImplementedError

    @abstractmethod
    def build_context_for_phase(
        self,
        phase_type: WorkflowPhaseType,
        state: WorkflowState,
    ) -> dict[str, Any]:
        """为指定阶段构建上下文。

        从之前阶段的结果中提取必要的信息，
        传递给当前阶段的 Subagent。
        """
        raise NotImplementedError

    @abstractmethod
    def format_result_for_user(
        self,
        phase_type: WorkflowPhaseType,
        phase_result: PhaseResult,
    ) -> dict[str, Any]:
        """格式化阶段结果，准备展示给用户。

        将 Subagent 的原始输出转换为用户友好的格式，
        包括：
        - 生成的内容
        - 可修改的字段
        - AI 的建议
        """
        raise NotImplementedError
