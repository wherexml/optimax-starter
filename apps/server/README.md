# 管理后台服务端（`apps/server`）

常驻进程基于 Node 24 + Hono 运行（原因见 [RUNTIME.md](../../RUNTIME.md)），对外统一挂载同源 `/console/*` JSON 接口与 `/healthz` 就绪探针；生产单容器模式下可通过 `SERVE_WEB_DIST` 同源托管前端构建产物。认证、三层 RBAC 与审计细则见 [AUTH.md](../../AUTH.md)。

## 目录结构

- `src/index.ts` / `src/node.ts`：Hono 顶层应用、`X-Request-Id`（校验或生成）、安全响应头、单行 JSON 访问日志（不含请求头/Cookie/令牌/请求体）、统一 `onError`（`500` `SYS_INTERNAL_ERROR`）与 `/console/*` `notFound`（`DATA_NOT_FOUND`）、遗留 `{ error }` 补齐 `code`/`requestId` 兜底、CORS（含 `PUT` / `PATCH`）、公开浅探针 `/healthz`（执行 `SELECT 1` 仅返回 `{ status, db }`）、可选静态资源托管与优雅退出。
- `src/console.ts` / `src/rpc.ts`：`REQUEST_POLICIES` 路由匹配器（默认非 GET 仅 `application/json` 且 ≤ 64 KiB；`POST /assets/import/{preview,commit}` JSON 或 multipart ≤ 2 MiB；`POST /attachments` 仅 multipart，上限 `STARTER_UPLOAD_MAX_BYTES` + 1 MiB 帧开销；`POST /jobs` JSON ≤ 2 MiB）、Cookie 请求 `Origin` 强校验（Bearer 豁免，但仍受 Content-Type 与体积策略约束）、公开路由白名单（登录、`/auth/providers`、激活链接、OIDC `start` / `callback`）；带 `Authorization: Bearer` 的请求只按 API 密钥鉴权（摘要匹配、未撤销、未过期、账户启用），失败即 `401 AUTH_INVALID_TOKEN`，绝不回退 Cookie，交互专属路由（`/me/password`、`/me/sessions*`、`/me/tokens*`）返回 `403 PERM_INTERACTIVE_REQUIRED`；否则解析 HttpOnly Session Cookie 并以 60 秒节流非阻塞刷新 `last_seen_at` / `ip_address`，加载账户实时有效权限码（`actor.permissions`），装配各业务模块链式路由并经 `src/rpc.ts` 导出纯类型 `ConsoleApiType` 供前端 `Hono hc` 复用。
- `src/core/`（核心底座）：
  - [ai/](./src/core/ai/README.md)：可选的服务端模型客户端，token 字段兼容、安全错误分类、有界 FIFO 队列实时水位快照（`aiQueueSnapshot`）及运行时全局熔断拦截（`ai_circuit_open` -> `503`）。
  - `config.ts`：环境变量读取与生产环境防呆拦截。
  - `http.ts`：纯函数（无 DB 依赖，可单测）——`Refusal`（可带 `code` / 响应头）、`errorJson`（`{ error, code, requestId }`）、状态码默认错误码映射、`resolveRequestId`、`getClientIp`（仅 `TRUST_PROXY=true` 信任代理头）。
  - `guards.ts`：再导出 `http.ts`，提供 `requirePermission` / `requireAnyPermission` / `requireSuperAdmin` 路由守卫与事务级咨询锁：`lockPermission(tx, actorId, permission, { exclusive? })` 默认取共享锁 `PERMISSION_SHARED_LOCK`（业务写入并行），`exclusive: true` 与 `lockSuperAdmin` / `lockAdmin` 取独占 `ADMIN_LOCK`（账户、权限、系统设置等安全状态写入串行，并等待在途业务写入结束）。
  - `login-guard.ts`：PostgreSQL `console_login_guard` 登录限流与锁定（账户 5 次/30 分钟、IP 20 次/15 分钟，锁 30 分钟，原子 upsert 计数）。
  - `oidc.ts`：标准 OIDC（发现、JWKS、PKCE S256、`state` / `nonce`、`id_token` 验签与声明校验、固定 `sso_error` 枚举），零第三方 OAuth 依赖。
  - `feishu.ts`：可选飞书企业自建应用 OAuth 2.0 + PKCE S256 登录（默认关闭，`AUTH_FEISHU_*`），强校验企业 `tenant_key`，支持密钥文件优先与本地 HTTP 模拟调试地址覆写，零第三方依赖。
  - `permissions.ts`：`console_role_permission` 角色权限矩阵读取缓存、输入校验、`super_admin` 全量权限强制保底及同事务修改/重置审计。
  - `system-settings.ts`：`console_setting` 全局系统时区（环境变量与默认值回退）与 `ai.enabled` 全局熔断开关持久化。
  - `bearer.ts`：纯函数（无 DB，`tokens.test.ts` 覆盖）——`parseAuthorization`（任何 Bearer 方案头都视为权威，缺失/畸形凭证不回退 Cookie）、`API_TOKEN_RE`（`optx_` + 32 位 base64url）、`resolveTokenPermissions`（实时角色权限 ∩ scopes）、`originAllowed`（GET/HEAD/OPTIONS 与 Bearer 豁免，其余要求 `Origin === CORS_ORIGIN`）、`requireCookieSession`。
  - `storage.ts`：`StorageDriver`（`LocalStorageDriver` 经 `resolveInside` 拒绝 `..`、绝对路径、反斜杠与空段，原子临时文件 + rename；`S3StorageDriver` 走路径风格 URL + 纯函数 `signSigV4`）、服务端随机存储键 `newStorageKey`（与用户文件名无关）、`validateUploadFile`（白名单 `.pdf/.png/.jpg/.jpeg/.webp/.csv/.xlsx/.docx/.txt/.md/.json`，显式拒绝 `.html/.htm/.svg/.js/.exe/.sh` 等及危险内层扩展名，拒绝 HTML/SVG/JS/XML 声明 MIME，`%PDF-`/PNG/JPEG/WEBP/ZIP 魔数比对，文本文件拒绝 NUL 与 `<script`/`<svg`/`<!doctype html`/`<html`）；`storage.test.ts` 覆盖。
  - `job-policy.ts`：纯函数（无 DB，`jobs.test.ts` 覆盖）——`calculateBackoffMs`（30s 起指数翻倍，上限 30 分钟）、`canCreateJobType`、`canViewJob`、`canCancelJob`、`canRetryJob`。
  - `jobs.ts`：`console_job` 队列与进程内 Worker（`node.ts` 启动，`STARTER_JOBS_ENABLED=false` 关闭）。`claimNextJob` 以 `FOR UPDATE SKIP LOCKED` 领取 `pending` 或锁超时（`JOB_LOCK_STALE_MS`）的 `running` 行，多进程安全；处理器 `assets.export_csv`（分批流式导出并写入 job 附件）、`assets.bulk_import`（≤ 5000 行，完成后压缩 payload 去掉原始 CSV）、`system.cleanup_expired`；成功落库前原子复核未被取消；`publicJob` 永不返回原始 CSV。
  - `csv.ts`：RFC 4180 解析与公式注入防护序列化、资产导入校验（文件内/台账重名）。资产筛选与排序 SQL 构造已移至 `modules/assets-query.ts`（列表页与导出任务共用）。
  - `job-policy.ts` / `jobs.ts` / `attachment-registry.ts` / `seed.ts`：任务策略、任务处理器、附件实体与 Demo 数据的轻量注册表；业务模块（如 `modules/assets.ts`）在导入时自注册。
  - `audit.ts`：支持 `actorSource`（`human` | `agent` | `system`）、敏感键递归 `[REDACTED]` 脱敏与动态时区自然日计算的 `audit()` / `auditResource()`。
  - `seed.ts`：受 `STARTER_SEED_DEMO` 控制的幂等引导超级管理员校准与示例资产初始化。
