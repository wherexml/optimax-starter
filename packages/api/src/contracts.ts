import { z } from "zod";
import { ROLE_LABELS, ROLE_VALUES, type AccountRole } from "./permissions";
import type { ActorSource } from "./system";

export { ROLE_LABELS, ROLE_VALUES, type AccountRole };

export const ASSET_STAGES = ["已登记", "待复核"] as const;
export type AssetStage = (typeof ASSET_STAGES)[number];

export const AUDIT_ACTIONS = [
  "account.create",
  "account.update",
  "account.role",
  "account.status",
  "account.password_reset",
  "account.revoke",
  "account.invite_create",
  "account.invite_accept",
  "account.invite_revoke",
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.sso_login",
  "auth.sso_failed",
  "profile.update",
  "profile.password_change",
  "profile.session_revoke",
  "permission.update",
  "permission.reset",
  "system.timezone_update",
  "system.ai_circuit",
  "agent.asset_filter",
  "asset.create",
  "asset.update",
  "asset.bulk_update",
  "asset.bulk_delete",
  "asset.delete",
  "asset.bulk_import",
  "attachment.upload",
  "attachment.delete",
  "job.create",
  "job.retry",
  "job.cancel",
  "token.create",
  "token.revoke",
  // @starter:audit-actions
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "account.create": "新增账户",
  "account.update": "修改姓名",
  "account.role": "调整角色",
  "account.status": "变更状态",
  "account.password_reset": "重置密码",
  "account.revoke": "强制下线",
  "account.invite_create": "生成激活链接",
  "account.invite_accept": "激活账户",
  "account.invite_revoke": "撤销激活链接",
  "auth.login": "登录成功",
  "auth.login_failed": "登录失败",
  "auth.logout": "退出登录",
  "auth.sso_login": "SSO 登录",
  "auth.sso_failed": "SSO 登录失败",
  "profile.update": "修改本人资料",
  "profile.password_change": "修改本人密码",
  "profile.session_revoke": "下线其他会话",
  "permission.update": "修改系统权限",
  "permission.reset": "恢复默认权限",
  "system.timezone_update": "修改系统时区",
  "system.ai_circuit": "切换 AI 熔断开关",
  "agent.asset_filter": "Agent 筛选资产",
  "asset.create": "新增资产",
  "asset.update": "编辑资产",
  "asset.bulk_update": "批量更新资产",
  "asset.bulk_delete": "批量删除资产",
  "asset.delete": "删除资产",
  "asset.bulk_import": "批量导入资产",
  "attachment.upload": "上传附件",
  "attachment.delete": "删除附件",
  "job.create": "创建后台任务",
  "job.retry": "重试后台任务",
  "job.cancel": "取消后台任务",
  "token.create": "创建 API 密钥",
  "token.revoke": "撤销 API 密钥",
  // @starter:audit-action-labels
};

export interface Account {
  id: number;
  username: string;
  name: string;
  role: string;
  active: boolean;
  sessions?: number;
  email?: string | null;
  company?: string | null;
  permissions?: string[];
}

export interface Asset {
  id: number;
  name: string;
  domain: string;
  owner: string;
  stage: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export type AssetPage = PaginatedResult<Asset>;

// Fields allowed in audit detail. Never store passwords, hashes, cookies, prompts or tokens here.
export type AuditDetail = {
  entityId?: number;
  from?: string | boolean;
  to?: string | boolean;
  role?: string;
  sessions?: number;
  /** Names of changed profile/entity fields only, never secret values. */
  fields?: string[];
  domain?: string;
  owner?: string;
  stage?: string;
  targetRole?: string;
  beforePermissions?: string[];
  afterPermissions?: string[];
  matched?: number;
  corrections?: number;
  model?: string;
  ok?: boolean;
  /** Client IP resolved by the server (TRUST_PROXY aware). */
  ip?: string;
  /** Fixed machine reason, e.g. invalid_credentials / inactive / locked / unmatched. */
  reason?: string;
  /** SSO provider id (never secrets or upstream error text). */
  provider?: string;
  /** ISO timestamp, e.g. invite expiry (the raw invite token is never stored). */
  expiresAt?: string;
  /** Bulk import counters and source filename. */
  imported?: number;
  skipped?: number;
  filename?: string;
  /** Attachment metadata (never file bytes). */
  attachmentId?: number;
  sizeBytes?: number;
  /** Background job metadata. */
  jobType?: string;
  jobId?: number;
  /** API token metadata: display prefix only (never the plaintext token or its hash). */
  prefix?: string;
  actorSource?: ActorSource;
  scopes?: string[];
};

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  actorSource: ActorSource;
  actorId: number | null;
  actorUsername: string;
  actorName: string;
  targetId: number | null;
  targetUsername: string | null;
  targetName: string | null;
  detail: Record<string, unknown>;
}

export type AuditPage = PaginatedResult<AuditEntry> & {
  timezone?: string;
};

