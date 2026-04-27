import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, Future
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Any

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.llm.metered_llm import LLMUsageAccumulator
from app.llm.providers import resolve_llm_for_user
from app.models import (
    BackgroundTask,
    Chapter,
    Novel,
    TaskItem,
    User,
)
from app.schemas.background_task import BatchPlanChapter
from app.services.chapter_gen import (
    plan_batch_chapters,
    run_direct_chapter_generation,
    run_flexible_chapter_generation,
    run_react_chapter_generation,
)

logger = logging.getLogger(__name__)


@dataclass
class RunningTask:
    task_id: int
    future: Future[Any]
    cancelled: bool = False


class TaskManager:
    _instance: "TaskManager | None" = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._executor = ThreadPoolExecutor(max_workers=4)
        self._running_tasks: dict[int, RunningTask] = {}
        self._running_lock = threading.Lock()

    def submit_task(self, task_id: int, task_func: Callable, *args, **kwargs) -> None:
        """提交任务到线程池执行"""
        future = self._executor.submit(task_func, *args, **kwargs)
        
        with self._running_lock:
            self._running_tasks[task_id] = RunningTask(
                task_id=task_id,
                future=future,
            )

    def cancel_task(self, task_id: int) -> bool:
        """取消正在运行的任务"""
        with self._running_lock:
            if task_id not in self._running_tasks:
                return False
            running_task = self._running_tasks[task_id]
            running_task.cancelled = True
            running_task.future.cancel()
            return True

    def is_running(self, task_id: int) -> bool:
        """检查任务是否正在运行"""
        with self._running_lock:
            if task_id not in self._running_tasks:
                return False
            running_task = self._running_tasks[task_id]
            return running_task.cancelled or not running_task.future.done()

    def remove_task(self, task_id: int) -> None:
        """移除已完成的任务"""
        with self._running_lock:
            if task_id in self._running_tasks:
                del self._running_tasks[task_id]


task_manager = TaskManager()


def _update_task_status(
    db: Session,
    task: BackgroundTask,
    status: str,
    progress_message: str | None = None,
    current_index: int | None = None,
    completed_count: int | None = None,
    error_message: str | None = None,
) -> None:
    """更新任务状态"""
    task.status = status
    if progress_message is not None:
        task.progress_message = progress_message
    if current_index is not None:
        task.current_index = current_index
    if completed_count is not None:
        task.completed_count = completed_count
    if error_message is not None:
        task.error_message = error_message
    if status == "running" and task.started_at is None:
        task.started_at = datetime.now(timezone.utc)
    if status in ("completed", "failed", "cancelled"):
        task.completed_at = datetime.now(timezone.utc)
    db.commit()


def _update_task_item_status(
    db: Session,
    task_item: TaskItem,
    status: str,
    generated_title: str | None = None,
    generated_content: str | None = None,
    chapter_id: int | None = None,
    error_message: str | None = None,
) -> None:
    """更新任务项状态"""
    task_item.status = status
    if generated_title is not None:
        task_item.generated_title = generated_title
    if generated_content is not None:
        task_item.generated_content = generated_content
    if chapter_id is not None:
        task_item.chapter_id = chapter_id
    if error_message is not None:
        task_item.error_message = error_message
    if status == "running" and task_item.started_at is None:
        task_item.started_at = datetime.now(timezone.utc)
    if status in ("completed", "failed", "cancelled"):
        task_item.completed_at = datetime.now(timezone.utc)
    db.commit()


