// PostgreSQL-backed login rate limiting and lockout (AUTH.md §4).
// Two buckets: `user:<lowerUsername>` (5 failures / 30 min -> 30 min lock) and
// `ip:<clientIp>` (20 failures / 15 min -> 30 min lock, NAT-friendly).
// This module never imports the DB singleton: callers pass a writer so pure helpers stay unit-testable.
import { inArray, sql } from "drizzle-orm";
import { loginGuards } from "@optimax-starter/db/schema/console";
import type { db as Db } from "../services";
import type { Tx } from "./guards";

type GuardWriter = Tx | typeof Db;

export type GuardPolicy = {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
};

const MINUTE = 60_000;

export const USER_POLICY: GuardPolicy = {
  maxFailures: 5,
  windowMs: 30 * MINUTE,
  lockMs: 30 * MINUTE,
};

export const IP_POLICY: GuardPolicy = {
  maxFailures: 20,
  windowMs: 15 * MINUTE,
  lockMs: 30 * MINUTE,
};

export type GuardState = {
  failures: number;
  windowStart: Date;
  lockedUntil: Date | null;
};

export const userGuardKey = (username: string) =>
  `user:${username.trim().toLowerCase().slice(0, 80)}`;
export const ipGuardKey = (ip: string) => `ip:${ip.slice(0, 64)}`;

export function isLocked(state: Pick<GuardState, "lockedUntil"> | null | undefined, now: Date) {
  return Boolean(state?.lockedUntil && state.lockedUntil.getTime() > now.getTime());
}

/** Pure mirror of the SQL upsert in `recordFailure`, used by unit tests and documentation. */
export function nextFailureState(
  prev: GuardState | null,
  now: Date,
  policy: GuardPolicy,
): GuardState {
  const reset =
    !prev ||
    prev.windowStart.getTime() <= now.getTime() - policy.windowMs ||
    (prev.lockedUntil !== null && prev.lockedUntil.getTime() <= now.getTime());
  const failures = reset ? 1 : prev.failures + 1;
  const windowStart = reset ? now : prev.windowStart;
  const lockedUntil =
    failures >= policy.maxFailures
      ? new Date(now.getTime() + policy.lockMs)
      : reset
        ? null
        : prev.lockedUntil;
  return { failures, windowStart, lockedUntil };
}

export function retryAfterSeconds(lockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
}

export function lockedMessage(seconds: number): string {
  return `登录失败次数过多，请于 ${Math.max(1, Math.ceil(seconds / 60))} 分钟后再试`;
}

/** Returns the latest active lock among `keys`, or null when none is locked. */
export async function findActiveLock(
  writer: GuardWriter,
  keys: string[],
  now = new Date(),
): Promise<{ key: string; lockedUntil: Date } | null> {
  if (!keys.length) return null;
  const rows = await writer
    .select({ key: loginGuards.key, lockedUntil: loginGuards.lockedUntil })
    .from(loginGuards)
    .where(inArray(loginGuards.key, keys));
  let found: { key: string; lockedUntil: Date } | null = null;
  for (const row of rows) {
    if (row.lockedUntil && isLocked(row, now)) {
      if (!found || row.lockedUntil > found.lockedUntil) {
        found = { key: row.key, lockedUntil: row.lockedUntil };
      }
    }
  }
  return found;
}

/** Atomically increments one bucket (single upsert, safe under concurrent failures). */
export async function recordFailure(
  writer: GuardWriter,
  key: string,
  policy: GuardPolicy,
): Promise<{ failures: number; lockedUntil: Date | null }> {
  const windowSec = Math.round(policy.windowMs / 1000);
  const lockSec = Math.round(policy.lockMs / 1000);
  const reset = sql.raw(
    `("console_login_guard"."window_start" <= now() - make_interval(secs => ${windowSec})` +
      ` OR ("console_login_guard"."locked_until" IS NOT NULL AND "console_login_guard"."locked_until" <= now()))`,
  );
  const nextFailures = sql`(CASE WHEN ${reset} THEN 1 ELSE "console_login_guard"."failures" + 1 END)`;
  const [row] = await writer
    .insert(loginGuards)
    .values({
      key,
      failures: 1,
      windowStart: sql`now()`,
      lockedUntil:
        policy.maxFailures <= 1 ? sql`now() + make_interval(secs => ${lockSec})` : null,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: loginGuards.key,
      set: {
        failures: nextFailures,
        windowStart: sql`(CASE WHEN ${reset} THEN now() ELSE "console_login_guard"."window_start" END)`,
        lockedUntil: sql`(CASE WHEN ${nextFailures} >= ${policy.maxFailures} THEN now() + make_interval(secs => ${lockSec}) WHEN ${reset} THEN NULL ELSE "console_login_guard"."locked_until" END)`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ failures: loginGuards.failures, lockedUntil: loginGuards.lockedUntil });
  return { failures: row?.failures ?? 1, lockedUntil: row?.lockedUntil ?? null };
}

export async function recordLoginFailure(writer: GuardWriter, username: string, ip: string) {
  // Unknown and known usernames are counted identically so the response never reveals existence.
  const [user] = await Promise.all([
    recordFailure(writer, userGuardKey(username), USER_POLICY),
    recordFailure(writer, ipGuardKey(ip), IP_POLICY),
  ]);
  return user;
}

export async function recordIpFailure(writer: GuardWriter, ip: string) {
  return recordFailure(writer, ipGuardKey(ip), IP_POLICY);
}

export async function clearUserGuard(writer: GuardWriter, username: string) {
  await writer.delete(loginGuards).where(inArray(loginGuards.key, [userGuardKey(username)]));
}

/** Housekeeping: drop rows whose window and lock both expired (called opportunistically). */
export async function pruneLoginGuards(writer: GuardWriter) {
  const keepSec = Math.round(Math.max(USER_POLICY.windowMs, IP_POLICY.windowMs, USER_POLICY.lockMs, IP_POLICY.lockMs) / 1000);
  await writer
    .delete(loginGuards)
    .where(
      sql`${loginGuards.updatedAt} < now() - make_interval(secs => ${keepSec}) AND (${loginGuards.lockedUntil} IS NULL OR ${loginGuards.lockedUntil} < now())`,
    );
}
