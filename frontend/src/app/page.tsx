"use client";

import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Confidence, ReviewReport, RiskItem, Severity, Suggestion } from "@/lib/types";
import { ApiCallError, reviewPRStream, type StreamEvent } from "@/lib/api";
import { HealthBadge } from "@/components/HealthBadge";
import { useRecentUrls } from "@/lib/useRecentUrls";
import { reportToMarkdown } from "@/lib/markdown";

const SAMPLE_PR_URL = "https://github.com/tiangolo/fastapi/pull/15603";

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
  prInfo: {
    pr: string;
    title: string;
    model: string;
    files: number;
    additions: number;
    deletions: number;
    fromCache?: boolean;
  } | null;
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

  async function onSubmit(e: FormEvent) {
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
      await reviewPRStream(trimmed, (ev) => setState((s) => applyEvent(s, ev)), {
        signal: ctrl.signal,
      });
    } catch (err) {
      if (ctrl.signal.aborted) setError("已取消");
      else if (err instanceof ApiCallError) setError(err.userMessage);
      else setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <DecorativeBackground />
      <div className="mx-auto max-w-5xl px-5 py-10 md:px-8 md:py-16">
        <header className="mb-8 md:mb-10">
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--muted-fg)] shadow-[var(--shadow-sm)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
              七牛云 XEngineer · AI PR Review
            </div>
            <HealthBadge />
          </div>
          <div className="grid gap-6 md:grid-cols-[1.45fr_0.85fr] md:items-end">
            <div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] md:text-6xl">
                把 PR 变成一份可执行的评审报告
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-fg)] md:text-base">
                跨文件上下文、三层 Prompt、置信度标注和流式输出，帮 reviewer 快速抓住真正值得看的风险点。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <HeroPill value="3 层" label="粗筛 → 深审 → 聚合" />
              <HeroPill value="SSE" label="实时进度" />
              <HeroPill value="Cache" label="按 commit 复用" />
              <HeroPill value="JSON" label="结构化报告" />
            </div>
          </div>
        </header>

        <Card className="mb-8 p-3 shadow-[var(--shadow-md)] md:p-4">
          <form onSubmit={onSubmit}>
            <div className="mb-3 flex flex-col gap-1 px-1 md:flex-row md:items-end md:justify-between">
              <div>
                <label htmlFor="pr-url" className="text-sm font-semibold tracking-tight">
                  GitHub PR 链接
                </label>
                <p className="mt-1 text-xs text-[var(--muted-fg)]">
                  粘贴公开 PR，系统会先做粗筛，再只深审值得关注的文件。
                </p>
              </div>
              <span className="text-xs text-[var(--muted-fg)]">SSE 流式输出 · 支持缓存</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1 rounded-[var(--radius-sm)] bg-[var(--muted)]/70 ring-1 ring-transparent transition focus-within:bg-[var(--card)] focus-within:ring-[var(--primary)]/40">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-fg)]">
                  🔗
                </span>
                <input
                  id="pr-url"
                  type="url"
                  list="recent-urls"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo/pull/123"
                  required
                  disabled={loading}
                  className="w-full rounded-[var(--radius-sm)] bg-transparent py-3 pl-10 pr-4 text-sm outline-none disabled:opacity-50"
                />
                {recent.length > 0 && (
                  <datalist id="recent-urls">
                    {recent.map((u) => <option key={u} value={u} />)}
                  </datalist>
                )}
              </div>
              {loading ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="rounded-[var(--radius-sm)] border border-[var(--border)] px-5 py-3 text-sm font-medium text-[var(--severity-high-fg)] transition hover:bg-[var(--severity-high-bg)]"
                >
                  取消
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!url.trim()}
                  className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-[var(--primary-fg)] shadow-sm transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  开始评审
                </button>
              )}
            </div>
          </form>
          <div className="mt-3 flex flex-wrap gap-2 px-1">
            {recent.slice(0, 3).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUrl(u)}
                disabled={loading}
                className="max-w-full truncate rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-fg)] transition hover:border-[var(--primary)]/50 hover:text-[var(--foreground)] disabled:opacity-50"
                title={u}
              >
                最近：{u.replace("https://github.com/", "")}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setUrl(SAMPLE_PR_URL)}
              disabled={loading}
              className="rounded-full bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--primary-hover)] transition hover:opacity-80 disabled:opacity-50"
            >
              试试公开样例
            </button>
          </div>
        </Card>

        {error && <InlineError title="评审失败" message={error} className="mb-8" />}
        {!loading && !state.startedAt && !error && (
          <EmptyState onPickSample={() => setUrl(SAMPLE_PR_URL)} />
        )}
        {state.startedAt && <StreamView state={state} loading={loading} prUrl={url} />}
      </div>
    </main>
  );
}

