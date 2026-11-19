# 阶段 A：契约与规范基线（LA）

> 出口标准：`bun run contracts:generate` 产出完整 JSON Schema 与 refine 清单，CI 门禁生效，全部通过 `check-types` 与既有 E2E；现有运行时零变更。阶段内不创建任何 PHP 代码。

## LA-01 实体接口提升为 Zod schema

### 目标

`packages/api/src/contracts.ts` 中仅存在为 TS `interface`/`type` 的实体（`Account`、`Asset`、`AuditEntry`、`PaginatedResult<T>`、`AuthProviderInfo` 及各 Search 类型）提升为 Zod schema，经 `z.infer` 导出同名类型，使**响应形状**也进入可生成范围（当前只有输入 schema 可生成）。前端消费方零改动。

### 前置

无。

### 动作

- [x] 逐个将实体改写为 `z.object`/`z.looseObject` 形式并 `export type X = z.infer<...>`；可选字段用 `.optional()`，`AuditDetail` 保持宽松（`z.record(z.unknown())` 级别）
- [x] `PaginatedResult<T>` 用函数或泛型工厂保持现有泛型用法兼容；`AuditPage`/`AssetPage` 等组合类型不破坏现有 import
- [x] 全仓 `bun run check-types` 通过；`apps/web` 与 `apps/server` 的消费点不改一行
- [x] 确认提升后 schema 能被 `z.toJSONSchema()` 表达（不使用 date/bigint/transform 等不可表示类型）

### 验收

- `bun run check-types` 全绿（证据：命令输出）
- 既有 E2E 任选 3 个（login-brand、system-admin、asset-agent-api）仍绿，证明契约行为未变

### 完成记录（2026-11-17，commit `5d14e17`，分支 `laravel/la-01-entity-schemas`）

- 实现：`Account`/`Asset`/`AuditEntry`/`AuthProviderInfo`/三个 Search 类型提升为 zod schema + `z.infer`；`PaginatedResult` 保留手写泛型并新增 `paginatedResultSchema` 工厂 + `paginatedShapeLock` 编译期一致性锁；`assetPageSchema`/`auditPageSchema` 导出供 LA-02 生成。**偏差说明**：`AuditDetail` 未提升——它是服务端构造辅助类型（响应路径 `AuditEntry.detail` 已是 `Record<string, unknown>`），保留精确键约束价值更高，宽松性在响应侧已成立。
- 验证（`evidence/la-01/verification.txt`，本地不入库）：① 全仓 `check-types` 绿；② `z.toJSONSchema` 可表达性 9/9 PASS；③ `bun run verify`（verify-console.py 打运行中容器栈，api 容器热加载本分支源码）PASS：healthz/匿名守卫/login/资产 CRUD+服务端分页/RBAC/禁用/强制下线/启用/登出。**勘误（2026-11-18）：①的结论当时被 zsh 管道退出码遮蔽，api 包实际存在 TS6133（`ActorSource` 未用导入），已在 LA-02 分支修复并复验全绿，详见 LA-02 完成记录。**
- NOT_RUN 及原因：login-brand.mjs、system-admin.mjs 需 Ego TaskSpace 浏览器 task 环境（本会话无此 harness）；asset-agent-api.py 前置为 AI 筛选启用（默认关闭、需真实模型端点）。浏览器 E2E 待环境可用时补跑，不阻塞 LA-02（本次改动为类型级，运行时 schema 集未变）。
- 补充（2026-11-17）：浏览器 E2E 缺口已由新增的 Playwright 套件覆盖（`bun run test:e2e:pw`，12/12 连续两轮绿，含登录/守卫/全流程旅程/导航键盘与移动端），证据与范围见 [scripts/e2e/playwright/README.md](../../../scripts/e2e/playwright/README.md)。asset-agent-api 仍依赖 AI 启用，保持 NOT_RUN。

### 影响面 / 回滚

仅 `packages/api`。revert 单个 commit 即回滚。

## LA-02 `contracts:generate` 生成链

### 目标

新增根脚本 `contracts:generate`：从 `packages/api` 的全部公开 schema 生成 JSON Schema 产物（draft-2020-12），落盘 `packages/api/json-schema/`，作为 PHP 侧唯一消费物。

### 前置

LA-01。

### 动作

- [x] 新建 `packages/api/src/generate.ts`（或 scripts 下脚本）：集中登记导出的 schema 名单（输入 schema + LA-01 实体 schema + `asset-agent`/`permissions`/`system` 全部），调用 `z.toJSONSchema()` 逐个输出
- [x] 产物命名与目录约定：`packages/api/json-schema/<module>.<SchemaName>.json`，附带一份 `index.json` 清单（schema 名、来源文件、zod 版本、生成时间戳）
- [x] 根 `package.json` 增加脚本；`postinstall` 不自动执行（产物必须显式生成并提交）
- [x] 验证 `.strict()` 映射为 `additionalProperties: false`、枚举/中文 label（经 `.meta()`）按预期出现在产物中

