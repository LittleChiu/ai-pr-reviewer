"""GitHub REST API 客户端:拉取 PR 元信息、文件列表、diff、文件全文。

设计原则:
- httpx 异步,共用一个 client(连接池);
- 统一鉴权(可选 token,匿名时受 60/h 限流);
- 区分 4xx/5xx,把 404/403 翻译成业务异常;
- 仓库文件全文用 raw.githubusercontent.com 拿,避免 base64 解码 + API 限流。
"""

from __future__ import annotations

import httpx

from app.core.config import get_settings
from app.services.github_schema import PRAuthor, PRBundle, PRFile, PRMetadata
from app.services.pr_url import PRRef


def _github_api() -> str:
    return get_settings().github_api_base


def _raw_host() -> str:
    return get_settings().github_raw_base


def _pull_url(ref: PRRef) -> str:
    return f"{_github_api()}/repos/{ref.slug}/pulls/{ref.number}"


def _pull_files_url(ref: PRRef, *, per_page: int, page: int) -> str:
    return f"{_pull_url(ref)}/files?per_page={per_page}&page={page}"


def _raw_file_url(ref: PRRef, path: str, sha: str) -> str:
    return f"{_raw_host()}/{ref.slug}/{sha}/{path}"


class GitHubError(Exception):
    pass


class PRNotFoundError(GitHubError):
    pass


class RateLimitedError(GitHubError):
    pass


class GitHubClient:
    def __init__(self, token: str | None = None, timeout: float = 30.0) -> None:
        self._token = token or get_settings().github_token or None
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> GitHubClient:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ai-pr-reviewer",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        self._client = httpx.AsyncClient(
            timeout=self._timeout,
            headers=headers,
            follow_redirects=True,
        )
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("GitHubClient 必须用 async with 使用")
        return self._client

    async def _get(self, url: str, **kw: object) -> httpx.Response:
        try:
            res = await self.client.get(url, **kw)  # type: ignore[arg-type]
        except httpx.ConnectError as e:
            raise GitHubError(
                f"无法连接 GitHub API: {url}. "
                "请检查网络，或通过 GITHUB_API_BASE/GITHUB_RAW_BASE 切换官方地址/镜像地址"
            ) from e
        except httpx.TimeoutException as e:
            raise GitHubError(f"连接 GitHub API 超时: {url}") from e
        except httpx.HTTPError as e:
            raise GitHubError(f"访问 GitHub API 失败: {url}: {e}") from e
        if res.status_code == 404:
            raise PRNotFoundError(f"GitHub 资源未找到: {url}")
        if res.status_code == 403 and "rate limit" in res.text.lower():
            raise RateLimitedError("GitHub API 限流,请配置 GITHUB_TOKEN 或稍后再试")
        if res.status_code >= 400:
            raise GitHubError(f"GitHub API {res.status_code}: {res.text[:200]}")
        return res

    async def _get_optional_text(self, url: str) -> str | None:
        try:
            res = await self.client.get(url)
        except httpx.HTTPError:
            return None
        if res.status_code == 404:
            return None
        if res.status_code >= 400:
            return None
        return res.text

    async def fetch_pr_metadata(self, ref: PRRef) -> PRMetadata:
        res = await self._get(_pull_url(ref))
        d = res.json()
        return PRMetadata(
            owner=ref.owner,
            repo=ref.repo,
            number=ref.number,
            title=d.get("title") or "",
            body=d.get("body") or "",
            state=d.get("state") or "unknown",
            draft=bool(d.get("draft")),
            author=PRAuthor(
                login=(d.get("user") or {}).get("login") or "unknown",
                avatar_url=(d.get("user") or {}).get("avatar_url"),
                html_url=(d.get("user") or {}).get("html_url"),
            ),
            base_ref=(d.get("base") or {}).get("ref") or "",
            head_ref=(d.get("head") or {}).get("ref") or "",
            base_sha=(d.get("base") or {}).get("sha") or "",
            head_sha=(d.get("head") or {}).get("sha") or "",
            created_at=d["created_at"],
            updated_at=d["updated_at"],
            additions=d.get("additions") or 0,
            deletions=d.get("deletions") or 0,
            changed_files=d.get("changed_files") or 0,
            commits=d.get("commits") or 0,
            html_url=d.get("html_url") or "",
        )

    async def fetch_pr_files(self, ref: PRRef, max_files: int = 300) -> list[PRFile]:
        files: list[PRFile] = []
        page = 1
        per_page = 100
        while len(files) < max_files:
            res = await self._get(_pull_files_url(ref, per_page=per_page, page=page))
            batch = res.json()
            if not batch:
                break
            for it in batch:
                files.append(
                    PRFile(
                        filename=it.get("filename") or "",
                        status=it.get("status") or "modified",
                        additions=it.get("additions") or 0,
                        deletions=it.get("deletions") or 0,
                        changes=it.get("changes") or 0,
                        patch=it.get("patch"),
                        raw_url=it.get("raw_url"),
                        blob_url=it.get("blob_url"),
                        sha=it.get("sha"),
                    )
                )
                if len(files) >= max_files:
                    break
            if len(batch) < per_page:
                break
            page += 1
        return files

    async def fetch_pr_diff(self, ref: PRRef) -> str:
        res = await self._get(_pull_url(ref), headers={"Accept": "application/vnd.github.v3.diff"})
        return res.text

    async def fetch_file_at_ref(self, ref: PRRef, path: str, sha: str) -> str | None:
        """从 raw.githubusercontent.com 拿指定 commit 的文件全文。返回 None 表示不存在或抓取失败。"""
        return await self._get_optional_text(_raw_file_url(ref, path, sha))

    async def fetch_pr_bundle(
        self,
        ref: PRRef,
        include_diff: bool = True,
        max_files: int = 300,
    ) -> PRBundle:
        metadata = await self.fetch_pr_metadata(ref)
        files = await self.fetch_pr_files(ref, max_files=max_files)
        raw_diff = await self.fetch_pr_diff(ref) if include_diff else ""
        return PRBundle(metadata=metadata, files=files, raw_diff=raw_diff)
