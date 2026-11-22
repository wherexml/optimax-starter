import { and, count, desc, eq, gte, ilike, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { ACTOR_SOURCES, type ActorSource } from "@optimax-starter/api";
import { audits } from "@optimax-starter/db/schema/console";
import { db } from "../services";
import { auditQuerySchema, containsPattern, dayStart } from "../core/audit";
import { requirePermission, type Env } from "../core/guards";
import { getConfiguredTimezone } from "../core/system-settings";

type AuditQueryInput = {
  action?: string;
  actor?: string;
  source?: ActorSource;
  start?: string;
  end?: string;
  page?: string;
  size?: string;
};

export const auditRoutes = new Hono<Env>().get(
  "/audit",
  requirePermission("audit:read"),
  validator("query", (raw: AuditQueryInput, c) => {
    const cleaned = Object.fromEntries(
      Object.entries(raw).filter(
        ([, v]) => typeof v === "string" && v.trim() !== "",
      ),
    );
    const parsed = auditQuerySchema.safeParse(cleaned);
    if (!parsed.success) return c.json({ error: "筛选条件无效" }, 400);
    return parsed.data;
  }),
  async (c) => {
    const { action, actor, source, start, end, page, size } = c.req.valid("query");
    if (start && end && start > end) {
      return c.json({ error: "结束日期不能早于开始日期" }, 400);
    }
    const timezone = await getConfiguredTimezone();
    const where = and(
      action ? eq(audits.action, action) : undefined,
      source ? eq(audits.actorSource, source) : undefined,
      actor
        ? or(
            ilike(audits.actorName, containsPattern(actor)),
            ilike(audits.actorUsername, containsPattern(actor)),
          )
        : undefined,
      start ? gte(audits.at, dayStart(start, 0, timezone)) : undefined,
      end ? lt(audits.at, dayStart(end, 1, timezone)) : undefined,
    );
    const [items, totals] = await Promise.all([
      db
        .select()
        .from(audits)
        .where(where)
        .orderBy(desc(audits.at), desc(audits.id))
        .limit(size)
        .offset((page - 1) * size),
      db.select({ n: count() }).from(audits).where(where),
    ]);
    return c.json({
      items: items.map((row) => ({
        ...row,
        actorSource: ((ACTOR_SOURCES as readonly string[]).includes(row.actorSource)
          ? row.actorSource
          : "human") as ActorSource,
      })),
      total: Number(totals[0]?.n ?? 0),
      page,
      size,
      timezone,
    });
  },
);
