import { and, count, eq, ilike, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  ASSET_STAGES,
  assetInputSchema,
  assetPatchSchema,
  type AuditDetail,
} from "@optimax-starter/api";
import { assets } from "@optimax-starter/db/schema/console";
import { assetAgentApi } from "../asset-agent";
import { db } from "../services";
import { AUDIT_MAX_PAGE, auditResource, containsPattern } from "../core/audit";
import {
  Refusal,
  guarded,
  lockAdmin,
  parsePositiveId,
  requireAdmin,
  type Env,
} from "../core/guards";

export const assetsRoutes = new Hono<Env>();

function normalizeListParam(values: string[] | undefined, maxLen = 80): string[] {
  if (!values?.length) return [];
  const out: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[")) {
      try {
        const arr: unknown = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (typeof item === "string" && item.trim() && item.trim().length <= maxLen) {
              out.push(item.trim());
            }
          }
          continue;
        }
      } catch {
        // Not JSON; treat as plain string below.
      }
    }
    if (trimmed.length <= maxLen) out.push(trimmed);
  }
  return [...new Set(out)].slice(0, 20);
}

const assetPageQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  qOp: z.enum(["contains", "equals"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((n) => Math.min(n, AUDIT_MAX_PAGE)),
});

const assetResource = (row: { id: number; name: string }) => ({
  id: row.id,
  code: `AS-${String(row.id).padStart(3, "0")}`,
  name: row.name,
});

assetsRoutes.route("/assets/agent", assetAgentApi);

// Full list endpoint preserved for client-side filtering and Agent pilot compatibility.
assetsRoutes.get("/assets", async (c) =>
  c.json(await db.select().from(assets).orderBy(assets.id)),
);

// Server-side paginated + multi-select + contains/equals filtering reference endpoint.
assetsRoutes.get("/assets/page", async (c) => {
  const scalar = Object.fromEntries(
    Object.entries(c.req.query()).filter(
      ([k, v]) => k !== "stage" && k !== "domain" && v.trim() !== "",
    ),
  );
  const parsed = assetPageQuerySchema.safeParse(scalar);
  if (!parsed.success) return c.json({ error: "筛选参数无效" }, 400);

  const stages = normalizeListParam(c.req.queries("stage"), 20);
  if (stages.some((s) => !(ASSET_STAGES as readonly string[]).includes(s))) {
    return c.json({ error: "无效的登记状态" }, 400);
  }
  const domains = normalizeListParam(c.req.queries("domain"), 80);
  const { q, qOp, page, size } = parsed.data;

  const where = and(
    q
      ? qOp === "equals"
        ? eq(assets.name, q)
        : ilike(assets.name, containsPattern(q))
      : undefined,
    stages.length ? inArray(assets.stage, stages) : undefined,
    domains.length ? inArray(assets.domain, domains) : undefined,
  );

  const [items, totals] = await Promise.all([
    db
      .select()
      .from(assets)
      .where(where)
      .orderBy(assets.id)
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(assets).where(where),
  ]);
  return c.json({ items, total: Number(totals[0]?.n ?? 0), page, size });
});

assetsRoutes.post("/assets", requireAdmin, async (c) => {
  const parsed = assetInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "请完整填写资产名称、业务域、责任团队与登记状态" }, 400);
  }
  return guarded(c, async () => {
    const created = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, c.get("actor").id);
      const [row] = await tx
        .insert(assets)
        .values(parsed.data)
        .onConflictDoNothing()
        .returning();
      if (!row) throw new Refusal(409, "资产名称已存在");
      await auditResource(tx, "asset.create", self, assetResource(row), {
        domain: row.domain,
        owner: row.owner,
        stage: row.stage,
      });
      return row;
    });
    return c.json(created, 201);
  });
});

assetsRoutes.patch("/assets/:id", requireAdmin, async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  const parsed = assetPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "无效的资产变更" }, 400);
  const change = parsed.data;
  return guarded(c, async () => {
    const updated = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, c.get("actor").id);
      const [before] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, id))
        .for("update");
      if (!before) throw new Refusal(404, "资产不存在");
      const set: Partial<typeof parsed.data> = {};
      if (change.name !== undefined && change.name !== before.name) set.name = change.name;
      if (change.domain !== undefined && change.domain !== before.domain) set.domain = change.domain;
      if (change.owner !== undefined && change.owner !== before.owner) set.owner = change.owner;
      if (change.stage !== undefined && change.stage !== before.stage) set.stage = change.stage;
      const fields = Object.keys(set);
      if (!fields.length) return before;
      if (set.name !== undefined) {
        const [dup] = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.name, set.name), ne(assets.id, id)));
        if (dup) throw new Refusal(409, "资产名称已存在");
      }
      const [after] = await tx
        .update(assets)
        .set(set)
        .where(eq(assets.id, id))
        .returning();
      const detail: AuditDetail = { fields };
      if (set.stage !== undefined) {
        detail.from = before.stage;
        detail.to = after!.stage;
      } else if (set.name !== undefined) {
        detail.from = before.name;
        detail.to = after!.name;
      }
      await auditResource(tx, "asset.update", self, assetResource(after!), detail);
      return after!;
    });
    return c.json(updated);
  });
});

assetsRoutes.delete("/assets/:id", requireAdmin, async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  if (!id) return c.json({ error: "无效的资产" }, 400);
  return guarded(c, async () => {
    await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, c.get("actor").id);
      const [removed] = await tx
        .delete(assets)
        .where(eq(assets.id, id))
        .returning();
      if (!removed) throw new Refusal(404, "资产不存在");
      await auditResource(tx, "asset.delete", self, assetResource(removed), {
        domain: removed.domain,
        owner: removed.owner,
        stage: removed.stage,
      });
    });
    return c.json({ ok: true });
  });
});
