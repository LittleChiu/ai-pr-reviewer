"""GitHub 数据结构 schema。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class PRAuthor(BaseModel):
    login: str
    avatar_url: str | None = None
    html_url: str | None = None


class PRMetadata(BaseModel):
    owner: str
    repo: str
    number: int
    title: str
    body: str = ""
    state: str
    draft: bool = False
    author: PRAuthor
    base_ref: str
    head_ref: str
    base_sha: str
    head_sha: str
    created_at: datetime
    updated_at: datetime
    additions: int = 0
    deletions: int = 0
    changed_files: int = 0
    commits: int = 0
    html_url: str


class PRFile(BaseModel):
    filename: str
    status: str
    additions: int = 0
    deletions: int = 0
    changes: int = 0
    patch: str | None = None
    raw_url: str | None = None
    blob_url: str | None = None
    sha: str | None = None


class PRBundle(BaseModel):
    metadata: PRMetadata
    files: list[PRFile] = Field(default_factory=list)
    raw_diff: str = ""
