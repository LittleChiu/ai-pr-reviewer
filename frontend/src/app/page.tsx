"use client";

import { useRef, useState } from "react";
import type { Confidence, ReviewReport, RiskItem, Severity, Suggestion } from "@/lib/types";
import { ApiCallError, submitReview, getReview } from "@/lib/api";
import { HealthBadge } from "@/components/HealthBadge";
import { useRecentUrls } from "@/lib/useRecentUrls";
import { reportToMarkdown } from "@/lib/markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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

const CONFIDENCE_DOT: Record<Confidence, string> = {
  high: "bg-emerald-500",
  medium: "bg-zinc-400",
  low: "bg-zinc-300 dark:bg-zinc-600",
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { recent, push: pushRecent } = useRecentUrls();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;
    const trimmed = url.trim();
    setLoading(true);
    setError(null);
    setReport(null);
    setElapsed(0);
    pushRecent(trimmed);

    try {
      // 1. 提交任务,拿 task_id
      const taskId = await submitReview(trimmed);
      // 2. 轮询查结果
      const started = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const resp = await getReview(taskId);
        if (resp.status === "done" && resp.result) {
          setReport(resp.result);
          break;
        } else if (resp.status === "error") {
          setError(resp.error ?? "任务执行失败");
          break;
        }
        // else: still processing, poll again
      }
    } catch (err) {
      if (err instanceof ApiCallError) {
        setError(`${err.userMessage}\n\n[${err.status}] ${err.detail}`);
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      setLoading(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

  const onCancel = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setLoading(false);
    setError("已取消");
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">
        <header className="mb-10">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-pink-500 flex items-center justify-center text-white text-lg shadow-md">🤖</div>
              <div>
                <h1 className="text-xl md:text-2xl font-semibold tracking-tight">AI PR Review</h1>
                <p className="text-xs text-[var(--muted-fg)] mt-0.5">Smart code review · Async task · Confidence-aware</p>
              </div>
            </div>
            <HealthBadge />
          </div>
        </header>

        <Card className="p-2 mb-8">
          <form onSubmit={onSubmit}>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">🔗</span>
                <Input type="url" list="recent-urls" value={url} onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo/pull/123" required disabled={loading}
                  className="pl-10 border-0 shadow-none bg-transparent focus-visible:ring-0" />
                {recent.length > 0 && (<datalist id="recent-urls">{recent.map((u) => (<option key={u} value={u} />))}</datalist>)}
              </div>
              {loading ? (
                <Button type="button" variant="outline" onClick={onCancel}
                  className="text-destructive hover:bg-destructive/10">取消</Button>
              ) : (
                <Button type="submit" disabled={!url.trim()}>开始评审</Button>
              )}
            </div>
          </form>
        </Card>

        {error && (
          <div className="mb-8 p-4 rounded-[var(--radius)] bg-[var(--severity-high-bg)] text-[var(--severity-high-fg)] text-sm flex items-start gap-3 whitespace-pre-wrap">
            <span>⚠️</span>
            <div><strong>评审失败</strong><div className="mt-1 opacity-90">{error}</div></div>
          </div>
        )}

        {!loading && !report && !error && <EmptyState />}

        {loading && !report && (
          <Card className="p-8 text-center">
            <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              评审中... 已等待 {elapsed} 秒
            </div>
          </Card>
        )}

        {report && <ReportView report={report} />}

        {report && (
          <div className="pt-4 space-y-3">
            <div className="flex items-center justify-center">
              <CopyMarkdownButton report={report} prUrl={url} />
            </div>
            <div className="text-xs text-[var(--muted-fg)] text-center space-y-1">
              <div>✓ 完成 · 总计耗时 {(report.elapsed_ms / 1000).toFixed(1)} s</div>
              {report.token_usage && (
                <div>
                  {report.token_usage.llm_calls} 次 LLM 调用 ·{" "}
                  {report.token_usage.prompt_tokens.toLocaleString()} prompt +{" "}
                  {report.token_usage.completion_tokens.toLocaleString()} completion ={" "}
                  {report.token_usage.total_tokens.toLocaleString()} tokens
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: ReviewReport }) {
  const allRisks = report.risks ?? [];
  const allSuggestions = report.suggestions ?? [];
  return (
    <div className="space-y-6">
      {report.summary && (
        <Section title="📋 PR 总览"><Card><CardContent className="pt-0 first:pt-6"><p className="text-sm leading-relaxed whitespace-pre-wrap">{report.summary}</p></CardContent></Card></Section>
      )}
      {report.highlights && report.highlights.length > 0 && (
        <Section title="✨ 亮点"><Card><CardContent className="pt-0 first:pt-6">
          <ul className="space-y-2 text-sm">{report.highlights.map((h, i) => <li key={i} className="flex gap-2.5"><span className="text-emerald-500 mt-0.5">▸</span><span>{h}</span></li>)}</ul>
        </CardContent></Card></Section>
      )}
      {allRisks.length > 0 && (
        <Section title={`⚠️ 风险 (${allRisks.length})`}><div className="space-y-3">{allRisks.map((r, i) => <RiskCard key={i} r={r} />)}</div></Section>
      )}
      {allSuggestions.length > 0 && (
        <Section title={`💡 建议 (${allSuggestions.length})`}><div className="space-y-3">{allSuggestions.map((s, i) => <SuggestionCard key={i} s={s} />)}</div></Section>
      )}
    </div>
  );
}

function RiskCard({ r }: { r: RiskItem }) {
  return (
    <Card className="overflow-hidden p-0"><div className="flex"><div className={`w-1 shrink-0 ${SEVERITY_BAR[r.severity]}`} /><div className="flex-1 p-4 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className={`px-2 py-0.5 rounded-md font-mono uppercase font-medium ${SEVERITY_TINT[r.severity]}`}>{r.severity}</span>
          <span className="text-[var(--muted-fg)]">{r.category}</span>
          <code className="text-[var(--muted-fg)]">{r.file}</code>
          {r.line_hint && <code className="text-[var(--muted-fg)]">L{r.line_hint}</code>}
        </div>
        <ConfidencePill c={r.confidence} />
      </div>
      <h3 className="font-medium text-sm mb-1.5">{r.title}</h3>
      <p className="text-sm text-[var(--muted-fg)] whitespace-pre-wrap leading-relaxed">{r.detail}</p>
    </div></div></Card>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--muted-fg)]"><code>{s.file}</code>{s.line_hint && <code>L{s.line_hint}</code>}</div>
        <ConfidencePill c={s.confidence} />
      </div>
      <h3 className="font-medium text-sm mb-1.5">{s.title}</h3>
      <p className="text-sm text-[var(--muted-fg)] whitespace-pre-wrap leading-relaxed">{s.detail}</p>
      {s.code_hint && (<pre className="mt-3 p-3 rounded-md bg-[var(--muted)] text-xs overflow-x-auto"><code>{s.code_hint}</code></pre>)}
    </Card>
  );
}

function ConfidencePill({ c }: { c: Confidence }) {
  return (<span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-fg)]"><span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[c]}`} />{c} confidence</span>);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (<section><h2 className="text-sm font-semibold mb-3 px-1">{title}</h2>{children}</section>);
}

function EmptyState() {
  return (
    <Card className="p-12 text-center">
      <div className="text-4xl mb-3">📄</div>
      <p className="text-sm text-[var(--foreground)]">粘贴一个 GitHub PR 链接开始评审</p>
      <p className="text-xs text-[var(--muted-fg)] mt-2">支持公开仓库,例如 <code className="px-1.5 py-0.5 rounded bg-[var(--muted)]">https://github.com/openai/openai-python/pull/1234</code></p>
    </Card>
  );
}

function CopyMarkdownButton({ report, prUrl }: { report: ReviewReport; prUrl: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(reportToMarkdown(report, prUrl)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (<button type="button" onClick={onCopy} className="px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--card)] backdrop-blur text-xs hover:bg-[var(--muted)] transition flex items-center gap-2 shadow-[var(--shadow-sm)]"><span>{copied ? "✓ 已复制" : "📋 复制为 Markdown"}</span></button>);
}
