import type { ReviewReport, RiskItem, Suggestion } from "./types";

/** 把 ReviewReport 渲染为可粘贴到 GitHub PR 评论 / Slack / 文档的 Markdown。 */
export function reportToMarkdown(r: ReviewReport, prUrl?: string): string {
  const lines: string[] = [];
  lines.push("# AI Code Review");
  if (prUrl) lines.push(`> ${prUrl}`);
  lines.push("");
  lines.push(`*Model: \`${r.model}\` · Time: ${(r.elapsed_ms / 1000).toFixed(1)}s · ${r.token_usage.llm_calls} LLM calls · ${r.token_usage.total_tokens.toLocaleString()} tokens*`);
  lines.push("");

  if (r.summary) {
    lines.push("## Summary");
    lines.push("");
    lines.push(r.summary);
    lines.push("");
  }

  if (r.highlights?.length) {
    lines.push("## Highlights");
    lines.push("");
    for (const h of r.highlights) lines.push(`- ${h}`);
    lines.push("");
  }

  if (r.risks?.length) {
    lines.push(`## Risks (${r.risks.length})`);
    lines.push("");
    for (const x of r.risks) lines.push(...renderRisk(x));
  }

  if (r.suggestions?.length) {
    lines.push(`## Suggestions (${r.suggestions.length})`);
    lines.push("");
    for (const x of r.suggestions) lines.push(...renderSuggestion(x));
  }

  return lines.join("\n");
}

function renderRisk(r: RiskItem): string[] {
  const loc = r.line_hint ? `\`${r.file}\` L${r.line_hint}` : `\`${r.file}\``;
  return [
    `### [${r.severity.toUpperCase()}/${r.category}] ${loc} — *${r.confidence} confidence*`,
    "",
    `**${r.title}**`,
    "",
    r.detail,
    "",
  ];
}

function renderSuggestion(s: Suggestion): string[] {
  const loc = s.line_hint ? `\`${s.file}\` L${s.line_hint}` : `\`${s.file}\``;
  const out = [
    `### ${loc} — *${s.confidence} confidence*`,
    "",
    `**${s.title}**`,
    "",
    s.detail,
    "",
  ];
  if (s.code_hint) {
    out.push("```");
    out.push(s.code_hint);
    out.push("```");
    out.push("");
  }
  return out;
}
