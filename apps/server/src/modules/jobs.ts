import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  JOB_STATUSES,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  jobCreateSchema,
  type JobPage,
  type JobType,
} from "@optimax-starter/api";
import { accounts, jobs } from "@optimax-starter/db/schema/console";
import { db } from "../services";
import { AUDIT_MAX_PAGE, auditResource } from "../core/audit";
import {
  PERMISSION_SHARED_LOCK,
  Refusal,
  accountFields,
  errorJson,
  guarded,
  jsonBody,
  lockPermission,
  parsePositiveId,
  requireAnyPermission,
  requirePermission,
  type Env,
  type Tx,
} from "../core/guards";
import {
  canCancelJob,
  canRetryJob,
  canViewJob,
  getJobCreatorViewPermissions,
  getJobPolicy,
  jobCreateLockPermission,
} from "../core/job-policy";
import { notifyJobQueued, publicJob } from "../core/jobs";

const listQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.enum(JOB_TYPES).optional(),
  mine: z.enum(["true", "false", "1", "0"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((n) => Math.min(n, AUDIT_MAX_PAGE)),
});

const jobResource = (row: { id: number; type: string }) => ({
  id: row.id,
  code: `JOB-${row.id}`,
  name: JOB_TYPE_LABELS[row.type as JobType] ?? row.type,
});

/** Re-reads the actor inside the tx (shared lock) and verifies it is still active. */
async function lockActiveSelf(tx: Tx, actorId: number) {
  await tx.execute(PERMISSION_SHARED_LOCK);
  const [self] = await tx.select(accountFields).from(accounts).where(eq(accounts.id, actorId));
  if (!self?.active) throw new Refusal(403, "无权执行该操作");
  return self;
}

/** `extra`, or any creator-view permission registered by a job policy (resolved per request). */
const requireJobReader = (...extra: string[]): MiddlewareHandler<Env> => (c, next) =>
  requireAnyPermission(...extra, ...getJobCreatorViewPermissions())(c, next);

export const jobsRoutes = new Hono<Env>()
  .get("/jobs", requireJobReader("jobs:read"), async (c) => {
    const cleaned = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v.trim() !== ""));
    const parsed = listQuerySchema.safeParse(cleaned);
    if (!parsed.success) return errorJson(c, 400, "筛选条件无效");
    const { status, type, mine, page, size } = parsed.data;
    const actor = c.get("actor");
    const onlyMine = !actor.permissions.includes("jobs:read") || mine === "true" || mine === "1";
    const where = and(
      status ? eq(jobs.status, status) : undefined,
      type ? eq(jobs.type, type) : undefined,
      onlyMine ? eq(jobs.createdBy, actor.id) : undefined,
    );
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(jobs)
        .where(where)
        .orderBy(desc(jobs.createdAt), desc(jobs.id))
        .limit(size)
        .offset((page - 1) * size),
      db.select({ n: count() }).from(jobs).where(where),
    ]);
    const body: JobPage = { items: rows.map(publicJob), total: Number(totals[0]?.n ?? 0), page, size };
    return c.json(body);
  })
  .get("/jobs/:id", requireJobReader("jobs:read"), async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return errorJson(c, 400, "无效的任务");
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!row || !canViewJob(c.get("actor"), row)) return errorJson(c, 404, "任务不存在");
    return c.json(publicJob(row));
  })
  .post(
    "/jobs",
    jsonBody(jobCreateSchema, (error) => error.issues[0]?.message ?? "任务参数无效"),
    async (c) => {
      const input = c.req.valid("json");
      const actor = c.get("actor");
      const lockCode = jobCreateLockPermission(input.type, actor.permissions);
      if (!lockCode) {
        return errorJson(c, 403, "无权执行该操作");
      }
      return guarded(c, async () => {
        const row = await db.transaction(async (tx) => {
          // Live role re-check under the shared permission lock (token scopes were checked above).
          const self = await lockPermission(tx, actor.id, lockCode);
          const [created] = await tx
            .insert(jobs)
            .values({
              type: input.type,
              payload: { ...input.payload, actorSource: actor.actorSource },
              createdBy: actor.id,
            })
            .returning();
          await auditResource(
            tx,
            "job.create",
            self,
            jobResource(created!),
            { jobId: created!.id, jobType: created!.type },
            actor.actorSource,
          );
          return created!;
        });
        notifyJobQueued();
        return c.json(publicJob(row), 201);
      });
    },
  )
  .post("/jobs/:id/retry", requirePermission("jobs:manage"), async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return errorJson(c, 400, "无效的任务");
    const actor = c.get("actor");
    return guarded(c, async () => {
      const row = await db.transaction(async (tx) => {
        const self = await lockPermission(tx, actor.id, "jobs:manage");
        const [before] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
        if (!before) throw new Refusal(404, "任务不存在");
        if (!canRetryJob(actor, before)) throw new Refusal(409, "仅失败或已取消的任务可以重试");
        const retryRefusal = getJobPolicy(before.type)?.retryGuard?.(before);
        if (retryRefusal) throw new Refusal(409, retryRefusal);
        const [after] = await tx
          .update(jobs)
          .set({
            status: "pending",
            attempts: 0,
            progress: 0,
            error: null,
            result: null,
            lockedAt: null,
            finishedAt: null,
            runAfter: sql`now()`,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "cancelled"])))
          .returning();
        if (!after) throw new Refusal(409, "任务状态已变化，请刷新");
        await auditResource(
          tx,
          "job.retry",
          self,
          jobResource(after),
          { jobId: after.id, jobType: after.type, from: before.status, to: "pending" },
          actor.actorSource,
        );
        return after;
      });
      notifyJobQueued();
      return c.json(publicJob(row));
    });
  })
  .post("/jobs/:id/cancel", requireJobReader("jobs:manage"), async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return errorJson(c, 400, "无效的任务");
    const actor = c.get("actor");
    return guarded(c, async () => {
      const row = await db.transaction(async (tx) => {
        const self = actor.permissions.includes("jobs:manage")
          ? await lockPermission(tx, actor.id, "jobs:manage")
          : await lockActiveSelf(tx, actor.id);
        const [before] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
        if (!before || !canViewJob(actor, before)) throw new Refusal(404, "任务不存在");
        if (!canCancelJob(actor, before)) {
          throw new Refusal(409, "当前任务状态不可取消，或无权取消执行中的任务");
        }
        const [after] = await tx
          .update(jobs)
          .set({ status: "cancelled", lockedAt: null, finishedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(jobs.id, id), inArray(jobs.status, ["pending", "running"])))
          .returning();
        if (!after) throw new Refusal(409, "任务状态已变化，请刷新");
        await auditResource(
          tx,
          "job.cancel",
          self,
          jobResource(after),
          { jobId: after.id, jobType: after.type, from: before.status, to: "cancelled" },
          actor.actorSource,
        );
        return after;
      });
      return c.json(publicJob(row));
    });
  });
