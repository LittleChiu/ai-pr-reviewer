"""Reviewer 测试:用假的 LLMClient 注入,断言 prompt 拼装与结果解析。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest

from app.services.github_schema import PRAuthor, PRBundle, PRFile, PRMetadata
from app.services.llm_client import LLMResponse
from app.services.reviewer import _build_user_prompt, review_pr


def _make_bundle() -> PRBundle:
    md = PRMetadata(
        owner="o",
        repo="r",
        number=1,
        title="add feature X",
        body="why X is useful",
        state="open",
        author=PRAuthor(login="alice"),
        base_ref="main",
        head_ref="feat/x",
        base_sha="b" * 40,
        head_sha="h" * 40,
        created_at=datetime(2026, 5, 29),
        updated_at=datetime(2026, 5, 29),
        additions=20,
        deletions=3,
        changed_files=2,
        commits=1,
        html_url="https://github.com/o/r/pull/1",
    )
    files = [
        PRFile(filename="a.py", status="modified", additions=10, deletions=2, changes=12),
        PRFile(filename="b.py", status="added", additions=10, deletions=1, changes=11),
    ]
    return PRBundle(metadata=md, files=files, raw_diff="diff --git a/a.py b/a.py\n@@ -1 +1 @@\n")


def test_build_user_prompt_contains_key_fields() -> None:
    p = _build_user_prompt(_make_bundle())
    assert "add feature X" in p
    assert "alice" in p
    assert "+20 -3" in p
    assert "a.py" in p
    assert "b.py" in p
    assert "diff --git" in p


class FakeLLM:
    def __init__(self, payloads: str | list[str]) -> None:
        self._payloads = [payloads] if isinstance(payloads, str) else list(payloads)
        self.calls: list[dict] = []

    async def chat_json(self, **kw: Any) -> LLMResponse:
        self.calls.append(kw)
        return LLMResponse(content=self._payloads.pop(0), model=kw["model"])


@pytest.mark.asyncio
async def test_review_pr_parses_response() -> None:
    payload = """{
        "summary": "增加了 X 能力",
        "highlights": ["分层清晰"],
        "risks": [{
            "file": "a.py",
            "severity": "low",
            "category": "style",
            "title": "命名可改进",
            "detail": "x 太短",
            "confidence": "low"
        }],
        "suggestions": []
    }"""
    fake = FakeLLM(payload)
    report = await review_pr(_make_bundle(), llm=fake, primary_model="m1")  # type: ignore[arg-type]
    assert report.summary.startswith("增加")
    assert len(report.risks) == 1
    assert report.risks[0].file == "a.py"
    assert report.model == "m1"
    assert fake.calls[0]["model"] == "m1"


@pytest.mark.asyncio
async def test_review_pr_retries_when_first_json_is_malformed() -> None:
    fake = FakeLLM(
        [
            '{"summary": "bad"',
            '{"summary": "修复成功", "highlights": [], "risks": [], "suggestions": []}',
        ]
    )
    report = await review_pr(_make_bundle(), llm=fake, primary_model="m1")  # type: ignore[arg-type]
    assert report.summary == "修复成功"
    assert report.token_usage.llm_calls == 2
    assert len(fake.calls) == 2
