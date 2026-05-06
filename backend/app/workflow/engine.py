"""工作流引擎。

提供高级 API 来管理和执行工作流：
- 创建/恢复工作流
- 执行阶段
- 处理用户确认
- 管理工作流状态
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.llm.base import LLMProvider
from app.language import Language
from app.models import Novel, User
from app.workflow.base import (
    PhaseResult,
    WorkflowPhaseType,
    WorkflowState,
    WorkflowStatus,
)
from app.workflow.orchestrator import NovelOrchestrator

log = logging.getLogger(__name__)


@dataclass
class WorkflowProgress:
    """工作流进度信息。"""

    workflow_id: str
    novel_id: int
    current_phase: str
    status: str
    completed_phases: list[str]
    pending_phases: list[str]
    current_result: dict[str, Any] | None
    user_modifications: dict[str, Any]
    target_chapter: int | None = None
    target_chapter_count: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class WorkflowEngine:
    """工作流引擎。

    管理工作流的创建、执行和状态管理。
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
        self._orchestrator = NovelOrchestrator(db, novel, user, llm, language)
        self._state: WorkflowState | None = None

    def create_workflow(
        self,
        initial_phase: WorkflowPhaseType = WorkflowPhaseType.CHAPTER_SUMMARY,
        target_chapter: int | None = None,
        target_chapter_count: int | None = None,
        context: dict[str, Any] | None = None,
    ) -> WorkflowState:
        """创建新的工作流。

        Args:
            initial_phase: 初始阶段
            target_chapter: 目标章节号（如果是章节生成模式）
            target_chapter_count: 目标章节数
            context: 额外的上下文信息

        Returns:
            WorkflowState: 工作流状态
        """
        if target_chapter is None:
            from app.models import Chapter
            existing_chapters = self._db.query(Chapter).filter(Chapter.novel_id == self._novel.id).count()
            target_chapter = existing_chapters + 1
        
        state = self._orchestrator.create_workflow_state(
            target_chapter=target_chapter,
            target_chapter_count=target_chapter_count,
            initial_phase=initial_phase,
            context=context or {},
        )
        self._state = state
        return state

    def create_chapter_generation_workflow(
        self,
        chapter_summary: str = "",
        fixed_title: str | None = None,
        word_count: int | None = None,
    ) -> WorkflowState:
        """创建章节生成工作流（快速入口）。

        这是一个便捷方法，用于快速创建从摘要到正文的工作流。

        Args:
            chapter_summary: 章节概要（如果已有）
            fixed_title: 固定标题（如果已有）
            word_count: 目标字数

        Returns:
            WorkflowState: 工作流状态
        """
        context: dict[str, Any] = {}
        if word_count:
            context["word_count"] = word_count

        if chapter_summary:
            context["predefined_summary"] = chapter_summary

        if fixed_title:
            context["predefined_title"] = fixed_title

        initial_phase = (
            WorkflowPhaseType.CHAPTER_CONTENT
            if chapter_summary
            else WorkflowPhaseType.CHAPTER_SUMMARY
        )

        return self.create_workflow(
            initial_phase=initial_phase,
            context=context,
        )

    def create_novel_planning_workflow(self) -> WorkflowState:
        """创建作品规划工作流（快速入口）。

        用于从作品设定开始规划整部小说。

        Returns:
            WorkflowState: 工作流状态
        """
        return self.create_workflow(
            initial_phase=WorkflowPhaseType.NOVEL_SETUP,
        )

    def execute_current_phase(
        self,
        state: WorkflowState | None = None,
        user_modifications: dict[str, Any] | None = None,
    ) -> tuple[PhaseResult, dict[str, Any]]:
        """执行当前阶段。

        Args:
            state: 工作流状态（如果为 None，使用之前创建的状态）
            user_modifications: 用户对之前结果的修改

        Returns:
            (阶段结果, 格式化后的用户展示内容)
        """
        if state is None:
            if self._state is None:
                raise ValueError("没有工作流状态，请先调用 create_workflow()")
            state = self._state

        result = self._orchestrator.execute_phase(state, user_modifications)

        formatted_result = self._orchestrator.format_result_for_user(
            result.phase_type, result
        )

        return result, formatted_result

    def execute_current_phase_stream(
        self,
        state: WorkflowState | None = None,
        user_modifications: dict[str, Any] | None = None,
    ) -> Iterator[str]:
        """流式执行当前阶段。

        适用于章节正文生成等需要实时展示的场景。

        Args:
            state: 工作流状态
            user_modifications: 用户修改

        Yields:
            str: 流式输出内容
        """
        if state is None:
            if self._state is None:
                raise ValueError("没有工作流状态，请先调用 create_workflow()")
            state = self._state

        yield from self._orchestrator.execute_phase_stream(state, user_modifications)

    def confirm_and_proceed(
        self,
        state: WorkflowState | None = None,
        user_modifications: dict[str, Any] | None = None,
    ) -> tuple[bool, str, WorkflowProgress | None]:
        """确认当前阶段并决定是否进入下一阶段。

        Args:
            state: 工作流状态
            user_modifications: 用户对当前阶段结果的修改

        Returns:
            (是否成功, 原因说明, 下一阶段进度信息)
        """
        if state is None:
            if self._state is None:
                raise ValueError("没有工作流状态，请先调用 create_workflow()")
            state = self._state

        success, reason, next_phase = self._orchestrator.confirm_phase(
            state, user_modifications
        )

        if not success:
            return False, reason, None

        progress = None
        if next_phase:
            progress = self.get_progress(state)

        return True, reason, progress

    def apply_modifications(
        self,
        phase_type: WorkflowPhaseType,
        modifications: dict[str, Any],
        state: WorkflowState | None = None,
    ) -> None:
        """应用用户对某个阶段结果的修改。

        这不会自动进入下一阶段，只是保存修改。

        Args:
            phase_type: 阶段类型
            modifications: 修改内容
            state: 工作流状态
        """
        if state is None:
            if self._state is None:
                raise ValueError("没有工作流状态，请先调用 create_workflow()")
            state = self._state

        self._orchestrator.apply_user_modifications(state, phase_type, modifications)

    def get_progress(self, state: WorkflowState | None = None) -> WorkflowProgress:
        """获取工作流进度。

        Args:
            state: 工作流状态

        Returns:
            WorkflowProgress: 进度信息
        """
        if state is None:
            if self._state is None:
                raise ValueError("没有工作流状态，请先调用 create_workflow()")
            state = self._state

        all_phases = self._orchestrator.get_workflow_phases()
        current_phase = state.current_phase

        completed_phases: list[str] = []
        pending_phases: list[str] = []

        current_found = False
        for phase in all_phases:
            result = state.get_phase_result(phase)

            if phase == current_phase:
                current_found = True
            elif current_found:
                pending_phases.append(phase.value)
            else:
                if result and result.status == WorkflowStatus.COMPLETED:
                    completed_phases.append(phase.value)
                else:
                    pending_phases.append(phase.value)

        current_result = None
        current_phase_result = state.get_phase_result(current_phase)
        if current_phase_result:
            current_result = self._orchestrator.format_result_for_user(
                current_phase, current_phase_result
            )

        user_modifications: dict[str, Any] = {}
        for phase, mods in state.user_modifications.items():
            user_modifications[phase.value] = mods

        return WorkflowProgress(
            workflow_id=state.workflow_id,
            novel_id=state.novel_id,
            current_phase=current_phase.value,
            status=state.status.value,
            completed_phases=completed_phases,
            pending_phases=pending_phases,
            current_result=current_result,
            user_modifications=user_modifications,
            target_chapter=state.target_chapter,
            target_chapter_count=state.target_chapter_count,
        )

    def save_state(self, state: WorkflowState | None = None) -> dict[str, Any]:
        """保存工作流状态到可序列化格式。

        用于持久化存储。

        Args:
            state: 工作流状态

        Returns:
            可序列化的状态字典
        """
        if state is None:
            if self._state is None:
                raise ValueError("没有工作流状态，请先调用 create_workflow()")
            state = self._state

        return state.to_dict()

    def load_state(self, state_dict: dict[str, Any]) -> WorkflowState:
        """从字典恢复工作流状态。

        Args:
            state_dict: 状态字典

        Returns:
            WorkflowState: 恢复的工作流状态
        """
        phase_results: dict[WorkflowPhaseType, PhaseResult] = {}
        for phase_str, result_dict in state_dict.get("phase_results", {}).items():
            try:
                phase_type = WorkflowPhaseType(phase_str)
                phase_results[phase_type] = PhaseResult(
                    phase_type=phase_type,
                    status=WorkflowStatus(result_dict.get("status", "failed")),
                    success=result_dict.get("success", False),
                    generated_content=result_dict.get("generated_content", {}),
                    suggestions=result_dict.get("suggestions", []),
                    error_message=result_dict.get("error_message"),
                )
            except (ValueError, KeyError):
                log.warning("无法解析阶段结果: %s", phase_str)

        user_modifications: dict[WorkflowPhaseType, dict[str, Any]] = {}
        for phase_str, mods in state_dict.get("user_modifications", {}).items():
            try:
                phase_type = WorkflowPhaseType(phase_str)
                user_modifications[phase_type] = mods
            except ValueError:
                log.warning("无法解析用户修改阶段: %s", phase_str)

        state = WorkflowState(
            workflow_id=state_dict.get("workflow_id", ""),
            novel_id=state_dict.get("novel_id", 0),
            user_id=state_dict.get("user_id", 0),
            current_phase=WorkflowPhaseType(
                state_dict.get("current_phase", "chapter_summary")
            ),
            status=WorkflowStatus(state_dict.get("status", "pending")),
            phase_results=phase_results,
            context=state_dict.get("context", {}),
            user_modifications=user_modifications,
            target_chapter=state_dict.get("target_chapter"),
            target_chapter_count=state_dict.get("target_chapter_count"),
        )

        self._state = state
        return state
