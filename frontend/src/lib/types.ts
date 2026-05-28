/**
 * 后端 ReviewReport schema 的 TypeScript 镜像。
 * 与 backend/app/services/review_schema.py 保持一致。
 */

export type Severity = "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";

export interface RiskItem {
  file: string;
  line_hint?: string | null;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  confidence: Confidence;
}

export interface Suggestion {
  file: string;
  line_hint?: string | null;
  title: string;
  detail: string;
  code_hint?: string | null;
  confidence: Confidence;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  llm_calls: number;
}

export interface ReviewReport {
  summary: string;
  highlights: string[];
  risks: RiskItem[];
  suggestions: Suggestion[];
  model: string;
  elapsed_ms: number;
  token_usage: TokenUsage;
}

export interface ApiError {
  detail: string;
}
