import {
  ASSET_IMPORT_SYNC_MAX_ROWS,
  ASSET_SORT_FIELDS,
  ASSET_STAGES,
  type AssetFacetResponse,
  type AssetImportDuplicateMode,
  type AssetImportPreview,
  type AuditDetail,
  assetBulkDeleteSchema,
  assetBulkStageSchema,
  assetImportJsonSchema,
  assetInputSchema,
  assetPatchSchema,
} from "@optimax-starter/api";
import { assets } from "@optimax-starter/db/schema/assets";
import { attachments } from "@optimax-starter/db/schema/console";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { assetAgentApi } from "../asset-agent";
import { registerAttachmentEntity } from "../core/attachment-registry";
import { AUDIT_MAX_PAGE, auditResource } from "../core/audit";
import {
  ASSET_IMPORT_TEMPLATE,
  CsvParseError,
  collectCsvNames,
  validateAssetCsv,
} from "../core/csv";
import {
  type Env,
  guarded,
  jsonBody,
  lockPermission,
  parsePositiveId,
  Refusal,
  requirePermission,
  type Tx,
} from "../core/guards";
import { registerDemoSeeder } from "../core/seed";
import { deleteStoredObjects } from "../core/storage";
import { db } from "../services";
import "./assets-jobs";
import "./assets-policy";
import { buildAssetOrder, buildAssetWhere } from "./assets-query";

// ---------------------------------------------------------------------------
// Self-registration: demo data, attachment entity, job policies + handlers (side-effect imports).
// ---------------------------------------------------------------------------
const BASE_DEMO_SYSTEMS = [
  "采购门户",
  "库存服务",
  "订单中心",
  "供应商门户",
  "合同服务",
  "仓储平台",
  "运输管理",
  "结算中心",
  "质量平台",
  "报表服务",
  "数据目录",
  "客户门户",
] as const;

const DEMO_DOMAIN_GROUPS: ReadonlyArray<{
  domain: string;
  owner: string;
  prefixes: readonly string[];
}> = [
  {
    domain: "采购",
    owner: "业务运营组",
    prefixes: ["寻源比价", "招投标协同", "供应商准入", "采购合同", "目录商城"],
  },
  {
    domain: "履约",
    owner: "交付组",
    prefixes: ["干线调度", "冷链温控", "备件调拨", "关务申报", "签收回单"],
  },
  {
    domain: "运营",
    owner: "平台组",
    prefixes: ["客户工单", "会员权益", "内容投放", "渠道门户", "活动编排"],
  },
  {
    domain: "财务",
    owner: "财务共享组",
    prefixes: ["应收结算", "应付核销", "银企直连", "税务发票", "预算费控"],
  },
  {
    domain: "研发",
    owner: "研发效能组",
    prefixes: ["制品仓库", "持续集成", "容器编排", "配置中心", "服务网格"],
  },
  {
    domain: "安全",
    owner: "安全合规组",
    prefixes: ["统一身份", "零信任网关", "堡垒审计", "密钥托管", "漏洞巡检"],
  },
  {
    domain: "数据",
    owner: "数据平台组",
    prefixes: ["实时数仓", "离线调度", "指标血缘", "特征存储", "自助分析"],
  },
  {
    domain: "人力",
    owner: "人力数字化组",
    prefixes: ["组织主数据", "招聘协同", "薪酬核算", "绩效评估", "考勤排班"],
  },
];

const DEMO_SYSTEM_SUFFIXES = [
  "门户",
  "服务",
  "中心",
  "平台",
  "工作台",
  "引擎",
  "网关",
  "总线",
  "调度器",
  "控制台",
  "看板",
  "归档库",
  "对账台",
  "审批流",
  "连接器",
  "适配器",
  "同步器",
  "巡检台",
  "沙箱",
  "知识库",
  "目录",
  "编排器",
  "分析台",
  "监控台",
  "中台",
] as const;

const DEMO_ASSET_COUNT = 1000;
const SEED_BATCH_SIZE = 250;