def _run_single_chapter_task(
    task_id: int,
    user_id: int,
    novel_id: int,
    chapter_id: int | None,
    title: str | None,
    summary: str,
    fixed_title: str | None,
    word_count: int | None,
    agent_mode: str,
    max_iterations: int,
) -> None:
    """执行单章节生成任务"""
    db = SessionLocal()
    try:
        task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
        if not task:
            logger.error(f"Task {task_id} not found")
            return

        user = db.query(User).filter(User.id == user_id).first()
        novel = db.query(Novel).filter(Novel.id == novel_id).first()
        
        if not user or not novel:
            _update_task_status(db, task, "failed", error_message="用户或作品不存在")
            return

        target_chapter: Chapter | None = None
        if chapter_id:
            target_chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()

        _update_task_status(db, task, "running", progress_message="准备生成章节...")

        accumulator = LLMUsageAccumulator(db, user.id)
        llm = resolve_llm_for_user(
            user,
            None,
            db=db,
            action="后台章节生成",
            accumulator=accumulator,
        )

        try:
            _update_task_status(db, task, "running", progress_message="正在生成章节内容...")
            
            chapter_out: Chapter | None = None
            
            if agent_mode == "react":
                for result in run_react_chapter_generation(
                    db=db,
                    novel=novel,
                    chapter_summary=summary,
                    target_chapter=target_chapter,
                    llm=llm,
                    fixed_title=fixed_title,
                    max_iterations=max_iterations,
                    word_count=word_count,
                ):
                    if isinstance(result, Chapter):
                        chapter_out = result
            elif agent_mode == "direct":
                result = run_direct_chapter_generation(
                    db=db,
                    novel=novel,
                    chapter_summary=summary,
                    target_chapter=target_chapter,
                    llm=llm,
                    fixed_title=fixed_title,
                    word_count=word_count,
                    save_to_db=True,
                )
                if len(result) == 3:
                    chapter_out = result[2]
            else:
                for result in run_flexible_chapter_generation(
                    db=db,
                    novel=novel,
                    chapter_summary=summary,
                    target_chapter=target_chapter,
                    llm=llm,
                    fixed_title=fixed_title,
                    max_iterations=max_iterations,
                    word_count=word_count,
                ):
                    if isinstance(result, Chapter):
                        chapter_out = result

            accumulator.flush()

            if chapter_out:
                task.total_tokens = accumulator.total_tokens
                _update_task_status(
                    db, task, "completed", 
                    progress_message=f"章节「{chapter_out.title}」生成完成",
                    completed_count=1
                )
                
                if task.task_items:
                    task_item = task.task_items[0]
                    _update_task_item_status(
                        db, task_item, "completed",
                        generated_title=chapter_out.title,
                        generated_content=chapter_out.content,
                        chapter_id=chapter_out.id,
                    )
            else:
                _update_task_status(db, task, "failed", error_message="章节生成失败，未返回章节对象")

        except Exception as e:
            logger.exception(f"Task {task_id} execution error")
            _update_task_status(db, task, "failed", error_message=str(e))

    finally:
        db.close()
        task_manager.remove_task(task_id)


def _run_batch_chapters_task(
    task_id: int,
    user_id: int,
    novel_id: int,
    after_chapter_id: int | None,
    total_summary: str,
    chapter_count: int,
    word_count: int | None,
    agent_mode: str,
    max_iterations: int,
) -> None:
    """执行批量章节生成任务"""
    db = SessionLocal()
    try:
        task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
        if not task:
            logger.error(f"Task {task_id} not found")
            return

        user = db.query(User).filter(User.id == user_id).first()
        novel = db.query(Novel).filter(Novel.id == novel_id).first()
        
        if not user or not novel:
            _update_task_status(db, task, "failed", error_message="用户或作品不存在")
            return

        after_chapter: Chapter | None = None
        if after_chapter_id:
            after_chapter = db.query(Chapter).filter(Chapter.id == after_chapter_id).first()

        _update_task_status(db, task, "running", progress_message="正在规划批量章节...")

        accumulator = LLMUsageAccumulator(db, user.id)
        llm = resolve_llm_for_user(
            user,
            None,
            db=db,
            action="后台批量章节规划",
            accumulator=accumulator,
        )

        try:
            plan = plan_batch_chapters(
                db=db,
                novel=novel,
                llm=llm,
                total_summary=total_summary,
                chapter_count=chapter_count,
                after_chapter=after_chapter,
            )
            
            task.batch_plan_json = json.dumps(plan, ensure_ascii=False)
            db.commit()

            _update_task_status(db, task, "running", progress_message="章节规划完成，开始逐章生成...")

            completed_count = 0
            for idx, chapter_plan in enumerate(plan):
                if task_manager.is_running(task_id):
                    with task_manager._running_lock:
                        if task_manager._running_tasks.get(task_id) and task_manager._running_tasks[task_id].cancelled:
                            _update_task_status(
                                db, task, "cancelled",
                                progress_message=f"任务已取消，已完成 {completed_count} 章",
                                current_index=idx,
                                completed_count=completed_count,
                            )
                            return

                _update_task_status(
                    db, task, "running",
                    progress_message=f"正在生成第 {idx + 1}/{chapter_count} 章：{chapter_plan.get('title', '未知')}",
                    current_index=idx,
                    completed_count=completed_count,
                )

                task_item = next((ti for ti in task.task_items if ti.sort_order == idx), None)
                if task_item:
                    _update_task_item_status(db, task_item, "running")

                try:
                    chapter_llm = resolve_llm_for_user(
                        user,
                        None,
                        db=db,
                        action=f"后台批量章节生成-{idx+1}",
                        accumulator=accumulator,
                    )

                    chapter_out: Chapter | None = None
                    chapter_title = chapter_plan.get("title")
                    chapter_summary = chapter_plan.get("summary", "")

                    if agent_mode == "react":
                        for result in run_react_chapter_generation(
                            db=db,
                            novel=novel,
                            chapter_summary=chapter_summary,
                            target_chapter=None,
                            llm=chapter_llm,
                            fixed_title=chapter_title,
                            max_iterations=max_iterations,
                            word_count=word_count,
                        ):
                            if isinstance(result, Chapter):
                                chapter_out = result
                    elif agent_mode == "direct":
                        result = run_direct_chapter_generation(
                            db=db,
                            novel=novel,
                            chapter_summary=chapter_summary,
                            target_chapter=None,
                            llm=chapter_llm,
                            fixed_title=chapter_title,
                            word_count=word_count,
                            save_to_db=True,
                        )
                        if len(result) == 3:
                            chapter_out = result[2]
                    else:
                        for result in run_flexible_chapter_generation(
                            db=db,
                            novel=novel,
                            chapter_summary=chapter_summary,
                            target_chapter=None,
                            llm=chapter_llm,
                            fixed_title=chapter_title,
                            max_iterations=max_iterations,
                            word_count=word_count,
                        ):
                            if isinstance(result, Chapter):
                                chapter_out = result

                    if chapter_out:
                        completed_count += 1
                        if task_item:
                            _update_task_item_status(
                                db, task_item, "completed",
                                generated_title=chapter_out.title,
                                generated_content=chapter_out.content,
                                chapter_id=chapter_out.id,
                            )
                    else:
                        if task_item:
                            _update_task_item_status(
                                db, task_item, "failed",
                                error_message="章节生成失败"
                            )

                except Exception as e:
                    logger.exception(f"Error generating chapter {idx + 1}")
                    if task_item:
                        _update_task_item_status(
                            db, task_item, "failed",
                            error_message=str(e)
                        )

            accumulator.flush()
            task.total_tokens = accumulator.total_tokens

            _update_task_status(
                db, task, "completed",
                progress_message=f"批量生成完成！成功生成 {completed_count}/{chapter_count} 章",
                current_index=chapter_count,
                completed_count=completed_count,
            )

        except Exception as e:
            logger.exception(f"Batch task {task_id} execution error")
            _update_task_status(db, task, "failed", error_message=str(e))

    finally:
        db.close()
        task_manager.remove_task(task_id)


