# 企业列表与 CRUD 组合槽位（`components/crud`）

在保留 EASM `DataTable`、`FilterBar` 与 `FormDialog` 全部高密度、键盘无障碍与未保存拦截细节的前提下，封装管理后台标准列表页骨架，减少跨模块样板代码。

## 组件说明

- [ResourceTableSlot.tsx](./ResourceTableSlot.tsx)：标准列表/台账页面骨架，按固定层级组合：
  1. `PageHeader`（标题与右上角主操作按钮，桌面高 `40px`、移动高 `44px`，与首块内容保持 `12px` 间距基线）；
  2. 权限拒绝态（`allowed={false}` 时渲染 `role="alert"` 明确说明权限不足，不伪装成空数据）；
  3. 操作成功与动作错误统一通过右下角全局通知 `toast`（`components/ui/toast`）轻反馈，不挤占标题到表格的 `12px` 固定间距；兼容旧调用方传入的 `notice` / `actionError` 属性自动转发为通知；
  4. `DataTable` + `FilterBar`（支持草稿持久化 `draftStorageKey`、变更通知 `onDraftChange`）+ 工具栏右侧按「刷新按钮 → `toolbarEnd` 扩展操作（如 `@/lib/csv` 的 `downloadCsv` 安全导出）→ 列设置」顺序排列 + 可选服务端分页 `pagination`；
  5. 高频表格三件套能力：多行勾选与表头半选（`enableRowSelection`、`bulkActions` 悬浮批量操作栏）、行点击右侧滑出详情抽屉（`onRowClick` 配合 `DetailDrawer`），以及列设置排除 `select`/`action` 等锁定列；
  6. 可选 `wrapTable` 与弹窗/抽屉子节点 `children`。
- [ConfirmDialog.tsx](./ConfirmDialog.tsx)：高风险操作（停用、强制下线、删除记录）二次确认弹窗，内置异步提交 loading、错误回显及关闭后焦点归还触发按钮（`onCloseAutoFocus`）。

## 参考用法

- 客户端过滤 + 管理员增删改弹窗：[AssetsPage.tsx](../../features/assets/AssetsPage.tsx) + [AssetFormDialog.tsx](../../features/assets/AssetFormDialog.tsx)
- 管理员权限守卫 + 多动作确认：[AccountsPage.tsx](../../features/accounts/AccountsPage.tsx)
- 服务端分页筛选：[AuditPage.tsx](../../features/audit/AuditPage.tsx)（或通过 `bun run gen:module` 生成新模块）
