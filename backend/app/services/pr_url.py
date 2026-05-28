"""PR URL 解析:把 GitHub 链接拆成 owner/repo/number。"""

from __future__ import annotations

import re
from dataclasses import dataclass

_PR_URL_PATTERNS = [
    re.compile(r"^https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)/?$"),
    re.compile(r"^(?P<owner>[^/\s]+)/(?P<repo>[^/\s#]+)#(?P<number>\d+)$"),
]


@dataclass(frozen=True)
class PRRef:
    owner: str
    repo: str
    number: int

    def __str__(self) -> str:
        return f"{self.owner}/{self.repo}#{self.number}"

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.repo}"


def parse_pr_url(url: str) -> PRRef:
    s = url.strip()
    if not s:
        raise ValueError("PR URL 不能为空")
    for pat in _PR_URL_PATTERNS:
        m = pat.match(s)
        if m:
            return PRRef(
                owner=m["owner"],
                repo=m["repo"],
                number=int(m["number"]),
            )
    raise ValueError(
        f"无法解析的 PR 引用: {url!r}。"
        " 支持: https://github.com/owner/repo/pull/123 或 owner/repo#123"
    )
