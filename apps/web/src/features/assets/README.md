# 资产台账

台账继续使用真实 `/console/assets` 数据、TanStack Table、动态 `FilterBar` 和 URL 查询参数同步。筛选语义与持久化规则见 [FILTERS](../../../../../FILTERS.md)；资产智能问答与筛选调整已统一收拢到右上角「问助理」全局抽屉（可随 `--no-agent` 剥离）。

筛选条件、顺序、空行和未应用草稿按账户保留，刷新后恢复；草稿不会自动变成已应用条件。具体键与 URL 优先规则见 [刷新恢复](../../../../../FILTERS.md#刷新恢复与输入语义)。

## 页面与组件结构

- `AssetsPage.tsx` + `AssetLedgerAnalyticsPanel.tsx`：基于 [ResourceTableSlot](../../components/crud/README.md) 构建。顶部 `wrapTable` 挂载由 `GET /console/assets/summary` 驱动的「台账结构与风险概览」面板（匹配规模、`CategoryBar` 状态进度、业务域分布与责任团队待复核 `BarList`，支持点击图例或排行条目直接联动 `FilterBar` 筛选并可收起）。成员仅可查看与筛选；管理员额外展示右上角「新增资产」「批量导入」按钮与行尾「编辑 / 删除」操作；`AssetFormDialog.tsx` 复用 `@optimax-starter/api` 的 `assetInputSchema` 并内置未保存离开拦截与触发按钮焦点归还。
- `AssetDetailPage.tsx` + `AssetTopologyGraph.tsx` + `AssetSuperGraphCanvas.tsx` + `AssetSwimlaneView.tsx` + `asset-graph-visuals.tsx`（路由 `apps/web/src/routes/assets_.$assetId.tsx`，对应 `/assets/$assetId`）：遵循 [详情承载选型](../../../../../DESIGN.md#详情承载选型独立详情页-vs-右侧抽屉) 采用独立分析型详情页替代窄抽屉，并通过 `.content` 容器查询（`.cq-split-12-tight` / `.cq-side-stack`，`1040px` 以下或开启右侧助理时右侧卡片自动下沉至画布下方形成双列栅格）保持宽图空间。点击列表行或「详情」按钮跳转并透传筛选/排序 URL 参数，左上角「← 返回资产台账」原位还原列表条件，右上角提供同队列「上一条 / 下一条」切换与状态快捷流转/编辑/删除；主体涵盖 4 张定量 `KpiCard`、移植自大图工作台的 High-DPI Canvas2D「全域资产架构超大图与聚光灯」（渲染全库 `1,000+` 资产与团队/业务域扇区，支持指针锚定滚轮缩放、`+ / - / 100%` 按钮控制、空白拖拽平移、**按住节点拖拽微调坐标与一键重置位置**、聚光灯子图过滤、5 层关联泳道切换、有序传播链路编号高亮、宽屏展开与跨资产双击/点击下钻跳转）、四项治理核查 `Tracker`、`DonutChart` 本域团队占比与 `BarList` 全库业务域对比，以及底部 `PageTabs`（「关联资产 / 附件与凭证 / 变更审计记录」，时间按系统配置时区格式化且字段名全中文映射）。主题色与数据色仅使用 `brand / warning / danger / neutral`（禁用绿色与紫色）。
- 本地演示数据：服务端（`apps/server/src/modules/assets.ts`）幂等预置 1,000 条覆盖多业务域与责任团队的模拟资产记录（`AS-001` 至 `AS-1000`），便于服务端分页、排序与全量导出测试。
- 导出菜单：工具栏右侧通过共享的 `TableExportMenu` 提供纯图标导出按钮（仅显示下载图标，无触发文字与箭头），点击弹出「导出当前页 CSV」与「异步导出全部」菜单项。
- 可选助手入口与实体芯片：`AssetsPage.tsx` 与 `AssetDetailPage.tsx` 页头均通过 `@starter:agent-start/end` 标记接入 `AskAssistant`，`../assistant/assistant-links-utils.ts` 默认内置可随 `--no-example` 剥离的 `AS-<数字>` 实体编码跳转芯片规则（对话内点击直接跳转到 `/assets/:id`）。

## 服务端 AI 接口兼容

`packages/api/src/asset-agent.ts` 与 `apps/server/src/asset-agent.ts` 保留 `/console/assets/agent/config`、`/plan`、`/result` 接口及其严格参数校验与审计记录，供服务端测试与 `scripts/e2e/ai-client` 验证；AI 客户端接入与环境变量说明见 [部署文档](../../../../../DEPLOYMENT.md#可选服务端模型-api) 与 [AI 模块](../../../../server/src/core/ai/README.md)。

## 台账写接口与服务端分析参考接口

- 写接口（仅管理员，均在 `ADMIN_LOCK` 咨询锁事务内执行并由 `auditResource` 追加 `asset.create / asset.update / asset.delete` 日志）：`POST /console/assets`、`PATCH /console/assets/:id`、`DELETE /console/assets/:id`。
- 查询与分析接口：`GET /console/assets/page` 支持 `code`、`q`、`qOp`（`contains` / `equals`）、多值 `stage`、`domain`、`owner` 及 `page` / `size` 服务端 SQL 分页排序；`GET /console/assets/summary` 按当前筛选口径返回状态与分组聚合统计；`GET /console/assets/topology`（`apps/server/src/modules/assets-topology.ts`）基于全量 `console_asset` 行确定性计算 `2400 x 1600` 世界坐标系的业务域扇区、团队枢纽、同域协同与跨域数据流转超大图并按指纹缓存；`GET /console/assets/:id` 与 `GET /console/assets/:id/detail` 返回单条记录、队列前后邻居、同域/跨域关联拓扑节点、`console_attachment` 附件计数、系统时区及真实 `console_audit` 变更记录。

## 验收

E2E 入口与证据统一见 [TESTING](../../../../../TESTING.md) 和 [脚本说明](../../../../../scripts/e2e/README.md)。不读取或修改 `dist/*.js`。
