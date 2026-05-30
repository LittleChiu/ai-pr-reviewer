"""/api/review 端点:异步任务模式。

POST /api/review        → 提交评审,返回 { task_id, status: "processing" }
GET  /api/review/{id}   → 查询任务状态,完成时返回完整 ReviewReport
GET  /api/review/{id}/wait → SSE 长轮询(保留兼容)

不再使用 SSE 流式推送,改为轮询——避免长连接在网关不稳时断开。
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings
from app.services.cache import get_cache
from app.services.github_client import GitHubClient, GitHubError, PRNotFoundError, RateLimitedError
from app.services.llm_client import LLMError
from app.services.pr_url import PRRef, parse_pr_url
from app.services.review_schema import ReviewReport
from app.services.reviewer_layered import review_pr_layered
from app.services.task_manager import ReviewTask, get_task_manager

router = APIRouter()
logger = logging.getLogger(__name__)


class ReviewRequest(BaseModel):
    url: str
    model: str | None = None
    force_refresh: bool = False


class TaskResponse(BaseModel):
    task_id: str
    status: str
    result: ReviewReport | None = None
    error: str | None = None


def _cache_key(ref: PRRef, head_sha: str, model: str) -> str:
    from app.services.cache import ReviewCache

    return ReviewCache.make_key(ref.owner, ref.repo, ref.number, head_sha, "layered", model)


async def _run_review(task: ReviewTask, ref: PRRef) -> None:
    """后台执行评审,结果写入 task。所有异常都被捕获,标记错误状态。"""
    s = get_settings()
    model = task.model or s.primary_model
    try:
        logger.info(
            "task %s start: %s/%s#%s model=%s", task.task_id, ref.owner, ref.repo, ref.number, model
        )
        async with GitHubClient() as gh:
            logger.info("task %s fetching PR data...", task.task_id)
            bundle = await gh.fetch_pr_bundle(ref)
            logger.info(
                "task %s PR fetched: %d files, +%d/-%d",
                task.task_id,
                bundle.metadata.changed_files,
                bundle.metadata.additions,
                bundle.metadata.deletions,
            )

            if s.cache_enabled and not task.pr_url.endswith("force_refresh"):
                key = _cache_key(ref, bundle.metadata.head_sha, model)
                cached = get_cache().get(key)
                if cached:
                    logger.info("task %s cache hit", task.task_id)
                    task.mark_done(ReviewReport(**cached))
                    return

            logger.info("task %s calling LLM (triage + deep review)...", task.task_id)
            report = await review_pr_layered(bundle, ref=ref, gh=gh, primary_model=model)
            logger.info(
                "task %s LLM done: model=%s elapsed=%s risks=%d sugg=%d",
                task.task_id,
                report.model,
                report.elapsed_ms,
                len(report.risks),
                len(report.suggestions),
            )

            if s.cache_enabled:
                get_cache().set(key, report.model_dump())

            task.mark_done(report)
    except PRNotFoundError as e:
        task.mark_error(f"PR 不存在或非公开仓库: {e}")
    except RateLimitedError as e:
        task.mark_error(f"GitHub API 限流,请稍后重试: {e}")
    except GitHubError as e:
        task.mark_error(f"GitHub 访问失败: {e}")
    except LLMError as e:
        task.mark_error(f"LLM 调用失败: {e}")
    except Exception as e:
        logger.exception("task %s unexpected error", task.task_id)
        task.mark_error(f"未知错误: {e}")


@router.post("/review")
async def submit_review(req: ReviewRequest) -> TaskResponse:
    """提交评审任务,立即返回 task_id。"""
    try:
        ref = parse_pr_url(req.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    mgr = get_task_manager()
    task = await mgr.create(req.url, req.model or get_settings().primary_model)

    # 后台启动,不 await
    asyncio.create_task(_run_review(task, ref))

    logger.info("task %s submitted for %s/%s#%s", task.task_id, ref.owner, ref.repo, ref.number)
    return TaskResponse(task_id=task.task_id, status="processing")


@router.get("/review/{task_id}")
async def get_review(task_id: str) -> TaskResponse:
    """查询任务状态。完成时返回完整评审报告。"""
    task = await get_task_manager().get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return TaskResponse(
        task_id=task.task_id,
        status=task.status,
        result=task.result,
        error=task.error,
    )


@router.get("/review/stats")
async def review_stats() -> dict:
    return get_task_manager().stats()
