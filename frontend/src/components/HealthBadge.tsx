"use client";

import { useEffect, useState } from "react";
import { ApiCallError, checkHealth } from "@/lib/api";

type Status = "checking" | "ok" | "no-llm" | "down";

const META: Record<Status, { dot: string; text: string }> = {
  checking: { dot: "bg-zinc-300 animate-pulse", text: "检查后端连接..." },
  ok: { dot: "bg-emerald-500", text: "后端在线" },
  "no-llm": { dot: "bg-amber-500", text: "后端在线,但未配置 LLM" },
  down: { dot: "bg-red-500", text: "后端不可达" },
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
    <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span className={`h-2 w-2 rounded-full ${m.dot}`} />
      <span>{m.text}</span>
      {status === "ok" && primary && (
        <code className="text-zinc-400 dark:text-zinc-500">· {primary}</code>
      )}
    </div>
  );
}
