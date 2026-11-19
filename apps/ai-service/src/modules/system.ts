import { performance } from "node:perf_hooks";
import { count, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  aiCircuitUpdateSchema,
  systemPermissionsUpdateSchema,
  systemSettingsUpdateSchema,
  type SystemStatusResponse,
} from "@optimax-starter/api";
import { sessions } from "@optimax-starter/db/schema/console";
import { db } from "../services";
import { aiConfig, aiQueueSnapshot } from "../core/ai";
import {
  guarded,
  lockPermission,
  lockSuperAdmin,
  requireAnyPermission,
  requirePermission,
  requireSuperAdmin,
  type Env,
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
  updateSystemTimezoneTx,
} from "../core/system-settings";

export const systemRoutes = new Hono<Env>();

systemRoutes.get(
  "/system/permissions",
  requireSuperAdmin,
  requirePermission("system:permission:read"),
  async (c) => c.json(await getPermissionMatrixPayload()),
);

systemRoutes.put(
  "/system/permissions",
  requireSuperAdmin,
  requirePermission("system:permission:manage"),
  async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = systemPermissionsUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "请提交有效的角色权限配置";
      return c.json({ error: msg }, 400);
    }
    return guarded(c, async () => {
      const updated = await db.transaction(async (tx) => {
        const self = await lockSuperAdmin(tx, c.get("actor").id);
        return updatePermissionMatrixTx(tx, self, parsed.data.roles);
      });
      invalidatePermissionCache();
      return c.json(updated);
    });
  },
);

systemRoutes.post(
  "/system/permissions/reset",
  requireSuperAdmin,
  requirePermission("system:permission:manage"),
  async (c) =>
    guarded(c, async () => {
      const reset = await db.transaction(async (tx) => {
        const self = await lockSuperAdmin(tx, c.get("actor").id);
        return resetPermissionMatrixTx(tx, self);
      });
      invalidatePermissionCache();
      return c.json(reset);
    }),
);

systemRoutes.get(
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
);

systemRoutes.patch(
  "/system/ai-circuit",
  requireSuperAdmin,
  requirePermission("system:ai:manage"),
  async (c) => {
    const parsed = aiCircuitUpdateSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "无效的熔断开关状态" }, 400);
    }
    return guarded(c, async () => {
      const state = await db.transaction(async (tx) => {
        const self = await lockSuperAdmin(tx, c.get("actor").id);
        return updateAiCircuitTx(tx, self, parsed.data.enabled);
      });
      invalidateSystemSettingsCache();
      return c.json({ ok: true, ...state });
    });
  },
);

systemRoutes.get(
  "/system/settings",
  requirePermission("system:settings:read"),
  async (c) => c.json(await getSystemSettingsPayload()),
);

systemRoutes.put(
  "/system/settings",
  requirePermission("system:settings:manage"),
  async (c) => {
    const parsed = systemSettingsUpdateSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "请选择有效的系统时区" }, 400);
    }
    return guarded(c, async () => {
      const updated = await db.transaction(async (tx) => {
        const self = await lockPermission(
          tx,
          c.get("actor").id,
          "system:settings:manage",
        );
        return updateSystemTimezoneTx(tx, self, parsed.data.timezone);
      });
      invalidateSystemSettingsCache();
      return c.json(updated);
    });
  },
);