def start_single_chapter_task(
    user_id: int,
    novel_id: int,
    chapter_id: int | None,
    title: str | None,
    summary: str,
    fixed_title: str | None,
    word_count: int | None,
    agent_mode: str = "flexible",
    max_iterations: int = 10,
) -> BackgroundTask:
    """启动单章节后台生成任务"""
    db = SessionLocal()
    try:
        task = BackgroundTask(
            user_id=user_id,
            novel_id=novel_id,
            task_type="single_chapter",
            status="pending",
            title=title,
            summary=summary,
            batch_count=1,
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        task_item = TaskItem(
            background_task_id=task.id,
            sort_order=0,
            status="pending",
            title=title,
            summary=summary,
        )
        db.add(task_item)
        db.commit()
        db.refresh(task)

        task_manager.submit_task(
            task.id,
            _run_single_chapter_task,
            task.id,
            user_id,
            novel_id,
            chapter_id,
            title,
            summary,
            fixed_title,
            word_count,
            agent_mode,
            max_iterations,
        )

        return task

    finally:
        db.close()


def start_batch_chapters_task(
    user_id: int,
    novel_id: int,
    after_chapter_id: int | None,
    total_summary: str,
    chapter_count: int,
    word_count: int | None,
    agent_mode: str = "flexible",
    max_iterations: int = 10,
) -> BackgroundTask:
    """启动批量章节后台生成任务"""
    db = SessionLocal()
    try:
        task = BackgroundTask(
            user_id=user_id,
            novel_id=novel_id,
            task_type="batch_chapters",
            status="pending",
            summary=total_summary,
            batch_count=chapter_count,
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        for i in range(chapter_count):
            task_item = TaskItem(
                background_task_id=task.id,
                sort_order=i,
                status="pending",
                summary=f"第{i+1}章（待规划）",
            )
            db.add(task_item)
        db.commit()
        db.refresh(task)

        task_manager.submit_task(
            task.id,
            _run_batch_chapters_task,
            task.id,
            user_id,
            novel_id,
            after_chapter_id,
            total_summary,
            chapter_count,
            word_count,
            agent_mode,
            max_iterations,
        )

        return task

    finally:
        db.close()
