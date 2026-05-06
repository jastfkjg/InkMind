"""小说创作 Agent 工作流系统。

基于 ArcReel 的智能体架构，实现：
- 主 Agent (Orchestrator)：负责工作流调度、用户交互、结果汇总
- Subagent：专注于特定创作阶段的任务执行
- 阶段确认机制：每个阶段完成后需用户确认
- 用户可修改性：支持修改生成的结果

工作流阶段：
1. NOVEL_SETUP - 作品设定完善
2. OUTLINE_PLANNING - 大纲规划
3. CHARACTER_DESIGN - 人物设计
4. CHAPTER_SUMMARY - 章节摘要生成
5. CHAPTER_CONTENT - 章节正文生成
6. POLISH - 润色修改
"""

from app.workflow.base import (
    WorkflowPhaseType,
    WorkflowStatus,
    WorkflowState,
    PhaseResult,
    Subagent,
    Orchestrator,
)
from app.workflow.phases import (
    NovelSetupSubagent,
    OutlinePlanningSubagent,
    CharacterDesignSubagent,
    ChapterSummarySubagent,
    ChapterContentSubagent,
    PolishSubagent,
)
from app.workflow.engine import WorkflowEngine
from app.workflow.orchestrator import NovelOrchestrator

__all__ = [
    "WorkflowPhaseType",
    "WorkflowStatus",
    "WorkflowState",
    "PhaseResult",
    "Subagent",
    "Orchestrator",
    "NovelSetupSubagent",
    "OutlinePlanningSubagent",
    "CharacterDesignSubagent",
    "ChapterSummarySubagent",
    "ChapterContentSubagent",
    "PolishSubagent",
    "WorkflowEngine",
    "NovelOrchestrator",
]
