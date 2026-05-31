import type { ReviewReport } from "./types";

export interface ReviewState {
  startedAt: number | null;
  prLabel: string;
  report: ReviewReport | null;
  errorMsg: string | null;
}

export const initReviewState: ReviewState = {
  startedAt: null,
  prLabel: "",
  report: null,
  errorMsg: null,
};

export function formatPrLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const match = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (match) return `${match[1]}/${match[2]}#${match[3]}`;
  } catch {
    // Ignore invalid parsing here; input validation is handled by the form/API.
  }
  return rawUrl;
}
