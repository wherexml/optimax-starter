import { inArray } from "drizzle-orm";
import { systemSettings } from "@optimax-starter/db/schema/console";
import {
  DEFAULT_SYSTEM_TIMEZONE,
  SYSTEM_TIMEZONE_OPTIONS,
  type ActorSource,
  type SystemSettingsResponse,
} from "@optimax-starter/api";
import { db } from "../services";
import { auditResource } from "./audit";
import { Refusal, type Party, type Tx } from "./guards";

export const SETTING_TIMEZONE = "timezone";
export const SETTING_AI_ENABLED = "ai.enabled";

type DbReader = Tx | typeof db;

const CACHE_TTL_MS = 2_000;
let cached: {
  expiresAt: number;
  timezone: string;
  timezoneSource: "database" | "env" | "default";
  timezoneUpdatedAt: string | null;
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
  const preset = SYSTEM_TIMEZONE_OPTIONS.find((opt) => opt.value === timeZone);
  if (preset) return preset.label;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "UTC";
    return `${timeZone} ${offset.replace("GMT", "UTC")}`;
  } catch {
    return timeZone;
  }
}

async function loadSettings(reader: DbReader = db) {
  const rows = await reader
    .select()
    .from(systemSettings)
    .where(inArray(systemSettings.key, [SETTING_TIMEZONE, SETTING_AI_ENABLED]));
  const map = new Map(rows.map((r) => [r.key, r]));

  const dbTzRow = map.get(SETTING_TIMEZONE);
  const dbTz = normalizeTimezone(dbTzRow?.value);
  const envTz = normalizeTimezone(
    process.env.STARTER_TIMEZONE || process.env.APP_TIMEZONE,
  );
  const timezone = dbTz ?? envTz ?? DEFAULT_SYSTEM_TIMEZONE;
  const timezoneSource: "database" | "env" | "default" = dbTz
    ? "database"
    : envTz
      ? "env"
      : "default";

  const aiRow = map.get(SETTING_AI_ENABLED);
  const circuitOpen = aiRow?.value === "false";

  return {
    timezone,
    timezoneSource,
    timezoneUpdatedAt: dbTzRow?.updatedAt ? dbTzRow.updatedAt.toISOString() : null,
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
  };
}

export async function updateSystemTimezoneTx(
  tx: Tx,
  actor: Party,
  rawTimezone: string,
  actorSource: ActorSource = "human",
): Promise<SystemSettingsResponse> {
  const normalized = normalizeTimezone(rawTimezone);
  if (!normalized) {
    throw new Refusal(422, "请选择有效的系统时区");
  }
  const before = await loadSettings(tx);
  const now = new Date();

  await tx
    .insert(systemSettings)
    .values({
      key: SETTING_TIMEZONE,
      value: normalized,
      updatedAt: now,
      updatedBy: actor.id,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: normalized,
        updatedAt: now,
        updatedBy: actor.id,
      },
    });

  if (before.timezone !== normalized) {
    await auditResource(
      tx,
      "system.timezone_update",
      actor,
      { code: SETTING_TIMEZONE, name: "系统时区" },
      { from: before.timezone, to: normalized }, actorSource,
    );
  }

  return getSystemSettingsPayload(tx);
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
      { from: beforeEnabled, to: enabled }, actorSource,
    );
  }

  return { circuitOpen: !enabled, updatedAt: now.toISOString() };
}
