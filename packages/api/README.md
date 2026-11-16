# 前后端共享契约（`@optimax-starter/api`）

本包是前后端唯一的输入输出类型与校验规则来源（纯 Zod Schema + TypeScript 接口），不包含数据库驱动或 HTTP 框架运行时依赖。

## 文件职责

- [contracts.ts](./src/contracts.ts)：核心实体类型（`Account`、`Asset`、`AuditEntry`、`PaginatedResult<T>`、`AuthProviderInfo`）、审计动作枚举 `AUDIT_ACTIONS` 与标签 `AUDIT_ACTION_LABELS`，以及登录、账户、个人资料、资产写入的严格 Zod Schema（`strict()` 防提权与多余字段注入）。
- [asset-agent.ts](./src/asset-agent.ts)：资产自然语言筛选的参数白名单与请求校验，详见 [资产模块](../../apps/web/src/features/assets/README.md)。

## 扩展约定

- 新增业务模块时，在 `src/<module>.ts` 定义实体接口、表单 `InputSchema` / `PatchSchema` 与 URL 查询参数解析器 `parse<Module>Search`，并在 `src/index.ts` 导出；若涉及写操作审计，同步在 `AUDIT_ACTIONS` 与 `AUDIT_ACTION_LABELS` 注册动作名。
- 可直接运行根目录 `bun run gen:module <slug> --label <中文名>` 自动生成并注册上述契约文件。
