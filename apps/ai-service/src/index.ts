import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { consoleApi, initializeConsole } from "./console";
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

app.use(logger());
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
