# apps/api-laravel —— Laravel 13 后端（迁移期双栈新栈）

OptiMax Starter 的 Laravel 13 / PHP ≥8.3 API-only 后端，按 [LARAVEL.md](../../LARAVEL.md) 承接全部 `/console` 功能（LC-08 切流、LD-05 收口）；`apps/ai-service` 仅剩 asset-agent 桥上游；LC 阶段切流，LD-05 收口退役旧栈。**当前状态：骨架期，不接管任何流量**。

## 定位与边界

- API-only：无 Blade / Vite / 前端构建；全部 HTTP 入口在 `routes/api.php` 的 `/console` 前缀（与现有栈同前缀，前端零改动）。
- **零迁移**（LARAVEL.md D2）：schema 与迁移权威在 `packages/db`（Drizzle）；`database/migrations` 保持空，Eloquent 模型只对接现有 `console_*` 表（LB-04）。
- 请求校验不手写规则：`SchemaRequest` 基类消费 `packages/api/json-schema/` 产物（LB-03），refine 语义按 `refines.json` 补齐。

## Eloquent 对接（LB-04）

schema 权威在 `packages/db`（Drizzle，D2 零迁移）；模型只对接现有表，`database/migrations` 保持空。`$fillable` 与契约输入 schema 字段集对齐（防提权白名单的第二道落地）：

| 模型 | 表 | $fillable | 对齐契约 |
| --- | --- | --- | --- |
| `ConsoleAccount` | `console_account` | username/name/role/active/email/company（hash 只经密码服务写入） | `accountCreateSchema` / `accountPatchSchema` |
| `ConsoleSession` | `console_session` | key/account/expires | D3 会话复用 |
| `ConsoleAsset` | `console_asset` | name/domain/owner/stage | `assetInputSchema` / `assetPatchSchema` |
| `ConsoleAudit` | `console_audit` | action/actor_*/target_*/detail；**模型层禁止 update/delete（只追加）** | AUDIT_ACTIONS 枚举 |
| `ConsoleRolePermission` | `console_role_permission` | role/permissions/updated_by | `systemPermissionsUpdateSchema` |
| `ConsoleSystemSetting` | `console_setting` | key/value/updated_by | 系统配置写入 |

## 结构

- `app/Core/`：横切基础设施（权限/审计/系统设置），历史映射 apps/ai-service/src/core/（对拍期基线），见 [README](./app/Core/README.md)。
- `app/Modules/`：业务模块，历史映射 apps/ai-service/src/modules/（对拍期基线），见 [README](./app/Modules/README.md)。
- 开发端点严格按 [LARAVEL.md 模块标准开发流程](../../LARAVEL.md)（契约 → 路由先行 → SchemaRequest → Controller 编排 → Repository/Resource → 同事务审计 → 对拍/E2E）。

## 命令

```sh
composer lint      # Pint 格式检查（CI php job 同步执行）
composer analyse   # Larastan level 5 静态分析（CI php job 同步执行）
php artisan --version
```

运行（本地 compose `api-laravel` 服务、健康检查与端口）见 LB-02 落地后的 [DEPLOYMENT.md](../../DEPLOYMENT.md)。

## 环境

`.env.example` 是 PHP 侧唯一模板；与根 `.env` / compose 共享的键（`SESSION_COOKIE_NAME`、`STARTER_ADMIN_USERNAME/PASSWORD`、`STARTER_SEED_DEMO`、`CORS_ORIGIN`、`DATABASE_URL`）在 LARAVEL.md「配置对齐」维护。`APP_KEY` 本地生成，不入库。

## Agent 协作

本目录自带的 `AGENTS.md` / `CLAUDE.md` 为 Laravel 13 官方随包文档，作为框架约定参考；与项目规范的冲突以根 [AGENTS.md](../../AGENTS.md) 为准，偏差记录见 [SPEC_ADOPTION.md](../../SPEC_ADOPTION.md)。
