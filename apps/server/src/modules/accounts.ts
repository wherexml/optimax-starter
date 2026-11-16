import { and, count, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import {
  accountCreateSchema,
  accountPatchSchema,
  passwordResetSchema,
} from "@optimax-starter/api";
import { accounts, sessions } from "@optimax-starter/db/schema/console";
import { hashPassword } from "../password";
import { db } from "../services";
import { audit } from "../core/audit";
import {
  Refusal,
  accountFields,
  guarded,
  lockAdmin,
  parsePositiveId,
  requireAdmin,
  type Env,
} from "../core/guards";

export const accountsRoutes = new Hono<Env>();

accountsRoutes.get("/accounts", requireAdmin, async (c) => {
  const [rows, live] = await Promise.all([
    db.select(accountFields).from(accounts).orderBy(accounts.id),
    db
      .select({ account: sessions.account, n: count() })
      .from(sessions)
      .where(gt(sessions.expires, new Date()))
      .groupBy(sessions.account),
  ]);
  const online = new Map(live.map((r) => [r.account, Number(r.n)]));
  return c.json(rows.map((r) => ({ ...r, sessions: online.get(r.id) ?? 0 })));
});

accountsRoutes.post("/accounts", requireAdmin, async (c) => {
  const parsed = accountCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "请填写姓名、账户及至少 10 位密码" }, 400);
  }
  const { password, ...info } = parsed.data;
  const hash = await hashPassword(password);
  return guarded(c, async () => {
    const added = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, c.get("actor").id);
      const [row] = await tx
        .insert(accounts)
        .values({ ...info, hash })
        .onConflictDoNothing()
        .returning(accountFields);
      if (!row) throw new Refusal(409, "账户名已存在");
      await audit(tx, "account.create", self, row, { role: row.role });
      return row;
    });
    return c.json({ ...added, sessions: 0 }, 201);
  });
});

accountsRoutes.patch("/accounts/:id", requireAdmin, async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  const input = accountPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!id || !input.success) return c.json({ error: "无效的账户设置" }, 400);
  const actor = c.get("actor");
  const change = input.data;
  if (id === actor.id && change.active === false) {
    return c.json({ error: "不能停用当前账户" }, 400);
  }
  if (id === actor.id && change.role === "member") {
    return c.json({ error: "不能取消自己的管理员角色" }, 400);
  }
  return guarded(c, async () => {
    const changed = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, actor.id);
      const [before] = await tx
        .select(accountFields)
        .from(accounts)
        .where(eq(accounts.id, id))
        .for("update");
      if (!before) throw new Refusal(404, "账户不存在");
      const set: { name?: string; role?: string; active?: boolean } = {};
      if (change.name !== undefined && change.name !== before.name) {
        set.name = change.name;
      }
      if (change.role !== undefined && change.role !== before.role) {
        set.role = change.role;
      }
      if (change.active !== undefined && change.active !== before.active) {
        set.active = change.active;
      }
      if (!Object.keys(set).length) return before;
      const [row] = await tx
        .update(accounts)
        .set(set)
        .where(eq(accounts.id, id))
        .returning(accountFields);
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
      if (set.name !== undefined) {
        await audit(tx, "account.update", self, target, {
          from: before.name,
          to: target.name,
        });
      }
      if (set.role !== undefined) {
        await audit(tx, "account.role", self, target, {
          from: before.role,
          to: target.role,
        });
      }
      if (set.active !== undefined) {
        await audit(tx, "account.status", self, target, {
          from: before.active,
          to: target.active,
          ...(set.active ? {} : { sessions: revoked }),
        });
      }
      return target;
    });
    return c.json(changed);
  });
});

accountsRoutes.post("/accounts/:id/password", requireAdmin, async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  const input = passwordResetSchema.safeParse(await c.req.json().catch(() => null));
  if (!id || !input.success) return c.json({ error: "新密码至少 10 位" }, 400);
  const actor = c.get("actor");
  if (id === actor.id) {
    return c.json({ error: "不能在账户管理中重置当前账户密码" }, 400);
  }
  const hash = await hashPassword(input.data.password);
  return guarded(c, async () => {
    await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, actor.id);
      const [row] = await tx
        .update(accounts)
        .set({ hash })
        .where(eq(accounts.id, id))
        .returning(accountFields);
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

accountsRoutes.post("/accounts/:id/revoke", requireAdmin, async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  if (!id) return c.json({ error: "无效的账户" }, 400);
  const actor = c.get("actor");
  if (id === actor.id) {
    return c.json({ error: "请使用退出登录结束当前会话" }, 400);
  }
  return guarded(c, async () => {
    const revoked = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, actor.id);
      const [target] = await tx
        .select(accountFields)
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