/** 确定性生成 1,000 条真实感企业系统资产：保留前 12 条经典示例，同时控制履约/运营待复核总数 <= 12 以兼容分页前首页筛选验证。 */
function buildDemoAssets(total = DEMO_ASSET_COUNT) {
  const rows: Array<{ name: string; domain: string; owner: string; stage: string }> =
    BASE_DEMO_SYSTEMS.map((name, i) => ({
      name,
      domain: ["采购", "履约", "运营"][i % 3]!,
      owner: ["业务运营组", "交付组", "平台组"][i % 3]!,
      stage: i % 4 === 1 ? "待复核" : "已登记",
    }));

  const seen = new Set(rows.map((r) => r.name));
  let fulfillOpsExtraPending = 0;

  outer: for (let s = 0; s < DEMO_SYSTEM_SUFFIXES.length; s++) {
    const suffix = DEMO_SYSTEM_SUFFIXES[s]!;
    for (let p = 0; p < 5; p++) {
      for (let g = 0; g < DEMO_DOMAIN_GROUPS.length; g++) {
        if (rows.length >= total) break outer;
        const group = DEMO_DOMAIN_GROUPS[g]!;
        const name = `${group.prefixes[p]!}${suffix}`;
        if (seen.has(name)) continue;
        seen.add(name);
        const index = rows.length;
        let stage = "已登记";
        if (group.domain === "履约" || group.domain === "运营") {
          if (fulfillOpsExtraPending < 10 && index % 17 === 0) {
            stage = "待复核";
            fulfillOpsExtraPending += 1;
          }
        } else if (index % 11 === 0) {
          stage = "待复核";
        }
        rows.push({
          name,
          domain: group.domain,
          owner: group.owner,
          stage,
        });
      }
    }
  }

  return rows;
}

registerDemoSeeder(async () => {
  const demoRows = buildDemoAssets(DEMO_ASSET_COUNT);
  for (let offset = 0; offset < demoRows.length; offset += SEED_BATCH_SIZE) {
    await db
      .insert(assets)
      .values(demoRows.slice(offset, offset + SEED_BATCH_SIZE))
      .onConflictDoNothing();
  }
});

registerAttachmentEntity("asset", {
  label: "资产",
  canRead: (actor) => actor.permissions.includes("assets:read"),
  managePermission: "assets:manage",
  allowUserUpload: true,
  verifyTarget: async (entityId) => {
    const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, entityId));
    return !!asset;
  },
  lockTargetInTx: async (tx, entityId) => {
    const [stillThere] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, entityId))
      .for("share");
    return !!stillThere;
  },
  notFoundMessage: "资产不存在",
});

