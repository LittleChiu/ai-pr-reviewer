"""三层评审测试:用假 LLM 注入,验证 triage → deep × N → 聚合的调用编排。"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import pytest

from app.services.github_schema import PRAuthor, PRBundle, PRFile, PRMetadata
from app.services.llm_client import LLMResponse
from app.services.pr_url import PRRef
from app.services.reviewer_layered import review_pr_layered


def _make_bundle(filenames: list[str]) -> PRBundle:
    md = PRMetadata(
        owner="o",
        repo="r",
        number=1,
        title="add X",
        body="why",
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
        changed_files=len(filenames),
        commits=1,
        html_url="https://github.com/o/r/pull/1",
    )
    files = [
        PRFile(
            filename=fn,
            status="modified",
            additions=10,
            deletions=2,
            changes=12,
            patch=f"@@ +1 @@ {fn}",
        )
        for fn in filenames
    ]
    return PRBundle(metadata=md, files=files, raw_diff="")


class FakeLLM:
    """按调用次数返回不同 payload。"""

    def __init__(self, payloads: list[str]) -> None:
        self._payloads = list(payloads)
        self.calls: list[dict] = []

    async def chat_json(self, **kw: Any) -> LLMResponse:
        self.calls.append(kw)
        if not self._payloads:
            raise RuntimeError("FakeLLM: out of payloads")
        return LLMResponse(content=self._payloads.pop(0), model=kw["model"])


@pytest.mark.asyncio
async def test_layered_review_triage_then_deep() -> None:
    triage_payload = json.dumps(
        {
            "summary": "增加了 X 能力",
            "highlights": ["分层清晰"],
            "files": [
                {"filename": "a.py", "attention": "deep", "reason": "核心逻辑"},
                {"filename": "b.py", "attention": "skip", "reason": "无关紧要"},
                {"filename": "c.py", "attention": "deep", "reason": "另一个核心"},
            ],
        }
    )
    deep_a = json.dumps(
        {
            "risks": [
                {
                    "file": "a.py",
                    "severity": "high",
                    "category": "bug",
                    "title": "潜在空指针",
                    "detail": "x 可能为 None",
                    "confidence": "high",
                }
            ],
            "suggestions": [],
        }
    )
    deep_c = json.dumps(
        {
            "risks": [
                {
                    "file": "c.py",
                    "severity": "low",
                    "category": "style",
                    "title": "命名",
                    "detail": "短",
                    "confidence": "low",
                }
            ],
            "suggestions": [
                {
                    "file": "c.py",
                    "title": "用 Enum",
                    "detail": "增强可读性",
                    "confidence": "medium",
                }
            ],
        }
    )

    fake = FakeLLM([triage_payload, deep_a, deep_c])
    report = await review_pr_layered(
        _make_bundle(["a.py", "b.py", "c.py"]),
        ref=PRRef(owner="o", repo="r", number=1),
        llm=fake,  # type: ignore[arg-type]
        gh=None,
        primary_model="P",
    )

    # 1 次粗筛 + 2 次深审(b.py 被 skip)
    assert len(fake.calls) == 3
    # 粗筛使用 primary_model
    assert fake.calls[0]["model"] == "P"
    # 深审使用 primary_model
    assert fake.calls[1]["model"] == "P"
    assert fake.calls[2]["model"] == "P"

    assert report.summary.startswith("增加")
    assert len(report.risks) == 2
    # high 排在 low 前
    assert report.risks[0].severity == "high"
    assert report.risks[1].severity == "low"
    assert len(report.suggestions) == 1


@pytest.mark.asyncio
async def test_layered_review_no_deep_files() -> None:
    triage_payload = json.dumps(
        {
            "summary": "纯文档",
            "highlights": [],
            "files": [{"filename": "README.md", "attention": "skip", "reason": "doc"}],
        }
    )
    fake = FakeLLM([triage_payload])
    report = await review_pr_layered(
        _make_bundle(["README.md"]),
        ref=PRRef(owner="o", repo="r", number=1),
        llm=fake,  # type: ignore[arg-type]
        gh=None,
        primary_model="P",
    )
    assert len(fake.calls) == 1  # 只触发粗筛
    assert report.summary == "纯文档"
    assert report.risks == []
    assert report.suggestions == []


@pytest.mark.asyncio
async def test_layered_review_handles_deep_failure() -> None:
    """单个文件深审失败不应让整体报错。"""
    triage_payload = json.dumps(
        {
            "summary": "test",
            "highlights": [],
            "files": [
                {"filename": "a.py", "attention": "deep", "reason": "x"},
                {"filename": "b.py", "attention": "deep", "reason": "x"},
            ],
        }
    )

    class FlakyLLM(FakeLLM):
        async def chat_json(self, **kw: Any) -> LLMResponse:
            self.calls.append(kw)
            # 第 2 次(深审 a.py)抛错;其它正常
            if len(self.calls) == 2:
                raise RuntimeError("upstream timeout")
            return LLMResponse(
                content=self._payloads.pop(0) if self._payloads else "{}",
                model=kw["model"],
            )

    deep_b = json.dumps({"risks": [], "suggestions": []})
    flaky = FlakyLLM([triage_payload, deep_b])
    report = await review_pr_layered(
        _make_bundle(["a.py", "b.py"]),
        ref=PRRef(owner="o", repo="r", number=1),
        llm=flaky,  # type: ignore[arg-type]
        gh=None,
        primary_model="P",
    )
    assert report.summary == "test"
    assert report.risks == []


@pytest.mark.asyncio
async def test_layered_review_falls_back_when_triage_json_stays_malformed() -> None:
    deep_a = json.dumps(
        {
            "risks": [
                {
                    "file": "a.py",
                    "severity": "medium",
                    "category": "bug",
                    "title": "fallback still reviews file",
                    "detail": "triage JSON 坏掉后仍继续深审",
                    "confidence": "high",
                }
            ],
            "suggestions": [],
        }
    )
    fake = FakeLLM(
        [
            '{"summary": "bad"',
            '{"summary": "still bad"',
            deep_a,
        ]
    )
    report = await review_pr_layered(
        _make_bundle(["a.py"]),
        ref=PRRef(owner="o", repo="r", number=1),
        llm=fake,  # type: ignore[arg-type]
        gh=None,
        primary_model="P",
        max_deep_files=1,
    )
    assert report.summary == ""
    assert len(report.risks) == 1
    assert report.risks[0].file == "a.py"
    assert len(fake.calls) == 3
