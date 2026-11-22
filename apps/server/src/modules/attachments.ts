import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ATTACHMENT_ENTITY_TYPES, type Attachment, type AttachmentEntityType } from "@optimax-starter/api";
import { attachments, jobs } from "@optimax-starter/db/schema/console";
import { db } from "../services";
import {
  getAttachmentEntity,
  getUploadableAttachmentLabels,
  registerAttachmentEntity,
} from "../core/attachment-registry";
import { auditResource } from "../core/audit";
import {
  Refusal,
  errorJson,
  guarded,
  lockPermission,
  parsePositiveId,
  type Actor,
  type Env,
} from "../core/guards";
import { canViewJob } from "../core/job-policy";
import {
  getStorageDriver,
  getUploadMaxBytes,
  newStorageKey,
  sha256OfBytes,
  validateUploadFile,
} from "../core/storage";

const listQuerySchema = z.object({
  entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
  entityId: z.coerce.number().int().positive(),
});

type AttachmentRow = typeof attachments.$inferSelect;

const toAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  entityType: row.entityType as AttachmentEntityType,
  entityId: row.entityId,
  originalName: row.originalName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  sha256: row.sha256,
  uploadedBy: row.uploadedBy ?? null,
  createdAt: row.createdAt.toISOString(),
});

// Job artifacts (e.g. CSV exports) are written by the worker only.
// Read access: jobs:read OR (registered creator-view permission AND own job).
registerAttachmentEntity("job", {
  label: "任务",
  canRead: async (actor, entityId) => {
    if (actor.permissions.includes("jobs:read")) return true;
    const [job] = await db.select({ createdBy: jobs.createdBy }).from(jobs).where(eq(jobs.id, entityId));
    return !!job && canViewJob(actor, job);
  },
  managePermission: "jobs:manage",
  allowUserUpload: false,
  notFoundMessage: "任务不存在",
});

async function canReadEntity(actor: Actor, entityType: string, entityId: number): Promise<boolean> {
  const entity = getAttachmentEntity(entityType);
  return entity ? await entity.canRead(actor, entityId) : false;
}

const managePermissionFor = (entityType: string) =>
  getAttachmentEntity(entityType)?.managePermission ?? null;

const uploadTargetRefusal = () => {
  const labels = getUploadableAttachmentLabels();
  return labels.length ? `仅支持为${labels.join("、")}上传附件` : "当前没有可上传附件的业务对象";
};

const attachmentResource = (row: { id: number; originalName: string }) => ({
  id: row.id,
  code: `ATT-${row.id}`,
  name: row.originalName,
});

export const attachmentsRoutes = new Hono<Env>()
  .get("/attachments", async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return errorJson(c, 400, "参数无效");
    const { entityType, entityId } = parsed.data;
    if (!(await canReadEntity(c.get("actor"), entityType, entityId))) {
      return errorJson(c, 403, "无权执行该操作");
    }
    const rows = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)))
      .orderBy(desc(attachments.createdAt), desc(attachments.id));
    return c.json(rows.map(toAttachment));
  })
  .post("/attachments", async (c) => {
    const actor = c.get("actor");
    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = await c.req.parseBody();
    } catch {
      return errorJson(c, 400, "上传内容无效");
    }
    const entityType = typeof form.entityType === "string" ? form.entityType : "";
    const entityId = parsePositiveId(typeof form.entityId === "string" ? form.entityId : "");
    const file = form.file;
    // Users may only attach files to entities registered with allowUserUpload (e.g. assets).
    const entity = getAttachmentEntity(entityType);
    if (!entity?.allowUserUpload || !entityId) return errorJson(c, 400, uploadTargetRefusal());
    const permission = entity.managePermission;
    if (!actor.permissions.includes(permission)) return errorJson(c, 403, "无权执行该操作");
    if (!(file instanceof File)) return errorJson(c, 400, "请选择要上传的文件");

    const maxBytes = getUploadMaxBytes();
    if (file.size > maxBytes) {
      return errorJson(c, 413, `文件超过 ${Math.round(maxBytes / 1024 / 1024)} MiB 上限`, "FILE_TOO_LARGE");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateUploadFile({ filename: file.name, declaredMime: file.type, bytes, maxBytes });
    if (!checked.ok) return errorJson(c, checked.status, checked.message, checked.code);

    if (entity.verifyTarget && !(await entity.verifyTarget(entityId))) {
      return errorJson(c, 404, entity.notFoundMessage);
    }

    const storage = getStorageDriver();
    const key = newStorageKey(entityType, checked.ext);
    const sha256 = sha256OfBytes(bytes);
    // Bytes first, then the row; on any DB failure the orphan object is removed.
    await storage.put(key, bytes, checked.storedMime);
    try {
      return await guarded(c, async () => {
        const row = await db.transaction(async (tx) => {
          const self = await lockPermission(tx, actor.id, permission);
          if (entity.lockTargetInTx && !(await entity.lockTargetInTx(tx, entityId))) {
            throw new Refusal(404, entity.notFoundMessage);
          }
          const [inserted] = await tx
            .insert(attachments)
            .values({
              entityType,
              entityId,
              storageDriver: storage.driverName,
              storageKey: key,
              originalName: checked.safeName,
              mimeType: checked.storedMime,
              sizeBytes: bytes.byteLength,
              sha256,
              uploadedBy: actor.id,
            })
            .returning();
          await auditResource(
            tx,
            "attachment.upload",
            self,
            attachmentResource(inserted!),
            {
              attachmentId: inserted!.id,
              filename: inserted!.originalName,
              sizeBytes: inserted!.sizeBytes,
              entityId,
            },
            actor.actorSource,
          );
          return inserted!;
        });
        return c.json(toAttachment(row), 201);
      }).then(async (res) => {
        if ((res as Response).status !== 201) await storage.delete(key).catch(() => undefined);
        return res;
      });
    } catch (error) {
      await storage.delete(key).catch(() => undefined);
      throw error;
    }
  })
  .get("/attachments/:id/download", async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return errorJson(c, 400, "无效的附件");
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!row) return errorJson(c, 404, "附件不存在");
    if (!(await canReadEntity(c.get("actor"), row.entityType, row.entityId))) {
      return errorJson(c, 403, "无权执行该操作");
    }
    const bytes = await getStorageDriver().get(row.storageKey);
    if (!bytes) return errorJson(c, 404, "附件文件不存在");
    return c.body(Buffer.from(bytes), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
  })
  .delete("/attachments/:id", async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return errorJson(c, 400, "无效的附件");
    const actor = c.get("actor");
    const [existing] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!existing) return errorJson(c, 404, "附件不存在");
    const permission = managePermissionFor(existing.entityType);
    if (!permission || !actor.permissions.includes(permission)) {
      return errorJson(c, 403, "无权执行该操作");
    }
    return guarded(c, async () => {
      const removed = await db.transaction(async (tx) => {
        const self = await lockPermission(tx, actor.id, permission);
        const [row] = await tx.delete(attachments).where(eq(attachments.id, id)).returning();
        if (!row) throw new Refusal(404, "附件不存在");
        await auditResource(
          tx,
          "attachment.delete",
          self,
          attachmentResource(row),
          { attachmentId: row.id, filename: row.originalName, sizeBytes: row.sizeBytes, entityId: row.entityId },
          actor.actorSource,
        );
        return row;
      });
      await getStorageDriver()
        .delete(removed.storageKey)
        .catch(() => undefined);
      return c.json({ ok: true });
    });
  });
