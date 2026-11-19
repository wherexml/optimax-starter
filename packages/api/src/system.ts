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

// 响应实体（LA-01/LB-03 提升）：进 contracts:generate 产物供 PHP 对照。
// nodeVersion 语义在切流后指向 PHP 运行时版本，重命名决策归 LC-03（记录于 phase-b spec）。
export const systemStatusResponseSchema = z.object({
  checkedAt: z.string(),
  overall: z.enum(["ok", "degraded"]),
  probe: z.object({
    db: z.enum(["ok", "unreachable"]),
    dbLatencyMs: z.number().nullable(),
    activeSessions: z.number(),
    uptimeSec: z.number(),
    nodeVersion: z.string(),
  }),
  ai: z.object({
    configMode: z.enum(["disabled", "invalid", "client", "legacy"]),
    configReason: z.string().optional(),
    circuitOpen: z.boolean(),
    effectiveEnabled: z.boolean(),
    model: z.string().nullable(),
    timeoutMs: z.number().nullable(),
    limits: z
      .object({
        concurrency: z.number(),
        queueLimit: z.number(),
        queueWaitMs: z.number(),
        actorLimit: z.number(),
      })
      .nullable(),
    queue: z
      .object({
        active: z.number(),
        waiting: z.number(),
        activeActors: z.number(),
      })
      .nullable(),
    updatedAt: z.string().nullable(),
  }),
});
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;

export const systemSettingsResponseSchema = z.object({
  timezone: z.string(),
  timezoneLabel: z.string(),
  source: z.enum(["database", "env", "default"]),
  updatedAt: z.string().nullable(),
  timezoneOptions: z.array(z.object({ value: z.string(), label: z.string() })).readonly(),
});
export type SystemSettingsResponse = z.infer<typeof systemSettingsResponseSchema>;

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
