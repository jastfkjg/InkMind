"""Retry a saved request, preserving completed batch items and current model credentials."""
import json

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import BackgroundTask, Chapter
from app.services.task_manager import _run_batch_chapters_task, _run_single_chapter_task, task_manager


def retry_background_task(db: Session, task: BackgroundTask) -> BackgroundTask:
    if not task.retryable:
        raise HTTPException(409, "此任务无法直接重试，请返回作品重新提交。")
    if task_manager.is_running(task.id):
        raise HTTPException(409, "上一次任务仍在结束中，请稍后重试。")
    try:
        request = json.loads(task.request_json or "{}")
        if not isinstance(request, dict):
            raise ValueError("Invalid request")
        if task.task_type == "single_chapter":
            keys = ("chapter_id", "title", "summary", "fixed_title", "word_count", "agent_mode", "max_iterations")
            worker = _run_single_chapter_task
            chapter_id = request.get("chapter_id")
            if chapter_id and not db.query(Chapter).filter_by(id=chapter_id, novel_id=task.novel_id).first():
                raise HTTPException(409, "目标章节已不存在，请返回作品重新生成。")
        elif task.task_type == "batch_chapters":
            keys = ("after_chapter_id", "total_summary", "chapter_count", "word_count", "agent_mode", "max_iterations")
            worker = _run_batch_chapters_task
        else:
            raise ValueError("Unsupported task type")
        args = [request[key] for key in keys]
    except (ValueError, KeyError, TypeError) as error:
        raise HTTPException(409, "任务参数不完整，请返回作品重新提交。") from error

    # Claim in the database too, so two tabs/processes cannot schedule the same retry.
    claimed = db.execute(update(BackgroundTask).where(
        BackgroundTask.id == task.id, BackgroundTask.status.in_(("failed", "cancelled")),
    ).values(status="pending", error_message=None, progress_message=None, started_at=None, completed_at=None))
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "任务状态已变化，请刷新后重试。")
    for item in task.task_items:
        if item.status != "completed":
            item.status = "pending"
            item.error_message = None
            item.started_at = None
            item.completed_at = None
    db.commit()
    try:
        task_manager.submit_task(task.id, worker, task.id, task.user_id, task.novel_id, *args)
    except Exception as error:
        task.status = "failed"
        task.error_message = "任务暂时无法启动，请重试。"
        db.commit()
        raise HTTPException(503, task.error_message) from error
    db.refresh(task)
    return task
