// Pure job policy helpers (no DB imports) shared by core/jobs.ts, modules/jobs.ts and unit tests.
// Business modules self-register their job types with registerJobPolicy(); core only knows
// "system.cleanup_expired".

export const JOB_BACKOFF_BASE_MS = 30_000;
export const JOB_BACKOFF_MAX_MS = 30 * 60_000;

/** Exponential backoff after the Nth failed attempt: 30s, 60s, 120s ... capped at 30 min. */
export function calculateBackoffMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(JOB_BACKOFF_MAX_MS, JOB_BACKOFF_BASE_MS * 2 ** (n - 1));
}

export type JobPolicy = {
  /**
   * Holding any of these permissions allows creating the job. The first one the caller holds is
   * re-checked under the shared permission lock inside the create transaction.
   */
  createPermissions: readonly string[];
  /** Callers without jobs:read but holding one of these may view/cancel the jobs they created. */
  creatorViewPermissions?: readonly string[];
  /** Returns a refusal message when a failed/cancelled job can no longer be retried. */
  retryGuard?: (job: { payload: Record<string, unknown> | null }) => string | null;
};

const JOB_POLICIES = new Map<string, JobPolicy>();

export function registerJobPolicy(type: string, policy: JobPolicy): void {
  JOB_POLICIES.set(type, policy);
}

export function getJobPolicy(type: string): JobPolicy | undefined {
  return JOB_POLICIES.get(type);
}

/** Union of every registered creatorViewPermissions entry (deduplicated, registration order). */
export function getJobCreatorViewPermissions(): string[] {
  const out = new Set<string>();
  for (const policy of JOB_POLICIES.values()) {
    for (const code of policy.creatorViewPermissions ?? []) out.add(code);
  }
  return [...out];
}

registerJobPolicy("system.cleanup_expired", {
  createPermissions: ["jobs:manage", "system:settings:manage"],
});

export function canCreateJobType(type: string, permissions: readonly string[]): boolean {
  const policy = getJobPolicy(type);
  if (!policy) return false;
  return policy.createPermissions.some((code) => permissions.includes(code));
}

/** The permission to lock inside the create transaction, or null when creation is not allowed. */
export function jobCreateLockPermission(
  type: string,
  permissions: readonly string[],
): string | null {
  const policy = getJobPolicy(type);
  return policy?.createPermissions.find((code) => permissions.includes(code)) ?? null;
}

type JobActor = { id: number; permissions: readonly string[] };
type JobOwnership = { createdBy: number | null; status?: string };

/** jobs:read sees every job; otherwise registered creator-view permissions see only own jobs. */
export function canViewJob(actor: JobActor, job: JobOwnership): boolean {
  if (actor.permissions.includes("jobs:read")) return true;
  return (
    getJobCreatorViewPermissions().some((code) => actor.permissions.includes(code)) &&
    job.createdBy === actor.id
  );
}

/** jobs:manage cancels pending/running jobs; creators may cancel their own pending jobs. */
export function canCancelJob(actor: JobActor, job: JobOwnership): boolean {
  if (job.status !== "pending" && job.status !== "running") return false;
  if (actor.permissions.includes("jobs:manage")) return true;
  return job.status === "pending" && job.createdBy === actor.id;
}

export const canRetryJob = (actor: JobActor, job: { status: string }) =>
  actor.permissions.includes("jobs:manage") && (job.status === "failed" || job.status === "cancelled");
