# 浏览器 E2E

## 快速导航

在已登录的本地 Starter Ego TaskSpace 中调用 `quick-nav.mjs` 的 `verifyQuickNav(task, { evidenceDir })`。覆盖展开/折叠侧栏、快捷键打开、方向键循环、中文和英文别名过滤、Enter/点击跳转、空结果、Esc 焦点恢复、375px 手机与低高度视口的滚动可见性。只读业务数据，输出 `results.json` 及带 URL 的三张产品截图。详见 [navigation](../../apps/web/src/features/navigation/README.md)。

## 独立模型客户端

不依赖 Magpie 的 HTTP 与真实浏览器验收见 [ai-client](./ai-client/README.md)，覆盖 token 字段兼容、错误分类、并发/FIFO/取消，以及真实资产筛选和回执。使用独立 `38460/38461/38462/38463` 测试栈，供应商为明确标记的模拟器；产出 JSON、脱敏追踪、截图和 URL。

## 内页产品 Logo

在已登录的本地 Starter Ego TaskSpace 中调用 `product-brand.mjs` 的 `verifyProductBrand(task, { evidenceDir })`。默认地址 `http://127.0.0.1:38140`，覆盖六个内页、展开/折叠/刷新、手机抽屉与登录品牌保留。刷新仅在本任务标签页暂缓真实 API 请求，释放后返回真实数据；不写业务数据。输出 `results.json`、五张产品截图及对应 URL。

## 浏览器标签品牌

调用 `favicon.mjs` 的 `verifyFavicon(task, { evidenceDir })`。读取真实页面标题、图标引用、HTTP MIME、SVG 结构、PNG/ICO 回退和刷新行为；渲染 16/32px 检查透明边距，并保存深浅背景图标预览及带 URL 的产品截图。模板默认地址 `http://127.0.0.1:38140/login`。

## 登录品牌与背景

在 Starter Ego TaskSpace 调用 `login-brand.mjs` 的 `verifyLoginBrand(task, { evidenceDir })`。测试访问 `/login`，验证 Logo 无外框、标题和介绍、背景真实像素尺寸，以及桌面/平板/手机布局和表单交互；不提交实际登录凭证。输出 `results.json` 与五种视口的产品截图和 URL。4K 视口截图与背景原图分辨率分别记录，不以截图尺寸替代素材验收。

## 页面顶部与原侧栏

调用 `page-layout.mjs` 的 `verifyPageLayout(task, { evidenceDir })`，读取 6 个桌面页面和资产、设置、Tab 三个手机页面的实际坐标、侧栏样式，保存截图、URL 和 `results.json`。不写业务数据；输出会恢复为桌面 Demo 页面。当前布局与间距基线见 [验收记录](../../evidence/page-layout/acceptance.md)。

## 二级导航与顶部 Tab

在已登录的 Starter Ego TaskSpace 中调用 `navigation-demo.mjs` 的 `verifyNavigationDemo(task, { evidenceDir, pageLabel: 'p1' })`。默认地址 `http://127.0.0.1:38140`，只读取真实本地资产。结果包含 `results.json` 和带 URL 的桌面、折叠、手机抽屉与手机内容截图。覆盖二级上限、Tab 切换/键盘/URL/刷新、Agent 实际操作、快速导航和窄屏。

## 三段式表单弹窗与输入控件

在已登录的 Starter Ego TaskSpace 中调用 `forms-dialog.mjs` 的 `verifyFormsDialog(task, { evidenceDir, pageLabel: 'p1' })`。覆盖 `/accounts` 的「新增/编辑账户」弹窗（三段式头部与内容间距、字段标签到输入框 `8px` 固定间距、密码随机生成与显隐切换、未保存拦截、可选邮箱/公司持久化与只读账户名复制）以及 `/demo/forms?dialog=create` 复杂弹窗（固定头尾与独立滚动主体、`Combobox` 弹窗内 `Esc` 隔离、`SegmentedControl` 动态禁用原因、`NumberInput` 步进、`TagInput` 格式校验与回车生成标签、375px 手机布局无横向溢出）。测试中创建的临时验收账户需在验收结束后清理。

## 全局通知（右下角堆栈）

在已登录的 Starter Ego TaskSpace 中调用 `notifications.mjs` 的 `verifyNotifications(task, { evidenceDir, pageLabel: 'p1' })`。覆盖 `/accounts` 真实创建账户后的右下角 `24px` 贴边定位与表格零位移、跨路由（`/accounts` → `/assets`）持久展示、模态弹窗（`EditAccountDialog`）开启期间 Top Layer 置顶渲染与 `F6` 聚焦 / `Escape` 独立关闭通知（不误关弹窗）、`/demo/forms` 的 `toast.promise` 加载转成功、操作按钮回调、4 条通知折叠立体栈与悬停展开，以及 `375×812` 手机视口 `16px` 边距无横向溢出。测试中创建的 `qa_ntf_*` 临时账户需在验收后清理。

