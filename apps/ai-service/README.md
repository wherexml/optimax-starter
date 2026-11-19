# 管理后台服务端（`apps/server`）

常驻进程基于 Node 24 + Hono 运行（原因见 [RUNTIME.md](../../RUNTIME.md)），对外统一挂载同源 `/console/*` JSON 接口与 `/healthz` 就绪探针；生产单容器模式下可通过 `SERVE_WEB_DIST` 同源托管前端构建产物。认证、三层 RBAC 与审计细则见 [AUTH.md](../../AUTH.md)。

## 目录结构

- `src/index.ts` / `src/node.ts`：Hono 顶层应用、CORS（含 `PUT` / `PATCH`）、公开浅探针 `/healthz`（执行 `SELECT 1` 仅返回 `{ status, db }`）、可选静态资源托管与优雅退出。
- `src/console.ts`：统一校验非 GET 请求 `Origin` 与 `Content-Type: application/json`，解析 HttpOnly Session Cookie，加载账户实时有效权限码（`actor.permissions`），并装配各业务模块路由。
- `src/core/`（核心底座）：
  - [ai/](./src/core/ai/README.md)：可选的服务端模型客户端，token 字段兼容、安全错误分类、有界 FIFO 队列实时水位快照（`aiQueueSnapshot`）及运行时全局熔断拦截（`ai_circuit_open` -> `503`）。
  - `config.ts`：环境变量读取与生产环境防呆拦截。
  - `guards.ts`：`Refusal` 业务拒绝异常、`requirePermission` / `requireAnyPermission` / `requireSuperAdmin` 路由守卫，以及事务级串行咨询锁 `lockPermission` / `lockSuperAdmin`（`pg_advisory_xact_lock`）。
  - `permissions.ts`：`console_role_permission` 角色权限矩阵读取缓存、输入校验、`super_admin` 全量权限强制保底及同事务修改/重置审计。
  - `system-settings.ts`：`console_setting` 全局系统时区（环境变量与默认值回退）与 `ai.enabled` 全局熔断开关持久化。
  - `audit.ts`：支持 `actorSource`（`human` | `agent`）、敏感键递归 `[REDACTED]` 脱敏与动态时区自然日计算的 `audit()` / `auditResource()`。
  - `seed.ts`：受 `STARTER_SEED_DEMO` 控制的幂等引导超级管理员校准与示例资产初始化。
- `src/modules/`（按业务域拆分的子路由）：
  - `auth.ts`：`/login`、`/logout`、`/me`（附带当前有效 `permissions`）、`/me/password` 及 `/auth/providers`。
  - `accounts.ts`：账户管理及三层角色提权防线（普通 `admin` 仅可维护 `member`，核心超管与最后一名启用超管受保护）。
  - `system.ts`：`/system/permissions`（权限矩阵读取/保存/重置）、`/system/status`（数据库延迟探针、活跃会话数、AI 队列水位与熔断状态）、`/system/ai-circuit`（超管一键熔断开关）与 `/system/settings`（系统时区读写）。
  - `audit.ts`：`/audit` 服务端分页与按来源（`human` / `agent`）、动作、操作人及当前系统时区自然日区间筛选。
  - `assets.ts`：`/assets`、`/assets/page`、资产增删改及 `/assets/agent`（受 `assets:read` 权限与全局熔断双重约束，回执写入 `agent.asset_filter` 审计）。

## 新增模块步骤

1. 在 `packages/db/src/schema/` 定义表并在 `packages/api/src/` 定义共享 Zod 契约与权限项；
2. 在 `src/modules/<module>.ts` 编写 Hono 路由，读接口使用 `requirePermission("<slug>:read")`，写操作放入 `db.transaction` 内调用 `lockPermission(tx, actor.id, "<slug>:manage")` 与 `auditResource`；
3. 在 `src/console.ts` 挂载路由（或直接执行 `bun run gen:module <slug> --label <中文名>` 自动注册表、契约、权限矩阵与侧栏入口）。
