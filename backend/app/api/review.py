"""/api/review 端点:输入 PR URL,返回评审报告。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
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

router = APIRouter()


class ReviewRequest(BaseModel):
    url: str
    model: str | None = None


@router.post("/review", response_model=ReviewReport)
async def review(req: ReviewRequest) -> ReviewReport:
    try:
        ref = parse_pr_url(req.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        async with GitHubClient() as gh:
            bundle = await gh.fetch_pr_bundle(ref)
    except PRNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RateLimitedError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except GitHubError as e:
        raise HTTPException(status_code=502, detail=f"GitHub: {e}") from e

    try:
        return await review_pr(bundle, primary_model=req.model)
    except LLMError as e:
        raise HTTPException(status_code=503, detail=f"LLM: {e}") from e
