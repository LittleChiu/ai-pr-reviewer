import type { ReviewReport, RiskItem, Suggestion } from "./types";

const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiCallError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`[${status}] ${detail}`);
    this.name = "ApiCallError";
  }
}

export async function reviewPR(
  url: string,
  opts?: { model?: string; signal?: AbortSignal; strategy?: "layered" | "single" },
): Promise<ReviewReport> {
  const res = await fetch(`${DEFAULT_API_BASE}/api/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      model: opts?.model,
      strategy: opts?.strategy ?? "layered",
    }),
    signal: opts?.signal,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // not json, keep statusText
    }
    throw new ApiCallError(res.status, detail);
  }
  return (await res.json()) as ReviewReport;
}

export async function checkHealth(signal?: AbortSignal): Promise<{
  status: string;
  llm_configured: boolean;
  models: Record<string, string>;
}> {
  const res = await fetch(`${DEFAULT_API_BASE}/api/health`, { signal });
  if (!res.ok) throw new ApiCallError(res.status, res.statusText);
  return await res.json();
}

// ---------------------------------------------------------------------------
// SSE 流式
// ---------------------------------------------------------------------------

export type StreamEvent =
  | {
      type: "started";
      data: {
        pr: string;
        title: string;
        files: number;
        additions: number;
        deletions: number;
        model: string;
      };
    }
  | {
      type: "triage";
      data: {
        summary: string;
        highlights: string[];
        deep_files: string[];
        skipped: string[];
      };
    }
  | { type: "file_started"; data: { file: string; changes: number } }
  | {
      type: "file_done";
      data: {
        file: string;
        risks: RiskItem[];
        suggestions: Suggestion[];
        error?: string;
      };
    }
  | { type: "done"; data: ReviewReport }
  | { type: "error"; data: { stage: string; message: string } };

export async function reviewPRStream(
  url: string,
  onEvent: (ev: StreamEvent) => void,
  opts?: { model?: string; signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(`${DEFAULT_API_BASE}/api/review/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, model: opts?.model, strategy: "layered" }),
    signal: opts?.signal,
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // not json
    }
    throw new ApiCallError(res.status, detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // 解析 SSE 帧:event: <type>\ndata: <json>\n\n
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseSseFrame(frame);
      if (ev) onEvent(ev);
    }
  }
}

function parseSseFrame(frame: string): StreamEvent | null {
  let evType = "";
  let dataLine = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) evType = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!evType || !dataLine) return null;
  try {
    return { type: evType as StreamEvent["type"], data: JSON.parse(dataLine) } as StreamEvent;
  } catch {
    return null;
  }
}
