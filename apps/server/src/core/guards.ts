import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { accounts } from "@optimax-starter/db/schema/console";
import type { db } from "../services";

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
};

export type Env = { Variables: { actor: Actor } };
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Party = { id: number; username: string; name: string };

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class Refusal extends Error {
  status: 400 | 401 | 403 | 404 | 409;
  constructor(status: 400 | 401 | 403 | 404 | 409, message: string) {
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

// 所有管理员写入在同一把事务级咨询锁内串行执行，并在锁内复核操作者仍是启用的管理员。
export const ADMIN_LOCK = sql`select pg_advisory_xact_lock(7140301)`;

export async function lockAdmin(tx: Tx, actorId: number) {
  await tx.execute(ADMIN_LOCK);
  const [self] = await tx
    .select(accountFields)
    .from(accounts)
    .where(eq(accounts.id, actorId));
  if (!self?.active || self.role !== "admin") {
    throw new Refusal(403, "需要管理员权限");
  }
  return self;
}

// 按路由逐个挂载，避免 "/accounts" 与 "/accounts/*" 两条 use 让同一请求执行两次检查。
export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get("actor").role !== "admin") {
    return c.json({ error: "需要管理员权限" }, 403);
  }
  await next();
};

export const parsePositiveId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
