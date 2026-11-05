import { Hono, type Context, type MiddlewareHandler } from "hono";
import { hashPassword, verifyPassword } from "./password";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, gte, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accounts,
  assets,
  audits,
  sessions,
} from "@optimax-starter/db/schema/console";
import { db } from "./services";

const fields = {
  id: accounts.id,
  username: accounts.username,
  name: accounts.name,
  role: accounts.role,
  active: accounts.active,
};
// Own profile only; the admin account list does not expose email or company.
const profileFields = {
  ...fields,
  email: accounts.email,
  company: accounts.company,
};
type Actor = {
  id: number;
  username: string;
  name: string;
  role: string;
  active: boolean;
};
type Env = { Variables: { actor: Actor } };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Party = { id: number; username: string; name: string };
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookie = "optimax_console";
const lifetime = 8 * 60 * 60;
const credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});
const accountInput = credentials.extend({
  password: z.string().min(10).max(256),
  name: z.string().trim().min(1).max(80),
  role: z.enum(["member", "admin"]),
});

export async function initializeConsole() {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.username, "demo@optimax.hk"));
  if (!existing) {
    const password = process.env.STARTER_ADMIN_PASSWORD;
    if (!password) throw new Error("Missing bootstrap password");
    await db
      .insert(accounts)
      .values({
        username: "demo@optimax.hk",
        name: "本地管理员",
        role: "admin",
        hash: await hashPassword(password),
      })
      .onConflictDoNothing();
  }
  const systems = [
    "采购门户",
    "库存服务",
    "订单中心",
    "供应商门户",
    "合同服务",
    "仓储平台",
    "运输管理",
    "结算中心",
    "质量平台",
    "报表服务",
    "数据目录",
    "客户门户",
  ];
  await db
    .insert(assets)
    .values(
      systems.map((name, i) => ({
        name,
        domain: ["采购", "履约", "运营"][i % 3]!,
        owner: ["业务运营组", "交付组", "平台组"][i % 3]!,
        stage: i % 4 === 1 ? "待复核" : "已登记",
      })),
    )
    .onConflictDoNothing();
}

// ---------------------------------------------------------------- shared guards
class Refusal extends Error {
  status: 400 | 401 | 403 | 404 | 409;
  constructor(status: 400 | 401 | 403 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}
async function guarded(c: Context<Env>, run: () => Promise<Response>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
}
// 所有管理员写入在同一把事务级咨询锁内串行执行，并在锁内复核操作者仍是启用的管理员。
const ADMIN_LOCK = sql`select pg_advisory_xact_lock(7140301)`;
async function lockAdmin(tx: Tx, actorId: number) {
  await tx.execute(ADMIN_LOCK);
  const [self] = await tx
    .select(fields)
    .from(accounts)
    .where(eq(accounts.id, actorId));
  if (!self?.active || self.role !== "admin")
    throw new Refusal(403, "需要管理员权限");
  return self;
}
// 按路由逐个挂载，避免 "/accounts" 与 "/accounts/*" 两条 use 让同一请求执行两次检查。
const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get("actor").role !== "admin")
    return c.json({ error: "需要管理员权限" }, 403);
  await next();
};

// ---------------------------------------------------------------- audit
const AUDIT_ACTIONS = [
  "account.create",
  "account.update",
  "account.role",
  "account.status",
  "account.password_reset",
  "account.revoke",
  "profile.update",
  "profile.password_change",
] as const;
type AuditAction = (typeof AUDIT_ACTIONS)[number];
// Fields allowed in detail. Never store passwords, hashes, cookies or tokens here.
type AuditDetail = {
  from?: string | boolean;
  to?: string | boolean;
  role?: string;
  sessions?: number;
  /** Names of changed profile fields only, never their values. */
  fields?: string[];
};
function audit(
  tx: Tx,
  action: AuditAction,
  actor: Party,
  target: Party | null,
  detail: AuditDetail = {},
) {
  return tx.insert(audits).values({
    action,
    actorId: actor.id,
    actorUsername: actor.username,
    actorName: actor.name,
    targetId: target?.id ?? null,
    targetUsername: target?.username ?? null,
    targetName: target?.name ?? null,
    detail,
  });
}
const AUDIT_MAX_PAGE = 100;
// 日期按 UTC+8 自然日解释，结束日期包含当天。
const AUDIT_OFFSET = "+08:00";
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  });
const dayStart = (s: string, plusDays = 0) =>
  new Date(new Date(`${s}T00:00:00${AUDIT_OFFSET}`).getTime() + plusDays * 864e5);
const auditQuery = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actor: z.string().trim().min(1).max(80).optional(),
  start: day.optional(),
  end: day.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((n) => Math.min(n, AUDIT_MAX_PAGE)),
});
const contains = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

