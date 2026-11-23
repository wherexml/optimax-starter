# PROJECT

本文件只记录已核实的项目事实。启动、命令和派生步骤以 [README.md](./README.md) 为唯一来源。

| 项 | 值 |
| --- | --- |
| 名称 | OptiMax Starter（`optimax-starter`） |
| 类型 | 可运行的管理后台脚手架；[资产自然语言筛选](./apps/web/src/features/assets/README.md) 为可选本地试点，默认关闭 |
| 仓库 | https://github.com/wherexml/optimax-starter |
| 状态 | 本地开发栈（`compose.yaml` + `compose.override.yaml` 源码热更新）与生产多阶段容器栈（`Dockerfile.prod` + `compose.prod.yaml`）并存 |
| 包管理 | Bun 1.3.14 workspaces（`apps/*`、`packages/*`） |
| 运行 | 本地 Docker Compose：`web`、`api`、`db`；生产 Compose：`app`（同源托管静态页 + API）、`db` |
| Compose 项目 / 镜像 | 本地默认 `optimax-starter-preview` / `optimax-starter-preview:local`（为延续已有数据卷沿用此名）；新项目通过 `./scripts/bootstrap-project.sh <slug>` 自动改名隔离 |
| 端口 | 本地默认 web `127.0.0.1:38140`，api `127.0.0.1:38141`（由 `.env` 中 `WEB_PORT` / `API_PORT` 驱动），db 仅在 Compose 内部可访问 |
| API 运行时 | Node 24（本地开发 `node --watch --import tsx src/node.ts`，生产 `node apps/server/dist/node.mjs`）；Bun 执行包管理、前端开发与数据库迁移/同步 |
| 数据库 | PostgreSQL 17，Drizzle ORM（开发 `db:push`，生产优先版本化 `db:migrate:deploy`） |
| 共享契约与模块化 | 前后端契约统一在 `packages/api`（Zod）；顶层页签 `PageTabs`、工作台图表原语、共享弹窗、输入控件、刷新骨架屏与右下角全局通知在 [packages/ui](./packages/ui/README.md)；后端分 `apps/server/src/core/` 与 `modules/`；前端导航与工作台模块分别注册在 `apps/web/src/config/app-config.ts` 与 `apps/web/src/features/dashboard/registry.ts`，列表页使用 `ResourceTableSlot`；支持 `bun run gen:module` 生成全栈业务模块（含 `Combobox` / `MultiSelect` / 日期区间映射与工作台注册） |
| AI 智能助理（可选） | 运行时 `packages/agent`，服务端 [apps/server/src/agent](./apps/server/src/agent/README.md)，右侧面板 [features/assistant](./apps/web/src/features/assistant/README.md)；权限 `agent:use`；可选环境变量 `STARTER_AI_PROTOCOL`、`STARTER_AI_STRUCTURED_MODE`、`STARTER_AI_CONFIG_KEY_FILE`（启用网页端维护模型）、`STARTER_AI_ALLOWED_ORIGINS`、`STARTER_AGENT_SKILLS_DIR`；`--no-agent` 整体移除，不建表 |
| 角色 | `super_admin`、`admin`、`member`（搭配 `console_role_permission` 模块级「查看 / 操作」权限矩阵） |
| 项目技能 | [starter-ui-sdk](./.agents/skills/starter-ui-sdk/SKILL.md)，前端交互与 Agent 操作由 AGENTS 默认路由；随模板复制 |
| CI/CD | GitHub Actions：`.github/workflows/ci.yml`（`ci-scope` 变更分类 + 静态/构建检查 + 真实容器 HTTP/RBAC/权限矩阵/熔断/事务回滚 E2E + 隔离模型客户端 `ai-client-e2e`）与 `.github/workflows/deploy-production.yml`（调用 `scripts/deploy-production.sh`） |

## 模块

