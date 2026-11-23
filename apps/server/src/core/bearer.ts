// Pure helpers for the Bearer vs Cookie boundary in the console middleware (unit-tested without DB).
import type { MiddlewareHandler } from "hono";
import type { Env } from "./guards";
import { errorJson } from "./http";

/**
 * Bearer effective permissions = live role permissions ∩ token scopes.
 * A token can never exceed the account's current role, and role downgrades apply immediately.
 */
export function resolveTokenPermissions(
  liveRolePermissions: readonly string[],
  tokenScopes: readonly string[],
): string[] {
  return liveRolePermissions.filter((p) => tokenScopes.includes(p));
}

/** Interactive self-service endpoints (password, sessions, tokens) reject Bearer callers. */
export const requireCookieSession: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get("actor").authType !== "cookie") {
    return errorJson(c, 403, "此操作仅允许网页登录会话执行", "PERM_INTERACTIVE_REQUIRED");
  }
  await next();
};

export type AuthorizationKind =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "other" };

/**
 * Classifies the Authorization header. A Bearer header (case-insensitive scheme) is always
 * authoritative: on failure the request is rejected and NEVER falls back to the session cookie.
 */
export function parseAuthorization(header: string | undefined | null): AuthorizationKind {
  if (!header || !header.trim()) return { kind: "none" };
  // Any header whose scheme is Bearer is authoritative, even when the credential is missing or
  // malformed ("Bearer", "Bearer a b"): it is rejected later instead of reaching the cookie path.
  const match = /^\s*bearer(?:\s+([\s\S]*?))?\s*$/i.exec(header);
  if (match) return { kind: "bearer", token: match[1] ?? "" };
  return { kind: "other" };
}

/** Token format: optx_ + 32 base64url chars (24 random bytes). */
export const API_TOKEN_RE = /^optx_[A-Za-z0-9_-]{32}$/;

export const isWellFormedApiToken = (token: string) => API_TOKEN_RE.test(token);

/**
 * Browser CSRF rule: non-GET Cookie requests must carry Origin === CORS_ORIGIN.
 * Bearer requests are exempt (a browser never attaches a Bearer header cross-site on its own),
 * but they still go through Content-Type and body-size policies.
 */
export function originCheckRequired(method: string, auth: AuthorizationKind): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  return auth.kind !== "bearer";
}

export function originAllowed(
  method: string,
  auth: AuthorizationKind,
  origin: string | undefined,
  corsOrigin: string,
): boolean {
  if (!originCheckRequired(method, auth)) return true;
  return origin === corsOrigin;
}

// Interactive self-service routes: password, sessions and API token management.
// Bearer callers get 403 PERM_INTERACTIVE_REQUIRED (also enforced per route by requireCookieSession).
const INTERACTIVE_ONLY_ROUTES: RegExp[] = [
  /^\/console\/me\/password$/,
  /^\/console\/me\/sessions(\/.*)?$/,
  /^\/console\/me\/tokens(\/.*)?$/,
  // @starter:agent-start
  // Assistant chat (approval cards) and model credentials stay browser-session only.
  /^\/console\/agent\/chat$/,
  /^\/console\/system\/ai\/model(\/.*)?$/,
  // @starter:agent-end
];

export const isInteractiveOnlyRoute = (path: string) =>
  INTERACTIVE_ONLY_ROUTES.some((re) => re.test(path));

export const TOKEN_LAST_USED_THROTTLE_MS = 60_000;
