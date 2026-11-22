import { randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import {
  INVITE_TTL_HOURS,
  accountCreateSchema,
  accountPatchSchema,
  passwordResetSchema,
  type AccountInviteLink,
  type ActorSource,
} from "@optimax-starter/api";
import { accountInvites, accounts, apiTokens, sessions } from "@optimax-starter/db/schema/console";
import { hashPassword } from "../password";
import { db } from "../services";
import { audit } from "../core/audit";
import { getBootstrapAdminUsername } from "../core/config";
import {
  Refusal,
  accountFields,
  digest,
  errorJson,
  guarded,
  jsonBody,
  lockPermission,
  parsePositiveId,
  profileFields,
  requirePermission,
  type Env,
  type Party,
  type Tx,
} from "../core/guards";
import { clearUserGuard } from "../core/login-guard";

// Account mutations change security state, so they take the exclusive ADMIN_LOCK
// (business writes only take the shared lock and are drained first).
const EXCLUSIVE = { exclusive: true } as const;

/** Revokes pending links for an account; returns how many were revoked. */
async function revokePendingInvites(tx: Tx, accountId: number) {
  const revoked = await tx
    .update(accountInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accountInvites.accountId, accountId),
        isNull(accountInvites.usedAt),
        isNull(accountInvites.revokedAt),
      ),
    )
    .returning({ id: accountInvites.id });
  return revoked.length;
}

/** Revokes every active API token of an account (disable / force-logout / password reset). */
async function revokeApiTokens(tx: Tx, accountId: number) {
  const revoked = await tx
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.accountId, accountId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return revoked.length;
}

/** Issues a fresh 72h one-time link. Only digest(token) is stored; the raw token is returned once. */
async function issueInvite(
  tx: Tx,
  self: Party,
  target: Party,
  actorSource: ActorSource = "human",
): Promise<AccountInviteLink> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
  await tx.insert(accountInvites).values({
    tokenHash: digest(token),
    accountId: target.id,
    createdBy: self.id,
    expiresAt,
  });
  await audit(
    tx,
    "account.invite_create",
    self,
    target,
    { expiresAt: expiresAt.toISOString() },
    actorSource,
  );
  return { invitePath: `/invite/${token}`, expiresAt: expiresAt.toISOString() };
}

