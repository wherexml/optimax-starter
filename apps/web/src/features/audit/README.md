# 操作日志（`/audit`）

提供统一的人机操作审计查询，覆盖账户生命周期、权限矩阵调整、系统时区、登录有效期与网页端 AI 模型配置/清空、AI 熔断配置、资产写操作以及 AI 自然语言代理操作。认证与审计总览见 [AUTH.md](../../../../../AUTH.md)。

## 组成与契约

服务端写入与查询位于 [apps/server/src/core/audit.ts](../../../../server/src/core/audit.ts) 与 [apps/server/src/modules/audit.ts](../../../../server/src/modules/audit.ts)，前端实现位于 [AuditPage.tsx](./AuditPage.tsx)：

- **同事务落库与敏感键递归脱敏**：所有管理写接口与 AI 代理操作统一调用 `recordAudit(tx, ...)`，在写入前对 `detail` 递归脱敏敏感键（`password`、`passwordHash`、`token`、`secret`、`apiKey`、`authorization`、`cookie`、`credential` 等统一替换为 `[REDACTED]`）。
- **人机双源归因（`actor_source`）**：每条审计记录明确标记 `human`（人工操作）、`agent`（Agent 代理操作）或 `system`（系统任务），列表与顶部 `FilterBar` 支持按来源过滤，并以 COSS 状态徽章区分。
- **动态全局系统时区对齐**：日志列表展示时间戳及 `dateFrom / dateTo` 自然日边界自动读取 [系统配置](../system/README.md) 维护的全局系统时区（默认 `Asia/Shanghai`），修改系统时区后无需发版即可即时对齐跨时区查询口径。
- **只读查看与抽屉切换**：需要 `audit:read` 权限，不开放人工编辑或删除接口；表格工具栏右侧接入纯图标 `TableExportMenu` 支持导出当前页 CSV，右侧 `DetailDrawer` 左下角支持「上一个 / 下一个」逐条翻阅详情。

## 验收

- HTTP 与回滚门禁：`python3 scripts/verify-system-governance.py`、`python3 scripts/e2e/ai-client/run.py --only security`
- 浏览器 E2E：`scripts/e2e/system-admin.mjs`
