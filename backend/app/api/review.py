"""/api/review 端点:输入 PR URL,返回评审报告。

支持两种 strategy:
- "layered" (默认):三层 prompt(粗筛 → 深审 → 聚合),质量更高,token 消耗略大
- "single":一轮 prompt + 完整 diff,响应快,适合小 PR

另外提供 /api/review/stream:同样是 layered,但用 SSE 流式返回每阶段事件,
让前端可以先看到 summary,再看到 risks 一条条到达。

缓存:
- 非流式 /api/review 命中缓存(repo + head_sha + strategy + model)直接返回
- /api/review/stream 命中时直接 yield 一个完整的 cached 事件 + done,不重跑 LLM
- ?force_refresh=true 跳过缓存

错误处理:业务异常(PRNotFoundError / RateLimitedError / GitHubError / LLMError)
由全局异常处理器(core/errors.py)统一转换为标准错误响应,无需在路由层 try/except。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import get_settings
from app.services.cache import ReviewCache, get_cache
from app.services.github_client import (
    GitHubClient,
    GitHubError,
    PRNotFoundError,
    RateLimitedError,
)
from app.services.llm_client import LLMError
from app.services.pr_url import PRRef, parse_pr_url
from app.services.review_schema import ReviewReport
from app.services.reviewer import review_pr
from app.services.reviewer_layered import (
    ReviewEvent,
    review_pr_layered,
    review_pr_layered_stream,
)

router = APIRouter()
logger = logging.getLogger(__name__)

Strategy = Literal["layered", "single"]
HEARTBEAT_INTERVAL_S = 10.0


class ReviewRequest(BaseModel):
    url: str
    model: str | None = None
    strategy: Strategy = "layered"
    force_refresh: bool = False


def _cache_key(ref: PRRef, head_sha: str, strategy: str, model: str) -> str:
    return ReviewCache.make_key(ref.owner, ref.repo, ref.number, head_sha, strategy, model)


@router.post("/review", response_model=ReviewReport)
async def review(req: ReviewRequest) -> ReviewReport:
    """对指定 PR 出评审报告。错误响应见全局异常处理器。"""
    s = get_settings()
    try:
        ref = parse_pr_url(req.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    async with GitHubClient() as gh:
        bundle = await gh.fetch_pr_bundle(ref)
        model = req.model or s.primary_model
        key = _cache_key(ref, bundle.metadata.head_sha, req.strategy, model)

        if s.cache_enabled and not req.force_refresh:
            cached = get_cache().get(key)
            if cached:
                logger.info("cache hit: %s", key)
                return ReviewReport(**cached)

        if req.strategy == "single":
            report = await review_pr(bundle, primary_model=model)
        else:
            report = await review_pr_layered(bundle, ref=ref, gh=gh, primary_model=model)

        if s.cache_enabled:
            get_cache().set(key, report.model_dump())
        return report


def _now_ms() -> int:
    return int(time.time() * 1000)


def _sse(event: ReviewEvent) -> str:
    """打包成 SSE 帧:event: <type>\ndata: <json>\n\n"""
    return f"event: {event.type}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"


def _heartbeat(stage: str) -> ReviewEvent:
    return ReviewEvent("heartbeat", {"stage": stage, "ts": _now_ms()})


def _accepted(ref: PRRef) -> ReviewEvent:
    return ReviewEvent("accepted", {"pr": str(ref), "stage": "fetch", "ts": _now_ms()})


def _stage_after_event(ev: ReviewEvent, current: str) -> str:
    if ev.type == "accepted":
        return "fetch"
    if ev.type == "started":
        return "triage"
    if ev.type in {"triage", "file_started", "file_done"}:
        return "reviewing"
    if ev.type in {"cached", "done"}:
        return "done"
    if ev.type == "error":
        return "error"
    return current


@router.post("/review/stream")
async def review_stream(req: ReviewRequest, request: Request) -> StreamingResponse:
    """SSE 流式评审(始终 layered)。每阶段一个事件:
    accepted → started → triage → file_started × N → file_done × N → done

    缓存命中时:accepted → started → cached → done
    长静默期间会定期发 heartbeat,避免连接被中间层当成空闲断开。
    """
    s = get_settings()
    try:
        ref = parse_pr_url(req.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    async def gen() -> AsyncIterator[str]:
        stage = "fetch"
        queue: asyncio.Queue[ReviewEvent] = asyncio.Queue()
        worker_done = asyncio.Event()

        async def emit(ev: ReviewEvent) -> None:
            nonlocal stage
            stage = _stage_after_event(ev, stage)
            await queue.put(ev)

        async def worker() -> None:
            final_payload: dict | None = None
            try:
                await emit(_accepted(ref))
                async with GitHubClient() as gh:
                    try:
                        bundle = await gh.fetch_pr_bundle(ref)
                    except PRNotFoundError as e:
                        await emit(ReviewEvent("error", {"stage": "fetch", "message": str(e)}))
                        return
                    except (RateLimitedError, GitHubError) as e:
                        await emit(ReviewEvent("error", {"stage": "fetch", "message": str(e)}))
                        return

                    model = req.model or s.primary_model
                    key = _cache_key(ref, bundle.metadata.head_sha, "layered", model)

                    if s.cache_enabled and not req.force_refresh:
                        cached = get_cache().get(key)
                        if cached:
                            await emit(
                                ReviewEvent(
                                    "started",
                                    {
                                        "pr": f"{ref.owner}/{ref.repo}#{ref.number}",
                                        "title": bundle.metadata.title,
                                        "files": bundle.metadata.changed_files,
                                        "additions": bundle.metadata.additions,
                                        "deletions": bundle.metadata.deletions,
                                        "model": model,
                                        "from_cache": True,
                                    },
                                )
                            )
                            await emit(ReviewEvent("cached", cached))
                            await emit(ReviewEvent("done", cached))
                            return

                    async for ev in review_pr_layered_stream(
                        bundle, ref=ref, gh=gh, primary_model=model
                    ):
                        if ev.type == "done":
                            final_payload = ev.data
                        await emit(ev)

                    if s.cache_enabled and final_payload:
                        get_cache().set(key, final_payload)
            except LLMError as e:
                await emit(ReviewEvent("error", {"stage": "llm", "message": str(e)}))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception("review stream failed")
                await emit(ReviewEvent("error", {"stage": "unknown", "message": str(e)}))
            finally:
                worker_done.set()

        worker_task = asyncio.create_task(worker())
        try:
            while True:
                if await request.is_disconnected():
                    worker_task.cancel()
                    break
                if worker_done.is_set() and queue.empty():
                    break
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL_S)
                except TimeoutError:
                    yield _sse(_heartbeat(stage))
                    continue
                yield _sse(ev)
        finally:
            if not worker_task.done():
                worker_task.cancel()
            await asyncio.gather(worker_task, return_exceptions=True)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/review/cache/stats")
async def cache_stats() -> dict:
    return get_cache().stats()


@router.delete("/review/cache")
async def cache_clear() -> dict:
    n = get_cache().clear()
    return {"cleared": n}