export const ASSET_SORT_FIELDS = ["id", "name", "domain", "owner", "stage"] as const;
export type AssetSortField = (typeof ASSET_SORT_FIELDS)[number];
export type SortDir = "asc" | "desc";

export type AssetSearch = {
  q?: string;
  qOp?: "contains" | "equals";
  stage?: AssetStage | AssetStage[];
  domain?: string | string[];
  owner?: string | string[];
  sortBy?: AssetSortField;
  sortDir?: SortDir;
  page?: number;
  size?: number;
};

export interface AssetFacetResponse {
  domains: string[];
  owners: string[];
}

// ---------------------------------------------------------------------------
// CSV bulk import
// ---------------------------------------------------------------------------
export const ASSET_IMPORT_SYNC_MAX_ROWS = 500;
export const ASSET_IMPORT_ASYNC_MAX_ROWS = 5000;
export const ASSET_IMPORT_DUPLICATE_MODES = ["fail", "skip"] as const;
export type AssetImportDuplicateMode = (typeof ASSET_IMPORT_DUPLICATE_MODES)[number];

export type AssetImportRowStatus = "valid" | "invalid" | "duplicate";

export interface AssetImportRow {
  /** 1-based data row number (excluding the header line). */
  row: number;
  status: AssetImportRowStatus;
  name: string;
  domain: string;
  owner: string;
  stage: string;
  errors: string[];
  /** "file" = repeated inside the uploaded CSV; "db" = already exists in the ledger. */
  duplicateOf?: "file" | "db";
}

export interface AssetImportPreview {
  total: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  /** Capped preview; invalid/duplicate rows are listed first. */
  rows: AssetImportRow[];
  headerErrors?: string[];
  filename?: string;
}

export interface AssetImportCommitResult {
  ok: true;
  imported: number;
  skipped: number;
}

export const assetImportJsonSchema = z
  .object({
    csv: z.string().min(1, "CSV 内容为空").max(2 * 1024 * 1024, "CSV 内容过大"),
    filename: z.string().trim().max(180).optional(),
    onDuplicate: z.enum(ASSET_IMPORT_DUPLICATE_MODES).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
export const ATTACHMENT_ENTITY_TYPES = ["asset", "job"] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];
export const ATTACHMENT_ALLOWED_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".csv",
  ".xlsx",
  ".docx",
  ".txt",
  ".md",
  ".json",
] as const;
export const ATTACHMENT_DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export interface Attachment {
  id: number;
  entityType: AttachmentEntityType;
  entityId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------
export const JOB_TYPES = ["assets.export_csv", "assets.bulk_import", "system.cleanup_expired"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  "assets.export_csv": "资产导出 CSV",
  "assets.bulk_import": "资产批量导入",
  "system.cleanup_expired": "清理过期数据",
};
export const JOB_STATUSES = ["pending", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export interface Job {
  id: number;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type JobPage = PaginatedResult<Job>;

const assetExportFilterSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    qOp: z.enum(["contains", "equals"]).optional(),
    stage: z.array(z.enum(ASSET_STAGES)).max(20).optional(),
    domain: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    owner: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    sortBy: z.enum(ASSET_SORT_FIELDS).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .strict();
export type AssetExportFilter = z.infer<typeof assetExportFilterSchema>;

export const jobCreateSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("assets.export_csv"),
      payload: assetExportFilterSchema.default({}),
    })
    .strict(),
  z
    .object({
      type: z.literal("assets.bulk_import"),
      payload: z
        .object({
          csv: z.string().min(1, "CSV 内容为空").max(2 * 1024 * 1024 - 4096, "CSV 内容过大"),
          filename: z.string().trim().max(180).optional(),
          onDuplicate: z.enum(ASSET_IMPORT_DUPLICATE_MODES).default("skip"),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("system.cleanup_expired"),
      payload: z.object({}).strict().default({}),
    })
    .strict(),
]);
export type JobCreateInput = z.infer<typeof jobCreateSchema>;

// ---------------------------------------------------------------------------
// API tokens (Bearer)
// ---------------------------------------------------------------------------
export const API_TOKEN_TTL_DAYS = [1, 7, 30, 90, 365] as const;
export const API_TOKEN_ACTOR_SOURCES = ["agent", "system"] as const;

export interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  actorSource: ActorSource;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ApiTokenCreated {
  token: ApiToken;
  /** Shown exactly once; only its SHA-256 digest is stored. */
  plainToken: string;
}

export const apiTokenCreateSchema = z
  .object({
    name: z.string().trim().min(1, "请输入密钥名称").max(64, "名称最多 64 个字符"),
    scopes: z
      .array(z.string().trim().min(1).max(80))
      .min(1, "请至少选择一项权限")
      .max(50, "最多选择 50 项权限"),
    actorSource: z.enum(API_TOKEN_ACTOR_SOURCES),
    ttlDays: z.union([
      z.literal(1),
      z.literal(7),
      z.literal(30),
      z.literal(90),
      z.literal(365),
    ]),
  })
  .strict();
export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;

export type AccountSearch = {
  q?: string;
  status?: "active" | "disabled";
  role?: AccountRole;
};

export type AuditSearch = {
  action?: string;
  actor?: string;
  source?: ActorSource;
  start?: string;
  end?: string;
  page?: number;
  size?: number;
};

export interface AuthProviderInfo {
  id: string;
  label: string;
  loginPath: string;
}

export interface AccountSession {
  id: number;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
}

/** Returned once when an activation link is generated; the raw token is never stored server-side. */
export interface AccountInviteLink {
  invitePath: string;
  expiresAt: string;
}

export interface InvitePreview {
  username: string;
  name: string;
  expiresAt: string;
}

export const INVITE_TTL_HOURS = 72;
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const optionalEmailSchema = z
  .string()
  .trim()
  .max(254, "邮箱最多 254 个字符")
  .refine((v) => v === "" || EMAIL_RE.test(v), "邮箱格式不正确")
  .optional();

export const optionalCompanySchema = z
  .string()
  .trim()
  .max(120, "公司或团队最多 120 个字符")
  .optional();

export const credentialsSchema = z.object({
  username: z.string().trim().min(1, "请输入账户名").max(64, "账户名最多 64 个字符"),
  password: z.string().min(1, "请输入密码").max(256, "密码最多 256 位"),
});

// inviteOnly=true: no initial password; the server creates a disabled account plus a one-time 72h activation link.
export const accountCreateSchema = credentialsSchema
  .extend({
    name: z.string().trim().min(1, "请输入姓名").max(80, "姓名最多 80 个字符"),
    password: z.string().max(256, "密码最多 256 位").optional(),
    role: z.enum(ROLE_VALUES),
    email: optionalEmailSchema,
    company: optionalCompanySchema,
    inviteOnly: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.inviteOnly && (!value.password || value.password.length < 10)) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "密码至少 10 位" });
    }
  });
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountPatchSchema = z
  .object({
    active: z.boolean().optional(),
    role: z.enum(ROLE_VALUES).optional(),
    name: z.string().trim().min(1, "请输入姓名").max(80, "姓名最多 80 个字符").optional(),
    email: optionalEmailSchema,
    company: optionalCompanySchema,
  })
  .strict()
  .refine(
    (v) =>
      v.active !== undefined ||
      v.role !== undefined ||
      v.name !== undefined ||
      v.email !== undefined ||
      v.company !== undefined,
  );
