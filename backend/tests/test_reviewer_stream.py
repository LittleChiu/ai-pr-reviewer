"""SSE 流式评审测试。"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import pytest

from app.services.github_schema import PRAuthor, PRBundle, PRFile, PRMetadata
from app.services.llm_client import LLMResponse
from app.services.pr_url import PRRef
from app.services.reviewer_layered import ReviewEvent, review_pr_layered_stream


def _bundle(filenames: list[str]) -> PRBundle:
    md = PRMetadata(
        owner="o",
        repo="r",
        number=1,
        title="add X",
        body="",
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
        PRFile(filename=fn, status="modified", additions=10, deletions=2, changes=12, patch="x")
        for fn in filenames
    ]
    return PRBundle(metadata=md, files=files, raw_diff="")


class FakeLLM:
    def __init__(self, payloads: list[str]) -> None:
        self._payloads = list(payloads)
        self.calls: list[dict] = []

    async def chat_json(self, **kw: Any) -> LLMResponse:
        self.calls.append(kw)
        return LLMResponse(content=self._payloads.pop(0), model=kw["model"])


@pytest.mark.asyncio
async def test_stream_event_sequence() -> None:
    triage = json.dumps(
        {
            "summary": "ok",
            "highlights": ["x"],
            "files": [
                {"filename": "a.py", "attention": "deep", "reason": "x"},
                {"filename": "b.py", "attention": "skip", "reason": "x"},
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
                    "title": "t",
                    "detail": "d",
                    "confidence": "high",
                }
            ],
            "suggestions": [],
        }
    )
    fake = FakeLLM([triage, deep_a])

    events: list[ReviewEvent] = []
    async for ev in review_pr_layered_stream(
        _bundle(["a.py", "b.py"]),
        ref=PRRef(owner="o", repo="r", number=1),
        llm=fake,  # type: ignore[arg-type]
        gh=None,
        primary_model="P",
    ):
        events.append(ev)

    types = [e.type for e in events]
    assert types[0] == "started"
    assert types[1] == "triage"
    assert "file_started" in types
    assert types.count("file_started") == 1  # 仅 a.py 进入深审
    assert types.count("file_done") == 1
    assert types[-1] == "done"

    # done 事件的 payload 是完整 ReviewReport
    final = events[-1].data
    assert final["summary"] == "ok"
    assert len(final["risks"]) == 1
    assert final["risks"][0]["file"] == "a.py"


@pytest.mark.asyncio
async def test_stream_triage_failure_yields_error() -> None:
    class BadLLM(FakeLLM):
        async def chat_json(self, **kw: Any) -> LLMResponse:  # type: ignore[override]
            raise RuntimeError("boom")

    events: list[ReviewEvent] = []
    async for ev in review_pr_layered_stream(
        _bundle(["a.py"]),
        ref=PRRef(owner="o", repo="r", number=1),
        llm=BadLLM([]),  # type: ignore[arg-type]
        gh=None,
        primary_model="P",
    ):
        events.append(ev)

    types = [e.type for e in events]
    assert types[0] == "started"
    assert "error" in types
    # 出错后不应继续到 done
    assert "done" not in types


@pytest.mark.asyncio
async def test_stream_triage_malformed_json_falls_back_to_done() -> None:
    deep_a = json.dumps(
        {
            "risks": [
                {
                    "file": "a.py",
                    "severity": "medium",
                    "category": "bug",
                    "title": "fallback",
                    "detail": "triage JSON 坏掉后仍继续",
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

    events: list[ReviewEvent] = []
    async for ev in review_pr_layered_stream(
        _bundle(["a.py"]),
        ref=PRRef(owner="o", repo="r", number=1),
        llm=fake,  # type: ignore[arg-type]
        gh=None,
        primary_model="P",
        max_deep_files=1,
    ):
        events.append(ev)

    types = [e.type for e in events]
    assert types[0] == "started"
    assert "triage" in types
    assert types[-1] == "done"
    assert "error" not in types
