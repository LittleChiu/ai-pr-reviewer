"""/api/review 端点:输入 PR URL,返回评审报告。

支持两种 strategy:
- "layered" (默认):三层 prompt(粗筛 → 深审 → 聚合),质量更高,token 消耗略大
- "single":一轮 prompt + 完整 diff,响应快,适合小 PR

另外提供 /api/review/stream:同样是 layered,但用 SSE 流式返回每阶段事件,
让前端可以先看到 summary,再看到 risks 一条条到达。
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.github_client import (
    GitHubClient,
    GitHubError,
    PRNotFoundError,
    RateLimitedError,
)
from app.services.llm_client import LLMError
from app.services.pr_url import parse_pr_url
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


@router.post("/review", response_model=ReviewReport)
async def review(req: ReviewRequest) -> ReviewReport:
    try:
        ref = parse_pr_url(req.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        async with GitHubClient() as gh:
            bundle = await gh.fetch_pr_bundle(ref)
            try:
                if req.strategy == "single":
                    return await review_pr(bundle, primary_model=req.model)
                return await review_pr_layered(
                    bundle,
                    ref=ref,
                    gh=gh,
                    primary_model=req.model,
                )
            except LLMError as e:
                raise HTTPException(status_code=503, detail=f"LLM: {e}") from e
    except PRNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RateLimitedError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except GitHubError as e:
        raise HTTPException(status_code=502, detail=f"GitHub: {e}") from e


def _sse(event: ReviewEvent) -> str:
    """打包成 SSE 帧:event: <type>\\ndata: <json>\\n\\n"""
    return f"event: {event.type}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"


@router.post("/review/stream")
async def review_stream(req: ReviewRequest) -> StreamingResponse:
    """SSE 流式评审(始终 layered)。每阶段一个事件:
    started → triage → file_started × N → file_done × N → done
    """
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
                async for ev in review_pr_layered_stream(
                    bundle, ref=ref, gh=gh, primary_model=req.model
                ):
                    yield _sse(ev)
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
