# 阶段 D：扩展性建设与收口（LD）

> 出口标准：新模块的开发体验不低于现有单栈（契约一处定义、双端骨架一键生成、横切能力注册即得）；生产部署链路完整；旧栈删除且文档只剩一套事实。

## LD-01 `gen:module` 双轨化

### 目标

`bun run gen:module <slug>` 除现有 TS 侧产出（契约、权限、审计注册、路由/页面骨架）外，同步生成 Laravel 侧模块骨架，实现「契约驱动、双端一次生成」。

### 前置

LC-08。

### 动作

- [x] 生成物对齐已迁移模块的真实结构：`app/Modules/<Slug>/`（controller、FormRequest（引用 JSON Schema 消费层）、repository/resource）、路由注册片段、`app/Core/Permissions` 目录项
- [x] 生成器从 `packages/api` 新增 schema 自动进入 `contracts:generate` 名单并提醒重新生成产物（衔接 LA-02/LA-04 门禁）
- [x] README（`packages/api` 与 `apps/api-laravel`）更新扩展约定：新模块 = 契约 + 权限/审计登记 + 双端骨架 + E2E 场景，缺一不可合并

### 验收

- 空跑一个 `demo-lint` 模块：生成 → `composer analyse` + `bun run check-types` + `contracts:generate` 门禁全绿 → 删除（证据：命令输出）

### 完成记录（2026-11-18，分支 `laravel/ld-01-gen-module-dual`）

- 生成器七件套（Model/routes/Controller/Input+Patch Request/Resource+PaginatedResource），横切抽到 `LocksPermission` trait + `Like::escape` + `ConsoleResponse::isoTime`（生成模板不再复制横切逻辑，LARAVEL.md 扩展性原则落地）；路由经 routes/api.php 的 **glob 自动装载**（生成器零改动路由文件）。
- 契约链全自动登记：registry + 源扫描名单 + `refines.ts`（PatchSchema 非空 refine）+ `ContractRefines.php` 对应 PHP 规则——**漂移对拍全链生效**（生成即 7 refines 全绿）。
- **验收空跑 lint 模块全绿**：27 schemas + 7 refines、api tsc 0、pint/phpstan 0；表同步后经 web→Laravel 实测 create 201 / 筛选列表（curl 未编码 URL 的 400 属工具问题，前端恒编码）/ patch diff-set / delete 200 + 审计（LI-001 编号、lint.delete entityId+domain detail 形状对齐 auditResource）/ member 403；**删除回滚**后产物 25+6 复原、console_lint 表 drop、路由清零、四门禁 + verify PASS。
- 事实说明（如实）：a) Hono 模板已移除——新模块仅存于 Laravel 世界，退役栈无回退对照（新表在回滚栈中不存在，安全）；b) lint 冒烟产生的 4 条审计行为合法历史（append-only），保留；c) `phpstan.neon` 排除 `app/Core/Http/Concerns/*`——trait 由生成模块消费，生成前未被引用是预期。

### 影响面 / 回滚

`scripts/gen-module.mjs`、两个 README。

## LD-02 试点附件模块与 OSS 存储管理

### 目标

用一条真实小需求走完双轨全流程，验证「最大扩展性」承诺，同时落地 D8 的存储管理：**附件模块（attachments）**——Laravel Filesystem 抽象、本地/对象存储双 driver、签名 URL、附件元数据与审计。UI 侧复用 `packages/ui` 已有的 attachment 输入控件。

### 前置

LD-01、LB-07。

### 动作

