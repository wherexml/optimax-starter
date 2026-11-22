# 系统配置（`/system`）

承接管理员与超管的系统运行探针、全局系统时区基础配置与后台任务状态。遵循「左侧导航最多二级、第三级移至内容区顶部多 Tab」规范，页面通过共享组件 `PageTabs`（`@/components/ui/page-tabs`，底层基于 `@ui-sdk/react/tabs` 与 `.page-tabs`）承载平级面板，后台任务列表使用 `DataTable` + 标准 `FilterBar` 进行状态与类型筛选。

## 标签与接口契约

共享类型与校验位于 [packages/api/src/system.ts](../../../../../packages/api/src/system.ts)，服务端实现位于 [apps/server/src/core/system-settings.ts](../../../../server/src/core/system-settings.ts) 与 [apps/server/src/modules/system.ts](../../../../server/src/modules/system.ts)：

| 标签参数 | 面板 | 查看权限 | 维护权限 | 对应接口 |
| --- | --- | --- | --- | --- |
| `?tab=status`（默认） | 运行状态 | `system:settings:read` / `system:ai:read` | 只读探针 | `GET /console/system/status` |
| `?tab=settings` | 基础配置 | `system:settings:read` | `system:settings:manage` | `GET /console/system/settings`、`PUT /console/system/settings` |
| `?tab=jobs` | 后台任务 | `jobs:read` | `jobs:read` | `GET /console/jobs` |

- **公开浅探针与管理深探针分离**：匿名 `GET /healthz` 仅返回 `{ status, db }` 供容器与部署冒烟使用；`GET /console/system/status` 在鉴权后返回 PostgreSQL `SELECT 1` 毫秒级延迟、当前未过期会话数、进程运行时长、Node 版本，严禁返回数据库连接串、模型 URL 或凭证值。
- **后端 AI 熔断接口兼容保留**：服务端 `PATCH /console/system/ai-circuit`（`system:ai:manage`）与 `ai.enabled` 持久化契约继续保留供治理接口与自动化测试调用，控制台界面不再展示 AI 客户端与熔断开关卡片。
- **全局系统时区与权限徽章**：维护 `console_setting`（`key = "timezone"`，默认回退 `STARTER_TIMEZONE` / `APP_TIMEZONE` / `Asia/Shanghai`），右上角按当前有效权限区分 `可维护` 与 `只读` 徽章；更新后 `/audit` 的时间戳格式化与自然日筛选区间即时按新时区生效。
- **单视图降级**：若某角色仅拥有其中一个面板的查看权限，自动省略单标签栏直接展示对应面板。

## 验收

- HTTP 与回滚门禁：`python3 scripts/verify-system-governance.py`
- 隔离模型熔断拦截：`python3 scripts/e2e/ai-client/run.py --only token,security`（`S7`）
- 浏览器桌面与 `375px` 窄屏验收：`scripts/e2e/system-admin.mjs`
