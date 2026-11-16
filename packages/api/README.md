# 前后端共享契约（`@optimax-starter/api`）

本包是前后端唯一的输入输出类型、RBAC 权限矩阵定义与校验规则来源（纯 Zod Schema + TypeScript 接口），不包含数据库驱动或 HTTP 框架运行时依赖。

## 文件职责

- [contracts.ts](./src/contracts.ts)：核心实体类型（`Account`、`Asset`、`AuditEntry`、`PaginatedResult<T>`、`AuthProviderInfo`）、审计动作枚举 `AUDIT_ACTIONS` 与标签 `AUDIT_ACTION_LABELS`，以及登录、账户、个人资料、资产写入的严格 Zod Schema。
- [permissions.ts](./src/permissions.ts)：三层系统角色（`member`、`admin`、`super_admin`）、权限目录 `PERMISSION_CATALOG`、超管独占权限集、`SYSTEM_PERMISSION_ROWS` 模块级「查看 / 操作」映射联动逻辑与权限矩阵更新 Schema。
- [system.ts](./src/system.ts)：审计来源枚举 `ACTOR_SOURCES`（`human` | `agent`）、系统控制页标签 `SYSTEM_TABS`、系统状态探针响应 `SystemStatusResponse`、全局时区预设 `SYSTEM_TIMEZONE_OPTIONS` 与熔断/基础配置写入 Schema。
- [asset-agent.ts](./src/asset-agent.ts)：资产自然语言筛选的参数白名单与请求校验，详见 [资产模块](../../apps/web/src/features/assets/README.md)。

## 扩展约定

- 新增业务模块时，在 `src/<module>.ts` 定义实体接口、表单 `InputSchema` / `PatchSchema` 与 URL 查询参数解析器 `parse<Module>Search`，并在 `src/index.ts` 导出；涉及权限与审计时同步注册到 `permissions.ts` 与 `contracts.ts`。
- 可直接运行根目录 `bun run gen:module <slug> --label <中文名>` 自动生成并注册上述契约与权限项。
