// Personal API tokens (Bearer). Management is interactive-only (Cookie session); Bearer callers get 403.
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { apiTokenCreateSchema, type ActorSource, type ApiToken } from "@optimax-starter/api";
import { accounts, apiTokens } from "@optimax-starter/db/schema/console";
import { db } from "../services";
import { audit } from "../core/audit";
import {
  PERMISSION_SHARED_LOCK,
  Refusal,
  accountFields,
  digest,
  errorJson,
  guarded,
  jsonBody,
  parsePositiveId,
  requireCookieSession,
  type Env,
} from "../core/guards";
import { getEffectivePermissionsTx } from "../core/permissions";

export const MAX_ACTIVE_TOKENS_PER_ACCOUNT = 20;

type TokenRow = typeof apiTokens.$inferSelect;

const toApiToken = (row: TokenRow): ApiToken => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scopes: Array.isArray(row.scopes) ? row.scopes : [],
  actorSource: row.actorSource as ActorSource,
  expiresAt: row.expiresAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  lastUsedIp: row.lastUsedIp ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** Scopes must be a subset of the caller's current effective permissions. */
export function findUnheldScopes(scopes: readonly string[], held: readonly string[]): string[] {
  return [...new Set(scopes)].filter((s) => !held.includes(s));
}

export const tokensRoutes = new Hono<Env>()
  .get("/me/tokens", requireCookieSession, async (c) => {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.accountId, c.get("actor").id))
      .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
    return c.json(rows.map(toApiToken));
  })
  .post(
    "/me/tokens",
    requireCookieSession,
    jsonBody(apiTokenCreateSchema, (error) => error.issues[0]?.message ?? "请检查密钥名称、权限与有效期"),
    async (c) => {
      const input = c.req.valid("json");
      const actor = c.get("actor");
      const scopes = [...new Set(input.scopes)];
      if (findUnheldScopes(scopes, actor.permissions).length) {
        return errorJson(c, 403, "不能授予当前账户未持有的权限");
      }
      return guarded(c, async () => {
        const raw = `optx_${randomBytes(24).toString("base64url")}`;
        const prefix = raw.slice(0, 12);
        const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);
        const row = await db.transaction(async (tx) => {
          await tx.execute(PERMISSION_SHARED_LOCK);
          const [self] = await tx.select(accountFields).from(accounts).where(eq(accounts.id, actor.id));
          if (!self?.active) throw new Refusal(403, "无权执行该操作");
          // Re-check against live role permissions inside the lock.
          const live = await getEffectivePermissionsTx(tx, self.role);
          if (findUnheldScopes(scopes, live).length) {
            throw new Refusal(403, "不能授予当前账户未持有的权限");
          }
          const active = await tx
            .select({ id: apiTokens.id })
            .from(apiTokens)
            .where(
              and(
                eq(apiTokens.accountId, actor.id),
                isNull(apiTokens.revokedAt),
                gt(apiTokens.expiresAt, new Date()),
              ),
            );
          if (active.length >= MAX_ACTIVE_TOKENS_PER_ACCOUNT) {
            throw new Refusal(409, `每个账户最多保留 ${MAX_ACTIVE_TOKENS_PER_ACCOUNT} 个有效密钥`);
          }
          const [created] = await tx
            .insert(apiTokens)
            .values({
              accountId: actor.id,
              name: input.name,
              prefix,
              tokenHash: digest(raw),
              scopes,
              actorSource: input.actorSource,
              expiresAt,
              createdBy: actor.id,
            })
            .returning();
          await audit(
            tx,
            "token.create",
            self,
            self,
            {
              prefix,
              actorSource: input.actorSource,
              scopes,
              expiresAt: expiresAt.toISOString(),
            },
            actor.actorSource,
          );
          return created!;
        });
        return c.json({ token: toApiToken(row), plainToken: raw }, 201);
      });
    },
  )
  .delete("/me/tokens/:id", requireCookieSession, async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return errorJson(c, 400, "无效的密钥");
    const actor = c.get("actor");
    return guarded(c, async () => {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(apiTokens.id, id), eq(apiTokens.accountId, actor.id), isNull(apiTokens.revokedAt)))
          .returning();
        if (!row) throw new Refusal(404, "密钥不存在或已撤销");
        await audit(tx, "token.revoke", actor, actor, { prefix: row.prefix }, actor.actorSource);
      });
      return c.json({ ok: true });
    });
  });
