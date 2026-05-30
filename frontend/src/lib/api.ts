import type { ReviewReport } from "./types";

const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const ERROR_FRIENDLY: Record<string, string> = {
  PR_NOT_FOUND: "PR 不存在或仓库不公开。请检查链接。",
  RATE_LIMITED: "GitHub API 触发限流,稍后再试。",
  GITHUB_ERROR: "访问 GitHub 失败,可能是网络问题,请稍后再试。",
  LLM_UNAVAILABLE: "LLM 网关暂时不可用,请稍后重试。",
  VALIDATION_ERROR: "请求参数有误。",
  BAD_REQUEST: "请求格式不正确。",
  INTERNAL_ERROR: "服务端错误。",
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

  get userMessage(): string {
    if (this.hint) return this.hint;
    if (this.code && ERROR_FRIENDLY[this.code]) return ERROR_FRIENDLY[this.code];
    return this.detail;
  }
}

async function parseError(res: Response): Promise<ApiCallError> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* keep null */ }
  if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object") {
    const e = body.error as { code?: string; message?: string; hint?: string };
    return new ApiCallError(res.status, e.message ?? res.statusText, e.code ?? null, e.hint ?? null);
  }
  if (body && typeof body === "object" && "detail" in body) {
    return new ApiCallError(res.status, String((body as { detail: unknown }).detail));
  }
  return new ApiCallError(res.status, res.statusText);
}

// ---------------------------------------------------------------------------
// 异步任务模式:提交 → 拿 task_id → 轮询查结果
// ---------------------------------------------------------------------------

interface TaskResponse {
  task_id: string;
  status: string;
  result?: ReviewReport;
  error?: string;
}

export async function submitReview(
  url: string,
  opts?: { model?: string },
): Promise<string> {
  const res = await fetch(`${DEFAULT_API_BASE}/api/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, model: opts?.model }),
  });
  if (!res.ok) throw await parseError(res);
  const data = (await res.json()) as TaskResponse;
  return data.task_id;
}

export async function getReview(taskId: string): Promise<TaskResponse> {
  const res = await fetch(`${DEFAULT_API_BASE}/api/review/${taskId}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TaskResponse;
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