export const accountsRoutes = new Hono<Env>()
  .get("/accounts", requirePermission("accounts:read"), async (c) => {
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
  })
  .post(
    "/accounts",
    requirePermission("accounts:manage"),
    jsonBody(accountCreateSchema, "请检查姓名、账户、初始密码及资料格式"),
    async (c) => {
      const { password, email, company, inviteOnly, ...info } = c.req.valid("json");
      const nextEmail = email?.trim() || null;
      const nextCompany = company?.trim() || null;
      // Invite-only accounts get an unguessable throwaway password and stay disabled until activated.
      const hash = await hashPassword(
        inviteOnly ? randomBytes(32).toString("hex") : (password as string),
      );
      return guarded(c, async () => {
        const added = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, c.get("actor").id, "accounts:manage", EXCLUSIVE);
          if (self.role !== "super_admin" && info.role !== "member") {
            throw new Refusal(403, "需要超级管理员权限才能分配管理员角色");
          }
          const [row] = await tx
            .insert(accounts)
            .values({
              ...info,
              email: nextEmail,
              company: nextCompany,
              hash,
              ...(inviteOnly ? { active: false } : {}),
            })
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
          }, c.get("actor").actorSource);
          const invite = inviteOnly
            ? await issueInvite(tx, self, row, c.get("actor").actorSource)
            : null;
          return { row, invite };
        });
        return c.json(
          { ...added.row, sessions: 0, ...(added.invite ?? {}) },
          201,
        );
      });
    },
  )
  .patch(
    "/accounts/:id",
    requirePermission("accounts:manage"),
    jsonBody(accountPatchSchema, "无效的账户设置"),
    async (c) => {
      const id = parsePositiveId(c.req.param("id"));
      const change = c.req.valid("json");
      if (!id) return errorJson(c, 400, "无效的账户设置");
      const actor = c.get("actor");
      if (id === actor.id && change.active === false) {
        return errorJson(c, 400, "不能停用当前账户");
      }
      if (id === actor.id && change.role !== undefined && change.role !== actor.role) {
        return errorJson(c, 400, "不能更改当前账户的角色");
      }
      return guarded(c, async () => {
        const changed = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, actor.id, "accounts:manage", EXCLUSIVE);
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
          if (set.active === false) {
            // A disabled account must not be re-enabled through an old activation link.
            await revokePendingInvites(tx, id);
            await revokeApiTokens(tx, id);
          }
          if (set.active === true) {
            await clearUserGuard(tx, before.username);
          }
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
            }, c.get("actor").actorSource);
          }
          if (set.role !== undefined) {
            await audit(tx, "account.role", self, target, {
              from: before.role,
              to: target.role,
            }, c.get("actor").actorSource);
          }
          if (set.active !== undefined) {
            await audit(tx, "account.status", self, target, {
              from: before.active,
              to: target.active,
              ...(set.active ? {} : { sessions: revoked }),
            }, c.get("actor").actorSource);
          }
          return target;
        });
        return c.json(changed);
      });
    },
  )
  .post(
    "/accounts/:id/password",
    requirePermission("accounts:manage"),
    jsonBody(passwordResetSchema, "新密码至少 10 位"),
    async (c) => {
      const id = parsePositiveId(c.req.param("id"));
      const data = c.req.valid("json");
      if (!id) return errorJson(c, 400, "新密码至少 10 位");
      const actor = c.get("actor");
      if (id === actor.id) {
        return errorJson(c, 400, "不能在账户管理中重置当前账户密码");
      }
      const hash = await hashPassword(data.password);
      return guarded(c, async () => {
        await db.transaction(async (tx) => {
          const self = await lockPermission(tx, actor.id, "accounts:manage", EXCLUSIVE);
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
          await revokeApiTokens(tx, id);
          await clearUserGuard(tx, row!.username);
          await audit(tx, "account.password_reset", self, row!, {
            sessions: removed.length,
          }, c.get("actor").actorSource);
        });
        return c.json({ ok: true });
      });
    },
  )
  .post(
    "/accounts/:id/revoke",
    requirePermission("accounts:manage"),
    async (c) => {
      const id = parsePositiveId(c.req.param("id"));
      if (!id) return errorJson(c, 400, "无效的账户");
      const actor = c.get("actor");
      if (id === actor.id) {
        return errorJson(c, 400, "请使用退出登录结束当前会话");
      }
      return guarded(c, async () => {
        const revoked = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, actor.id, "accounts:manage", EXCLUSIVE);
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
          await revokeApiTokens(tx, id);
          await audit(tx, "account.revoke", self, target, {
            sessions: removed.length,
          }, c.get("actor").actorSource);
          return removed.length;
        });
        return c.json({ revoked });
      });
    },
  )
  .post(
    "/accounts/:id/invite",
    requirePermission("accounts:manage"),
    async (c) => {
      const id = parsePositiveId(c.req.param("id"));
      if (!id) return errorJson(c, 400, "无效的账户");
      const actor = c.get("actor");
      if (id === actor.id) {
        return errorJson(c, 400, "不能为当前账户生成激活链接");
      }
      return guarded(c, async () => {
        const link = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, actor.id, "accounts:manage", EXCLUSIVE);
          const [target] = await tx
            .select(accountFields)
            .from(accounts)
            .where(eq(accounts.id, id))
            .for("update");
          if (!target) throw new Refusal(404, "账户不存在");
          if (self.role !== "super_admin" && target.role !== "member") {
            throw new Refusal(403, "普通管理员仅可维护成员账户");
          }
          const revoked = await revokePendingInvites(tx, id);
          if (revoked > 0) {
            await audit(tx, "account.invite_revoke", self, target, { matched: revoked }, c.get("actor").actorSource);
          }
          return issueInvite(tx, self, target, c.get("actor").actorSource);
        });
        return c.json(link, 201);
      });
    },
  );