function applyEvent(s: StreamState, ev: StreamEvent): StreamState {
  switch (ev.type) {
    case "started":
      return {
        ...s,
        prInfo: {
          pr: ev.data.pr,
          title: ev.data.title,
          model: ev.data.model,
          files: ev.data.files,
          additions: ev.data.additions,
          deletions: ev.data.deletions,
          fromCache: ev.data.from_cache,
        },
      };
    case "triage": {
      const files = new Map(s.files);
      for (const f of ev.data.deep_files) files.set(f, { file: f, status: "pending", risks: [], suggestions: [] });
      return { ...s, summary: ev.data.summary, highlights: ev.data.highlights, files };
    }
    case "file_started": {
      const files = new Map(s.files);
      const cur = files.get(ev.data.file) ?? { file: ev.data.file, status: "pending" as FileStatus, risks: [], suggestions: [] };
      files.set(ev.data.file, { ...cur, status: "running" });
      return { ...s, files };
    }
    case "file_done": {
      const files = new Map(s.files);
      const cur = files.get(ev.data.file) ?? { file: ev.data.file, status: "done" as FileStatus, risks: [], suggestions: [] };
      files.set(ev.data.file, { ...cur, status: ev.data.error ? "error" : "done", risks: ev.data.risks, suggestions: ev.data.suggestions, error: ev.data.error });
      return { ...s, files };
    }
    case "cached":
    case "done":
      return {
        ...s,
        summary: s.summary || ev.data.summary,
        highlights: s.highlights.length ? s.highlights : ev.data.highlights,
        finalReport: ev.data,
      };
    case "error":
      return { ...s, errorMsg: ev.data.message };
    default:
      return s;
  }
}

