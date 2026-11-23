import { z } from "zod";

export const ROLE_VALUES = ["member", "admin", "super_admin"] as const;
export type AccountRole = (typeof ROLE_VALUES)[number];

export const ROLE_LABELS: Record<AccountRole, string> = {
  member: "成员",
  admin: "管理员",
  super_admin: "超级管理员",
};

export const PERMISSION_ROLES: readonly AccountRole[] = ["member", "admin", "super_admin"] as const;

export type ModulePermissionAction = "view" | "operate";

export const PERMISSION_ACTION_LABELS: Record<ModulePermissionAction, string> = {
  view: "查看",
  operate: "操作",
};

export interface PermissionCatalogEntry {
  code: string;
  label: string;
  module: string;
  kind: "view" | "operate" | "system";
  immutable?: boolean;
}

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  { code: "workbench:read", label: "查看工作台", module: "工作台", kind: "view" },
  // @starter:example-assets-start
  { code: "assets:read", label: "查看资产台账", module: "资产台账", kind: "view" },
  { code: "assets:manage", label: "维护资产台账", module: "资产台账", kind: "operate" },
  // @starter:example-assets-end
  // @starter:agent-start
  { code: "agent:use", label: "使用智能助理", module: "智能助理", kind: "view" },
  // @starter:agent-end
  // @starter:permission-catalog
  { code: "accounts:read", label: "查看账户管理", module: "账户管理", kind: "view" },
  { code: "accounts:manage", label: "维护成员账户", module: "账户管理", kind: "operate" },
  { code: "system:settings:read", label: "查看系统配置", module: "系统配置", kind: "view" },
  { code: "system:settings:manage", label: "维护系统配置", module: "系统配置", kind: "operate" },
  { code: "system:ai:read", label: "查看 AI 运行状态", module: "AI 运行控制", kind: "view" },
  {
    code: "system:ai:manage",
    label: "操作 AI 熔断开关",
    module: "AI 运行控制",
    kind: "operate",
    immutable: true,
  },
  { code: "jobs:read", label: "查看后台任务", module: "后台任务", kind: "view" },
  { code: "jobs:manage", label: "管理后台任务", module: "后台任务", kind: "operate" },
  { code: "audit:read", label: "查看操作日志", module: "操作日志", kind: "view" },
  {
    code: "system:permission:read",
    label: "查看系统权限",
    module: "系统权限",
    kind: "view",
    immutable: true,
  },
  {
    code: "system:permission:manage",
    label: "维护系统权限",
    module: "系统权限",
    kind: "operate",
    immutable: true,
  },
  {
    code: "system:manage",
    label: "系统最高权限",
    module: "系统权限",
    kind: "system",
    immutable: true,
  },
];

export const CATALOG_CODES: readonly string[] = PERMISSION_CATALOG.map((item) => item.code);
const CATALOG_CODE_SET = new Set<string>(CATALOG_CODES);
const CATALOG_ORDER = new Map<string, number>(CATALOG_CODES.map((code, index) => [code, index]));

export const IMMUTABLE_SUPER_ADMIN_PERMISSIONS = new Set<string>([
  "system:manage",
  "system:permission:read",
  "system:permission:manage",
]);

export const SUPER_ADMIN_ONLY_PERMISSIONS = new Set<string>([
  ...IMMUTABLE_SUPER_ADMIN_PERMISSIONS,
  "system:ai:manage",
]);

export const DEFAULT_ROLE_PERMISSION_CODES: Record<AccountRole, readonly string[]> = {
  super_admin: CATALOG_CODES,
  admin: [
    "workbench:read",
    // @starter:example-assets-start
    "assets:read",
    "assets:manage",
    // @starter:example-assets-end
    // @starter:agent-start
    "agent:use",
    // @starter:agent-end
    // @starter:admin-permissions
    "accounts:read",
    "accounts:manage",
    "system:settings:read",
    "system:ai:read",
    "jobs:read",
    "jobs:manage",
    "audit:read",
  ],
  member: [
    "workbench:read",
    // @starter:example-assets-start
    "assets:read",
    // @starter:example-assets-end
    // @starter:agent-start
    "agent:use",
    // @starter:agent-end
    // @starter:member-permissions
  ],
};

export function sortPermissionCodes(codes: Iterable<string>): string[] {
  return [...new Set(codes)].sort(
    (left, right) =>
      (CATALOG_ORDER.get(left) ?? CATALOG_CODES.length) -
        (CATALOG_ORDER.get(right) ?? CATALOG_CODES.length) || left.localeCompare(right),
  );
}

