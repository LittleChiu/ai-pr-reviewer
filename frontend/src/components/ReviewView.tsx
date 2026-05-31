"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { Confidence, ReviewReport, RiskItem, Severity, Suggestion } from "@/lib/types";
import type { ReviewState } from "@/lib/reviewPage";
import { reportToMarkdown } from "@/lib/markdown";

const SEVERITY_BAR: Record<Severity, string> = {
  high: "bg-[var(--severity-high-bar)]",
  medium: "bg-[var(--severity-medium-bar)]",
  low: "bg-[var(--severity-low-bar)]",
};

const SEVERITY_TINT: Record<Severity, string> = {
  high: "bg-[var(--severity-high-bg)] text-[var(--severity-high-fg)]",
  medium: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium-fg)]",
  low: "bg-[var(--severity-low-bg)] text-[var(--severity-low-fg)]",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险",
};

const CONFIDENCE_DOT: Record<Confidence, string> = {
  high: "bg-emerald-500",
  medium: "bg-zinc-400",
  low: "bg-zinc-300 dark:bg-zinc-600",
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "高置信度",
  medium: "中置信度",
  low: "低置信度",
};

export function ReviewView({ state, loading, prUrl }: { state: ReviewState; loading: boolean; prUrl: string }) {
  if (!state.startedAt) {
    return <EmptyState />;
  }

  const report = state.report;
  const risks = report?.risks ?? [];
  const suggestions = report?.suggestions ?? [];

  return (
    <div className="space-y-6">
      <ReviewHeader state={state} loading={loading} risks={risks.length} suggestions={suggestions.length} />

      {state.errorMsg && <InlineError title="评审失败" message={state.errorMsg} />}

      {loading && !report && (
        <Card className="p-5 text-center md:p-6">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          <div className="text-sm font-semibold">正在分析 PR</div>
          <p className="mt-2 text-xs leading-5 text-[var(--muted-fg)]">
            正在获取 PR 信息、变更文件和相关上下文。分析完成后会显示完整报告。
          </p>
        </Card>
      )}

      {report?.summary && (
        <Section title="PR 总览" eyebrow="Summary">
          <Card className="p-5 md:p-6">
            <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]">{report.summary}</p>
          </Card>
        </Section>
      )}

      {report && report.highlights.length > 0 && (
        <Section title="亮点" eyebrow="Highlights">
          <Card className="p-5">
            <ul className="grid gap-2 text-sm md:grid-cols-2">
              {report.highlights.map((h, i) => (
                <li key={i} className="flex gap-2.5 rounded-xl bg-emerald-500/5 px-3 py-2">
                  <span className="mt-0.5 text-emerald-500">✓</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {risks.length > 0 && (
        <Section title={`风险 (${risks.length})`} eyebrow="Risks">
          <div className="space-y-3">
            {risks.map((risk, i) => (
              <RiskCard key={`${risk.file}-${risk.line_hint ?? ""}-${i}`} risk={risk} />
            ))}
          </div>
        </Section>
      )}

      {suggestions.length > 0 && (
        <Section title={`建议 (${suggestions.length})`} eyebrow="Suggestions">
          <div className="space-y-3">
            {suggestions.map((suggestion, i) => (
              <SuggestionCard
                key={`${suggestion.file}-${suggestion.line_hint ?? ""}-${i}`}
                suggestion={suggestion}
              />
            ))}
          </div>
        </Section>
      )}

      {report && risks.length === 0 && suggestions.length === 0 && <NoIssueCard />}

      {report && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-center">
            <CopyMarkdownButton report={report} prUrl={prUrl} />
          </div>
          <div className="space-y-1 text-center text-xs text-[var(--muted-fg)]">
            <div>完成 · 总计耗时 {(report.elapsed_ms / 1000).toFixed(1)} s</div>
            <div>
              {report.token_usage.llm_calls} 次 LLM 调用 · {report.token_usage.prompt_tokens.toLocaleString()} prompt + {report.token_usage.completion_tokens.toLocaleString()} completion = {report.token_usage.total_tokens.toLocaleString()} tokens
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewHeader({ state, loading, risks, suggestions }: { state: ReviewState; loading: boolean; risks: number; suggestions: number }) {
  const report = state.report;
  const progress = report ? 100 : loading ? 56 : state.errorMsg ? 100 : 0;
  const phase = report ? "评审完成" : loading ? "分析中" : state.errorMsg ? "评审中断" : "准备中";

  return (
    <Card className="overflow-hidden p-0 shadow-[var(--shadow-md)]">
      <div className="border-b border-[var(--border)] bg-[var(--muted)]/45 px-5 py-4 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-fg)]">
              <code className="rounded-full bg-[var(--card)] px-2.5 py-1 text-[var(--foreground)] shadow-[var(--shadow-sm)]">{state.prLabel}</code>
            </div>
            <h2 className="truncate text-base font-semibold md:text-lg">{phase}</h2>
          </div>
          <code className="shrink-0 rounded-full bg-[var(--primary-soft)] px-3 py-1.5 text-xs text-[var(--primary-hover)]">
            {report?.model || "layered"}
          </code>
        </div>
      </div>
      <div className="p-5 md:p-6">
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="风险" value={risks.toLocaleString()} tone={risks > 0 ? "danger" : "neutral"} />
          <MetricCard label="建议" value={suggestions.toLocaleString()} />
          <MetricCard label="LLM 调用" value={report ? report.token_usage.llm_calls.toLocaleString() : "--"} />
          <MetricCard label="耗时" value={report ? `${(report.elapsed_ms / 1000).toFixed(1)}s` : "分析中"} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted-fg)]">
          <span>{phase}</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </Card>
  );
}

function MetricCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/35 p-3">
      <div className="text-xs text-[var(--muted-fg)]">{label}</div>
      <div className={`mt-1 text-lg font-semibold tracking-tight ${tone === "danger" ? "text-[var(--severity-high-fg)]" : "text-[var(--foreground)]"}`}>{value}</div>
    </div>
  );
}

function RiskCard({ risk }: { risk: RiskItem }) {
  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
      <div className="flex">
        <div className={`w-1 shrink-0 ${SEVERITY_BAR[risk.severity]}`} />
        <div className="min-w-0 flex-1 p-4 md:p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2.5 py-1 font-mono font-semibold uppercase ${SEVERITY_TINT[risk.severity]}`}>{SEVERITY_LABEL[risk.severity]}</span>
              <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-[var(--muted-fg)]">{risk.category}</span>
              <code className="text-[var(--muted-fg)]">{risk.file}</code>
              {risk.line_hint && <code className="text-[var(--muted-fg)]">L{risk.line_hint}</code>}
            </div>
            <ConfidencePill confidence={risk.confidence} />
          </div>
          <h3 className="mb-2 text-sm font-semibold">{risk.title}</h3>
          <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--muted-fg)]">{risk.detail}</p>
        </div>
      </div>
    </Card>
  );
}

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  return (
    <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] md:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted-fg)]">
          <span className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 font-medium text-[var(--primary-hover)]">建议</span>
          <code className="truncate">{suggestion.file}</code>
          {suggestion.line_hint && <code>L{suggestion.line_hint}</code>}
        </div>
        <ConfidencePill confidence={suggestion.confidence} />
      </div>
      <h3 className="mb-2 text-sm font-semibold">{suggestion.title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--muted-fg)]">{suggestion.detail}</p>
      {suggestion.code_hint && (
        <pre className="mt-3 overflow-x-auto rounded-xl bg-[var(--muted)] p-3 text-xs leading-6">
          <code>{suggestion.code_hint}</code>
        </pre>
      )}
    </Card>
  );
}

