import {
  type ActorSource,
  DEFAULT_SESSION_TTL_HOURS,
  DEFAULT_SYSTEM_TIMEZONE,
  formatSessionTtlLabel,
  formatSystemTimezoneOptionLabel,
  normalizeSessionTtlHours,
  SYSTEM_TIMEZONE_OPTIONS,
  type SystemSettingsResponse,
} from "@optimax-starter/api";
import { systemSettings } from "@optimax-starter/db/schema/console";
import { inArray } from "drizzle-orm";
import { db } from "../services";
import { auditResource } from "./audit";
import { type Party, Refusal, type Tx } from "./guards";

export const SETTING_TIMEZONE = "timezone";
export const SETTING_SESSION_TTL_HOURS = "session.ttl_hours";
export const SETTING_AI_ENABLED = "ai.enabled";

type DbReader = Tx | typeof db;

const CACHE_TTL_MS = 2_000;
let cached: {
  expiresAt: number;
  timezone: string;
  timezoneSource: "database" | "env" | "default";
  timezoneUpdatedAt: string | null;
  sessionTtlHours: number;
  sessionTtlSource: "database" | "default";
  sessionTtlUpdatedAt: string | null;
  circuitOpen: boolean;
  aiUpdatedAt: string | null;
} | null = null;

export function invalidateSystemSettingsCache(): void {
  cached = null;
}

export function normalizeTimezone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return null;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
}

export function formatTimezoneLabel(timeZone: string): string {
  return formatSystemTimezoneOptionLabel(timeZone);
}

async function loadSettings(reader: DbReader = db) {
  const rows = await reader
    .select()
    .from(systemSettings)
    .where(
      inArray(systemSettings.key, [
        SETTING_TIMEZONE,
        SETTING_SESSION_TTL_HOURS,
        SETTING_AI_ENABLED,
      ]),
    );
  const map = new Map(rows.map((r) => [r.key, r]));

  const dbTzRow = map.get(SETTING_TIMEZONE);
  const dbTz = normalizeTimezone(dbTzRow?.value);
  const envTz = normalizeTimezone(process.env.STARTER_TIMEZONE || process.env.APP_TIMEZONE);
  const timezone = dbTz ?? envTz ?? DEFAULT_SYSTEM_TIMEZONE;
  const timezoneSource: "database" | "env" | "default" = dbTz
    ? "database"
    : envTz
      ? "env"
      : "default";

  const sessionTtlRow = map.get(SETTING_SESSION_TTL_HOURS);
  const dbTtl = normalizeSessionTtlHours(sessionTtlRow?.value);
  const sessionTtlHours = dbTtl ?? DEFAULT_SESSION_TTL_HOURS;
  const sessionTtlSource: "database" | "default" = dbTtl ? "database" : "default";

  const aiRow = map.get(SETTING_AI_ENABLED);
  const circuitOpen = aiRow?.value === "false";

  return {
    timezone,
    timezoneSource,
    timezoneUpdatedAt: dbTzRow?.updatedAt ? dbTzRow.updatedAt.toISOString() : null,
    sessionTtlHours,
    sessionTtlSource,
    sessionTtlUpdatedAt: sessionTtlRow?.updatedAt ? sessionTtlRow.updatedAt.toISOString() : null,
    circuitOpen,
    aiUpdatedAt: aiRow?.updatedAt ? aiRow.updatedAt.toISOString() : null,
  };
}

async function getSnapshot() {
  const now = Date.now();
  if (!cached || cached.expiresAt <= now) {
    const data = await loadSettings(db);
    cached = { expiresAt: now + CACHE_TTL_MS, ...data };
  }
  return cached;
}

export async function getConfiguredTimezone(): Promise<string> {
  return (await getSnapshot()).timezone;
}

export async function getConfiguredSessionTtlHours(reader?: DbReader): Promise<number> {
  if (reader && reader !== db) {
    return (await loadSettings(reader)).sessionTtlHours;
  }
  return (await getSnapshot()).sessionTtlHours;
}

export async function getConfiguredSessionTtlSeconds(reader?: DbReader): Promise<number> {
  return (await getConfiguredSessionTtlHours(reader)) * 60 * 60;
}

export async function isAiCircuitOpen(): Promise<boolean> {
  return (await getSnapshot()).circuitOpen;
}

export async function getAiCircuitState(): Promise<{
  circuitOpen: boolean;
  updatedAt: string | null;
}> {
  const snap = await getSnapshot();
  return { circuitOpen: snap.circuitOpen, updatedAt: snap.aiUpdatedAt };
}