export function defaultPermissionCodes(role: string): string[] {
  if (role === "super_admin" || role === "admin" || role === "member") {
    return sortPermissionCodes(DEFAULT_ROLE_PERMISSION_CODES[role]);
  }
  return [];
}

export function validateRolePermissionsInput(role: string, raw: unknown): string[] {
  if (role !== "member" && role !== "admin" && role !== "super_admin") {
    throw new Error(`未知系统角色：${role}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${role} 权限配置必须是数组`);
  }
  const normalized = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") throw new Error("权限码格式无效");
    const trimmed = item.trim();
    if (trimmed) normalized.add(trimmed);
  }
  const unknown = [...normalized].filter((code) => !CATALOG_CODE_SET.has(code));
  if (unknown.length > 0) {
    throw new Error(`未知权限码：${unknown.sort().join(", ")}`);
  }
  if (role !== "super_admin") {
    for (const code of normalized) {
      if (SUPER_ADMIN_ONLY_PERMISSIONS.has(code)) {
        throw new Error("超级管理员专属权限不能分配给其他角色");
      }
    }
  }
  if (role === "super_admin") {
    return defaultPermissionCodes("super_admin");
  }
  return sortPermissionCodes(normalized);
}

// Resilient reader for persisted DB rows: strips stale codes if catalog evolves and locks super_admin.
export function normalizePersistedRolePermissions(
  role: string,
  persisted: readonly string[] | null | undefined,
): string[] {
  if (role === "super_admin") {
    return defaultPermissionCodes("super_admin");
  }
  if (role !== "admin" && role !== "member") {
    return [];
  }
  if (!Array.isArray(persisted)) {
    return defaultPermissionCodes(role);
  }
  const valid = persisted.filter(
    (code) =>
      typeof code === "string" &&
      CATALOG_CODE_SET.has(code) &&
      !SUPER_ADMIN_ONLY_PERMISSIONS.has(code),
  );
  return sortPermissionCodes(valid);
}

type CodesByRole = Partial<Record<AccountRole, readonly string[]>> & {
  default?: readonly string[];
};

export interface SystemPermissionRow {
  id: string;
  label: string;
  description: string;
  actions: readonly ModulePermissionAction[];
  viewCodes: CodesByRole;
  operateCodes: CodesByRole;
  disabledActions?: Partial<Record<AccountRole, readonly ModulePermissionAction[]>>;
  disabledReason?: string;
}

const ALL_ACTIONS: readonly ModulePermissionAction[] = ["view", "operate"];

export const SYSTEM_PERMISSION_ROWS: readonly SystemPermissionRow[] = [
  {
    id: "workbench",
    label: "工作台",
    description: "全局指标汇总、待复核队列与快捷入口",
    actions: ALL_ACTIONS,
    viewCodes: { default: ["workbench:read"] },
    operateCodes: {},
    disabledReason: "工作台为汇总只读视图，无独立写入项",
  },
  // @starter:example-assets-start
  {
    id: "assets",
    label: "资产台账",
    description: "资产列表查询、自然语言筛选与台账增删改",
    actions: ALL_ACTIONS,
    viewCodes: { default: ["assets:read"] },
    operateCodes: { default: ["assets:manage"] },
  },
  // @starter:example-assets-end
  // @starter:agent-start
  {
    id: "ai-agent",
    label: "智能助理",
    description: "唤起右侧流式智能助理与只读分析（写操作需通过确认卡并二次校验对应模块权限）",
    actions: ALL_ACTIONS,
    viewCodes: { default: ["agent:use"] },
    operateCodes: {},
    disabledReason: "助理写操作受各业务模块维护权限独立约束",
  },
  // @starter:agent-end
  // @starter:permission-rows
  {
    id: "accounts",
    label: "账户管理",
    description: "账户列表查看与成员账户维护（管理员提权仅限超级管理员）",
    actions: ALL_ACTIONS,
    viewCodes: { admin: ["accounts:read"], super_admin: ["accounts:read"] },
    operateCodes: { admin: ["accounts:manage"], super_admin: ["accounts:manage"] },
    disabledReason: "账户与会话管理不向普通成员开放",
  },
  {
    id: "system-settings",
    label: "系统配置",
    description: "系统全局基础参数与时区查看及维护",
    actions: ALL_ACTIONS,
    viewCodes: { admin: ["system:settings:read"], super_admin: ["system:settings:read"] },
    operateCodes: {
      admin: ["system:settings:manage"],
      super_admin: ["system:settings:manage"],
    },
    disabledReason: "系统基础配置不向普通成员开放",
  },
  {
    id: "ai-control",
    label: "AI 运行控制",
    description: "数据库与模型队列探针查看，以及 AI 全局一键熔断开关",
    actions: ALL_ACTIONS,
    viewCodes: { admin: ["system:ai:read"], super_admin: ["system:ai:read"] },
    operateCodes: { super_admin: ["system:ai:manage"] },
    disabledReason: "AI 全局熔断开关仅允许超级管理员操作",
  },
  {
    id: "jobs",
    label: "后台任务",
    description: "异步导出、批量导入与过期数据清理等后台任务查看、重试与取消",
    actions: ALL_ACTIONS,
    viewCodes: { admin: ["jobs:read"], super_admin: ["jobs:read"] },
    operateCodes: { admin: ["jobs:manage"], super_admin: ["jobs:manage"] },
    disabledReason: "全局后台任务队列不向普通成员开放（成员仍可查看本人创建的导出任务）",
  },
  {
    id: "audit",
    label: "操作日志",
    description: "人工与 Agent 操作记录分页检索",
    actions: ALL_ACTIONS,
    viewCodes: { admin: ["audit:read"], super_admin: ["audit:read"] },
    operateCodes: {},
    disabledReason: "操作日志为只读追加账本，不支持人工增删改",
  },
  {
    id: "system-permission",
    label: "系统权限",
    description: "角色权限矩阵查看、保存与恢复默认，仅超级管理员保留",
    actions: ALL_ACTIONS,
    viewCodes: { super_admin: ["system:permission:read"] },
    operateCodes: { super_admin: ["system:permission:manage", "system:manage"] },
    disabledActions: {
      member: ALL_ACTIONS,
      admin: ALL_ACTIONS,
      super_admin: ALL_ACTIONS,
    },
    disabledReason: "系统权限中心只允许超级管理员保留，不能关闭或分配给其他角色",
  },
];

