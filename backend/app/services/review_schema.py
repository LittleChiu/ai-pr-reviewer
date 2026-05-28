"""评审报告 schema。

设计原则:模型输出严格 JSON,直接 parse 进这些 schema,前端拿到的就是确定结构。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["high", "medium", "low"]
Confidence = Literal["high", "medium", "low"]


class RiskItem(BaseModel):
    file: str
    line_hint: str | None = None
    severity: Severity = "medium"
    category: str = Field(default="general", description="bug / perf / security / style / other")
    title: str
    detail: str
    confidence: Confidence = "medium"


class Suggestion(BaseModel):
    file: str
    line_hint: str | None = None
    title: str
    detail: str
    code_hint: str | None = None
    confidence: Confidence = "medium"


class ReviewReport(BaseModel):
    summary: str = Field(description="PR 整体在做什么、为什么、改在哪些层")
    highlights: list[str] = Field(default_factory=list, description="值得肯定的设计点")
    risks: list[RiskItem] = Field(default_factory=list)
    suggestions: list[Suggestion] = Field(default_factory=list)
    model: str = ""
    elapsed_ms: int = 0
