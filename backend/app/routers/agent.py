"""Agent 编排器 API 路由。

使用 ClaudeOrchestrator（claude-agent-sdk）作为唯一编排器：
- 有 ANTHROPIC_API_KEY → 直接连接 Anthropic API
- 有 DEEPSEEK_API_KEY → 连接 DeepSeek Anthropic 端点（https://api.deepseek.com/anthropic）
- 两者都没有 → 返回 503 错误

提供：
- 创建会话
- 发送消息（SSE 流式）
- 回答问题
- 查询任务状态
- 关闭会话
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent.agent_tools import set_task_output_override
from app.agent.claude_orchestrator import (
    ClaudeOrchestrator,
    _active_sessions,
    close_orchestrator_session,
    interrupt_orchestrator_session,
)
from app.agent.task_queue import get_task_queue
from app.config import settings
from app.database import SessionLocal, get_db
from app.deps import CurrentUser
from app.language import Language
from app.llm.providers import resolve_agent_llm_for_user
from app.models import Novel
from app.routers.novels import _get_owned_novel

log = logging.getLogger(__name__)

router = APIRouter(prefix="/novels/{novel_id}/agent", tags=["agent"])

_STREAM_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


class ChatRequest(BaseModel):
    session_id: str = Field(description="会话 ID")
    message: str = Field(description="用户消息")


class AnswerQuestionRequest(BaseModel):
    session_id: str = Field(description="会话 ID")
    question_id: str = Field(description="问题 ID")
    answer: str = Field(default="", description="用户回答")
    selected_option: str | None = Field(default=None, description="选中的选项")


class BatchTaskStatusRequest(BaseModel):
    task_ids: list[str] = Field(description="任务 ID 列表")


class TaskOutputOverrideRequest(BaseModel):
    session_id: str = Field(description="会话 ID")
    task_id: str = Field(description="任务 ID")
    task_type: str = Field(description="任务类型")
    content: str = Field(description="用户编辑后的内容")


def _get_backend(user: object | None = None, db: Session | None = None) -> str:
    agent_config = resolve_agent_llm_for_user(user, db)
    if agent_config["api_key"]:
        return "anthropic"
    if not settings.desktop_mode and settings.deepseek_api_key:
        return "deepseek-anthropic"
    return "none"


def _create_orchestrator(
    db: Session,
    user: CurrentUser,
    novel: Novel,
    language: Language,
) -> ClaudeOrchestrator:
    agent_config = resolve_agent_llm_for_user(user, db)
    if not agent_config["api_key"] and (settings.desktop_mode or not settings.deepseek_api_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置 AI 助手的 API Key，请在 AI 设置中配置 Anthropic API Key",
        )
    return ClaudeOrchestrator(SessionLocal, novel, user, language)


@router.post("/sessions")
def create_session(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> dict[str, Any]:
    novel = _get_owned_novel(db, user.id, novel_id)
    orchestrator = _create_orchestrator(db, user, novel, language)
    session = orchestrator.create_session()

    return {
        "session_id": session.session_id,
        "novel_id": session.novel_id,
        "status": "idle",
        "backend": _get_backend(user, db),
    }


@router.post("/chat")
async def agent_chat(
    novel_id: int,
    body: ChatRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> StreamingResponse:
    novel = _get_owned_novel(db, user.id, novel_id)
    orchestrator = _create_orchestrator(db, user, novel, language)

    session = orchestrator.get_session(body.session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会话不存在: {body.session_id}",
        )

    if session.novel_id != novel.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="会话不属于该小说",
        )

    async def gen():
        try:
            async for event in orchestrator.chat(session, body.message):
                log.debug("SSE send: event_type=%s", event.event_type)
                yield event.encode()
        except Exception as e:
            log.exception("Agent chat error")
            from app.llm.sse_stream import sse_error
            yield sse_error(message=str(e)).encode()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers=_STREAM_HEADERS,
    )


@router.post("/answer-question")
async def answer_question(
    novel_id: int,
    body: AnswerQuestionRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
) -> dict[str, Any]:
    novel = _get_owned_novel(db, user.id, novel_id)
    orchestrator = _create_orchestrator(db, user, novel, language)

    session = orchestrator.get_session(body.session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会话不存在: {body.session_id}",
        )

    return await orchestrator.answer_question(
        session,
        body.question_id,
        body.answer,
        body.selected_option,
    )


@router.get("/sessions/{session_id}")
def get_session(
    novel_id: int,
    session_id: str,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    session = _active_sessions.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会话不存在: {session_id}",
        )
    if session.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="会话不属于该小说",
        )
    return session.to_dict()


@router.delete("/sessions/{session_id}")
async def close_session(
    novel_id: int,
    session_id: str,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    session = _active_sessions.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会话不存在: {session_id}",
        )
    await close_orchestrator_session(session)
    return {"success": True, "session_id": session_id}


@router.post("/sessions/{session_id}/interrupt")
async def interrupt_session(
    novel_id: int,
    session_id: str,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    session = _active_sessions.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会话不存在: {session_id}",
        )
    if session.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="会话不属于该小说",
        )
    await interrupt_orchestrator_session(session)
    return {"success": True, "session_id": session_id}


@router.get("/tasks/{task_id}")
async def get_task_status(
    novel_id: int,
    task_id: str,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    queue = get_task_queue()
    task = await queue.poll(task_id)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务不存在: {task_id}",
        )
    return task.to_dict()


@router.post("/tasks/batch-status")
async def get_batch_task_status(
    novel_id: int,
    body: BatchTaskStatusRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    queue = get_task_queue()
    results = await queue.poll_batch(body.task_ids)
    return {
        "tasks": {
            tid: task.to_dict() if task else None
            for tid, task in results.items()
        }
    }


@router.post("/task-output")
async def update_task_output(
    novel_id: int,
    body: TaskOutputOverrideRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    _get_owned_novel(db, user.id, novel_id)
    session = _active_sessions.get(body.session_id)
    if session is None or session.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会话不存在: {body.session_id}",
        )
    set_task_output_override(body.session_id, body.task_id, body.task_type, body.content)
    return {"success": True}


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(
    novel_id: int,
    task_id: str,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    queue = get_task_queue()
    success = await queue.cancel(task_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="任务不存在或无法取消",
        )
    return {"success": True, "task_id": task_id}
