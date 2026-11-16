# 共享界面组件

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
