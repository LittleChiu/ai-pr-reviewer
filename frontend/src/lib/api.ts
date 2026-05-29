import type { ReviewReport, RiskItem, Suggestion } from "./types";

const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const ERROR_FRIENDLY: Record<string, string> = {
  PR_NOT_FOUND: "PR 不存在或仓库不公开。请检查链接。",
  RATE_LIMITED: "GitHub API 触发限流,稍后再试,或在后端配置 GITHUB_TOKEN。",
  GITHUB_ERROR: "访问 GitHub 失败,可能是网络问题,请稍后再试。",
  LLM_UNAVAILABLE: "LLM 网关暂时不可用,请稍后重试。",
  VALIDATION_ERROR: "请求参数有误,请检查输入。",
  BAD_REQUEST: "请求格式不正确。",
  INTERNAL_ERROR: "服务器内部错误,请联系管理员。",
};

export class ApiCallError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public code: string | null = null,
    public hint: string | null = null,
  ) {
    super(`[${status}] ${detail}`);
    this.name = "ApiCallError";
  }

  /** 给用户看的中文文案。优先用 hint,其次用 code 映射,最后兜底 detail。 */
  get userMessage(): string {
    if (this.hint) return this.hint;
    if (this.code && ERROR_FRIENDLY[this.code]) return ERROR_FRIENDLY[this.code];
    return this.detail;
  }
}

async function parseError(res: Response): Promise<ApiCallError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return new ApiCallError(res.status, res.statusText);
  }
  // 统一格式: { error: { code, message, hint? } }
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object"
  ) {
    const e = body.error as { code?: string; message?: string; hint?: string };
    return new ApiCallError(
      res.status,
      e.message ?? res.statusText,
      e.code ?? null,
      e.hint ?? null,
    );
  }
  // 旧格式 { detail: string } 兜底
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    return new ApiCallError(res.status, String(detail));
  }
  return new ApiCallError(res.status, res.statusText);
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
    throw await parseError(res);
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
    throw await parseError(res);
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
