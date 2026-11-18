# Laravel 后端迁移总纲

> 本文件是「用 Laravel 替换 Hono 后端、实现完整功能并保证扩展性」这一工程的唯一计划与索引：决策记录、阶段/spec 索引与完成状态、执行流程。各事实的最终正文按 [WORKFLOW.md 文档职责表](./WORKFLOW.md#文档职责与唯一维护位置)落到对应领域文档；本文件只维护迁移期的计划与状态。确立日期 2026-11-17，工作分支 `feat/laravel-backend`。

## 目标与边界

- 目标：`apps/api-laravel`（Laravel 13，PHP ≥8.3）承接现有 `apps/server` 的全部功能（auth、accounts、assets、audit、system、asset-agent 桥），协议、安全不变量与 E2E 验收全部对等；`apps/server` 在观察期后退役。
- 边界：前端 `apps/web` 与共享 UI 不做架构变更；`/console` 前缀、`{ error }` 错误形状、`PaginatedResult` 分页形状、401 跳转语义保持不变；数据库沿用现有 PostgreSQL 实例与数据。
- 完成标准（整个工程）：LC 阶段全部 spec 完成 + 全量 E2E 绿 + 旧栈下线（LD-05）+ 文档收口。

## 决策记录

| ID | 决策 | 内容 | 状态 |
| --- | --- | --- | --- |
| D1 | 契约权威 | `packages/api` 的 Zod 保持单一源；CI 用 Zod 4 原生 `z.toJSONSchema()` 生成 JSON Schema 产物供 PHP 消费（路线 A）；refine 语义用清单登记、PHP 显式补规则 | 已定（Steve 授权） |
| D2 | DB 归属 | 渐进期 Drizzle 保持 schema 与迁移权威，Laravel 零迁移、只建 Eloquent 模型；终局方向为移交 Laravel 迁移体系（migrations/Seeders/Factories，充分利用其数据管理），LD-04 验证无漂移后执行 | 已定方向，LD-04 落地 |
| D3 | 会话 | 自定义 SessionHandler 复用 `console_session` 表（迁移期数据连续，不强制下线）；argon2id 参数对齐现有 PHC（m=65536,t=2,p=1）；cookie 名与生命周期沿用 `SESSION_COOKIE_NAME` 与 8h | 已定 |
| D4 | CSRF | `/console` JSON API 组不引入 CSRF token（同源 BFF + cookie SameSite + JSON-only；沿用现状）；跨域消费方出现时复查 | 已定，LB-05 论证 |
| D5 | AI 模块 | 现有 Node AI 客户端（`apps/server/src/core/ai`）保留为独立可选服务，不移植 Laravel；asset-agent 由 Laravel 代理或直连该服务（LC-07 定实现）；触发统一队列治理时复查 | 已定 |
| D6 | 运行时形态 | 本地 compose 用 php-fpm；生产单容器形态（FrankenPHP/Octane vs fpm）在 LB-02 小规模验证后定，原则是贴合现「单 app 容器」部署边界 | 待 LB-02 定 |
| D7 | 退役策略 | 双栈并行至 LC 全绿；切流后旧 `apps/server` 进入观察期，LD-05 才删除；观察期内 compose/CI 不拆 | 已定 |
| D8 | 数据与存储形态 | 充分利用 Laravel 数据生态：Eloquent 关系预载/Cast/Scope/API Resource、Cache；存储用 Laravel Filesystem 抽象（本地 driver 开发与测试、S3 兼容 OSS driver 生产、签名 URL），附件能力作为扩展性试点模块落地（LD-02） | 已定（Steve 要求） |

## 阶段与 spec 索引

状态只在下表维护；spec 文件内不重复状态字段。

| 阶段 | spec | 标题 | 前置 | 状态 |
| --- | --- | --- | --- | --- |
| A | [LA-01](./docs/laravel/specs/phase-a-contracts.md) | 实体接口提升为 Zod schema | — | ✅ 5d14e17（浏览器 E2E 由 Playwright 套件覆盖） |
| A | [LA-02](./docs/laravel/specs/phase-a-contracts.md) | `contracts:generate` 生成链 | LA-01 | ✅ laravel/la-02-contracts-generate（22 schema 产物） |
| A | [LA-03](./docs/laravel/specs/phase-a-contracts.md) | refine 清单机制 | LA-02 | ✅ laravel/la-03-refine-manifest（6 条 + 漂移对拍） |
| A | [LA-04](./docs/laravel/specs/phase-a-contracts.md) | 契约 CI 门禁 | LA-02 | ✅ laravel/la-04-ci-gate（ci.yml + ci-scope 回归 9/9） |
| A | [LA-05](./docs/laravel/specs/phase-a-contracts.md) | 规范落地与偏差记录 | LA-04 | ✅ laravel/la-05-spec-adoption（Phase A 收口） |
| B | [LB-01](./docs/laravel/specs/phase-b-foundation.md) | Laravel 项目骨架与静态门禁 | LA-04 | 未开始 |
| B | [LB-02](./docs/laravel/specs/phase-b-foundation.md) | 运行时形态验证与 compose 接入 | LB-01 | 未开始 |
| B | [LB-03](./docs/laravel/specs/phase-b-foundation.md) | JSON Schema 消费层与错误协议 | LB-01 | 未开始 |
| B | [LB-04](./docs/laravel/specs/phase-b-foundation.md) | Eloquent 对接现有表 | LB-02 | 未开始 |
| B | [LB-05](./docs/laravel/specs/phase-b-foundation.md) | 会话与认证底座 | LB-04 | 未开始 |
| B | [LB-06](./docs/laravel/specs/phase-b-foundation.md) | 安全不变量移植 | LB-05 | 未开始 |
| B | [LB-07](./docs/laravel/specs/phase-b-foundation.md) | Laravel 数据管理特性接入 | LB-04 | 未开始 |
| B | [LB-08](./docs/laravel/specs/phase-b-foundation.md) | 演示种子移植 | LB-04 | 未开始 |
| C | [LC-01](./docs/laravel/specs/phase-c-parity.md) | audit 只读接口（首个真接口） | LB-06 | 未开始 |
| C | [LC-02](./docs/laravel/specs/phase-c-parity.md) | auth 全套 | LB-06 | 未开始 |
| C | [LC-03](./docs/laravel/specs/phase-c-parity.md) | system 读 | LC-01 | 未开始 |
| C | [LC-04](./docs/laravel/specs/phase-c-parity.md) | system 写与最后超管保护 | LC-03 | 未开始 |
| C | [LC-05](./docs/laravel/specs/phase-c-parity.md) | accounts 全套 | LC-04 | 未开始 |
| C | [LC-06](./docs/laravel/specs/phase-c-parity.md) | assets 全套 | LC-05 | 未开始 |
| C | [LC-07](./docs/laravel/specs/phase-c-parity.md) | asset-agent 桥 | LC-06 | 未开始 |
| C | [LC-08](./docs/laravel/specs/phase-c-parity.md) | 切流与观察期 | LC-01..07 | 未开始 |
| D | [LD-01](./docs/laravel/specs/phase-d-extensibility.md) | `gen:module` 双轨化 | LC-08 | 未开始 |
| D | [LD-02](./docs/laravel/specs/phase-d-extensibility.md) | 试点附件模块与 OSS 存储管理 | LD-01、LB-07 | 未开始 |
| D | [LD-03](./docs/laravel/specs/phase-d-extensibility.md) | 生产化与部署预检 | LC-08 | 未开始 |
| D | [LD-04](./docs/laravel/specs/phase-d-extensibility.md) | DB 归属决策 | LD-02 | 未开始 |
| D | [LD-05](./docs/laravel/specs/phase-d-extensibility.md) | 旧栈退役与文档收口 | LD-03、LD-04 | 未开始 |

## spec 执行流程

每个 spec 独立交付，按以下流程逐项完成：

1. 从上表取第一个「未开始」且前置已完成的 spec；自 `feat/laravel-backend` 切分支 `laravel/<spec-id>-<slug>`。
2. 读 spec 正文与前置 spec 的产出；执行中发现影响面新增时，先补 spec 再动代码。
3. 按 spec 动作清单实施；遵循 [WORKFLOW.md](./WORKFLOW.md) 计划四要素与项目核心约束（E2E-first、审计同事务、不虚构完成）。
4. 按 spec 验收节跑真实命令与 E2E，证据按 [TESTING.md](./TESTING.md) 保存；验收未全绿不得标记完成。
5. 完成时：勾选 spec 内动作清单，更新上表状态并附 commit/证据链接；涉及唯一正文文档（API_CONVENTIONS/AUTH/BACKEND/DEPLOYMENT/TESTING/PROJECT）同步更新，不在 spec 内长期存放正文事实。
6. 与团队规范冲突处记 [SPEC_ADOPTION.md](./SPEC_ADOPTION.md) 偏差（含理由、证据、负责人、复查触发条件）。
7. 硬约束：Phase C 完成前旧 `apps/server` 及其 E2E 全程可用；任何 spec 不得使 main 不可发布。

## 模块标准开发流程

> 本节是 Laravel 侧新增或迁移**任何端点**的唯一开发套路（LD-05 收口时迁入 BACKEND.md 作为正式正文）。LC/LD 各 spec 的实现必须按此顺序推进并分步提交，禁止跳步或合并大提交。

1. **契约先行**：确认 `packages/api` 已有（或先补）该端点的输入 schema 与响应类型；跑 `bun run contracts:generate` 更新产物，否则 LA-04 门禁拦截。
2. **路由**：在模块路由文件声明 `METHOD /console/<path>`，挂会话认证与 `permission:<code>` 中间件；端点先于实现存在（先建路由返回 501/占位，再填实现）。
3. **请求层**：FormRequest 继承 `SchemaRequest` 基类，绑定契约 schema 名——JSON Schema 消费层自动校验 + refine 补规则，业务代码不重复写校验。
4. **控制器**：Controller 方法只做编排（入参 → Repository/Service → Resource），不写查询、不写业务规则。
5. **数据层**：Repository 用 Eloquent 组查询（关系预载、Scope、Cast 见 LB-07）；写路径一律 `DB::transaction` 包裹。
6. **响应层**：API Resource 保证实体形状与契约一致；分页统一走 `PaginatedResource`（`items/total/page/size` 唯一实现处）。
7. **审计**：写路径经审计写入器同事务落 `console_audit`（action 枚举 + `actor_source` + 递归脱敏），只读路径不落。
8. **验证**：双栈对拍（迁移期）→ E2E 场景 → `composer analyse` + `bun run check-types`；证据按 TESTING.md 保存。

## 扩展性设计原则

- 契约驱动：新模块从 `packages/api` 的 Zod 契约出发，`gen:module` 双轨生成 TS 契约注册与 Laravel 骨架（LD-01），两端不手写重复定义。
- 横切即基础设施：权限（`requirePermission` 语义 → middleware）、审计（同事务 + 脱敏 → observer/中间件）、契约校验（JSON Schema 消费层）对新模块注册即得，不在业务代码里重复。
- 分层同构：Laravel 侧 `App\Core\`（guards/audit/permissions/system-settings 对应物）与 `App\Modules\`（auth/accounts/assets/audit/system）映射现有结构，前端/后端模块命名一一对应。
- 双栈可对拍：`verify-*.py` 与 E2E 全部参数化 `baseUrl`，迁移期同一脚本可打旧栈与新栈对拍，切流后自动只打新栈。
- 配置对齐：TS 侧 varlock `.env.schema` 与 Laravel `.env` 的共享键维护单一清单（LB-01 建立），新增变量按 [WORKFLOW.md](./WORKFLOW.md) 同步 `.env.example` 与部署文档。

## 总体风险与回滚

- 最大风险集中在 LB-05（会话）与 LC-04/05（权限写路径与防提权）：均要求对拍 E2E 先行（先写失败场景再实现）。
- 每个 spec 独立分支独立提交；切流（LC-08）前所有变更均可通过 compose 切回旧栈回滚，数据层因 D2 零迁移而无回滚成本。
- 契约保真风险由 LA-03/LA-04 的 refine 清单与 CI 门禁兜底；任何 schema 变更未重新生成产物即 CI 失败。