- [ ] 契约先行：`packages/api` 新增 attachment schema（文件类型/大小白名单进契约、`AUDIT_ACTIONS` 与权限目录**只增不改**地登记 `attachment.*` 与 `attachments:read/manage`）→ `contracts:generate` 产物更新
- [x] 存储基座：`config/filesystems.php` 双 disk——`local`（开发/测试）与 S3 兼容 OSS disk（生产；阿里云 OSS 走 S3 兼容端点），env 键入共享清单；驱动选型与理由记录 README
- [x] 端点（按 LARAVEL.md 模块标准开发流程）：上传（服务端代理流式落盘）、列表（分页，经 `PaginatedResource`）、删除（软删或标记，含同事务审计）、签名下载 URL（临时授权，TTL 进契约）
- [x] 上传策略：MIME/扩展名白名单、大小上限在服务端强制（契约与 PHP 双侧一致），文件名与路径不可信输入处理（对齐 SECURITY.md）
- [x] E2E：本地 disk 全链路（上传→列表→签名下载→删除→审计）；S3 兼容行为用本地 MinIO 容器对拍验证（**不引入真实云凭证**，密钥不进源码/证据/Docker 环境）
- [x] 记录每一步耗时与需人工补齐的点，反哺 gen:module 与规范（摩擦点回写对应 spec/README）；试点完成后决定模块去留（保留为示例或删除，理由记录）

### 验收

- 试点模块 E2E 绿；`git diff` 证明对 `app/Core/**` 与 `packages/api` 既有定义**只做新增注册、零修改**
- MinIO 对拍证据（签名 URL 语义、分片/大文件边界按契约上限验证）

### 影响面 / 回滚

新增模块目录、`packages/api` 新增契约、compose 可选测试 S3 栈（profile 隔离）。可整体删除回滚。

### 完成记录（2026-11-18，commit `0b3c1d1`）

- **试点改为附件模块（attachments）并落地 D8**：契约（策略产物 `attachments.policy.json` 单源：白名单 8 类型 / 10MB / TTL 300s）→ Drizzle 元数据表 `console_attachment`（D2 权威）→ PHP 七件（UploadRequest 按策略产物校验 / Controller 上传 sha256 去重落盘、分页、签名 URL、删除同事务审计 AT-%03d / routes glob 装载）→ Web 页（复用 packages/ui attachment 控件 + 导航注册）。
- **S3 对拍栈事实变更（如实）**：MinIO 公共镜像已全线下架（Docker Hub 仓库移除、quay 需登录），改用 **Garage**（同为 S3 协议：sigv4 + presigned + path-style），生产 OSS 同一 Laravel `s3` 驱动。测试栈经 `--profile attachments` 隔离；init 脚本为宿主侧驱动（dxflrs/garage 为无 shell 镜像）。
- **E2E 16/16 PASS**：local 与 s3/Garage 双盘全链路——上传 201（sha256 去重）/列表（uploadedByUsername）/签名 URL 形状/**下载字节级 sha256 一致**/删除/审计（AT 编号 + size detail）/扩展名白名单 400/member 403/删除后无残留（含 Garage 对象）。真实云凭证零落盘（一次性容器 env 注入后销毁）。
- **过程修复（如实）**：① D4 语义扩展——非 GET 请求体收敛为 json **+ multipart**（urlencoded 仍拒，Origin 强校验不变）；② 签名 URL 基址 bug——代理改写 Host 产出内网地址，改 `APP_URL` 显式基址；③ 一次性容器误用 ADMIN_PASSWORD 当 DB 密码 → 改 `STARTER_DB_PASSWORD`；④ 测试端点统一宿主 IP（presigned 签名 host 双侧一致；生产 OSS 公网端点天然满足）。孤儿测试附件已连同 Garage 对象清理。
- **gen:module 锚点事故与修复**：LC-08 验收时 `git checkout` 意外回退了未提交的 registry/refines 锚点（LD-01 记录如实勘误），本轮恢复锚点并给生成器四处登记加「锚点缺失即抛错」守卫（0b3c1d1 后续 commit）。
- 试点去留：**保留为示例模块**（权限默认值 member 只读、admin+ 可写已进矩阵与导航）。

## LD-03 生产化与部署预检

### 目标

生产链路完整：Dockerfile.prod PHP 形态（按 LB-02 结论）、compose.prod、部署预检、回滚方案。

### 前置

LC-08。

### 动作

