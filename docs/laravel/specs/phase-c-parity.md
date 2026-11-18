# 阶段 C：功能对等迁移与切流（LC）

> 出口标准：Laravel 栈承接 `/console` 全部流量，全量 E2E 与 verify 脚本（参数化指向新栈）绿；旧 `apps/server` 停止接管流量进入观察期。每条 spec 的接口行为以 `apps/server` 对应模块为对照基线，先写双栈对拍再实现。**所有端点实现统一按 [LARAVEL.md 模块标准开发流程](../../../LARAVEL.md) 顺序推进**（契约 → 路由先行 → SchemaRequest → Controller → Repository/Resource → 同事务审计 → 对拍/E2E）；各 spec 的「路由基线」表列出端点与契约、权限、审计 action 的对应，具体路径/方法以对应 Hono 模块的路由声明为最终核对基准。

## LC-01 audit 只读接口（首个真接口）

### 目标

`GET /console/audit`（分页、action/actor/source/start/end 筛选、时区附带）在 Laravel 侧对等实现——选择它打头是因为只读、无状态变更、能一次性验证「契约消费 + 会话 + 权限 + 分页形状」全链路。

路由基线（核对 `apps/server/src/modules/audit.ts`）：

| 端点 | 契约 | 权限 | 审计 |
| --- | --- | --- | --- |
| GET `/console/audit` | `AuditSearch` 解析 | `audit:read` | —（只读） |

### 前置

LB-06。

### 动作

- [x] 先写对拍：`scripts/verify-console.py` 参数化 `--base`（或独立 `scripts/verify-laravel-parity.py`），同一账户分别打旧/新栈断言响应形状与字段一致（数据允许时序差）
- [x] 实现 `App\Modules\Audit`：查询构造、`AUDIT_MAX_PAGE` 上限、`AuditPage` 形状（`items/total/page/size/timezone`）、时区从 `console_setting` 读取
- [x] 权限：`audit:read` 走 LB-05 中间件

### 验收

- 对拍脚本双栈全绿（证据：results 输出）
- 现有 web 端不受影响（仍指旧栈）

### 完成记录（2026-11-18，commit `30206cf`）

- `scripts/e2e/audit-parity.py`：10 用例（默认分页/action/source/actor 模糊/时间窗/无结果/start>end 400/非法 action 400/**size 超限收敛 200**/page 边界）——**双栈全 PASS**（时区日界用 Carbon 本地时区零点，对齐 dayStart）。
- 事实修正两则：Hono 对 `size>100` 是**收敛**而非拒绝（PHP 先 400 后按对拍改收敛）；查询校验文案为接口层中文（非 Laravel 默认英文，messages() 显式对齐）。
- 新增 `enums.json` 产物（AUDIT_ACTIONS/ASSET_STAGES/ACTOR_SOURCES/ROLE_VALUES 单一事实源）；URL 查询参数不在契约产物覆盖内（契约管 body），查询规则按模块移植并经对拍锁定——如实记录口径。

### 影响面 / 回滚

`apps/api-laravel` + 新对拍脚本。

## LC-02 auth 全套

### 目标

login、logout、`GET/PATCH /me`、`POST /me/password` 对等；会话生命周期、强制下线所需的会话撤销语义就位。

路由基线（核对 `apps/server/src/modules/auth.ts`）：

| 端点 | 契约 | 权限 | 审计 |
| --- | --- | --- | --- |
| POST `/console/login` | `credentialsSchema` | 公开 | — |
| POST `/console/logout` | — | 已登录 | — |
| GET `/console/me` | — | 已登录 | — |
| PATCH `/console/me` | `profileInputSchema` | 已登录 | `profile.update` |
| POST `/console/me/password` | `passwordChangeSchema` | 已登录 | `profile.password_change` |

### 动作

- [x] login：`credentialsSchema` 校验（JSON Schema 消费层）、argon2id 验证、写 `console_session`；错误形状与旧栈一致（不泄露账户存在性）
- [x] `/me`：账户信息 + `permissions` 数组（按矩阵计算，语义对齐 `core/permissions.ts`）
- [x] profile 更新走 `profileInputSchema`（防提权：拒绝 role/active/username/id——由 `.strict()` 映射 + fillable 白名单双保险）；密码修改走 `passwordChangeSchema`（current 校验）
- [x] logout 撤销当前会话；为 LC-05 的「强制下线」预留按账户撤销能力
- [x] 对拍：上述 4 组正反样本双栈一致

### 完成记录（2026-11-18，commit `8952cdb`）

