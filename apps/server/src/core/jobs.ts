// Lightweight PostgreSQL job queue. One in-process worker loop per API process; multiple processes are
// safe because each claim uses `FOR UPDATE SKIP LOCKED`. Stale `running` rows (worker crashed) are
// re-claimed after JOB_LOCK_STALE_MS while attempts < max_attempts.
// Business job handlers self-register with registerJobHandler() from their own module.
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  ACTOR_SOURCES,
  type ActorSource,
  type Job,
  type JobStatus,
  type JobType,
} from "@optimax-starter/api";
import {
  accountInvites,
  accounts,
  jobs,
  loginGuards,
  oidcStates,
  sessions,
} from "@optimax-starter/db/schema/console";
import { db } from "../services";
import { Refusal, accountFields, type Tx } from "./guards";
import { calculateBackoffMs } from "./job-policy";
import { deleteStoredObjects } from "./storage";

export const JOB_POLL_MS = 5_000;
export const JOB_LOCK_STALE_MS = 5 * 60_000;
export const EXPORT_BATCH_SIZE = 1_000;
export const EXPORT_MAX_ROWS = 200_000;
export const IMPORT_BATCH_SIZE = 200;

export {
  JOB_BACKOFF_BASE_MS,
  JOB_BACKOFF_MAX_MS,
  calculateBackoffMs,
  canCancelJob,
  canCreateJobType,
  canRetryJob,
  canViewJob,
  getJobCreatorViewPermissions,
  getJobPolicy,
  registerJobPolicy,
} from "./job-policy";