- [x] `Dockerfile.prod`：Laravel 生产镜像（按 D6 选型：FrankenPHP 单容器），多阶段构建、不带入源码敏感文件；静态页托管方式维持「单 app 容器同源」（web dist 合并进 Laravel public，Caddy 同容器分流 `/console` 与 SPA）；不启用 worker 模式（vanilla Laravel 未经 Octane 适配，保持每请求干净状态）
- [x] `compose.prod.yaml` 对齐：`app`（Laravel + 静态页）、`db`、`migrate`（D2 权威 Drizzle 的 db:push/migrate:deploy 一次性前置服务，app `service_completed_successfully` 依赖）；健康检查（`/healthz` DB 探测）与重启策略。队列/Horizon 不引入：D5 触发条件未满足（asset-agent 直接代理 Node 服务，无 Laravel 侧异步任务），记录为暂缓项
- [x] 顶层 `/healthz` 探针（执行中发现）：旧栈生产冒烟与 compose 健康检查都打 `/healthz`，Laravel 侧此前只有 `/console/health`；api 组内补同语义路由（`{status,db}` + DB 连通探测，DB 不可达 503）
- [x] `console:admin` 生产引导命令（执行中发现）：`console:seed` 生产拒绝（LB-08）后，生产栈缺少首个管理员入口，全量 E2E 演练无法登录；补 CLI 引导命令（创建/轮转 super_admin，argon2id，密码 ≥10 对齐契约、拒绝演示密码；不落审计，与种子同性质并在命令描述里写明）
- [x] `deploy-production.sh`：预检扩至 PHP 栈（`STARTER_SEED_DEMO`、`APP_KEY`/`APP_URL` 等 env 完整性、契约产物门禁、D2 零迁移门禁）；回滚步骤（镜像回退 + 跨栈回退路径写清）
- [x] `compose.ai.prod.yaml` 随栈重构（执行中发现）：AI 客户端随栈切不在 app 进程内，overlay 改为独立 `ai` 服务（观察期复用旧单容器镜像，仅 compose 内网可达）+ `app` 经 `STARTER_NODE_API_URL` 代理；代理上游未配置/不可达时返回 503 `{ error }` 而非 500
- [x] DEPLOYMENT.md 更新：环境变量表（含 PHP 侧）、部署步骤（含首个管理员引导）、回滚

### 验收

- 生产形态在本地用 prod compose 全链路演练：部署 → 全量 E2E（指向 prod 栈）→ 回滚演练，记录证据

### 影响面 / 回滚

Dockerfile.prod、compose.prod、deploy 脚本、DEPLOYMENT.md。

### 完成记录（2026-11-18，commits `d9876f6` feat + `32ff2ee`/`fc8683f` fix）

- **生产形态定稿（D6）**：FrankenPHP 1.13.5-php8.4 单容器多阶段镜像（bun→vite→composer→frankenphp，pdo_pgsql、非 root `www-data`、契约产物/web dist/third_party 同容器分发）；Caddyfile 以 `handle @spa` 分流（实验定稿，坑见下）；`migrate` 一次性服务前置 D2 schema 同步（Drizzle 权威，migrations SQL 优先否则 push）；`console:admin` 补齐生产首个管理员唯一入口。
- **演练事务四腿全绿**：`--check`（新增 APP_KEY/APP_URL/契约产物/D2 零迁移/ATTACHMENT_DISK 门禁）→ 首次部署 → 增量发布 → `--rollback` → 复部署，备份与 accepted-sha 全程落 `.deploy-state/`（已入 `.gitignore`，连同 `.env.production`）。
- **行为验收指向 prod 栈（38150）**：verify 六脚本全绿（easm 对跑按「settings 保留 fixture→rollback 消费→settings --cleanup」的正确阶段序）；Playwright **12/12**；附件 multipart 上传→签名 URL→会话+HMAC 下载 sha256 **字节级 MATCH**→删除→AT 审计；agent 双态：无 overlay 503（故意 5xx 消息透出）/ 有 overlay Laravel→Node 200。证据 `evidence/laravel-ld-03/`（镜像 digest 已存档，演练栈 `down -v` 拆除）。
- **演练抓出九处缺陷（如实，含四处既有）**：① bun frozen 缺 server 清单；② migrate 误触 web 构建（独立 `workspace` stage 修正）；③ Docker COPY 目录摊平（逐目录显式目标）；④ Caddy `try_files` 不吃请求匹配器 + 同类型匹配器被 OR（`handle` 块定稿）；⑤ 镜像落 sqlite（compose 显式 `DB_CONNECTION: pgsql`）；⑥ 镜像烤入宿主 storage 运行态（删 COPY、`.dockerignore` 收口）；⑦ **既有**：改密不吊销旧会话（LC-02 移植把 Hono delete 误写为 count，`32ff2ee` 修复 + 异常 arm 次序对齐）；⑧ **既有**：旧根镜像 CMD 的 varlock cwd 缺陷（overlay `working_dir` 对齐 dev 同构）——旧生产形态从未被真实运行过，本次首跑暴露；⑨ **既有**：Playwright 凭证无视进程 env（`fc8683f` env 优先对齐 verify 约定）。
- **已知边界（如实）**：E2E 脚本 DB 清理假设默认 compose 项目，指非默认栈需 `COMPOSE_PROJECT_NAME`（acceptance 已记操作步骤）；自动回滚（有上一验收版时的激活失败）与真实生产机发布 NOT_RUN（模板仓无生产机，跨栈回退路径已文档化）。
- 顺带清理：删除上会话误存的 `scripts/contracts-pararity.ts` 废稿（typo 文件名 + 旧 fixture 格式，运行即崩；现行实现是已提交的 `contracts-parity.ts`）。

