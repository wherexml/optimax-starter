# 共享界面组件（`@optimax-starter/ui`）

本包承载跨应用复用的标准化基础控件与刷新骨架屏；`apps/web/src/components/ui/*` 作为兼容入口重导出。

## 1. 表单弹窗与输入控件

完整选型、三段式间距（固定 Header / 独立滚动 Body / 固定 Footer + 未保存拦截条）与字号规范见 [FRONTEND.md 表单弹窗与输入控件](../../FRONTEND.md#表单弹窗与输入控件)，在线复杂样板见 [forms-demo](../../apps/web/src/features/forms-demo/README.md)（`/demo/forms?dialog=create`）。

- **弹窗与布局**：`components/dialog.tsx`、`components/form-dialog.tsx`（含 `UnsavedChangesBanner`）、`components/detail-drawer.tsx`（`DetailDrawer` 含顶部 `actions` 操作栏与左下角 `navigation` 上一个/下一个切换、`DetailSection`、`DetailField`）、`components/field.tsx`（`FormSection`、`FieldLayout`、`FieldLabelRow`、`FieldCharCount`、`FieldHint`、`FieldError`）、`components/label.tsx`。
- **文本与复合输入**：`components/input.tsx`、`components/input-group.tsx`（`InputGroup`、`InputGroupAddon`、`ClearableInput`、`CopyableInput`）、`components/password-input.tsx`（显隐切换与 `generateSecurePassword`）、`components/number-input.tsx`、`components/tag-input.tsx`、`components/textarea.tsx`。
- **选择与开关**：`components/select.tsx`、`components/combobox.tsx`（支持中英文关键词搜索，打开时自动滚动定位已选项）、`components/multi-select.tsx`、`components/segmented-control.tsx`、`components/switch.tsx`（含 `SwitchField`）、`components/checkbox.tsx`（支持 `indeterminate` 半选态）、`components/popover.tsx`、`components/button.tsx`。
- **概览与可视化原语（`@optimax-starter/ui`）**：基于 `recharts` 与 `@optimax-starter/ui/lib/data-tone` 语义 Token，提供 `components/kpi-card.tsx`（`KpiCard` / `KpiCardSkeleton` / `KpiCardError`，采用无底板语义图标）、`components/spark-chart.tsx`、`components/trend-area-chart.tsx`（含面积/柱状形态切换与 4 格摘要条）、`components/donut-chart.tsx`、`components/category-bar.tsx`、`components/bar-list.tsx`、`components/tracker.tsx`（均不耦合路由库，支持 `renderMain` / `renderRow` / `renderLegendItem` 注入跳转链接）。`apps/web/src/components/ui/badge.tsx` 对齐 COSS UI 规范（`6px` 语义圆点配中性描边）。

## 2. 内容刷新与页面骨架屏

`ContentRefresh` 与 `PageSkeleton` 使用同一套 DOM 渲染器和主题变量。组件不读取业务数据、不拦截网络请求，也不重建内容或侧栏。

```tsx
import { ContentRefresh, PageSkeleton } from "@optimax-starter/ui/components/content-refresh";
// 应用入口已导入 @optimax-starter/ui/globals.css。
<ContentRefresh loading={query.isPending} layout="table">
  <AssetTable />
</ContentRefresh>
// Suspense / Router fallback
<PageSkeleton layout="dashboard" label="正在加载页面" />
```

`layout` 支持 `dashboard`（四列指标卡、Bento 图表与精简表格骨架）与 `table`；`immediate` 可在主动点击刷新时跳过 `120ms` 延迟立即展开骨架；`label` 仅供辅助技术读取；`delay` 默认 120ms，快速首次读取不会闪现骨架屏（保留可选 `logoSrc` 类型字段以兼容历史调用方）。慢请求或主动刷新时持续播放骨条渐变流光与无边框独立四瓣几何矢量图形旋转（外圈轨迹与 90° 步进花瓣舒展后在 220ms 内平稳收拢）。系统启用减少动态效果时，图标与骨条流光静止、结束立即恢复内容。没有假进度和强制等待。

边界内部内容保持挂载、滚动位置和表单状态；仅显示骨架屏期间将其隐藏并设为 inert。侧栏、顶部 Tab 应放在边界外。无论成功或失败，调用方都必须解除 loading；错误和空结果由业务组件展示。边界卸载会清理计时器、动画、观察器和事件监听器，恢复原有 aria/inert 属性。

Starter 已通过 `features/refresh/WorkspaceRefresh` 接入全部数据页：首次读取仅跟踪带 `meta.contentRefresh` 的当前活动查询；工具栏及页头主动刷新通过 `useContentRefresh()` 包住实际 Promise（并发请求用 `Promise.all`）并立即展示骨架。后台更新和业务写操作不覆盖整页。认证和页面错误沿用原有流程。

非 React 页面可导入 `lib/content-refresh` 的 `createContentRefresh(element, options)`，调用 `setBusy(boolean)` / `destroy()`。浏览器入口 `lib/content-refresh-browser.ts` 可构建为 IIFE，导出 `window.OptiMaxRefresh`；同时带上 `styles/content-refresh.css`。World 的导出脚本在 `industry-model/scripts/sync-content-refresh.mjs`，产物保留源文件摘要，两边共享源码且运行时互不依赖。

验收入口：[浏览器脚本](../../scripts/e2e/content-refresh.mjs)。用现有真实本地 API，只在测试页临时阻塞请求或注入读取错误；不写业务数据。

## 3. 全局通知（右下角 Toast）

`@optimax-starter/ui/components/toast`（`apps/web/src/components/ui/toast.tsx` 重导出）基于 `@ui-sdk/react/toast` 与浏览器原生 Top Layer（`popover="manual"`）实现右下角全局堆叠通知：

```tsx
import { Toaster, toast } from "@optimax-starter/ui/components/toast";

// 应用根路由（apps/web/src/routes/__root.tsx）挂载一次，跨路由持久保留；退出登录时调用 toast.dismiss() 清理。
<Toaster />

// 业务调用
toast.success("已创建账户 张敏");
toast.warning("证书即将到期", { description: "剩余有效期不足 7 天" });
toast.error("连接目标网关超时", { description: "请检查安全组放行策略后重试" });
toast.promise(syncTask, {
  loading: "正在同步策略…",
  success: "策略同步完成",
  error: "策略同步失败",
});
```

- **位置与堆叠**：桌面固定右下角 `24px` 边距（宽 `368px`），手机（`≤720px`）底部 `16px` 双侧边距无横向溢出；多条通知自动折叠为立体预览栈，鼠标悬停或键盘聚焦时纵向展开全部通知并暂停倒计时。
- **弹窗顶层协同**：以浏览器 Top Layer 渲染并与共享 `Dialog` 焦点守卫协同，弹窗开启期间触发的通知（如 `CopyableInput` 复制反馈）始终位于遮罩与弹窗之上，按 `F6` 聚焦通知、按 `Escape` 或点击关闭仅收起该通知，不会误关底层表单弹窗。
- **配色与尺寸**：遵循 `DESIGN.md`（`0.5px` 细边框、`10px/6px` 同心圆角、无左侧彩色装饰条、严格 `14px/12px` 两档字号；品牌蓝/琥珀/红色语义图标，不使用绿色或紫色主题色，`prefers-reduced-motion` 下关闭位移过渡）。

验收入口：[notifications.mjs](../../scripts/e2e/notifications.mjs)，在线交互速查见 `/demo/forms`。

## 4. 页面级顶层标签（PageTabs）

`@optimax-starter/ui/components/page-tabs`（`apps/web/src/components/ui/page-tabs.tsx` 重导出）封装 `@ui-sdk/react/tabs` 与 `@optimax-starter/ui` 的 `page-tabs.css` 统一样式，供内容区顶部第三级平级视图切换复用（卡片内轻量 2–4 项切换仍使用 `SegmentedControl`）：

```tsx
import { PageTabs, PageTabsPanel } from "@/components/ui/page-tabs";

<PageTabs
  label="系统配置"
  items={visibleTabs}
  value={activeTab}
  hideSingleTab
  onValueChange={(next) => void navigate({ search: { tab: next }, replace: true })}
>
  <PageTabsPanel value="status"><StatusPanel /></PageTabsPanel>
  <PageTabsPanel value="settings"><SettingsPanel /></PageTabsPanel>
</PageTabs>
```

- **内置行为**：同步本地切换状态（快速按键与 Agent 操作不丢帧，并支持 `details.cancel()` 草稿拦截）、窄屏横向溢出自动滚动定位当前选中标签、`2px` `#2f6fed` 下划线与移动端 `44px` 触控高度。
- **单视图降级**：传入 `hideSingleTab` 且可见项 `≤ 1` 时，自动省略顶部单标签条并仅渲染当前激活面板，避免触发未授权或非当前面板查询。
