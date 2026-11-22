import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { consoleApi, initializeConsole } from "./console";
import {
  defaultErrorCode,
  errorJson,
  getClientIp,
  getRequestId,
  resolveRequestId,
} from "./core/http";
import { ENV } from "./env.server";
import { db } from "./services";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const app = new Hono();

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
};

// Single-line JSON access log. Never includes headers, cookies, tokens, query strings or bodies.
function accessLog(entry: Record<string, unknown>) {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
}

const safeMessage = (value: unknown) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .slice(0, 200);

// 1) Request context: X-Request-Id (validated or generated), security headers, access log.
app.use("*", async (c, next) => {
  const requestId = resolveRequestId(c.req.header("x-request-id"));
  c.set("requestId", requestId);
  const started = performance.now();
  try {
    await next();
  } finally {
    try {
      c.header("X-Request-Id", requestId);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
    } catch {
      // Immutable upstream headers: logging below still runs.
    }
    const status = c.res?.status ?? 500;
    accessLog({
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      latencyMs: Math.round(performance.now() - started),
      ip: getClientIp(c),
    });
  }
});

// 2) Safety net: any legacy `{ error }` JSON error gains `code` + `requestId` without changing `error`.
app.use("/console/*", async (c, next) => {
  await next();
  const res = c.res;
  if (res.status < 400 || !res.headers.get("content-type")?.includes("application/json")) return;
  try {
    const body = (await res.clone().json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || typeof body.error !== "string") return;
    if (typeof body.code === "string" && typeof body.requestId === "string") return;
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    c.res = new Response(
      JSON.stringify({
        ...body,
        code: typeof body.code === "string" ? body.code : defaultErrorCode(res.status),
        requestId: getRequestId(c),
      }),
      { status: res.status, headers },
    );
  } catch {
    // Non-JSON or unreadable body: leave the response untouched.
  }
});

app.onError((error, c) => {
  accessLog({
    level: "error",
    requestId: getRequestId(c),
    method: c.req.method,
    path: c.req.path,
    error: safeMessage(error?.name),
    message: safeMessage(error?.message),
  });
  return errorJson(c, 500, "服务内部错误，请稍后重试", "SYS_INTERNAL_ERROR");
});

app.notFound((c) =>
  c.req.path.startsWith("/console/") || c.req.path === "/console"
    ? errorJson(c, 404, "接口不存在", "DATA_NOT_FOUND")
    : c.text("Not Found", 404),
);

app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

await initializeConsole();
app.route("/console", consoleApi);

app.get("/healthz", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ status: "ok", db: "ok" });
  } catch {
    return c.json({ status: "degraded", db: "unreachable" }, 503);
  }
});

const webDist = process.env.SERVE_WEB_DIST?.trim()
  ? path.resolve(process.env.SERVE_WEB_DIST.trim())
  : null;

if (!webDist) {
  app.get("/", (c) => c.text("OK"));
} else {
  app.get("/*", async (c) => {
    const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
    const candidate = path.resolve(webDist, "." + reqPath);
    if (!candidate.startsWith(webDist + path.sep) && candidate !== webDist) {
      return c.text("Forbidden", 403);
    }
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        const ext = path.extname(candidate).toLowerCase();
        const body = await readFile(candidate);
        const immutable = reqPath.startsWith("/assets/");
        return new Response(body, {
          headers: {
            "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
            "Cache-Control": immutable
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          },
        });
      }
    } catch {
      // Fall back to SPA entry for client routes without file extensions.
    }
    if (path.extname(reqPath)) return c.text("Not Found", 404);
    const html = await readFile(path.join(webDist, "index.html"));
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });
}

export default app;
