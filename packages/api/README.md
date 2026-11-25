# 前后端共享契约（`@optimax-starter/api`）

本包是前后端唯一的输入输出类型、RBAC 权限矩阵定义与校验规则来源（纯 Zod Schema + TypeScript 接口），不包含数据库驱动或 HTTP 框架运行时依赖。

## 文件职责

- [contracts.ts](./src/contracts.ts)：核心实体类型（`Account`、`Asset`、`AuditEntry`、`PaginatedResult<T>`、`AuthProviderInfo` 含可选 `icon` 与 `passwordLoginDisabled`、`AssetLedgerSummary`、`AssetDetailResponse`、`AssetTopologyResponse` 资产汇总与超大图拓扑契约）、审计动作枚举 `AUDIT_ACTIONS` 与标签 `AUDIT_ACTION_LABELS`（含 `system.session_ttl_update` 与 `system.ai_model` 及数字型变更明细），以及登录、账户、个人资料、资产写入的严格 Zod Schema。
- [permissions.ts](./src/permissions.ts)：三层系统角色（`member`、`admin`、`super_admin`）、权限目录 `PERMISSION_CATALOG`、超管独占权限集、`SYSTEM_PERMISSION_ROWS` 模块级「查看 / 操作」映射（含只读模块 `readonlyReason` 与 `hasModuleOperateAction` 判定）及权限矩阵更新 Schema。
- [system.ts](./src/system.ts)：审计来源枚举 `ACTOR_SOURCES`（`human` | `agent` | `system`）、系统控制页标签 `SYSTEM_TABS`、系统状态探针响应 `SystemStatusResponse`、全量 IANA 可搜索时区清单 `getSystemTimezoneOptions`（含常用预设、UTC 偏移与中英文城市检索词）、登录保持时长契约（`1–2160` 小时，默认 `168` 小时即 7 天，`formatSessionTtlLabel`）与系统设置写入 Schema `systemSettingsInputSchema`。
- [agent.ts](./src/agent.ts)：可选智能助理状态响应 `agentStatusResponseSchema` 与网页端 AI 模型配置/探测/清空契约（`agentModelSettingsSchema`、`agentModelInputSchema`、`agentModelClearSchema`），支持 `--no-agent` 一键裁剪。
- [asset-agent.ts](./src/asset-agent.ts)：资产自然语言筛选的参数白名单与请求校验，详见 [资产模块](../../apps/web/src/features/assets/README.md)。

## 扩展约定

- 新增业务模块时，在 `src/<module>.ts` 定义实体接口、表单 `InputSchema` / `PatchSchema` 与 URL 查询参数解析器 `parse<Module>Search`，并在 `src/index.ts` 导出；涉及权限与审计时同步注册到 `permissions.ts` 与 `contracts.ts`。
- 可直接运行根目录 `bun run gen:module <slug> --label <中文名>` 自动生成并注册上述契约与权限项。
