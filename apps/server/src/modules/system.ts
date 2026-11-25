import { performance } from "node:perf_hooks";
import {
  aiCircuitUpdateSchema,
  type SystemStatusResponse,
  systemPermissionsUpdateSchema,
  systemSettingsUpdateSchema,
} from "@optimax-starter/api";
import { sessions } from "@optimax-starter/db/schema/console";
import { count, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { aiConfig, aiQueueSnapshot } from "../core/ai";
import {
  type Env,
  guarded,
  jsonBody,
  lockPermission,
  lockSuperAdmin,
  requireAnyPermission,
  requirePermission,
  requireSuperAdmin,
} from "../core/guards";
import {
  getPermissionMatrixPayload,
  invalidatePermissionCache,
  resetPermissionMatrixTx,
  updatePermissionMatrixTx,
} from "../core/permissions";
import {
  getAiCircuitState,
  getSystemSettingsPayload,
  invalidateSystemSettingsCache,
  updateAiCircuitTx,
  updateSystemSettingsTx,
} from "../core/system-settings";
import { db } from "../services";

export const systemRoutes = new Hono<Env>()
  .get(
    "/system/permissions",
    requireSuperAdmin,
    requirePermission("system:permission:read"),
    async (c) => c.json(await getPermissionMatrixPayload()),
  )
  .put(
    "/system/permissions",
    requireSuperAdmin,
    requirePermission("system:permission:manage"),
    jsonBody(
      systemPermissionsUpdateSchema,
      (err) => err.issues[0]?.message || "请提交有效的角色权限配置",
    ),
    async (c) => {
      const data = c.req.valid("json");
      return guarded(c, async () => {
        const updated = await db.transaction(async (tx) => {
          const self = await lockSuperAdmin(tx, c.get("actor").id);
          return updatePermissionMatrixTx(tx, self, data.roles, c.get("actor").actorSource);
        });
        invalidatePermissionCache();
        return c.json(updated);
      });
    },
  )
  .post(
    "/system/permissions/reset",
    requireSuperAdmin,
    requirePermission("system:permission:manage"),
    async (c) =>
      guarded(c, async () => {
        const reset = await db.transaction(async (tx) => {
          const self = await lockSuperAdmin(tx, c.get("actor").id);
          return resetPermissionMatrixTx(tx, self, c.get("actor").actorSource);
        });
        invalidatePermissionCache();
        return c.json(reset);
      }),
  )
  .get(
    "/system/status",
    requireAnyPermission("system:settings:read", "system:ai:read"),
    async (c) => {
      let dbState: "ok" | "unreachable" = "ok";
      let dbLatencyMs: number | null = null;
      let activeSessions = 0;

      const start = performance.now();
      try {
        await db.execute(sql`select 1`);
        dbLatencyMs = Math.round((performance.now() - start) * 10) / 10;
        const [live] = await db
          .select({ n: count() })
          .from(sessions)
          .where(gt(sessions.expires, new Date()));
        activeSessions = Number(live?.n ?? 0);
      } catch {
        dbState = "unreachable";
      }

      const aiCfg = aiConfig();
      const queueSnap = aiQueueSnapshot();
      const circuit = await getAiCircuitState();
      const envReady = aiCfg.mode === "client" || aiCfg.mode === "legacy";

      const payload: SystemStatusResponse = {
        checkedAt: new Date().toISOString(),
        overall: dbState === "ok" ? "ok" : "degraded",
        probe: {
          db: dbState,
          dbLatencyMs,
          activeSessions,
          uptimeSec: Math.floor(process.uptime()),
          nodeVersion: process.version,
        },
        ai: {
          configMode: aiCfg.mode,
          ...(aiCfg.mode === "invalid" ? { configReason: aiCfg.reason } : {}),
          circuitOpen: circuit.circuitOpen,
          effectiveEnabled: envReady && !circuit.circuitOpen,
          model: envReady ? aiCfg.model : null,
          timeoutMs: envReady ? aiCfg.timeoutMs : null,
          limits: envReady ? aiCfg.limits : null,
          queue: queueSnap,
          updatedAt: circuit.updatedAt,
        },
      };
      return c.json(payload);
    },
  )
  .patch(
    "/system/ai-circuit",
    requireSuperAdmin,
    requirePermission("system:ai:manage"),
    jsonBody(aiCircuitUpdateSchema, "无效的熔断开关状态"),
    async (c) => {
      const data = c.req.valid("json");
      return guarded(c, async () => {
        const state = await db.transaction(async (tx) => {
          const self = await lockSuperAdmin(tx, c.get("actor").id);
          return updateAiCircuitTx(tx, self, data.enabled, c.get("actor").actorSource);
        });
        invalidateSystemSettingsCache();
        return c.json({ ok: true, ...state });
      });
    },
  )
  .get("/system/settings", requirePermission("system:settings:read"), async (c) =>
    c.json(await getSystemSettingsPayload()),
  )
  .put(
    "/system/settings",
    requirePermission("system:settings:manage"),
    jsonBody(systemSettingsUpdateSchema, "请选择有效的系统配置"),
    async (c) => {
      const data = c.req.valid("json");
      return guarded(c, async () => {
        const updated = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, c.get("actor").id, "system:settings:manage", {
            exclusive: true,
          });
          return updateSystemSettingsTx(tx, self, data, c.get("actor").actorSource);
        });
        invalidateSystemSettingsCache();
        return c.json(updated);
      });
    },
  );
