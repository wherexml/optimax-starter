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
| 共享契约与模块化 | 前后端契约统一在 `packages/api`（Zod）；后端分 `apps/server/src/core/` 与 `modules/`；前端导航与品牌统一在 `apps/web/src/config/app-config.ts`，列表页使用 `ResourceTableSlot`；支持 `bun run gen:module` 生成新业务模块 |
| 角色 | `admin`、`member` |
| 项目技能 | [starter-ui-sdk](./.agents/skills/starter-ui-sdk/SKILL.md)，前端交互与 Agent 操作由 AGENTS 默认路由；随模板复制 |
| CI/CD | GitHub Actions：`.github/workflows/ci.yml`（`ci-scope` 变更分类 + 静态/构建检查 + 真实容器 HTTP/事务回滚 E2E）与 `.github/workflows/deploy-production.yml`（调用 `scripts/deploy-production.sh`） |

## 模块

| 路由 | 模块 | 角色 |
| --- | --- | --- |
| `/` | 工作台 | 全部 |
| `/assets` | 资产台账（客户端动态筛选 + 管理员新增/编辑/删除与审计；另提供 `/console/assets/page` 服务端分页筛选接口） | 成员只读、管理员可写 |
| `/accounts` | 账户管理 | 管理员 |
| `/audit` | 操作日志（服务端分页，覆盖账户、个人资料与资产写操作） | 管理员 |
| `/settings` | 个人设置 | 全部 |
| `/demo/navigation` | [二级导航与顶部 Tab Demo](./apps/web/src/features/navigation-demo/README.md)（受 `VITE_ENABLE_DEMOS` 控制） | 全部 |

## 数据表

`console_account`（含可为空的 `email`、`company`）、`console_session`、`console_asset`、`console_audit`（只追加）。

## 约束

- 新项目必须继承 [AGENTS.md](./AGENTS.md) 中的规范，包括侧栏布局基线。
- 演示账户与演示种子（`STARTER_SEED_DEMO=true`）只能在本地使用，生产启动与部署预检均强制拦截；`.env` 和 `evidence/` 不能作为产品默认值复制。
