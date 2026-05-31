import type { RiskItem, ReviewReport, Suggestion } from "./types";

export type ReviewPhase =
  | "idle"
  | "fetching"
  | "triaging"
  | "reviewing"
  | "done"
  | "error";

export interface ReviewMeta {
  title: string;
  files: number;
  additions: number;
  deletions: number;
  model: string;
  fromCache: boolean;
}

export interface ReviewProgress {
  deepFilesTotal: number;
  deepFilesStarted: number;
  deepFilesDone: number;
  currentFile: string | null;
}

export interface ReviewState {
  startedAt: number | null;
  prLabel: string;
  report: ReviewReport | null;
  errorMsg: string | null;
  phase: ReviewPhase;
  meta: ReviewMeta | null;
  summary: string;
  highlights: string[];
  risks: RiskItem[];
  suggestions: Suggestion[];
  progress: ReviewProgress;
  lastEventAt: number | null;
}

export const initReviewState: ReviewState = {
  startedAt: null,
  prLabel: "",
  report: null,
  errorMsg: null,
  phase: "idle",
  meta: null,
  summary: "",
  highlights: [],
  risks: [],
  suggestions: [],
  progress: {
    deepFilesTotal: 0,
    deepFilesStarted: 0,
    deepFilesDone: 0,
    currentFile: null,
  },
  lastEventAt: null,
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
