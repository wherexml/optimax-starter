import { z } from "zod";

export const ROLE_VALUES = ["member", "admin"] as const;
export type AccountRole = (typeof ROLE_VALUES)[number];

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
  "asset.create": "新增资产",
  "asset.update": "编辑资产",
  "asset.delete": "删除资产",
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

// Fields allowed in audit detail. Never store passwords, hashes, cookies or tokens here.
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
};

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  actorId: number | null;
  actorUsername: string;
  actorName: string;
  targetId: number | null;
  targetUsername: string | null;
  targetName: string | null;
  detail: Record<string, unknown>;
}

export type AuditPage = PaginatedResult<AuditEntry>;

export type AssetSearch = {
  q?: string;
  qOp?: "contains" | "equals";
  stage?: AssetStage | AssetStage[];
  domain?: string | string[];
};

export type AccountSearch = {
  q?: string;
  status?: "active" | "disabled";
  role?: AccountRole;
};

export type AuditSearch = {
  action?: string;
  actor?: string;
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
