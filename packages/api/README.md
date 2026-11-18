# 前后端共享契约（`@optimax-starter/api`）

本包是前后端唯一的输入输出类型、RBAC 权限矩阵定义与校验规则来源（纯 Zod Schema + TypeScript 接口），不包含数据库驱动或 HTTP 框架运行时依赖。

## 文件职责

- [contracts.ts](./src/contracts.ts)：核心实体类型（`Account`、`Asset`、`AuditEntry`、`PaginatedResult<T>`、`AuthProviderInfo`）、审计动作枚举 `AUDIT_ACTIONS` 与标签 `AUDIT_ACTION_LABELS`，以及登录、账户、个人资料、资产写入的严格 Zod Schema。
- [permissions.ts](./src/permissions.ts)：三层系统角色（`member`、`admin`、`super_admin`）、权限目录 `PERMISSION_CATALOG`、超管独占权限集、`SYSTEM_PERMISSION_ROWS` 模块级「查看 / 操作」映射联动逻辑与权限矩阵更新 Schema。
- [system.ts](./src/system.ts)：审计来源枚举 `ACTOR_SOURCES`（`human` | `agent`）、系统控制页标签 `SYSTEM_TABS`、系统状态探针响应 `SystemStatusResponse`、全局时区预设 `SYSTEM_TIMEZONE_OPTIONS` 与熔断/基础配置写入 Schema。
- [asset-agent.ts](./src/asset-agent.ts)：资产自然语言筛选的参数白名单与请求校验，详见 [资产模块](../../apps/web/src/features/assets/README.md)。
- [generate.ts](./src/generate.ts)：契约产物生成器。`bun run contracts:generate`（根脚本）把登记的全部公开 schema 经 Zod 4 原生 `z.toJSONSchema()` 输出到 [json-schema/](./json-schema/)，作为 PHP/Laravel 侧唯一消费物（LARAVEL.md 路线 A）。产物显式生成并提交，CI 门禁拦截过期产物（LA-04）；输出确定性（无时间戳），幂等可复跑。

## JSON Schema 产物约定

- 文件名 `<module>.<SchemaName>.json`（module = 源文件名：contracts / permissions / system / asset-agent），`index.json` 记录名单、来源与 Zod 版本。
- `.strict()` 映射为 `additionalProperties: false`（防提权白名单跨语言保留）；`.trim()` 等不可表示检查按 `unrepresentable: "any"` 降级，`.refine()` 语义被丢弃——两者都必须在 refine 清单补登记（LA-03）。
- 新增公开 schema：在 `generate.ts` 的 registry 登记 → `bun run contracts:generate` → 产物随代码一起提交。

## 扩展约定

- 新增业务模块时，在 `src/<module>.ts` 定义实体接口、表单 `InputSchema` / `PatchSchema` 与 URL 查询参数解析器 `parse<Module>Search`，并在 `src/index.ts` 导出；涉及权限与审计时同步注册到 `permissions.ts` 与 `contracts.ts`。
- 可直接运行根目录 `bun run gen:module <slug> --label <中文名>` 自动生成并注册上述契约与权限项。
