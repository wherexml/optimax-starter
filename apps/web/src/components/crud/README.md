# 企业列表与 CRUD 组合槽位（`components/crud`）

基于 `DataTable`、`FilterBar` 与 `FormDialog` 的高密度、键盘无障碍与未保存拦截能力，封装管理后台标准列表页骨架，减少跨模块样板代码。

## 组件说明

- [ResourceTableSlot.tsx](./ResourceTableSlot.tsx)：标准列表/台账页面骨架，按固定层级组合：
  1. `PageHeader`（标题与右上角主操作按钮，桌面高 `40px`、移动高 `44px`，与首块内容保持 `12px` 间距基线）；
  2. 权限拒绝态（`allowed={false}` 时渲染 `role="alert"` 明确说明权限不足，不伪装成空数据）；
  3. 操作成功与动作错误统一通过右下角全局通知 `toast`（`components/ui/toast`）轻反馈，不挤占标题到表格的 `12px` 固定间距；兼容旧调用方传入的 `notice` / `actionError` 属性自动转发为通知；
  4. `DataTable` + `FilterBar`（支持草稿持久化 `draftStorageKey`、变更通知 `onDraftChange`）+ 工具栏右侧按「刷新按钮 → `toolbarEnd` 扩展操作（推荐 `@/components/table/TableExportMenu` 纯图标导出菜单配合 `@/lib/csv` 的 `downloadCsv`）→ 列设置」顺序排列 + 可选服务端分页 `pagination`；
  5. 高频表格三件套能力：多行勾选与表头半选（`enableRowSelection`、`bulkActions` 悬浮批量操作栏）、行点击交互（`onRowClick` 按 [详情承载选型](../../../../../DESIGN.md#详情承载选型独立详情页-vs-右侧抽屉) 区分：`≤ 10` 字段轻速览接 `DetailDrawer`，含拓扑图/多图表/复杂分析须跳往独立详情路由 `routes/<slug>_.$id.tsx`，详见 [FRONTEND 独立详情页路由](../../../../../FRONTEND.md#独立详情页路由与筛选上下文透传)），以及列设置排除 `select`/`action` 等锁定列；
  6. 可选 `wrapTable`（可用于在表格上方挂载统计/筛选联动概览卡片）与弹窗/抽屉子节点 `children`。
- [ConfirmDialog.tsx](./ConfirmDialog.tsx)：高风险操作（停用、强制下线、删除记录）二次确认弹窗，内置异步提交 loading、错误回显、关闭后焦点归还触发按钮（`onCloseAutoFocus`）及 `agentConfirm` 属性（自动挂载 `data-agent-confirm` 供客户端 UI Agent 人工确认门禁识别）。

## 参考用法

- 列表可视化概览 + 独立可视化详情页 + 管理员增删改弹窗：[AssetsPage.tsx](../../features/assets/AssetsPage.tsx) + [AssetDetailPage.tsx](../../features/assets/AssetDetailPage.tsx) + [AssetFormDialog.tsx](../../features/assets/AssetFormDialog.tsx)
- 管理员权限守卫 + 轻量抽屉速览：[AccountsPage.tsx](../../features/accounts/AccountsPage.tsx)
- 服务端分页筛选 + 轻量抽屉速览：[AuditPage.tsx](../../features/audit/AuditPage.tsx)（新增模块可用 `bun run gen:module --detail drawer|page` 按场景选择承载方式）
