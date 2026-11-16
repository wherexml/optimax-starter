import { z } from "zod";
import { audits } from "@optimax-starter/db/schema/console";
import { AUDIT_ACTIONS, type AuditAction, type AuditDetail } from "@optimax-starter/api";
import type { Party, Tx } from "./guards";

export function audit(
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

// Non-account business entities keep targetId=null (console_audit.target_id references console_account.id)
// while recording human-readable code/name and numeric entityId so audit rows survive entity deletion.
export function auditResource(
  tx: Tx,
  action: AuditAction,
  actor: Party,
  resource: { id: number; code: string; name: string },
  detail: AuditDetail = {},
) {
  return tx.insert(audits).values({
    action,
    actorId: actor.id,
    actorUsername: actor.username,
    actorName: actor.name,
    targetId: null,
    targetUsername: resource.code,
    targetName: resource.name,
    detail: { entityId: resource.id, ...detail },
  });
}

export const AUDIT_MAX_PAGE = 100;
// 日期按 UTC+8 自然日解释，结束日期包含当天。
const AUDIT_OFFSET = "+08:00";

export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  });

export const dayStart = (s: string, plusDays = 0) =>
  new Date(new Date(`${s}T00:00:00${AUDIT_OFFSET}`).getTime() + plusDays * 864e5);

export const auditQuerySchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actor: z.string().trim().min(1).max(80).optional(),
  start: daySchema.optional(),
  end: daySchema.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((n) => Math.min(n, AUDIT_MAX_PAGE)),
});

export const containsPattern = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;