## LD-04 DB 归属决策

### 目标

对 D2 做终局决策并落地：迁移权威保持 Drizzle，或移交 Laravel 迁移体系；无论结论，双轨期结束。

### 前置

LD-02。

### 动作

- [ ] 评估记录（写入 LARAVEL.md 决策表 D2 终态）：方向已定为移交（D2/D8），评估聚焦成本与切换步骤（重放 6 张表 + 附件表基线、drizzle-kit 降级只读、EASM/资产模块 TS 类型链的替代供数方式）
- [ ] 按结论执行：移交则 Laravel 建全量基线迁移（对现有库 `--pretend` 校验无漂移）+ `packages/db` 降级说明；不移交则在 BACKEND.md/PROJECT.md 固化「schema 权威在 Drizzle、Laravel 禁写迁移」并让 gen:module 生成的 Laravel 骨架不含迁移
- [ ] 结论同步 SPEC_ADOPTION.md（若与团队 BACKEND 规范冲突）

### 验收

- 决策有记录、有理由、有证据链接；执行后全量 E2E 绿

### 影响面 / 回滚

按结论涉及 `packages/db`、`apps/api-laravel/database`、BACKEND.md。

## LD-05 旧栈退役与文档收口

### 目标

`apps/server` 删除，全仓文档只剩一套事实；模板派生链路（bootstrap）完整支持新栈。

### 前置

LD-03、LD-04。

### 动作

- [ ] 删除 `apps/server`（观察期问题清单为空为前置）；`compose`/CI/verify 脚本移除旧栈引用；Node AI 服务若保留则独立为 `apps/ai-service`（或等价目录）并补 README
- [ ] `scripts/bootstrap-project.sh`：派生新项目覆盖 composer（name、APP_KEY 生成、端口、cookie/env 隔离、`composer.lock` 刷新）；五端口分配逻辑纳入 PHP 栈
- [ ] 文档收口（按 WORKFLOW 唯一正文表）：AGENTS.md（服务与数据行、按任务读取、技能路由现状）、PROJECT.md（模块表、端口、运行时）、RUNTIME.md（重写为 PHP/Node 双运行时事实）、BACKEND.md（分层、模块、横切）、API_CONVENTIONS.md（回填 Laravel 实现文件）、AUTH.md（会话实现替换）、TESTING.md（命令表）、DEPLOYMENT.md、EASM_REUSE/REUSE/FILTERS 中涉及旧栈路径的引用修正
- [ ] `bun run verify` 与全量 E2E 在收口后的仓上绿；`git grep apps/server` 无残留引用

### 验收

- 全量 E2E + CI 绿；`git grep -r "apps/server"` 仅剩 LARAVEL.md/SPEC_ADOPTION.md 的历史记录引用；bootstrap 派生演练一次成功（证据）

### 影响面 / 回滚

全仓。回滚：本 spec 前的所有提交均可独立回退；删除动作本身保留在独立 commit 便于 revert。