export async function getSystemSettingsPayload(
  reader: DbReader = db,
): Promise<SystemSettingsResponse> {
  const snap = reader === db ? await getSnapshot() : await loadSettings(reader);
  return {
    timezone: snap.timezone,
    timezoneLabel: formatTimezoneLabel(snap.timezone),
    source: snap.timezoneSource,
    updatedAt: snap.timezoneUpdatedAt,
    timezoneOptions: SYSTEM_TIMEZONE_OPTIONS,
    sessionTtlHours: snap.sessionTtlHours,
    sessionTtlLabel: formatSessionTtlLabel(snap.sessionTtlHours),
    sessionTtlSource: snap.sessionTtlSource,
    sessionTtlUpdatedAt: snap.sessionTtlUpdatedAt,
  };
}

export async function updateSystemSettingsTx(
  tx: Tx,
  actor: Party,
  input: { timezone?: string; sessionTtlHours?: number },
  actorSource: ActorSource = "human",
): Promise<SystemSettingsResponse> {
  if (input.timezone === undefined && input.sessionTtlHours === undefined) {
    throw new Refusal(422, "请至少提交一项要更新的系统配置");
  }
  const normalizedTz = input.timezone !== undefined ? normalizeTimezone(input.timezone) : undefined;
  if (input.timezone !== undefined && !normalizedTz) {
    throw new Refusal(422, "请选择有效的系统时区");
  }
  const normalizedTtl =
    input.sessionTtlHours !== undefined
      ? normalizeSessionTtlHours(input.sessionTtlHours)
      : undefined;
  if (input.sessionTtlHours !== undefined && normalizedTtl === null) {
    throw new Refusal(422, "请选择有效的登录有效期");
  }

  const before = await loadSettings(tx);
  const now = new Date();

  if (normalizedTz) {
    await tx
      .insert(systemSettings)
      .values({
        key: SETTING_TIMEZONE,
        value: normalizedTz,
        updatedAt: now,
        updatedBy: actor.id,
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: normalizedTz,
          updatedAt: now,
          updatedBy: actor.id,
        },
      });

    if (before.timezone !== normalizedTz) {
      await auditResource(
        tx,
        "system.timezone_update",
        actor,
        { code: SETTING_TIMEZONE, name: "系统时区" },
        { from: before.timezone, to: normalizedTz },
        actorSource,
      );
    }
  }

  if (normalizedTtl !== undefined && normalizedTtl !== null) {
    const ttlStr = String(normalizedTtl);
    await tx
      .insert(systemSettings)
      .values({
        key: SETTING_SESSION_TTL_HOURS,
        value: ttlStr,
        updatedAt: now,
        updatedBy: actor.id,
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: ttlStr,
          updatedAt: now,
          updatedBy: actor.id,
        },
      });

    if (before.sessionTtlHours !== normalizedTtl) {
      await auditResource(
        tx,
        "system.session_ttl_update",
        actor,
        { code: SETTING_SESSION_TTL_HOURS, name: "登录有效期（小时）" },
        { from: before.sessionTtlHours, to: normalizedTtl },
        actorSource,
      );
    }
  }

  return getSystemSettingsPayload(tx);
}

export async function updateSystemTimezoneTx(
  tx: Tx,
  actor: Party,
  rawTimezone: string,
  actorSource: ActorSource = "human",
): Promise<SystemSettingsResponse> {
  return updateSystemSettingsTx(tx, actor, { timezone: rawTimezone }, actorSource);
}

export async function updateAiCircuitTx(
  tx: Tx,
  actor: Party,
  enabled: boolean,
  actorSource: ActorSource = "human",
): Promise<{ circuitOpen: boolean; updatedAt: string }> {
  const before = await loadSettings(tx);
  const beforeEnabled = !before.circuitOpen;
  const now = new Date();

  await tx
    .insert(systemSettings)
    .values({
      key: SETTING_AI_ENABLED,
      value: enabled ? "true" : "false",
      updatedAt: now,
      updatedBy: actor.id,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: enabled ? "true" : "false",
        updatedAt: now,
        updatedBy: actor.id,
      },
    });

  if (beforeEnabled !== enabled) {
    await auditResource(
      tx,
      "system.ai_circuit",
      actor,
      { code: SETTING_AI_ENABLED, name: "AI 全局熔断开关" },
      { from: beforeEnabled, to: enabled },
      actorSource,
    );
  }

  return { circuitOpen: !enabled, updatedAt: now.toISOString() };
}
