import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { accounts, sessions } from "@optimax-starter/db/schema/console";
import { db } from "./services";
import { getCookieName, getCorsOrigin } from "./core/config";
import { accountFields, digest, type Env } from "./core/guards";
import { getEffectivePermissions } from "./core/permissions";
import { accountsRoutes } from "./modules/accounts";
import { assetsRoutes } from "./modules/assets";
import { auditRoutes } from "./modules/audit";
import { authRoutes } from "./modules/auth";
import { systemRoutes } from "./modules/system";

export { initializeConsole } from "./core/seed";

export const consoleApi = new Hono<Env>();

consoleApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (
    c.req.method !== "GET" &&
    (c.req.header("origin") !== getCorsOrigin() ||
      !c.req.header("content-type")?.startsWith("application/json"))
  ) {
    return c.json({ error: "请求来源无效" }, 403);
  }
  if (
    c.req.path.endsWith("/login") ||
    c.req.path.endsWith("/auth/providers")
  ) {
    return next();
  }
  const token = getCookie(c, getCookieName());
  const [actor] = token
    ? await db
        .select(accountFields)
        .from(accounts)
        .innerJoin(sessions, eq(accounts.id, sessions.account))
        .where(
          and(
            eq(sessions.key, digest(token)),
            gt(sessions.expires, new Date()),
            eq(accounts.active, true),
          ),
        )
    : [];
  if (!actor) return c.json({ error: "请登录" }, 401);
  const permissions = await getEffectivePermissions(actor.role);
  c.set("actor", { ...actor, permissions });
  await next();
});

consoleApi.route("/", authRoutes);
consoleApi.route("/", assetsRoutes);
consoleApi.route("/", accountsRoutes);
consoleApi.route("/", auditRoutes);
consoleApi.route("/", systemRoutes);
