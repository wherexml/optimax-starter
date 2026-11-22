// Example "assets" job handlers (export CSV + bulk import). Self-registered into core/jobs.ts.
// `scripts/lib/strip-example.mjs` deletes this file together with the rest of the assets module.
import { count, inArray } from "drizzle-orm";
import {
  ASSET_IMPORT_ASYNC_MAX_ROWS,
  type AssetExportFilter,
  type AssetInput,
} from "@optimax-starter/api";
import { attachments } from "@optimax-starter/db/schema/console";
import { assets } from "@optimax-starter/db/schema/assets";
import { db } from "../services";
import { auditResource } from "../core/audit";
import { CsvParseError, collectCsvNames, serializeCsv, validateAssetCsv } from "../core/csv";
import { lockPermission } from "../core/guards";
import {
  EXPORT_BATCH_SIZE,
  EXPORT_MAX_ROWS,
  IMPORT_BATCH_SIZE,
  JobFailure,
  type JobHandler,
  jobActorSource,
  loadCreator,
  registerJobHandler,
} from "../core/jobs";
import { getEffectivePermissions } from "../core/permissions";
import { getStorageDriver, newStorageKey, sha256OfBytes } from "../core/storage";
import { buildAssetOrder, buildAssetWhere } from "./assets-query";

/** CSV parse errors are business messages: persist them and never retry. */
const csvErrorsArePermanent =
  (handler: JobHandler): JobHandler =>
  async (job, ctx) => {
    try {
      return await handler(job, ctx);
    } catch (error) {
      if (error instanceof CsvParseError) throw new JobFailure(error.message.slice(0, 500), true);
      throw error;
    }
  };

export const exportAssetsCsv: JobHandler = async (job, ctx) => {
  const creator = await loadCreator(job);
  const perms = await getEffectivePermissions(creator.role);
  if (!perms.includes("assets:read")) throw new JobFailure("任务创建人已无资产查看权限", true);
  const filter = (job.payload ?? {}) as AssetExportFilter;
  const where = buildAssetWhere({
    q: filter.q || undefined,
    qOp: filter.qOp,
    stages: filter.stage,
    domains: filter.domain,
    owners: filter.owner,
  });
  const order = buildAssetOrder(filter.sortBy ?? "id", filter.sortDir ?? "desc");
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(assets).where(where);
  const total = Math.min(Number(n), EXPORT_MAX_ROWS);
  const rows: unknown[][] = [["编号", "名称", "业务域", "责任团队", "登记状态"]];
  for (let offset = 0; offset < total; offset += EXPORT_BATCH_SIZE) {
    const batch = await db
      .select()
      .from(assets)
      .where(where)
      .orderBy(...order)
      .limit(Math.min(EXPORT_BATCH_SIZE, total - offset))
      .offset(offset);
    for (const a of batch) {
      rows.push([`AS-${String(a.id).padStart(3, "0")}`, a.name, a.domain, a.owner, a.stage]);
    }
    await ctx.progress(Math.min(95, Math.round(((offset + batch.length) / Math.max(total, 1)) * 90)));
    if (batch.length < EXPORT_BATCH_SIZE) break;
  }
  const bytes = new TextEncoder().encode(serializeCsv(rows, { bom: true }));
  const storage = getStorageDriver();
  const key = newStorageKey("job", ".csv");
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `assets-export-${stamp}-job${job.id}.csv`;
  await storage.put(key, bytes, "text/csv");
  const rowCount = rows.length - 1;
  return {
    result: { rowCount, filename, truncated: Number(n) > EXPORT_MAX_ROWS },
    cleanupKeys: [key],
    finalize: async (tx) => {
      const [att] = await tx
        .insert(attachments)
        .values({
          entityType: "job",
          entityId: job.id,
          storageDriver: storage.driverName,
          storageKey: key,
          originalName: filename,
          mimeType: "text/csv",
          sizeBytes: bytes.byteLength,
          sha256: sha256OfBytes(bytes),
          uploadedBy: job.createdBy,
        })
        .returning({ id: attachments.id });
      return { attachmentId: att!.id };
    },
  };
};

export const bulkImportAssets: JobHandler = async (job, ctx) => {
  const creator = await loadCreator(job);
  const payload = job.payload as { csv?: unknown; filename?: unknown; onDuplicate?: unknown };
  if (typeof payload.csv !== "string" || !payload.csv) throw new JobFailure("导入内容为空", true);
  const csv = payload.csv;
  const filename = typeof payload.filename === "string" ? payload.filename : undefined;
  const onDuplicate = payload.onDuplicate === "fail" ? "fail" : "skip";

  const names = collectCsvNames(csv);
  const existing = new Set<string>();
  for (let i = 0; i < names.length; i += 1000) {
    const slice = names.slice(i, i + 1000);
    if (!slice.length) continue;
    const found = await db.select({ name: assets.name }).from(assets).where(inArray(assets.name, slice));
    for (const f of found) existing.add(f.name);
  }
  let validation: ReturnType<typeof validateAssetCsv>;
  try {
    validation = validateAssetCsv(csv, existing, ASSET_IMPORT_ASYNC_MAX_ROWS);
  } catch (error) {
    if (error instanceof RangeError) throw new JobFailure(error.message, true);
    throw error;
  }
  if (validation.headerErrors?.length) throw new JobFailure(validation.headerErrors.join("；"), true);
  const sampleErrors = validation.rows
    .filter((r) => r.status !== "valid")
    .slice(0, 20)
    .map((r) => ({ row: r.row, name: r.name, errors: r.errors }));
  const failedResult = {
    total: validation.total,
    imported: 0,
    skipped: 0,
    errorCount: validation.errorCount,
    duplicateCount: validation.duplicateCount,
    sampleErrors,
  };
  if (validation.errorCount > 0) {
    throw new JobFailure(`存在 ${validation.errorCount} 行无效数据，未导入`, true, failedResult);
  }
  if (onDuplicate === "fail" && validation.duplicateCount > 0) {
    throw new JobFailure(`存在 ${validation.duplicateCount} 行重名资产，未导入`, true, failedResult);
  }
  await ctx.progress(10);
  const rows: AssetInput[] = validation.validRows;
  let imported = 0;
  let skipped = validation.duplicateCount;
  for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
    const batch = rows.slice(i, i + IMPORT_BATCH_SIZE);
    const inserted = await db.transaction(async (tx) => {
      await lockPermission(tx, creator.id, "assets:manage");
      // ON CONFLICT DO NOTHING: rows created concurrently since validation are counted as skipped.
      return tx.insert(assets).values(batch).onConflictDoNothing().returning({ id: assets.id });
    });
    imported += inserted.length;
    skipped += batch.length - inserted.length;
    await ctx.progress(10 + Math.round(((i + batch.length) / Math.max(rows.length, 1)) * 85));
  }
  const result = {
    total: validation.total,
    imported,
    skipped,
    errorCount: validation.errorCount,
    sampleErrors,
  };
  return {
    result,
    compactPayload: {
      filename,
      onDuplicate,
      csvBytes: Buffer.byteLength(csv, "utf8"),
      actorSource: jobActorSource(job),
    },
    finalize: async (tx) => {
      await auditResource(
        tx,
        "asset.bulk_import",
        creator,
        { code: "assets", name: "资产台账" },
        { imported, skipped, filename, jobId: job.id, jobType: job.type },
        jobActorSource(job),
      );
    },
  };
};

registerJobHandler("assets.export_csv", csvErrorsArePermanent(exportAssetsCsv));
registerJobHandler("assets.bulk_import", csvErrorsArePermanent(bulkImportAssets));
