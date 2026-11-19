import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { accounts } from "@optimax-starter/db/schema/console";
import type { db } from "../services";
import { getEffectivePermissionsTx } from "./permissions";

export const accountFields = {
  id: accounts.id,
  username: accounts.username,
  name: accounts.name,
  role: accounts.role,
  active: accounts.active,
};

// Profile fields returned to the signed-in user (/me) and admin account management (/accounts).
export const profileFields = {
  ...accountFields,
  email: accounts.email,
  company: accounts.company,
};

export type Actor = {
  id: number;
  username: string;
  name: string;
  role: string;
  active: boolean;
  permissions: string[];
};

export type Env = { Variables: { actor: Actor } };
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Party = { id: number; username: string; name: string };

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class Refusal extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 422;
  constructor(status: 400 | 401 | 403 | 404 | 409 | 422, message: string) {
    super(message);
    this.status = status;
  }
}

export async function guarded(c: Context<Env>, run: () => Promise<Response>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  }
}

// 所有系统管理与特权写入在同一把事务级咨询锁内串行执行，并在锁内复核操作者启用态、角色与实时有效权限。
export const ADMIN_LOCK = sql`select pg_advisory_xact_lock(7140301)`;

export async function lockSuperAdmin(tx: Tx, actorId: number) {
  await tx.execute(ADMIN_LOCK);
  const [self] = await tx
    .select(accountFields)
    .from(accounts)
    .where(eq(accounts.id, actorId));
  if (!self?.active || self.role !== "super_admin") {
    throw new Refusal(403, "需要超级管理员权限");
  }
  return self;
}

export async function lockPermission(
  tx: Tx,
  actorId: number,
  permission: string,
) {
  await tx.execute(ADMIN_LOCK);
  const [self] = await tx
    .select(accountFields)
    .from(accounts)
    .where(eq(accounts.id, actorId));
  if (!self?.active) {
    throw new Refusal(403, "无权执行该操作");
  }
  const effective = await getEffectivePermissionsTx(tx, self.role);
  if (!effective.includes(permission)) {
    throw new Refusal(403, "无权执行该操作");
  }
  return self;
}

export async function lockAdmin(tx: Tx, actorId: number) {
  await tx.execute(ADMIN_LOCK);
  const [self] = await tx
    .select(accountFields)
    .from(accounts)
    .where(eq(accounts.id, actorId));
  if (
    !self?.active ||
    (self.role !== "admin" && self.role !== "super_admin")
  ) {
    throw new Refusal(403, "需要管理员权限");
  }
  return self;
}

export const requireSuperAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get("actor").role !== "super_admin") {
    return c.json({ error: "需要超级管理员权限" }, 403);
  }
  await next();
};

export const requirePermission =
  (permission: string): MiddlewareHandler<Env> =>
  async (c, next) => {
    if (!c.get("actor").permissions.includes(permission)) {
      return c.json({ error: "无权执行该操作" }, 403);
    }
    await next();
  };

export const requireAnyPermission =
  (...permissions: string[]): MiddlewareHandler<Env> =>
  async (c, next) => {
    const held = c.get("actor").permissions;
    if (!permissions.some((code) => held.includes(code))) {
      return c.json({ error: "无权执行该操作" }, 403);
    }
    await next();
  };

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  const role = c.get("actor").role;
  if (role !== "admin" && role !== "super_admin") {
    return c.json({ error: "需要管理员权限" }, 403);
  }
  await next();
};

export const parsePositiveId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
