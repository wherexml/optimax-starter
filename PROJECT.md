# PROJECT

本文件只记录已核实的项目事实。启动、命令和派生步骤以 [README.md](./README.md) 为唯一来源。

| 项 | 值 |
| --- | --- |
| 名称 | OptiMax Starter（`optimax-starter`） |
| 类型 | 可运行的管理后台脚手架；[资产自然语言筛选](./apps/web/src/features/assets/README.md) 为可选本地试点，默认关闭 |
| 仓库 | https://github.com/wherexml/optimax-starter |
| 状态 | 本地开发栈（`compose.yaml` + `compose.override.yaml` 源码热更新）与生产多阶段容器栈（`Dockerfile.prod` + `compose.prod.yaml`）并存 |
| 包管理 | Bun 1.3.14 workspaces（`apps/*`、`packages/*`） |
| 运行 | 本地 Docker Compose：`web`、`api`、`api-laravel`（**LC-08 起 `/console` 主管流量**）、`db`（Node `api` 保留为 AI 服务与回滚备份，切回只需改 `API_PROXY_TARGET`）；生产 Compose：`app`（同源托管静态页 + API）、`db` |
| Compose 项目 / 镜像 | 本地默认 `optimax-starter-preview` / `optimax-starter-preview:local`（为延续已有数据卷沿用此名）；新项目通过 `./scripts/bootstrap-project.sh <slug>` 自动改名隔离 |
| 端口 | 本地默认 web `127.0.0.1:38140`，api `127.0.0.1:38141`，Laravel 栈 `127.0.0.1:38142`（`WEB_PORT` / `API_PORT` / `API_LARAVEL_PORT`），db 仅在 Compose 内部可访问 |
| API 运行时 | `/console` 由 Laravel 13（PHP 8.4）主管（LC-08 切流；生产为 FrankenPHP 单容器，LD-03）；Node 24 仅保留给 asset-agent 桥上游与回滚对照（观察期）；Bun 执行包管理、前端开发 |
| 数据库 | PostgreSQL 17；schema 与迁移权威在 Laravel（`apps/api-laravel/database/migrations`，D2 终态 LD-04；容器启动/部署前置 `artisan migrate`）。`packages/db`（Drizzle）降级为观察期参考实现，见其 README |
| 共享契约与模块化 | 前后端契约统一在 `packages/api`（Zod）；共享弹窗、输入控件、刷新骨架屏与右下角全局通知在 [packages/ui](./packages/ui/README.md)；后端分 `apps/ai-service`（Node AI 服务）；前端导航与品牌统一在 `apps/web/src/config/app-config.ts`，列表页使用 `ResourceTableSlot`；支持 `bun run gen:module` 生成新业务模块 |
| 角色 | `super_admin`、`admin`、`member`（搭配 `console_role_permission` 模块级「查看 / 操作」权限矩阵） |
| 项目技能 | [starter-ui-sdk](./.agents/skills/starter-ui-sdk/SKILL.md)，前端交互与 Agent 操作由 AGENTS 默认路由；随模板复制 |
| CI/CD | GitHub Actions：`.github/workflows/ci.yml`（`ci-scope` 变更分类 + 静态/构建检查 + 真实容器 HTTP/RBAC/权限矩阵/熔断/事务回滚 E2E + 隔离模型客户端 `ai-client-e2e`）与 `.github/workflows/deploy-production.yml`（调用 `scripts/deploy-production.sh`） |

## 模块

| 路由 | 模块 | 默认可见角色 |
| --- | --- | --- |
| `/` | 工作台 | 全部（受 `workbench:read` 控制） |
| `/assets` | 资产台账（客户端动态筛选 + 增删改与审计；另提供 `/console/assets/page` 服务端分页筛选接口） | 成员只读、管理员与超管可写（受 `assets:read` / `assets:manage` 控制） |
| `/accounts` | 账户管理（含三层角色提权防线与最后一名超管保护） | 管理员、超级管理员（受 `accounts:read` / `accounts:manage` 控制） |
| `/permissions` | 系统权限（模块 × 角色「查看 / 操作」矩阵与恢复默认） | 仅超级管理员（`system:permission:*` 锁定） |
| `/system` | 系统配置（顶部 Tab：`运行控制` 含数据库探针与 AI 队列水位/全局一键熔断；`基础配置` 含全局系统时区） | 管理员只读、超级管理员可维护 |
| `/audit` | 操作日志（服务端分页，区分 `human` / `agent` 来源，覆盖账户、权限、系统开关与资产操作，跟随系统时区） | 管理员、超级管理员（受 `audit:read` 控制） |
| `/settings` | 个人设置 | 全部已登录账户 |
| `/demo/navigation` | [二级导航与顶部 Tab Demo](./apps/web/src/features/navigation-demo/README.md)（受 `VITE_ENABLE_DEMOS` 控制） | 全部 |
| `/demo/forms` | [三段式表单弹窗、输入控件与全局通知 Demo](./apps/web/src/features/forms-demo/README.md)（受 `VITE_ENABLE_DEMOS` 控制） | 全部 |

## 数据表

`console_account`（含可为空的 `email`、`company`）、`console_session`、`console_asset`、`console_role_permission`（角色有效权限矩阵）、`console_setting`（全局时区与 AI 熔断开关）、`console_audit`（只追加，含 `actor_source` 与敏感键递归脱敏）。

## 约束

- 新项目必须继承 [AGENTS.md](./AGENTS.md) 中的规范，包括侧栏布局基线。
- 演示账户与演示种子（`STARTER_SEED_DEMO=true`）只能在本地使用，生产启动与部署预检均强制拦截；`.env` 和 `evidence/` 不能作为产品默认值复制。
