import { z } from "zod";
import { ROLE_LABELS, ROLE_VALUES, type AccountRole } from "./permissions";
import { ACTOR_SOURCES } from "./system";

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
  "profile.update",
  "profile.password_change",
  "permission.update",
  "permission.reset",
  "system.timezone_update",
  "system.ai_circuit",
  "agent.asset_filter",
  "asset.create",
  "asset.update",
  "asset.delete",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "account.create": "新增账户",
  "account.update": "修改姓名",
  "account.role": "调整角色",
  "account.status": "变更状态",
  "account.password_reset": "重置密码",
  "account.revoke": "强制下线",
  "profile.update": "修改本人资料",
  "profile.password_change": "修改本人密码",
  "permission.update": "修改系统权限",
  "permission.reset": "恢复默认权限",
  "system.timezone_update": "修改系统时区",
  "system.ai_circuit": "切换 AI 熔断开关",
  "agent.asset_filter": "Agent 筛选资产",
  "asset.create": "新增资产",
  "asset.update": "编辑资产",
  "asset.delete": "删除资产",
};

// Response entities are declared as Zod schemas so their shapes are generatable
// (z.toJSONSchema, LA-02). Exported type names and members are unchanged.

export const accountSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  name: z.string(),
  role: z.string(),
  active: z.boolean(),
  sessions: z.number().int().optional(),
  email: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  permissions: z.array(z.string()).optional(),
});
export type Account = z.infer<typeof accountSchema>;

export const assetSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  domain: z.string(),
  owner: z.string(),
  stage: z.string(),
});
export type Asset = z.infer<typeof assetSchema>;

// Generic factory producing the pagination envelope for any item schema.
export const paginatedResultSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    size: z.number().int(),
  });

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export const assetPageSchema = paginatedResultSchema(assetSchema);
export type AssetPage = PaginatedResult<Asset>;
// Fails to compile if the factory output drifts from the hand-written generic type.
type PaginatedShapeDrift = [z.infer<typeof assetPageSchema>] extends [AssetPage]
  ? [AssetPage] extends [z.infer<typeof assetPageSchema>]
    ? true
    : never
  : never;
export const paginatedShapeLock: PaginatedShapeDrift = true;

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
};

export const auditEntrySchema = z.object({
  id: z.number().int(),
  at: z.string(),
  action: z.string(),
  actorSource: z.enum(ACTOR_SOURCES),
  actorId: z.number().int().nullable(),
  actorUsername: z.string(),
  actorName: z.string(),
  targetId: z.number().int().nullable(),
  targetUsername: z.string().nullable(),
  targetName: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = paginatedResultSchema(auditEntrySchema).extend({
  timezone: z.string().optional(),
});
export type AuditPage = PaginatedResult<AuditEntry> & {
  timezone?: string;
};

export const assetSearchSchema = z.object({
  q: z.string().optional(),
  qOp: z.enum(["contains", "equals"]).optional(),
  stage: z.union([z.enum(ASSET_STAGES), z.array(z.enum(ASSET_STAGES))]).optional(),
  domain: z.union([z.string(), z.array(z.string())]).optional(),
});
export type AssetSearch = z.infer<typeof assetSearchSchema>;

export const accountSearchSchema = z.object({
  q: z.string().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  role: z.enum(ROLE_VALUES).optional(),
});
export type AccountSearch = z.infer<typeof accountSearchSchema>;

export const auditSearchSchema = z.object({
  action: z.string().optional(),
  actor: z.string().optional(),
  source: z.enum(ACTOR_SOURCES).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  page: z.number().optional(),
  size: z.number().optional(),
});
export type AuditSearch = z.infer<typeof auditSearchSchema>;

export const authProviderInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  loginPath: z.string(),
});
export type AuthProviderInfo = z.infer<typeof authProviderInfoSchema>;

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

export const accountCreateSchema = credentialsSchema.extend({
  name: z.string().trim().min(1, "请输入姓名").max(80, "姓名最多 80 个字符"),
  password: z.string().min(10, "密码至少 10 位").max(256, "密码最多 256 位"),
  role: z.enum(ROLE_VALUES),
  email: optionalEmailSchema,
  company: optionalCompanySchema,
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