function ConfidencePill({ confidence }: { confidence: Confidence }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-fg)]">
      <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[confidence]}`} />
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

function Section({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">{eyebrow}</div>
        <h2 className="mt-1 text-base font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)] backdrop-blur ${className}`}>{children}</div>;
}

function EmptyState() {
  return (
    <Card className="p-6 md:p-8">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-2xl">📄</div>
        <h2 className="text-lg font-semibold tracking-tight">输入 PR 链接开始评审</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-fg)]">
          系统会返回 PR 总览、潜在风险和修改建议。AI 评审结果仅作为辅助判断，最终仍应由 reviewer 结合项目上下文确认。
        </p>
      </div>
    </Card>
  );
}

function NoIssueCard() {
  return (
    <Card className="border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
      <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">未发现需要重点处理的风险</div>
      <p className="mt-1 text-xs text-[var(--muted-fg)]">这不代表代码绝对无误，请结合测试、业务上下文和人工 review 继续判断。</p>
    </Card>
  );
}

function CopyMarkdownButton({ report, prUrl }: { report: ReviewReport; prUrl: string }) {
  const [copied, setCopied] = useState(false);


  async function onCopy() {
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report, prUrl));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return <button type="button" onClick={onCopy} className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-xs font-semibold shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">{copied ? "✓ 已复制" : "复制为 Markdown"}</button>;
}

function InlineError({ title, message, className = "" }: { title: string; message: string; className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-[var(--radius)] border border-[var(--severity-high-bar)]/20 bg-[var(--severity-high-bg)] p-4 text-sm text-[var(--severity-high-fg)] ${className}`}>
      <span className="mt-0.5">⚠️</span>
      <div><strong>{title}</strong><div className="mt-1 opacity-90">{message}</div></div>
    </div>
  );
}

export function DecorativeBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-amber-300/20 blur-3xl" />
      <div className="absolute right-[-10%] top-32 h-80 w-80 rounded-full bg-pink-300/20 blur-3xl" />
      <div className="absolute bottom-0 left-[-10%] h-96 w-96 rounded-full bg-emerald-300/15 blur-3xl" />
    </div>
  );
}
