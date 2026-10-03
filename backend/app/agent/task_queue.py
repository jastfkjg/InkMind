"""基于 asyncio 的任务队列系统。

核心设计：
- Agent 不直接等 LLM 返回，而是将生成任务写入队列，立即返回任务 ID
- 后台 Worker 消费队列，调用 SubAgent 执行内容生成
- 前端通过轮询或 SSE 获取任务进度和结果

与现有 TaskManager 的关系：
- TaskManager 管理的是 BackgroundTask（用户可见的后台任务）
- AgentTaskQueue 管理的是 AgentOrchestrator 内部的子任务（Claude 调度 -> 子智能体执行）
- 两者可以嵌套：AgentTaskQueue 的任务结果可以写入 BackgroundTask
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Awaitable

log = logging.getLogger(__name__)


class AgentTaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class AgentTask:
    task_id: str
    task_type: str
    params: dict[str, Any]
    status: AgentTaskStatus = AgentTaskStatus.PENDING
    result: dict[str, Any] | None = None
    error: str | None = None
    progress: float = 0.0
    progress_message: str | None = None
    stream_events: list[dict[str, Any]] = field(default_factory=list)
    stream_subscribers: list[asyncio.Queue[dict[str, Any]]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    completed_at: float | None = None
    caller_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_type": self.task_type,
            "params": self.params,
            "status": self.status.value,
            "result": self.result,
            "error": self.error,
            "progress": self.progress,
            "progress_message": self.progress_message,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }

    async def publish_stream_event(self, event: dict[str, Any]) -> None:
        payload = {
            "task_id": self.task_id,
            "task_type": self.task_type,
            "seq": len(self.stream_events),
            "ts": time.time(),
            **event,
        }
        self.stream_events.append(payload)
        for subscriber in list(self.stream_subscribers):
            await subscriber.put(payload)

    async def close_stream(self) -> None:
        await self.publish_stream_event({"type": "done"})
        for subscriber in list(self.stream_subscribers):
            await subscriber.put({"type": "closed", "task_id": self.task_id})


TaskHandler = Callable[[AgentTask], Awaitable[dict[str, Any]]]


class AgentTaskQueue:
    """异步任务队列。

    使用 asyncio.Queue 解耦任务提交和执行：
    - submit() 将任务写入队列，立即返回任务 ID
    - 后台 Worker 从队列取出任务并执行
    - poll() 查询任务状态
    """

    def __init__(self, max_workers: int = 4, max_queue_size: int = 100) -> None:
        self._queue: asyncio.Queue[AgentTask] = asyncio.Queue(maxsize=max_queue_size)
        self._tasks: dict[str, AgentTask] = {}
        self._handlers: dict[str, TaskHandler] = {}
        self._submission_subscribers: dict[str, list[asyncio.Queue[AgentTask]]] = {}
        self._workers: list[asyncio.Task] = []
        self._max_workers = max_workers
        self._running = False
        self._lock = asyncio.Lock()

    def active_count(self) -> int:
        return sum(task.status in (AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING) for task in list(self._tasks.values()))

    def register_handler(self, task_type: str, handler: TaskHandler) -> None:
        self._handlers[task_type] = handler

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        for i in range(self._max_workers):
            worker = asyncio.create_task(self._worker_loop(i))
            self._workers.append(worker)
        log.info("AgentTaskQueue started with %d workers", self._max_workers)

    async def stop(self) -> None:
        self._running = False
        for worker in self._workers:
            worker.cancel()
        self._workers.clear()
        log.info("AgentTaskQueue stopped")

    async def submit(
        self,
        task_type: str,
        params: dict[str, Any],
        *,
        caller_id: str | None = None,
    ) -> str:
        if task_type not in self._handlers:
            raise ValueError(f"未注册的任务类型: {task_type}")

        task_id = f"atask_{uuid.uuid4().hex[:12]}"
        task = AgentTask(
            task_id=task_id,
            task_type=task_type,
            params=params,
            caller_id=caller_id,
        )

        async with self._lock:
            self._tasks[task_id] = task
            if caller_id:
                for subscriber in list(self._submission_subscribers.get(caller_id, [])):
                    await subscriber.put(task)

        await self._queue.put(task)
        log.info("Task submitted: %s (type=%s)", task_id, task_type)
        return task_id

    async def poll(self, task_id: str) -> AgentTask | None:
        async with self._lock:
            return self._tasks.get(task_id)

    async def poll_batch(self, task_ids: list[str]) -> dict[str, AgentTask | None]:
        async with self._lock:
            return {tid: self._tasks.get(tid) for tid in task_ids}

    async def subscribe_stream(self, task_id: str) -> asyncio.Queue[dict[str, Any]] | None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
            task.stream_subscribers.append(queue)
            for event in task.stream_events:
                await queue.put(event)
            if task.status in (AgentTaskStatus.COMPLETED, AgentTaskStatus.FAILED, AgentTaskStatus.CANCELLED):
                await queue.put({"type": "closed", "task_id": task.task_id})
            return queue

    async def unsubscribe_stream(self, task_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return
            try:
                task.stream_subscribers.remove(queue)
            except ValueError:
                pass

    async def subscribe_submissions(self, caller_id: str) -> asyncio.Queue[AgentTask]:
        queue: asyncio.Queue[AgentTask] = asyncio.Queue()
        async with self._lock:
            self._submission_subscribers.setdefault(caller_id, []).append(queue)
        return queue

    async def unsubscribe_submissions(self, caller_id: str, queue: asyncio.Queue[AgentTask]) -> None:
        async with self._lock:
            subscribers = self._submission_subscribers.get(caller_id)
            if not subscribers:
                return
            try:
                subscribers.remove(queue)
            except ValueError:
                pass
            if not subscribers:
                self._submission_subscribers.pop(caller_id, None)

    async def cancel(self, task_id: str) -> bool:
        async with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return False
            if task.status in (AgentTaskStatus.COMPLETED, AgentTaskStatus.FAILED, AgentTaskStatus.CANCELLED):
                return False
            task.status = AgentTaskStatus.CANCELLED
            task.completed_at = time.time()
            await task.publish_stream_event({"type": "error", "error": "任务已中断"})
            await task.close_stream()
            return True

    async def cleanup(self, max_age_seconds: float = 3600) -> int:
        now = time.time()
        to_remove: list[str] = []
        async with self._lock:
            for task_id, task in self._tasks.items():
                if task.status in (AgentTaskStatus.COMPLETED, AgentTaskStatus.FAILED, AgentTaskStatus.CANCELLED):
                    if task.completed_at and (now - task.completed_at) > max_age_seconds:
                        to_remove.append(task_id)
            for task_id in to_remove:
                del self._tasks[task_id]
        if to_remove:
            log.info("Cleaned up %d expired tasks", len(to_remove))
        return len(to_remove)

    async def _worker_loop(self, worker_id: int) -> None:
        log.debug("Worker %d started", worker_id)
        while self._running:
            try:
                task = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            if task.status == AgentTaskStatus.CANCELLED:
                continue

            handler = self._handlers.get(task.task_type)
            if handler is None:
                task.status = AgentTaskStatus.FAILED
                task.error = f"未注册的任务类型: {task.task_type}"
                task.completed_at = time.time()
                continue

            task.status = AgentTaskStatus.RUNNING
            task.started_at = time.time()
            log.info("Worker %d executing task %s (type=%s)", worker_id, task.task_id, task.task_type)

            try:
                result = await handler(task)
                task.status = AgentTaskStatus.COMPLETED
                task.result = result
                task.progress = 1.0
                task.completed_at = time.time()
                await task.close_stream()
                log.info("Task %s completed", task.task_id)
            except asyncio.CancelledError:
                task.status = AgentTaskStatus.CANCELLED
                task.completed_at = time.time()
                await task.close_stream()
                break
            except Exception as e:
                log.exception("Task %s failed", task.task_id)
                task.status = AgentTaskStatus.FAILED
                task.error = str(e)
                task.completed_at = time.time()
                await task.publish_stream_event({"type": "error", "error": str(e)})
                await task.close_stream()


_global_queue: AgentTaskQueue | None = None


def get_task_queue() -> AgentTaskQueue:
    global _global_queue
    if _global_queue is None:
        _global_queue = AgentTaskQueue()
    return _global_queue
