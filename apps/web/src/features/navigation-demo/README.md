# 导航 Demo

本地入口：[资产视图](http://127.0.0.1:38140/demo/navigation?tab=pending)。管理员、成员均可访问，沿用 Shell 登录校验；不写业务数据。

侧栏「Demo → 资产视图」占满二级，第三级平级视图「全部资产 / 已登记 / 待复核」使用内容顶部 Tab。折叠时保留命名图标入口，移动端保持二级抽屉，快速导航可搜 Demo。侧栏保留 Starter 浅色样式；只有右侧顶部 Tab 采用 World Model 透明底和 2px 蓝色下划线。标题和内容间距沿用共享紧凑布局。设计正文见 [DESIGN](../../../../../DESIGN.md#页内导航与标签)。

- `routes/demo.navigation.tsx` 只连接路由、搜索参数与页面。
- `search.ts` 维护 Tab 白名单 `all / registered / pending`。缺省或非法值规范化为 `?tab=all`；切换用 replace，刷新保留 URL。UI SDK 的同步本地状态负责即时交互，路由负责深链。
- `NavigationDemoPage.tsx` 使用 UI SDK Tabs 的名称、键盘和 ARIA；仅激活面板挂载并读取 `GET /console/assets`，每个视图有独立 Query key。表格复用资产台账列定义，支持排序、列设置、刷新和失败反馈。加载与显式刷新边界只包住面板表格，顶部 Tab 保持可操作。
- `agent-bridge.ts` 提供同一 UI SDK 注册表的导航操作桥，供 E2E 验证真实组件；只允许 Tabs `setValue`，不接入资产模型请求。
- 无表单草稿、管理员专属 Tab 或多页关闭栏；新增这些行为时遵循 [FRONTEND](../../../../../FRONTEND.md#页内导航与标签行为)。

复验：已登录的 Ego TaskSpace 调用 `scripts/e2e/navigation-demo.mjs` 的 `verifyNavigationDemo(task, { evidenceDir })`。测试结果和截图见根 [TESTING](../../../../../TESTING.md)。

修改 Tab 行为或新增页面交互时，先读项目 [starter-ui-sdk](../../../../../.agents/skills/starter-ui-sdk/SKILL.md)，按当前安装版本的文档完成路由、状态与 Agent 验证。
