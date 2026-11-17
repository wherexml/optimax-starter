# 阶段 C：功能对等迁移与切流（LC）

> 出口标准：Laravel 栈承接 `/console` 全部流量，全量 E2E 与 verify 脚本（参数化指向新栈）绿；旧 `apps/server` 停止接管流量进入观察期。每条 spec 的接口行为以 `apps/server` 对应模块为对照基线，先写双栈对拍再实现。

## LC-01 audit 只读接口（首个真接口）

### 目标

`GET /console/audit`（分页、action/actor/source/start/end 筛选、时区附带）在 Laravel 侧对等实现——选择它打头是因为只读、无状态变更、能一次性验证「契约消费 + 会话 + 权限 + 分页形状」全链路。

### 前置

LB-06。

### 动作

- [ ] 先写对拍：`scripts/verify-console.py` 参数化 `--base`（或独立 `scripts/verify-laravel-parity.py`），同一账户分别打旧/新栈断言响应形状与字段一致（数据允许时序差）
- [ ] 实现 `App\Modules\Audit`：查询构造、`AUDIT_MAX_PAGE` 上限、`AuditPage` 形状（`items/total/page/size/timezone`）、时区从 `console_setting` 读取
- [ ] 权限：`audit:read` 走 LB-05 中间件

### 验收

- 对拍脚本双栈全绿（证据：results 输出）
- 现有 web 端不受影响（仍指旧栈）

### 影响面 / 回滚

`apps/api-laravel` + 新对拍脚本。

## LC-02 auth 全套

### 目标

login、logout、`GET/PATCH /me`、`POST /me/password` 对等；会话生命周期、强制下线所需的会话撤销语义就位。

### 动作

- [ ] login：`credentialsSchema` 校验（JSON Schema 消费层）、argon2id 验证、写 `console_session`；错误形状与旧栈一致（不泄露账户存在性）
- [ ] `/me`：账户信息 + `permissions` 数组（按矩阵计算，语义对齐 `core/permissions.ts`）
- [ ] profile 更新走 `profileInputSchema`（防提权：拒绝 role/active/username/id——由 `.strict()` 映射 + fillable 白名单双保险）；密码修改走 `passwordChangeSchema`（current 校验）
- [ ] logout 撤销当前会话；为 LC-05 的「强制下线」预留按账户撤销能力
- [ ] 对拍：上述 4 组正反样本双栈一致

### 验收

- 对拍全绿；`scripts/e2e/login-brand.mjs` 指向新栈跑一轮绿（参数化）

### 影响面 / 回滚

`apps/api-laravel`。

## LC-03 system 读

### 目标

探针（DB 连通、AI 队列水位/熔断状态展示所需数据）、权限矩阵读、系统时区、设置页读接口对等。

### 动作

- [ ] `SystemStatusResponse`/`SystemSettingsResponse` 形状对齐；AI 状态按 D5 从 Node AI 服务获取（本 spec 先做只读透传或降级占位，真正接通在 LC-07）
- [ ] 权限矩阵读：`SystemPermissionRow` 联动逻辑（默认目录 + DB 覆盖）与 `permissions.ts` 一致
- [ ] 对拍：探针与矩阵读双栈一致

### 验收

- 对拍全绿；`system-admin.mjs` E2E 的读部分在新栈绿

### 影响面 / 回滚

`apps/api-laravel`。

## LC-04 system 写与最后超管保护

### 目标

权限矩阵写/恢复默认、时区更新、AI 熔断开关；全部走同事务审计；最后一名超管保护与不可变权限锁定。

### 动作

- [ ] 先写失败场景（E2E/对拍）：降级自己导致无超管 → 拒绝；改 `system:permission:*`/`system:ai:manage`（immutable）→ 拒绝；时区非法值 → 400
- [ ] 实现写路径：LB-06 审计写入器落 `permission.update`/`permission.reset`/`system.timezone_update`/`system.ai_circuit`，`actor_source=human`
- [ ] 熔断开关写 `console_setting` 并使 Node AI 服务可见（共享库；LC-07 打通读取）
- [ ] 对拍全绿

