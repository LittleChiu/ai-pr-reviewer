"""image_utils: 图片 URL 提取与视觉分析流程测试。"""

from __future__ import annotations

from typing import Any

import pytest

from app.services.github_schema import PRAuthor, PRBundle, PRFile, PRMetadata
from app.services.image_utils import extract_image_urls
from app.services.llm_client import LLMResponse
from app.services.pr_url import PRRef
from app.services.reviewer_layered import review_pr_layered


def test_extract_markdown_image() -> None:
    body = "## Overview\n![arch](https://example.com/arch.png)\n\nSome text"
    assert extract_image_urls(body) == ["https://example.com/arch.png"]


def test_extract_html_image() -> None:
    body = '<img src="https://example.com/diagram.jpg" alt="diagram" />'
    assert extract_image_urls(body) == ["https://example.com/diagram.jpg"]


def test_extract_both_and_dedupe() -> None:
    body = '![a](https://x.com/a.png) <img src="https://x.com/a.png"> ![b](https://x.com/b.png)'
    assert extract_image_urls(body) == ["https://x.com/a.png", "https://x.com/b.png"]


def test_no_images() -> None:
    assert extract_image_urls("plain text") == []
    assert extract_image_urls("") == []


@pytest.mark.asyncio
async def test_vision_not_called_when_no_images() -> None:
    """PR 无图片时不应触发 vision 调用。"""

    class AssertNoVision:
        calls: list[Any] = []

        async def chat_json(self, **kw: Any) -> LLMResponse:
            self.calls.append(kw)
            return LLMResponse(
                content='{"summary":"ok","highlights":[],"files":[]}', model=kw["models"][0]
            )

        async def analyze_images(self, **kw: Any) -> None:
            raise AssertionError("should not be called")

    bundle = _make_bundle(body="no images here")
    report = await review_pr_layered(
        bundle,
        ref=PRRef(owner="o", repo="r", number=1),
        llm=AssertNoVision(),  # type: ignore[arg-type]
        gh=None,
    )
    assert report.summary == "ok"


@pytest.mark.asyncio
async def test_vision_called_when_images_present() -> None:
    class RecLLM:
        calls: list[Any] = []
        _next: list[str] = [
            '{"summary":"ok","highlights":[],"files":[]}',
            '{"risks":[],"suggestions":[]}',
        ]

        async def chat_json(self, **kw: Any) -> LLMResponse:
            self.calls.append(("chat", kw))
            return LLMResponse(content=self._next.pop(0), model=kw["models"][0])

        async def analyze_images(self, **kw: Any) -> LLMResponse:
            self.calls.append(("vision", kw))
            return LLMResponse(content="架构图显示三层设计", model=kw["model"])

    bundle = _make_bundle(body="![arch](https://x.com/a.png)")
    rec = RecLLM()
    report = await review_pr_layered(
        bundle,
        ref=PRRef(owner="o", repo="r", number=1),
        llm=rec,  # type: ignore[arg-type]
        gh=None,
    )
    assert report.summary == "ok"
    # 1 triage + 1 vision + 0 deep(no deep files)
    chat_calls = [c for c in rec.calls if c[0] == "chat"]
    vision_calls = [c for c in rec.calls if c[0] == "vision"]
    assert len(chat_calls) == 1
    assert len(vision_calls) == 1
    assert "已用 vision 模型" in report.highlights[0]


def _make_bundle(body: str = "") -> PRBundle:
    from datetime import datetime

    md = PRMetadata(
        owner="o",
        repo="r",
        number=1,
        title="test",
        body=body,
        state="open",
        author=PRAuthor(login="alice"),
        base_ref="main",
        head_ref="feat/x",
        base_sha="b" * 40,
        head_sha="h" * 40,
        created_at=datetime(2026, 5, 29),
        updated_at=datetime(2026, 5, 29),
        additions=10,
        deletions=2,
        changed_files=1,
        commits=1,
        html_url="https://github.com/o/r/pull/1",
    )
    return PRBundle(
        metadata=md,
        files=[
            PRFile(
                filename="a.py",
                status="modified",
                additions=10,
                deletions=2,
                changes=12,
                patch="@@ +1",
            )
        ],
        raw_diff="",
    )
