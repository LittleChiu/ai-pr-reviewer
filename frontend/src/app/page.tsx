"use client";

import { useRef, useState } from "react";
import type { Confidence, ReviewReport, RiskItem, Severity, Suggestion } from "@/lib/types";
import { ApiCallError, reviewPRStream, type StreamEvent } from "@/lib/api";
import { HealthBadge } from "@/components/HealthBadge";
import { useRecentUrls } from "@/lib/useRecentUrls";
import { reportToMarkdown } from "@/lib/markdown";

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
}

const initState: StreamState = {
  startedAt: null,
  prInfo: null,
  summary: "",
  highlights: [],
  files: new Map(),
  finalReport: null,
  errorMsg: null,
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
        setError(err.detail);
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
            粘贴 GitHub PR 链接,基于三层 prompt 流式返回带置信度的智能评审报告。
          </p>
        </header>

        <form onSubmit={onSubmit} className="mb-8">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="url"
              list="recent-urls"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              required
              disabled={loading}
              className="flex-1 px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            {recent.length > 0 && (
              <datalist id="recent-urls">
                {recent.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            )}
            {loading ? (
              <button
                type="button"
                onClick={onCancel}
                className="px-6 py-3 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/40 transition"
              >
                取消
              </button>
            ) : (
              <button
                type="submit"
                disabled={!url.trim()}
                className="px-6 py-3 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                开始评审
              </button>
            )}
          </div>
        </form>

        {error && (
          <div className="mb-8 p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
            <strong>评审失败:</strong> {error}
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
    <div className="space-y-8">
      {state.prInfo && (
        <div className="text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap gap-3 items-center">
          <code className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900">
            {state.prInfo.pr}
          </code>
          <span>·</span>
          <span>{state.prInfo.title}</span>
          <span>·</span>
          <code>{state.prInfo.model}</code>
        </div>
      )}

      {state.summary && (
        <Section title="📋 PR 总览">
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
            {state.summary}
          </p>
        </Section>
      )}

      {state.highlights.length > 0 && (
        <Section title="✨ 亮点">
          <ul className="space-y-2 text-sm">
            {state.highlights.map((h, i) => (
              <li key={i} className="flex gap-2 text-zinc-700 dark:text-zinc-300">
                <span className="text-emerald-500">▸</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {totalCount > 0 && (
        <Section
          title={`🔍 文件深审 (${doneCount}/${totalCount})`}
        >
          <div className="space-y-2">
            {filesArr.map((f) => (
              <FileProgressItem key={f.file} f={f} />
            ))}
          </div>
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
        <div className="pt-4 space-y-3">
          <div className="flex items-center justify-center">
            <CopyMarkdownButton report={state.finalReport} prUrl={prUrl} />
          </div>
          <div className="text-xs text-zinc-400 dark:text-zinc-500 text-center space-y-1">
            <div>✓ 完成 · 总计耗时 {state.finalReport.elapsed_ms} ms</div>
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
        <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <div className="h-4 w-4 rounded-full border-2 border-zinc-300 border-t-transparent animate-spin" />
          流式处理中...
        </div>
      )}
    </div>
  );
}

function FileProgressItem({ f }: { f: FileProgress }) {
  const dot =
    f.status === "running"
      ? "bg-blue-500 animate-pulse"
      : f.status === "done"
        ? "bg-emerald-500"
        : f.status === "error"
          ? "bg-red-500"
          : "bg-zinc-300 dark:bg-zinc-700";
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <code className="text-zinc-600 dark:text-zinc-400">{f.file}</code>
      {f.status === "done" && (f.risks.length > 0 || f.suggestions.length > 0) && (
        <span className="text-zinc-400">
          · {f.risks.length} risks · {f.suggestions.length} suggestions
        </span>
      )}
      {f.status === "error" && (
        <span className="text-red-400">· {f.error ?? "失败"}</span>
      )}
    </div>
  );
}

function RiskCard({ r }: { r: RiskItem }) {
  return (
    <div className={`rounded-lg border p-4 ${SEVERITY_STYLES[r.severity]}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono uppercase">{r.severity}</span>
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
        <span className={`text-xs ${CONFIDENCE_STYLES[r.confidence]}`}>
          {r.confidence} confidence
        </span>
      </div>
      <h3 className="font-medium text-sm mb-1">{r.title}</h3>
      <p className="text-sm opacity-80 whitespace-pre-wrap">{r.detail}</p>
    </div>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
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
        <span className={`text-xs ${CONFIDENCE_STYLES[s.confidence]}`}>
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
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
      className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition flex items-center gap-2"
    >
      <span>{copied ? "✓ 已复制" : "📋 复制为 Markdown"}</span>
    </button>
  );
}