/** Never return the raw CSV of an import job in list/detail responses. */
export function publicJob(row: typeof jobs.$inferSelect): Job {
  const payload = { ...(row.payload ?? {}) };
  if (typeof payload.csv === "string") {
    payload.csvBytes = Buffer.byteLength(payload.csv, "utf8");
    delete payload.csv;
  }
  delete payload.actorSource;
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    payload,
    result: row.result ?? null,
    error: row.error ?? null,
    progress: row.progress,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: row.runAfter.toISOString(),
    lockedAt: row.lockedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class JobCancelledError extends Error {
  constructor() {
    super("job cancelled");
    this.name = "JobCancelledError";
  }
}

/** Errors whose message is safe to persist and show (Chinese business messages). */
export class JobFailure extends Error {
  constructor(
    message: string,
    readonly permanent = false,
    readonly result?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "JobFailure";
  }
}

function safeJobError(error: unknown): { message: string; permanent: boolean } {
  if (error instanceof JobFailure) return { message: error.message.slice(0, 500), permanent: error.permanent };
  if (error instanceof Refusal) return { message: error.message.slice(0, 500), permanent: true };
  const name = error instanceof Error ? error.name : "Error";
  return { message: `任务执行出错（${name}）`, permanent: false };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
export type JobRow = typeof jobs.$inferSelect;

export type JobContext = {
  /** Updates progress, refreshes the lease and throws JobCancelledError if the job was cancelled. */
  progress(value: number): Promise<void>;
};

export type HandlerOutcome = {
  result: Record<string, unknown>;
  /** Runs inside the same transaction that marks the job succeeded. */
  finalize?: (tx: Tx) => Promise<Record<string, unknown> | void>;
  /** Storage keys to delete if finalisation fails or the job was cancelled meanwhile. */
  cleanupKeys?: string[];
  /** Replaces the stored payload on success (e.g. drop large CSV bodies). */
  compactPayload?: Record<string, unknown>;
};

export type JobHandler = (job: JobRow, ctx: JobContext) => Promise<HandlerOutcome>;

const JOB_HANDLERS = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  JOB_HANDLERS.set(type, handler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return JOB_HANDLERS.get(type);
}

export async function loadCreator(job: JobRow) {
  if (!job.createdBy) throw new JobFailure("任务创建人不存在", true);
  const [creator] = await db.select(accountFields).from(accounts).where(eq(accounts.id, job.createdBy));
  if (!creator?.active) throw new JobFailure("任务创建人已停用", true);
  return creator;
}

export const jobActorSource = (job: JobRow): ActorSource => {
  const raw = job.payload?.actorSource;
  return typeof raw === "string" && (ACTOR_SOURCES as readonly string[]).includes(raw)
    ? (raw as ActorSource)
    : "human";
};

const cleanupExpired: JobHandler = async (_job, ctx) => {
  const now = new Date();
  const expiredSessions = await db
    .delete(sessions)
    .where(lt(sessions.expires, now))
    .returning({ id: sessions.id });
  await ctx.progress(25);
  const expiredOidc = await db
    .delete(oidcStates)
    .where(lt(oidcStates.expiresAt, now))
    .returning({ k: oidcStates.stateHash });
  await ctx.progress(50);
  const staleInvites = await db
    .delete(accountInvites)
    .where(
      and(
        isNull(accountInvites.usedAt),
        sql`${accountInvites.expiresAt} < now() - interval '7 days'`,
      ),
    )
    .returning({ id: accountInvites.id });
  await ctx.progress(75);
  const staleGuards = await db
    .delete(loginGuards)
    .where(
      and(
        or(isNull(loginGuards.lockedUntil), lt(loginGuards.lockedUntil, now)),
        sql`${loginGuards.windowStart} < now() - interval '1 day'`,
      ),
    )
    .returning({ k: loginGuards.key });
  return {
    result: {
      sessions: expiredSessions.length,
      oidcStates: expiredOidc.length,
      invites: staleInvites.length,
      loginGuards: staleGuards.length,
    },
  };
};

registerJobHandler("system.cleanup_expired", cleanupExpired);

// ---------------------------------------------------------------------------
// Claiming & processing
// ---------------------------------------------------------------------------
const STALE_INTERVAL = sql.raw(`interval '${Math.round(JOB_LOCK_STALE_MS / 1000)} seconds'`);

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Atomically claims the next due job (or a stale running one) and returns it, or null. */
export async function claimNextJob(): Promise<JobRow | null> {
  const claimed = await db.execute(sql`
    update ${jobs}
    set status = 'running',
        attempts = ${jobs.attempts} + 1,
        locked_at = now(),
        started_at = coalesce(${jobs.startedAt}, now()),
        updated_at = now()
    where ${jobs.id} = (
      select id from ${jobs}
      where (status = 'pending' and run_after <= now())
         or (status = 'running' and locked_at < now() - ${STALE_INTERVAL} and attempts < max_attempts)
      order by run_after asc, id asc
      limit 1
      for update skip locked
    )
    returning ${jobs.id} as id
  `);
  const id = Number(rowsOf(claimed)[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}

/** Stale running jobs that already used all attempts are marked failed. */
async function failExhaustedStaleJobs() {
  await db.execute(sql`
    update ${jobs}
    set status = 'failed', error = '任务执行超时', locked_at = null, finished_at = now(), updated_at = now()
    where status = 'running' and locked_at < now() - ${STALE_INTERVAL} and attempts >= max_attempts
  `);
}

async function processJob(job: JobRow): Promise<void> {
  const handler = getJobHandler(job.type);
  const stillRunning = and(eq(jobs.id, job.id), eq(jobs.status, "running"));
  if (!handler) {
    await db
      .update(jobs)
      .set({ status: "failed", error: "未知任务类型", lockedAt: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(stillRunning);
    return;
  }
  const ctx: JobContext = {
    async progress(value) {
      const updated = await db
        .update(jobs)
        .set({ progress: Math.max(0, Math.min(100, Math.round(value))), lockedAt: new Date(), updatedAt: new Date() })
        .where(stillRunning)
        .returning({ id: jobs.id });
      if (!updated.length) throw new JobCancelledError();
    },
  };
  let outcome: HandlerOutcome | null = null;
  try {
    outcome = await handler(job, ctx);
    const done = outcome;
    await db.transaction(async (tx) => {
      const extra = (await done.finalize?.(tx)) ?? {};
      // Re-checks cancellation atomically: only a still-running row becomes succeeded.
      const updated = await tx
        .update(jobs)
        .set({
          status: "succeeded",
          progress: 100,
          result: { ...done.result, ...extra },
          error: null,
          lockedAt: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
          ...(done.compactPayload ? { payload: done.compactPayload } : {}),
        })
        .where(stillRunning)
        .returning({ id: jobs.id });
      if (!updated.length) throw new JobCancelledError();
    });
  } catch (error) {
    if (outcome?.cleanupKeys?.length) await deleteStoredObjects(outcome.cleanupKeys);
    if (error instanceof JobCancelledError) return;
    const { message, permanent } = safeJobError(error);
    const exhausted = permanent || job.attempts >= job.maxAttempts;
    const failureResult = error instanceof JobFailure && error.result ? { result: error.result } : {};
    await db
      .update(jobs)
      .set(
        exhausted
          ? {
              status: "failed",
              error: message,
              lockedAt: null,
              finishedAt: new Date(),
              updatedAt: new Date(),
              ...failureResult,
            }
          : {
              status: "pending",
              error: message,
              lockedAt: null,
              runAfter: new Date(Date.now() + calculateBackoffMs(job.attempts)),
              updatedAt: new Date(),
            },
      )
      .where(stillRunning)
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------
let stopped = true;
let timer: ReturnType<typeof setTimeout> | null = null;
let current: Promise<void> | null = null;
let rerun = false;

export const jobsEnabled = () => process.env.STARTER_JOBS_ENABLED !== "false";

function schedule(ms: number) {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), ms);
  timer.unref?.();
}

async function drain() {
  await failExhaustedStaleJobs().catch(() => undefined);
  while (!stopped) {
    const job = await claimNextJob();
    if (!job) break;
    await processJob(job);
  }
}

function tick(): Promise<void> {
  if (stopped) return Promise.resolve();
  if (current) {
    rerun = true;
    return current;
  }
  current = drain()
    .catch((error: unknown) => {
      console.error("job worker tick failed", (error as Error)?.name ?? "Error");
    })
    .finally(() => {
      current = null;
      if (rerun) {
        rerun = false;
        schedule(0);
      } else {
        schedule(JOB_POLL_MS);
      }
    });
  return current;
}

export function startJobWorker(): boolean {
  if (!jobsEnabled() || !stopped) return false;
  stopped = false;
  schedule(1_000);
  return true;
}

export async function stopJobWorker(timeoutMs = 8_000): Promise<void> {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  if (current) {
    await Promise.race([current, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.())]);
  }
}

/** Wakes the worker immediately after a job was inserted or reset to pending. */
export function notifyJobQueued(): void {
  if (stopped) return;
  if (current) {
    rerun = true;
    return;
  }
  schedule(0);
}