## 筛选输入与刷新状态

在已登录的 Starter ego TaskSpace 中运行 `filter-state.mjs` 的 `verifyFilterState(task, { evidenceDir, withModel: true })`，本地地址默认 `http://127.0.0.1:38140`。`withModel` 默认 false；为 true 时额外调用已配置的真实 Magpie。测试保存并恢复自己触及的两个资产筛选存储键，不清空浏览器 Cookie、缓存或其他站点数据。

结果包括 `results.json`、刷新前后产品截图及对应 URL；覆盖空行、顺序、草稿、多选、匹配方式、清空、显式 URL、坏缓存和登录自动填充边界。见 [本轮记录](../../evidence/filter-state/acceptance.md)。

## 资产自然语言筛选

资产自然语言筛选的运行方式见 [资产模块](../../apps/web/src/features/assets/README.md)。本地已启用并连接 Magpie 后，在同一个已登录 Starter 的 ego TaskSpace 执行：

```js
const task = await taskSpace(实际空间ID);
const { verifyAssetAgent, verifyAssetAgentEdges } = await import('/Users/steve/Projects/00-optimax/optimax-starter/scripts/e2e/asset-agent.mjs');
const options = { evidenceDir: '/Users/steve/Projects/00-optimax/optimax-starter/evidence/asset-agent/replay' };
console.log(await verifyAssetAgent(task, options));
console.log(await verifyAssetAgentEdges(task, options));
```

该测试调用真实模型，只截取本任务 `/assets/agent` 的脱敏工具参数与回执，输出 `results.json` 和产品截图；不写账户或资产。工具追踪仅在测试标签页内生效。验收记录见 [asset-agent](../../evidence/asset-agent/acceptance.md)。

API 边界复验：主机运行 `python3 scripts/e2e/asset-agent-api.py`，从已有本地 `.env` 在内存读取测试登录配置；自动退出自己创建的测试会话，输出 `evidence/asset-agent/api-results.json`。

## 内容刷新

使用 Ego Browser；启动 World（36005）及 Starter（38140/38141），Starter 在同一浏览器用本地演示账户登录（见根 AGENTS），不使用生产凭证。测试读取真实本地数据，故障注入仅作用于测试标签页，不提交任何业务修改。

在一个新建并由 Agent 持有的 TaskSpace 中准备 p1、p2，复验时复用同一个 spaceId：

```js
const task = await taskSpace('内容刷新组件复验');
await task.page('p1').goto('http://127.0.0.1:36005/workspace/');
const starter = await task.newPage();
await starter.goto('http://127.0.0.1:38140/');
console.log(task.spaceId);
// 完成必要的本地登录后，在相同 space 内执行下一段。
```

通过 `ego-browser nodejs` 执行（将下面的实际空间 ID 与绝对证据目录替换为当前值）：

```js
const task = await taskSpace(336);
const { verifyContentRefresh, verifyWorldModuleRefresh } = await import('/Users/steve/Projects/00-optimax/optimax-starter/scripts/e2e/content-refresh.mjs');
const options = { evidenceDir: '/absolute/path/content-refresh-evidence' };
console.log(await verifyContentRefresh(task, options));
console.log(await verifyWorldModuleRefresh(task, options));
await task.finish({ keep: [] });
```

脚本将完整结果写入 `results.json`、`module-results.json`，并保存 World / Starter 的加载、成功、错误、移动端，以及平台复用页和模型工作室加载截图。断言失败时也保留已通过项目并清理测试注入。

覆盖：真实刷新；菜单 DOM 保持；Tab 不遮挡；内容 inert 与恢复；并发部分完成；快速请求不闪烁；失败重试；离开页面与迟到结果；首次无缓存读取；四个 Starter 页面；窄屏；减少动态效果；iframe 加载；V2 Shadow Root 与旧工作室读取。

测试使用 Focus Emulation 保持标签页焦点稳定，避免浏览器切页引发的正常后台重取抢在刷新点击之前；不更改产品的自动更新行为。API gate 仅阻塞读请求，释放后仍访问实际本地 API；错误测试临时阻断请求；工作室 gate 只延迟宿主调用的真实读取函数。所有模拟均与截图/结果一起标明，不等同生产网络性能测量。
