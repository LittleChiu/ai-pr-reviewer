"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiCallError, reviewPRStream, type StreamEvent } from "@/lib/api";
import { HealthBadge } from "@/components/HealthBadge";
import { Card, DecorativeBackground, ReviewView } from "@/components/ReviewView";
import { formatPrLabel, initReviewState, type ReviewState } from "@/lib/reviewPage";
import { useRecentUrls } from "@/lib/useRecentUrls";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState(initReviewState);
  const { recent, push: pushRecent } = useRecentUrls();
  const abortRef = useRef<AbortController | null>(null);
  const terminalEventRef = useRef<"done" | "error" | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;

    const trimmed = url.trim();
    const ctrl = new AbortController();
    const startedAt = Date.now();

    abortRef.current = ctrl;
    terminalEventRef.current = null;
    setLoading(true);
    setState({
      ...initReviewState,
      startedAt,
      prLabel: formatPrLabel(trimmed),
      phase: "fetching",
      lastEventAt: startedAt,
    });
    pushRecent(trimmed);

    try {
      await reviewPRStream(
        trimmed,
        (ev) => {
          const now = Date.now();
          terminalEventRef.current = ev.type === "done" || ev.type === "error" ? ev.type : terminalEventRef.current;
          setState((current) => applyStreamEvent(current, ev, now));
        },
        { signal: ctrl.signal },
      );

      if (!ctrl.signal.aborted && !terminalEventRef.current) {
        setState((current) => ({
          ...current,
          phase: "error",
          errorMsg: current.errorMsg ?? "连接已结束，但评审结果未完整返回。请稍后重试。",
        }));
      }
    } catch (err) {
      const message = ctrl.signal.aborted
        ? "已取消"
        : err instanceof ApiCallError
          ? err.userMessage
          : err instanceof Error
            ? err.message
            : "未知错误";
      setState((current) => ({
        ...current,
        phase: ctrl.signal.aborted ? current.phase : "error",
        errorMsg: message,
      }));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <DecorativeBackground />
      <div className="mx-auto max-w-4xl px-5 py-10 md:px-8 md:py-14">
        <header className="mb-8">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold tracking-tight">AI PR Review</p>
              <p className="mt-1 text-xs text-[var(--muted-fg)]">面向代码评审的辅助分析工具</p>
            </div>
            <HealthBadge />
          </div>
          <div>
            <h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.03em] md:text-5xl">
              分析 Pull Request，生成结构化评审报告
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-fg)] md:text-base">
              输入 GitHub PR 链接，系统会结合变更内容和相关上下文，先返回进度，再逐步展示总结、风险和可执行建议。
            </p>
          </div>
        </header>

        <Card className="mb-8 p-4 shadow-[var(--shadow-md)] md:p-5">
          <form onSubmit={onSubmit}>
            <label htmlFor="pr-url" className="text-sm font-semibold tracking-tight">
              GitHub PR 链接
            </label>
            <p className="mt-1 text-xs text-[var(--muted-fg)]">
              支持公开仓库。分析过程可能需要几十秒；连接空闲期间会保持心跳，避免前端误以为请求已断开。
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
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
                    {recent.map((recentUrl) => (
                      <option key={recentUrl} value={recentUrl} />
                    ))}
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

          {recent.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {recent.slice(0, 3).map((recentUrl) => (
                <button
                  key={recentUrl}
                  type="button"
                  onClick={() => setUrl(recentUrl)}
                  disabled={loading}
                  className="max-w-full truncate rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-fg)] transition hover:border-[var(--primary)]/50 hover:text-[var(--foreground)] disabled:opacity-50"
                  title={recentUrl}
                >
                  {recentUrl.replace("https://github.com/", "")}
                </button>
              ))}
            </div>
          )}
        </Card>

        <ReviewView state={state} loading={loading} prUrl={url} />
      </div>
    </main>
  );
}

function applyStreamEvent(state: ReviewState, ev: StreamEvent, now: number): ReviewState {
  switch (ev.type) {
    case "accepted":
      return {
        ...state,
        phase: "fetching",
        lastEventAt: now,
      };
    case "heartbeat":
      return {
        ...state,
        lastEventAt: now,
      };
    case "started":
      return {
        ...state,
        phase: ev.data.from_cache ? "done" : "triaging",
        meta: {
          title: ev.data.title,
          files: ev.data.files,
          additions: ev.data.additions,
          deletions: ev.data.deletions,
          model: ev.data.model,
          fromCache: Boolean(ev.data.from_cache),
        },
        lastEventAt: now,
      };
    case "triage":
      return {
        ...state,
        phase: "reviewing",
        summary: ev.data.summary,
        highlights: ev.data.highlights,
        progress: {
          ...state.progress,
          deepFilesTotal: ev.data.deep_files.length,
        },
        lastEventAt: now,
      };
    case "file_started":
      return {
        ...state,
        phase: "reviewing",
        progress: {
          ...state.progress,
          deepFilesStarted: state.progress.deepFilesStarted + 1,
          currentFile: ev.data.file,
        },
        lastEventAt: now,
      };
    case "file_done":
      return {
        ...state,
        phase: "reviewing",
        risks: [...state.risks, ...ev.data.risks],
        suggestions: [...state.suggestions, ...ev.data.suggestions],
        progress: {
          ...state.progress,
          deepFilesDone: state.progress.deepFilesDone + 1,
          currentFile: ev.data.file,
        },
        errorMsg: ev.data.error ? `文件 ${ev.data.file} 评审失败：${ev.data.error}` : state.errorMsg,
        lastEventAt: now,
      };
    case "cached":
      return {
        ...state,
        phase: "done",
        report: ev.data,
        summary: ev.data.summary,
        highlights: ev.data.highlights,
        risks: ev.data.risks,
        suggestions: ev.data.suggestions,
        lastEventAt: now,
      };
    case "done":
      return {
        ...state,
        phase: "done",
        report: ev.data,
        summary: ev.data.summary,
        highlights: ev.data.highlights,
        risks: ev.data.risks,
        suggestions: ev.data.suggestions,
        lastEventAt: now,
      };
    case "error":
      return {
        ...state,
        phase: "error",
        errorMsg: ev.data.message,
        lastEventAt: now,
      };
    default:
      return state;
  }
}