export function normalizeListParam(values: string[] | undefined, maxLen = 80): string[] {
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
  code: z.string().trim().min(1).max(40).optional(),
  codeOp: z.enum(["contains", "equals"]).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  qOp: z.enum(["contains", "equals"]).optional(),
  sortBy: z.enum(ASSET_SORT_FIELDS).default("id"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
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

const LEDGER = { code: "assets", name: "资产台账" } as const;

/** Deletes attachment rows of the given assets inside the tx; returns storage keys to purge after commit. */
async function deleteAssetAttachments(tx: Tx, assetIds: number[]): Promise<string[]> {
  if (!assetIds.length) return [];
  const removed = await tx
    .delete(attachments)
    .where(and(eq(attachments.entityType, "asset"), inArray(attachments.entityId, assetIds)))
    .returning({ key: attachments.storageKey });
  return removed.map((r) => r.key);
}

async function existingAssetNames(reader: Tx | typeof db, names: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < names.length; i += 1000) {
    const slice = names.slice(i, i + 1000);
    if (!slice.length) continue;
    const rows = await reader
      .select({ name: assets.name })
      .from(assets)
      .where(inArray(assets.name, slice));
    for (const r of rows) out.add(r.name);
  }
  return out;
}

type ImportInput = { csv: string; filename?: string; onDuplicate: AssetImportDuplicateMode };

/** Accepts JSON `{ csv, filename?, onDuplicate? }` or multipart `file` (+ `onDuplicate`). */
async function readImportInput(c: Context<Env>): Promise<ImportInput | Refusal> {
  const type = c.req.header("content-type")?.toLowerCase() ?? "";
  if (type.startsWith("multipart/form-data")) {
    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = await c.req.parseBody();
    } catch {
      return new Refusal(400, "上传内容无效");
    }
    const file = form.file;
    if (!(file instanceof File)) return new Refusal(400, "请选择 CSV 文件");
    if (!/\.csv$/i.test(file.name))
      return new Refusal(415, "仅支持 .csv 文件", "FILE_TYPE_BLOCKED");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.includes(0)) return new Refusal(415, "CSV 文件包含二进制内容", "FILE_TYPE_MISMATCH");
    const mode = typeof form.onDuplicate === "string" ? form.onDuplicate : undefined;
    return {
      csv: new TextDecoder("utf-8").decode(bytes),
      filename: file.name.slice(0, 180),
      onDuplicate: mode === "skip" ? "skip" : "fail",
    };
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return new Refusal(400, "请求内容无效");
  }
  const parsed = assetImportJsonSchema.safeParse(raw);
  if (!parsed.success) return new Refusal(400, parsed.error.issues[0]?.message ?? "请求内容无效");
  return {
    csv: parsed.data.csv,
    filename: parsed.data.filename,
    onDuplicate: parsed.data.onDuplicate ?? "fail",
  };
}

function validateOrRefuse(csv: string, existing: ReadonlySet<string>) {
  try {
    return validateAssetCsv(csv, existing, ASSET_IMPORT_SYNC_MAX_ROWS);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Refusal(
        422,
        `${error.message}；请改用后台任务 assets.bulk_import 异步导入（最多 5000 行）`,
        "VALIDATION_TOO_MANY_ROWS",
      );
    }
    if (error instanceof CsvParseError) throw new Refusal(422, `CSV 格式错误：${error.message}`);
    throw error;
  }
}