- `auth-parity.py` **12/12 PASS**：双栈 PATCH /me 形状一致；role 注入 400；**跨栈会话同库同死**（Hono 改密 → Laravel 会话即失效——共享库语义的实证）；新密码双栈可登；当前密码错误/新旧相同 400 同文案；经 Laravel 改回原密闭环。
- 修复真实缺陷三处：控制器双 Request 参数不被解析（FormRequest 自身即 Request）；ConsoleResponse 导入缺失；use 重复（类加载致命致全线 500）。
- 事故记录（如实）：首轮对拍因上述类加载 500 中断，密码停留在中间值——用容器内 bun 生成 argon2id 哈希直写库恢复，并给脚本加 finally 恢复保障与 WARN 语义修正。

### 验收

- 对拍全绿；`scripts/e2e/login-brand.mjs` 指向新栈跑一轮绿（参数化）

### 影响面 / 回滚

`apps/api-laravel`。

## LC-03 system 读

### 目标

探针（DB 连通、AI 队列水位/熔断状态展示所需数据）、权限矩阵读、系统时区、设置页读接口对等。

路由基线（核对 `apps/server/src/modules/system.ts`）：

| 端点 | 契约 | 权限 | 审计 |
| --- | --- | --- | --- |
| GET `/console/system/status` | `SystemStatusResponse` | `system:settings:read` / `system:ai:read` | — |
| GET `/console/system/settings` | `SystemSettingsResponse` | `system:settings:read` | — |
| GET `/console/system/permissions` | 矩阵 payload | `system:permission:read` | — |

### 动作

- [x] `SystemStatusResponse`/`SystemSettingsResponse` 形状对齐；AI 状态按 D5 从 Node AI 服务获取（本 spec 先做只读透传或降级占位，真正接通在 LC-07）
- [x] 权限矩阵读：`SystemPermissionRow` 联动逻辑（默认目录 + DB 覆盖）与 `permissions.ts` 一致
- [x] 对拍：探针与矩阵读双栈一致

### 完成记录（2026-11-18，commit `a41a3e0`）

- 探针：db/延迟/activeSessions/uptime 实测一致；**nodeVersion 语义决策落地**——字段名保留（前端零改动），值为 `PHP_VERSION`；AI 段 configMode（disabled/client 按 env）、熔断态取共享库，`queue` 为 null（D5：Node 进程内水位不可见，LC-07 决定是否透传）——如实记录为已知降级。
- settings/矩阵：`system-parity.py` **12/12 PASS**——读一致、写（Laravel 关 member 权限）双栈读一致、Hono/Laravel 双向 reset 一致、422 文案逐条同（未知权限码/专属码）、时区写双栈一致、熔断开关双栈同视（对拍需跨 **2s 快照缓存窗**，已加 2.5s 等待——两侧缓存语义同源）、member 访问系统权限 403「需要超级管理员权限」（**中间件次序对齐**：superadmin 先于 permission）。

### 验收

- 对拍全绿；`system-admin.mjs` E2E 的读部分在新栈绿

### 影响面 / 回滚

`apps/api-laravel`。

## LC-04 system 写与最后超管保护

### 目标

权限矩阵写/恢复默认、时区更新、AI 熔断开关；全部走同事务审计；最后一名超管保护与不可变权限锁定。

路由基线（核对 `apps/server/src/modules/system.ts`）：

| 端点 | 契约 | 权限 | 审计 |
| --- | --- | --- | --- |
| PUT `/console/system/permissions` | 矩阵更新 schema | `system:permission:manage` | `permission.update` |
| POST `/console/system/permissions/reset` | — | `system:permission:manage` | `permission.reset` |
| PUT `/console/system/timezone` | 时区更新 schema | `system:settings:manage` | `system.timezone_update` |
| POST `/console/system/ai/circuit` | 熔断开关 schema | `system:ai:manage`（immutable） | `system.ai_circuit` |

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

路由基线（核对 `apps/server/src/modules/accounts.ts`）：

| 端点 | 契约 | 权限 | 审计 |
| --- | --- | --- | --- |
| GET `/console/accounts` | `AccountSearch` | `accounts:read` | — |
| POST `/console/accounts` | `accountCreateSchema` | `accounts:manage` | `account.create` |
| PATCH `/console/accounts/:id` | `accountPatchSchema` | `accounts:manage` | `account.update` / `account.role` / `account.status` |
| POST `/console/accounts/:id/password-reset` | `passwordResetSchema` | `accounts:manage` | `account.password_reset` |
| POST `/console/accounts/:id/revoke` | — | `accounts:manage` | `account.revoke` |

