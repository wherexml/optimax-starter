// Example "assets" job policies (DB-free). Imported side-effectfully by modules/assets.ts.
import { registerJobPolicy } from "../core/job-policy";

export const ASSET_IMPORT_PURGED_MESSAGE = "导入内容已清理，请重新上传";

registerJobPolicy("assets.export_csv", {
  createPermissions: ["assets:read"],
  // Members with assets:read may follow and cancel the exports they created.
  creatorViewPermissions: ["assets:read"],
});

registerJobPolicy("assets.bulk_import", {
  createPermissions: ["assets:manage"],
  // The CSV body is dropped after a successful run, so such jobs can no longer be retried.
  retryGuard: (job) => (typeof job.payload?.csv !== "string" ? ASSET_IMPORT_PURGED_MESSAGE : null),
});