### 验收

- `bun run contracts:generate` 幂等（二次执行无 diff）
- 产物包含 6 处已知 refine 所在 schema（LA-03 处理其语义丢失）

### 完成记录（2026-11-18，分支 `laravel/la-02-contracts-generate`）

- 实现：`packages/api/src/generate.ts` registry 登记 **22 个 schema**（contracts 17 / permissions 1 / system 2 / asset-agent 2），`z.toJSONSchema` 输出 22 个 `<module>.<SchemaName>.json` + `index.json`（名单、来源、Zod 版本）；根脚本 `bun run contracts:generate`；产物入库、`postinstall` 不自动执行。
- 验收实测：① 幂等——连续执行零 diff（两次运行 `git status` 无产物变更）；② `.strict()` → `additionalProperties: false`（accountCreate / assetAgentFilters / systemPermissionsUpdate 抽查）；③ 枚举在产物中（`role: [member, admin, super_admin]`、stage 中文枚举 anyOf）；④ 6 处 refine 所在 schema 全部在产物中。
- 偏差两处：**index.json 不含生成时间戳**——幂等性（验收硬性要求）与时间戳互斥，取确定性输出，产物版本时间以 git 历史为准；**中文 label 经 `.meta()` 暂未挂载**——现有标签在独立常量表（`ROLE_LABELS` 等），挂载推迟到 LB-03（PHP 错误渲染消费时），枚举值本身已按预期出现。
- 附带修复与勘误：LA-01 在 `contracts.ts` 遗留未使用的 `type ActorSource` 导入（TS6133），**且 LA-01 完成记录中「全仓 check-types 绿」的结论当时被 zsh 管道退出码遮蔽（`${PIPESTATUS}` 为 bash 语法），实际 api 包未通过**。本分支已移除该导入，并以逐 workspace 退出码复验：db / api / ui / server / web 全部 `Exited with code 0`。LA-01 其余证据（`z.toJSONSchema` 9/9、verify-console PASS、Playwright 12/12×3）不受影响。
- 行为验证：`bun run verify`（verify-console.py）PASS（healthz/守卫/login/资产 CRUD+分页/RBAC/停用启用/登出）——生成器为新增脚本，运行时契约未触碰。

### 影响面 / 回滚

`packages/api`（新增产物目录与脚本）。`.gitignore` 不忽略产物（产物必须入库供 PHP 消费）。

## LA-03 refine 清单机制

### 目标

`z.toJSONSchema()` 会丢弃 `.refine()` 语义（已知 6 处：邮箱格式、patch 至少一字段 ×3、权限矩阵约束、agent `qOp` 依赖 `q`）。建立机制让这些语义**显式登记、可被 PHP 侧发现与对照**，不静默丢失。

### 前置

LA-02。

### 动作

- [x] 在 `packages/api/src/refines.ts` 建立登记表：每条 refine 记录 schema 名、字段路径、语义描述（中文）、跨语言规则建议（如「PHP 侧 required_without_all」）
- [x] `contracts:generate` 同时产出 `json-schema/refines.json`（由登记表序列化）
- [x] 将现有 6 处 refine 全部登记；后续新增 refine 必须登记（写进 `packages/api/README.md` 扩展约定）

### 验收

- `refines.json` 含 6 条记录且与源码 grep 结果一致（对拍命令写入 spec 执行记录）

### 完成记录（2026-11-18，分支 `laravel/la-03-refine-manifest`）

- 实现：`src/refines.ts` 登记 6 条（`email-format` / `account-patch-nonempty` / `profile-update-nonempty` / `asset-patch-nonempty` / `permission-roles-nonempty` / `agent-qop-requires-q`），含受影响 schema、字段路径、源码行、中文语义、Zod 文案与 Laravel 等价规则建议；`generate.ts` 输出 `refines.json` 并新增**漂移对拍**——扫描四个源文件的 `.refine(` 调用数与登记数硬性相等，不等即生成失败。
- 验收实测：① 对拍命令 `grep -c "\.refine(" packages/api/src/{contracts,permissions,system,asset-agent}.ts` = 4+1+0+1 = 6，与 `refines.json` 的 count=6 一致；② **漂移拦截实证**——临时在 `passwordResetSchema` 追加未登记 refine，`contracts:generate` 以 code 1 失败并给出登记指引，还原后恢复输出；③ 幂等（二次执行零修改）；④ api 包 `tsc --noEmit` exit=0（正确捕获退出码）；⑤ `bun run verify` PASS（生成器与登记表为新增，运行时未触碰）。
- 文案口径说明：4 处「至少一字段」refine 在源码中未自定义 message（Zod 默认），登记表如实标注，并注明接口层的既有中文错误（如「无效的账户变更」）——PHP 侧（LB-03）渲染以登记表 message 字段 + 接口层文案为准。