- `src/modules/`（按业务域拆分的子路由）：
  - `auth.ts`：`/login`（限流锁定 + `auth.login` / `auth.login_failed` 审计；含防锁死 `AUTH_PASSWORD_LOGIN_ENABLED=false` `403 AUTH_PASSWORD_DISABLED` 拦截）、`/logout`（`auth.logout`）、`/me`（附带当前有效 `permissions`）、`/me/password`、`/me/sessions`（含 `ipAddress` / `lastSeenAt`；`DELETE /me/sessions/:id` 单条下线、`POST /me/sessions/revoke-others` 一键下线其他设备）、`/auth/providers`（合并 OIDC / 飞书 / 兼容 SSO，附 `icon` 与 `passwordLoginDisabled`）、公开激活链接 `/auth/invites/:token`（`GET` 预览、`POST …/accept` 设置密码并启用）及统一 `/auth/sso/:provider/{start,callback}`（OIDC 与飞书双分支，后者支持 `AUTH_FEISHU_AUTO_PROVISION=true` 自动创建 `member` 账户）。
  - `accounts.ts`：账户管理及三层角色提权防线（普通 `admin` 仅可维护 `member`，核心超管与最后一名启用超管受保护）；`inviteOnly` 创建与 `POST /accounts/:id/invite` 一次性 72 小时激活链接（仅存令牌摘要）。所有账户写入取独占锁。
  - `system.ts`：`/system/permissions`（权限矩阵读取/保存/重置）、`/system/status`（数据库延迟探针、活跃会话数、AI 队列水位与熔断状态）、`/system/ai-circuit`（超管一键熔断开关）与 `/system/settings`（系统时区读写）。
  - `audit.ts`：`/audit` 服务端分页与按来源（`human` / `agent`）、动作、操作人及当前系统时区自然日区间筛选。
  - `attachments.ts`：`GET /attachments?entityType&entityId`、`POST /attachments`（multipart，仅资产、`assets:manage`；先写字节再落库，失败回收孤儿对象）、`GET /attachments/:id/download`（重新鉴权，`octet-stream` + `attachment` + `nosniff` + `CSP sandbox`）、`DELETE /attachments/:id`；写操作同事务审计 `attachment.upload` / `attachment.delete`。
  - `jobs.ts`：`GET /jobs`（`jobs:read` 看全部，否则仅本人）、`GET /jobs/:id`、`POST /jobs`（按任务类型校验权限并在共享锁内复核实时角色）、`POST /jobs/:id/retry`（`jobs:manage`，仅 `failed`/`cancelled`）、`POST /jobs/:id/cancel`（`jobs:manage` 可取消排队/执行中；发起人可取消本人排队任务）；审计 `job.create` / `job.retry` / `job.cancel`。
  - `tokens.ts`：`GET/POST /me/tokens`、`DELETE /me/tokens/:id`（全部 `requireCookieSession`）；scopes 必须是本人当前有效权限子集，每账户最多 20 个有效密钥，明文仅在创建响应中返回一次；审计 `token.create` / `token.revoke`。
  - `assets.ts`：`/assets`、`/assets/page`（`stage`/`domain`/`owner` 多值、`sortBy`/`sortDir`、`page`/`size`）、`/assets/summary`（当前筛选范围的状态与业务域/团队聚合统计）、`/assets/facets`、`/assets/topology`（`assets-topology.ts` 基于全量资产确定性计算 `2400 x 1600` 扇区力导向超大图并按指纹缓存）、`/assets/:id`、`/assets/:id/detail`（单条详情、筛选队列前后邻居、同域/跨域拓扑关系、`console_attachment` 计数与关联 `console_audit` 记录）、`/assets/import/{template,preview,commit}`（同步 ≤ 500 行，`onDuplicate=fail|skip`，同事务审计 `asset.bulk_import`）、资产增删改、批量流转/删除（`/assets/bulk-stage`、`/assets/bulk-delete`）及 `/assets/agent`（受 `assets:read` 权限与全局熔断双重约束，回执写入 `agent.asset_filter` 审计）。

