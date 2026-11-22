# 共享界面组件（`@optimax-starter/ui`）

本包承载跨应用复用的标准化基础控件与刷新骨架屏；`apps/web/src/components/ui/*` 作为兼容入口重导出。

## 1. 表单弹窗与输入控件

完整选型、三段式间距（固定 Header / 独立滚动 Body / 固定 Footer + 未保存拦截条）与字号规范见 [FRONTEND.md 表单弹窗与输入控件](../../FRONTEND.md#表单弹窗与输入控件)，在线复杂样板见 [forms-demo](../../apps/web/src/features/forms-demo/README.md)（`/demo/forms?dialog=create`）。

- **弹窗与布局**：`components/dialog.tsx`、`components/form-dialog.tsx`（含 `UnsavedChangesBanner`）、`components/detail-drawer.tsx`（`DetailDrawer`、`DetailSection`、`DetailField`）、`components/field.tsx`（`FormSection`、`FieldLayout`、`FieldLabelRow`、`FieldCharCount`、`FieldHint`、`FieldError`）、`components/label.tsx`。
- **文本与复合输入**：`components/input.tsx`、`components/input-group.tsx`（`InputGroup`、`InputGroupAddon`、`ClearableInput`、`CopyableInput`）、`components/password-input.tsx`（显隐切换与 `generateSecurePassword`）、`components/number-input.tsx`、`components/tag-input.tsx`、`components/textarea.tsx`。
- **选择与开关**：`components/select.tsx`、`components/combobox.tsx`、`components/multi-select.tsx`、`components/segmented-control.tsx`、`components/switch.tsx`（含 `SwitchField`）、`components/checkbox.tsx`（支持 `indeterminate` 半选态）、`components/popover.tsx`、`components/button.tsx`。

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

`layout` 支持 `dashboard`（四列指标和表格）与 `table`；`label` 仅供辅助技术读取；`logoSrc` 可覆盖默认品牌图；`delay` 默认 120ms，快速请求不会闪现骨架屏。慢请求持续播放四瓣图标，4.8 秒一周，每次转 90° 后停顿，花瓣轻微展开再合拢。结束时用 220ms 收拢至最近的下一整刻度。系统启用减少动态效果时，图标静止、结束立即恢复内容。没有假进度和强制等待。

边界内部内容保持挂载、滚动位置和表单状态；仅显示骨架屏期间将其隐藏并设为 inert。侧栏、顶部 Tab 应放在边界外。无论成功或失败，调用方都必须解除 loading；错误和空结果由业务组件展示。边界卸载会清理计时器、动画、观察器和事件监听器，恢复原有 aria/inert 属性。

Starter 已通过 `features/refresh/WorkspaceRefresh` 接入四个数据页：首次读取仅跟踪带 `meta.contentRefresh` 的当前活动查询；工具栏刷新通过 `useContentRefresh()` 包住实际 Promise（并发请求用 `Promise.all`）。Starter 调用处统一传入 `APP_CONFIG.logoSrc`，含 Router fallback 和导航 Demo，使内页加载与侧栏使用同一产品标识；共享 UI 的默认 OptiMax 品牌不变。后台更新和业务写操作不覆盖整页。认证和页面错误沿用原有流程。

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
