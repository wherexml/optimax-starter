// Pure HTTP helpers (no DB / env imports) so they stay unit-testable:
// request id, unified error JSON, error-code defaults, and client IP resolution.
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Context } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

export type ErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 410
  | 413
  | 415
  | 422
  | 429
  | 500
  | 502
  | 503;

// Prefixes follow API_CONVENTIONS.md §5.
export const DEFAULT_ERROR_CODES: Record<ErrorStatus, string> = {
  400: "VALIDATION_BAD_REQUEST",
  401: "AUTH_REQUIRED",
  403: "PERM_DENIED",
  404: "DATA_NOT_FOUND",
  409: "DATA_CONFLICT",
  410: "DATA_EXPIRED",
  413: "FILE_TOO_LARGE",
  415: "VALIDATION_UNSUPPORTED_MEDIA",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  500: "SYS_INTERNAL_ERROR",
  502: "SYS_UPSTREAM_ERROR",
  503: "SYS_UNAVAILABLE",
};

export function defaultErrorCode(status: number): string {
  return DEFAULT_ERROR_CODES[status as ErrorStatus] ?? "SYS_INTERNAL_ERROR";
}

export class Refusal extends Error {
  status: ErrorStatus;
  code: string;
  headers?: Record<string, string>;
  constructor(
    status: ErrorStatus,
    message: string,
    code?: string,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code ?? defaultErrorCode(status);
    this.headers = headers;
  }
}

export type ErrorBody = { error: string; code: string; requestId?: string };

const REQUEST_ID_RE = /^[a-zA-Z0-9._-]{8,64}$/;

/** Accepts a caller-supplied X-Request-Id only when it is a short safe token; otherwise generates one. */
export function resolveRequestId(incoming: string | undefined | null): string {
  const value = incoming?.trim();
  return value && REQUEST_ID_RE.test(value) ? value : randomUUID();
}

// biome-ignore lint/suspicious/noExplicitAny: shared by typed and untyped Hono apps.
type AnyContext = Context<any, any, any>;

export function getRequestId(c: AnyContext): string | undefined {
  try {
    return c.get("requestId") || undefined;
  } catch {
    return undefined;
  }
}

/** Every error response stays `{ error }`-compatible and adds `code` + `requestId`. */
export function errorJson<S extends ErrorStatus>(
  c: AnyContext,
  status: S,
  error: string,
  code?: string,
  headers?: Record<string, string>,
) {
  const body: ErrorBody = { error, code: code ?? defaultErrorCode(status) };
  const requestId = getRequestId(c);
  if (requestId) body.requestId = requestId;
  return c.json(body, status, headers);
}

export function refusalJson(c: AnyContext, refusal: Refusal) {
  return errorJson(c, refusal.status, refusal.message, refusal.code, refusal.headers);
}

/** Returns a canonical IP string when `raw` is a single valid IPv4/IPv6 token, else null. */
export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value || value.length > 64) return null;
  // Strip IPv6 brackets / zone ids are rejected below by isIP.
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (value.toLowerCase().startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) return mapped;
  }
  return isIP(value) ? value.toLowerCase() : null;
}

export type ClientIpSource = {
  trustProxy: boolean;
  forwardedFor?: string | null;
  realIp?: string | null;
  remoteAddress?: string | null;
};

/** Pure resolution logic: proxy headers are only trusted when explicitly configured. */
export function resolveClientIp(source: ClientIpSource): string {
  if (source.trustProxy) {
    const first = source.forwardedFor?.split(",")[0];
    const forwarded = normalizeIp(first) ?? normalizeIp(source.realIp);
    if (forwarded) return forwarded;
  }
  return normalizeIp(source.remoteAddress) ?? "unknown";
}

export function getClientIp(c: AnyContext): string {
  let remoteAddress: string | undefined;
  try {
    remoteAddress = (
      c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
    )?.incoming?.socket?.remoteAddress;
  } catch {
    remoteAddress = undefined;
  }
  return resolveClientIp({
    trustProxy: process.env.TRUST_PROXY === "true",
    forwardedFor: c.req.header("x-forwarded-for"),
    realIp: c.req.header("x-real-ip"),
    remoteAddress,
  });
}