export type AccountPatchInput = z.infer<typeof accountPatchSchema>;

export const passwordResetSchema = z
  .object({
    password: z.string().min(10, "密码至少 10 位").max(256, "密码最多 256 位"),
  })
  .strict();

// strict(): role, active, username and id are rejected, so a profile update cannot escalate privileges.
export const profileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    email: optionalEmailSchema,
    company: optionalCompanySchema,
  })
  .strict()
  .refine((v) => v.name !== undefined || v.email !== undefined || v.company !== undefined);

export const inviteAcceptSchema = z
  .object({
    password: z.string().min(10, "密码至少 10 位").max(256, "密码最多 256 位"),
  })
  .strict();
export type InviteAcceptInput = z.infer<typeof inviteAcceptSchema>;

export const passwordChangeSchema = z
  .object({
    current: z.string().min(1).max(256),
    password: z.string().min(10).max(256),
  })
  .strict();

export const assetInputSchema = z
  .object({
    name: z.string().trim().min(1, "请输入资产名称").max(80, "资产名称最多 80 个字符"),
    domain: z.string().trim().min(1, "请输入业务域").max(40, "业务域最多 40 个字符"),
    owner: z.string().trim().min(1, "请输入责任团队").max(60, "责任团队最多 60 个字符"),
    stage: z.enum(ASSET_STAGES),
  })
  .strict();
export type AssetInput = z.infer<typeof assetInputSchema>;

export const assetPatchSchema = z
  .object({
    name: z.string().trim().min(1, "请输入资产名称").max(80, "资产名称最多 80 个字符").optional(),
    domain: z.string().trim().min(1, "请输入业务域").max(40, "业务域最多 40 个字符").optional(),
    owner: z.string().trim().min(1, "请输入责任团队").max(60, "责任团队最多 60 个字符").optional(),
    stage: z.enum(ASSET_STAGES).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.domain !== undefined ||
      v.owner !== undefined ||
      v.stage !== undefined,
  );
export type AssetPatchInput = z.infer<typeof assetPatchSchema>;

export const assetBulkStageSchema = z
  .object({
    ids: z
      .array(z.number().int().positive())
      .min(1, "请至少选择一项")
      .max(100, "单次最多操作 100 项"),
    stage: z.enum(ASSET_STAGES),
  })
  .strict();
export type AssetBulkStageInput = z.infer<typeof assetBulkStageSchema>;

export const assetBulkDeleteSchema = z
  .object({
    ids: z
      .array(z.number().int().positive())
      .min(1, "请至少选择一项")
      .max(100, "单次最多操作 100 项"),
  })
  .strict();
export type AssetBulkDeleteInput = z.infer<typeof assetBulkDeleteSchema>;