export function getModuleActionCodes(
  row: SystemPermissionRow,
  role: AccountRole,
  action: ModulePermissionAction,
): readonly string[] {
  const map = action === "view" ? row.viewCodes : row.operateCodes;
  return map[role] ?? map.default ?? [];
}

export function getModuleActionDisabled(
  row: SystemPermissionRow,
  role: AccountRole,
  action: ModulePermissionAction,
): boolean {
  if (role === "super_admin") return true;
  if (row.disabledActions?.[role]?.includes(action)) return true;
  return getModuleActionCodes(row, role, action).length === 0;
}

export function getModuleActionChecked(
  row: SystemPermissionRow,
  role: AccountRole,
  currentCodes: readonly string[],
  action: ModulePermissionAction,
): boolean {
  const codes = getModuleActionCodes(row, role, action);
  if (codes.length === 0) return false;
  return codes.every((code) => currentCodes.includes(code));
}

export function toggleModulePermissionAction(
  row: SystemPermissionRow,
  role: AccountRole,
  currentCodes: readonly string[],
  action: ModulePermissionAction,
  enabled: boolean,
): string[] {
  if (getModuleActionDisabled(row, role, action)) {
    return sortPermissionCodes(currentCodes);
  }
  const next = new Set(currentCodes);
  const viewCodes = getModuleActionCodes(row, role, "view");
  const operateCodes = getModuleActionCodes(row, role, "operate");
  if (enabled) {
    for (const code of viewCodes) next.add(code);
    if (action === "operate") {
      for (const code of operateCodes) next.add(code);
    }
  } else if (action === "view") {
    for (const code of viewCodes) next.delete(code);
    for (const code of operateCodes) next.delete(code);
  } else {
    for (const code of operateCodes) next.delete(code);
  }
  return sortPermissionCodes(next);
}

export interface SystemPermissionMatrixPayload {
  catalog: readonly PermissionCatalogEntry[];
  roles: Record<AccountRole, string[]>;
  defaults: Record<AccountRole, string[]>;
  immutable: { super_admin: string[] };
  updatedAt: string | null;
}

export const systemPermissionsUpdateSchema = z
  .object({
    roles: z
      .object({
        member: z.array(z.string().max(80)).max(100).optional(),
        admin: z.array(z.string().max(80)).max(100).optional(),
        super_admin: z.array(z.string().max(80)).max(100).optional(),
      })
      .strict()
      .refine(
        (r) => r.member !== undefined || r.admin !== undefined || r.super_admin !== undefined,
        "请提交角色权限配置",
      ),
  })
  .strict();

export type SystemPermissionsUpdateInput = z.infer<typeof systemPermissionsUpdateSchema>;