// ---------------------------------------------------------------- session
export const consoleApi = new Hono<Env>();
consoleApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (
    c.req.method !== "GET" &&
    (c.req.header("origin") !== process.env.CORS_ORIGIN ||
      !c.req.header("content-type")?.startsWith("application/json"))
  )
    return c.json({ error: "请求来源无效" }, 403);
  if (c.req.path.endsWith("/login")) return next();
  const token = getCookie(c, cookie);
  const [actor] = token
    ? await db
        .select(fields)
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
  c.set("actor", actor);
  await next();
});
consoleApi.post("/login", async (c) => {
  const input = credentials.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "请输入账户和密码" }, 400);
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.username, input.data.username));
  if (
    !account?.active ||
    !(await verifyPassword(input.data.password, account.hash))
  )
    return c.json({ error: "账户或密码错误" }, 401);
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    key: digest(token),
    account: account.id,
    expires: new Date(Date.now() + lifetime * 1000),
  });
  setCookie(c, cookie, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: lifetime,
  });
  return c.json({ ok: true });
});
// ---------------------------------------------------------------- own profile (all roles)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// strict(): role, active, username and id are rejected, so a profile update cannot escalate privileges.
// The older {name} payload still works.
const profileInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    email: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === "" || EMAIL.test(v))
      .optional(),
    company: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine(
    (v) => v.name !== undefined || v.email !== undefined || v.company !== undefined,
  );
// No account ID is accepted, so this can only change the signed-in account.
const passwordChange = z
  .object({
    current: z.string().min(1).max(256),
    password: z.string().min(10).max(256),
  })
  .strict();

