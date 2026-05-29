"use client";

import { useRef, useState } from "react";
import type { Confidence, ReviewReport, RiskItem, Severity, Suggestion } from "@/lib/types";
import { ApiCallError, reviewPRStream, type StreamEvent } from "@/lib/api";
import { HealthBadge } from "@/components/HealthBadge";
import { useRecentUrls } from "@/lib/useRecentUrls";
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

const CONFIDENCE_DOT: Record<Confidence, string> = {
  high: "bg-emerald-500",
  medium: "bg-zinc-400",
  low: "bg-zinc-300 dark:bg-zinc-600",
};

type FileStatus = "pending" | "running" | "done" | "error";

interface FileProgress {
  file: string;
  status: FileStatus;
  risks: RiskItem[];
  suggestions: Suggestion[];
  error?: string;
}

interface StreamState {
  startedAt: number | null;
  prInfo: { pr: string; title: string; model: string } | null;
  summary: string;
  highlights: string[];
  files: Map<string, FileProgress>;
  finalReport: ReviewReport | null;
  errorMsg: string | null;
  visionAnalyzed: number;
}

const initState: StreamState = {
  startedAt: null,
  prInfo: null,
  summary: "",
  highlights: [],
  files: new Map(),
  finalReport: null,
  errorMsg: null,
  visionAnalyzed: 0,
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<StreamState>(initState);
  const [error, setError] = useState<string | null>(null);
  const { recent, push: pushRecent } = useRecentUrls();
  const abortRef = useRef<AbortController | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;
    const trimmed = url.trim();
    setLoading(true);
    setError(null);
    setState({ ...initState, startedAt: Date.now(), files: new Map() });
    pushRecent(trimmed);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await reviewPRStream(
        trimmed,
        (ev: StreamEvent) => {
          setState((s) => applyEvent(s, ev));
        },
        { signal: ctrl.signal },
      );
    } catch (err) {
      if (ctrl.signal.aborted) {
        setError("已取消");
      } else if (err instanceof ApiCallError) {
        setError(err.userMessage);
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const onCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">
        <header className="mb-10">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-pink-500 flex items-center justify-center text-white text-lg shadow-md">
                🤖
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                  AI PR Review
                </h1>
                <p className="text-xs text-[var(--muted-fg)] mt-0.5">
                  Smart code review · Streaming · Confidence-aware
                </p>
              </div>
            </div>
            <HealthBadge />
          </div>
        </header>

        <Card className="p-2 mb-8">
          <form onSubmit={onSubmit}>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-fg)] text-sm pointer-events-none">
                  🔗
                </span>
                <input
                  type="url"
                  list="recent-urls"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo/pull/123"
                  required
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-3 rounded-[var(--radius-sm)] bg-transparent text-sm focus:outline-none disabled:opacity-50"
                />
                {recent.length > 0 && (
                  <datalist id="recent-urls">
                    {recent.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                )}
              </div>
              {loading ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-5 py-3 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--severity-high-fg)] text-sm font-medium hover:bg-[var(--severity-high-bg)] transition"
                >
                  取消
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!url.trim()}
                  className="px-5 py-3 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-medium shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  开始评审
                </button>
              )}
            </div>
          </form>
        </Card>

        {error && (
          <div className="mb-8 p-4 rounded-[var(--radius)] bg-[var(--severity-high-bg)] text-[var(--severity-high-fg)] text-sm flex items-start gap-3">
            <span>⚠️</span>
            <div>
              <strong>评审失败</strong>
              <div className="mt-1 opacity-90">{error}</div>
            </div>
          </div>
        )}

        {!loading && !state.startedAt && !error && <EmptyState />}

        {state.startedAt && <StreamView state={state} loading={loading} prUrl={url} />}
      </div>
    </div>
  );
}

