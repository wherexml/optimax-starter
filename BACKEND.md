# OptiMax 团队后端工程规范

> 本文件是 OptiMax 团队后端最佳实践 spec。它参考团队成熟项目的当前实现抽象而来：TypeScript + Hono/tRPC + Drizzle + PostgreSQL + Redis/BullMQ + Session-first 是内部企业工具的一种推荐参考栈，但本文件不绑定语言和框架。Go、TypeScript、Python 或其他后端都必须满足同等的分层、契约、权限、数据和验收要求。
>
> 团队通用红线（不提交密钥/token/运行态数据、生产默认只读、前端隐藏入口≠权限、真实数据优先等）以 [AGENTS.md 核心约束](./AGENTS.md#核心约束) 为唯一正文，本文件不再重述，只补充后端领域细则。

---

## 1. 参考实现边界

| 内容 | 团队推荐 | 可替换条件 |
| --- | --- | --- |
| Web 框架 | 按项目类型选择，内部 TypeScript API 可优先 Hono/tRPC | 项目更适合 FastAPI、NestJS、Go、Django、Next API 或已有成熟基础 |
| 数据库 | PostgreSQL | 项目明确适合 SQLite/MySQL/云数据库 |
| ORM/查询 | Drizzle / sqlc / 参数化 SQL | 必须可迁移、可审计、避免字符串拼 SQL |
| 队列 | Redis + BullMQ / 等价任务队列 | 长任务必须有状态、重试、超时、失败原因 |
| 认证 | Session-first | JWT/OAuth/SSO 必须解决撤销、过期和审计 |
| 共享契约 | Zod/shared schemas/OpenAPI | 前后端不能各写一套漂移类型 |

可复用的是工程行为，不是某个项目的业务表、端口、账号或部署路径。

---

## 2. Web 框架选型规则

Web 框架不要只按流行度或性能跑分选择，应优先看项目形态、团队熟悉度、API 契约、部署方式和长期维护成本。

### 推荐决策顺序

1. 先确认项目主语言：团队已有代码、招聘和维护能力优先于新鲜技术。
2. 再确认 API 类型：内部 Web、外部开放 API、Agent/Worker、数据/AI 服务、后台管理不是同一种后端。
3. 再确认复杂度：轻量 BFF、复杂领域服务、强后台管理、长任务系统需要不同框架能力。
4. 最后确认运维方式：serverless、容器、systemd、Kubernetes、边缘运行时对框架选择有影响。

### 框架选择矩阵

| 场景 | 推荐选择 | 适合原因 | 谨慎点 |
| --- | --- | --- | --- |
| TypeScript 内部 Web API / BFF | Hono + tRPC | 轻量、类型复用好、适合企业工具和前端强协作 | 复杂领域服务要补清楚模块、事务、队列和测试边界 |
| TypeScript 大型模块化后端 | NestJS | 模块、依赖注入、守卫、中间件、测试组织更完整 | 不适合小项目过度工程化；要统一 DTO、错误和权限 |
| Python AI / 数据服务 / 快速 API | FastAPI | Pydantic、OpenAPI、异步支持好，适合模型、数据和脚本生态 | 复杂后台管理和权限体系要额外设计 |
| Python 管理后台 / 强 CRUD | Django + DRF | ORM、Admin、权限和后台生态成熟 | 不适合只做轻量 BFF；前后端契约要避免漂移 |
| Go 高并发服务 / 基础设施服务 | Go + Chi/Gin/Echo | 部署简单、性能稳定、适合长生命周期服务 | 需要明确 schema、错误、鉴权和迁移工具 |
| Next.js 小型全栈应用 | Next Route Handlers / Server Actions | 适合轻量 BFF、表单提交和页面强耦合逻辑 | 不建议承载复杂核心后端、长任务或多服务边界 |
| 已有 Express/Koa/Flask 项目 | 沿用并补齐规范 | 迁移成本低，先补分层、鉴权、错误和测试 | 新项目不默认选择，除非团队已有稳定模板 |

### 默认建议

- 新的 TypeScript 企业工具，如果后端主要服务内部 Web、需要前后端共享类型，默认从 `Hono + tRPC` 开始。
- 如果项目会变成多人长期维护的大型领域后端，优先评估 `NestJS`，避免后期补模块化成本太高。
- 如果核心能力围绕 AI、数据处理、模型服务、Python 脚本生态，优先评估 `FastAPI`。
- 如果需要内置管理后台、强 CRUD、权限和运营配置，优先评估 `Django + DRF`。
- 如果是高并发、低依赖、长期运行的基础设施服务，优先评估 `Go + Chi/Gin/Echo`。
- `Next API` 只适合页面附近的轻量 BFF，不作为复杂核心后端的默认选择。

### 选型必须写清

复制本文件到项目后，必须在事实卡或项目文档里写清：

- 为什么选择当前 Web 框架。
- 它主要承载哪类 API。
- 如何做输入校验、错误码、鉴权、租户隔离和审计。
- 如何生成或共享前后端契约。
- 如何运行接口级 E2E / smoke、隔离测试（如有）和生产健康检查。
- 什么情况下需要拆出独立后端或换框架。

---

## 3. 适用范围

以下情况必须读取并项目化本文件：

- 项目有后端 API、数据库、文件上传、Webhook、后台任务、Agent 服务或第三方集成。
- 项目需要多人维护、生产部署、演示环境或客户交付。
- 项目已有 `AGENTS.md`，但后端分层、认证、权限、错误和数据口径没有写清楚。

纯静态页面、一次性脚本可以标记为「不适用」，但只要后续出现 API 或数据写入，就要补齐本文件。

---

## 4. 后端事实卡

复制到项目后，先补齐这张表。内容必须来自真实代码、配置、脚本和运行态。API 风格与实时通道见 [API_CONVENTIONS.md](./API_CONVENTIONS.md)，认证方案见 [AUTH.md](./AUTH.md)；本地健康检查 URL 见 [PROJECT.md](./PROJECT.md)，此处只补充覆盖范围。

| 项 | 内容 |
| --- | --- |
| 后端语言/运行时 | <!-- Go / Node.js / Bun / Python / 其他 --> |
| Web 框架 | <!-- Hono / NestJS / FastAPI / Django / Chi / Gin / Next API / 其他 --> |
| 数据库 | <!-- PostgreSQL / MySQL / SQLite / 其他 --> |
| ORM/查询方式 | <!-- Drizzle / sqlc / SQLAlchemy / 参数化 SQL / 其他 --> |
| 缓存/队列 | <!-- Redis / BullMQ / Celery / 内存队列 / 无 --> |
| 文件存储 | <!-- 本地 uploads / S3 / MinIO / 无 --> |
| 后台任务 | <!-- 队列名、worker、cron、补跑入口 --> |
| 健康覆盖范围 | <!-- 存活、就绪、依赖；实现文件 --> |

---

## 5. 推荐后端结构

TypeScript 项目推荐：

```text
packages/api/
├── src/
│   ├── index.ts / server.ts       # 服务入口
│   ├── router/ or routes/         # Hono/REST 路由、health、upload、webhook
│   ├── routers/                   # tRPC/domain routers
│   ├── trpc/                      # context、procedure、中间件
│   ├── services/                  # 业务服务
│   ├── repositories/ or db/       # 数据访问、schema、迁移
│   ├── middleware/                # 鉴权、错误、日志、限流
│   ├── queues/ or jobs/           # 队列、worker、cron
│   ├── lib/                       # auth、redis、logger、外部客户端
│   └── utils/                     # 小型纯工具
├── scripts/                       # 迁移、造数、补跑、一次性脚本
└── tests/                         # 接口级 E2E；隔离测试仅限实现前先写失败用例

packages/shared/
├── src/
│   ├── schemas/                   # 输入输出 schema
│   ├── enums.ts                   # 枚举
│   ├── errors.ts                  # 错误类/错误码
│   ├── permissions.ts             # 权限矩阵
│   └── state-machines/            # 状态机
```

其他语言项目也要保持同等职责分层：

- FastAPI：`routers/`、`schemas/`、`services/`、`repositories/`、`jobs/`、`tests/`。
- NestJS：按 domain module 分 `controller`、`service`、`repository`、`dto`、`guard`、`test`。
- Go：按 domain 分 `handler`、`service`、`repository`、`model`、`middleware`、`cmd`、`internal`。
- Django：按 app 分 `views`、`serializers`、`services`、`models`、`tasks`、`permissions`、`tests`。

---

## 6. 分层规则

| 层级 | 职责 | 禁止事项 |
| --- | --- | --- |
| Router / Handler | 协议适配、鉴权入口、参数解析、响应组装 | 直接写复杂业务规则或拼 SQL |
| Procedure / Controller | API 动作编排、调用 Service、处理事务边界 | 绕过校验直接写库 |
| Service | 业务规则、状态流转、跨表协调、外部系统编排 | 读取前端状态或依赖 UI 文案 |
| Repository / Storage | 数据查询、写入、锁、分页、排序、唯一性约束 | 暴露未隔离的全表查询 |
| Schema / DTO | 输入输出校验、字段口径、枚举、状态机 | 前后端各写一套互相漂移 |
| Worker / Job | 异步任务、重试、超时、进度、人工补跑 | 长任务阻塞请求线程 |
| Shared | 权限、错误码、状态机、业务枚举 | 混入项目私密配置或运行态数据 |

### 推荐调用链

```text
Request
-> Middleware/Auth/Context
-> Router/Procedure
-> Schema validation
-> Service
-> Repository/External client/Queue
-> Audit log
-> Response
```

---

## 7. API 入口与 Procedure 分级

内部 Web 应用推荐强类型 API，并保留 REST 入口处理 health、upload、webhook、OAuth callback 等原生 HTTP 场景。

Procedure 至少分三级：

| 类型 | 用途 | 要求 |
| --- | --- | --- |
| `publicProcedure` | 登录、注册、公开配置、健康类轻入口 | 仍要限流和输入校验 |
| `protectedProcedure` | 登录用户可访问 | 必须有有效 session/user |
| `tenantProcedure` | 多组织/多项目数据 | 必须从服务端 context 注入租户 |
| `adminProcedure` | 管理员操作 | 必须校验角色、资源权限和审计 |

即使项目不用 tRPC，也要保留同等分级。

---

## 8. 数据、租户与状态机

- 所有多人、多组织、多项目系统必须有清晰租户字段，例如 `org_id`、`workspace_id`、`project_id`。
- 租户字段来自服务端 session/context，不允许前端传什么就信什么。
- 所有列表、详情、更新、删除都必须带租户条件；详情接口不能只按 `id` 查询。
- 唯一约束优先写成租户内唯一，例如 `(org_id, code)`。
- 新表、新字段、新索引必须有迁移；迁移文件要能在空库和已有库上稳定执行。
- 生产迁移先做备份；具体执行、兼容与恢复步骤统一见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
- 禁止字符串拼接 SQL，使用 ORM、查询构造器或参数化查询。
- 写接口必须校验权限、业务状态、幂等性和并发冲突。
- 造数脚本必须可重复执行，并写清会覆盖、清理或保留哪些数据。
- 运行态数据库、日志、上传文件、缓存 dump、客户数据不得提交（通用红线见 [AGENTS.md 核心约束](./AGENTS.md#核心约束)）。

状态变化必须集中：

- 用状态机、集中函数或 Service 方法表达可流转动作。
- 不允许多个接口各自直接写状态字段。
- 状态流转失败要返回稳定业务错误码。
- 高风险状态变化要写审计日志。

---

## 9. 输入校验与共享类型

- 所有输入必须经过 schema/DTO 校验，不能只靠 TypeScript 类型、Go struct 或前端表单。
- 字段口径要写在 schema 旁边：日期、金额、百分比、分页、排序、枚举、状态。
- 业务枚举、错误码、权限码、状态机应放在共享包或共享目录。
- 前端需要的类型优先从后端契约生成或复用共享 schema，避免手写重复类型。
- 共享类型可以被前端读取，但不能包含服务端密钥、内部路径或生产配置。

---

## 10. 错误、日志与审计

错误返回遵循 [API_CONVENTIONS.md](./API_CONVENTIONS.md)。后端内部日志可以详细，但给前端和用户的错误必须稳定、可解释、不可泄露。

必须做到：

- 业务错误有稳定 `code`，不是只返回自由文本。
- 参数错误返回字段级信息，方便前端定位表单问题。
- 未知错误生产环境统一收敛，不暴露 SQL、堆栈、路径、密钥、第三方完整原始响应。
- 请求日志包含 method、path、status、duration、requestId、userId/orgId（如有），不记录密码、token、密钥。
- 管理员操作、登录失败、权限失败、导出、删除、Webhook、后台补跑必须写审计日志。

审计日志最低字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 审计记录 ID |
| `org_id` / `workspace_id` | 租户范围 |
| `user_id` | 操作者，系统任务可为空但要写 actor 类型 |
| `action` | 例如 `user.login_failed`、`report.export` |
| `resource` / `resource_id` | 被操作对象 |
| `metadata` | JSON，写口径，不写密钥 |
| `ip_address` | 可用时记录 |
| `created_at` | UTC 时间 |

---

## 11. 后台任务与实时进度

长任务必须异步化。请求线程只负责创建任务、返回任务 ID、提供状态查询。

任务规范：

- 队列名使用稳定短横线命名，例如 `report-generate`。
- 每类任务定义超时、并发、重试次数、退避策略、成功/失败保留时间。
- 任务 payload 必须包含租户 ID、发起人、资源 ID、幂等 key。
- 任务状态至少包含：`queued`、`running`、`succeeded`、`failed`、`cancelled`。
- 记录开始/结束时间、状态、错误原因和可追踪日志；失败要说明可重试性与下一步建议。
- 定时任务写清时区、计划、告警、重试和人工补跑方式；复杂任务提供专题文档入口。
- 必须提供人工补跑入口，补跑要写审计日志。
- 前端需要实时进度时，使用 SSE、WebSocket、subscription 或轮询，并说明断线恢复策略。

---

## 12. 文件、Webhook 与外部系统

### 文件

- 上传必须鉴权。
- 必须限制大小、扩展名和 MIME 类型；不能只信 MIME。
- 存储文件名使用随机 ID，不使用用户上传原名作为真实路径。
- HTML、SVG、Office、PDF 预览要按安全等级处理；HTML 预览必须 sandbox。
- 下载和预览都要重新鉴权，不能只靠隐藏 URL。

### Webhook

- 生产环境 Webhook 必须有 secret、签名、时间戳或来源白名单。
- Webhook 入库要幂等，使用外部 ID 做去重。
- 原始 payload 可以保存，但必须避免写入密钥和过量个人数据。
- 外部系统失败要有重试上限和降级路径。

### 外部 API / AI

- 所有外部调用必须有超时。
- 关键外部调用必须有重试、熔断或明确失败展示。
- AI 输出必须保留来源、数据时间、模型或工作流版本。
- 不能把旧快照冒充最新事实。

---

## 13. 健康检查与运行态

最少提供三个层级：

| 入口 | 用途 | 内容 |
| --- | --- | --- |
| `/health` | 综合健康 | 服务状态、版本、uptime、数据库、缓存、关键依赖 |
| `/ready` | 是否可接流量 | 数据库和必要依赖可用 |
| `/live` | 进程是否存活 | 轻量返回，不依赖外部服务 |

如果项目目前只有 `/health`，事实卡里要写明覆盖范围；生产前再补 `/ready` 和 `/live`。

生产排查默认只读，优先看健康检查、日志、队列表、任务状态、最近部署和关键页面。

---

## 14. 测试与验收

验证命令、环境和证据唯一维护在 [TESTING.md](./TESTING.md)。

> 测试策略和验收证据字段以 [TESTING.md](./TESTING.md) 为准：行为验收以 E2E 为首选机制，禁止实现完成后补写单元测试，确需隔离测试时先写失败用例。本节只补充后端检查项。

后端变更完成前至少检查：

- [ ] API 输入都有 schema/DTO 校验。
- [ ] 读写接口都做了服务端鉴权和租户隔离。
- [ ] 错误返回符合 `API_CONVENTIONS.md`。
- [ ] 新表/字段/索引有迁移。
- [ ] 造数或补跑脚本可重复执行。
- [ ] 后台任务有状态、重试、超时、失败原因。
- [ ] 高风险操作写了审计日志。
- [ ] 健康检查覆盖本次新增依赖。
- [ ] 前端调用方、共享类型和 API 契约同步。
- [ ] 在真实运行的服务上跑过接口级 E2E 或代表性 smoke（含错误和权限路径），并按 TESTING.md 记录证据；构建只算静态检查。



---

## 15. 常见错误

- 只改 router，不改 service 或状态机，导致业务规则散落。
- 只因为某个项目用了 Hono、FastAPI 或 Go，就把它当成所有新项目默认答案。
- 小项目一上来用重框架，长期没有复杂模块却承担维护成本。
- 复杂业务后端继续堆轻量 handler，最后事务、权限、错误和测试散在各处。
- 前端传 `orgId`，后端直接信任。
- 详情接口只按 `id` 查，造成越权风险。
- 用自由文本错误代替稳定错误码。
- 长任务放在请求线程里，页面只能盲等。
- 文件下载只靠隐藏 URL，不重新鉴权。
- 写了造数脚本但不能重复执行。
- 文档描述的是规划，真实代码已经不是那套架构。
