import type { ReviewReport } from "./types";

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
  opts?: { model?: string; signal?: AbortSignal },
): Promise<ReviewReport> {
  const res = await fetch(`${DEFAULT_API_BASE}/api/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, model: opts?.model }),
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
