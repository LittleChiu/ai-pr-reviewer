"""/api/pr 端点:输入 PR URL,返回结构化的 PR 数据。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.github_client import GitHubClient
from app.services.github_schema import PRBundle
from app.services.pr_url import parse_pr_url

router = APIRouter()


class FetchPRRequest(BaseModel):
    url: str
    include_diff: bool = True
    max_files: int = 300


@router.post("/pr/fetch", response_model=PRBundle)
async def fetch_pr(req: FetchPRRequest) -> PRBundle:
    try:
        ref = parse_pr_url(req.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    async with GitHubClient() as gh:
        return await gh.fetch_pr_bundle(
            ref,
            include_diff=req.include_diff,
            max_files=req.max_files,
        )


@router.get("/pr/parse")
async def parse_url(url: str = Query(..., description="GitHub PR URL")) -> dict:
    try:
        ref = parse_pr_url(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"owner": ref.owner, "repo": ref.repo, "number": ref.number}