export const assetsRoutes = new Hono<Env>()
  .route("/assets/agent", assetAgentApi)
  // Full list endpoint preserved for scripts and Agent pilot compatibility (do not change).
  .get("/assets", requirePermission("assets:read"), async (c) =>
    c.json(await db.select().from(assets).orderBy(assets.id)),
  )
  // Server-side paginated + multi-select + contains/equals filtering + sorting.
  .get("/assets/page", requirePermission("assets:read"), async (c) => {
    const scalar = Object.fromEntries(
      Object.entries(c.req.query()).filter(
        ([k, v]) => k !== "stage" && k !== "domain" && k !== "owner" && v.trim() !== "",
      ),
    );
    const parsed = assetPageQuerySchema.safeParse(scalar);
    if (!parsed.success) return c.json({ error: "筛选参数无效" }, 400);

    const stages = normalizeListParam(c.req.queries("stage"), 20);
    if (stages.some((s) => !(ASSET_STAGES as readonly string[]).includes(s))) {
      return c.json({ error: "无效的登记状态" }, 400);
    }
    const domains = normalizeListParam(c.req.queries("domain"), 80);
    const owners = normalizeListParam(c.req.queries("owner"), 60);
    const { code, codeOp, q, qOp, sortBy, sortDir, page, size } = parsed.data;

    const where = buildAssetWhere({ code, codeOp, q, qOp, stages, domains, owners });

    const [items, totals] = await Promise.all([
      db
        .select()
        .from(assets)
        .where(where)
        .orderBy(...buildAssetOrder(sortBy, sortDir))
        .limit(size)
        .offset((page - 1) * size),
      db.select({ n: count() }).from(assets).where(where),
    ]);
    return c.json({ items, total: Number(totals[0]?.n ?? 0), page, size });
  })
  .get("/assets/facets", requirePermission("assets:read"), async (c) => {
    const [domainRows, ownerRows] = await Promise.all([
      db.selectDistinct({ v: assets.domain }).from(assets),
      db.selectDistinct({ v: assets.owner }).from(assets),
    ]);
    const sortZh = (values: string[]) => values.sort((a, b) => a.localeCompare(b, "zh-CN"));
    const body: AssetFacetResponse = {
      domains: sortZh(domainRows.map((r) => r.v)),
      owners: sortZh(ownerRows.map((r) => r.v)),
    };
    return c.json(body);
  })
  .get("/assets/import/template", requirePermission("assets:read"), (c) =>
    c.body(ASSET_IMPORT_TEMPLATE, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="assets-import-template.csv"',
      "X-Content-Type-Options": "nosniff",
    }),
  )
  .post("/assets/import/preview", requirePermission("assets:manage"), async (c) =>
    guarded(c, async () => {
      const input = await readImportInput(c);
      if (input instanceof Refusal) throw input;
      let names: string[];
      try {
        names = collectCsvNames(input.csv);
      } catch (error) {
        if (error instanceof CsvParseError)
          throw new Refusal(422, `CSV 格式错误：${error.message}`);
        throw error;
      }
      const existing = await existingAssetNames(db, names);
      const {
        validRows: _v,
        duplicateRows: _d,
        ...preview
      } = validateOrRefuse(input.csv, existing);
      const body: AssetImportPreview = { ...preview, filename: input.filename };
      return c.json(body);
    }),
  )
  .post("/assets/import/commit", requirePermission("assets:manage"), async (c) =>
    guarded(c, async () => {
      const input = await readImportInput(c);
      if (input instanceof Refusal) throw input;
      const actor = c.get("actor");
      const result = await db.transaction(async (tx) => {
        const self = await lockPermission(tx, actor.id, "assets:manage");
        let names: string[];
        try {
          names = collectCsvNames(input.csv);
        } catch (error) {
          if (error instanceof CsvParseError)
            throw new Refusal(422, `CSV 格式错误：${error.message}`);
          throw error;
        }
        const existing = await existingAssetNames(tx, names);
        const v = validateOrRefuse(input.csv, existing);
        if (v.headerErrors?.length) throw new Refusal(422, v.headerErrors.join("；"));
        if (!v.total) throw new Refusal(422, "CSV 没有数据行");
        if (v.errorCount > 0) {
          throw new Refusal(422, `存在 ${v.errorCount} 行无效数据，请修正后重新导入`);
        }
        if (input.onDuplicate === "fail" && v.duplicateCount > 0) {
          throw new Refusal(
            422,
            `存在 ${v.duplicateCount} 行重名资产，请修正或选择跳过重名`,
            "DATA_CONFLICT",
          );
        }
        let imported = 0;
        for (let i = 0; i < v.validRows.length; i += 250) {
          const inserted = await tx
            .insert(assets)
            .values(v.validRows.slice(i, i + 250))
            .onConflictDoNothing()
            .returning({ id: assets.id });
          imported += inserted.length;
        }
        const skipped = v.total - imported;
        await auditResource(
          tx,
          "asset.bulk_import",
          self,
          LEDGER,
          { imported, skipped, filename: input.filename },
          actor.actorSource,
        );
        return { imported, skipped };
      });
      return c.json({ ok: true as const, ...result });
    }),
  )
  .post(
    "/assets",
    requirePermission("assets:manage"),
    jsonBody(assetInputSchema, "请完整填写资产名称、业务域、责任团队与登记状态"),
    async (c) => {
      const data = c.req.valid("json");
      return guarded(c, async () => {
        const created = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, c.get("actor").id, "assets:manage");
          const [row] = await tx.insert(assets).values(data).onConflictDoNothing().returning();
          if (!row) throw new Refusal(409, "资产名称已存在");
          await auditResource(
            tx,
            "asset.create",
            self,
            assetResource(row),
            { domain: row.domain, owner: row.owner, stage: row.stage },
            c.get("actor").actorSource,
          );
          return row;
        });
        return c.json(created, 201);
      });
    },
  )
  .post(
    "/assets/bulk-stage",
    requirePermission("assets:manage"),
    jsonBody(assetBulkStageSchema, "请选择要更新的资产和目标状态"),
    async (c) => {
      const { ids, stage } = c.req.valid("json");
      const uniqueIds = [...new Set(ids)];
      return guarded(c, async () => {
        const updatedCount = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, c.get("actor").id, "assets:manage");
          const updated = await tx
            .update(assets)
            .set({ stage })
            .where(inArray(assets.id, uniqueIds))
            .returning({ id: assets.id });
          if (!updated.length) throw new Refusal(404, "所选资产不存在或已被删除");
          await auditResource(
            tx,
            "asset.bulk_update",
            self,
            LEDGER,
            { stage, matched: updated.length },
            c.get("actor").actorSource,
          );
          return updated.length;
        });
        return c.json({ ok: true, updated: updatedCount });
      });
    },
  )
  .post(
    "/assets/bulk-delete",
    requirePermission("assets:manage"),
    jsonBody(assetBulkDeleteSchema, "请选择要删除的资产"),
    async (c) => {
      const { ids } = c.req.valid("json");
      const uniqueIds = [...new Set(ids)];
      return guarded(c, async () => {
        const { deletedCount, keys } = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, c.get("actor").id, "assets:manage");
          const removed = await tx
            .delete(assets)
            .where(inArray(assets.id, uniqueIds))
            .returning({ id: assets.id });
          if (!removed.length) throw new Refusal(404, "所选资产不存在或已被删除");
          const keys = await deleteAssetAttachments(
            tx,
            removed.map((r) => r.id),
          );
          await auditResource(
            tx,
            "asset.bulk_delete",
            self,
            LEDGER,
            { matched: removed.length },
            c.get("actor").actorSource,
          );
          return { deletedCount: removed.length, keys };
        });
        await deleteStoredObjects(keys);
        return c.json({ ok: true, deleted: deletedCount });
      });
    },
  )
  .patch(
    "/assets/:id",
    requirePermission("assets:manage"),
    jsonBody(assetPatchSchema, "无效的资产变更"),
    async (c) => {
      const id = parsePositiveId(c.req.param("id"));
      const change = c.req.valid("json");
      if (!id) return c.json({ error: "无效的资产变更" }, 400);
      return guarded(c, async () => {
        const updated = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, c.get("actor").id, "assets:manage");
          const [before] = await tx.select().from(assets).where(eq(assets.id, id)).for("update");
          if (!before) throw new Refusal(404, "资产不存在");
          const set: Partial<typeof change> = {};
          if (change.name !== undefined && change.name !== before.name) set.name = change.name;
          if (change.domain !== undefined && change.domain !== before.domain)
            set.domain = change.domain;
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
          const [after] = await tx.update(assets).set(set).where(eq(assets.id, id)).returning();
          const detail: AuditDetail = { fields };
          if (set.stage !== undefined) {
            detail.from = before.stage;
            detail.to = after!.stage;
          } else if (set.name !== undefined) {
            detail.from = before.name;
            detail.to = after!.name;
          }
          await auditResource(
            tx,
            "asset.update",
            self,
            assetResource(after!),
            detail,
            c.get("actor").actorSource,
          );
          return after!;
        });
        return c.json(updated);
      });
    },
  )
  .delete("/assets/:id", requirePermission("assets:manage"), async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return c.json({ error: "无效的资产" }, 400);
    return guarded(c, async () => {
      const keys = await db.transaction(async (tx) => {
        const self = await lockPermission(tx, c.get("actor").id, "assets:manage");
        const [removed] = await tx.delete(assets).where(eq(assets.id, id)).returning();
        if (!removed) throw new Refusal(404, "资产不存在");
        const keys = await deleteAssetAttachments(tx, [removed.id]);
        await auditResource(
          tx,
          "asset.delete",
          self,
          assetResource(removed),
          { domain: removed.domain, owner: removed.owner, stage: removed.stage },
          c.get("actor").actorSource,
        );
        return keys;
      });
      await deleteStoredObjects(keys);
      return c.json({ ok: true });
    });
  });