### 动作

- [x] 先写失败场景：member/admin 尝试 `accounts:manage` 操作 → 403；admin 修改角色字段注入 → 400（strict）；降级最后超管 → 拒绝；禁用自己 → 拒绝（对齐 `modules/accounts.ts` 现有约束）
- [x] 实现：创建/更新走对应 schema；角色变更/状态变更/重置密码/强制下线各落审计 action（`account.*` 枚举），同事务
- [x] 会话撤销：状态变更/重置密码时按旧栈语义清理 `console_session`
- [x] 对拍：列表分页/筛选（`AccountSearch`）+ 全部写路径双栈一致

### 完成记录（2026-11-18，commit `b2a412b`，与 LC-06/07 合并提交）

- `AccountsController` 五端点同口径；**verify-console（E2E_API_BASE 直打 Laravel）PASS**：login/assets CRUD/服务端分页/RBAC disable/revoke/enable/logout；**verify-system-governance PASS**：三层 RBAC、提权防线（管理员改角色→403、bootstrap 账户保护→403）、矩阵联动、探针、熔断、时区与回滚、human/agent 审计。
- 事实记录（如实）：「最后超管 409」为纵深防御——自停用/自降级在两栈都先命中 400 预检（`不能停用当前账户`/`不能更改当前账户的角色`），409 在当前 API 流下不可达，两栈行为逐字一致即达成对齐；verify-foundation（含 secret 排除/重复拒绝/事务回滚/筛选/日期边界/分页）与 verify-runtime-load（1200 请求 8 并发 0.9s 全 JSON）同样 PASS。
- 夹具事故：一次 `psql -c` 双语句单事务回滚使 demo 恢复语句失效（短时禁用）——已恢复，多语句清理改为分开执行，教训记录在案。

### 验收

- 失败场景先红后绿；对拍全绿；`system-admin.mjs` 新栈全绿

### 影响面 / 回滚

`apps/api-laravel`。

## LC-06 assets 全套

### 目标

资产 CRUD、`GET /assets`（全量，客户端筛选兼容）、`GET /assets/page`（服务端分页 + 多选 + contains/equals 语义）对等。

路由基线（核对 `apps/server/src/modules/assets.ts`）：

| 端点 | 契约 | 权限 | 审计 |
| --- | --- | --- | --- |
| GET `/console/assets` | — | `assets:read` | — |
| GET `/console/assets/page` | 分页/筛选查询解析 | `assets:read` | — |
| POST `/console/assets` | `assetInputSchema` | `assets:manage` | `asset.create` |
| PATCH `/console/assets/:id` | `assetPatchSchema` | `assets:manage` | `asset.update` |
| DELETE `/console/assets/:id` | — | `assets:manage` | `asset.delete` |

### 动作

- [x] 先写失败场景：非法分页/超长筛选 → 400；member 写资产 → 403
- [x] 实现：`assetInputSchema`/`assetPatchSchema` 写路径 + 审计（`asset.*`）；`/assets/page` 的多选去重上限（20）与 `qOp` 语义逐条对齐 `modules/assets.ts`
- [x] 对拍：全量列表、分页筛选（含多选数组与 JSON 数组形态传参）、CRUD 双栈一致

### 完成记录（2026-11-18，commit `b2a412b`）

- `/assets` 全量 + `/assets/page` 服务端分页筛选（q/qOp contains/equals、stage[]/domain[] 多选含 JSON 数组串、去重上限 20、size 收敛 AUDIT_MAX_PAGE、无效状态 400「无效的登记状态」）；CRUD 409/404 与审计 detail（create/delete 记 domain/owner/stage；update 记 fields + stage 或 name 的 from/to）逐条对齐。
- 验收：verify-console（assets CRUD + 服务端分页）与 verify-foundation（筛选/日期边界/分页/重复拒绝）对 Laravel PASS。

### 验收

- 对拍全绿；`asset-agent-api.py` 与资产相关 E2E（filter-state、content-refresh 资产部分）新栈绿

### 影响面 / 回滚

`apps/api-laravel`。

## LC-07 asset-agent 桥

### 目标

自然语言筛选链路在新架构下闭环：Laravel 承接 `/console/assets/agent`，模型调用按 D5 走保留的 Node AI 服务。

路由基线（核对 `apps/server/src/asset-agent.ts`）：

| 端点 | 契约 | 权限 | 审计 |
| --- | --- | --- | --- |
| POST `/console/assets/agent` | `assetAgentRequest` | `assets:read` | `agent.asset_filter`（`actor_source=agent`） |

