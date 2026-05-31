"""SQLite 评审结果缓存。

KISS:
- 标准库 sqlite3,不引 sqlmodel/sqlalchemy
- 单表 cache(key PRIMARY KEY, payload TEXT, created_at INTEGER)
- key 由 (repo, head_sha, strategy, model) 决定:同一 commit + 同策略 + 同模型 才算命中

用法:
    from app.services.cache import get_cache
    c = get_cache()
    cached = c.get(key)
    if cached:
        return ReviewReport(**cached)
    ...
    c.set(key, report.model_dump())
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class ReviewCache:
    """线程安全的轻量 SQLite 缓存。"""

    def __init__(self, db_path: str | Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    def _conn(self) -> sqlite3.Connection:
        # 每次拿独立连接,sqlite3 默认 same-thread 限制下不便共用
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock, self._conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS cache (
                    key        TEXT PRIMARY KEY,
                    payload    TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_cache_created ON cache(created_at)")

    @staticmethod
    def make_key(
        owner: str, repo: str, number: int, head_sha: str, strategy: str, model: str
    ) -> str:
        return f"{owner}/{repo}#{number}@{head_sha[:12]}@{strategy}@{model}"

    def get(self, key: str) -> dict[str, Any] | None:
        with self._lock, self._conn() as c:
            row = c.execute("SELECT payload FROM cache WHERE key = ?", (key,)).fetchone()
        if not row:
            return None
        try:
            return json.loads(row["payload"])
        except json.JSONDecodeError:
            logger.warning("cache: corrupt payload for key %s, ignoring", key)
            return None

    def set(self, key: str, payload: dict[str, Any]) -> None:
        with self._lock, self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO cache(key, payload, created_at) VALUES(?, ?, ?)",
                (key, json.dumps(payload, ensure_ascii=False), int(time.time())),
            )

    def clear(self) -> int:
        with self._lock, self._conn() as c:
            cur = c.execute("DELETE FROM cache")
            return cur.rowcount

    def stats(self) -> dict[str, int]:
        with self._lock, self._conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM cache").fetchone()
        return {"entries": row["n"] if row else 0}


_cache_singleton: ReviewCache | None = None


def get_cache() -> ReviewCache:
    global _cache_singleton
    if _cache_singleton is None:
        s = get_settings()
        _cache_singleton = ReviewCache(s.cache_db_path)
    return _cache_singleton


def reset_cache_for_tests() -> None:
    """测试用:让 get_cache() 下次返回新实例。"""
    global _cache_singleton
    _cache_singleton = None
