import { and, count, eq, ilike } from "drizzle-orm";
import { ASSET_STAGES, type AuditDetail } from "@optimax-starter/api";
import { assets } from "@optimax-starter/db/schema/assets";
import { type ToolSet, redact, tool, z } from "@optimax-starter/agent";
import { db } from "../services";
import { auditResource, containsPattern } from "../core/audit";
import { Refusal, lockPermission } from "../core/guards";
import type { AgentToolContext } from "./registry";

// Example business tools for the demo asset ledger. Removed by `bootstrap --no-example`.

const SEARCH_LIMIT = 20;

export const updateAssetStageInput = z.object({
  id: z.number().int().positive(),
  stage: z.enum(["已登记", "待复核"]),
});

/** Write tools that require a signed approval and a live permission re-check. */
export const exampleAssetWriteTools = {
  update_asset_stage: { permission: "assets:manage", input: updateAssetStageInput },
} as const;

const searchInput = z.object({
  q: z.string().trim().max(80).optional().describe("资产名称关键字"),
  domain: z.string().trim().max(40).optional().describe("业务域"),
  owner: z.string().trim().max(60).optional().describe("责任团队"),
  stage: z.enum(ASSET_STAGES).optional().describe("阶段"),
});

const assetCode = (id: number) => `AS-${String(id).padStart(3, "0")}`;

export function exampleAssetTools({ actor, approvals, citations }: AgentToolContext): ToolSet {
  const tools: ToolSet = {};
  if (actor.permissions.includes("assets:read")) {
    tools.search_assets = tool({
      description: "按名称关键字、业务域、责任团队或阶段检索资产台账，最多返回 20 条。",
      inputSchema: searchInput,
      execute: async ({ q, domain, owner, stage }) => {
        const where = and(
          q ? ilike(assets.name, containsPattern(q)) : undefined,
          domain ? ilike(assets.domain, containsPattern(domain)) : undefined,
          owner ? ilike(assets.owner, containsPattern(owner)) : undefined,
          stage ? eq(assets.stage, stage) : undefined,
        );
        const [rows, totals] = await Promise.all([
          db.select().from(assets).where(where).orderBy(assets.id).limit(SEARCH_LIMIT),
          db.select({ n: count() }).from(assets).where(where),
        ]);
        const items = rows.map((row) => {
          const id = `E${citations.length + 1}`;
          citations.push({
            id,
            title: redact(row.name),
            snippet: `${assetCode(row.id)} | ${redact(row.domain)} | ${redact(row.owner)} | ${row.stage}`,
            to: "/assets",
            search: { q: row.name, qOp: "equals" },
          });
          return {
            citation: id,
            id: row.id,
            code: assetCode(row.id),
            name: redact(row.name),
            domain: redact(row.domain),
            owner: redact(row.owner),
            stage: row.stage,
          };
        });
        const total = Number(totals[0]?.n ?? 0);
        return { total, returned: items.length, truncated: total > items.length, items };
      },
    });
    tools.summarize_assets = tool({
      description: "统计资产台账总数，以及按阶段、业务域分组的数量。",
      inputSchema: z.object({}),
      execute: async () => {
        const [byStage, byDomain] = await Promise.all([
          db
            .select({ stage: assets.stage, n: count() })
            .from(assets)
            .groupBy(assets.stage)
            .orderBy(assets.stage),
          db
            .select({ domain: assets.domain, n: count() })
            .from(assets)
            .groupBy(assets.domain)
            .orderBy(assets.domain),
        ]);
        const stages = byStage.map((row) => ({ stage: row.stage, count: Number(row.n) }));
        return {
          total: stages.reduce((sum, row) => sum + row.count, 0),
          byStage: stages,
          byDomain: byDomain.map((row) => ({ domain: redact(row.domain), count: Number(row.n) })),
        };
      },
    });
  }
  if (actor.permissions.includes("assets:manage")) {
    tools.update_asset_stage = tool({
      description:
        "修改单个资产的阶段（已登记 / 待复核）。需要用户在确认卡上同意后才会执行。调用前先说明资产、当前阶段与目标阶段。",
      inputSchema: updateAssetStageInput,
      needsApproval: true,
      execute: async ({ id, stage }, { toolCallId }) => {
        // The route only records approvals whose signed token verified for this actor and input.
        if (!approvals.has(toolCallId)) {
          throw new Refusal(403, "确认已失效，请重新发起操作", "APPROVAL_INVALID");
        }
        return db.transaction(async (tx) => {
          const self = await lockPermission(tx, actor.id, "assets:manage");
          const [before] = await tx.select().from(assets).where(eq(assets.id, id)).for("update");
          if (!before) return { ok: false, error: "资产不存在" };
          if (before.stage === stage) {
            return { ok: true, changed: false, id, name: redact(before.name), stage };
          }
          const [after] = await tx
            .update(assets)
            .set({ stage })
            .where(eq(assets.id, id))
            .returning();
          const detail: AuditDetail = { fields: ["stage"], from: before.stage, to: stage };
          await auditResource(
            tx,
            "asset.update",
            self,
            { id, code: assetCode(id), name: after?.name ?? before.name },
            detail,
            "agent",
          );
          return {
            ok: true,
            changed: true,
            id,
            name: redact(before.name),
            from: before.stage,
            to: stage,
          };
        });
      },
    });
  }
  return tools;
}
