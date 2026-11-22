// Job payload contracts and pure job policy (core/job-policy.ts has no DB imports).
import { describe, expect, it } from "vitest";
import { jobCreateSchema } from "@optimax-starter/api";
import {
  JOB_BACKOFF_BASE_MS,
  JOB_BACKOFF_MAX_MS,
  calculateBackoffMs,
  canCancelJob,
  canCreateJobType,
  canRetryJob,
  canViewJob,
  getJobCreatorViewPermissions,
  getJobPolicy,
  jobCreateLockPermission,
  registerJobPolicy,
} from "./job-policy";

describe("jobCreateSchema", () => {
  it("accepts an export with defaults and a full filter", () => {
    expect(jobCreateSchema.parse({ type: "assets.export_csv" })).toEqual({
      type: "assets.export_csv",
      payload: {},
    });
    const parsed = jobCreateSchema.parse({
      type: "assets.export_csv",
      payload: {
        q: " 门户 ",
        qOp: "contains",
        stage: ["已登记"],
        domain: ["采购"],
        owner: ["平台组", "数据组"],
        sortBy: "name",
        sortDir: "asc",
      },
    });
    expect(parsed.payload).toMatchObject({ q: "门户", owner: ["平台组", "数据组"], sortBy: "name" });
  });

  it("rejects unknown filter keys, sort fields and stages", () => {
    for (const payload of [
      { page: 2 },
      { sortBy: "createdAt" },
      { sortDir: "up" },
      { stage: ["不存在"] },
      { owner: [""] },
      { domain: Array.from({ length: 21 }, (_, i) => `d${i}`) },
    ]) {
      expect(jobCreateSchema.safeParse({ type: "assets.export_csv", payload }).success, JSON.stringify(payload)).toBe(
        false,
      );
    }
  });

  it("requires CSV for bulk import and defaults onDuplicate to skip", () => {
    expect(jobCreateSchema.safeParse({ type: "assets.bulk_import", payload: {} }).success).toBe(false);
    expect(jobCreateSchema.safeParse({ type: "assets.bulk_import", payload: { csv: "" } }).success).toBe(false);
    expect(
      jobCreateSchema.safeParse({ type: "assets.bulk_import", payload: { csv: "a", onDuplicate: "merge" } }).success,
    ).toBe(false);
    const parsed = jobCreateSchema.parse({
      type: "assets.bulk_import",
      payload: { csv: "名称\n门户\n", filename: " a.csv " },
    });
    expect(parsed.payload).toEqual({ csv: "名称\n门户\n", filename: "a.csv", onDuplicate: "skip" });
  });

  it("caps bulk import CSV below the 2 MiB request policy", () => {
    const csv = "x".repeat(2 * 1024 * 1024);
    expect(jobCreateSchema.safeParse({ type: "assets.bulk_import", payload: { csv } }).success).toBe(false);
  });

  it("accepts cleanup only with an empty payload", () => {
    expect(jobCreateSchema.parse({ type: "system.cleanup_expired" })).toEqual({
      type: "system.cleanup_expired",
      payload: {},
    });
    expect(jobCreateSchema.safeParse({ type: "system.cleanup_expired", payload: { all: true } }).success).toBe(false);
  });

  it("rejects unknown types and extra top-level keys", () => {
    expect(jobCreateSchema.safeParse({ type: "shell.exec", payload: {} }).success).toBe(false);
    expect(jobCreateSchema.safeParse({ type: "assets.export_csv", payload: {}, createdBy: 1 }).success).toBe(false);
    expect(jobCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe("canCreateJobType", () => {
  it("self-registers system.cleanup_expired in core", () => {
    expect(getJobPolicy("system.cleanup_expired")).toBeDefined();
    expect(canCreateJobType("system.cleanup_expired", ["jobs:read"])).toBe(false);
    expect(canCreateJobType("system.cleanup_expired", ["jobs:manage"])).toBe(true);
    expect(canCreateJobType("system.cleanup_expired", ["system:settings:manage"])).toBe(true);
    expect(jobCreateLockPermission("system.cleanup_expired", ["system:settings:manage"])).toBe(
      "system:settings:manage",
    );
    expect(
      jobCreateLockPermission("system.cleanup_expired", ["system:settings:manage", "jobs:manage"]),
    ).toBe("jobs:manage");
    expect(canCreateJobType("unknown", ["jobs:manage", "system:settings:manage"])).toBe(false);
    expect(jobCreateLockPermission("unknown", ["jobs:manage"])).toBeNull();
  });

  it("reads dynamically registered job policies", () => {
    registerJobPolicy("test.dynamic_export", {
      createPermissions: ["test-ledger:read"],
      creatorViewPermissions: ["test-ledger:read"],
      retryGuard: (job) => (job.payload?.purged ? "已清理" : null),
    });
    expect(canCreateJobType("test.dynamic_export", ["test-ledger:read"])).toBe(true);
    expect(canCreateJobType("test.dynamic_export", ["jobs:manage"])).toBe(false);
    expect(getJobCreatorViewPermissions()).toContain("test-ledger:read");
    expect(getJobPolicy("test.dynamic_export")?.retryGuard?.({ payload: { purged: true } })).toBe(
      "已清理",
    );
  });
});

describe("job access policy", () => {
  registerJobPolicy("test.creator_view", {
    createPermissions: ["test-reader:read"],
    creatorViewPermissions: ["test-reader:read"],
  });
  const reader = { id: 1, permissions: ["test-reader:read"] };
  const auditor = { id: 2, permissions: ["jobs:read"] };
  const operator = { id: 3, permissions: ["jobs:read", "jobs:manage"] };
  const nobody = { id: 4, permissions: [] as string[] };

  it("jobs:read sees every job; creator-view permissions see only own jobs", () => {
    expect(canViewJob(auditor, { createdBy: 99 })).toBe(true);
    expect(canViewJob(auditor, { createdBy: null })).toBe(true);
    expect(canViewJob(reader, { createdBy: 1 })).toBe(true);
    expect(canViewJob(reader, { createdBy: 99 })).toBe(false);
    expect(canViewJob(reader, { createdBy: null })).toBe(false);
    expect(canViewJob(nobody, { createdBy: 4 })).toBe(false);
  });

  it("jobs:manage cancels pending or running jobs", () => {
    expect(canCancelJob(operator, { createdBy: 99, status: "pending" })).toBe(true);
    expect(canCancelJob(operator, { createdBy: 99, status: "running" })).toBe(true);
    for (const status of ["succeeded", "failed", "cancelled"]) {
      expect(canCancelJob(operator, { createdBy: 99, status }), status).toBe(false);
    }
  });

  it("creators cancel only their own pending jobs", () => {
    expect(canCancelJob(reader, { createdBy: 1, status: "pending" })).toBe(true);
    expect(canCancelJob(reader, { createdBy: 1, status: "running" })).toBe(false);
    expect(canCancelJob(reader, { createdBy: 99, status: "pending" })).toBe(false);
    expect(canCancelJob(auditor, { createdBy: 99, status: "pending" })).toBe(false);
  });

  it("retry requires jobs:manage and a failed or cancelled job", () => {
    expect(canRetryJob(operator, { status: "failed" })).toBe(true);
    expect(canRetryJob(operator, { status: "cancelled" })).toBe(true);
    for (const status of ["pending", "running", "succeeded"]) {
      expect(canRetryJob(operator, { status }), status).toBe(false);
    }
    expect(canRetryJob(reader, { status: "failed" })).toBe(false);
    expect(canRetryJob(auditor, { status: "failed" })).toBe(false);
  });
});

describe("calculateBackoffMs", () => {
  it("doubles from 30s per attempt", () => {
    expect(calculateBackoffMs(1)).toBe(JOB_BACKOFF_BASE_MS);
    expect(calculateBackoffMs(2)).toBe(60_000);
    expect(calculateBackoffMs(3)).toBe(120_000);
    expect(calculateBackoffMs(4)).toBe(240_000);
    expect(calculateBackoffMs(6)).toBe(960_000);
  });

  it("caps at 30 minutes", () => {
    expect(calculateBackoffMs(7)).toBe(JOB_BACKOFF_MAX_MS);
    expect(calculateBackoffMs(50)).toBe(JOB_BACKOFF_MAX_MS);
    expect(calculateBackoffMs(10_000)).toBe(JOB_BACKOFF_MAX_MS);
  });

  it("treats invalid attempt counts as the first attempt", () => {
    expect(calculateBackoffMs(0)).toBe(JOB_BACKOFF_BASE_MS);
    expect(calculateBackoffMs(-3)).toBe(JOB_BACKOFF_BASE_MS);
    expect(calculateBackoffMs(2.9)).toBe(60_000);
  });

  it("is monotonic non-decreasing", () => {
    let prev = 0;
    for (let n = 1; n <= 20; n += 1) {
      const next = calculateBackoffMs(n);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });
});
