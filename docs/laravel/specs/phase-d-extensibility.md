# 阶段 D：扩展性建设与收口（LD）

> 出口标准：新模块的开发体验不低于现有单栈（契约一处定义、双端骨架一键生成、横切能力注册即得）；生产部署链路完整；旧栈删除且文档只剩一套事实。

## LD-01 `gen:module` 双轨化

### 目标

`bun run gen:module <slug>` 除现有 TS 侧产出（契约、权限、审计注册、路由/页面骨架）外，同步生成 Laravel 侧模块骨架，实现「契约驱动、双端一次生成」。

### 前置

LC-08。

### 动作

- [ ] 生成物对齐已迁移模块的真实结构：`app/Modules/<Slug>/`（controller、FormRequest（引用 JSON Schema 消费层）、repository/resource）、路由注册片段、`app/Core/Permissions` 目录项
- [ ] 生成器从 `packages/api` 新增 schema 自动进入 `contracts:generate` 名单并提醒重新生成产物（衔接 LA-02/LA-04 门禁）
- [ ] README（`packages/api` 与 `apps/api-laravel`）更新扩展约定：新模块 = 契约 + 权限/审计登记 + 双端骨架 + E2E 场景，缺一不可合并

### 验收

- 空跑一个 `demo-lint` 模块：生成 → `composer analyse` + `bun run check-types` + `contracts:generate` 门禁全绿 → 删除（证据：命令输出）

### 影响面 / 回滚

`scripts/gen-module.mjs`、两个 README。

## LD-02 试点附件模块与 OSS 存储管理

### 目标

用一条真实小需求走完双轨全流程，验证「最大扩展性」承诺，同时落地 D8 的存储管理：**附件模块（attachments）**——Laravel Filesystem 抽象、本地/对象存储双 driver、签名 URL、附件元数据与审计。UI 侧复用 `packages/ui` 已有的 attachment 输入控件。

### 前置

LD-01、LB-07。

### 动作

- [ ] 契约先行：`packages/api` 新增 attachment schema（文件类型/大小白名单进契约、`AUDIT_ACTIONS` 与权限目录**只增不改**地登记 `attachment.*` 与 `attachments:read/manage`）→ `contracts:generate` 产物更新
- [ ] 存储基座：`config/filesystems.php` 双 disk——`local`（开发/测试）与 S3 兼容 OSS disk（生产；阿里云 OSS 走 S3 兼容端点），env 键入共享清单；驱动选型与理由记录 README
- [ ] 端点（按 LARAVEL.md 模块标准开发流程）：上传（服务端代理流式落盘）、列表（分页，经 `PaginatedResource`）、删除（软删或标记，含同事务审计）、签名下载 URL（临时授权，TTL 进契约）
- [ ] 上传策略：MIME/扩展名白名单、大小上限在服务端强制（契约与 PHP 双侧一致），文件名与路径不可信输入处理（对齐 SECURITY.md）
- [ ] E2E：本地 disk 全链路（上传→列表→签名下载→删除→审计）；S3 兼容行为用本地 MinIO 容器对拍验证（**不引入真实云凭证**，密钥不进源码/证据/Docker 环境）
- [ ] 记录每一步耗时与需人工补齐的点，反哺 gen:module 与规范（摩擦点回写对应 spec/README）；试点完成后决定模块去留（保留为示例或删除，理由记录）

### 验收

- 试点模块 E2E 绿；`git diff` 证明对 `app/Core/**` 与 `packages/api` 既有定义**只做新增注册、零修改**
- MinIO 对拍证据（签名 URL 语义、分片/大文件边界按契约上限验证）

### 影响面 / 回滚

新增模块目录、`packages/api` 新增契约、compose 可选 MinIO 服务（测试态）。可整体删除回滚。

### 影响面 / 回滚

新增模块目录（可整体删除）。

## LD-03 生产化与部署预检

### 目标

生产链路完整：Dockerfile.prod PHP 形态（按 LB-02 结论）、compose.prod、部署预检、回滚方案。

### 前置

LC-08。

### 动作

- [ ] `Dockerfile.prod`：Laravel 生产镜像（按 D6 选型：FrankenPHP/Octane 单容器或 fpm 多进程），多阶段构建、不带入源码敏感文件；静态页托管方式维持「单 app 容器同源」或明确分容器并记录理由
- [ ] `compose.prod.yaml` 对齐：`app`（Laravel + 静态页）、`db`、（如启用队列）worker 服务；健康检查与重启策略
- [ ] `deploy-production.sh`：预检扩至 PHP 栈（`STARTER_SEED_DEMO`、env 完整性、产物门禁、迁移状态按 D2 结论）；回滚步骤（镜像回退 + proxy 切回）
- [ ] DEPLOYMENT.md 更新：环境变量表（含 PHP 侧）、部署步骤、回滚
- [ ] 若引入 Laravel 队列/Horizon（复查 D5 触发条件满足时），worker 编排与水位监控并入本 spec 补充条目

### 验收

- 生产形态在本地用 prod compose 全链路演练：部署 → 全量 E2E（指向 prod 栈）→ 回滚演练，记录证据

### 影响面 / 回滚

Dockerfile.prod、compose.prod、deploy 脚本、DEPLOYMENT.md。

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
