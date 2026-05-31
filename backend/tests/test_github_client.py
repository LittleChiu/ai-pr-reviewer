"""GitHub 客户端测试:用 respx mock httpx,避免依赖网络与 rate limit。"""

from __future__ import annotations

import httpx
import pytest
import respx
from httpx import Response

from app.services.github_client import GitHubClient, GitHubError, PRNotFoundError
from app.services.pr_url import PRRef

API_BASE = "https://api.github.com"
RAW_BASE = "https://raw.githubusercontent.com"


@pytest.fixture
def ref() -> PRRef:
    return PRRef(owner="LittleChiu", repo="ai-pr-reviewer", number=42)


def _pull_url(ref: PRRef) -> str:
    return f"{API_BASE}/repos/{ref.slug}/pulls/{ref.number}"


def _pull_files_url(ref: PRRef) -> str:
    return f"{_pull_url(ref)}/files"


def _raw_file_url(ref: PRRef, path: str, sha: str) -> str:
    return f"{RAW_BASE}/{ref.slug}/{sha}/{path}"


_PR_JSON = {
    "title": "feat: hello",
    "body": "first PR",
    "state": "open",
    "draft": False,
    "user": {
        "login": "alice",
        "avatar_url": "https://example.com/a.png",
        "html_url": "https://github.com/alice",
    },
    "base": {"ref": "main", "sha": "b" * 40},
    "head": {"ref": "feat/hello", "sha": "h" * 40},
    "created_at": "2026-05-29T00:00:00Z",
    "updated_at": "2026-05-29T01:00:00Z",
    "additions": 10,
    "deletions": 2,
    "changed_files": 3,
    "commits": 1,
    "html_url": "https://github.com/LittleChiu/ai-pr-reviewer/pull/42",
}

_FILES_JSON = [
    {
        "filename": "README.md",
        "status": "modified",
        "additions": 5,
        "deletions": 1,
        "changes": 6,
        "patch": "@@ -1 +1,5 @@\n-old\n+new\n",
        "raw_url": "https://raw.githubusercontent.com/...",
        "blob_url": "https://github.com/...",
        "sha": "abc",
    }
]


@pytest.mark.asyncio
@respx.mock
async def test_fetch_pr_metadata(ref: PRRef) -> None:
    respx.get(_pull_url(ref)).mock(return_value=Response(200, json=_PR_JSON))

    async with GitHubClient(token=None) as gh:
        meta = await gh.fetch_pr_metadata(ref)

    assert meta.title == "feat: hello"
    assert meta.author.login == "alice"
    assert meta.additions == 10
    assert meta.head_ref == "feat/hello"


@pytest.mark.asyncio
@respx.mock
async def test_fetch_pr_files(ref: PRRef) -> None:
    respx.get(_pull_files_url(ref)).mock(return_value=Response(200, json=_FILES_JSON))

    async with GitHubClient() as gh:
        files = await gh.fetch_pr_files(ref)

    assert len(files) == 1
    assert files[0].filename == "README.md"
    assert files[0].patch is not None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_pr_404(ref: PRRef) -> None:
    respx.get(_pull_url(ref)).mock(return_value=Response(404, json={"message": "Not Found"}))

    async with GitHubClient() as gh:
        with pytest.raises(PRNotFoundError):
            await gh.fetch_pr_metadata(ref)


@pytest.mark.asyncio
@respx.mock
async def test_fetch_pr_connect_error_becomes_github_error(ref: PRRef) -> None:
    respx.get(_pull_url(ref)).mock(side_effect=httpx.ConnectError("connect failed"))

    async with GitHubClient() as gh:
        with pytest.raises(GitHubError, match="无法连接 GitHub API"):
            await gh.fetch_pr_metadata(ref)


@pytest.mark.asyncio
@respx.mock
async def test_fetch_file_at_ref_returns_text(ref: PRRef) -> None:
    raw_url = _raw_file_url(ref, path="README.md", sha="abc")
    respx.get(raw_url).mock(return_value=Response(200, text="# hello"))

    async with GitHubClient() as gh:
        text = await gh.fetch_file_at_ref(ref, path="README.md", sha="abc")

    assert text == "# hello"


@pytest.mark.asyncio
@respx.mock
async def test_fetch_file_at_ref_returns_none_on_http_error(ref: PRRef) -> None:
    raw_url = _raw_file_url(ref, path="README.md", sha="abc")
    respx.get(raw_url).mock(side_effect=httpx.ConnectError("raw failed"))

    async with GitHubClient() as gh:
        text = await gh.fetch_file_at_ref(ref, path="README.md", sha="abc")

    assert text is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_pr_bundle(ref: PRRef) -> None:
    respx.get(_pull_url(ref)).mock(
        side_effect=[
            Response(200, json=_PR_JSON),
            Response(200, text="diff --git a/README.md b/README.md\n@@ -1 +1 @@\n-x\n+y\n"),
        ]
    )
    respx.get(_pull_files_url(ref)).mock(return_value=Response(200, json=_FILES_JSON))

    async with GitHubClient() as gh:
        bundle = await gh.fetch_pr_bundle(ref)

    assert bundle.metadata.number == 42
    assert len(bundle.files) == 1
    assert bundle.raw_diff.startswith("diff --git")
