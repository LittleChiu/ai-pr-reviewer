"""第一版评审策略:单轮 prompt + 完整 PR diff,产出 ReviewReport。

后续 PR 演进:
- 三层 prompt(文件级/块级/行级)
- 改动文件全文上下文
- 视觉模型分析 PR 描述里的截图
"""

from __future__ import annotations

import time

from pydantic import ValidationError

from app.core.config import get_settings
from app.services.github_schema import PRBundle
from app.services.llm_client import LLMClient, LLMError, chat_json_with_parse_retry
from app.services.review_schema import ReviewReport
from app.services.review_schema import TokenUsage as ReportTokenUsage

SYSTEM_PROMPT = """你是一位资深的代码评审专家,擅长 Python/TypeScript/Go 等主流语言。
你的任务是评审一个 GitHub Pull Request,产出一份高质量、低噪声的评审报告。

评审原则:
1. 忠于事实,只对 diff 中实际出现的代码发表意见;不要臆测未出现的代码。
2. 关注真正影响正确性、性能、安全性的问题;风格 nitpick 归到次要建议。
3. 每条问题/建议都要标注严重程度 (high/medium/low) 与你的置信度。
4. 用人话说话,避免空泛的"建议优化"。给出可立即采纳的修改方向。

输出**严格 JSON**,符合以下 schema(不要包裹 markdown,不要附加任何额外文字):
{
  "summary": "字符串。PR 整体在做什么、为什么、改在哪些层。3-5 句话。",
  "highlights": ["字符串数组。值得肯定的设计点,如无可省略为 []"],
  "risks": [
    {
      "file": "改动文件路径",
      "line_hint": "行号或行号范围(可选,如 '23-31')",
      "severity": "high|medium|low",
      "category": "bug|perf|security|style|other",
      "title": "一句话总结问题",
      "detail": "解释问题与可能的影响,给出修改方向",
      "confidence": "high|medium|low"
    }
  ],
  "suggestions": [
    {
      "file": "文件路径",
      "line_hint": "行号(可选)",
      "title": "一句话建议",
      "detail": "解释建议的理由",
      "code_hint": "可选,简短的示例代码片段",
      "confidence": "high|medium|low"
    }
  ]
}

特别注意:
- risks 是"可能出错的地方",suggestions 是"可以改进但不一定有错的地方"。
- 如果 PR 看起来质量很高,risks/suggestions 可以为空数组。质量比数量重要。
- 不要重复 PR 描述里已经说过的内容。
- summary 中不要复述变更行数,关注"为什么这么改"。
"""


def _build_user_prompt(bundle: PRBundle, diff_char_limit: int = 60000) -> str:
    md = bundle.metadata
    parts: list[str] = []
    parts.append(f"# PR: {md.title}")
    parts.append(f"仓库: {md.owner}/{md.repo}#{md.number}")
    parts.append(f"作者: @{md.author.login}")
    parts.append(f"分支: {md.head_ref} -> {md.base_ref}")
    parts.append(
        f"变更规模: +{md.additions} -{md.deletions},{md.changed_files} 文件,{md.commits} commit"
    )
    if md.body:
        body = md.body.strip()
        if len(body) > 4000:
            body = body[:4000] + "\n...(已截断)"
        parts.append("\n## PR 描述\n" + body)
    parts.append("\n## 改动文件清单")
    for f in bundle.files[:50]:
        parts.append(f"- [{f.status}] {f.filename} (+{f.additions}/-{f.deletions})")
    if len(bundle.files) > 50:
        parts.append(f"- ...(还有 {len(bundle.files) - 50} 个文件未列出)")
    if bundle.raw_diff:
        diff = bundle.raw_diff
        if len(diff) > diff_char_limit:
            diff = diff[:diff_char_limit] + "\n...(diff 已截断,优先关注上半部分)"
        parts.append("\n## Diff\n```diff\n" + diff + "\n```")
    parts.append("\n请按 system 指令产出严格 JSON 评审报告。")
    return "\n".join(parts)


async def review_pr(
    bundle: PRBundle,
    *,
    llm: LLMClient | None = None,
    primary_model: str | None = None,
) -> ReviewReport:
    s = get_settings()
    client = llm or LLMClient()
    model = primary_model or s.primary_model
    user_prompt = _build_user_prompt(bundle)
    t0 = time.time()
    data, resp = await chat_json_with_parse_retry(
        client,
        model=model,
        system=SYSTEM_PROMPT,
        user=user_prompt,
        max_tokens=4096,
        temperature=0.2,
    )
    try:
        report = ReviewReport(**data)
    except ValidationError as e:
        raise LLMError(f"模型输出 JSON 结构不符合 ReviewReport schema: {e}") from e
    report.model = resp.model
    report.elapsed_ms = int((time.time() - t0) * 1000)
    report.token_usage = ReportTokenUsage(
        prompt_tokens=resp.usage.prompt_tokens,
        completion_tokens=resp.usage.completion_tokens,
        total_tokens=resp.usage.total_tokens,
        llm_calls=resp.usage.llm_calls,
    )
    return report
