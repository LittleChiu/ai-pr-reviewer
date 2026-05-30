"""/api/repo 端点:拉取仓库 PR 列表,方便用户浏览后选择评审。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings
from app.services.github_client import GitHubClient, GitHubError

router = APIRouter()


class PRItem(BaseModel):
    number: int
    title: str
    author: str
    additions: int
    deletions: int
    files: int
    state: str
    html_url: str


class PRListResponse(BaseModel):
    owner: str
    repo: str
    pulls: list[PRItem]


@router.get("/repo/{owner}/{repo}/pulls", response_model=PRListResponse)
async def list_pulls(owner: str, repo: str, limit: int = 15) -> PRListResponse:
    """获取仓库最近 open 的 PR 列表。"""
    try:
        async with GitHubClient() as gh:
            url = f"{get_settings().github_api_base}/repos/{owner}/{repo}/pulls?state=open&sort=updated&direction=desc&per_page={limit}"
            resp = await gh.client.get(url)
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=resp.status_code, detail=f"GitHub: {resp.text[:200]}"
                )
            data = resp.json()
            pulls = [
                PRItem(
                    number=p["number"],
                    title=p.get("title", ""),
                    author=(p.get("user") or {}).get("login", "unknown"),
                    additions=p.get("additions", 0),
                    deletions=p.get("deletions", 0),
                    files=p.get("changed_files", 0),
                    state=p.get("state", "open"),
                    html_url=p.get("html_url", ""),
                )
                for p in data
                if isinstance(p, dict)
            ]
            return PRListResponse(owner=owner, repo=repo, pulls=pulls)
    except GitHubError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
