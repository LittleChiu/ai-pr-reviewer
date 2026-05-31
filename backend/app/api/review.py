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

import json
import logging
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, HTTPException
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


def _sse(event: ReviewEvent) -> str:
    """打包成 SSE 帧:event: <type>\\ndata: <json>\\n\\n"""
    return f"event: {event.type}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"


@router.post("/review/stream")
async def review_stream(req: ReviewRequest) -> StreamingResponse:
    """SSE 流式评审(始终 layered)。每阶段一个事件:
    started → triage → file_started × N → file_done × N → done

    缓存命中时:started → cached → done(瞬时返回完整报告)
    """
    s = get_settings()
    try:
        ref = parse_pr_url(req.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    async def gen() -> AsyncIterator[str]:
        try:
            async with GitHubClient() as gh:
                try:
                    bundle = await gh.fetch_pr_bundle(ref)
                except PRNotFoundError as e:
                    yield _sse(ReviewEvent("error", {"stage": "fetch", "message": str(e)}))
                    return
                except (RateLimitedError, GitHubError) as e:
                    yield _sse(ReviewEvent("error", {"stage": "fetch", "message": str(e)}))
                    return

                model = req.model or s.primary_model
                key = _cache_key(ref, bundle.metadata.head_sha, "layered", model)

                if s.cache_enabled and not req.force_refresh:
                    cached = get_cache().get(key)
                    if cached:
                        yield _sse(
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
                        yield _sse(ReviewEvent("cached", cached))
                        yield _sse(ReviewEvent("done", cached))
                        return

                final_payload: dict | None = None
                async for ev in review_pr_layered_stream(
                    bundle, ref=ref, gh=gh, primary_model=model
                ):
                    if ev.type == "done":
                        final_payload = ev.data
                    yield _sse(ev)

                if s.cache_enabled and final_payload:
                    get_cache().set(key, final_payload)
        except LLMError as e:
            yield _sse(ReviewEvent("error", {"stage": "llm", "message": str(e)}))
        except Exception as e:
            logger.exception("review stream failed")
            yield _sse(ReviewEvent("error", {"stage": "unknown", "message": str(e)}))

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
