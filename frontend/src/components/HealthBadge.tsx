"use client";

import { useEffect, useState } from "react";
import { ApiCallError, checkHealth } from "@/lib/api";

type Status = "checking" | "ok" | "no-llm" | "down";

const META: Record<Status, { dot: string; text: string }> = {
  checking: { dot: "bg-[var(--muted-fg)] opacity-40 animate-pulse", text: "检查后端连接..." },
  ok: { dot: "bg-emerald-500", text: "后端在线" },
  "no-llm": { dot: "bg-amber-500", text: "后端在线，但未配置 LLM" },
  down: { dot: "bg-[var(--severity-high-bar)]", text: "后端不可达" },
};

export function HealthBadge() {
  const [status, setStatus] = useState<Status>("checking");
  const [primary, setPrimary] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const h = await checkHealth(ctrl.signal);
        setPrimary(h.models?.primary ?? null);
        setStatus(h.llm_configured ? "ok" : "no-llm");
      } catch (e) {
        if (e instanceof ApiCallError || e instanceof Error) {
          setStatus("down");
        }
      }
    })();
    return () => ctrl.abort();
  }, []);

  const m = META[status];
  return (
    <div className="flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--muted-fg)] shadow-[var(--shadow-sm)] backdrop-blur">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
      <span className="shrink-0">{m.text}</span>
      {status === "ok" && primary && (
        <code className="max-w-36 truncate text-[var(--accent)] md:max-w-48">· {primary}</code>
      )}
    </div>
  );
}
