import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler, TypedResponse } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import type { ActorSource } from "@optimax-starter/api";
import { accounts } from "@optimax-starter/db/schema/console";
import type { db } from "../services";
import { Refusal, errorJson, refusalJson, type ErrorBody } from "./http";
import { getEffectivePermissionsTx } from "./permissions";

export {
  Refusal,
  defaultErrorCode,
  errorJson,
  getClientIp,
  getRequestId,
  refusalJson,
  resolveRequestId,
  type ErrorBody,
  type ErrorStatus,
} from "./http";

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
  /** Effective permissions. Bearer: live role permissions ∩ token scopes. */
  permissions: string[];
  /** "cookie" = interactive browser session; "bearer" = API token (service account / agent). */
  authType: "cookie" | "bearer";
  /** Written to console_audit.actor_source for every write made by this actor. */
  actorSource: ActorSource;
  /** Present for Bearer callers only. */
  tokenId?: number;
};

// Pure Bearer helpers live in ./bearer (DB-free, unit-tested) and are re-exported here.
export { requireCookieSession, resolveTokenPermissions } from "./bearer";

export type Env = { Variables: { actor: Actor; requestId: string } };
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Party = { id: number; username: string; name: string };

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function guarded<T extends Response>(
  c: Context<Env>,
  run: () => Promise<T>,
): Promise<T | TypedResponse<ErrorBody, Refusal["status"]>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal) {
      return refusalJson(c, error);
    }
    throw error;
  }
}

export function jsonBody<TOut>(
  schema: z.ZodType<TOut>,
  errorMessage: string | ((error: z.ZodError) => string),
) {
  return validator("json", (value: unknown, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const msg =
        typeof errorMessage === "function"
          ? errorMessage(parsed.error)
          : errorMessage;
      return errorJson(c, 400, msg, "VALIDATION_BAD_REQUEST");
    }
    return parsed.data;
  });
}

// 同一 key 的两种事务级咨询锁：
// - ADMIN_LOCK（独占）：账户角色/状态/密码/邀请、权限矩阵、系统设置、本人改密等安全状态写入，彼此串行；
// - PERMISSION_SHARED_LOCK（共享）：普通业务写入（资产、生成模块）互不阻塞，但与独占锁互斥，
//   因此权限或账户状态变更会等待在途业务写入提交后才生效，且之后的业务写入会在锁内读取到新权限。
export const ADMIN_LOCK = sql`select pg_advisory_xact_lock(7140301)`;
export const PERMISSION_SHARED_LOCK = sql`select pg_advisory_xact_lock_shared(7140301)`;

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
  options?: { exclusive?: boolean },
) {
  await tx.execute(options?.exclusive ? ADMIN_LOCK : PERMISSION_SHARED_LOCK);
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
    return errorJson(c, 403, "需要超级管理员权限");
  }
  await next();
};

export const requirePermission =
  (permission: string): MiddlewareHandler<Env> =>
  async (c, next) => {
    if (!c.get("actor").permissions.includes(permission)) {
      return errorJson(c, 403, "无权执行该操作");
    }
    await next();
  };

export const requireAnyPermission =
  (...permissions: string[]): MiddlewareHandler<Env> =>
  async (c, next) => {
    const held = c.get("actor").permissions;
    if (!permissions.some((code) => held.includes(code))) {
      return errorJson(c, 403, "无权执行该操作");
    }
    await next();
  };

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  const role = c.get("actor").role;
  if (role !== "admin" && role !== "super_admin") {
    return errorJson(c, 403, "需要管理员权限");
  }
  await next();
};

export const parsePositiveId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
