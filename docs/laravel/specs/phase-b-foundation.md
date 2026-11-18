# 阶段 B：Laravel 骨架与基础设施（LB）

> 出口标准：`apps/api-laravel` 在本地 compose 内可运行、可连现有库、通过 JSON Schema 校验请求并按 `{ error }` 协议报错、会话与现有账户互通、生产安全拦截就位、Laravel 数据管理特性（关系/Cast/Scope/Resource/Cache）与演示种子可用——但**不接管任何流量**（web 仍指向 `apps/server`）。

## LB-01 Laravel 项目骨架与静态门禁

### 目标

建立 `apps/api-laravel`（Laravel 13、PHP ≥8.3、API-only 形态：无 Blade/Web 中间件栈，路由全部 `/console` 前缀），目录与现有后端分层同构；PHP 侧静态门禁进 CI。

### 前置

LA-04（契约产物已存在）。

### 动作

- [ ] `composer create-project` 引导后裁剪：移除前端脚手架/Blade/Vite 相关，保留 artisan、config、routes/api 体系；`APP_ENV=local`、`APP_DEBUG=false` 基线
- [ ] 目录映射：`app/Core/`（Guards、Audit、Permissions、SystemSettings）与 `app/Modules/`（Auth、Accounts、Assets、Audit、System），对应 `apps/server/src/core|modules`
- [ ] 接入 Pint（格式）与 Larastan（静态），配 `composer lint`/`composer analyse` 脚本；CI 增加 PHP job（install → lint → analyse），`scripts/ci-scope.mjs` 识别 `apps/api-laravel/**` 为应用路径
- [ ] 共享 env 键清单：建 `apps/api-laravel/.env.example`，与 varlock `.env.schema` 的共享键（`SESSION_COOKIE_NAME`、`STARTER_ADMIN_USERNAME/PASSWORD`、`STARTER_SEED_DEMO`、`CORS_ORIGIN`、DB 键）逐一命名对齐；DEPLOYMENT.md 登记
- [ ] 新建 `apps/api-laravel/README.md`：定位、启动、分层、与 `apps/server` 的关系；开头即链接 [LARAVEL.md 模块标准开发流程](../../../LARAVEL.md)（LD-05 收口后该正文迁入 BACKEND.md，README 改链）
- [ ] SPEC_ADOPTION.md 记偏差：BACKEND.md §2 框架建议——后端迁移至 Laravel 13（`apps/api-laravel`），Hono 栈进入退役观察期；证据指向本骨架与 LARAVEL.md

### 验收

- compose 外可独立 `php artisan --version` 与 `composer analyse` 通过（证据：命令输出）
- CI 对仅改 `apps/api-laravel` 的提交触发 PHP job 且绿

### 影响面 / 回滚

新增目录 + CI/文档。回滚：删目录与 CI job。

## LB-02 运行时形态验证与 compose 接入

### 目标

Laravel 以独立服务进入本地 compose（`api-laravel`，分配五位数端口），源码热更新可用；同时完成 D6 决策——生产单容器形态选型。

### 前置

LB-01。

### 动作

- [ ] compose 增 `api-laravel` 服务（php-fpm + nginx，或 Octane 单进程），挂载源码热更新；db 复用现有实例；端口按 `API_LARAVEL_PORT`（.env 驱动，`scripts/init-local.sh`/bootstrap 分配逻辑同步）
- [ ] 健康检查端点 `/console/health`（对应现有探针语义，返回 DB 连通）
- [ ] D6 验证：同一「hello 接口」分别以 fpm 与 FrankenPHP/Octane 各跑一轮容器内压测对比（wrk/ab，本地即可），按「贴合单 app 容器边界 + 运维复杂度」记录结论到 LARAVEL.md 决策表
- [ ] `compose.override.yaml` 不影响现有 `web`/`api` 服务定义

### 验收

- `docker compose up` 后 `curl http://127.0.0.1:<port>/console/health` 返回 DB 连通 JSON（证据）
- 现有 `bun run verify`（打旧栈）不受影响仍绿

### 影响面 / 回滚

compose*.yaml、.env.example、init 脚本。回滚：移除服务定义。

## LB-03 JSON Schema 消费层与错误协议

### 目标

