"""Token 用量累加测试。"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import pytest

from app.services.github_schema import PRAuthor, PRBundle, PRFile, PRMetadata
from app.services.llm_client import LLMResponse, TokenUsage
from app.services.pr_url import PRRef
from app.services.reviewer_layered import review_pr_layered


def _bundle(filenames: list[str]) -> PRBundle:
    md = PRMetadata(
        owner="o",
        repo="r",
        number=1,
        title="t",
        body="",
        state="open",
        author=PRAuthor(login="a"),
        base_ref="main",
        head_ref="x",
        base_sha="b" * 40,
        head_sha="h" * 40,
        created_at=datetime(2026, 5, 29),
        updated_at=datetime(2026, 5, 29),
        additions=10,
        deletions=2,
        changed_files=len(filenames),
        commits=1,
        html_url="https://github.com/o/r/pull/1",
    )
    files = [
        PRFile(filename=fn, status="modified", additions=5, deletions=1, changes=6, patch="x")
        for fn in filenames
    ]
    return PRBundle(metadata=md, files=files, raw_diff="")


class CountingLLM:
    """每次返回固定 token 用量,用来验证累加逻辑。"""

    def __init__(self, payloads: list[str], usage_per_call: TokenUsage) -> None:
        self._payloads = list(payloads)
        self._usage = usage_per_call
        self.calls: list[dict] = []

    async def chat_json(self, **kw: Any) -> LLMResponse:
        self.calls.append(kw)
        # 注意 dataclass 不能直接复用,clone 一份
        u = TokenUsage(
            prompt_tokens=self._usage.prompt_tokens,
            completion_tokens=self._usage.completion_tokens,
            total_tokens=self._usage.total_tokens,
            llm_calls=1,
        )
        return LLMResponse(content=self._payloads.pop(0), model=kw["model"], usage=u)


@pytest.mark.asyncio
async def test_layered_token_usage_accumulates() -> None:
    triage = json.dumps(
        {
            "summary": "ok",
            "highlights": [],
            "files": [
                {"filename": "a.py", "attention": "deep", "reason": "x"},
                {"filename": "b.py", "attention": "deep", "reason": "x"},
            ],
        }
    )
    deep = json.dumps({"risks": [], "suggestions": []})
    fake = CountingLLM(
        [triage, deep, deep],
        usage_per_call=TokenUsage(
            prompt_tokens=100, completion_tokens=20, total_tokens=120, llm_calls=1
        ),
    )

    report = await review_pr_layered(
        _bundle(["a.py", "b.py"]),
        ref=PRRef(owner="o", repo="r", number=1),
        llm=fake,  # type: ignore[arg-type]
        gh=None,
        primary_model="P",
    )

    # triage(1) + deep(2) = 3 次调用
    assert report.token_usage.llm_calls == 3
    assert report.token_usage.prompt_tokens == 300
    assert report.token_usage.completion_tokens == 60
    assert report.token_usage.total_tokens == 360