function StreamView({ state, loading, prUrl }: { state: StreamState; loading: boolean; prUrl: string }) {
  const filesArr = Array.from(state.files.values());
  const fileRisks = filesArr.flatMap((f) => f.risks);
  const fileSuggestions = filesArr.flatMap((f) => f.suggestions);
  const allRisks = fileRisks.length ? fileRisks : (state.finalReport?.risks ?? []);
  const allSuggestions = fileSuggestions.length ? fileSuggestions : (state.finalReport?.suggestions ?? []);
  const totalCount = filesArr.length;
  const doneCount = filesArr.filter((f) => f.status === "done" || f.status === "error").length;
  const displaySummary = state.summary || state.finalReport?.summary || "";
  const displayHighlights = state.highlights.length ? state.highlights : (state.finalReport?.highlights ?? []);

  return (
    <div className="space-y-6">
      <ReviewHeader state={state} loading={loading} doneCount={doneCount} totalCount={totalCount} risks={allRisks.length} suggestions={allSuggestions.length} />
      {state.errorMsg && <InlineError title="流式评审中断" message={state.errorMsg} />}
      {displaySummary && (
        <Section title="PR 总览" eyebrow="Summary">
          <Card className="p-5 md:p-6">
            <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]">{displaySummary}</p>
          </Card>
        </Section>
      )}
      {displayHighlights.length > 0 && (
        <Section title="亮点" eyebrow="Highlights">
          <Card className="p-5">
            <ul className="grid gap-2 text-sm md:grid-cols-2">
              {displayHighlights.map((h, i) => (
                <li key={i} className="flex gap-2.5 rounded-xl bg-emerald-500/5 px-3 py-2">
                  <span className="mt-0.5 text-emerald-500">✓</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}
      {totalCount > 0 && (
        <Section title={`文件深审 (${doneCount}/${totalCount})`} eyebrow="Deep review">
          <Card className="p-3 md:p-4">
            <div className="space-y-1.5">{filesArr.map((f) => <FileProgressItem key={f.file} f={f} />)}</div>
          </Card>
        </Section>
      )}
      {allRisks.length > 0 && (
        <Section title={`风险 (${allRisks.length})`} eyebrow="Risks">
          <div className="space-y-3">{allRisks.map((r, i) => <RiskCard key={`${r.file}-${r.line_hint ?? ""}-${i}`} r={r} />)}</div>
        </Section>
      )}
      {allSuggestions.length > 0 && (
        <Section title={`建议 (${allSuggestions.length})`} eyebrow="Suggestions">
          <div className="space-y-3">{allSuggestions.map((s, i) => <SuggestionCard key={`${s.file}-${s.line_hint ?? ""}-${i}`} s={s} />)}</div>
        </Section>
      )}
      {state.finalReport && allRisks.length === 0 && allSuggestions.length === 0 && <NoIssueCard />}
      {state.finalReport && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-center"><CopyMarkdownButton report={state.finalReport} prUrl={prUrl} /></div>
          <div className="space-y-1 text-center text-xs text-[var(--muted-fg)]">
            <div>完成 · 总计耗时 {(state.finalReport.elapsed_ms / 1000).toFixed(1)} s</div>
            {state.finalReport.token_usage && (
              <div>
                {state.finalReport.token_usage.llm_calls} 次 LLM 调用 · {state.finalReport.token_usage.prompt_tokens.toLocaleString()} prompt + {state.finalReport.token_usage.completion_tokens.toLocaleString()} completion = {state.finalReport.token_usage.total_tokens.toLocaleString()} tokens
              </div>
            )}
          </div>
        </div>
      )}
      {loading && !state.finalReport && (
        <div className="flex items-center justify-center gap-3 rounded-full text-sm text-[var(--muted-fg)]">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          流式处理中，先返回总览，再逐个文件出结果...
        </div>
      )}
    </div>
  );
}

function ReviewHeader({ state, loading, doneCount, totalCount, risks, suggestions }: { state: StreamState; loading: boolean; doneCount: number; totalCount: number; risks: number; suggestions: number }) {
  if (!state.prInfo) return null;
  const progress = state.finalReport ? 100 : totalCount > 0 ? Math.max(12, Math.round((doneCount / totalCount) * 100)) : state.summary ? 42 : 14;
  const phase = state.finalReport ? "评审完成" : totalCount > 0 ? `深审文件 ${doneCount}/${totalCount}` : state.summary ? "粗筛完成" : loading ? "读取 PR" : "准备中";

  return (
    <Card className="overflow-hidden p-0 shadow-[var(--shadow-md)]">
      <div className="border-b border-[var(--border)] bg-[var(--muted)]/45 px-5 py-4 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-fg)]">
              <code className="rounded-full bg-[var(--card)] px-2.5 py-1 text-[var(--foreground)] shadow-[var(--shadow-sm)]">{state.prInfo.pr}</code>
              {state.prInfo.fromCache && <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-600 dark:text-emerald-300">缓存命中</span>}
            </div>
            <h2 className="truncate text-base font-semibold md:text-lg">{state.prInfo.title}</h2>
          </div>
          <code className="shrink-0 rounded-full bg-[var(--primary-soft)] px-3 py-1.5 text-xs text-[var(--primary-hover)]">{state.prInfo.model}</code>
        </div>
      </div>
      <div className="p-5 md:p-6">
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="改动文件" value={state.prInfo.files.toLocaleString()} />
          <MetricCard label="代码变更" value={`+${state.prInfo.additions} / -${state.prInfo.deletions}`} />
          <MetricCard label="风险" value={risks.toLocaleString()} tone={risks > 0 ? "danger" : "neutral"} />
          <MetricCard label="建议" value={suggestions.toLocaleString()} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted-fg)]">
          <span>{phase}</span><span>{progress}%</span>
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

function FileProgressItem({ f }: { f: FileProgress }) {
  const dot = f.status === "running" ? "bg-[var(--primary)] animate-pulse" : f.status === "done" ? "bg-emerald-500" : f.status === "error" ? "bg-[var(--severity-high-bar)]" : "bg-[var(--muted-fg)] opacity-40";
  const statusText: Record<FileStatus, string> = { pending: "等待", running: "分析中", done: "完成", error: "失败" };
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2 text-xs transition hover:bg-[var(--muted)]/65">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <code className="min-w-0 flex-1 truncate font-mono text-[var(--foreground)]">{f.file}</code>
      {f.status === "done" && (f.risks.length > 0 || f.suggestions.length > 0) ? (
        <span className="shrink-0 text-[var(--muted-fg)]">
          {f.risks.length > 0 && <span className="text-[var(--severity-medium-fg)]">{f.risks.length} 风险</span>}
          {f.risks.length > 0 && f.suggestions.length > 0 && <span> · </span>}
          {f.suggestions.length > 0 && <span>{f.suggestions.length} 建议</span>}
        </span>
      ) : (
        <span className="shrink-0 text-[var(--muted-fg)]">{statusText[f.status]}</span>
      )}
      {f.status === "error" && <span className="max-w-48 shrink-0 truncate text-[var(--severity-high-fg)]">{f.error ?? "失败"}</span>}
    </div>
  );
}

function RiskCard({ r }: { r: RiskItem }) {
  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
      <div className="flex">
        <div className={`w-1 shrink-0 ${SEVERITY_BAR[r.severity]}`} />
        <div className="min-w-0 flex-1 p-4 md:p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2.5 py-1 font-mono font-semibold uppercase ${SEVERITY_TINT[r.severity]}`}>{SEVERITY_LABEL[r.severity]}</span>
              <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-[var(--muted-fg)]">{r.category}</span>
              <code className="text-[var(--muted-fg)]">{r.file}</code>
              {r.line_hint && <code className="text-[var(--muted-fg)]">L{r.line_hint}</code>}
            </div>
            <ConfidencePill c={r.confidence} />
          </div>
          <h3 className="mb-2 text-sm font-semibold">{r.title}</h3>
          <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--muted-fg)]">{r.detail}</p>
        </div>
      </div>
    </Card>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] md:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted-fg)]">
          <span className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 font-medium text-[var(--primary-hover)]">建议</span>
          <code className="truncate">{s.file}</code>
          {s.line_hint && <code>L{s.line_hint}</code>}
        </div>
        <ConfidencePill c={s.confidence} />
      </div>
      <h3 className="mb-2 text-sm font-semibold">{s.title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--muted-fg)]">{s.detail}</p>
      {s.code_hint && <pre className="mt-3 overflow-x-auto rounded-xl bg-[var(--muted)] p-3 text-xs leading-6"><code>{s.code_hint}</code></pre>}
    </Card>
  );
}

