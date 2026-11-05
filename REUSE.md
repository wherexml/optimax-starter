# 基础能力复用状态

2026-11-05 按 Steve 要求检查本机项目源码。操作日志、组合筛选、快捷导航已完成接入；页面错误恢复仍为候选。

| 优先级 | 能力 | 已核对来源 | 对脚手架的用途 | 适配范围 |
| --- | --- | --- | --- | --- |
| 1 | 操作日志 | RiskOps 的 src/pages/admin/AuditLog.tsx、packages/api/src/services/audit.service.ts、packages/api/src/routers/audit.ts | 追踪账户创建、改名、角色变更、启停、密码重置与强制下线，可按人、动作、时间筛选 | 复用列表与数据契约思路；tRPC 接口适配 Hono，UUID 改为当前账户 ID，角色校验由服务端执行，事件与写操作同事务保存，密码及会话值不进入日志 |
| 1 | 组合筛选与筛选记忆 | Skylance EASM 的 src/components/filter/、src/hooks/usePersistedFilters.ts | 账户与台账共享筛选配置、已选条件、清空与刷新后的恢复 | 保留当前 URL 优先级，持久化按登录账户和页面隔离，排除临时跳转条件，移除来源组件的渐变与强制 600ms 等待 |
| 1 | 页面错误恢复 | RiskOps 的 src/components/common/ErrorBoundary.tsx | 页面渲染异常时保留外壳，提供重试 | 接到路由内容边界，避免向用户暴露原始错误与数据，只留必要状态及恢复操作 |
| 2 | 快捷导航搜索 | OptiONE 的 packages/views/search/search-command.tsx | 用快捷键跳转工作台、台账、账户管理 | 抽取命令面板交互，适配 TanStack Router，按当前角色提供入口，去掉来源项目专属搜索 API 和 AI 模块 |

验收证据见 evidence/foundation/。日志由真实账户操作产生，组合筛选覆盖台账和账户列表，快捷导航根据角色提供页面入口。

## 已集成模块（2026-11-05）

| 模块 | 来源 | Starter 落点 | 取舍 |
| --- | --- | --- | --- |
| 操作日志 | RiskOps AuditLog.tsx / audit.service.ts / routers/audit.ts | `console_audit`、`GET /console/audit`、`features/audit/AuditPage.tsx` | 把 tRPC 改为 Hono；记录操作人和对象当时的信息；与账户变更同事务写入 |
| 组合筛选 | EASM FilterComponent / usePersistedFilters.ts | `components/filters/FilterBar.tsx`、`hooks/usePersistedFilters.ts` | 去掉强制 600ms 延迟和渐变；按账户和页面分别保存；URL 中的筛选优先 |
| 快速导航 | OptiONE search-command.tsx | `features/navigation/QuickNav.tsx` | 只跳转本地页面，按角色过滤；不接产品专属 AI 或数据接口 |

2026-11-05 二次对照 EASM：筛选改为动态条件行，支持增加、删除、切换未使用字段，草稿统一应用。此阶段仅有单选；资产台账现已补齐多选和操作符，当前契约见 FILTERS.md。新验收见 `evidence/dynamic-filters/`。

## EASM 工作台、用户菜单、个人设置（2026-11-05）

- EASM 工作台、用户菜单、个人设置：见 [EASM_REUSE.md](./EASM_REUSE.md)。

## EASM 多选与文本匹配方式（资产台账）

- 来源：EASM `components/filter/FilterItem.tsx`（enum 用多选，text 有包含/等于）与 `components/ui/multi-select.tsx`。
- 落点：`FilterBar` 中逐字段开启（`multi`、`operatorKey`），目前只在 `/assets` 开启；约定见 [FILTERS.md](./FILTERS.md)。