### 影响面 / 回滚

同 LA-02。

## LA-04 契约 CI 门禁

### 目标

CI 增加「产物过期即失败」门禁：任何人改 `packages/api/src` 而未重新生成产物，`ci-scope` 判定为 full/light 均拦截。

### 前置

LA-02。

### 动作

- [x] CI 增加 step：`bun run contracts:generate && git diff --exit-code -- packages/api/json-schema`，失败信息提示重新生成
- [x] `scripts/ci-scope.mjs`：`packages/api/**` 与 `packages/api/json-schema/**` 不一致视为应用变更（触发 full）
- [x] TESTING.md 命令表登记该门禁与本地自检命令

### 验收

- 故意改一处 schema 不重新生成，CI（或本地等价命令）失败；恢复后绿（证据保存）

### 完成记录（2026-11-18，分支 `laravel/la-04-ci-gate`）

- 实现：ci.yml `quality` job 在依赖安装后新增「Contract artifacts are up to date」step（重新生成 + `git diff --exit-code`，失败提示运行 `contracts:generate` 并提交产物；step 无任何不可信输入注入面）；`ci-scope.mjs` 显式将 `packages/api/src/**` 与 `packages/api/json-schema/**` 归为 application（强制 full）；`ci-scope-e2e.mjs` 新增两个回归场景（契约源+产物变更 → full、仅产物变更 → full），回归共 9 场景全 PASS；TESTING.md 静态检查命令行登记门禁。
- 验收实测（本地等价命令）：① 结构性漂移（username max 64→60）→ 重新生成后产物 diff 非空 → 门禁退出码 1 拦截，还原后退出码 0；② `node scripts/e2e/ci-scope-e2e.mjs` 9/9 PASS。
- 覆盖口径说明（如实）：错误**文案**改动不触发产物 diff——JSON Schema 不含 message 字符串，属预期设计；文案一致性由 `refines.ts` 登记与 LB-03 PHP 渲染层共同保证，不在本门禁范围。

### 影响面 / 回滚

`.github/workflows/ci.yml`、`scripts/ci-scope.mjs`、TESTING.md。

## LA-05 规范落地与偏差记录

### 目标

契约桥成为正式规范：唯一正文与偏差记录就位，后续 spec 依据其执行。

### 前置

LA-04。

### 动作

- [x] API_CONVENTIONS.md 新增「共享契约与 JSON Schema 桥」章节：权威在 Zod、生成命令、产物位置、refine 登记约定、PHP 消费方义务（LB-03 落地后回填实现文件链接）
- [x] SPEC_ADOPTION.md 记偏差：跨端契约由「同语言类型直通」调整为「Zod 单源 + JSON Schema 生成物 + refine 清单」，理由（路线 A 选型）、证据（生成链文件）、复查触发（Zod 大版本或 toJSONSchema 行为变化）
- [x] AGENTS.md「按任务读取」表登记 LARAVEL.md 入口行（若本 spec 与总纲提交同批，确认链接有效）

### 验收

- 文档链接全部可达（`git diff --check` + 人工核对链接目标存在）

### 完成记录（2026-11-18，分支 `laravel/la-05-spec-adoption`）

- API_CONVENTIONS.md §3 新增「共享契约与 JSON Schema 桥（跨语言消费）」小节（权威源、生成命令、产物约定、语义口径、漂移拦截），§13 契约变更同步清单增加「契约产物必须随代码重新生成提交」义务；SPEC_ADOPTION.md 偏差表新增 API_CONVENTIONS.md §3 行（做法/理由/证据/负责人/复查触发齐全）；AGENTS.md 的 LARAVEL.md 入口行已于总纲提交批次登记，链接实测可达。
- 验收：`git diff --check` 通过；偏差行引用的 5 个链接目标逐一存在。
- **Phase A 至此全部完成**（LA-01..05）：契约基线就绪，路线 A 的 TS 侧（生成、登记、门禁、规范）闭环，PHP 消费从 LB-03 开始。

### 影响面 / 回滚

纯文档。API_CONVENTIONS.md、SPEC_ADOPTION.md、AGENTS.md。
