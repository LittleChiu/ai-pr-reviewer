"""统一错误响应格式测试。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_pr_url_invalid_returns_400_with_validation_error() -> None:
    """无效 URL 应该 400 且响应是统一格式。"""
    res = client.post(
        "/api/review",
        json={"url": "not a url at all"},
    )
    assert res.status_code == 400
    body = res.json()
    assert "error" in body
    assert "code" in body["error"]
    assert "message" in body["error"]


def test_review_missing_url_returns_validation_error() -> None:
    """缺 url 字段应该 400 + VALIDATION_ERROR。"""
    res = client.post("/api/review", json={})
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "hint" in body["error"]


def test_pr_parse_invalid_returns_unified_error() -> None:
    """旧的 raise HTTPException(detail=str) 也应被统一异常处理器包裹。"""
    res = client.get("/api/pr/parse?url=foobar")
    assert res.status_code == 400
    body = res.json()
    assert "error" in body
    # 不要求精确 code(可能是 BAD_REQUEST 或其它),只要符合统一格式
    assert "message" in body["error"]