PHP 侧落地 D1：FormRequest 基类从 `packages/api/json-schema/` 加载 schema 校验请求；`refines.json` 的每条语义有 PHP 实现；错误响应统一 `{ error }` 形状（422/400 语义对齐现有约定）。

### 前置

LB-01。

### 动作

- [ ] 引入 JSON Schema 校验依赖（opis/json-schema 或 swaggest，按 PHP 8.3 兼容性选一并记录理由）；实现 `SchemaRequest` 基类：按路由声明 schema 名，校验失败统一 `ValidationException` → `{ "error": <首条中文文案> }`
- [ ] refine 补规则：按 `refines.json` 6 条逐条实现（after 钩子/自定义规则），并在测试脚本中对拍「合法/非法样本各一组」与 Zod 行为一致
- [ ] 错误协议中间件：所有异常（含 HttpException）渲染为 `{ error }`；401 保持触发前端跳转的语义（无 body 要求）
- [ ] `.meta()` 中文文案传递验证：schema 内错误消息在 PHP 校验失败时原样返回
- [ ] **补提升（Phase A 审计发现 ①）**：把 `SystemStatusResponse`、`SystemSettingsResponse`、`SystemPermissionMatrixPayload`（现仍为 TS interface）提升为 zod schema 并登记进 `contracts:generate` 产物，使 system/permissions 端点的响应形状进入 PHP 可对照范围；含 trim 边界样本（发现 ③）加入对拍用例

### 验收

- 构造临时探针路由挂 2 个真实 schema（`accountCreateSchema`、`assetInputSchema`）：正/反样本各 ≥3 组双语言对拍（Node 端用 Zod 直接跑、PHP 端走消费层），结果一致（证据：对拍脚本输出）

### 影响面 / 回滚

`apps/api-laravel` 内部。对拍脚本落 `scripts/e2e/`（参数化 baseUrl，供 CI 复用）。

## LB-04 Eloquent 对接现有表

### 目标

D2 落地：为 6 张 `console_*` 表建 Eloquent 模型，零迁移、只读已验证，`$fillable` 白名单与 Zod `.strict()` 字段集对齐。

### 前置

LB-02。

### 动作

- [ ] 模型：`Account`、`ConsoleSession`（配合 LB-05 的 handler）、`Asset`、`AuditEntry`（表名 `console_audit`）、`RolePermission`、`SystemSetting`；全部 `$timestamps = false`、显式 `$table`
- [ ] `$fillable` 从 `packages/api` 对应输入 schema 字段集推导（`accountCreate/patch`、`assetInput/patch`、权限矩阵、系统设置写入），建立「schema 字段 ↔ fillable」对照表入 `apps/api-laravel/README.md`
- [ ] `console_audit` 只追加约束：模型层禁止 update/delete（重写 save 触发或 repository 约束），并进 LB-06 对拍
- [ ] 禁用 Laravel 迁移目录的使用约定（`database/migrations` 保持空并在 README 声明权威在 Drizzle；LD-04 再决策）

### 验收

- `php artisan tinker` 连现有库：6 张表各一条真实 select 成功；对 `console_audit` 模型尝试 update 抛异常（证据）

### 影响面 / 回滚

`apps/api-laravel`。不改库。

## LB-05 会话与认证底座

### 目标

D3/D4 落地：Laravel 会话读写现有 `console_session` 表；argon2id 哈希与现有 PHC 互认；`/console` 组 401 语义与 cookie 行为同现栈。

### 前置

LB-04。

### 动作

- [ ] 自定义 `SessionHandler` 适配 `console_session` 表结构（含生命周期 8h、过期清理语义对齐 `core/config.ts`）
- [ ] 哈希：`password_hash/verify` 用 argon2id 且显式 `memory_cost=65536, time_cost=2, threads=1`；用现有 `console_account.password_hash` 真实样本验证 `password_verify` 通过、且新哈希可被 `@node-rs/argon2` verify（双向对拍）
- [ ] cookie：`SESSION_COOKIE_NAME` 读取 env、`SameSite=Lax`、`HttpOnly`、生命周期对齐；D4 论证记录（同源 BFF + JSON-only + SameSite 足以替代 CSRF token 的理由与复查条件）写入 AUTH.md 迁移注记
- [ ] `/console` 路由组中间件：未认证返回 401（供前端跳转）；排除 CSRF 中间件（`VerifyCsrfToken` 排除该组），排除理由引用 D4
- [ ] `requirePermission` 等价中间件：读 `console_role_permission` + 默认目录，语义与 `apps/server/src/core/guards.ts` 一致（含 `Refusal` 403 `{ error }` 形状、`lockPermission` 不可变权限拒绝）

