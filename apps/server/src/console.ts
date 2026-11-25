import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { ACTOR_SOURCES, type ActorSource } from "@optimax-starter/api";
import { accounts, apiTokens, sessions } from "@optimax-starter/db/schema/console";
import { db } from "./services";
import { getCookieName, getCorsOrigin } from "./core/config";
import {
  TOKEN_LAST_USED_THROTTLE_MS,
  isInteractiveOnlyRoute,
  isWellFormedApiToken,
  originAllowed,
  parseAuthorization,
} from "./core/bearer";
import {
  accountFields,
  digest,
  errorJson,
  getClientIp,
  resolveTokenPermissions,
  type Env,
} from "./core/guards";
import { getEffectivePermissions } from "./core/permissions";
import { getUploadMaxBytes } from "./core/storage";
import { getConfiguredSessionTtlSeconds } from "./core/system-settings";
import { accountsRoutes } from "./modules/accounts";
import { attachmentsRoutes } from "./modules/attachments";
import { auditRoutes } from "./modules/audit";
import { authRoutes, setSessionCookie } from "./modules/auth";
import { jobsRoutes } from "./modules/jobs";
import { systemRoutes } from "./modules/system";
import { tokensRoutes } from "./modules/tokens";
// @starter:example-assets-start
import { assetsRoutes } from "./modules/assets";
// @starter:example-assets-end
// @starter:agent-start
import { agentRoutes } from "./agent/routes";
// @starter:agent-end
// @starter:module-imports

export { initializeConsole } from "./core/seed";

// ---------------------------------------------------------------------------
// Request policies: body size + accepted Content-Type for non-GET requests.
// Default: 64 KiB JSON. Larger bodies / multipart are opted in per route below. The Origin CSRF
// check for Cookie sessions is independent of these policies and is never relaxed by them.
// ---------------------------------------------------------------------------
export type RequestPolicy = {
  method?: string;
  path: RegExp;
  maxBytes: number;
  contentTypes: readonly string[];
};

export const DEFAULT_REQUEST_POLICY: Omit<RequestPolicy, "path"> = {
  maxBytes: 64 * 1024,
  contentTypes: ["application/json"],
};

/** Multipart framing overhead allowed on top of the configured upload limit. */
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export function attachmentUploadPolicyBytes(uploadMaxBytes = getUploadMaxBytes()): number {
  return uploadMaxBytes + MULTIPART_OVERHEAD_BYTES;
}

export const REQUEST_POLICIES: RequestPolicy[] = [
  // @starter:example-assets-start
  {
    method: "POST",
    path: /^\/console\/assets\/import\/(preview|commit)$/,
    maxBytes: 2 * 1024 * 1024,
    contentTypes: ["application/json", "multipart/form-data"],
  },
  // @starter:example-assets-end
  // @starter:agent-start
  {
    method: "POST",
    path: /^\/console\/agent\/chat$/,
    maxBytes: 256 * 1024,
    contentTypes: ["application/json"],
  },
  {
    method: "POST",
    path: /^\/console\/system\/ai\/model(\/(test|clear))?$/,
    maxBytes: 16 * 1024,
    contentTypes: ["application/json"],
  },
  // @starter:agent-end
  {
    method: "POST",
    path: /^\/console\/attachments$/,
    maxBytes: attachmentUploadPolicyBytes(),
    contentTypes: ["multipart/form-data"],
  },
  {
    method: "POST",
    path: /^\/console\/jobs$/,
    maxBytes: 2 * 1024 * 1024,
    contentTypes: ["application/json"],
  },
];

export function requestPolicyFor(method: string, path: string) {
  return (
    REQUEST_POLICIES.find((p) => (!p.method || p.method === method) && p.path.test(path)) ??
    DEFAULT_REQUEST_POLICY
  );
}

// Routes reachable without a console session. Each one enforces its own rate limit / validation.
const PUBLIC_ROUTES: { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/console\/login$/ },
  { method: "GET", path: /^\/console\/auth\/providers$/ },
  { method: "GET", path: /^\/console\/auth\/invites\/[^/]+$/ },
  { method: "POST", path: /^\/console\/auth\/invites\/[^/]+\/accept$/ },
  { method: "GET", path: /^\/console\/auth\/sso\/[^/]+\/(start|callback)$/ },
];

export const isPublicRoute = (method: string, path: string) =>
  PUBLIC_ROUTES.some((r) => r.method === method && r.path.test(path));

const LAST_SEEN_THROTTLE_MS = 60_000;

export const consoleApi = new Hono<Env>();

consoleApi.use("*", async (c, next) => {
  const policy = requestPolicyFor(c.req.method, c.req.path);
  const limit: MiddlewareHandler = bodyLimit({
    maxSize: policy.maxBytes,
    onError: (ctx) => errorJson(ctx, 413, "请求过大", "FILE_TOO_LARGE"),
  });
  return limit(c, next);
});

const asActorSource = (value: string, fallback: ActorSource): ActorSource =>
  (ACTOR_SOURCES as readonly string[]).includes(value) ? (value as ActorSource) : fallback;

consoleApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  const auth = parseAuthorization(c.req.header("authorization"));
  if (c.req.method !== "GET") {
    const policy = requestPolicyFor(c.req.method, c.req.path);
    const type = c.req.header("content-type")?.toLowerCase() ?? "";
    // Cookie (and anonymous) requests: strict browser Origin check. Bearer requests are exempt,
    // but Content-Type and body-size policies still apply below / above.
    if (!originAllowed(c.req.method, auth, c.req.header("origin"), getCorsOrigin())) {
      return errorJson(c, 403, "请求来源无效", "PERM_ORIGIN_INVALID");
    }
    if (!policy.contentTypes.some((allowed) => type.startsWith(allowed))) {
      // Kept as 403 + same message for backward compatibility with existing clients and scripts.
      return errorJson(c, 403, "请求来源无效", "VALIDATION_UNSUPPORTED_MEDIA");
    }
  }
  if (isPublicRoute(c.req.method, c.req.path)) return next();

  // -------------------------------------------------------------------------
  // Bearer API token: authoritative. Never falls back to the session cookie.
  // -------------------------------------------------------------------------
  if (auth.kind === "bearer") {
    const invalid = () => errorJson(c, 401, "API 密钥无效或已过期", "AUTH_INVALID_TOKEN");
    if (!isWellFormedApiToken(auth.token)) return invalid();
    const now = new Date();
    const [row] = await db
      .select({
        ...accountFields,
        tokenId: apiTokens.id,
        scopes: apiTokens.scopes,
        tokenActorSource: apiTokens.actorSource,
        lastUsedAt: apiTokens.lastUsedAt,
        lastUsedIp: apiTokens.lastUsedIp,
      })
      .from(apiTokens)
      .innerJoin(accounts, eq(accounts.id, apiTokens.accountId))
      .where(
        and(
          eq(apiTokens.tokenHash, digest(auth.token)),
          isNull(apiTokens.revokedAt),
          gt(apiTokens.expiresAt, now),
          eq(accounts.active, true),
        ),
      );
    if (!row) return invalid();
    if (isInteractiveOnlyRoute(c.req.path)) {
      return errorJson(c, 403, "此操作仅允许网页登录会话执行", "PERM_INTERACTIVE_REQUIRED");
    }
    const { tokenId, scopes, tokenActorSource, lastUsedAt, lastUsedIp, ...actor } = row;
    const ip = getClientIp(c);
    if (
      !lastUsedAt ||
      now.getTime() - lastUsedAt.getTime() > TOKEN_LAST_USED_THROTTLE_MS ||
      lastUsedIp !== ip
    ) {
      void db
        .update(apiTokens)
        .set({ lastUsedAt: now, lastUsedIp: ip })
        .where(eq(apiTokens.id, tokenId))
        .catch(() => undefined);
    }
    const permissions = resolveTokenPermissions(
      await getEffectivePermissions(actor.role),
      Array.isArray(scopes) ? scopes : [],
    );
    c.set("actor", {
      ...actor,
      permissions,
      authType: "bearer",
      actorSource: asActorSource(tokenActorSource, "agent"),
      tokenId,
    });
    return next();
  }

  // -------------------------------------------------------------------------
  // Cookie session (interactive browser).
  // -------------------------------------------------------------------------
  const token = getCookie(c, getCookieName());
  const key = token ? digest(token) : null;
  const [row] = key
    ? await db
        .select({
          ...accountFields,
          expires: sessions.expires,
          lastSeenAt: sessions.lastSeenAt,
          ipAddress: sessions.ipAddress,
        })
        .from(accounts)
        .innerJoin(sessions, eq(accounts.id, sessions.account))
        .where(
          and(eq(sessions.key, key), gt(sessions.expires, new Date()), eq(accounts.active, true)),
        )
    : [];
  if (!row || !key || !token) return errorJson(c, 401, "请登录", "AUTH_REQUIRED");
  const { expires, lastSeenAt, ipAddress, ...actor } = row;
  const ip = getClientIp(c);
  const nowMs = Date.now();
  const ttlSeconds = await getConfiguredSessionTtlSeconds();
  const targetExpiresMs = nowMs + ttlSeconds * 1000;
  const isSessionClosingRoute =
    c.req.path === "/console/logout" || c.req.path === "/console/me/password";
  // Slide session lifetime at most once per 5 minutes so existing short cookies upgrade and active use stays signed in.
  const shouldSlide =
    !isSessionClosingRoute && Math.abs(expires.getTime() - targetExpiresMs) > 5 * 60_000;

  if (shouldSlide) {
    await db
      .update(sessions)
      .set({
        expires: new Date(targetExpiresMs),
        lastSeenAt: new Date(nowMs),
        ipAddress: ip,
      })
      .where(eq(sessions.key, key))
      .catch(() => undefined);
    setSessionCookie(c, token, ttlSeconds);
  } else if (nowMs - lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS || ipAddress !== ip) {
    // Fire-and-forget, throttled to once per minute per session; never blocks or fails the request.
    void db
      .update(sessions)
      .set({ lastSeenAt: new Date(nowMs), ipAddress: ip })
      .where(eq(sessions.key, key))
      .catch(() => undefined);
  }
  const permissions = await getEffectivePermissions(actor.role);
  c.set("actor", { ...actor, permissions, authType: "cookie", actorSource: "human" });
  await next();
});

export const consoleRoutes = consoleApi
  .route("/", authRoutes)
  // @starter:example-assets-start
  .route("/", assetsRoutes)
  // @starter:example-assets-end
  .route("/", accountsRoutes)
  .route("/", auditRoutes)
  .route("/", systemRoutes)
  .route("/", attachmentsRoutes)
  .route("/", jobsRoutes)
  // @starter:agent-start
  .route("/", agentRoutes)
  // @starter:agent-end
  // @starter:module-routes
  .route("/", tokensRoutes);

export type ConsoleApiType = typeof consoleRoutes;
