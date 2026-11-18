// refine 语义登记表（LARAVEL.md LA-03）。
// z.toJSONSchema() 会丢弃 `.refine()` 的跨字段/格式语义；每新增一处 `.refine(`
// 必须在本表登记，contracts:generate 对源码调用数与本表条目数做硬性对拍，
// 不一致即失败——语义不允许静默丢失。PHP/Laravel 侧按 phpRule 实现等价校验
//（LB-03），错误文案以 message 为准保持两端一致。

export interface ContractRefine {
  /** 稳定标识，供 PHP 侧引用。 */
  id: string;
  /** 受影响的登记 schema（generate.ts registry 中的名字）。 */
  schemas: string[];
  /** 语义作用的字段路径；空串表示对象顶层约束。 */
  path: string;
  /** 源码位置。 */
  source: string;
  /** 中文语义描述。 */
  semantic: string;
  /** Zod 报错文案；未自定义时标注默认行为。 */
  message: string;
  /** Laravel 侧等价实现建议。 */
  phpRule: string;
}

export const CONTRACT_REFINES: readonly ContractRefine[] = [
  {
    id: "email-format",
    schemas: ["contracts.accountCreateSchema", "contracts.accountPatchSchema", "contracts.profileInputSchema"],
    path: "email",
    source: "packages/api/src/contracts.ts:152（optionalEmailSchema）",
    semantic: "邮箱可为空串或省略；非空时必须匹配 EMAIL_RE",
    message: "邮箱格式不正确",
    phpRule: "nullable + regex:^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$；空串先归一为 null 再校验",
  },
  {
    id: "account-patch-nonempty",
    schemas: ["contracts.accountPatchSchema"],
    path: "",
    source: "packages/api/src/contracts.ts:184",
    semantic: "账户变更至少提供 active / role / name / email / company 之一",
    message: "（未自定义文案，parse 失败时接口返回「无效的账户变更」）",
    phpRule: "required_without_all:active,role,name,email,company",
  },
  {
    id: "profile-update-nonempty",
    schemas: ["contracts.profileInputSchema"],
    path: "",
    source: "packages/api/src/contracts.ts:208",
    semantic: "个人资料更新至少提供 name / email / company 之一，其余字段全部拒绝（防提权）",
    message: "（未自定义文案，parse 失败时接口返回 400）",
    phpRule: "required_without_all:name,email,company",
  },
  {
    id: "asset-patch-nonempty",
    schemas: ["contracts.assetPatchSchema"],
    path: "",
    source: "packages/api/src/contracts.ts:235",
    semantic: "资产变更至少提供 name / domain / owner / stage 之一",
    message: "（未自定义文案，parse 失败时接口返回「无效的资产变更」）",
    phpRule: "required_without_all:name,domain,owner,stage",
  },
  {
    id: "permission-roles-nonempty",
    schemas: ["permissions.systemPermissionsUpdateSchema"],
    path: "roles",
    source: "packages/api/src/permissions.ts:341",
    semantic: "权限矩阵更新至少提交一个角色的权限数组",
    message: "请提交角色权限配置",
    phpRule: "required_without_all:roles.member,roles.admin,roles.super_admin",
  },
  {
    id: "agent-qop-requires-q",
    schemas: ["asset-agent.assetAgentFilters", "asset-agent.assetAgentRequest"],
    path: "qOp",
    source: "packages/api/src/asset-agent.ts:8",
    semantic: "指定匹配方式（qOp）时必须同时提供资产名称关键词 q",
    message: "匹配方式需要资产名称",
    phpRule: "q 在 qOp 存在时 required（required_with:qOp）",
  },
];
