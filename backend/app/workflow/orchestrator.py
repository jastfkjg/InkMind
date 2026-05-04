"""小说创作主 Agent (Orchestrator)。

Orchestrator 负责：
1. 工作流调度：决定当前阶段、下一阶段
2. 用户交互：展示结果、收集确认和修改
3. 状态管理：管理工作流状态的持久化
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.llm.base import LLMProvider
from app.language import Language
from app.models import Character, Chapter, Novel, User
from app.workflow.base import (
    Orchestrator,
    PhaseResult,
    Subagent,
    WorkflowPhaseType,
    WorkflowState,
    WorkflowStatus,
)
from app.workflow.phases import (
    CharacterDesignSubagent,
    ChapterContentSubagent,
    ChapterSummarySubagent,
    NovelSetupSubagent,
    OutlinePlanningSubagent,
    PolishSubagent,
)

log = logging.getLogger(__name__)


class NovelOrchestrator(Orchestrator):
    """小说创作主 Agent。

    负责调度小说创作工作流：
    1. 作品设定完善
    2. 大纲规划
    3. 人物设计
    4. 章节摘要生成
    5. 章节正文生成
    6. 润色修改（可选）
    """

    def __init__(
        self,
        db: Session,
        novel: Novel,
        user: User,
        llm: LLMProvider,
        language: Language = "zh",
    ):
        super().__init__(db, novel, user, llm, language)
        self._state: WorkflowState | None = None

    def get_workflow_phases(self) -> list[WorkflowPhaseType]:
        """获取工作流的默认阶段顺序。

        对于章节生成，完整的流程是：
        1. 章节摘要生成 (CHAPTER_SUMMARY)
        2. 章节正文生成 (CHAPTER_CONTENT)
        3. 润色修改 (POLISH) - 可选

        对于作品规划，完整的流程是：
        1. 作品设定完善 (NOVEL_SETUP)
        2. 大纲规划 (OUTLINE_PLANNING)
        3. 人物设计 (CHARACTER_DESIGN)
        """
        return [
            WorkflowPhaseType.NOVEL_SETUP,
            WorkflowPhaseType.OUTLINE_PLANNING,
            WorkflowPhaseType.CHARACTER_DESIGN,
            WorkflowPhaseType.CHAPTER_SUMMARY,
            WorkflowPhaseType.CHAPTER_CONTENT,
            WorkflowPhaseType.POLISH,
        ]

    def determine_current_phase(self, state: WorkflowState) -> WorkflowPhaseType:
        """根据当前状态确定当前应该执行的阶段。

        决策逻辑：
        1. 如果状态中有明确的 current_phase，使用它
        2. 否则，找到第一个未完成的阶段
        3. 如果所有阶段都完成，返回 POLISH（允许用户继续润色）
        """
        if state.current_phase:
            return state.current_phase

        phases = self.get_workflow_phases()
        for phase in phases:
            result = state.get_phase_result(phase)
            if not result or result.status not in (
                WorkflowStatus.COMPLETED,
                WorkflowStatus.WAITING_USER_CONFIRM,
            ):
                return phase

        return WorkflowPhaseType.POLISH

    def can_proceed_to_next_phase(
        self,
        current_phase: WorkflowPhaseType,
        phase_result: PhaseResult,
        user_confirm: bool,
        user_modifications: dict[str, Any] | None,
    ) -> tuple[bool, str]:
        """判断是否可以进入下一阶段。

        规则：
        1. 阶段执行失败（success=False）：不能进入下一阶段
        2. 需要用户确认（status=WAITING_USER_CONFIRM）：需要 user_confirm=True
        3. 用户有修改：先应用修改，再确认
        """
        if not phase_result.success:
            return False, f"阶段执行失败: {phase_result.error_message}"

        if phase_result.status == WorkflowStatus.WAITING_USER_CONFIRM:
            if not user_confirm:
                return False, "等待用户确认"
            return True, "用户已确认，可以进入下一阶段"

        if phase_result.status == WorkflowStatus.COMPLETED:
            return True, "阶段已完成，可以进入下一阶段"

        return False, f"阶段状态不正确: {phase_result.status}"

    def get_next_phase(
        self,
        current_phase: WorkflowPhaseType,
        state: WorkflowState,
    ) -> WorkflowPhaseType | None:
        """获取下一阶段。

        返回 None 表示工作流结束。

        特殊逻辑：
        - CHAPTER_CONTENT 完成后，默认进入 POLISH（润色是可选的但推荐的）
        - POLISH 完成后，可以循环回到 POLISH（允许多次润色）
        """
        phases = self.get_workflow_phases()

        try:
            current_index = phases.index(current_phase)
        except ValueError:
            current_index = -1

        if current_index + 1 < len(phases):
            next_phase = phases[current_index + 1]
            return next_phase

        if current_phase == WorkflowPhaseType.POLISH:
            return WorkflowPhaseType.POLISH

        return None

    def create_subagent(self, phase_type: WorkflowPhaseType) -> Subagent:
        """为指定阶段创建 Subagent。"""
        subagent_classes: dict[WorkflowPhaseType, type[Subagent]] = {
            WorkflowPhaseType.NOVEL_SETUP: NovelSetupSubagent,
            WorkflowPhaseType.OUTLINE_PLANNING: OutlinePlanningSubagent,
            WorkflowPhaseType.CHARACTER_DESIGN: CharacterDesignSubagent,
            WorkflowPhaseType.CHAPTER_SUMMARY: ChapterSummarySubagent,
            WorkflowPhaseType.CHAPTER_CONTENT: ChapterContentSubagent,
            WorkflowPhaseType.POLISH: PolishSubagent,
        }

        cls = subagent_classes.get(phase_type)
        if not cls:
            raise ValueError(f"未知的阶段类型: {phase_type}")

        return cls(self._db, self._novel, self._user, self._llm, self._language)

    def build_context_for_phase(
        self,
        phase_type: WorkflowPhaseType,
        state: WorkflowState,
    ) -> dict[str, Any]:
        """为指定阶段构建上下文。

        根据阶段类型，从之前阶段的结果中提取必要信息。
        """
        context: dict[str, Any] = {}

        if phase_type == WorkflowPhaseType.NOVEL_SETUP:
            context["novel_title"] = self._novel.title
            context["novel_genre"] = self._novel.genre
            context["existing_background"] = self._novel.background
            context["existing_style"] = self._novel.writing_style

        elif phase_type == WorkflowPhaseType.OUTLINE_PLANNING:
            setup_result = state.get_effective_content(WorkflowPhaseType.NOVEL_SETUP)
            context["novel_setup"] = setup_result

        elif phase_type == WorkflowPhaseType.CHARACTER_DESIGN:
            setup_result = state.get_effective_content(WorkflowPhaseType.NOVEL_SETUP)
            outline_result = state.get_effective_content(WorkflowPhaseType.OUTLINE_PLANNING)
            context["novel_setup"] = setup_result
            context["outline"] = outline_result

        elif phase_type == WorkflowPhaseType.CHAPTER_SUMMARY:
            setup_result = state.get_effective_content(WorkflowPhaseType.NOVEL_SETUP)
            outline_result = state.get_effective_content(WorkflowPhaseType.OUTLINE_PLANNING)
            char_result = state.get_effective_content(WorkflowPhaseType.CHARACTER_DESIGN)
            context["novel_setup"] = setup_result
            context["outline"] = outline_result
            context["characters"] = char_result
            context["target_chapter"] = state.target_chapter
            context["chapter_count"] = state.target_chapter_count or 1

        elif phase_type == WorkflowPhaseType.CHAPTER_CONTENT:
            summary_result = state.get_effective_content(WorkflowPhaseType.CHAPTER_SUMMARY)
            context["chapter_summary"] = summary_result.get("chapter_summary", "")
            context["fixed_title"] = summary_result.get("title")
            context["word_count"] = state.context.get("word_count")

        elif phase_type == WorkflowPhaseType.POLISH:
            content_result = state.get_effective_content(WorkflowPhaseType.CHAPTER_CONTENT)
            context["original_content"] = content_result.get("body", "")
            context["polish_mode"] = state.context.get("polish_mode", "polish")
            context["instructions"] = state.context.get("polish_instructions", "")

        context.update(state.context.get("additional_context", {}))

        return context

    def format_result_for_user(
        self,
        phase_type: WorkflowPhaseType,
        phase_result: PhaseResult,
    ) -> dict[str, Any]:
        """格式化阶段结果，准备展示给用户。

        返回包含以下字段的字典：
        - phase_type: 阶段类型
        - success: 是否成功
        - display_content: 主要展示内容
        - editable_fields: 可修改的字段列表
        - suggestions: AI 建议
        - next_step_suggestion: 下一步建议
        """
        result: dict[str, Any] = {
            "phase_type": phase_type.value,
            "success": phase_result.success,
            "suggestions": phase_result.suggestions,
        }

        if not phase_result.success:
            result["error_message"] = phase_result.error_message
            result["next_step_suggestion"] = "建议检查错误原因后重试"
            return result

        content = phase_result.generated_content

        if phase_type == WorkflowPhaseType.NOVEL_SETUP:
            result["display_content"] = {
                "background": content.get("background", content.get("raw_response", "")),
                "core_settings": content.get("core_settings"),
                "writing_style": content.get("writing_style"),
            }
            result["editable_fields"] = ["background", "core_settings", "writing_style"]
            result["next_step_suggestion"] = "确认作品设定后，可以进入大纲规划阶段"

        elif phase_type == WorkflowPhaseType.OUTLINE_PLANNING:
            result["display_content"] = {
                "chapters": content.get("chapters", []),
                "major_plotlines": content.get("major_plotlines"),
                "outline_text": content.get("outline_text", content.get("raw_response", "")),
            }
            result["editable_fields"] = ["chapters", "major_plotlines", "outline_text"]
            result["next_step_suggestion"] = "确认大纲后，可以进入人物设计阶段"

        elif phase_type == WorkflowPhaseType.CHARACTER_DESIGN:
            result["display_content"] = {
                "characters": content.get("characters", []),
                "characters_text": content.get("characters_text", content.get("raw_response", "")),
            }
            result["editable_fields"] = ["characters"]
            result["next_step_suggestion"] = "确认人物设计后，可以开始生成章节摘要"

        elif phase_type == WorkflowPhaseType.CHAPTER_SUMMARY:
            result["display_content"] = {
                "chapter_summary": content.get("chapter_summary", content.get("raw_response", "")),
                "title": content.get("title"),
                "key_events": content.get("key_events", []),
                "character_arcs": content.get("character_arcs"),
            }
            result["editable_fields"] = ["chapter_summary", "title", "key_events"]
            result["next_step_suggestion"] = "确认章节摘要后，可以进入正文生成阶段"

        elif phase_type == WorkflowPhaseType.CHAPTER_CONTENT:
            result["display_content"] = {
                "title": content.get("title"),
                "body": content.get("body", content.get("raw_response", "")),
            }
            result["editable_fields"] = ["title", "body"]
            result["next_step_suggestion"] = "确认正文后，可以选择润色或直接完成"

        elif phase_type == WorkflowPhaseType.POLISH:
            result["display_content"] = {
                "original_content": content.get("original_content", ""),
                "polished_content": content.get("polished_content", content.get("raw_response", "")),
                "polish_mode": content.get("polish_mode"),
                "instructions": content.get("instructions"),
            }
            result["editable_fields"] = ["polished_content"]
            result["next_step_suggestion"] = "可以继续润色，或完成当前章节"

        return result

    def create_workflow_state(
        self,
        target_chapter: int | None = None,
        target_chapter_count: int | None = None,
        initial_phase: WorkflowPhaseType | None = None,
        context: dict[str, Any] | None = None,
    ) -> WorkflowState:
        """创建新的工作流状态。"""
        workflow_id = str(uuid.uuid4())

        state = WorkflowState(
            workflow_id=workflow_id,
            novel_id=self._novel.id,
            user_id=self._user.id,
            current_phase=initial_phase or WorkflowPhaseType.CHAPTER_SUMMARY,
            status=WorkflowStatus.PENDING,
            target_chapter=target_chapter,
            target_chapter_count=target_chapter_count,
            context=context or {},
        )

        self._state = state
        return state

    def execute_phase(
        self,
        state: WorkflowState,
        user_modifications: dict[str, Any] | None = None,
    ) -> PhaseResult:
        """执行当前阶段。

        Args:
            state: 工作流状态
            user_modifications: 用户对之前结果的修改

        Returns:
            PhaseResult: 阶段执行结果
        """
        current_phase = self.determine_current_phase(state)
        state.current_phase = current_phase
        state.status = WorkflowStatus.RUNNING

        context = self.build_context_for_phase(current_phase, state)

        subagent = self.create_subagent(current_phase)

        result = subagent.execute(context, user_modifications)

        state.save_phase_result(result)

        if result.success:
            state.status = WorkflowStatus.WAITING_USER_CONFIRM
        else:
            state.status = WorkflowStatus.FAILED

        return result

    def execute_phase_stream(
        self,
        state: WorkflowState,
        user_modifications: dict[str, Any] | None = None,
    ) -> Iterator[str]:
        """流式执行当前阶段。

        适用于需要实时展示进度的场景（如章节正文生成）。
        """
        current_phase = self.determine_current_phase(state)
        state.current_phase = current_phase
        state.status = WorkflowStatus.RUNNING

        context = self.build_context_for_phase(current_phase, state)

        subagent = self.create_subagent(current_phase)

        yield from subagent.execute_stream(context, user_modifications)

    def confirm_phase(
        self,
        state: WorkflowState,
        user_modifications: dict[str, Any] | None = None,
    ) -> tuple[bool, str, WorkflowPhaseType | None]:
        """确认当前阶段并决定是否进入下一阶段。

        Args:
            state: 工作流状态
            user_modifications: 用户的修改内容

        Returns:
            (是否成功, 原因说明, 下一阶段类型)
        """
        current_phase = state.current_phase
        phase_result = state.get_phase_result(current_phase)

        if not phase_result:
            return False, "没有找到当前阶段的执行结果", None

        if user_modifications:
            state.save_user_modification(current_phase, user_modifications)

        can_proceed, reason = self.can_proceed_to_next_phase(
            current_phase, phase_result, user_confirm=True, user_modifications=user_modifications
        )

        if not can_proceed:
            return False, reason, None

        phase_result.status = WorkflowStatus.COMPLETED
        state.save_phase_result(phase_result)

        next_phase = self.get_next_phase(current_phase, state)

        if next_phase:
            state.current_phase = next_phase
            state.status = WorkflowStatus.PENDING
        else:
            state.status = WorkflowStatus.COMPLETED

        return True, reason, next_phase

    def apply_user_modifications(
        self,
        state: WorkflowState,
        phase_type: WorkflowPhaseType,
        modifications: dict[str, Any],
    ) -> None:
        """应用用户对某个阶段结果的修改。

        这不会自动进入下一阶段，需要用户明确确认。
        """
        state.save_user_modification(phase_type, modifications)