consoleApi.get("/me", async (c) => {
  const [row] = await db
    .select(profileFields)
    .from(accounts)
    .where(eq(accounts.id, c.get("actor").id));
  return row ? c.json(row) : c.json({ error: "请登录" }, 401);
});
consoleApi.patch("/me", async (c) => {
  const input = profileInput.safeParse(await c.req.json().catch(() => null));
  if (!input.success)
    return c.json({ error: "请检查显示名称、邮箱和公司" }, 400);
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
    if (email !== undefined && (email || null) !== before.email) set.email = email || null;
    if (company !== undefined && (company || null) !== before.company)
      set.company = company || null;
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
  return row ? c.json(row) : c.json({ error: "账户不存在" }, 404);
});
consoleApi.post("/me/password", async (c) => {
  const input = passwordChange.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "新密码需为 10–256 位" }, 400);
  if (input.data.current === input.data.password)
    return c.json({ error: "新密码不能与当前密码相同" }, 400);
  const id = c.get("actor").id;
  const key = digest(getCookie(c, cookie) ?? "");
  const hash = await hashPassword(input.data.password);
  return guarded(c, async () => {
    const revoked = await db.transaction(async (tx) => {
      // Takes the same lock as admin password resets and disables. Inside the lock, recheck that the account
      // and this session are still valid, read the latest hash, and verify the current password against it.
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
      if (!(await verifyPassword(input.data.current, self.hash)))
        throw new Refusal(400, "当前密码错误");
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
consoleApi.post("/logout", async (c) => {
  await db
    .delete(sessions)
    .where(eq(sessions.key, digest(getCookie(c, cookie)!)));
  deleteCookie(c, cookie, { path: "/" });
  return c.json({ ok: true });
});
consoleApi.get("/assets", async (c) =>
  c.json(await db.select().from(assets).orderBy(assets.id)),
);

// ---------------------------------------------------------------- accounts (admin)
const accountPatch = z
  .object({
    active: z.boolean().optional(),
    role: z.enum(["member", "admin"]).optional(),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine(
    (v) => v.active !== undefined || v.role !== undefined || v.name !== undefined,
  );
const passwordInput = z.object({ password: z.string().min(10).max(256) }).strict();
const accountId = (raw: string) => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

consoleApi.get("/accounts", requireAdmin, async (c) => {
  const [rows, live] = await Promise.all([
    db.select(fields).from(accounts).orderBy(accounts.id),
    db
      .select({ account: sessions.account, n: count() })
      .from(sessions)
      .where(gt(sessions.expires, new Date()))
      .groupBy(sessions.account),
  ]);
  const online = new Map(live.map((r) => [r.account, Number(r.n)]));
  return c.json(rows.map((r) => ({ ...r, sessions: online.get(r.id) ?? 0 })));
});
consoleApi.post("/accounts", requireAdmin, async (c) => {
  const parsed = accountInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: "请填写姓名、账户及至少 10 位密码" }, 400);
  const { password, ...info } = parsed.data;
  const hash = await hashPassword(password);
  return guarded(c, async () => {
    const added = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, c.get("actor").id);
      const [row] = await tx
        .insert(accounts)
        .values({ ...info, hash })
        .onConflictDoNothing()
        .returning(fields);
      if (!row) throw new Refusal(409, "账户名已存在");
      await audit(tx, "account.create", self, row, { role: row.role });
      return row;
    });
    return c.json({ ...added, sessions: 0 }, 201);
  });
});
consoleApi.patch("/accounts/:id", requireAdmin, async (c) => {
  const id = accountId(c.req.param("id"));
  const input = accountPatch.safeParse(await c.req.json().catch(() => null));
  if (!id || !input.success) return c.json({ error: "无效的账户设置" }, 400);
  const actor = c.get("actor");
  const change = input.data;
  if (id === actor.id && change.active === false)
    return c.json({ error: "不能停用当前账户" }, 400);
  if (id === actor.id && change.role === "member")
    return c.json({ error: "不能取消自己的管理员角色" }, 400);
  return guarded(c, async () => {
    const changed = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, actor.id);
      const [before] = await tx
        .select(fields)
        .from(accounts)
        .where(eq(accounts.id, id))
        .for("update");
      if (!before) throw new Refusal(404, "账户不存在");
      const set: { name?: string; role?: string; active?: boolean } = {};
      if (change.name !== undefined && change.name !== before.name)
        set.name = change.name;
      if (change.role !== undefined && change.role !== before.role)
        set.role = change.role;
      if (change.active !== undefined && change.active !== before.active)
        set.active = change.active;
      if (!Object.keys(set).length) return before;
      const [row] = await tx
        .update(accounts)
        .set(set)
        .where(eq(accounts.id, id))
        .returning(fields);
      const revoked =
        set.active === false
          ? (
              await tx
                .delete(sessions)
                .where(eq(sessions.account, id))
                .returning({ key: sessions.key })
            ).length
          : 0;
      const [admins] = await tx
        .select({ n: count() })
        .from(accounts)
        .where(and(eq(accounts.role, "admin"), eq(accounts.active, true)));
      if (!Number(admins?.n)) throw new Refusal(409, "至少保留一名启用的管理员");
      const target = row!;
      if (set.name !== undefined)
        await audit(tx, "account.update", self, target, {
          from: before.name,
          to: target.name,
        });
      if (set.role !== undefined)
        await audit(tx, "account.role", self, target, {
          from: before.role,
          to: target.role,
        });
      if (set.active !== undefined)
        await audit(tx, "account.status", self, target, {
          from: before.active,
          to: target.active,
          ...(set.active ? {} : { sessions: revoked }),
        });
      return target;
    });
    return c.json(changed);
  });
});
consoleApi.post("/accounts/:id/password", requireAdmin, async (c) => {
  const id = accountId(c.req.param("id"));
  const input = passwordInput.safeParse(await c.req.json().catch(() => null));
  if (!id || !input.success) return c.json({ error: "新密码至少 10 位" }, 400);
  const actor = c.get("actor");
  if (id === actor.id)
    return c.json({ error: "不能在账户管理中重置当前账户密码" }, 400);
  const hash = await hashPassword(input.data.password);
  return guarded(c, async () => {
    await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, actor.id);
      const [row] = await tx
        .update(accounts)
        .set({ hash })
        .where(eq(accounts.id, id))
        .returning(fields);
      if (!row) throw new Refusal(404, "账户不存在");
      const removed = await tx
        .delete(sessions)
        .where(eq(sessions.account, id))
        .returning({ key: sessions.key });
      await audit(tx, "account.password_reset", self, row, {
        sessions: removed.length,
      });
    });
    return c.json({ ok: true });
  });
});
consoleApi.post("/accounts/:id/revoke", requireAdmin, async (c) => {
  const id = accountId(c.req.param("id"));
  if (!id) return c.json({ error: "无效的账户" }, 400);
  const actor = c.get("actor");
  if (id === actor.id)
    return c.json({ error: "请使用退出登录结束当前会话" }, 400);
  return guarded(c, async () => {
    const revoked = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, actor.id);
      const [target] = await tx
        .select(fields)
        .from(accounts)
        .where(eq(accounts.id, id));
      if (!target) throw new Refusal(404, "账户不存在");
      const removed = await tx
        .delete(sessions)
        .where(eq(sessions.account, id))
        .returning({ key: sessions.key });
      await audit(tx, "account.revoke", self, target, {
        sessions: removed.length,
      });
      return removed.length;
    });
    return c.json({ revoked });
  });
});

// ---------------------------------------------------------------- audit (admin, read-only)
consoleApi.get("/audit", requireAdmin, async (c) => {
  const raw = Object.fromEntries(
    Object.entries(c.req.query()).filter(([, v]) => v.trim() !== ""),
  );
  const parsed = auditQuery.safeParse(raw);
  if (!parsed.success) return c.json({ error: "筛选条件无效" }, 400);
  const { action, actor, start, end, page, size } = parsed.data;
  if (start && end && start > end)
    return c.json({ error: "结束日期不能早于开始日期" }, 400);
  const where = and(
    action ? eq(audits.action, action) : undefined,
    actor
      ? or(
          ilike(audits.actorName, contains(actor)),
          ilike(audits.actorUsername, contains(actor)),
        )
      : undefined,
    start ? gte(audits.at, dayStart(start)) : undefined,
    end ? lt(audits.at, dayStart(end, 1)) : undefined,
  );
  const [items, totals] = await Promise.all([
    db
      .select()
      .from(audits)
      .where(where)
      .orderBy(desc(audits.at), desc(audits.id))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(audits).where(where),
  ]);
  return c.json({ items, total: Number(totals[0]?.n ?? 0), page, size });
});