| 路由 | 模块 | 默认可见角色 |
| --- | --- | --- |
| `/` | [工作台](./apps/web/src/features/dashboard/README.md)（注册表驱动 Bento 双视图：业务总览 / 治理与审计，随 `--no-example` 与 `gen:module` 自动适配） | 全部（受 `workbench:read` 控制） |
| `/assets` | 资产台账（`/console/assets/page` 服务端分页、排序与多选筛选，`/console/assets/facets` 提供业务域/责任团队选项；增删改与审计；CSV 批量导入预览/提交；详情抽屉内「相关附件」；当前页 CSV 与「异步导出全部」后台任务） | 成员只读、管理员与超管可写（受 `assets:read` / `assets:manage` 控制） |
| `/accounts` | 账户管理（含三层角色提权防线与最后一名超管保护） | 管理员、超级管理员（受 `accounts:read` / `accounts:manage` 控制） |
| `/permissions` | 系统权限（模块 × 角色「查看 / 操作」矩阵与恢复默认） | 仅超级管理员（`system:permission:*` 锁定） |
| `/system` | [系统配置](./apps/web/src/features/system/README.md)（顶部 `PageTabs`：`运行状态` 含服务、数据库延迟与活跃会话探针，后端保留 `PATCH /console/system/ai-circuit` 兼容；`基础配置` 含全局系统时区；`后台任务` 含 `FilterBar` 动态筛选、重试/取消与「清理过期数据」） | 管理员只读、超级管理员可维护；`后台任务` Tab 受 `jobs:read` / `jobs:manage` 控制 |
| `/audit` | 操作日志（服务端分页，区分 `human` / `agent` / `system` 来源，覆盖账户、权限、系统开关、资产、批量导入、附件、后台任务与 API 密钥操作，跟随系统时区） | 管理员、超级管理员（受 `audit:read` 控制） |
| `/settings` | 个人设置（含「API 密钥」卡片：创建/撤销个人 Bearer 密钥，仅网页会话可管理） | 全部已登录账户 |
| `/demo/navigation` | [二级导航与顶部 Tab Demo](./apps/web/src/features/navigation-demo/README.md)（受 `VITE_ENABLE_DEMOS` 控制） | 全部 |
| `/demo/forms` | [三段式表单弹窗、输入控件、全局通知与骨架屏刷新 Demo](./apps/web/src/features/forms-demo/README.md)（受 `VITE_ENABLE_DEMOS` 控制） | 全部 |

## 数据表

`console_account`（含可为空的 `email`、`company`）、`console_session`、`console_asset`、`console_role_permission`（角色有效权限矩阵）、`console_setting`（全局时区与 AI 熔断开关）、`console_audit`（只追加，含 `actor_source` 与敏感键递归脱敏）、`console_login_guard`、`console_account_invite`、`console_oidc_state`、`console_attachment`（附件元数据，字节在存储驱动中）、`console_job`（PostgreSQL 后台任务队列）、`console_api_token`（个人 Bearer 密钥，仅存 SHA-256 摘要）。

## 后端能力（Package 2）

分层与实现细节见 [apps/server/README.md](./apps/server/README.md)，规范见 [BACKEND.md](./BACKEND.md) §11–§12。

- **Bearer API 密钥**：`/console/me/tokens` 仅网页会话可管理；Bearer 有效权限 = 账户实时角色权限 ∩ 密钥 scopes；无效 Bearer 直接 `401`，绝不回退 Cookie。
- **附件存储**：本地目录（默认 `STARTER_UPLOAD_DIR`）或 S3 兼容存储（零依赖 SigV4）；扩展名白名单 + 魔数校验 + 文本主动内容拦截，下载一律 `application/octet-stream` + `attachment`。
- **后台任务**：`console_job` + 进程内 Worker，`FOR UPDATE SKIP LOCKED` 领取，指数退避重试；`STARTER_JOBS_ENABLED=false` 可关闭 Worker。
- **导航**：不新增侧栏入口——后台任务为 `/system` 顶部 Tab，API 密钥为 `/settings` 卡片，附件在资产详情抽屉内。

## 约束

- 新项目必须继承 [AGENTS.md](./AGENTS.md) 中的规范，包括侧栏布局基线。
- 演示账户与演示种子（`STARTER_SEED_DEMO=true`）只能在本地使用，生产启动与部署预检均强制拦截；`.env` 和 `evidence/` 不能作为产品默认值复制。
