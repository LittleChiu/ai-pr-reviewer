"""SQLite 缓存测试。"""

from __future__ import annotations

import tempfile
from pathlib import Path

from app.services.cache import ReviewCache


def test_set_get_basic() -> None:
    with tempfile.TemporaryDirectory() as d:
        c = ReviewCache(Path(d) / "t.db")
        assert c.get("k1") is None
        c.set("k1", {"a": 1, "b": [2, 3]})
        assert c.get("k1") == {"a": 1, "b": [2, 3]}


def test_overwrite_with_set() -> None:
    with tempfile.TemporaryDirectory() as d:
        c = ReviewCache(Path(d) / "t.db")
        c.set("k", {"v": 1})
        c.set("k", {"v": 2})
        assert c.get("k") == {"v": 2}


def test_clear_returns_count() -> None:
    with tempfile.TemporaryDirectory() as d:
        c = ReviewCache(Path(d) / "t.db")
        c.set("a", {"x": 1})
        c.set("b", {"x": 2})
        assert c.stats()["entries"] == 2
        n = c.clear()
        assert n == 2
        assert c.stats()["entries"] == 0


def test_make_key_stable_and_distinct() -> None:
    k1 = ReviewCache.make_key("o", "r", 1, "h" * 40, "layered", "deepseek-v4-pro-max")
    k2 = ReviewCache.make_key("o", "r", 1, "h" * 40, "layered", "deepseek-v4-pro-max")
    assert k1 == k2

    # 不同 head_sha 应产生不同 key
    k3 = ReviewCache.make_key("o", "r", 1, "x" * 40, "layered", "deepseek-v4-pro-max")
    assert k1 != k3

    # 不同 strategy 应产生不同 key
    k4 = ReviewCache.make_key("o", "r", 1, "h" * 40, "single", "deepseek-v4-pro-max")
    assert k1 != k4


def test_corrupt_payload_returns_none() -> None:
    """如果手动塞入坏 JSON,get 应该返回 None 而不是崩。"""
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "t.db"
        c = ReviewCache(path)
        c.set("good", {"v": 1})
        # 直接用 sqlite3 写脏数据
        import sqlite3

        with sqlite3.connect(path) as conn:
            conn.execute(
                "INSERT INTO cache(key, payload, created_at) VALUES(?, ?, 0)",
                ("bad", "not-a-json"),
            )
        assert c.get("good") == {"v": 1}
        assert c.get("bad") is None
