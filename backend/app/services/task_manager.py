"""异步评审任务管理:提交后即刻返回 task_id,前端轮询查结果。"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.services.review_schema import ReviewReport

logger = logging.getLogger(__name__)


@dataclass
class ReviewTask:
    task_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "processing"  # processing | done | error
    result: ReviewReport | None = None
    error: str | None = None
    pr_url: str = ""
    model: str = ""
    created_at: float = 0.0

    def mark_done(self, report: ReviewReport) -> None:
        self.result = report
        self.status = "done"
        logger.info(
            "task %s done: model=%s elapsed=%s", self.task_id, report.model, report.elapsed_ms
        )

    def mark_error(self, msg: str) -> None:
        self.error = msg
        self.status = "error"
        logger.error("task %s error: %s", self.task_id, msg)


class TaskManager:
    def __init__(self, max_tasks: int = 200) -> None:
        self._tasks: dict[str, ReviewTask] = {}
        self._max_tasks = max_tasks
        self._lock = asyncio.Lock()

    async def create(self, pr_url: str, model: str) -> ReviewTask:
        task = ReviewTask(pr_url=pr_url, model=model)
        task.created_at = asyncio.get_event_loop().time()
        async with self._lock:
            self._tasks[task.task_id] = task
            if len(self._tasks) > self._max_tasks:
                oldest = sorted(self._tasks.values(), key=lambda t: t.created_at)
                for t in oldest[: len(self._tasks) - self._max_tasks]:
                    del self._tasks[t.task_id]
        logger.info("task %s created for %s", task.task_id, pr_url)
        return task

    async def get(self, task_id: str) -> ReviewTask | None:
        return self._tasks.get(task_id)

    def stats(self) -> dict[str, Any]:
        return {
            "total": len(self._tasks),
            "processing": sum(1 for t in self._tasks.values() if t.status == "processing"),
            "done": sum(1 for t in self._tasks.values() if t.status == "done"),
            "error": sum(1 for t in self._tasks.values() if t.status == "error"),
        }


_task_manager: TaskManager | None = None


def get_task_manager() -> TaskManager:
    global _task_manager
    if _task_manager is None:
        _task_manager = TaskManager()
    return _task_manager
