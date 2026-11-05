# PROJECT

本文件只记录已核实的项目事实。启动、命令和派生步骤以 [README.md](./README.md) 为唯一来源。

| 项 | 值 |
| --- | --- |
| 名称 | OptiMax Starter（`optimax-starter`） |
| 类型 | 可运行的管理后台脚手架，不含 AI |
| 仓库 | https://github.com/wherexml/optimax-starter |
| 状态 | 本地预览；不是生产部署形态（见 README“上线前须知”） |
| 包管理 | Bun 1.3.14 workspaces（`apps/*`、`packages/*`） |
| 运行 | Docker Compose：`web`、`api`、`db` |
| Compose 项目 / 镜像 | `optimax-starter-preview` / `optimax-starter-preview:local`（为延续已有数据卷，沿用此名称） |
| 端口 | web `127.0.0.1:38140`，api `127.0.0.1:38141`，db 仅在 Compose 内部可访问 |
| API 运行时 | Node 24（`node --import tsx src/node.ts`）；Bun 只执行启动前的 `db:push` |
| 数据库 | PostgreSQL 17，Drizzle schema push |
| 角色 | `admin`、`member` |

## 模块

| 路由 | 模块 | 角色 |
| --- | --- | --- |
| `/` | 工作台 | 全部 |
| `/assets` | 资产台账（浏览器端筛选） | 全部 |
| `/accounts` | 账户管理 | 管理员 |
| `/audit` | 操作日志（服务端分页） | 管理员 |
| `/settings` | 个人设置 | 全部 |

## 数据表

`console_account`（含可为空的 `email`、`company`）、`console_session`、`console_asset`、`console_audit`（只追加）。

## 约束

- 新项目必须继承 [AGENTS.md](./AGENTS.md) 中的规范，包括侧栏布局基线。
- 演示账户只能在本地使用；`.env` 和 `evidence/` 不能作为产品默认值复制。
