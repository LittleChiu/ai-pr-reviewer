"""三层 prompt 评审策略。

第一层 — 粗筛 (fast_model):
  输入: PR metadata + 文件清单(不带 diff)
  输出: 整体 summary + highlights + 每个文件的 attention 等级(deep/normal/skip)

第二层 — 深审 (primary_model,逐文件并发):
  输入: 单文件的完整文件内容(若可拉到) + 文件级 patch
  输出: 这个文件的 risks + suggestions

第三层 — 聚合:
  纯代码合并:汇总各文件的 risks/suggestions,按严重程度排序
"""

from __future__ import annotations

import asyncio
import logging
import time

from app.core.config import get_settings
from app.services.github_client import GitHubClient
from app.services.github_schema import PRBundle, PRFile
from app.services.llm_client import LLMClient, extract_json
from app.services.pr_url import PRRef
from app.services.review_schema import ReviewReport, RiskItem, Suggestion

logger = logging.getLogger(__name__)


TRIAGE_SYSTEM = """你是一位资深代码评审专家。任务是对一个 GitHub Pull Request 做**整体粗筛**:
1. 给出一份 PR 总览(summary):用 3-5 句话说清楚这个 PR 在做什么、为什么、改在哪些层。
2. 给出一组亮点(highlights):值得肯定的设计点,如无可省略。
3. 对每个改动文件,判定 attention 等级:
   - "deep": 包含核心业务/算法/安全/接口 等需要详细评审的文件
   - "normal": 一般实现文件,可简评
   - "skip": 自动生成 / lockfile / 大段格式化 / 纯文档 等不值得 LLM 关注的文件

输出**严格 JSON**(不要 markdown 包裹,不要前后缀):
{
  "summary": "...",
  "highlights": ["..."],
  "files": [
    { "filename": "...", "attention": "deep|normal|skip", "reason": "为什么这么判定(简短)" }
  ]
}
"""


DEEP_REVIEW_SYSTEM = """你是一位资深代码评审专家,正在对 Pull Request 中的**单个文件**做深度评审。

评审原则:
1. 忠于事实,只对 diff 中实际出现的代码发表意见。
2. 关注真正影响正确性、性能、安全性的问题;风格 nitpick 归到次要建议。
3. 每条结论都要标注严重程度(severity)与置信度(confidence)。
4. 优先在文件全文上下文里推理(看变量在别处的使用),降低误报。

输出**严格 JSON**:
{
  "risks": [
    {
      "file": "<文件路径>",
      "line_hint": "行号或范围(可选)",
      "severity": "high|medium|low",
      "category": "bug|perf|security|style|other",
      "title": "一句话总结",
      "detail": "解释问题与影响,给修改方向",
      "confidence": "high|medium|low"
    }
  ],
  "suggestions": [
    {
      "file": "<文件路径>",
      "line_hint": "行号(可选)",
      "title": "一句话建议",
      "detail": "理由",
      "code_hint": "可选示例代码",
      "confidence": "high|medium|low"
    }
  ]
}

如果该文件没有真正需要指出的问题,risks/suggestions 可以为空数组。质量比数量重要。
"""


def _triage_user_prompt(bundle: PRBundle) -> str:
    md = bundle.metadata
    parts = [
        f"# PR: {md.title}",
        f"仓库: {md.owner}/{md.repo}#{md.number}",
        f"作者: @{md.author.login}",
        f"分支: {md.head_ref} -> {md.base_ref}",
        f"变更规模: +{md.additions}/-{md.deletions}, {md.changed_files} 文件",
    ]
    if md.body:
        body = md.body.strip()
        if len(body) > 3000:
            body = body[:3000] + "\n...(已截断)"
        parts.append("\n## PR 描述\n" + body)
    parts.append("\n## 改动文件清单(状态/+加/-减/路径)")
    for f in bundle.files:
        parts.append(f"- [{f.status}] +{f.additions}/-{f.deletions} {f.filename}")
    parts.append("\n请按 system 指令产出严格 JSON 粗筛结果。")
    return "\n".join(parts)