function applyEvent(s: StreamState, ev: StreamEvent): StreamState {
  switch (ev.type) {
    case "started":
      return {
        ...s,
        prInfo: { pr: ev.data.pr, title: ev.data.title, model: ev.data.model },
      };
    case "triage": {
      const files = new Map(s.files);
      for (const f of ev.data.deep_files) {
        files.set(f, { file: f, status: "pending", risks: [], suggestions: [] });
      }
      return {
        ...s,
        summary: ev.data.summary,
        highlights: ev.data.highlights,
        files,
        visionAnalyzed: ev.data.vision_analyzed ?? 0,
      };
    }
    case "file_started": {
      const files = new Map(s.files);
      const cur = files.get(ev.data.file) ?? {
        file: ev.data.file,
        status: "pending" as FileStatus,
        risks: [],
        suggestions: [],
      };
      files.set(ev.data.file, { ...cur, status: "running" });
      return { ...s, files };
    }
    case "file_done": {
      const files = new Map(s.files);
      const cur = files.get(ev.data.file) ?? {
        file: ev.data.file,
        status: "done" as FileStatus,
        risks: [],
        suggestions: [],
      };
      files.set(ev.data.file, {
        ...cur,
        status: ev.data.error ? "error" : "done",
        risks: ev.data.risks,
        suggestions: ev.data.suggestions,
        error: ev.data.error,
      });
      return { ...s, files };
    }
    case "done":
      return { ...s, finalReport: ev.data };
    case "error":
      return { ...s, errorMsg: ev.data.message };
    default:
      return s;
  }
}

