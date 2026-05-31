"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiCallError, reviewPR } from "@/lib/api";
import { HealthBadge } from "@/components/HealthBadge";
import { Card, DecorativeBackground, ReviewView } from "@/components/ReviewView";
import { formatPrLabel, initReviewState } from "@/lib/reviewPage";
import { useRecentUrls } from "@/lib/useRecentUrls";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState(initReviewState);
  const { recent, push: pushRecent } = useRecentUrls();
  const abortRef = useRef<AbortController | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;

    const trimmed = url.trim();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setState({ startedAt: Date.now(), prLabel: formatPrLabel(trimmed), report: null, errorMsg: null });
    pushRecent(trimmed);

    try {
      const report = await reviewPR(trimmed, { signal: ctrl.signal, strategy: "layered" });
      setState((current) => ({ ...current, report, errorMsg: null }));
    } catch (err) {
      const message = ctrl.signal.aborted
        ? "已取消"
        : err instanceof ApiCallError
          ? err.userMessage
          : err instanceof Error
            ? err.message
            : "未知错误";
      setState((current) => ({ ...current, errorMsg: message }));
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
              输入 GitHub PR 链接，系统会结合变更内容和相关上下文，整理总结、风险和可执行建议，供 reviewer 参考。
            </p>
          </div>
        </header>

        <Card className="mb-8 p-4 shadow-[var(--shadow-md)] md:p-5">
          <form onSubmit={onSubmit}>
            <label htmlFor="pr-url" className="text-sm font-semibold tracking-tight">
              GitHub PR 链接
            </label>
            <p className="mt-1 text-xs text-[var(--muted-fg)]">
              支持公开仓库。分析过程可能需要几十秒，完成后会一次性返回完整报告。
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
