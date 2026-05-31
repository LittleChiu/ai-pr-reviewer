from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any

from fastapi.testclient import TestClient

from app.main import app
from app.services.github_schema import PRAuthor, PRBundle, PRFile, PRMetadata
from app.services.reviewer_layered import ReviewEvent

client = TestClient(app)


def _bundle() -> PRBundle:
    md = PRMetadata(
        owner="o",
        repo="r",
        number=1,
        title="add X",
        body="",
        state="open",
        draft=False,
        author=PRAuthor(login="alice"),
        base_ref="main",
        head_ref="feat/x",
        base_sha="b" * 40,
        head_sha="h" * 40,
        created_at=datetime(2026, 5, 29),
        updated_at=datetime(2026, 5, 29),
        additions=20,
        deletions=3,
        changed_files=1,
        commits=1,
        html_url="https://github.com/o/r/pull/1",
    )
    files = [
        PRFile(filename="a.py", status="modified", additions=10, deletions=2, changes=12, patch="x")
    ]
    return PRBundle(metadata=md, files=files, raw_diff="")


def _parse_sse_events(body: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    for frame in body.split("\n\n"):
        frame = frame.strip()
        if not frame:
            continue
        ev_type = ""
        data_line = ""
        for line in frame.split("\n"):
            if line.startswith("event:"):
                ev_type = line[6:].strip()
            elif line.startswith("data:"):
                data_line += line[5:].strip()
        if ev_type and data_line:
            events.append((ev_type, json.loads(data_line)))
    return events


class FakeGitHubClient:
    async def __aenter__(self) -> FakeGitHubClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def fetch_pr_bundle(self, ref: Any) -> PRBundle:
        await asyncio.sleep(0.03)
        return _bundle()


def test_review_stream_emits_accepted_and_heartbeat(monkeypatch: Any) -> None:
    async def fake_stream(*args: Any, **kwargs: Any):
        yield ReviewEvent(
            "started",
            {
                "pr": "o/r#1",
                "title": "add X",
                "files": 1,
                "additions": 20,
                "deletions": 3,
                "model": "P",
            },
        )
        yield ReviewEvent(
            "done",
            {
                "summary": "ok",
                "highlights": [],
                "risks": [],
                "suggestions": [],
                "model": "P",
                "elapsed_ms": 12,
                "token_usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "llm_calls": 0,
                },
            },
        )

    monkeypatch.setattr("app.api.review.GitHubClient", FakeGitHubClient)
    monkeypatch.setattr("app.api.review.review_pr_layered_stream", fake_stream)
    monkeypatch.setattr("app.api.review.HEARTBEAT_INTERVAL_S", 0.01)

    with client.stream("POST", "/api/review/stream", json={"url": "https://github.com/o/r/pull/1"}) as res:
        body = "".join(res.iter_text())

    assert res.status_code == 200
    events = _parse_sse_events(body)
    types = [event_type for event_type, _ in events]
    assert types[0] == "accepted"
    assert "heartbeat" in types
    assert "started" in types
    assert types[-1] == "done"


def test_review_stream_fetch_error_after_accepted(monkeypatch: Any) -> None:
    from app.services.github_client import PRNotFoundError

    class FailingGitHubClient(FakeGitHubClient):
        async def fetch_pr_bundle(self, ref: Any) -> PRBundle:
            raise PRNotFoundError("missing")

    async def fake_stream(*args: Any, **kwargs: Any):
        if False:
            yield ReviewEvent("done", {})

    monkeypatch.setattr("app.api.review.GitHubClient", FailingGitHubClient)
    monkeypatch.setattr("app.api.review.review_pr_layered_stream", fake_stream)
    monkeypatch.setattr("app.api.review.HEARTBEAT_INTERVAL_S", 0.01)

    with client.stream("POST", "/api/review/stream", json={"url": "https://github.com/o/r/pull/1"}) as res:
        body = "".join(res.iter_text())

    assert res.status_code == 200
    events = _parse_sse_events(body)
    types = [event_type for event_type, _ in events]
    assert types[0] == "accepted"
    assert types[-1] == "error"
    assert "done" not in types