function StreamView({
  state,
  loading,
  prUrl,
}: {
  state: StreamState;
  loading: boolean;
  prUrl: string;
}) {
  const filesArr = Array.from(state.files.values());
  const allRisks = filesArr.flatMap((f) => f.risks);
  const allSuggestions = filesArr.flatMap((f) => f.suggestions);
  const totalCount = filesArr.length;
  const doneCount = filesArr.filter((f) => f.status === "done" || f.status === "error").length;

  return (
    <div className="space-y-6">
      {state.prInfo && (
        <Card className="px-5 py-3">
          <div className="text-xs text-[var(--muted-fg)] flex flex-wrap gap-x-3 gap-y-1 items-center">
            <code className="px-2 py-0.5 rounded-md bg-[var(--muted)] text-[var(--foreground)]">
              {state.prInfo.pr}
            </code>
            <span className="text-[var(--foreground)]">{state.prInfo.title}</span>
            <span>·</span>
            <code className="text-[var(--accent)]">{state.prInfo.model}</code>
            {state.visionAnalyzed > 0 && (
              <>
                <span>·</span>
                <span className="text-[var(--accent)]">🖼️ 已分析 {state.visionAnalyzed} 张截图</span>
              </>
            )}
          </div>
        </Card>
      )}

      {state.summary && (
        <Section title="📋 PR 总览">
          <Card className="p-5">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{state.summary}</p>
          </Card>
        </Section>
      )}

      {state.highlights.length > 0 && (
        <Section title="✨ 亮点">
          <Card className="p-5">
            <ul className="space-y-2 text-sm">
              {state.highlights.map((h, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-emerald-500 mt-0.5">▸</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {totalCount > 0 && (
        <Section title={`🔍 文件深审 (${doneCount}/${totalCount})`}>
          <Card className="p-4">
            <div className="space-y-1.5">
              {filesArr.map((f) => (
                <FileProgressItem key={f.file} f={f} />
              ))}
            </div>
          </Card>
        </Section>
      )}

      {allRisks.length > 0 && (
        <Section title={`⚠️  风险 (${allRisks.length})`}>
          <div className="space-y-3">
            {allRisks.map((r, i) => (
              <RiskCard key={i} r={r} />
            ))}
          </div>
        </Section>
      )}

      {allSuggestions.length > 0 && (
        <Section title={`💡 建议 (${allSuggestions.length})`}>
          <div className="space-y-3">
            {allSuggestions.map((s, i) => (
              <SuggestionCard key={i} s={s} />
            ))}
          </div>
        </Section>
      )}

      {state.finalReport && (
        <div className="pt-2 space-y-3">
          <div className="flex items-center justify-center">
            <CopyMarkdownButton report={state.finalReport} prUrl={prUrl} />
          </div>
          <div className="text-xs text-[var(--muted-fg)] text-center space-y-1">
            <div>✓ 完成 · 总计耗时 {(state.finalReport.elapsed_ms / 1000).toFixed(1)} s</div>
            {state.finalReport.token_usage && (
              <div>
                {state.finalReport.token_usage.llm_calls} 次 LLM 调用 ·{" "}
                {state.finalReport.token_usage.prompt_tokens.toLocaleString()} prompt +{" "}
                {state.finalReport.token_usage.completion_tokens.toLocaleString()} completion ={" "}
                {state.finalReport.token_usage.total_tokens.toLocaleString()} tokens
              </div>
            )}
          </div>
        </div>
      )}

      {loading && !state.finalReport && (
        <div className="flex items-center gap-3 text-sm text-[var(--muted-fg)]">
          <div className="h-3.5 w-3.5 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
          流式处理中...
        </div>
      )}
    </div>
  );
}

function FileProgressItem({ f }: { f: FileProgress }) {
  const dot =
    f.status === "running"
      ? "bg-[var(--primary)] animate-pulse"
      : f.status === "done"
        ? "bg-emerald-500"
        : f.status === "error"
          ? "bg-[var(--severity-high-bar)]"
          : "bg-[var(--muted-fg)] opacity-40";
  return (
    <div className="flex items-center gap-3 text-xs px-2 py-1 rounded-md hover:bg-[var(--muted)]/50">
      <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
      <code className="text-[var(--foreground)] font-mono truncate">{f.file}</code>
      {f.status === "done" && (f.risks.length > 0 || f.suggestions.length > 0) && (
        <span className="text-[var(--muted-fg)] ml-auto">
          {f.risks.length > 0 && (
            <span className="text-[var(--severity-medium-fg)]">{f.risks.length} risks</span>
          )}
          {f.risks.length > 0 && f.suggestions.length > 0 && <span> · </span>}
          {f.suggestions.length > 0 && <span>{f.suggestions.length} sug</span>}
        </span>
      )}
      {f.status === "error" && (
        <span className="text-[var(--severity-high-fg)] ml-auto">{f.error ?? "失败"}</span>
      )}
    </div>
  );
}

function RiskCard({ r }: { r: RiskItem }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${SEVERITY_BAR[r.severity]}`} />
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span
                className={`px-2 py-0.5 rounded-md font-mono uppercase font-medium ${SEVERITY_TINT[r.severity]}`}
              >
                {r.severity}
              </span>
              <span className="text-[var(--muted-fg)]">{r.category}</span>
              <code className="text-[var(--muted-fg)]">{r.file}</code>
              {r.line_hint && (
                <code className="text-[var(--muted-fg)]">L{r.line_hint}</code>
              )}
            </div>
            <ConfidencePill c={r.confidence} />
          </div>
          <h3 className="font-medium text-sm mb-1.5">{r.title}</h3>
          <p className="text-sm text-[var(--muted-fg)] whitespace-pre-wrap leading-relaxed">
            {r.detail}
          </p>
        </div>
      </div>
    </Card>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--muted-fg)]">
          <code>{s.file}</code>
          {s.line_hint && <code>L{s.line_hint}</code>}
        </div>
        <ConfidencePill c={s.confidence} />
      </div>
      <h3 className="font-medium text-sm mb-1.5">{s.title}</h3>
      <p className="text-sm text-[var(--muted-fg)] whitespace-pre-wrap leading-relaxed">
        {s.detail}
      </p>
      {s.code_hint && (
        <pre className="mt-3 p-3 rounded-md bg-[var(--muted)] text-xs overflow-x-auto">
          <code>{s.code_hint}</code>
        </pre>
      )}
    </Card>
  );
}

function ConfidencePill({ c }: { c: Confidence }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-fg)]">
      <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[c]}`} />
      {c} confidence
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-3 px-1">{title}</h2>
      {children}
    </section>
  );
}

function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[var(--radius)] bg-[var(--card)] backdrop-blur border border-[var(--border)] shadow-[var(--shadow-sm)] ${className}`}
    >
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="p-12 text-center">
      <div className="text-4xl mb-3">📄</div>
      <p className="text-sm text-[var(--foreground)]">粘贴一个 GitHub PR 链接开始评审</p>
      <p className="text-xs text-[var(--muted-fg)] mt-2">
        支持公开仓库,例如{" "}
        <code className="px-1.5 py-0.5 rounded bg-[var(--muted)]">
          https://github.com/openai/openai-python/pull/1234
        </code>
      </p>
    </Card>
  );
}

function CopyMarkdownButton({
  report,
  prUrl,
}: {
  report: ReviewReport;
  prUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      const md = reportToMarkdown(report, prUrl);
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className="px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--card)] backdrop-blur text-xs hover:bg-[var(--muted)] transition flex items-center gap-2 shadow-[var(--shadow-sm)]"
    >
      <span>{copied ? "✓ 已复制" : "📋 复制为 Markdown"}</span>
    </button>
  );
}
