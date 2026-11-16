import { and, count, desc, eq, gte, ilike, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { audits } from "@optimax-starter/db/schema/console";
import { db } from "../services";
import { auditQuerySchema, containsPattern, dayStart } from "../core/audit";
import { requireAdmin, type Env } from "../core/guards";

export const auditRoutes = new Hono<Env>();

auditRoutes.get("/audit", requireAdmin, async (c) => {
  const raw = Object.fromEntries(
    Object.entries(c.req.query()).filter(([, v]) => v.trim() !== ""),
  );
  const parsed = auditQuerySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "筛选条件无效" }, 400);
  const { action, actor, start, end, page, size } = parsed.data;
  if (start && end && start > end) {
    return c.json({ error: "结束日期不能早于开始日期" }, 400);
  }
  const where = and(
    action ? eq(audits.action, action) : undefined,
    actor
      ? or(
          ilike(audits.actorName, containsPattern(actor)),
          ilike(audits.actorUsername, containsPattern(actor)),
        )
      : undefined,
    start ? gte(audits.at, dayStart(start)) : undefined,
    end ? lt(audits.at, dayStart(end, 1)) : undefined,
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
  return c.json({ items, total: Number(totals[0]?.n ?? 0), page, size });
});