### 验收

- 失败场景全部先红后绿；对拍全绿（证据）

### 影响面 / 回滚

`apps/api-laravel`。

## LC-05 accounts 全套

### 目标

账户 CRUD、角色调整、启停、重置密码、强制下线；三层防提权与最后超管保护对等。

### 动作

- [ ] 先写失败场景：member/admin 尝试 `accounts:manage` 操作 → 403；admin 修改角色字段注入 → 400（strict）；降级最后超管 → 拒绝；禁用自己 → 拒绝（对齐 `modules/accounts.ts` 现有约束）
- [ ] 实现：创建/更新走对应 schema；角色变更/状态变更/重置密码/强制下线各落审计 action（`account.*` 枚举），同事务
- [ ] 会话撤销：状态变更/重置密码时按旧栈语义清理 `console_session`
- [ ] 对拍：列表分页/筛选（`AccountSearch`）+ 全部写路径双栈一致

### 验收

- 失败场景先红后绿；对拍全绿；`system-admin.mjs` 新栈全绿

### 影响面 / 回滚

`apps/api-laravel`。

## LC-06 assets 全套

### 目标

资产 CRUD、`GET /assets`（全量，客户端筛选兼容）、`GET /assets/page`（服务端分页 + 多选 + contains/equals 语义）对等。

### 动作

- [ ] 先写失败场景：非法分页/超长筛选 → 400；member 写资产 → 403
- [ ] 实现：`assetInputSchema`/`assetPatchSchema` 写路径 + 审计（`asset.*`）；`/assets/page` 的多选去重上限（20）与 `qOp` 语义逐条对齐 `modules/assets.ts`
- [ ] 对拍：全量列表、分页筛选（含多选数组与 JSON 数组形态传参）、CRUD 双栈一致

### 验收

- 对拍全绿；`asset-agent-api.py` 与资产相关 E2E（filter-state、content-refresh 资产部分）新栈绿

### 影响面 / 回滚

`apps/api-laravel`。

## LC-07 asset-agent 桥

### 目标

自然语言筛选链路在新架构下闭环：Laravel 承接 `/console/assets/agent`，模型调用按 D5 走保留的 Node AI 服务。

### 动作

- [ ] 定实现：Laravel → Node AI 服务（HTTP 内网调用）或 Laravel 直接代理前端到该服务；选定后记录到 LARAVEL.md
- [ ] `assetAgentRequest` 校验（含 refine：`qOp` 依赖 `q`）、供应商错误的固定中文文案与 `agent.asset_filter` 审计（`actor_source=agent`、matched/corrections 明细、脱敏）对齐 `apps/server/src/asset-agent.ts`
- [ ] 熔断状态读取打通（LC-04 写入的 `console_setting` → Node 服务热生效或调用前检查）
- [ ] 对拍 + `scripts/e2e/asset-agent.mjs`、`ai-client` 栈相关验收在新链路绿

### 验收

- 端到端：登录 → 自然语言筛选 → 审计含 agent 来源记录（证据截图 + results.json）

### 影响面 / 回滚

`apps/api-laravel`、Node AI 服务暴露方式。

## LC-08 切流与观察期

### 目标

web 流量切至 Laravel 栈，旧栈保留可回滚，进入 D7 观察期。

### 动作

- [ ] vite proxy `/console` 与 compose `web` 环境指向 `api-laravel`；`apps/server` 服务保留但不再被引用
- [ ] 全量验收：`bun run verify`（参数化指向新栈）、全部 `scripts/e2e/*.mjs`、CI full 模式绿
- [ ] PROJECT.md/AGENTS.md 服务与数据行更新为双栈现状（Laravel 主管流量、Node AI 服务保留）
- [ ] 回滚预案演练一次：切回旧栈、`bun run verify` 绿（记录用时与步骤）

### 验收

- 全量 E2E + CI 绿证据；回滚演练记录

### 影响面 / 回滚

compose、vite 配置、文档。回滚即切回 proxy 目标。
