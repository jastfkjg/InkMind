"""小说创作工作流 API 路由。

提供基于 Agent 工作流的小说创作接口：
- 创建工作流
- 执行阶段
- 确认阶段结果
- 获取进度
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.language import Language
from app.llm.llm_errors import LLMRequestError
from app.llm.ndjson_stream import ndjson_line
from app.llm.providers import list_available_providers, resolve_llm_for_user
from app.models import Chapter, Novel
from app.observability.otel_ai import ai_span
from app.routers.novels import _get_owned_novel
from app.workflow.base import WorkflowPhaseType, WorkflowState
from app.workflow.engine import WorkflowEngine

router = APIRouter(prefix="/novels/{novel_id}/workflow", tags=["workflow"])

log = logging.getLogger(__name__)

_STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class CreateWorkflowRequest(BaseModel):
    """创建工作流的请求。"""

    initial_phase: str = Field(
        default="chapter_summary",
        description="初始阶段: novel_setup, outline_planning, character_design, chapter_summary, chapter_content",
    )
    target_chapter: Optional[int] = Field(default=None, description="目标章节号")
    target_chapter_count: Optional[int] = Field(default=None, description="目标章节数")
    chapter_summary: Optional[str] = Field(default=None, description="预定义的章节概要")
    fixed_title: Optional[str] = Field(default=None, description="固定标题")
    word_count: Optional[int] = Field(default=None, description="目标字数")
    additional_context: Optional[dict[str, Any]] = Field(default=None, description="额外的上下文")


class ExecutePhaseRequest(BaseModel):
    """执行阶段的请求。"""

    user_modifications: Optional[dict[str, Any]] = Field(
        default=None, description="用户对之前结果的修改"
    )


class ConfirmPhaseRequest(BaseModel):
    """确认阶段的请求。"""

    user_modifications: Optional[dict[str, Any]] = Field(
        default=None, description="用户对当前阶段结果的修改"
    )


class ApplyModificationsRequest(BaseModel):
    """应用修改的请求。"""

    phase_type: str = Field(description="阶段类型")
    modifications: dict[str, Any] = Field(description="修改内容")


class WorkflowStateResponse(BaseModel):
    """工作流状态响应。"""

    workflow_id: str
    novel_id: int
    current_phase: str
    status: str
    progress: dict[str, Any] | None


_active_workflows: dict[str, WorkflowState] = {}


def _phase_type_from_str(phase_str: str) -> WorkflowPhaseType:
    """从字符串转换为阶段类型。"""
    try:
        return WorkflowPhaseType(phase_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无效的阶段类型: {phase_str}",
        )


def _get_workflow_engine(
    db: Session,
    user: CurrentUser,
    novel: Novel,
    language: Language,
) -> WorkflowEngine:
    """获取工作流引擎。"""
    try:
        llm = resolve_llm_for_user(user, None, db=db, action="工作流执行")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )

    return WorkflowEngine(db, novel, user, llm, language)


def _save_workflow_state(workflow_id: str, state: WorkflowState) -> None:
    """保存工作流状态（内存中，临时方案）。

    TODO: 未来应该保存到数据库。
    """
    _active_workflows[workflow_id] = state


def _load_workflow_state(workflow_id: str) -> WorkflowState:
    """加载工作流状态。"""
    if workflow_id not in _active_workflows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"工作流不存在: {workflow_id}",
        )
    return _active_workflows[workflow_id]


@router.post("/create")
def create_workflow(
    novel_id: int,
    body: CreateWorkflowRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> dict[str, Any]:
    """创建新的工作流。

    根据需要创建作品规划工作流或章节生成工作流。

    Args:
        novel_id: 小说 ID
        body: 创建请求
            - initial_phase: 初始阶段
            - target_chapter: 目标章节号
            - chapter_summary: 预定义的章节概要（如果有，直接进入正文生成阶段）
            - fixed_title: 固定标题
            - word_count: 目标字数

    Returns:
        工作流状态信息
    """
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )

    novel = _get_owned_novel(db, user.id, novel_id)
    engine = _get_workflow_engine(db, user, novel, language)

    initial_phase = _phase_type_from_str(body.initial_phase)

    context: dict[str, Any] = {}
    if body.additional_context:
        context.update(body.additional_context)
    if body.word_count:
        context["word_count"] = body.word_count
    if body.chapter_summary:
        context["predefined_summary"] = body.chapter_summary
    if body.fixed_title:
        context["predefined_title"] = body.fixed_title

    if body.chapter_summary and initial_phase == WorkflowPhaseType.CHAPTER_SUMMARY:
        initial_phase = WorkflowPhaseType.CHAPTER_CONTENT

    state = engine.create_workflow(
        initial_phase=initial_phase,
        target_chapter=body.target_chapter,
        target_chapter_count=body.target_chapter_count,
        context=context,
    )

    _save_workflow_state(state.workflow_id, state)

    progress = engine.get_progress(state)

    return {
        "workflow_id": state.workflow_id,
        "novel_id": state.novel_id,
        "current_phase": state.current_phase.value,
        "status": state.status.value,
        "progress": progress.to_dict(),
    }


@router.get("/{workflow_id}/progress")
def get_workflow_progress(
    novel_id: int,
    workflow_id: str,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> dict[str, Any]:
    """获取工作流进度。

    Args:
        novel_id: 小说 ID
        workflow_id: 工作流 ID

    Returns:
        工作流进度信息
    """
    novel = _get_owned_novel(db, user.id, novel_id)
    state = _load_workflow_state(workflow_id)

    if state.novel_id != novel.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="工作流不属于该小说",
        )

    engine = _get_workflow_engine(db, user, novel, language)
    progress = engine.get_progress(state)

    return progress.to_dict()


@router.post("/{workflow_id}/execute")
def execute_phase(
    novel_id: int,
    workflow_id: str,
    body: ExecutePhaseRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> dict[str, Any]:
    """执行当前阶段（非流式）。

    Args:
        novel_id: 小说 ID
        workflow_id: 工作流 ID
        body: 执行请求
            - user_modifications: 用户对之前结果的修改

    Returns:
        阶段执行结果
    """
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )

    novel = _get_owned_novel(db, user.id, novel_id)
    state = _load_workflow_state(workflow_id)

    if state.novel_id != novel.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="工作流不属于该小说",
        )

    engine = _get_workflow_engine(db, user, novel, language)

    try:
        with ai_span("workflow.execute_phase", novel_id=novel_id, workflow_id=workflow_id):
            result, formatted_result = engine.execute_current_phase(
                state, body.user_modifications
            )

        _save_workflow_state(workflow_id, state)
        progress = engine.get_progress(state)

        return {
            "workflow_id": workflow_id,
            "phase_type": result.phase_type.value,
            "success": result.success,
            "status": result.status.value,
            "result": formatted_result,
            "progress": progress.to_dict(),
            "error_message": result.error_message,
        }

    except LLMRequestError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=e.message,
        )
    except Exception as e:
        log.exception("执行阶段失败")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.post("/{workflow_id}/execute-stream")
def execute_phase_stream(
    novel_id: int,
    workflow_id: str,
    body: ExecutePhaseRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> StreamingResponse:
    """执行当前阶段（流式）。

    适用于章节正文生成等需要实时展示的场景。

    Args:
        novel_id: 小说 ID
        workflow_id: 工作流 ID
        body: 执行请求

    Returns:
        流式输出，NDJSON 格式
    """
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )

    novel = _get_owned_novel(db, user.id, novel_id)
    state = _load_workflow_state(workflow_id)

    if state.novel_id != novel.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="工作流不属于该小说",
        )

    engine = _get_workflow_engine(db, user, novel, language)

    def gen():
        try:
            with ai_span("workflow.execute_phase_stream", novel_id=novel_id, workflow_id=workflow_id):
                for chunk in engine.execute_current_phase_stream(state, body.user_modifications):
                    yield ndjson_line({"t": chunk})

            _save_workflow_state(workflow_id, state)

            progress = engine.get_progress(state)
            yield ndjson_line(
                {
                    "done": True,
                    "progress": progress.to_dict(),
                }
            )

        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            log.exception("流式执行阶段失败")
            yield ndjson_line({"error": str(e)})

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers=_STREAM_HEADERS,
    )


@router.post("/{workflow_id}/confirm")
def confirm_phase(
    novel_id: int,
    workflow_id: str,
    body: ConfirmPhaseRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> dict[str, Any]:
    """确认当前阶段并决定是否进入下一阶段。

    Args:
        novel_id: 小说 ID
        workflow_id: 工作流 ID
        body: 确认请求
            - user_modifications: 用户对当前阶段结果的修改

    Returns:
        确认结果，包括是否可以进入下一阶段
    """
    novel = _get_owned_novel(db, user.id, novel_id)
    state = _load_workflow_state(workflow_id)

    if state.novel_id != novel.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="工作流不属于该小说",
        )

    engine = _get_workflow_engine(db, user, novel, language)

    success, reason, next_progress = engine.confirm_and_proceed(
        state, body.user_modifications
    )

    _save_workflow_state(workflow_id, state)

    progress = engine.get_progress(state)

    return {
        "workflow_id": workflow_id,
        "success": success,
        "reason": reason,
        "current_phase": state.current_phase.value,
        "status": state.status.value,
        "next_phase": (
            next_progress.current_phase
            if next_progress and success
            else None
        ),
        "progress": progress.to_dict(),
    }


@router.post("/{workflow_id}/apply-modifications")
def apply_modifications(
    novel_id: int,
    workflow_id: str,
    body: ApplyModificationsRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> dict[str, Any]:
    """应用用户对某个阶段结果的修改。

    这不会自动进入下一阶段，只是保存修改供用户确认。

    Args:
        novel_id: 小说 ID
        workflow_id: 工作流 ID
        body: 修改请求
            - phase_type: 阶段类型
            - modifications: 修改内容

    Returns:
        操作结果
    """
    novel = _get_owned_novel(db, user.id, novel_id)
    state = _load_workflow_state(workflow_id)

    if state.novel_id != novel.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="工作流不属于该小说",
        )

    phase_type = _phase_type_from_str(body.phase_type)

    engine = _get_workflow_engine(db, user, novel, language)
    engine.apply_modifications(phase_type, body.modifications, state)

    _save_workflow_state(workflow_id, state)
    progress = engine.get_progress(state)

    return {
        "workflow_id": workflow_id,
        "success": True,
        "message": f"已应用对 {phase_type.value} 阶段的修改",
        "progress": progress.to_dict(),
    }


@router.post("/{workflow_id}/save-chapter")
def save_chapter_to_db(
    novel_id: int,
    workflow_id: str,
    body: ConfirmPhaseRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> dict[str, Any]:
    """将工作流生成的章节保存到数据库。

    当用户确认章节正文后，可以调用此接口将结果保存为正式的章节。

    Args:
        novel_id: 小说 ID
        workflow_id: 工作流 ID
        body: 包含用户修改（如果有）

    Returns:
        保存的章节信息
    """
    novel = _get_owned_novel(db, user.id, novel_id)
    state = _load_workflow_state(workflow_id)

    if state.novel_id != novel.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="工作流不属于该小说",
        )

    if body.user_modifications:
        state.save_user_modification(WorkflowPhaseType.CHAPTER_CONTENT, body.user_modifications)

    summary_content = state.get_effective_content(WorkflowPhaseType.CHAPTER_SUMMARY)
    content_content = state.get_effective_content(WorkflowPhaseType.CHAPTER_CONTENT)

    if not content_content.get("body"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="没有生成的章节正文",
        )

    title = content_content.get("title") or summary_content.get("title")
    if not title:
        existing_count = (
            db.query(Chapter).filter(Chapter.novel_id == novel.id).count()
        )
        title = f"第{existing_count + 1}章"

    max_sort_order_result = db.query(func.max(Chapter.sort_order)).filter(Chapter.novel_id == novel.id).scalar()
    max_sort_order = (max_sort_order_result if max_sort_order_result is not None else -1) + 1

    chapter = Chapter(
        novel_id=novel.id,
        title=title,
        content=content_content.get("body"),
        summary=summary_content.get("chapter_summary"),
        sort_order=max_sort_order,
    )

    db.add(chapter)
    db.commit()
    db.refresh(chapter)

    return {
        "success": True,
        "chapter": {
            "id": chapter.id,
            "title": chapter.title,
            "summary": chapter.summary,
            "content": chapter.content,
            "word_count": len(chapter.content) if chapter.content else 0,
        },
        "message": "章节已保存到数据库",
    }


@router.get("/{workflow_id}/state")
def get_workflow_state(
    novel_id: int,
    workflow_id: str,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """获取工作流的完整状态（用于调试和持久化）。

    Args:
        novel_id: 小说 ID
        workflow_id: 工作流 ID

    Returns:
        完整的工作流状态字典
    """
    novel = _get_owned_novel(db, user.id, novel_id)
    state = _load_workflow_state(workflow_id)

    if state.novel_id != novel.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="工作流不属于该小说",
        )

    return state.to_dict()
