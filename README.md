# OptiMax Starter

OptiMax Starter 是一个可直接运行、不含 AI 的管理后台脚手架：带账户体系、工作台、资产台账、操作日志和个人设置。完成本地配置初始化后，可用 Docker Compose 启动，新项目以它为起点，并继承 `AGENTS.md` 中的工程与界面规范。

[使用此模板创建新项目](https://github.com/wherexml/optimax-starter/generate) · [新项目初始化流程](#从-github-template-初始化新项目)

![资产台账](docs/images/assets.png)

## 功能与页面

| 路由 | 页面 | 可访问角色 | 说明 |
| --- | --- | --- | --- |
| `/login` | 登录 | 匿名 | 用户名 + 密码，服务端数据库 Session（HttpOnly、SameSite=Strict Cookie） |
| `/` | 工作台 | 管理员、成员 | 资产统计卡片、业务域分布与下钻；管理员看最近操作，成员看待复核队列；快捷入口 |
| `/assets` | 资产台账 | 管理员、成员 | 表格排序、列设置、分页；动态筛选（多选、包含/等于） |
| `/accounts` | 账户管理 | 管理员 | 新增、编辑姓名、调整角色、重置密码、强制下线、启用/停用 |
| `/audit` | 操作日志 | 管理员 | 按操作类型、操作人、日期筛选，服务端分页；日志只追加 |
| `/settings` | 个人设置 | 管理员、成员 | 修改显示名称、邮箱、公司；修改密码后撤销本人全部会话 |

角色只有管理员（`admin`）和成员（`member`）两种。所有写操作都在服务端再次校验权限，前端隐藏入口只用于展示。侧栏支持折叠和移动端抽屉，Cmd/Ctrl+K 打开快速导航。

![折叠侧栏](docs/images/sidebar-compact.png)

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React、Vite、TanStack Router / Query / Table、Tailwind CSS v4、Radix（shadcn 风格组件） |
| 后端 | Hono，常驻进程用 Node 24 运行（`@hono/node-server` + `tsx`） |
| 数据 | PostgreSQL 17、Drizzle ORM（schema push） |
| 校验与安全 | Zod、Argon2id（`@node-rs/argon2`，与原 Bun 哈希格式兼容） |
| 工具链 | Bun 1.3.14（包管理、`db:push`、Vite 开发服务器），全部在容器内运行 |

## 快速开始

前提：Docker 和 Docker Compose v2、OpenSSL（`init-local.sh` 用它生成数据库密码）；运行复验脚本还需要 Python 3。主机不需要安装 Bun 或 Node。仓库当前为私有，克隆前需已有仓库访问权限并完成 GitHub 身份认证。

```sh
git clone https://github.com/wherexml/optimax-starter.git
cd optimax-starter
./scripts/init-local.sh
docker compose up -d --build
```

打开 <http://127.0.0.1:38140/login>，使用本地演示账户：

- 用户名：`demo@optimax.hk`
- 密码：`demo@2026!`

> 演示账户只用于本机开发，不得用于任何生产或对外环境。

`init-local.sh` 只会在 `.env` 中缺少相应条目时写入：数据库密码随机生成；管理员初始密码优先取环境变量 `STARTER_ADMIN_PASSWORD`，没有时使用上面的演示密码。API 启动时仅在演示管理员不存在时创建该账户，并幂等写入 12 条演示资产；数据卷已有数据时不会重置任何密码，之后再修改 `STARTER_ADMIN_PASSWORD` 也不会影响已存在的账户。

## 架构

```text
浏览器 ──▶ web :38140（Vite）──同源 /console 代理──▶ api :38141（Hono / Node 24）──▶ db（PostgreSQL 17，仅 Compose 内部可访问）
```

- 两个端口都只绑定在 `127.0.0.1`；数据库不对主机开放。
- 浏览器只访问同源的 `/console`。API 会校验非 GET 请求的 `Origin` 和 JSON `Content-Type`。
- api 容器每次启动时先执行 `bun run db:push` 同步 schema，再用 Node 启动 API；配置了 `restart: unless-stopped` 和健康检查（`GET /` 返回 `OK`）。为什么不用 Bun 运行 API，见 [RUNTIME.md](./RUNTIME.md)。

### 环境变量

| 变量 | 所在服务 | 作用 |
| --- | --- | --- |
| `STARTER_DB_PASSWORD` | db、api | 数据库密码，由 `init-local.sh` 随机生成并写入 `.env`，不要提交 |
| `STARTER_ADMIN_PASSWORD` | api | 演示管理员首次创建时使用的密码 |
| `DATABASE_URL` | api | 由 compose 拼出的内部连接串（主机名 `db`） |
| `PORT` | api | API 监听端口，默认 `38141` |
| `CORS_ORIGIN` | api | 允许的前端来源，默认 `http://127.0.0.1:38140` |
| `VITE_SERVER_URL` | web | 前端 API 基址配置，当前也供保留的 tRPC 基础代码使用；管理页面 `/console` 的代理目标在 `apps/web/vite.config.ts` 中单独配置为 `http://api:38141` |

## 日常命令

```sh
docker compose ps                 # 查看服务和健康状态
docker compose logs -f api        # 跟踪 API 日志
docker compose down               # 停止服务，保留数据卷
docker compose up -d --build      # 修改代码或拉取更新后重建镜像
```

仅在明确要清空本地数据库时才执行 `docker compose down -v`；日常停止不要加 `-v`。

镜像在构建时复制源码，容器不挂载源码目录。因此修改源码或 `git pull` 之后，必须执行 `docker compose up -d --build` 才会生效。

## 目录结构（节选）

```text
apps/
  web/src/routes/        路由、鉴权跳转、URL 搜索参数
  web/src/features/      auth · dashboard · assets · accounts · audit · settings · navigation · filters
  web/src/components/    table（EASM DataTable）、filters（FilterBar）、ui（Radix 控件、FormDialog、MultiSelect）
  server/src/            console.ts（API、Session、鉴权、日志）、node.ts（Node 入口）、password.ts
packages/
  db/src/schema/         console.ts：账户、会话、资产、操作日志
scripts/                 init-local.sh 与复验脚本
docs/images/             README 截图
compose.yaml             web / api / db 三个服务
```

## 开发指引

- 页面代码写在 `apps/web/src/features/<模块>/`；`routes/` 只负责路由、鉴权和 `validateSearch`。
- 列表页统一使用 `components/table/DataTable` 和 `components/filters/FilterBar`。多选（`multi`）和“包含/等于”（`operatorKey`）需要逐字段开启，查询链路没有实现对应匹配语义的字段不要开启。约定见 [FILTERS.md](./FILTERS.md)。
- 资产台账一次取回全部记录，在浏览器端筛选，适合演示规模的数据；数据量大时应改为服务端筛选和分页（操作日志已经是服务端分页）。
- 新增 API 写在 `apps/server/src/console.ts`。管理员写操作必须在同一事务中写入操作日志，日志里不得包含密码、哈希、Cookie 或令牌。详见 [AUTH.md](./AUTH.md)。
- 界面规范：侧栏自上而下依次为品牌区（折叠按钮在 Logo 右侧）→ 主导航 → 搜索 → 用户信息与菜单；内容区不设空顶栏；不使用绿色或紫色主题。这是强制基线，见 [AGENTS.md](./AGENTS.md) 和 [FRONTEND.md](./FRONTEND.md)。

## 从 GitHub Template 初始化新项目

用模板创建仓库只会复制文件。新仓库的提交历史与本仓库无关，之后也不会自动同步本仓库的更新；模板也不会帮你改任何配置。参考 GitHub 官方文档：[Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)。下文以 `my-console` 为例，`OWNER` 换成你的 GitHub 账户或组织名。

### 1. 创建仓库

需要对本仓库有读取权限。两种方式任选其一：

- 网页：打开 <https://github.com/wherexml/optimax-starter/generate>（也可以在仓库页点 **Use this template → Create a new repository**）。可见性选 **Private**，不要勾选 **Include all branches**（只复制 `main`）。
- 命令行：

```sh
gh repo create OWNER/my-console --template wherexml/optimax-starter --private --clone
cd my-console
git remote get-url origin   # 应输出新仓库的地址，而不是 optimax-starter
```

如果通过网页创建，创建完成后执行 `git clone https://github.com/OWNER/my-console.git` 和 `cd my-console`。不要克隆模板仓库后直接向模板的 `origin` 推送业务代码。

### 2. 首次启动前完成改名

**以下改名都要在第一次 `docker compose up` 之前完成。** 数据卷名由 compose 项目名决定，先启动再改名，会留下归属不清的旧数据卷。

| 位置 | 改为 |
| --- | --- |
| 根目录 `package.json` 的 `name` | `my-console` |
| `README.md`、`PROJECT.md` 中的项目名称 | 新项目名称；保留 `AGENTS.md` 中的侧栏布局基线等规范 |
| `compose.yaml` 顶层 `name` | `my-console-preview` |
| `compose.yaml` 中的 `image` | `my-console-preview:local` |
| `compose.yaml` 中 web 的端口映射 | `127.0.0.1:38150:38150` |
| `compose.yaml` 中 api 的端口映射 | `127.0.0.1:38151:38151` |
| api 环境变量 `PORT` / `CORS_ORIGIN` | `38151` / `http://127.0.0.1:38150` |
| web 环境变量 `VITE_SERVER_URL` | `http://127.0.0.1:38151` |
| api 健康检查中请求的地址 | `http://127.0.0.1:38151/` |
| `apps/web/vite.config.ts` | `server.port` 改为 `38150`，`/console` 代理目标改为 `http://api:38151` |
| `apps/server/src/console.ts` 中的 `const cookie` | 由 `optimax_console` 改为 `my_console_session` |
| `scripts/verify-*.py` 中的 base URL、Origin 和临时夹具名前缀 | 改成新端口和本项目自己的前缀 |

注意：

- `VITE_SERVER_URL` **不决定**代理目标；`/console` 实际转发到哪里，由 `vite.config.ts` 中的 proxy 配置决定，两处都要改。
- Cookie 不按端口隔离。如果同一台机器上的多个项目都运行在 `127.0.0.1`，Cookie 名相同时会互相覆盖登录状态，所以必须改名。
- 可选：如果要把 workspace 包命名空间 `@optimax-starter/*` 改成自己的，必须同时修改所有 `package.json` 和源码中的 import，然后用 `bun install` 重新生成 `bun.lock`，不要手动编辑 lockfile。

修改根 `package.json.name` 也会影响锁文件，完成项目名或 workspace 命名空间调整后必须重新生成并提交 `bun.lock`，否则 Docker 的 `--frozen-lockfile` 安装可能失败。主机未安装 Bun 时可在新项目根目录执行：

```sh
docker run --rm -v "$PWD:/app" -w /app oven/bun:1.3.14 \
  bun install --lockfile-only --ignore-scripts
```

这里仅更新锁文件；完整安装与环境类型生成由后续 Docker 构建完成。

### 3. 数据库隔离

- 服务名 `db`，以及内部的数据库名和用户名 `starter` 都可以保持不变：每个项目有自己的容器、网络和数据卷，互不共享。
- 隔离依赖 compose 项目名：不要通过 `-p` 或 `COMPOSE_PROJECT_NAME` 覆盖成其他项目的名称；数据卷会自动命名为 `my-console-preview_data`。不要给数据卷写显式的 `name`，也不要声明 `external`。
- 镜像名也必须唯一，避免与其他项目互相覆盖。
- 数据库端口不要映射到主机。
- 不要复制旧项目的 `.env` 或数据卷。新项目运行自己的 `init-local.sh`，数据库密码会随机生成。修改 `.env` 里的密码不会改动已经初始化的数据库，所以首次启动前就要确定好名称和配置。

### 4. 检查端口

确认 38150 和 38151 没有被占用：

```sh
lsof -nP -iTCP:38150 -sTCP:LISTEN
lsof -nP -iTCP:38151 -sTCP:LISTEN
```

Linux 没有 `lsof` 时可用 `ss -ltn` 检查这两个端口。上述 `lsof` 没有输出并返回状态 1 通常表示未找到监听。

如果有输出，说明端口已被占用，换一对相邻且未被占用的端口，并同步修改第 2 步表格中所有相关位置。

### 5. 初始化并启动

```sh
./scripts/init-local.sh
docker compose config --quiet     # 只校验配置，不打印展开后的内容（避免把密码输出到终端）
docker compose up -d --build
docker compose ps                 # api 应显示 healthy
curl -fsS http://127.0.0.1:38151/ # 应输出 OK
```

浏览器打开 <http://127.0.0.1:38150/login>，用 README 中的本地演示账户登录。演示账户只能在本地使用。

### 6. 确认隔离生效

```sh
docker volume inspect my-console-preview_data --format '{{ index .Labels "com.docker.compose.project" }}'
# 应输出 my-console-preview
git remote get-url origin
# 应为新仓库
```

确认第 2 步中脚本的 base URL、Origin 和夹具名都已更新后，再运行 `python3 scripts/verify-console.py`。以上步骤只是本地初始化流程，完成后并不代表可以直接上线（见下文“上线前须知”）。

## 复验

前三个脚本在主机上用 Python 3 运行，通过 HTTP 访问正在运行的服务：

| 命令 | 覆盖内容 | 清理 |
| --- | --- | --- |
| `python3 scripts/verify-console.py` | 匿名访问、角色权限、启用/停用、会话撤销、退出 | 结束时自动删除临时成员 |
| `python3 scripts/verify-foundation.py` | 日志事务、权限、日期、分页 | 会保留临时成员供浏览器验收；完成后必须执行 `--cleanup` |
| `python3 scripts/verify-easm-settings.py` | 个人资料、改密、会话撤销 | 会保留夹具；完成后必须执行 `--cleanup`。回滚步骤依赖 settings 夹具，执行 `--cleanup` 前不要手动删除 |
| `docker compose exec -T web bun run --filter web check-types` | Vite 生产构建与前端类型检查 | — |
| `docker compose exec -T api bun run --filter server check-types` | 后端类型检查 | — |

`python3 scripts/verify-runtime-load.py` 执行 8 路并发、1,200 次请求；这是短时突发测试，不能代替长时间稳定性测试。上表列的是可执行的检查，不代表在你的环境里已经通过。

脚本使用本地演示账号，并会创建临时数据；仅在专用预览数据库执行。`verify-foundation.py` 会安装针对临时账户的事务失败触发器并在检查后移除。个人设置事务回滚可在 settings 夹具存在时运行 `python3 scripts/verify-easm-rollback.py`，然后执行 `python3 scripts/verify-easm-settings.py --cleanup`。

界面验收还需在浏览器完成登录、筛选增删与多选、账户权限、侧栏展开/折叠、移动端抽屉以及 Cmd/Ctrl+K 导航。完整场景见 [TESTING.md](./TESTING.md)。本机历史验收保存在被 Git 忽略的 `evidence/`；仓库只保留本文展示所需的脱敏演示截图。

## 上线前须知

本仓库目前是本地预览形态，直接上线前至少要处理以下几点：

- web 运行的是 Vite 开发服务器，API 由 `tsx` 在运行时转译。生产环境应先构建再运行。
- 数据库结构用 `drizzle push` 同步，没有版本化迁移。
- 权限只有管理员和成员两种，没有多租户、OAuth/SSO 或细粒度权限。
- 不集成任何 AI 服务。
- 演示账户和本地 `.env` 不得带入生产；密码策略只要求 10–256 位。
- 当前没有 `.github/workflows`，尚未配置 CI/CD；`cicd-spec.md` 是规范文档，不代表流水线已经运行。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [AGENTS.md](./AGENTS.md) | 协作规则、强制布局基线、按任务阅读的入口 |
| [TESTING.md](./TESTING.md) | 验证命令与浏览器验收旅程 |
| [DESIGN.md](./DESIGN.md) | 视觉、交互与组件规范 |
| [FRONTEND.md](./FRONTEND.md) | 前端结构、外壳、筛选、动效与组件来源 |
| [AUTH.md](./AUTH.md) | 身份、Session、角色权限、操作日志契约 |
| [FILTERS.md](./FILTERS.md) | 筛选组件与 URL 参数约定 |
| [EASM_REUSE.md](./EASM_REUSE.md) | 工作台、用户菜单、个人设置的移植说明 |
| [REUSE.md](./REUSE.md) | 复用来源总表 |
| [RUNTIME.md](./RUNTIME.md) | API 运行时选择、已知限制与恢复记录 |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 部署说明 |
| [SPEC_ADOPTION.md](./SPEC_ADOPTION.md) | 团队规范（spec）基线的采用情况与差异 |
| [PROJECT.md](./PROJECT.md) | 项目事实摘要 |

部分继承的专项规范仍含待填写模板；它们描述新项目应补齐的约定，不代表所有基础设施已经实现。当前功能以代码、本文和 [PROJECT.md](./PROJECT.md) 为准。

## 来源与致谢

- 工程骨架基于 Better-T-Stack 生成的 monorepo。
- 登录页移植自 OptiMax RiskOps：全屏地图、渐变遮罩、品牌 SVG 和右侧登录卡。
- 表格、列设置、分页、FormDialog、条件筛选、多选、工作台、用户菜单和个人设置改编自 Skylance EASM。
- 快速导航参考 OptiONE 的 search-command。

各项的具体改动见 [REUSE.md](./REUSE.md) 和 [EASM_REUSE.md](./EASM_REUSE.md)。本 README 不声明许可条款，以仓库中的实际文件为准。
