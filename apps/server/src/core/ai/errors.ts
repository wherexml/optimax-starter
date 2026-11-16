// Error shape detection ported in part from Magpie internal/gateway/kept_error.go (errorShape, the
// error.message check of writeKeptError); Retry-After seconds / HTTP-date parsing from
// internal/gateway/retry_after_cap.go (capRetryAfter).
// Copyright (c) 2026 yetone. MIT License, full text: third_party/licenses/magpie-MIT.txt.
// Source: https://github.com/yetone/magpie/tree/58cf764533743a84b93a8b2cbff61fde27350856/internal/gateway
// Changes: the shape is detected from the response body instead of the configured protocol; vendor
// bodies are never passed through: callers only get a fixed message, a stable code and numeric/enum
// metadata. Retry-After is parsed but never capped, so the vendor's advised wait is kept.

export type AiErrorCode =
  | "ai_disabled"
  | "ai_config_invalid"
  | "upstream_auth"
  | "upstream_rate_limited"
  | "upstream_bad_request"
  | "upstream_server"
  | "upstream_invalid_response"
  | "upstream_response_too_large"
  | "upstream_redirect"
  | "upstream_network"
  | "upstream_timeout"
  | "queue_full"
  | "actor_limit"
  | "queue_timeout"
  | "request_cancelled";

export type ErrorShape = "openai" | "anthropic" | "gemini" | "unknown";
export type AiErrorMeta = { upstreamStatus?: number; errorShape?: ErrorShape; retryAfter?: number };

const TABLE: Record<AiErrorCode, { status: 429 | 502 | 503 | 504; message: string }> = {
  ai_disabled: { status: 503, message: "模型筛选尚未配置" },
  ai_config_invalid: { status: 503, message: "模型服务配置无效，请联系管理员" },
  upstream_auth: { status: 502, message: "模型服务鉴权失败，请联系管理员检查服务端配置" },
  upstream_rate_limited: { status: 429, message: "模型服务限流，请稍后重试" },
  upstream_bad_request: { status: 502, message: "模型服务拒绝了请求，筛选未更改" },
  upstream_server: { status: 502, message: "模型服务暂不可用，请稍后重试" },
  upstream_invalid_response: { status: 502, message: "模型服务返回了无效结果，筛选未更改" },
  upstream_response_too_large: { status: 502, message: "模型服务响应过大，筛选未更改" },
  upstream_redirect: { status: 502, message: "模型服务地址发生重定向，已拒绝" },
  upstream_network: { status: 502, message: "无法连接模型服务，请稍后重试" },
  upstream_timeout: { status: 504, message: "模型服务超时，筛选未更改" },
  queue_full: { status: 429, message: "筛选请求过多，请稍后重试" },
  actor_limit: { status: 429, message: "已有筛选请求在处理中，请等待完成" },
  queue_timeout: { status: 503, message: "排队等待超时，请稍后重试" },
  request_cancelled: { status: 503, message: "筛选请求已取消" },
};

export class AiError extends Error {
  constructor(readonly code: AiErrorCode, readonly meta: AiErrorMeta = {}) {
    super(code);
    this.name = "AiError";
  }
}

export type AiErrorBody = { error: string; code: Uppercase<AiErrorCode> } & AiErrorMeta;

/** The page-safe response: the original `error` string contract plus a stable code and safe metadata. */
export function aiErrorResponse(error: AiError, message?: string) {
  const entry = TABLE[error.code];
  const body: AiErrorBody = { error: message ?? entry.message, code: error.code.toUpperCase() as Uppercase<AiErrorCode> };
  if (error.meta.upstreamStatus !== undefined) body.upstreamStatus = error.meta.upstreamStatus;
  if (error.meta.errorShape !== undefined) body.errorShape = error.meta.errorShape;
  const headers: Record<string, string> = {};
  if (error.meta.retryAfter !== undefined) {
    body.retryAfter = error.meta.retryAfter;
    headers["Retry-After"] = String(error.meta.retryAfter);
  }
  return { status: entry.status, body, headers };
}

/** Safe log fields only: never the vendor message, body, URL or credentials. */
export function aiLogFields(error: AiError) {
  return { code: error.code.toUpperCase(), ...error.meta };
}

/**
 * Seconds to wait from a Retry-After header (delta-seconds or HTTP-date), rounded up, or undefined
 * when absent or unreadable. Never capped: a long vendor wait is kept as advised.
 */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  let seconds: number;
  if (/^\d+(\.\d+)?$/.test(text)) seconds = Math.ceil(Number(text));
  else {
    if (!/[a-z]/i.test(text) || !/\d{2}:\d{2}/.test(text)) return undefined;
    const at = Date.parse(text);
    if (Number.isNaN(at)) return undefined;
    seconds = Math.max(0, Math.ceil((at - now) / 1000));
  }
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

type VendorError = { shape: ErrorShape; message?: string; code?: string; type?: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The family of an error body: OpenAI {"error":{"message","type","code","param"}}, Anthropic
 * {"type":"error","error":{"type","message"}}, Gemini {"error":{"code","message","status"}}.
 * The message is returned for internal decisions (token field correction) and must not be shown.
 */
export function readVendorError(text: string): VendorError {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { shape: "unknown" };
  }
  if (!isObject(value) || !isObject(value.error) || typeof value.error.message !== "string") return { shape: "unknown" };
  const inner = value.error;
  const message = inner.message as string;
  const code = typeof inner.code === "string" ? inner.code : undefined;
  const type = typeof inner.type === "string" ? inner.type : undefined;
  if (value.type === "error") return { shape: "anthropic", message, type };
  if (typeof inner.status === "string" && typeof inner.code === "number") return { shape: "gemini", message, code: inner.status };
  return { shape: "openai", message, code, type };
}

/** Maps a non-2xx, non-3xx vendor status to a stable code. */
export function classifyStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return "upstream_auth";
  if (status === 429) return "upstream_rate_limited";
  if (status >= 500) return "upstream_server";
  if (status >= 400) return "upstream_bad_request";
  return "upstream_invalid_response";
}