function ConfidencePill({ c }: { c: Confidence }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-fg)]">
      <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[c]}`} />
      {CONFIDENCE_LABEL[c]}
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

function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)] backdrop-blur ${className}`}>{children}</div>;
}

function EmptyState({ onPickSample }: { onPickSample: () => void }) {
  return (
    <Card className="p-6 md:p-8">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-3xl">📄</div>
        <h2 className="text-lg font-semibold tracking-tight">准备好开始一次 PR 体检</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-fg)]">输入 PR 链接后，会先返回整体总结，再展示逐文件风险和可采纳建议。适合作为人工 review 前的第一轮扫雷。</p>
        <button type="button" onClick={onPickSample} className="mt-5 rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)] transition hover:opacity-85">填入公开样例</button>
      </div>
      <div className="mt-8 grid gap-3 md:grid-cols-3">
        <FeatureCard title="先看总览" desc="几秒内理解 PR 目标、范围和主要改动层次。" />
        <FeatureCard title="聚焦风险" desc="只把真正可能影响正确性、性能或安全的问题顶出来。" />
        <FeatureCard title="可复制报告" desc="完成后一键复制 Markdown，方便贴回 PR 评论。" />
      </div>
    </Card>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/35 p-4 text-left"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 text-xs leading-5 text-[var(--muted-fg)]">{desc}</p></div>;
}

function NoIssueCard() {
  return (
    <Card className="border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
      <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">未发现需要重点处理的风险</div>
      <p className="mt-1 text-xs text-[var(--muted-fg)]">这不代表代码绝对无误，但说明当前评审没有产出高价值问题或建议。</p>
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

function HeroPill({ value, label }: { value: string; label: string }) {
  return <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-3 shadow-[var(--shadow-sm)] backdrop-blur"><div className="text-base font-semibold text-[var(--foreground)]">{value}</div><div className="mt-1 text-[var(--muted-fg)]">{label}</div></div>;
}

function InlineError({ title, message, className = "" }: { title: string; message: string; className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-[var(--radius)] border border-[var(--severity-high-bar)]/20 bg-[var(--severity-high-bg)] p-4 text-sm text-[var(--severity-high-fg)] ${className}`}>
      <span className="mt-0.5">⚠️</span>
      <div><strong>{title}</strong><div className="mt-1 opacity-90">{message}</div></div>
    </div>
  );
}

function DecorativeBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-amber-300/20 blur-3xl" />
      <div className="absolute right-[-10%] top-32 h-80 w-80 rounded-full bg-pink-300/20 blur-3xl" />
      <div className="absolute bottom-0 left-[-10%] h-96 w-96 rounded-full bg-emerald-300/15 blur-3xl" />
    </div>
  );
}
