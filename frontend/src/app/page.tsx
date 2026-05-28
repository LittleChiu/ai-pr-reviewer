"use client";

import { useState } from "react";
import type { Confidence, ReviewReport, Severity } from "@/lib/types";
import { ApiCallError, reviewPR } from "@/lib/api";
import { HealthBadge } from "@/components/HealthBadge";

const SEVERITY_STYLES: Record<Severity, string> = {
  high: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  medium:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  low: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/40 dark:text-slate-400 dark:border-slate-800",
};

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: "text-emerald-600 dark:text-emerald-400",
  medium: "text-zinc-500 dark:text-zinc-400",
  low: "text-zinc-400 dark:text-zinc-500",
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const r = await reviewPR(url.trim());
      setReport(r);
    } catch (err) {
      if (err instanceof ApiCallError) {
        setError(err.detail);
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-12">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🤖</div>
              <h1 className="text-2xl font-semibold tracking-tight">
                AI PR Review
              </h1>
            </div>
            <HealthBadge />
          </div>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            粘贴 GitHub PR 链接,几秒钟拿到一份带置信度的智能评审报告。
          </p>
        </header>

        <form onSubmit={onSubmit} className="mb-8">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              required
              disabled={loading}
              className="flex-1 px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="px-6 py-3 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? "分析中..." : "开始评审"}
            </button>
          </div>
        </form>

        {error && (
          <div className="mb-8 p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
            <strong>评审失败:</strong> {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
            <div className="h-4 w-4 rounded-full border-2 border-zinc-300 border-t-transparent animate-spin" />
            正在拉取 PR 数据并调用 LLM,首轮通常需要 20-60 秒...
          </div>
        )}

        {report && <ReportView report={report} />}

        {!loading && !report && !error && <EmptyState />}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: ReviewReport }) {
  return (
    <div className="space-y-8">
      <Section title="📋 PR 总览">
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
          {report.summary}
        </p>
        <div className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          模型: <code>{report.model}</code> · 耗时 {report.elapsed_ms} ms
        </div>
      </Section>

      {report.highlights.length > 0 && (
        <Section title="✨ 亮点">
          <ul className="space-y-2 text-sm">
            {report.highlights.map((h, i) => (
              <li key={i} className="flex gap-2 text-zinc-700 dark:text-zinc-300">
                <span className="text-emerald-500">▸</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.risks.length > 0 && (
        <Section title={`⚠️  风险 (${report.risks.length})`}>
          <div className="space-y-3">
            {report.risks.map((r, i) => (
              <div
                key={i}
                className={`rounded-lg border p-4 ${SEVERITY_STYLES[r.severity]}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono uppercase">
                      {r.severity}
                    </span>
                    <span className="text-xs opacity-60">·</span>
                    <span className="text-xs opacity-60">{r.category}</span>
                    <span className="text-xs opacity-60">·</span>
                    <code className="text-xs">{r.file}</code>
                    {r.line_hint && (
                      <>
                        <span className="text-xs opacity-60">·</span>
                        <code className="text-xs">L{r.line_hint}</code>
                      </>
                    )}
                  </div>
                  <span
                    className={`text-xs ${CONFIDENCE_STYLES[r.confidence]}`}
                  >
                    {r.confidence} confidence
                  </span>
                </div>
                <h3 className="font-medium text-sm mb-1">{r.title}</h3>
                <p className="text-sm opacity-80 whitespace-pre-wrap">
                  {r.detail}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.suggestions.length > 0 && (
        <Section title={`💡 建议 (${report.suggestions.length})`}>
          <div className="space-y-3">
            {report.suggestions.map((s, i) => (
              <div
                key={i}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-500 dark:text-zinc-400">
                    <code>{s.file}</code>
                    {s.line_hint && (
                      <>
                        <span>·</span>
                        <code>L{s.line_hint}</code>
                      </>
                    )}
                  </div>
                  <span
                    className={`text-xs ${CONFIDENCE_STYLES[s.confidence]}`}
                  >
                    {s.confidence}
                  </span>
                </div>
                <h3 className="font-medium text-sm mb-1">{s.title}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                  {s.detail}
                </p>
                {s.code_hint && (
                  <pre className="mt-2 p-3 rounded bg-zinc-50 dark:bg-zinc-950 text-xs overflow-x-auto">
                    <code>{s.code_hint}</code>
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-3 text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-12 text-center">
      <div className="text-4xl mb-3">📄</div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        粘贴一个 GitHub PR 链接开始评审
      </p>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
        支持公开仓库,例如{" "}
        <code className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900">
          https://github.com/openai/openai-python/pull/1234
        </code>
      </p>
    </div>
  );
}
