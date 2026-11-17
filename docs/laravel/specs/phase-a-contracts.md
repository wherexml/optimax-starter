# 阶段 A：契约与规范基线（LA）

> 出口标准：`bun run contracts:generate` 产出完整 JSON Schema 与 refine 清单，CI 门禁生效，全部通过 `check-types` 与既有 E2E；现有运行时零变更。阶段内不创建任何 PHP 代码。

## LA-01 实体接口提升为 Zod schema

### 目标

`packages/api/src/contracts.ts` 中仅存在为 TS `interface`/`type` 的实体（`Account`、`Asset`、`AuditEntry`、`PaginatedResult<T>`、`AuthProviderInfo` 及各 Search 类型）提升为 Zod schema，经 `z.infer` 导出同名类型，使**响应形状**也进入可生成范围（当前只有输入 schema 可生成）。前端消费方零改动。

### 前置

无。

### 动作

- [ ] 逐个将实体改写为 `z.object`/`z.looseObject` 形式并 `export type X = z.infer<...>`；可选字段用 `.optional()`，`AuditDetail` 保持宽松（`z.record(z.unknown())` 级别）
- [ ] `PaginatedResult<T>` 用函数或泛型工厂保持现有泛型用法兼容；`AuditPage`/`AssetPage` 等组合类型不破坏现有 import
- [ ] 全仓 `bun run check-types` 通过；`apps/web` 与 `apps/server` 的消费点不改一行
- [ ] 确认提升后 schema 能被 `z.toJSONSchema()` 表达（不使用 date/bigint/transform 等不可表示类型）

### 验收

- `bun run check-types` 全绿（证据：命令输出）
- 既有 E2E 任选 3 个（login-brand、system-admin、asset-agent-api）仍绿，证明契约行为未变

### 影响面 / 回滚

仅 `packages/api`。revert 单个 commit 即回滚。

## LA-02 `contracts:generate` 生成链

### 目标

新增根脚本 `contracts:generate`：从 `packages/api` 的全部公开 schema 生成 JSON Schema 产物（draft-2020-12），落盘 `packages/api/json-schema/`，作为 PHP 侧唯一消费物。

### 前置

LA-01。

### 动作

- [ ] 新建 `packages/api/src/generate.ts`（或 scripts 下脚本）：集中登记导出的 schema 名单（输入 schema + LA-01 实体 schema + `asset-agent`/`permissions`/`system` 全部），调用 `z.toJSONSchema()` 逐个输出
- [ ] 产物命名与目录约定：`packages/api/json-schema/<module>.<SchemaName>.json`，附带一份 `index.json` 清单（schema 名、来源文件、zod 版本、生成时间戳）
- [ ] 根 `package.json` 增加脚本；`postinstall` 不自动执行（产物必须显式生成并提交）
- [ ] 验证 `.strict()` 映射为 `additionalProperties: false`、枚举/中文 label（经 `.meta()`）按预期出现在产物中

### 验收

- `bun run contracts:generate` 幂等（二次执行无 diff）
- 产物包含 6 处已知 refine 所在 schema（LA-03 处理其语义丢失）

### 影响面 / 回滚

`packages/api`（新增产物目录与脚本）。`.gitignore` 不忽略产物（产物必须入库供 PHP 消费）。

## LA-03 refine 清单机制

### 目标

`z.toJSONSchema()` 会丢弃 `.refine()` 语义（已知 6 处：邮箱格式、patch 至少一字段 ×3、权限矩阵约束、agent `qOp` 依赖 `q`）。建立机制让这些语义**显式登记、可被 PHP 侧发现与对照**，不静默丢失。

### 前置

LA-02。

### 动作

- [ ] 在 `packages/api/src/refines.ts` 建立登记表：每条 refine 记录 schema 名、字段路径、语义描述（中文）、跨语言规则建议（如「PHP 侧 required_without_all」）
- [ ] `contracts:generate` 同时产出 `json-schema/refines.json`（由登记表序列化）
- [ ] 将现有 6 处 refine 全部登记；后续新增 refine 必须登记（写进 `packages/api/README.md` 扩展约定）

### 验收

- `refines.json` 含 6 条记录且与源码 grep 结果一致（对拍命令写入 spec 执行记录）

### 影响面 / 回滚

同 LA-02。

## LA-04 契约 CI 门禁

### 目标

CI 增加「产物过期即失败」门禁：任何人改 `packages/api/src` 而未重新生成产物，`ci-scope` 判定为 full/light 均拦截。

### 前置

LA-02。

### 动作

- [ ] CI 增加 step：`bun run contracts:generate && git diff --exit-code -- packages/api/json-schema`，失败信息提示重新生成
- [ ] `scripts/ci-scope.mjs`：`packages/api/**` 与 `packages/api/json-schema/**` 不一致视为应用变更（触发 full）
- [ ] TESTING.md 命令表登记该门禁与本地自检命令

### 验收

- 故意改一处 schema 不重新生成，CI（或本地等价命令）失败；恢复后绿（证据保存）

### 影响面 / 回滚

`.github/workflows/ci.yml`、`scripts/ci-scope.mjs`、TESTING.md。

## LA-05 规范落地与偏差记录

### 目标

契约桥成为正式规范：唯一正文与偏差记录就位，后续 spec 依据其执行。

### 前置

LA-04。

### 动作

- [ ] API_CONVENTIONS.md 新增「共享契约与 JSON Schema 桥」章节：权威在 Zod、生成命令、产物位置、refine 登记约定、PHP 消费方义务（LB-03 落地后回填实现文件链接）
- [ ] SPEC_ADOPTION.md 记偏差：跨端契约由「同语言类型直通」调整为「Zod 单源 + JSON Schema 生成物 + refine 清单」，理由（路线 A 选型）、证据（生成链文件）、复查触发（Zod 大版本或 toJSONSchema 行为变化）
- [ ] AGENTS.md「按任务读取」表登记 LARAVEL.md 入口行（若本 spec 与总纲提交同批，确认链接有效）

### 验收

- 文档链接全部可达（`git diff --check` + 人工核对链接目标存在）

### 影响面 / 回滚

纯文档。API_CONVENTIONS.md、SPEC_ADOPTION.md、AGENTS.md。
