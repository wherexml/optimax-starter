// Example "assets" job policies registered by modules/assets-policy.ts (no DB imports).
import { describe, expect, it } from "vitest";
import {
  canCancelJob,
  canCreateJobType,
  canViewJob,
  getJobCreatorViewPermissions,
  getJobPolicy,
  jobCreateLockPermission,
} from "../core/job-policy";
import { ASSET_IMPORT_PURGED_MESSAGE } from "./assets-policy";

describe("assets job policies", () => {
  it("maps each asset job type to its required permission", () => {
    expect(canCreateJobType("assets.export_csv", ["assets:read"])).toBe(true);
    expect(canCreateJobType("assets.export_csv", ["jobs:manage"])).toBe(false);
    expect(canCreateJobType("assets.bulk_import", ["assets:read"])).toBe(false);
    expect(canCreateJobType("assets.bulk_import", ["assets:manage"])).toBe(true);
    expect(jobCreateLockPermission("assets.export_csv", ["assets:read"])).toBe("assets:read");
    expect(jobCreateLockPermission("assets.bulk_import", ["assets:manage"])).toBe("assets:manage");
  });

  it("assets:read callers see and cancel only their own pending jobs", () => {
    const reader = { id: 1, permissions: ["assets:read"] };
    expect(getJobCreatorViewPermissions()).toContain("assets:read");
    expect(canViewJob(reader, { createdBy: 1 })).toBe(true);
    expect(canViewJob(reader, { createdBy: 99 })).toBe(false);
    expect(canViewJob(reader, { createdBy: null })).toBe(false);
    expect(canCancelJob(reader, { createdBy: 1, status: "pending" })).toBe(true);
    expect(canCancelJob(reader, { createdBy: 1, status: "running" })).toBe(false);
    expect(canCancelJob(reader, { createdBy: 99, status: "pending" })).toBe(false);
  });

  it("refuses to retry a bulk import whose CSV was purged", () => {
    const guard = getJobPolicy("assets.bulk_import")?.retryGuard;
    expect(guard?.({ payload: { csvBytes: 10 } })).toBe(ASSET_IMPORT_PURGED_MESSAGE);
    expect(guard?.({ payload: null })).toBe(ASSET_IMPORT_PURGED_MESSAGE);
    expect(guard?.({ payload: { csv: "名称\n门户\n" } })).toBeNull();
    expect(getJobPolicy("assets.export_csv")?.retryGuard).toBeUndefined();
  });
});
