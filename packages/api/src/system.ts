import { z } from "zod";

export const ACTOR_SOURCES = ["human", "agent"] as const;
export type ActorSource = (typeof ACTOR_SOURCES)[number];

export const ACTOR_SOURCE_LABELS: Record<ActorSource, string> = {
  human: "人工",
  agent: "Agent",
};

export const SYSTEM_TABS = ["status", "settings"] as const;
export type SystemTab = (typeof SYSTEM_TABS)[number];

export const DEFAULT_SYSTEM_TIMEZONE = "Asia/Shanghai";

export const SYSTEM_TIMEZONE_OPTIONS = [
  { value: "Asia/Shanghai", label: "北京时间 UTC+08:00" },
  { value: "Asia/Hong_Kong", label: "香港时间 UTC+08:00" },
  { value: "Asia/Singapore", label: "新加坡时间 UTC+08:00" },
  { value: "Asia/Tokyo", label: "东京时间 UTC+09:00" },
  { value: "UTC", label: "协调世界时 UTC+00:00" },
  { value: "Europe/London", label: "伦敦时间" },
  { value: "America/New_York", label: "纽约时间" },
  { value: "America/Los_Angeles", label: "洛杉矶时间" },
] as const;

export interface SystemStatusResponse {
  checkedAt: string;
  overall: "ok" | "degraded";
  probe: {
    db: "ok" | "unreachable";
    dbLatencyMs: number | null;
    activeSessions: number;
    uptimeSec: number;
    nodeVersion: string;
  };
  ai: {
    configMode: "disabled" | "invalid" | "client" | "legacy";
    configReason?: string;
    circuitOpen: boolean;
    effectiveEnabled: boolean;
    model: string | null;
    timeoutMs: number | null;
    limits: {
      concurrency: number;
      queueLimit: number;
      queueWaitMs: number;
      actorLimit: number;
    } | null;
    queue: {
      active: number;
      waiting: number;
      activeActors: number;
    } | null;
    updatedAt: string | null;
  };
}

export interface SystemSettingsResponse {
  timezone: string;
  timezoneLabel: string;
  source: "database" | "env" | "default";
  updatedAt: string | null;
  timezoneOptions: readonly { value: string; label: string }[];
}

export const systemSettingsUpdateSchema = z
  .object({
    timezone: z.string().trim().min(1, "请选择系统时区").max(64),
  })
  .strict();

export type SystemSettingsUpdateInput = z.infer<typeof systemSettingsUpdateSchema>;

export const aiCircuitUpdateSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export type AiCircuitUpdateInput = z.infer<typeof aiCircuitUpdateSchema>;
