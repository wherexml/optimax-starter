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
import { getBootstrapAdminUsername } from "../core/config";
import {
  Refusal,
  accountFields,
  guarded,
  lockPermission,
  parsePositiveId,
  profileFields,
  requirePermission,
  type Env,
} from "../core/guards";

export const accountsRoutes = new Hono<Env>();

accountsRoutes.get("/accounts", requirePermission("accounts:read"), async (c) => {
  const [rows, live] = await Promise.all([
    db.select(profileFields).from(accounts).orderBy(accounts.id),
    db
      .select({ account: sessions.account, n: count() })
      .from(sessions)
      .where(gt(sessions.expires, new Date()))
      .groupBy(sessions.account),
  ]);
  const online = new Map(live.map((r) => [r.account, Number(r.n)]));
  return c.json(rows.map((r) => ({ ...r, sessions: online.get(r.id) ?? 0 })));
});

accountsRoutes.post("/accounts", requirePermission("accounts:manage"), async (c) => {
  const parsed = accountCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "请检查姓名、账户、初始密码及资料格式" }, 400);
  }
  const { password, email, company, ...info } = parsed.data;
  const nextEmail = email?.trim() || null;
  const nextCompany = company?.trim() || null;
  const hash = await hashPassword(password);
  return guarded(c, async () => {
    const added = await db.transaction(async (tx) => {
      const self = await lockPermission(tx, c.get("actor").id, "accounts:manage");
      if (self.role !== "super_admin" && info.role !== "member") {
        throw new Refusal(403, "需要超级管理员权限才能分配管理员角色");
      }
      const [row] = await tx
        .insert(accounts)
        .values({ ...info, email: nextEmail, company: nextCompany, hash })
        .onConflictDoNothing()
        .returning(profileFields);
      if (!row) throw new Refusal(409, "账户名已存在");
      const extraFields = [
        ...(nextEmail ? ["email"] : []),
        ...(nextCompany ? ["company"] : []),
      ];
      await audit(tx, "account.create", self, row, {
        role: row.role,
        ...(extraFields.length ? { fields: extraFields } : {}),
      });
      return row;
    });
    return c.json({ ...added, sessions: 0 }, 201);
  });
});

accountsRoutes.patch(
  "/accounts/:id",
  requirePermission("accounts:manage"),
  async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    const input = accountPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!id || !input.success) return c.json({ error: "无效的账户设置" }, 400);
    const actor = c.get("actor");
    const change = input.data;
    if (id === actor.id && change.active === false) {
      return c.json({ error: "不能停用当前账户" }, 400);
    }
    if (id === actor.id && change.role !== undefined && change.role !== actor.role) {
      return c.json({ error: "不能更改当前账户的角色" }, 400);
    }
    return guarded(c, async () => {
      const changed = await db.transaction(async (tx) => {
        const self = await lockPermission(tx, actor.id, "accounts:manage");
        const [before] = await tx
          .select(profileFields)
          .from(accounts)
          .where(eq(accounts.id, id))
          .for("update");
        if (!before) throw new Refusal(404, "账户不存在");
        if (self.role !== "super_admin") {
          if (change.role !== undefined && change.role !== before.role) {
            throw new Refusal(403, "需要超级管理员权限才能调整系统角色");
          }
          if (before.id !== self.id && before.role !== "member") {
            throw new Refusal(403, "普通管理员仅可维护成员账户");
          }
        }
        if (
          before.username === getBootstrapAdminUsername() &&
          (change.active === false ||
            (change.role !== undefined && change.role !== "super_admin"))
        ) {
          throw new Refusal(403, "核心超级管理员账户不可停用或降级");
        }
        const set: {
          name?: string;
          role?: string;
          active?: boolean;
          email?: string | null;
          company?: string | null;
        } = {};
        if (change.name !== undefined && change.name !== before.name) {
          set.name = change.name;
        }
        if (change.email !== undefined && (change.email || null) !== before.email) {
          set.email = change.email || null;
        }
        if (
          change.company !== undefined &&
          (change.company || null) !== before.company
        ) {
          set.company = change.company || null;
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
          .returning(profileFields);
        const revoked =
          set.active === false
            ? (
                await tx
                  .delete(sessions)
                  .where(eq(sessions.account, id))
                  .returning({ key: sessions.key })
              ).length
            : 0;
        const [superAdmins] = await tx
          .select({ n: count() })
          .from(accounts)
          .where(and(eq(accounts.role, "super_admin"), eq(accounts.active, true)));
        if (!Number(superAdmins?.n)) {
          throw new Refusal(409, "至少保留一名启用的超级管理员");
        }
        const target = row!;
        const profileChanged = [
          ...(set.name !== undefined ? ["name"] : []),
          ...(set.email !== undefined ? ["email"] : []),
          ...(set.company !== undefined ? ["company"] : []),
        ];
        if (profileChanged.length) {
          await audit(tx, "account.update", self, target, {
            ...(set.name !== undefined
              ? { from: before.name, to: target.name }
              : {}),
            ...(set.email !== undefined || set.company !== undefined
              ? { fields: profileChanged }
              : {}),
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
  },
);

accountsRoutes.post(
  "/accounts/:id/password",
  requirePermission("accounts:manage"),
  async (c) => {
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
        const self = await lockPermission(tx, actor.id, "accounts:manage");
        const [before] = await tx
          .select(accountFields)
          .from(accounts)
          .where(eq(accounts.id, id))
          .for("update");
        if (!before) throw new Refusal(404, "账户不存在");
        if (self.role !== "super_admin" && before.role !== "member") {
          throw new Refusal(403, "普通管理员仅可维护成员账户");
        }
        const [row] = await tx
          .update(accounts)
          .set({ hash })
          .where(eq(accounts.id, id))
          .returning(accountFields);
        const removed = await tx
          .delete(sessions)
          .where(eq(sessions.account, id))
          .returning({ key: sessions.key });
        await audit(tx, "account.password_reset", self, row!, {
          sessions: removed.length,
        });
      });
      return c.json({ ok: true });
    });
  },
);

accountsRoutes.post(
  "/accounts/:id/revoke",
  requirePermission("accounts:manage"),
  async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return c.json({ error: "无效的账户" }, 400);
    const actor = c.get("actor");
    if (id === actor.id) {
      return c.json({ error: "请使用退出登录结束当前会话" }, 400);
    }
    return guarded(c, async () => {
      const revoked = await db.transaction(async (tx) => {
        const self = await lockPermission(tx, actor.id, "accounts:manage");
        const [target] = await tx
          .select(accountFields)
          .from(accounts)
          .where(eq(accounts.id, id))
          .for("update");
        if (!target) throw new Refusal(404, "账户不存在");
        if (self.role !== "super_admin" && target.role !== "member") {
          throw new Refusal(403, "普通管理员仅可维护成员账户");
        }
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
  },
);