def _deep_review_user_prompt(
    file: PRFile,
    full_file_content: str | None,
    char_limit: int = 30000,
) -> str:
    parts = [
        f"# 文件: {file.filename}",
        f"状态: {file.status}, +{file.additions}/-{file.deletions}",
    ]
    if file.patch:
        patch = file.patch
        if len(patch) > char_limit:
            patch = patch[:char_limit] + "\n...(patch 已截断)"
        parts.append("\n## 该文件的 diff\n```diff\n" + patch + "\n```")
    if full_file_content:
        full = full_file_content
        if len(full) > char_limit:
            full = full[:char_limit] + "\n...(文件内容已截断)"
        parts.append("\n## 该文件的完整内容(变更后)\n```\n" + full + "\n```")
    parts.append("\n请基于上下文产出严格 JSON 评审。")
    return "\n".join(parts)


async def _triage(
    bundle: PRBundle,
    llm: LLMClient,
    *,
    fast_model: str,
    fallback_model: str,
) -> dict:
    resp = await llm.chat_json(
        models=[fast_model, fallback_model],
        system=TRIAGE_SYSTEM,
        user=_triage_user_prompt(bundle),
        max_tokens=2048,
        temperature=0.2,
    )
    return extract_json(resp.content)


async def _deep_review_one(
    file: PRFile,
    full_content: str | None,
    llm: LLMClient,
    *,
    primary_model: str,
    fallback_model: str,
) -> dict:
    resp = await llm.chat_json(
        models=[primary_model, fallback_model],
        system=DEEP_REVIEW_SYSTEM,
        user=_deep_review_user_prompt(file, full_content),
        max_tokens=2048,
        temperature=0.2,
    )
    return extract_json(resp.content)


_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


async def review_pr_layered(
    bundle: PRBundle,
    *,
    ref: PRRef,
    llm: LLMClient | None = None,
    gh: GitHubClient | None = None,
    primary_model: str | None = None,
    fast_model: str | None = None,
    deep_concurrency: int = 3,
    max_deep_files: int = 8,
) -> ReviewReport:
    """三层评审。返回的 ReviewReport.model 字段记录主模型名。"""
    s = get_settings()
    pm = primary_model or s.primary_model
    fm = fast_model or s.fast_model
    fb = s.fallback_model
    client = llm or LLMClient()

    t0 = time.time()

    # 第一层:粗筛
    triage = await _triage(bundle, client, fast_model=fm, fallback_model=fb)
    summary = triage.get("summary", "")
    highlights = triage.get("highlights", []) or []
    file_attentions: dict[str, str] = {
        item.get("filename", ""): item.get("attention", "normal")
        for item in (triage.get("files") or [])
    }

    # 选出 deep 文件,按 attention/changes 排序,限上限
    deep_files = [f for f in bundle.files if file_attentions.get(f.filename, "normal") == "deep"]
    deep_files = sorted(deep_files, key=lambda f: -f.changes)[:max_deep_files]
    logger.info(
        "triage selected %d deep files out of %d total",
        len(deep_files),
        len(bundle.files),
    )

    # 第二层:并发深审
    sem = asyncio.Semaphore(deep_concurrency)

    async def review_one(f: PRFile) -> dict:
        async with sem:
            full_content: str | None = None
            if gh is not None:
                try:
                    full_content = await gh.fetch_file_at_ref(
                        ref, f.filename, bundle.metadata.head_sha
                    )
                except Exception:
                    full_content = None
            try:
                return await _deep_review_one(
                    f, full_content, client, primary_model=pm, fallback_model=fb
                )
            except Exception as e:
                logger.warning("deep review failed for %s: %s", f.filename, e)
                return {"risks": [], "suggestions": []}

    deep_results = await asyncio.gather(*(review_one(f) for f in deep_files))

    # 第三层:聚合
    risks: list[RiskItem] = []
    suggestions: list[Suggestion] = []
    for res in deep_results:
        for r in res.get("risks", []) or []:
            try:
                risks.append(RiskItem(**r))
            except Exception as e:
                logger.warning("skip malformed risk: %s", e)
        for sg in res.get("suggestions", []) or []:
            try:
                suggestions.append(Suggestion(**sg))
            except Exception as e:
                logger.warning("skip malformed suggestion: %s", e)

    risks.sort(key=lambda x: (_SEVERITY_RANK.get(x.severity, 99), x.file))

    return ReviewReport(
        summary=summary,
        highlights=highlights,
        risks=risks,
        suggestions=suggestions,
        model=pm,
        elapsed_ms=int((time.time() - t0) * 1000),
    )