### 验收

- E2E（新写 `scripts/e2e/laravel-session.mjs`）：用真实演示账户登录 Laravel 栈拿 cookie → 调受保护探针路由 200 → 无 cookie 调用 401 → 无权限账户 403（证据）
- 哈希双向对拍输出

### 影响面 / 回滚

`apps/api-laravel` + AUTH.md 注记。

## LB-06 安全不变量移植

### 目标

把「漏一个就是事故」的启动/审计不变量在 Laravel 侧就位，LC 阶段写路径直接复用。

### 前置

LB-05。

### 动作

- [ ] 生产拦截：`AppServiceProvider::boot` 校验 `APP_ENV=production` 时 `STARTER_SEED_DEMO=true` 即抛错（语义对齐 `core/config.ts:18`）；`scripts/deploy-production.sh` 预检增加 Laravel 容器同项检查
- [ ] 审计写入器：同事务落 `console_audit`（`actor_source` human/agent、action 枚举、target 字段）、**递归脱敏**移植 `core/audit.ts` 的敏感键逻辑；用 `apps/server` 现有脱敏用例样本对拍输出一致
- [ ] 审计只追加 + 脱敏的失败场景先写后实现（对拍脚本先行，按 TESTING.md）
- [ ] 密钥边界：确认 Laravel 侧无任何 AI 密钥/真实密码进入日志与响应（对齐 SECURITY.md）

### 验收

- 对拍脚本：审计写入（含嵌套敏感键脱敏）新旧栈输出一致；`STARTER_SEED_DEMO=true` + production 模拟启动失败（证据）

### 影响面 / 回滚

`apps/api-laravel`、deploy-production.sh。

## LB-07 Laravel 数据管理特性接入

### 目标

落实 D8：把 Eloquent 关系预载、Casts、局部 Scope、API Resource 与 Cache 接入为**默认可用**的数据管理基座，LC 阶段所有接口直接消费，而不是逐模块现写。

### 前置

LB-04。

### 动作

- [ ] 关系：`Account hasMany ConsoleSession`（accounts 列表的 sessions 计数即现网需求）、审计 actor/target 关联；列表查询统一 `with()` 预载防 N+1
- [ ] Casts：`console_audit.detail` JSON cast、布尔与时间字段 cast 对齐现网序列化输出
- [ ] 局部 Scope：active 账户、资产 stage、审计时间窗（start/end）固化为 Scope，供 LC-05/06/01 复用
- [ ] Resource 体系：实体 Resource + `PaginatedResource` 基类（`items/total/page/size` 形状的唯一实现处）；LC-01 起所有响应必须经 Resource
- [ ] Cache：权限矩阵与系统设置读缓存（写路径主动失效，TTL 与失效点登记 README），对齐现网每请求读库的语义但降负载

### 验收

- tinker 演示关系预载与 Scope 生效（无 N+1，查询计数证据）；缓存命中与写路径失效对拍输出

### 影响面 / 回滚

`apps/api-laravel`。

## LB-08 演示种子移植

### 目标

`apps/server/src/core/seed.ts` 的种子语义对等移植（`STARTER_SEED_DEMO` 控制的演示账户、默认权限矩阵、演示资产，幂等可重入）；弥补审计发现的缺口：CI 起新栈容器必须能一键种子化，否则 LC 阶段 CI E2E 无法运行。

### 前置

LB-04。

### 动作

- [ ] artisan 命令 `console:seed`（Seeder/command 实现）：内容与幂等语义对拍 `core/seed.ts`（已存在不重复创建）
- [ ] CI/本地：新栈容器启动后先 `console:seed` 再跑 E2E（衔接 ci.yml job 编排）
- [ ] 生产禁用语义由 LB-06 的启动拦截覆盖，本 spec 只管种子内容与幂等对等

### 验收

- 空库起 Laravel 栈 → `console:seed` → demo 账户可登录、权限矩阵默认值与旧栈种子后一致（对拍证据）

### 影响面 / 回滚

`apps/api-laravel`、ci.yml。
