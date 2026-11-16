# 管理后台服务端（`apps/server`）

常驻进程基于 Node 24 + Hono 运行（原因见 [RUNTIME.md](../../RUNTIME.md)），对外统一挂载同源 `/console/*` JSON 接口与 `/healthz` 就绪探针；生产单容器模式下可通过 `SERVE_WEB_DIST` 同源托管前端构建产物。认证与审计细则见 [AUTH.md](../../AUTH.md)。

## 目录结构

- `src/index.ts` / `src/node.ts`：Hono 顶层应用、CORS、`/healthz`（执行 `SELECT 1` 探活数据库）、可选静态资源托管与优雅退出。
- `src/console.ts`：统一校验非 GET 请求 `Origin` 与 `Content-Type: application/json`，解析 HttpOnly Session Cookie，并装配各业务模块路由。
- `src/core/`（核心底座，业务开发通常无需改动）：
  - `config.ts`：环境变量读取（`SESSION_COOKIE_NAME`、`CORS_ORIGIN`、`STARTER_SEED_DEMO`）及生产环境防呆拦截（禁止开启演示种子或使用默认演示密码）。
  - `guards.ts`：`Refusal` 业务拒绝异常、管理员路由中间件 `requireAdmin`、事务级串行咨询锁 `lockAdmin`（`pg_advisory_xact_lock`）。
  - `audit.ts`：账户级审计 `audit()`（关联 `target_id -> console_account.id`）与非账户业务资源审计 `auditResource()`（保留 `target_id = null`，写入业务编码与 `detail.entityId`，支持删除操作留痕且不触发外键冲突）。
  - `seed.ts`：受 `STARTER_SEED_DEMO` 控制的幂等演示账户与示例资产初始化。
- `src/modules/`（按业务域拆分的子路由）：
  - `auth.ts`：`/login`、`/logout`、`/me`、`/me/password` 及企业 SSO 预留发现接口 `/auth/providers`。
  - `accounts.ts`：管理员账户查询、创建、角色/启停变更、重置密码与会话强制撤销。
  - `audit.ts`：`/audit` 服务端分页与按动作、操作人、UTC+8 自然日区间筛选。
  - `assets.ts`：`/assets` 全量列表、`/assets/page` 服务端分页与多选/`contains`/`equals` 动态筛选参考实现、管理员资产增删改及 `/assets/agent` 自然语言试点挂载。

## 新增模块步骤

1. 在 `packages/db/src/schema/` 定义表并在 `packages/api/src/` 定义共享 Zod 契约；
2. 在 `src/modules/<module>.ts` 编写 Hono 路由，写操作统一放入 `db.transaction` 内调用 `lockAdmin` 与 `auditResource`；
3. 在 `src/console.ts` 挂载 `consoleApi.route("/", <module>Routes)`（或直接执行 `bun run gen:module <slug> --label <中文名>` 一键生成）。
