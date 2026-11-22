import { z } from "zod";
import { audits } from "@optimax-starter/db/schema/console";
import {
  ACTOR_SOURCES,
  AUDIT_ACTIONS,
  DEFAULT_SYSTEM_TIMEZONE,
  type ActorSource,
  type AuditAction,
  type AuditDetail,
} from "@optimax-starter/api";
import type { db } from "../services";
import type { Party, Tx } from "./guards";

type AuditWriter = Tx | typeof db;

const REDACTED = "[REDACTED]";
const SENSITIVE_PARTS = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "hash",
];
const SENSITIVE_EXACT = new Set([
  "code",
  "otp",
  "pwd",
  "prompt",
  "instruction",
  "sms",
  "smscode",
  "verifycode",
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    SENSITIVE_EXACT.has(normalized) ||
    SENSITIVE_PARTS.some((part) => normalized.includes(part))
  );
}

export function sanitizeAuditDetail(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditDetail(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = isSensitiveKey(key) ? REDACTED : sanitizeAuditDetail(item);
    }
    return out;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function cleanRecord(detail: AuditDetail | Record<string, unknown>): Record<string, unknown> {
  return sanitizeAuditDetail(detail) as Record<string, unknown>;
}

// actor.id may be null for unauthenticated events (e.g. failed login of an unknown username);
// console_audit.actor_id is nullable.
export type AuditActor = Omit<Party, "id"> & { id: number | null };

export function audit(
  tx: AuditWriter,
  action: AuditAction,
  actor: AuditActor,
  target: Party | null,
  detail: AuditDetail = {},
  actorSource: ActorSource = "human",
) {
  return tx.insert(audits).values({
    action,
    actorSource,
    actorId: actor.id,
    actorUsername: actor.username,
    actorName: actor.name,
    targetId: target?.id ?? null,
    targetUsername: target?.username ?? null,
    targetName: target?.name ?? null,
    detail: cleanRecord(detail),
  });
}

// Non-account entities keep targetId=null (console_audit.target_id references console_account.id)
// while recording human-readable code/name so audit rows survive entity or role changes.
export function auditResource(
  tx: AuditWriter,
  action: AuditAction,
  actor: Party,
  resource: { id?: number; code: string; name: string },
  detail: AuditDetail = {},
  actorSource: ActorSource = "human",
) {
  const merged =
    resource.id !== undefined ? { entityId: resource.id, ...detail } : detail;
  return tx.insert(audits).values({
    action,
    actorSource,
    actorId: actor.id,
    actorUsername: actor.username,
    actorName: actor.name,
    targetId: null,
    targetUsername: resource.code,
    targetName: resource.name,
    detail: cleanRecord(merged),
  });
}

export const AUDIT_MAX_PAGE = 100;

export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  });

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  const zonedUtc = Date.UTC(
    map.year!,
    (map.month ?? 1) - 1,
    map.day ?? 1,
    map.hour ?? 0,
    map.minute ?? 0,
    map.second ?? 0,
  );
  return zonedUtc - utcMs;
}

// Computes exact local midnight in the configured IANA system timezone.
export function dayStart(
  s: string,
  plusDays = 0,
  timeZone = DEFAULT_SYSTEM_TIMEZONE,
): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1, d + plusDays, 0, 0, 0));
  const guess = target.getTime();
  const first = guess - zoneOffsetMs(guess, timeZone);
  const refined = guess - zoneOffsetMs(first, timeZone);
  return new Date(refined);
}

export const auditQuerySchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actor: z.string().trim().min(1).max(80).optional(),
  source: z.enum(ACTOR_SOURCES).optional(),
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
