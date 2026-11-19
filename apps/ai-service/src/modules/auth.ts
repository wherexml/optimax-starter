import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  credentialsSchema,
  passwordChangeSchema,
  profileInputSchema,
  type AuditDetail,
  type AuthProviderInfo,
} from "@optimax-starter/api";
import { accounts, sessions } from "@optimax-starter/db/schema/console";
import { verifyPassword, hashPassword } from "../password";
import { db } from "../services";
import { audit } from "../core/audit";
import { getCookieName, SESSION_LIFETIME_SECONDS } from "../core/config";
import {
  ADMIN_LOCK,
  Refusal,
   digest,
  guarded,
  profileFields,
  type Env,
} from "../core/guards";
import { getEffectivePermissions } from "../core/permissions";

export const authRoutes = new Hono<Env>();

// Optional enterprise SSO / OIDC provider discovery endpoint (empty unless configured via env).
authRoutes.get("/auth/providers", (c) => {
  const providers: AuthProviderInfo[] = [];
  if (
    process.env.AUTH_SSO_ENABLED === "true" &&
    process.env.AUTH_SSO_LABEL &&
    process.env.AUTH_SSO_LOGIN_PATH
  ) {
    providers.push({
      id: "sso",
      label: process.env.AUTH_SSO_LABEL,
      loginPath: process.env.AUTH_SSO_LOGIN_PATH,
    });
  }
  return c.json(providers);
});

authRoutes.post("/login", async (c) => {
  const input = credentialsSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "请输入账户和密码" }, 400);
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.username, input.data.username));
  if (
    !account?.active ||
    !(await verifyPassword(input.data.password, account.hash))
  ) {
    return c.json({ error: "账户或密码错误" }, 401);
  }
  const token = randomBytes(32).toString("hex");
  const cookie = getCookieName();
  await db.insert(sessions).values({
    key: digest(token),
    account: account.id,
    expires: new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1000),
  });
  setCookie(c, cookie, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  });
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const [row] = await db
    .select(profileFields)
    .from(accounts)
    .where(eq(accounts.id, c.get("actor").id));
  if (!row) return c.json({ error: "请登录" }, 401);
  const permissions = await getEffectivePermissions(row.role);
  return c.json({ ...row, permissions });
});

authRoutes.patch("/me", async (c) => {
  const input = profileInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) {
    return c.json({ error: "请检查显示名称、邮箱和公司" }, 400);
  }
  const id = c.get("actor").id;
  const { name, email, company } = input.data;
  const row = await db.transaction(async (tx) => {
    const [before] = await tx
      .select(profileFields)
      .from(accounts)
      .where(eq(accounts.id, id))
      .for("update");
    if (!before?.active) return null;
    const set: { name?: string; email?: string | null; company?: string | null } = {};
    if (name !== undefined && name !== before.name) set.name = name;
    if (email !== undefined && (email || null) !== before.email) {
      set.email = email || null;
    }
    if (company !== undefined && (company || null) !== before.company) {
      set.company = company || null;
    }
    const changed = Object.keys(set);
    if (!changed.length) return before;
    const [after] = await tx
      .update(accounts)
      .set(set)
      .where(eq(accounts.id, id))
      .returning(profileFields);
    // A name change keeps its before/after values. Email and company are logged by field name only.
    const detail: AuditDetail =
      set.name !== undefined ? { from: before.name, to: after!.name } : {};
    if (set.email !== undefined || set.company !== undefined) detail.fields = changed;
    await audit(tx, "profile.update", before, after!, detail);
    return after!;
  });
  if (!row) return c.json({ error: "账户不存在" }, 404);
  const permissions = await getEffectivePermissions(row.role);
  return c.json({ ...row, permissions });
});

authRoutes.post("/me/password", async (c) => {
  const input = passwordChangeSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "新密码需为 10–256 位" }, 400);
  if (input.data.current === input.data.password) {
    return c.json({ error: "新密码不能与当前密码相同" }, 400);
  }
  const id = c.get("actor").id;
  const cookie = getCookieName();
  const key = digest(getCookie(c, cookie) ?? "");
  const hash = await hashPassword(input.data.password);
  return guarded(c, async () => {
    const revoked = await db.transaction(async (tx) => {
      await tx.execute(ADMIN_LOCK);
      const [self] = await tx
        .select({
          id: accounts.id,
          username: accounts.username,
          name: accounts.name,
          hash: accounts.hash,
        })
        .from(accounts)
        .innerJoin(sessions, eq(sessions.account, accounts.id))
        .where(
          and(
            eq(accounts.id, id),
            eq(accounts.active, true),
            eq(sessions.key, key),
            gt(sessions.expires, new Date()),
          ),
        );
      if (!self) throw new Refusal(401, "请登录");
      if (!(await verifyPassword(input.data.current, self.hash))) {
        throw new Refusal(400, "当前密码错误");
      }
      await tx.update(accounts).set({ hash }).where(eq(accounts.id, id));
      const removed = await tx
        .delete(sessions)
        .where(eq(sessions.account, id))
        .returning({ key: sessions.key });
      const party = { id: self.id, username: self.username, name: self.name };
      await audit(tx, "profile.password_change", party, party, {
        sessions: removed.length,
      });
      return removed.length;
    });
    deleteCookie(c, cookie, { path: "/" });
    return c.json({ ok: true, revoked });
  });
});

authRoutes.post("/logout", async (c) => {
  const cookie = getCookieName();
  await db
    .delete(sessions)
    .where(eq(sessions.key, digest(getCookie(c, cookie) ?? "")));
  deleteCookie(c, cookie, { path: "/" });
  return c.json({ ok: true });
});