## 新增模块步骤

1. 在 `packages/db/src/schema/` 定义表并在 `packages/api/src/` 定义共享 Zod 契约与权限项；
2. 在 `src/modules/<module>.ts` 编写 Hono 路由，读接口使用 `requirePermission("<slug>:read")`，写操作放入 `db.transaction` 内调用 `lockPermission(tx, actor.id, "<slug>:manage")`（默认共享锁，业务写入互不阻塞；只有改变账户/权限等安全状态时才传 `{ exclusive: true }`）与 `auditResource`；错误统一 `throw new Refusal(status, "中文原因", code?)` 或 `errorJson(c, status, "中文原因")`；
3. 在 `src/console.ts` 挂载路由（或直接执行 `bun run gen:module <slug> --label <中文名>` 自动注册表、契约、权限矩阵与侧栏入口）；
4. 新路由默认适用 64 KiB JSON 请求策略；需要 multipart 或更大请求体时在 `REQUEST_POLICIES` 追加条目，不放宽 Cookie `Origin` 校验；需要禁止 Bearer 调用的交互接口追加 `requireCookieSession`。

## 单元测试

`src/core/*.test.ts` 与 `src/modules/assets-{policy,topology}.test.ts` 只覆盖无 DB 依赖的纯函数（`http`、`bearer`、`job-policy`、`storage`、`csv`、`oidc`、`feishu`、`login-guard`、`audit` 脱敏、`assets-topology` 构图）；涉及数据库、事务与 HTTP 全链路的行为以 E2E 为准（见 [TESTING.md](../../TESTING.md)）。
