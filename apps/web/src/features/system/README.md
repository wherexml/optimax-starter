# 系统配置（`/system`）

承接管理员与超管的系统运行探针、全局系统时区与登录会话有效期配置、以及后台任务状态。遵循「左侧导航最多二级、第三级移至内容区顶部多 Tab」规范，页面通过共享组件 `PageTabs`（`@/components/ui/page-tabs`，底层基于 `@ui-sdk/react/tabs` 与 `.page-tabs`）承载平级面板，后台任务列表使用 `DataTable` + 标准 `FilterBar` 进行状态与类型筛选。

## 标签与接口契约

共享类型与校验位于 [packages/api/src/system.ts](../../../../../packages/api/src/system.ts)，服务端实现位于 [apps/server/src/core/system-settings.ts](../../../../server/src/core/system-settings.ts) 与 [apps/server/src/modules/system.ts](../../../../server/src/modules/system.ts)：

| 标签参数 | 面板 | 查看权限 | 维护权限 | 对应接口 |
| --- | --- | --- | --- | --- |
| `?tab=status`（默认） | 运行状态 | `system:settings:read` / `system:ai:read` | 只读探针 | `GET /console/system/status` |
| `?tab=settings` | 基础配置 | `system:settings:read` | `system:settings:manage` | `GET /console/system/settings`、`PUT /console/system/settings` |
| `?tab=jobs` | 后台任务 | `jobs:read` | `jobs:read` | `GET /console/jobs` |

- **公开浅探针与管理深探针分离**：匿名 `GET /healthz` 仅返回 `{ status, db }` 供容器与部署冒烟使用；`GET /console/system/status` 在鉴权后返回 PostgreSQL `SELECT 1` 毫秒级延迟、当前未过期会话数、进程运行时长、Node 版本，并在运行状态卡片联动展示当前生效系统时区与登录会话有效期；严禁返回数据库连接串、模型 URL 或凭证值。
- **后端 AI 熔断接口兼容保留**：服务端 `PATCH /console/system/ai-circuit`（`system:ai:manage`）与 `ai.enabled` 持久化契约继续保留供治理接口与自动化测试调用，控制台界面不再展示 AI 客户端与熔断开关卡片。
- **基础配置双栏对称布局与统一「应用」**：`?tab=settings` 第一行采用等高双栏卡片分别配置「时间与区域设置」与「登录与会话有效期」，第二行全宽卡片配置「AI 模型配置」；所有未应用更改由 [settings-controller.ts](./settings-controller.ts) 统一聚合脏状态、校验与顺序提交，右上角 `PageHeader` 集中展示 `重置` 与主按钮 **`应用`**（支持 `Cmd/Ctrl + S`）一次提交并弹出单次提示，并基于 `.content` 容器查询（`.cq-grid-2`、`.cq-kpi-4`）自适应窄容器布局；无 `system:settings:manage` 权限时禁用输入并隐藏动作按钮。
- **全局系统时区选择**：维护 `console_setting`（`key = "timezone"`，默认回退 `STARTER_TIMEZONE` / `APP_TIMEZONE` / `Asia/Shanghai`），通过可搜索的 `Combobox` 提供完整 IANA 时区清单（按中英文城市、标识与 UTC 偏移过滤）；更新后 `/audit` 的时间戳格式化与自然日筛选区间即时按新时区生效。
- **登录与会话有效期设置**：维护 `console_setting`（`key = "session.ttl_hours"`，范围 `1–2160` 小时，默认 `168` 小时即 7 天），使用 `NumberInput` 直接输入整数小时并实时折合天数；作用于密码、飞书及 OIDC 登录签发，活跃 Cookie 会话每隔 5 分钟滑动顺延数据库 `expires` 与 Cookie `Max-Age`（跳过 `/console/logout` 与 `/console/me/password`），变更同步记录 `system.session_ttl_update` 审计日志。
- **单视图降级**：若某角色仅拥有其中一个面板的查看权限，自动省略单标签栏直接展示对应面板。

## 验收

- HTTP 与回滚门禁：`python3 scripts/verify-system-governance.py`
- 隔离模型熔断拦截：`python3 scripts/e2e/ai-client/run.py --only token,security`（`S7`）
- 浏览器桌面与 `375px` 窄屏验收：`scripts/e2e/system-admin.mjs`
