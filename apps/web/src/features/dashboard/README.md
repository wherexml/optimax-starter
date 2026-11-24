# 概览（`/`）

控制台首页承载全平台高频工作入口、核心 KPI 汇总与轻量治理总览，遵循 `DESIGN.md` 紧贴页面标题与双视图 Bento 布局，支持桌面端、移动端与深浅色主题自适应。

## 视图与按权请求

- **双视图切换**：顶部通过共享 `SegmentedControl` 在「业务总览」与「治理与审计」之间切换；概览页受 `workbench:read` 保护。
- **按有效权限按需加载**：[DashboardPage.tsx](./DashboardPage.tsx) 仅对当前登录账户具备对应读权限的数据源发起请求（`assets:read`、`accounts:read`、`audit:read`、`jobs:read`、`system:settings:read`），无权限模块与管理员以下成员均不会触发 `403` 请求。
- **独立骨架刷新边界**：主内容包在 `ContentRefresh`（`layout="dashboard"`）中，支持对齐 Bento 与环形图的 `.om-bone` 流光骨架及页头显式刷新（`immediate` 即时节拍）。

## 注册表驱动与脚手架联动

概览模块卡片与指标拆解不硬编码资产表结构，全部通过 [registry.ts](./registry.ts) 的 `DASHBOARD_MODULES` 维护：

- **示例与多模块锚点**：`assetsDashboardModule` 由 `// @starter:example-assets-start` 与 `end` 包裹；`./scripts/bootstrap-project.sh --no-example` 自动移除示例资产块而不影响概览页渲染。
- **新增模块自动接入**：执行 `bun run gen:module <slug> ...` 时，脚本在 `// @starter:dashboard-modules` 锚点前自动追加 `createGeneratedModuleSpec(...)`，按模块枚举、分类、责任人与布尔字段自动生成 KPI 卡、分段比例条（`CategoryBar`）、多维度榜单（`BarList`）及明细预览表。

## 共享可视化原语与纯函数

- **图表与数据原语（`@optimax-starter/ui`）**：[KpiCard](../../../../../packages/ui/src/components/kpi-card.tsx)、[SparkChart](../../../../../packages/ui/src/components/spark-chart.tsx)、[TrendAreaChart](../../../../../packages/ui/src/components/trend-area-chart.tsx)（面积 / 柱状切换与 4 格摘要条）、[DonutChart](../../../../../packages/ui/src/components/donut-chart.tsx)、[CategoryBar](../../../../../packages/ui/src/components/category-bar.tsx)、[BarList](../../../../../packages/ui/src/components/bar-list.tsx)、[Tracker](../../../../../packages/ui/src/components/tracker.tsx)。
- **时区与聚合纯函数**：[dashboard-utils.ts](./dashboard-utils.ts) 提供按系统 IANA 时区聚合的日志日趋势、来源分布、高频动作 / 操作人排行与后台任务状态槽位计算；对应隔离单测位于 [dashboard-utils.test.ts](./dashboard-utils.test.ts)。