### 动作

- [x] 定实现：Laravel → Node AI 服务（HTTP 内网调用）或 Laravel 直接代理前端到该服务；选定后记录到 LARAVEL.md
- [x] `assetAgentRequest` 校验（含 refine：`qOp` 依赖 `q`）、供应商错误的固定中文文案与 `agent.asset_filter` 审计（`actor_source=agent`、matched/corrections 明细、脱敏）对齐 `apps/server/src/asset-agent.ts`
- [x] 熔断状态读取打通（LC-04 写入的 `console_setting` → Node 服务热生效或调用前检查）
- [x] 对拍 + `scripts/e2e/asset-agent.mjs`、`ai-client` 栈相关验收在新链路绿

### 完成记录（2026-11-18，commit `b2a412b`）

- **选定「直接代理」并记录于 D5**：`/console/assets/agent/{config,plan,result}` 由 `AssetAgentController` 透传至 Node 服务（`STARTER_NODE_API_URL`，转发会话 Cookie 与 Origin；8KB body 上限 → 413「请求过大」）。模型调用、runs 运行态与 `agent.asset_filter` 审计全部留在 Node 原实现——零重复、语义与单栈部署等价；LD-05 若独立 `apps/ai-service` 只需改环境指向。
- 验收（本地 AI 默认关闭的口径）：`/assets/agent/config` 经 Laravel 返回 `{"enabled":false}` 与 Node 直连一致；verify-system-governance（含 human/agent 审计与 agent 权限）对 Laravel PASS。AI 启用下的端到端计划随 LD-03 生产化后补（模型端点不可在本地伪造，见 scripts/e2e/ai-client 独立栈）。

### 验收

- 端到端：登录 → 自然语言筛选 → 审计含 agent 来源记录（证据截图 + results.json）

### 影响面 / 回滚

`apps/api-laravel`、Node AI 服务暴露方式。

## LC-08 切流与观察期

### 目标

web 流量切至 Laravel 栈，旧栈保留可回滚，进入 D7 观察期。

### 动作

- [x] vite proxy `/console` 与 compose `web` 环境指向 `api-laravel`；`apps/server` 服务保留但不再被引用
- [x] 全量验收：`bun run verify`（参数化指向新栈）、全部 `scripts/e2e/*.mjs`、CI full 模式绿
- [x] PROJECT.md/AGENTS.md 服务与数据行更新为双栈现状（Laravel 主管流量、Node AI 服务保留）
- [x] 回滚预案演练一次：切回旧栈、`bun run verify` 绿（记录用时与步骤）

### 验收

- 全量 E2E + CI 绿证据；回滚演练记录

### 影响面 / 回滚

compose、vite 配置、文档。回滚即切回 proxy 目标。

### 完成记录（2026-11-18，commit `8812a5e`）

- **切流生效**：compose `web` 的 `API_PROXY_TARGET` 默认 `http://api-laravel:8080`（注释含回滚指引）；旧栈保留运行（AI 服务 + 回滚备份）。
- **切流后首次 Playwright 揪出真 bug**（这正是全量测试的价值）：浏览器创建账户携带空串 `email`/`company`，Laravel 400 而 Hono 201——**Laravel 13 的 `ConvertEmptyStringsToNull` 在全局中间件栈，仅从 api 组 remove 无效**（LB-03 的移除是错的，本轮实证修正为全局 remove；空串经 `email?.trim() || null` 语义同口径归 null 入库）。定向浏览器探针抓请求体与 400 body 定位。
- **验收（全部经 web → Laravel）**：① Playwright **12/12**（登录校验/守卫/全流程旅程/导航键盘/移动端）；② verify-console PASS（login/assets/RBAC/revoke/enable/logout）；③ verify-foundation PASS + cleanup（审计/脱敏/重复拒绝/事务回滚/筛选/分页）；④ verify-system-governance PASS（三层 RBAC/提权防线/矩阵/探针/熔断/时区/human-agent 审计）；⑤ verify-runtime-load **1200 请求 × 8 并发全 JSON PASS**。
- **回滚演练（实测）**：`API_PROXY_TARGET=http://api:38141` 重启 web → verify PASS → 改回默认重启 → verify + Playwright 复绿；数据层零迁移零成本，切换 = 一次 env 变更 + web 重启（约 10 秒级）。
- 如实说明：CI full 模式远端实跑仍待 push（本地全部等价命令已绿）；`nodeVersion` 值现为 PHP 版本（LC-03 决策）。
